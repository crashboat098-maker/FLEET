import { Input, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { CollectibleSystem } from '../entities/CollectibleSystem';
import { PlayerShip } from '../entities/PlayerShip';
import { PlayerState } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { IslandDecor } from '../world/IslandDecor';
import { OceanLayer } from '../world/OceanLayer';
import { PortSystem } from '../world/PortSystem';
import { bakeDeepWater, bakeIsland, bakeMinimap, bakeReefs } from '../world/terrainTextures';
import { generateWorld, WorldData } from '../world/WorldGenerator';
import { Depth } from '../world/worldConfig';
import type { HudSceneData } from './HudScene';
import type { PortSceneData } from './PortScene';

/** The world layout is deterministic, so build it once per page load. */
let cachedWorld: WorldData | null = null;
const getWorld = (): WorldData => (cachedWorld ??= generateWorld());

const COLLECTIBLE_COUNT = 64;
const DISCOVER_RANGE = 150;

/**
 * Main gameplay scene: the open ocean, islands, port, treasure and the
 * player's sloop. UI lives in the HUD and Port overlay scenes.
 */
export class OceanScene extends Scene {
    private world!: WorldData;
    private collision!: CollisionWorld;
    private ocean!: OceanLayer;
    private decor!: IslandDecor;
    private port!: PortSystem;
    private ship!: PlayerShip;
    private collectibles!: CollectibleSystem;
    private state!: PlayerState;
    private keyDock!: Input.Keyboard.Key;
    private lookAhead = { x: 0, y: 0 };
    private canDockNow = false;
    private dockCooldown = 0;
    private discovered = new Set<number>();
    private discoverTimer = 0;
    private leaving = false;
    private ready = false;

    constructor() {
        super(SceneKeys.Ocean);
    }

    create(): void {
        this.ready = false;
        // First voyage bakes ~1s of terrain; show a message instead of a frozen frame.
        if (this.textures.exists('deep-water')) {
            this.build();
            return;
        }
        this.cameras.main.setBackgroundColor(0x06182b);
        const msg = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, 'CHARTING THE SEAS...', Fonts.Gold, 2).setScrollFactor(0);
        this.time.delayedCall(60, () => {
            msg.destroy();
            this.build();
        });
    }

    private build(): void {
        const t0 = performance.now();
        this.leaving = false;
        this.canDockNow = false;
        this.discovered = new Set();
        this.world = getWorld();
        this.collision = new CollisionWorld(this.world);
        const { world } = this;
        const cam = this.cameras.main;
        cam.setBounds(0, 0, world.size, world.size);
        cam.setBackgroundColor(0x1a6fa8);

        // --- Terrain
        const tDeep = performance.now();
        this.ocean = new OceanLayer(this, bakeDeepWater(this, world), this.collision);
        const tIslands = performance.now();
        const reefKeys = bakeReefs(this);
        for (const r of world.reefs) this.add.image(r.x, r.y, reefKeys[r.variant]).setScale(PIXEL_SCALE).setDepth(Depth.Seabed);

        this.decor = new IslandDecor(this);
        const portExclusions = PortSystem.exclusions(world.port);
        for (const island of world.islands) {
            const vis = bakeIsland(this, island, island === world.port.island ? portExclusions : []);
            this.add.image(vis.left, vis.top, vis.key).setOrigin(0).setScale(PIXEL_SCALE).setDepth(Depth.Island);
            vis.palms.forEach((p) => this.decor.addPalm(p.x, p.y));
        }
        this.port = new PortSystem(this, world.port);
        const tMap = performance.now();
        bakeMinimap(this, world, this.collision);
        const tEnd = performance.now();

        // --- Player
        this.state = new PlayerState();
        const spawn = world.port.spawn;
        this.ship = new PlayerShip(this, this.collision, world.size, spawn.x, spawn.y, spawn.heading);
        this.discovered.add(world.port.island.id);

        this.collectibles = new CollectibleSystem(this, this.collision, this.state, world.size, COLLECTIBLE_COUNT, spawn);

        cam.startFollow(this.ship.sprite, true, 0.09, 0.09);
        cam.centerOn(spawn.x, spawn.y);
        cam.fadeIn(400, 6, 24, 43);

        // --- Input
        const kb = this.input.keyboard!;
        this.keyDock = kb.addKey(Input.Keyboard.KeyCodes.E);
        kb.on('keydown-ESC', () => this.returnToMenu());

        // --- UI overlays
        const hudData: HudSceneData = { state: this.state, world, getShip: () => this.ship };
        this.scene.launch(SceneKeys.Hud, hudData);
        this.ready = true;

        this.events.on('resume', () => this.onLeavePort());
        this.events.once('shutdown', () => {
            this.events.off('resume');
            this.scene.stop(SceneKeys.Hud);
        });

        if (import.meta.env.DEV) {
            console.info(
                `[FLEET.IO] world ready in ${Math.round(performance.now() - t0)}ms ` +
                    `(gen ${Math.round(tDeep - t0)}, deep ${Math.round(tIslands - tDeep)}, islands ${Math.round(tMap - tIslands)}, map ${Math.round(tEnd - tMap)}) — ` +
                    `${world.islands.length} islands, ${this.decor.count} palms, ${world.reefs.length} reefs`
            );
            // Handy for manual testing in the console.
            (window as unknown as { fleet: unknown }).fleet = { scene: this, ship: this.ship, state: this.state, world, bakeIsland };
        }
    }

    update(_time: number, delta: number): void {
        if (!this.ready) return;
        this.ship.update(delta);

        // Camera looks slightly ahead in the direction of travel.
        const cam = this.cameras.main;
        const k = Math.min(1, delta / 400);
        this.lookAhead.x += (-this.ship.vx * 0.35 - this.lookAhead.x) * k;
        this.lookAhead.y += (-this.ship.vy * 0.35 - this.lookAhead.y) * k;
        cam.setFollowOffset(this.lookAhead.x, this.lookAhead.y);

        this.ocean.update(delta);
        this.decor.update(delta);
        this.port.update(delta);
        this.collectibles.update(delta, this.ship);

        this.updateDocking(delta);
        this.updateDiscovery(delta);
    }

    private updateDocking(delta: number): void {
        this.dockCooldown = Math.max(0, this.dockCooldown - delta);
        const can = this.port.canDock(this.ship.x, this.ship.y);
        if (can !== this.canDockNow) {
            this.canDockNow = can;
            this.state.prompt(can ? `E - DOCK AT ${this.world.port.name}` : null);
        }
        if (can && this.dockCooldown === 0 && Input.Keyboard.JustDown(this.keyDock)) this.dock();
    }

    private updateDiscovery(delta: number): void {
        this.discoverTimer -= delta;
        if (this.discoverTimer > 0) return;
        this.discoverTimer = 250;
        for (const island of this.collision.islandsNear(this.ship.x, this.ship.y)) {
            if (this.discovered.has(island.id)) continue;
            if (island.near(this.ship.x, this.ship.y, DISCOVER_RANGE) && island.edge(this.ship.x, this.ship.y) < DISCOVER_RANGE) {
                this.discovered.add(island.id);
                this.state.toast(`DISCOVERED ${island.name}`);
            }
        }
    }

    private dock(): void {
        this.ship.stop();
        this.ship.controlsEnabled = false;
        this.state.prompt(null);
        this.canDockNow = false;
        const data: PortSceneData = { state: this.state, portName: this.world.port.name };
        this.scene.launch(SceneKeys.Port, data);
        this.scene.pause();
    }

    private onLeavePort(): void {
        this.input.keyboard?.resetKeys();
        this.ship.controlsEnabled = true;
        this.dockCooldown = 500;
    }

    private returnToMenu(): void {
        if (this.leaving) return;
        this.leaving = true;
        this.cameras.main.fadeOut(300, 6, 24, 43);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SceneKeys.Menu));
    }
}
