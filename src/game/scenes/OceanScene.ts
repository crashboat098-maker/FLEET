import { Display, GameObjects, Geom, Input, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Director } from '../ai/Director';
import { NpcRole } from '../ai/NpcShip';
import { CannonSystem } from '../combat/CannonSystem';
import { CombatWorld } from '../combat/Combatant';
import { Kraken, Serpent, Shark } from '../creatures/Creatures';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { CollectibleSystem } from '../entities/CollectibleSystem';
import { PlayerShip } from '../entities/PlayerShip';
import { createShip, Formation, loadProfile, newProfile, Profile } from '../ships/profile';
import { SHIP_CLASSES } from '../ships/shipClasses';
import { ItemType } from '../state/items';
import { PlayerState, StateEvents } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { OceanLayer } from '../world/OceanLayer';
import { PortSystem } from '../world/PortSystem';
import { IslandLife } from '../world/IslandLife';
import { REGIONS, RegionId, regionAt } from '../world/regions';
import { bakeDeepWater, bakeMinimap, bakeReefs } from '../world/terrainTextures';
import { TerrainStreamer } from '../world/TerrainStreamer';
import { Circle, generateWorld, WorldData } from '../world/WorldGenerator';
import { generateFeatures, WorldFeatures } from '../world/worldFeatures';
import { IslandPopulation } from '../world/IslandPopulation';
import { MermaidSystem } from '../world/MermaidSystem';
import { SALVAGE_MS, WreckSystem } from '../entities/WreckSystem';
import { Depth } from '../world/worldConfig';
import type { HudScene, HudSceneData, HudShipView } from './HudScene';
import type { OceanSceneData } from './MenuScene';
import type { PortSceneData, PortTab } from './PortScene';

/** The world layout is deterministic, so build it once per page load. */
let cachedWorld: WorldData | null = null;
let cachedFeatures: WorldFeatures | null = null;
const getFeatures = (w: WorldData): WorldFeatures => (cachedFeatures ??= generateFeatures(w));
const getWorld = (): WorldData => (cachedWorld ??= generateWorld());

// Scaled with the 4x larger ocean so treasure density stays about the same.
// Floating goods are uncommon now; salvage, combat and exploration are the main sources.
const COLLECTIBLE_COUNT = 110;
/** Sharp reefs and siren rocks (HP per second while moving over them). */
const REEF_DPS = 4;
const DISCOVER_RANGE = 150;
/** Collisions that cost less speed than this are scrapes, not crashes. */
const IMPACT_MIN = 18;
const IMPACT_DAMAGE_PER_SPEED = 0.55;
/** Boiling water near lava flows (HP per second). */
const HAZARD_DPS = 7;
const FORMATIONS: Formation[] = ['line', 'wedge', 'flank'];

const lerpColor = (a: number, b: number, t: number) => {
    const c = Display.Color.Interpolate.ColorWithColor(Display.Color.IntegerToColor(a), Display.Color.IntegerToColor(b), 100, t * 100);
    return Display.Color.GetColor(c.r, c.g, c.b);
};

/**
 * Main gameplay scene: ocean, islands, ports, treasure, the player's
 * flagship, NPC ships, creatures, combat, regions and missions.
 * UI lives in the HUD and Port overlay scenes.
 */
export class OceanScene extends Scene {
    private profile!: Profile;
    private world!: WorldData;
    private collision!: CollisionWorld;
    private ocean!: OceanLayer;
    private life!: IslandLife;
    private terrain!: TerrainStreamer;
    private ports: PortSystem[] = [];
    private lastPort: PortSystem | null = null;
    private ship: PlayerShip | null = null;
    private shipId: string | null = null;
    private collectibles!: CollectibleSystem;
    private state!: PlayerState;
    private combat!: CombatWorld;
    private cannons!: CannonSystem;
    private director!: Director;
    private features!: WorldFeatures;
    private wrecks!: WreckSystem;
    private population!: IslandPopulation;
    private mermaids!: MermaidSystem;
    private reefs: Circle[] = [];
    private action: (() => void) | null = null;
    private hazards: Circle[] = [];
    private keys!: Record<'dock' | 'ability' | 'port' | 'starboard' | 'formation', Input.Keyboard.Key>;
    private targetMarker!: GameObjects.Image;
    private haze!: GameObjects.Rectangle;
    private region: RegionId | null = null;
    private tint = { water: 0xffffff, hazeColor: 0xffffff, hazeAlpha: 0 };
    private lookAhead = { x: 0, y: 0 };
    private dockCooldown = 0;
    private impactCooldown = 0;
    private hazardTimer = 0;
    private regionTimer = 0;
    private lastHazardToast = -1e9;
    private discoverTimer = 0;
    private clock = 0;
    private leaving = false;
    private ready = false;

    constructor() {
        super(SceneKeys.Ocean);
    }

    init(data: Partial<OceanSceneData>): void {
        // Normally handed over by the menu; fall back to the save (or a fresh sloop) for dev reloads.
        let profile = data?.profile ?? loadProfile();
        if (!profile || !profile.ships.length) {
            profile = newProfile('CAPTAIN');
            const ship = createShip('sloop', 'active');
            profile.ships.push(ship);
            profile.activeId = ship.id;
        }
        this.profile = profile;
    }

    create(): void {
        this.ready = false;
        if (this.textures.exists('deep-water')) {
            this.build();
            return;
        }
        // First voyage bakes ~1s of terrain; show a message instead of a frozen frame.
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
        this.ship = null;
        this.shipId = null;
        this.region = null;
        this.world = getWorld();
        this.collision = new CollisionWorld(this.world);
        const { world } = this;
        const cam = this.cameras.main;
        cam.setBounds(0, 0, world.size, world.size);
        cam.setBackgroundColor(0x1a6fa8);

        // --- Terrain
        this.ocean = new OceanLayer(this, bakeDeepWater(this, world), this.collision);
        const reefKeys = bakeReefs(this);
        for (const r of world.reefs) this.add.image(r.x, r.y, reefKeys[r.variant]).setScale(PIXEL_SCALE).setDepth(Depth.Seabed);
        const exclusions = new Map(world.ports.map((p) => [p.island.id, PortSystem.exclusions(p)]));
        this.life = new IslandLife(this);
        this.terrain = new TerrainStreamer(this, world.islands, exclusions, this.life);
        this.ports = world.ports.map((p) => new PortSystem(this, p));
        const home = this.ports[0];
        this.lastPort = home;
        const spawn = home.layout.spawn;
        this.terrain.primeAround(new Geom.Rectangle(spawn.x - GAME_WIDTH / 2, spawn.y - GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT));
        this.hazards = world.islands.flatMap((i) => this.terrain.artFor(i).hazards);
        this.features = getFeatures(world);
        // Reefs in rougher waters (and every siren's rocks) are dangerous to sail over.
        this.reefs = [
            ...world.reefs.filter((r) => REGIONS[regionAt(r.x, r.y)].danger >= 3).map((r) => ({ x: r.x, y: r.y, r: 30 })),
            ...this.features.mermaids.map((m) => ({ x: m.x, y: m.y, r: 30 }))
        ];
        const minimapKey = bakeMinimap(this, world, this.collision);
        // Regional atmosphere: a faint camera-fixed haze over the world.
        this.haze = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0).setOrigin(0).setScrollFactor(0).setDepth(Depth.WorldLabel - 1);

        // --- State, combat & actors
        this.state = new PlayerState(this.profile);
        this.combat = new CombatWorld();
        this.cannons = new CannonSystem(this, this.combat, this.collision);
        this.collectibles = new CollectibleSystem(this, this.collision, this.state, world.size, COLLECTIBLE_COUNT, spawn);
        this.collectibles.spotHint = () => this.spawnHint();
        this.director = new Director(this, world, this.collision, this.combat, this.cannons, this.collectibles, [...this.hazards, ...this.reefs], this.state);
        this.wrecks = new WreckSystem(this, this.features.wrecks, this.state, this.collectibles);
        this.population = new IslandPopulation(this, this.features, this.combat, this.state);
        this.mermaids = new MermaidSystem(this, this.features.mermaids, this.state);
        this.director.wrecks = this.wrecks;
        this.director.population = this.population;
        this.targetMarker = this.add.image(0, 0, 'fx-target').setScale(PIXEL_SCALE).setDepth(Depth.Collectible + 2).setVisible(false);
        cam.centerOn(spawn.x, spawn.y);
        cam.fadeIn(400, 6, 24, 43);
        if (this.state.seaworthy) this.spawnShip(home);

        // --- Input
        const kb = this.input.keyboard!;
        const K = Input.Keyboard.KeyCodes;
        this.keys = {
            dock: kb.addKey(K.E),
            ability: kb.addKey(K.Q),
            port: kb.addKey(K.Z),
            starboard: kb.addKey(K.C),
            formation: kb.addKey(K.F)
        };
        kb.addCapture([K.TAB]);
        kb.on('keydown-ESC', () => this.returnToMenu());
        this.input.mouse?.disableContextMenu();
        this.input.on('pointerdown', (p: Input.Pointer) => this.onPointer(p));

        // --- State events
        const st = this.state;
        st.on(StateEvents.Changed, () => this.ship?.sprite.setDamageLevel(st.damageLevel));
        st.on(StateEvents.Sunk, (dropped: ItemType[], kept: number) => this.onSunk(dropped, kept));
        st.on(StateEvents.DockRequest, () => this.action?.());
        st.on(StateEvents.AbilityRequest, () => this.useAbility());

        // --- UI overlays
        const hudData: HudSceneData = {
            state: st,
            world,
            minimapKey,
            getShip: () => this.hudView(),
            getMarkers: () => this.director.markers(),
            getBoss: () => this.director.boss(this.ship)
        };
        this.scene.launch(SceneKeys.Hud, hudData);
        this.ready = true;

        // Captain has no seaworthy flagship (e.g. it sank last session): start in the harbour.
        if (!st.seaworthy) this.time.delayedCall(450, () => this.openPort(home, 'repair'));

        this.events.on('resume', () => this.onLeavePort());
        this.events.once('shutdown', () => {
            this.events.off('resume');
            st.removeAllListeners();
            this.director.destroy();
            this.wrecks.destroy();
            this.population.destroy();
            this.mermaids.destroy();
            this.cannons.destroy();
            this.terrain.destroy();
            this.scene.stop(SceneKeys.Hud);
        });

        if (import.meta.env.DEV) {
            console.info(`[FLEET] world ready in ${Math.round(performance.now() - t0)}ms — ${world.islands.length} islands`);
            const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
            (window as unknown as { fleet: unknown }).fleet = {
                scene: this,
                get ship() {
                    return self.ship;
                },
                state: st,
                world,
                director: this.director,
                combat: this.combat,
                damage: (n: number) => st.damage(n, 'cannonball'),
                /** Spawn an NPC ahead of the player, e.g. fleet.spawn('pirate'). */
                spawn: (role: NpcRole, dist = 260) => {
                    const s = self.ship;
                    if (!s) return null;
                    const at = { x: s.x + Math.sin(s.heading) * dist, y: s.y - Math.cos(s.heading) * dist };
                    const captain = role === 'captain';
                    if (role === 'pirate' || captain) {
                        return self.director.spawn({ role, cls: captain ? 'corsair' : 'sloop', name: captain ? 'CAPT. TESTBEARD' : 'TEST RAIDER', ...at });
                    }
                    return self.director.spawn({ role, cls: 'sloop', name: 'TEST SHIP', ...at, toPort: 1 });
                },
                creature: (kind: 'shark' | 'serpent' | 'kraken', dist = 250) => {
                    const s = self.ship;
                    if (!s) return null;
                    const x = s.x + Math.sin(s.heading) * dist;
                    const y = s.y - Math.cos(s.heading) * dist;
                    const c = kind === 'shark' ? new Shark(self, x, y) : kind === 'serpent' ? new Serpent(self, x, y) : new Kraken(self, x, y);
                    self.director.addCreature(c);
                    return c;
                }
            };
        }
    }

    // --------------------------------------------------------------- ship

    private spawnShip(port: PortSystem): void {
        if (this.ship) {
            this.combat.remove(this.ship);
            this.ship.sprite.destroy();
        }
        const active = this.state.active!;
        const s = port.layout.spawn;
        const ship = new PlayerShip(this, this.collision, this.world.size, s.x, s.y, s.heading, active.cls, () => this.state.stats);
        ship.name = active.name;
        ship.onImpact = (lost) => this.onImpact(lost);
        ship.onHit = (dmg, source) => {
            const dealt = this.state.damage(dmg, source);
            if (dealt > 0.5 && source !== 'hazard') this.cameras.main.shake(120, 0.003);
        };
        ship.status = () => ({ alive: this.state.seaworthy, hpRatio: this.state.hull / Math.max(1, this.state.hullMax) });
        ship.sprite.setDamageLevel(this.state.damageLevel);
        this.ship = ship;
        this.shipId = active.id;
        this.combat.add(ship);
        this.director.flagship = ship;
        this.lookAhead = { x: 0, y: 0 };
        const cam = this.cameras.main;
        cam.startFollow(ship.sprite, true, 0.09, 0.09);
        cam.setFollowOffset(0, 0);
        cam.centerOn(s.x, s.y);
        this.director.syncEscorts();
    }

    private hudView(): HudShipView | null {
        const ship = this.ship;
        const active = this.state.active;
        if (!ship || !active) return null;
        return {
            x: ship.x,
            y: ship.y,
            reload: (side) => 1 - ship.reloadLeft(side) / Math.max(1, this.state.stats.reloadMs),
            abilityStatus: () => {
                if (!SHIP_CLASSES[active.cls].ability.active) return { text: 'PASSIVE - ALWAYS ON', ready: true };
                if (ship.tailwindActive) return { text: `ACTIVE ${Math.ceil(ship.tailwindRemaining / 1000)}S`, ready: true };
                if (ship.tailwindReady) return { text: 'READY (Q OR CLICK)', ready: true };
                return { text: `RECHARGING ${Math.ceil(ship.tailwindRemaining / 1000)}S`, ready: false };
            }
        };
    }

    private useAbility(): void {
        const ship = this.ship;
        const active = this.state.active;
        if (!ship || !active || !ship.controlsEnabled) return;
        const ability = SHIP_CLASSES[active.cls].ability;
        if (!ability.active) return this.state.toast(`${ability.name} IS PASSIVE`);
        if (ship.triggerTailwind()) this.state.toast('TAILWIND!');
    }

    /** Fire a broadside if that side is loaded. side: -1 port, 1 starboard. */
    private fire(side: -1 | 1): void {
        const ship = this.ship;
        if (!ship || !this.state.seaworthy || !ship.tryFire(side)) return;
        const st = this.state.stats;
        this.cannons.fire(ship, side, Math.max(1, Math.ceil(st.cannons / 2)), st.cannonDamage);
    }

    private onPointer(p: Input.Pointer): void {
        if (!this.ready || !this.ship) return;
        const hud = this.scene.get(SceneKeys.Hud) as HudScene;
        if (hud?.isPointerOverUI?.(p)) return;
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        if (p.rightButtonDown()) {
            // Fire the broadside that faces the pointer.
            const s = this.ship;
            const right = (w.x - s.x) * Math.cos(s.heading) + (w.y - s.y) * Math.sin(s.heading);
            this.fire(right >= 0 ? 1 : -1);
        } else if (p.leftButtonDown()) this.ship.setTarget(w.x, w.y);
    }

    private onImpact(lost: number): void {
        if (lost < IMPACT_MIN || this.impactCooldown > 0 || !this.state.seaworthy) return;
        this.impactCooldown = 700;
        const dealt = this.state.damage((lost - IMPACT_MIN) * IMPACT_DAMAGE_PER_SPEED, 'impact');
        if (dealt > 0.5 && this.state.seaworthy) this.state.toast(`CRASH! -${Math.round(dealt)} HULL`);
        this.cameras.main.shake(160, 0.004);
    }

    // ---------------------------------------------------------- update loop

    update(_time: number, delta: number): void {
        if (!this.ready) return;
        this.clock += delta;
        this.impactCooldown = Math.max(0, this.impactCooldown - delta);
        const ship = this.ship;
        const cam = this.cameras.main;

        if (ship) {
            // Holding the mouse button keeps steering toward the pointer, even as the camera scrolls.
            const p = this.input.activePointer;
            if (p.isDown && p.leftButtonDown() && ship.target) {
                const w = cam.getWorldPoint(p.x, p.y);
                ship.setTarget(w.x, w.y);
            }
            if (Input.Keyboard.JustDown(this.keys.ability)) this.useAbility();
            if (Input.Keyboard.JustDown(this.keys.port)) this.fire(-1);
            if (Input.Keyboard.JustDown(this.keys.starboard)) this.fire(1);
            if (Input.Keyboard.JustDown(this.keys.formation)) {
                const next = FORMATIONS[(FORMATIONS.indexOf(this.state.formation) + 1) % FORMATIONS.length];
                this.state.setFormation(next);
                this.state.toast(`FORMATION: ${next.toUpperCase()}`);
            }
            ship.update(delta);

            const k = Math.min(1, delta / 400);
            this.lookAhead.x += (-ship.vx * 0.35 - this.lookAhead.x) * k;
            this.lookAhead.y += (-ship.vy * 0.35 - this.lookAhead.y) * k;
            cam.setFollowOffset(this.lookAhead.x, this.lookAhead.y);
            this.targetMarker.setVisible(!!ship.target);
            if (ship.target) this.targetMarker.setPosition(ship.target.x, ship.target.y).setAlpha(0.6 + 0.4 * Math.sin(this.clock / 150));
        }

        this.ocean.update(delta);
        this.terrain.update(delta);
        this.life.update(delta);
        for (const port of this.ports) port.update(delta);
        const alive = ship && this.state.seaworthy ? ship : null;
        this.director.update(delta, alive);
        this.combat.update(delta);
        this.cannons.update(delta);
        this.collectibles.update(delta, alive);
        this.wrecks.update(delta);
        this.population.update(delta, alive, cam.worldView);
        this.mermaids.update(delta, alive, cam.worldView);
        if (alive) {
            this.updateInteractions(delta);
            this.updateHazards(delta);
            this.updateDiscovery(delta);
            this.updateRegion(delta);
        }
        this.updateAtmosphere(delta);
    }

    private updateRegion(delta: number): void {
        this.regionTimer -= delta;
        if (this.regionTimer > 0 || !this.ship) return;
        this.regionTimer = 500;
        const r = regionAt(this.ship.x, this.ship.y);
        if (r === this.region) return;
        this.region = r;
        this.state.enterRegion(r);
    }

    /** Blend water tint and haze toward the current region's look. */
    private updateAtmosphere(delta: number): void {
        const def = REGIONS[this.region ?? 'tropical'];
        const t = Math.min(1, delta / 1500);
        this.tint.water = lerpColor(this.tint.water, def.waterTint, t);
        this.tint.hazeColor = lerpColor(this.tint.hazeColor, def.haze.color, t);
        this.tint.hazeAlpha += (def.haze.alpha - this.tint.hazeAlpha) * t;
        this.ocean.setTint(this.tint.water);
        this.haze.setFillStyle(this.tint.hazeColor, this.tint.hazeAlpha);
    }

    private updateHazards(delta: number): void {
        this.hazardTimer -= delta;
        if (this.hazardTimer > 0 || !this.ship) return;
        this.hazardTimer = 250;
        const { x, y } = this.ship;
        const inside = (h: Circle) => (h.x - x) ** 2 + (h.y - y) ** 2 < h.r * h.r;
        let msg = '';
        if (this.hazards.some(inside)) {
            this.state.damage(HAZARD_DPS * 0.25, 'hazard');
            msg = 'BOILING WATER! HULL BURNING';
        } else if (this.reefs.some(inside) && this.ship.speed > 8) {
            // Sharp reefs and siren rocks scrape the hull while you sail over them.
            this.state.damage(REEF_DPS * 0.25, 'hazard');
            msg = 'SCRAPING A REEF!';
        }
        if (msg && this.clock - this.lastHazardToast > 2500 && this.state.seaworthy) {
            this.lastHazardToast = this.clock;
            this.state.toast(msg);
        }
    }

    /**
     * One context action on E (or the HUD button): dock if inside a port's
     * radius, otherwise salvage a nearby wreck, otherwise open a shore chest.
     */
    private updateInteractions(delta: number): void {
        const ship = this.ship!;
        this.dockCooldown = Math.max(0, this.dockCooldown - delta);
        let action: typeof this.action = null;
        let prompt: string | null = null;
        if (ship.controlsEnabled) {
            const port = this.ports.find((p) => p.canDock(ship.x, ship.y));
            const wreck = !port ? this.wrecks.nearest(ship.x, ship.y) : null;
            const chest = !port && !wreck ? this.population.nearestChest(ship.x, ship.y) : null;
            if (port) {
                action = () => this.dock(port);
                prompt = `${port.layout.name}|DOCK AT PORT (E)`;
            } else if (wreck) {
                action = () => this.salvage(wreck);
                prompt = `${this.wrecks.nameOf(wreck)}|SALVAGE (E)`;
            } else if (chest) {
                action = () => this.state.toast(this.population.openChest(chest));
                prompt = `${chest.hidden ? 'HIDDEN ' : ''}${chest.rarity.toUpperCase()} CHEST ON THE SHORE|OPEN CHEST (E)`;
            }
        }
        this.action = action;
        if (prompt !== this.state.currentPrompt) this.state.prompt(prompt);
        if (action && this.dockCooldown === 0 && Input.Keyboard.JustDown(this.keys.dock)) action();
    }

    private salvage(wreck: Parameters<WreckSystem['salvage']>[0]): void {
        const ship = this.ship;
        if (!ship) return;
        ship.stop();
        ship.controlsEnabled = false;
        this.state.prompt(null);
        (this.scene.get(SceneKeys.Hud) as HudScene).showProgress?.(SALVAGE_MS);
        this.wrecks.salvage(wreck, (summary) => {
            this.state.toast(summary);
            if (this.ship === ship && this.state.seaworthy) ship.controlsEnabled = true;
        });
    }

    /** Where floating goods prefer to respawn: trade routes, wrecks and dangerous waters. */
    private spawnHint(): { x: number; y: number } | null {
        const r = Math.random();
        if (r < 0.4) {
            const ports = this.world.ports;
            const a = ports[Math.floor(Math.random() * ports.length)].dockEnd;
            const b = ports[Math.floor(Math.random() * ports.length)].dockEnd;
            const t = Math.random();
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        if (r < 0.7) {
            const spots = this.wrecks.activeSpots();
            return spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
        }
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * this.world.size;
            const y = Math.random() * this.world.size;
            if (REGIONS[regionAt(x, y)].danger >= 3) return { x, y };
        }
        return null;
    }

    private updateDiscovery(delta: number): void {
        this.discoverTimer -= delta;
        if (this.discoverTimer > 0 || !this.ship) return;
        this.discoverTimer = 250;
        const { x, y } = this.ship;
        for (const island of this.collision.islandsNear(x, y)) {
            if (island.near(x, y, DISCOVER_RANGE) && island.edge(x, y) < DISCOVER_RANGE) this.state.discoverIsland(island.id, island.name);
        }
    }

    // ------------------------------------------------------ ports & sinking

    private dock(port: PortSystem): void {
        if (!this.ship || !this.ship.controlsEnabled) return;
        this.ship.stop();
        this.ship.controlsEnabled = false;
        this.openPort(port, 'repair');
    }

    private openPort(port: PortSystem, tab: PortTab): void {
        this.lastPort = port;
        this.state.prompt(null);
        // Deliveries to this port complete on arrival; dry-dock timers settle.
        this.state.onDocked(port.layout.index);
        this.state.settleDryDock();
        const data: PortSceneData = { state: this.state, world: this.world, features: this.features, portName: port.layout.name, portIndex: port.layout.index, tab };
        this.scene.launch(SceneKeys.Port, data);
        this.scene.pause();
    }

    private onLeavePort(): void {
        this.input.keyboard?.resetKeys();
        this.dockCooldown = 600;
        const active = this.state.active;
        if (!active || !this.state.seaworthy) return;
        // Switched flagship, recovered a wreck, or bought a new one: launch it from this harbour.
        const port = this.lastPort ?? this.ports[0];
        if (!this.ship || this.shipId !== active.id) this.spawnShip(port);
        else this.ship.controlsEnabled = true;
        this.ship!.name = active.name;
        this.ship!.sprite.setDamageLevel(this.state.damageLevel);
        this.director.syncEscorts();
        this.director.onLeavePort(port.layout.index);
    }

    private onSunk(dropped: ItemType[], kept: number): void {
        const ship = this.ship;
        if (!ship) return;
        ship.stop();
        ship.controlsEnabled = false;
        this.combat.remove(ship);
        this.targetMarker.setVisible(false);
        this.state.prompt(null);
        this.state.toast(`YOUR ${SHIP_CLASSES[ship.cls].name} IS SINKING!`);
        const { x, y } = ship;
        // Cargo spills out as the hull breaks up; anyone can collect it.
        this.time.delayedCall(700, () => dropped.length && this.collectibles.spawnLoot(dropped, x, y));
        ship.sprite.sink(() => {
            if (kept > 0) this.state.toast(`SECURE SAVED ${kept} CARGO`);
            this.time.delayedCall(1300, () => this.rescue(x, y));
        });
    }

    /** After a sinking the crew rows to the nearest port, where the ship can be recovered. */
    private rescue(x: number, y: number): void {
        const nearest = this.ports.reduce((a, b) => (a.distanceToDock(x, y) <= b.distanceToDock(x, y) ? a : b));
        const cam = this.cameras.main;
        cam.fadeOut(500, 6, 24, 43);
        cam.once('camerafadeoutcomplete', () => {
            this.ship?.sprite.destroy();
            this.ship = null;
            this.shipId = null;
            this.director.flagship = null;
            // Escorts return to port with the captain (they stay assigned as escorts).
            this.director.removeEscorts();
            cam.stopFollow();
            cam.centerOn(nearest.layout.dockEnd.x, nearest.layout.dockEnd.y);
            cam.fadeIn(400, 6, 24, 43);
            this.state.toast(`YOUR CREW ROWED TO ${nearest.layout.name}`);
            this.time.delayedCall(500, () => this.openPort(nearest, 'repair'));
        });
    }

    private returnToMenu(): void {
        if (this.leaving) return;
        this.leaving = true;
        this.cameras.main.fadeOut(300, 6, 24, 43);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SceneKeys.Menu));
    }
}
