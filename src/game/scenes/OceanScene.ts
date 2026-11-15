import { Geom, Input, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { CollectibleSystem } from '../entities/CollectibleSystem';
import { PlayerShip } from '../entities/PlayerShip';
import { PlayerState } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { OceanLayer } from '../world/OceanLayer';
import { PortSystem } from '../world/PortSystem';
import { IslandLife } from '../world/IslandLife';
import { bakeDeepWater, bakeMinimap, bakeReefs } from '../world/terrainTextures';
import { TerrainStreamer } from '../world/TerrainStreamer';
import { generateWorld, WorldData } from '../world/WorldGenerator';
import { Depth } from '../world/worldConfig';
import type { HudSceneData } from './HudScene';
import type { PortSceneData } from './PortScene';

/** The world layout is deterministic, so build it once per page load. */
let cachedWorld: WorldData | null = null;
const getWorld = (): WorldData => (cachedWorld ??= generateWorld());

// Scaled with the 4x larger ocean so treasure density stays about the same.
const COLLECTIBLE_COUNT = 220;
const DISCOVER_RANGE = 150;

/**
 * Main gameplay scene: the open ocean, islands, port, treasure and the
 * player's sloop. UI lives in the HUD and Port overlay scenes.
 */
export class OceanScene extends Scene {
    private world!: WorldData;
    private collision!: CollisionWorld;
    private ocean!: OceanLayer;
    private life!: IslandLife;
    private terrain!: TerrainStreamer;
    private ports: PortSystem[] = [];
    private dockPort: PortSystem | null = null;
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

        // Islands stream in tile by tile around the camera.
        const exclusions = new Map(world.ports.map((p) => [p.island.id, PortSystem.exclusions(p)]));
        this.life = new IslandLife(this);
        this.terrain = new TerrainStreamer(this, world.islands, exclusions, this.life);
        this.ports = world.ports.map((p) => new PortSystem(this, p));
        this.dockPort = null;
        const home = world.ports[0];
        const spawn = home.spawn;
        this.terrain.primeAround(new Geom.Rectangle(spawn.x - GAME_WIDTH / 2, spawn.y - GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT));
        const tMap = performance.now();
        bakeMinimap(this, world, this.collision);
        const tEnd = performance.now();

        // --- Player
        this.state = new PlayerState();
        this.ship = new PlayerShip(this, this.collision, world.size, spawn.x, spawn.y, spawn.heading);
        this.discovered.add(home.island.id);

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
            this.terrain.destroy();
            this.scene.stop(SceneKeys.Hud);
        });

        if (import.meta.env.DEV) {
            console.info(
                `[FLEET.IO] world ready in ${Math.round(performance.now() - t0)}ms ` +
                    `(gen ${Math.round(tDeep - t0)}, deep ${Math.round(tIslands - tDeep)}, islands ${Math.round(tMap - tIslands)}, map ${Math.round(tEnd - tMap)}) — ` +
                    `${world.islands.length} islands, ${world.ports.length} ports, ${this.terrain.loadedTiles} tiles, ${world.reefs.length} reefs`
            );
            // Handy for manual testing in the console.
            (window as unknown as { fleet: unknown }).fleet = { scene: this, ship: this.ship, state: this.state, world };
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
        this.terrain.update(delta);
        this.life.update(delta);
        for (const p of this.ports) p.update(delta);
        this.collectibles.update(delta, this.ship);

        this.updateDocking(delta);
        this.updateDiscovery(delta);
    }

    private updateDocking(delta: number): void {
        this.dockCooldown = Math.max(0, this.dockCooldown - delta);
        // Invisible docking radius around each dock head; never drawn.
        const port = this.ports.find((p) => p.canDock(this.ship.x, this.ship.y)) ?? null;
        const can = port !== null;
        if (can !== this.canDockNow || port !== this.dockPort) {
            this.canDockNow = can;
            this.dockPort = port;
            this.state.prompt(port ? `PRESS E TO DOCK - ${port.layout.name}` : null);
        }
        if (port && this.dockCooldown === 0 && Input.Keyboard.JustDown(this.keyDock)) this.dock(port);
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

    private dock(port: PortSystem): void {
        this.ship.stop();
        this.ship.controlsEnabled = false;
        this.state.prompt(null);
        this.canDockNow = false;
        this.dockPort = null;
        const data: PortSceneData = { state: this.state, portName: port.layout.name };
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
