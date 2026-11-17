import { Math as PMath, Scene } from 'phaser';
import { CannonSystem } from '../combat/CannonSystem';
import { Combatant, CombatWorld } from '../combat/Combatant';
import { AnyCreature, Kraken, Serpent, Shark } from '../creatures/Creatures';
import { CollectibleSystem, Pickup } from '../entities/CollectibleSystem';
import { CombatTextures } from '../gfx/combatTextures';
import { randomShipName } from '../ships/profile';
import { emptyUpgrades, ShipClassId, UpgradeLevels } from '../ships/shipClasses';
import { ItemType } from '../state/items';
import { PlayerState } from '../state/PlayerState';
import { XP } from '../state/progression';
import { CollisionWorld } from '../world/CollisionWorld';
import { REGIONS, RegionId, regionAt } from '../world/regions';
import { Circle, WorldData } from '../world/WorldGenerator';
import { Depth } from '../world/worldConfig';
import { NpcContext, NpcRole, NpcShip, NpcSpec } from './NpcShip';
import type { WreckSystem } from '../entities/WreckSystem';
import type { IslandPopulation } from '../world/IslandPopulation';

/** Materials salvaged from each kind of ship's hull and stores. */
const MATERIAL_DROPS: Partial<Record<NpcRole, ItemType[]>> = {
    merchant: ['cloth', 'cloth', 'wood'],
    explorer: ['wood', 'cloth'],
    hunter: ['wood'],
    pirate: ['iron', 'wood'],
    captain: ['iron', 'iron', 'wood', 'cloth'],
    ghost: ['iron', 'cloth']
};

/** NPCs further than this from the player are removed (escorts excepted). */
const DESPAWN_RANGE = 3200;
/** Only NPCs within this range run their AI. */
const ACTIVE_RANGE = 2400;
const MAX_NPCS = 14;
const MAX_CREATURES = 5;

export interface MapMarker {
    x: number;
    y: number;
    color: number;
    /** Big markers are objectives; small ones are nearby ships. */
    big?: boolean;
}

interface WorldEvent {
    id: string;
    kind: 'flotilla' | 'convoy' | 'raid' | 'wreck' | 'captain';
    x: number;
    y: number;
    until: number;
    npcs: NpcShip[];
    rewarded: boolean;
}

const PIRATE_PREFIX = ['BLACK', 'BLOOD', 'GRIM', 'RUSTY', 'SALTY', 'SCARLET', 'BONE', 'STORM', 'ROTTEN', 'CUTTHROAT'];
const PIRATE_SUFFIX = ['RAIDER', 'REAVER', 'CUTLASS', 'MARAUDER', 'JACKAL', 'VULTURE', 'SHARKTOOTH', 'BUCCANEER'];
const CAPTAINS = ['IRONBEARD', 'MAD MOLLY', 'ONE-EYED SILAS', 'BLACKWATER BESS', 'RED REGINALD', 'GALLOWS GREER', 'CAPTAIN CINDER', 'SALTFANG'];
const GHOSTS = ['DROWNED', 'HOLLOW', 'WEEPING', 'PALE', 'SUNKEN'];
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/**
 * Runs everything that lives in the ocean around the player: NPC ship
 * population per region, sea creatures, escorts, mission actors and world
 * events. Kept lightweight: only nearby actors think, distant ones vanish.
 */
export class Director {
    readonly npcs: NpcShip[] = [];
    readonly creatures: AnyCreature[] = [];
    private readonly ctx: NpcContext;
    private readonly creatureCtx: { combat: CombatWorld; collision: CollisionWorld; player: Combatant | null };
    private popTimer = 1500;
    private eventTimer = 90000;
    private krakenCooldown = 0;
    private clock = 0;
    private readonly respawnBlock = new Map<RegionId, number>();
    private readonly missionSpawned = new Set<number>();
    event: WorldEvent | null = null;
    /** Optional systems missions can place things into. */
    wrecks: WreckSystem | null = null;
    population: IslandPopulation | null = null;
    private recentKills: number[] = [];
    flagship: Combatant | null = null;

    constructor(
        private readonly scene: Scene,
        private readonly world: WorldData,
        private readonly collision: CollisionWorld,
        private readonly combat: CombatWorld,
        cannons: CannonSystem,
        private readonly collectibles: CollectibleSystem,
        hazards: Circle[],
        private readonly state: PlayerState
    ) {
        this.ctx = {
            combat,
            cannons,
            collision,
            collectibles,
            world,
            hazards,
            player: null,
            formationSlot: (npc) => this.formationSlot(npc)
        };
        this.creatureCtx = { combat, collision, player: null };
        collectibles.onTaggedPickup = (tag) => this.onTaggedPickup(tag);
    }

    // ------------------------------------------------------------- spawning

    spawn(spec: NpcSpec): NpcShip {
        const npc = new NpcShip(this.scene, this.collision, this.world.size, spec);
        npc.onSunk = (n, killer) => this.onNpcSunk(n, killer);
        if (npc.owned) {
            npc.onDamaged = (n) => {
                this.state.setEscortHp(n.owned!, n.hp);
                if (n.hp > 0) this.state.commit();
            };
        }
        // Merchants and hunters carry something worth taking.
        if (spec.role === 'merchant') npc.cargo = Array.from({ length: PMath.Between(2, 4) }, () => pick<ItemType>(['barrel', 'crate', 'crate', 'supplies', 'chest']));
        if (spec.role === 'captain' || spec.role === 'ghost') npc.cargo = ['chest', 'chest'];
        if (spec.role === 'pirate' && Math.random() < 0.6) npc.cargo = [pick<ItemType>(['barrel', 'crate', 'chest'])];
        this.npcs.push(npc);
        this.combat.add(npc);
        return npc;
    }

    /** A random open-water point 800-1500 units from (x,y), outside the camera view. */
    private spawnPoint(x: number, y: number, region?: RegionId): { x: number; y: number } | null {
        const view = this.scene.cameras.main.worldView;
        for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 800 + Math.random() * 700;
            const px = x + Math.cos(a) * d;
            const py = y + Math.sin(a) * d;
            if (view.contains(px, py)) continue;
            if (!this.collision.isOpenWater(px, py, 90)) continue;
            if (region && regionAt(px, py) !== region) continue;
            return { x: px, y: py };
        }
        return null;
    }

    private pirateSpec(region: RegionId, at: { x: number; y: number }, forceCaptain = false): NpcSpec {
        const def = REGIONS[region];
        const captain = forceCaptain || Math.random() < def.captainChance;
        const lvl = Math.min(4, def.pirateUpgrade + (captain ? 1 : 0));
        const up: UpgradeLevels = { ...emptyUpgrades(), hull: lvl, cannons: lvl, sails: Math.min(2, lvl), rudder: lvl, cargo: 0, harpoons: 0 };
        const cls: ShipClassId = captain ? pick<ShipClassId>(['brigantine', 'corsair', 'galleon']) : pick(def.pirateClasses);
        return {
            role: captain ? 'captain' : 'pirate',
            cls,
            upgrades: up,
            name: captain ? `CAPT. ${pick(CAPTAINS)}` : `${pick(PIRATE_PREFIX)} ${pick(PIRATE_SUFFIX)}`,
            ...at
        };
    }

    private populate(player: Combatant): void {
        const region = regionAt(player.x, player.y);
        const def = REGIONS[region];
        const near = this.npcs.filter((n) => n.alive && n.role !== 'escort' && Math.hypot(n.x - player.x, n.y - player.y) < DESPAWN_RANGE);
        if (this.npcs.filter((n) => n.alive).length >= MAX_NPCS) return;
        const count = (role: NpcRole) => near.filter((n) => n.role === role || (role === 'pirate' && n.role === 'captain')).length;
        const want: [NpcRole, number][] = [
            ['pirate', def.population.pirate],
            ['merchant', def.population.merchant],
            ['explorer', def.population.explorer],
            ['hunter', def.population.hunter],
            ['ghost', def.population.ghost]
        ];
        for (const [role, n] of want) {
            if (count(role) >= n) continue;
            if (role === 'pirate' && (this.respawnBlock.get(region) ?? 0) > this.clock) continue;
            const at = this.spawnPoint(player.x, player.y, region) ?? this.spawnPoint(player.x, player.y);
            if (!at) continue;
            if (role === 'pirate') this.spawn(this.pirateSpec(region, at));
            else if (role === 'ghost') this.spawn({ role, cls: pick<ShipClassId>(['brigantine', 'galleon']), upgrades: { ...emptyUpgrades(), hull: 2, cannons: 2 }, name: `THE ${pick(GHOSTS)} ${pick(['WIDOW', 'MARINER', 'LANTERN', 'BRIDE'])}`, ...at });
            else if (role === 'merchant') this.spawn({ role, cls: pick<ShipClassId>(['galleon', 'galleon', 'sloop']), name: randomShipName(), toPort: Math.floor(Math.random() * this.world.ports.length), ...at });
            else this.spawn({ role, cls: 'sloop', name: randomShipName(), ...at });
            return; // one spawn per tick keeps arrivals gradual
        }
    }

    private populateCreatures(player: Combatant): void {
        const region = regionAt(player.x, player.y);
        const def = REGIONS[region].creatures;
        const live = this.creatures.filter((c) => c.alive);
        if (live.length >= MAX_CREATURES) return;
        const sharks = live.filter((c) => c.role === 'shark').length;
        const serpents = live.filter((c) => c.role === 'serpent').length;
        // Encounters are uncommon: a roll each population tick.
        if (sharks < def.shark && Math.random() < 0.35) {
            const at = this.spawnPoint(player.x, player.y, region);
            if (at) this.addCreature(new Shark(this.scene, at.x, at.y));
        } else if (serpents < def.serpent && Math.random() < 0.12) {
            const at = this.spawnPoint(player.x, player.y, region);
            if (at) this.addCreature(new Serpent(this.scene, at.x, at.y));
        }
        // The Kraken: rare, The Deep only (more likely with a Kraken mission).
        const hunting = this.state.missions.some((m) => m.creature === 'kraken');
        if (def.kraken && !live.some((c) => c.role === 'kraken') && this.clock > this.krakenCooldown && Math.random() < (hunting ? 0.25 : 0.02)) {
            const a = player.heading;
            const at = { x: player.x + Math.sin(a) * 330, y: player.y - Math.cos(a) * 330 };
            if (this.collision.isOpenWater(at.x, at.y, 120)) {
                this.addCreature(new Kraken(this.scene, at.x, at.y));
                this.krakenCooldown = this.clock + 8 * 60 * 1000;
                this.state.toast('THE KRAKEN RISES!');
            }
        }
    }

    addCreature(c: AnyCreature): void {
        c.onKilled = (cr, killer) => this.onCreatureKilled(cr as AnyCreature, killer);
        this.creatures.push(c);
        this.combat.add(c);
        if (c instanceof Kraken) c.proxies.forEach((p) => this.combat.add(p));
    }

    // ----------------------------------------------------------- rewards

    private byPlayer(killer: Combatant | null): boolean {
        return !!killer && killer.faction === 'player';
    }

    private coinPiles(total: number, x: number, y: number, tag?: string): void {
        const piles = Math.max(1, Math.min(6, Math.round(total / 30)));
        this.collectibles.spawnLoot(Array<Pickup>(piles).fill('coins'), x, y, { coinValue: Math.round(total / piles), spread: 40, tag });
    }

    private onNpcSunk(npc: NpcShip, killer: Combatant | null): void {
        const region = regionAt(npc.x, npc.y);
        const danger = REGIONS[region].danger;
        if (npc.owned) {
            const dropped = this.state.escortSunk(npc.owned);
            this.collectibles.spawnLoot(dropped, npc.x, npc.y);
            return;
        }
        // Salvage: the ship's cargo plus materials from its hull, scaled down if
        // the player has been sinking ships in quick succession (no farming).
        const factor = this.lootFactor();
        const mats = MATERIAL_DROPS[npc.role] ?? [];
        const extra = mats.filter(() => Math.random() < factor);
        if (npc.cls === 'galleon' || npc.cls === 'corsair') extra.push('wood');
        this.collectibles.spawnLoot([...npc.cargo, ...extra], npc.x, npc.y, { delayMs: 1200, spread: 45 });
        const bounty: Record<string, number> = { pirate: 45, captain: 260, ghost: 150, merchant: 70, explorer: 25, hunter: 30 };
        this.coinPiles((bounty[npc.role] ?? 20) * (0.7 + danger * 0.3) * factor, npc.x, npc.y);
        if (npc.missionId !== undefined) this.state.failMission(npc.missionId, 'THE MERCHANT YOU ESCORTED WAS SUNK');
        this.onMissionShipSunk(npc);
        if (this.byPlayer(killer)) this.recentKills.push(this.clock);
        if (npc.role === 'pirate' || npc.role === 'captain') this.respawnBlock.set(region, this.clock + 40000);
        if (this.byPlayer(killer)) {
            this.state.recordKill(npc.role, region);
            const xp = XP.kill[npc.role] ?? 0;
            this.state.toast(xp ? `SUNK THE ${npc.name}! +${xp} XP` : `SUNK THE ${npc.name}`);
        }
        this.checkEventCleared();
    }

    private onCreatureKilled(c: AnyCreature, killer: Combatant | null): void {
        const region = regionAt(c.x, c.y);
        const gold: Record<string, number> = { shark: 15, serpent: 160, kraken: 900 };
        this.coinPiles(gold[c.role], c.x, c.y);
        if (c.role === 'kraken') this.collectibles.spawnLoot(['chest', 'chest', 'chest'], c.x, c.y, { spread: 60 });
        if (this.byPlayer(killer)) {
            this.state.recordKill(c.role, region);
            this.state.toast(c.role === 'kraken' ? 'THE KRAKEN IS SLAIN!' : `${c.name} SLAIN! +${XP.kill[c.role]} XP`);
        }
    }

    // -------------------------------------------------------------- escorts

    /** Make the sailing escorts match the profile (deploy / recall / sunk). */
    syncEscorts(): void {
        const wanted = this.state.escorts;
        for (const npc of this.npcs.filter((n) => n.role === 'escort')) {
            if (!wanted.includes(npc.owned!) && npc.alive) this.remove(npc);
        }
        const flag = this.flagship;
        if (!flag) return;
        for (const ship of wanted) {
            if (this.npcs.some((n) => n.owned === ship && n.alive)) continue;
            const slot = this.slotFor(wanted.indexOf(ship), flag);
            const npc = this.spawn({ role: 'escort', cls: ship.cls, owned: ship, x: slot.x, y: slot.y, heading: flag.heading });
            npc.unstick();
        }
    }

    removeEscorts(): void {
        for (const npc of this.npcs.filter((n) => n.role === 'escort')) this.remove(npc);
    }

    private slotFor(index: number, flag: Combatant): { x: number; y: number } {
        const fx = Math.sin(flag.heading);
        const fy = -Math.cos(flag.heading);
        const rx = Math.cos(flag.heading);
        const ry = Math.sin(flag.heading);
        const k = index + 1;
        let back = 0;
        let side = 0;
        switch (this.state.formation) {
            case 'line':
                back = 90 * k;
                break;
            case 'wedge':
                back = 70 * Math.ceil(k / 2);
                side = (k % 2 ? -1 : 1) * 60 * Math.ceil(k / 2);
                break;
            case 'flank':
                back = 10;
                side = (k % 2 ? -1 : 1) * 75 * Math.ceil(k / 2);
                break;
        }
        return { x: flag.x - fx * back + rx * side, y: flag.y - fy * back + ry * side };
    }

    private formationSlot(npc: NpcShip): { x: number; y: number } | null {
        const flag = this.flagship;
        if (!flag || !flag.alive) return null;
        const escorts = this.npcs.filter((n) => n.role === 'escort' && n.alive);
        return this.slotFor(Math.max(0, escorts.indexOf(npc)), flag);
    }

    // ------------------------------------------------------------- missions

    /** Launch mission actors when leaving a port (escort merchants). */
    onLeavePort(portIndex: number): void {
        for (const m of this.state.missions) {
            if (m.kind !== 'escort' || m.issuer !== portIndex || this.missionSpawned.has(m.id)) continue;
            const s = this.world.ports[portIndex].spawn;
            const npc = this.spawn({ role: 'merchant', cls: 'galleon', name: `MERCHANT ${randomShipName()}`, x: s.x - 70, y: s.y, toPort: m.targetPort, missionId: m.id });
            npc.cargo = ['crate', 'crate', 'chest'];
            this.missionSpawned.add(m.id);
            this.state.toast('YOUR MERCHANT IS UNDER WAY - KEEP IT SAFE');
        }
    }

    /** 1.0 normally; drops toward 0.3 after many kills within 5 minutes. */
    private lootFactor(): number {
        this.recentKills = this.recentKills.filter((t) => this.clock - t < 5 * 60 * 1000);
        return Math.max(0.3, 1 - Math.max(0, this.recentKills.length - 3) * 0.12);
    }

    /** Mission-tagged ships (bounty, rescue, protect raiders) report their sinking. */
    private onMissionShipSunk(npc: NpcShip): void {
        if (!npc.tag?.startsWith('mission:')) return;
        const id = Number(npc.tag.slice(8));
        const m = this.state.missions.find((x) => x.id === id);
        if (!m) return;
        if (m.kind === 'rescue') {
            // The captive is thrown clear: pick them up from the water.
            this.collectibles.spawnLoot(['survivor'], npc.x, npc.y, { tag: `mission:${id}`, spread: 10, delayMs: 1500 });
            this.state.toast('A CAPTIVE IS IN THE WATER - PICK THEM UP!');
        } else this.state.missionEvent({ type: 'objective', missionId: id });
    }

    private tickMissions(player: Combatant): void {
        for (const m of this.state.missions) {
            const near = m.targetPos && Math.hypot(m.targetPos.x - player.x, m.targetPos.y - player.y) < 1500;
            if (!near || this.missionSpawned.has(m.id) || !m.targetPos) continue;
            const at = m.targetPos;
            const tag = `mission:${m.id}`;
            switch (m.kind) {
                case 'bounty':
                case 'rescue': {
                    this.missionSpawned.add(m.id);
                    const spec = this.pirateSpec(regionAt(at.x, at.y), this.spawnPoint(at.x, at.y) ?? at, true);
                    this.spawn({ ...spec, name: m.targetName ?? spec.name, tag });
                    this.state.toast(`${m.targetName ?? 'YOUR TARGET'} SIGHTED!`);
                    break;
                }
                case 'protect': {
                    this.missionSpawned.add(m.id);
                    const region = regionAt(at.x, at.y);
                    for (let i = 0; i < 3; i++) {
                        const p = this.spawnPoint(at.x, at.y) ?? at;
                        this.spawn({ ...this.pirateSpec(region, p), tag });
                    }
                    this.state.toast('RAIDERS ARE CLOSING ON THE VILLAGE!');
                    break;
                }
                case 'missing':
                    this.missionSpawned.add(m.id);
                    this.wrecks?.placeMissionWreck(m.id, at.x, at.y);
                    break;
                case 'lost': {
                    this.missionSpawned.add(m.id);
                    const isl = this.world.islands.find((i) => i.id === m.targetIsland);
                    if (isl && this.population && !this.population.missionChests.some((c) => c.id === `lost:${m.id}`)) {
                        this.population.missionChests.push({ id: `lost:${m.id}`, island: isl, x: at.x, y: at.y, rarity: 'legendary', hidden: true });
                    }
                    break;
                }
                case 'siren':
                    if (Math.hypot(at.x - player.x, at.y - player.y) < 260) {
                        this.missionSpawned.add(m.id);
                        this.state.missionEvent({ type: 'objective', missionId: m.id });
                        this.state.toast('YOU FOUND THE SIREN - AND RESISTED HER SONG');
                    }
                    break;
            }
        }
        for (const m of this.state.missions) {
            // Recover: place the marked treasure when the player gets close.
            if (m.kind === 'recover' && m.targetPos && !this.missionSpawned.has(m.id) && Math.hypot(m.targetPos.x - player.x, m.targetPos.y - player.y) < 1500) {
                this.missionSpawned.add(m.id);
                this.collectibles.spawnLoot(['chest'], m.targetPos.x, m.targetPos.y, { tag: `mission:${m.id}`, spread: 4 });
                this.coinPiles(40, m.targetPos.x, m.targetPos.y);
            }
        }
        // Escorted merchants that reach their destination complete the mission.
        for (const npc of this.npcs) {
            if (npc.missionId === undefined || !npc.alive || npc.toPort === undefined) continue;
            const dest = this.world.ports[npc.toPort].spawn;
            if (Math.hypot(dest.x - npc.x, dest.y - npc.y) < 160) {
                this.state.missionEvent({ type: 'escortArrived', missionId: npc.missionId });
                this.remove(npc);
            }
        }
    }

    private onTaggedPickup(tag: string): void {
        if (tag.startsWith('mission:')) {
            const id = Number(tag.slice(8));
            const m = this.state.missions.find((x) => x.id === id);
            if (m?.kind === 'rescue') this.state.toast('CITIZEN RESCUED! BRING THEM HOME');
            this.state.missionEvent(m?.kind === 'recover' ? { type: 'pickup', missionId: id } : { type: 'objective', missionId: id });
        }
        if (this.event && tag === this.event.id) this.checkEventCleared();
    }

    // ---------------------------------------------------------- world events

    private startEvent(player: Combatant): void {
        const region = regionAt(player.x, player.y);
        const at = this.spawnPoint(player.x, player.y);
        if (!at) return;
        const kinds: WorldEvent['kind'][] = ['flotilla', 'wreck', 'convoy', 'raid'];
        if (REGIONS[region].danger >= 3) kinds.push('captain', 'captain');
        const kind = pick(kinds);
        const ev: WorldEvent = { id: `event:${Math.floor(this.clock)}`, kind, x: at.x, y: at.y, until: this.clock + 5 * 60 * 1000, npcs: [], rewarded: false };
        const coin = REGIONS[region].coinValue[1];
        switch (kind) {
            case 'flotilla':
                this.collectibles.spawnLoot(['chest', 'chest', 'coins', 'coins', 'coins', 'barrel', 'crate', 'coins'], at.x, at.y, { tag: ev.id, coinValue: coin, spread: 110, delayMs: 300 });
                this.state.toast('A TREASURE FLOTILLA HAS BEEN SPOTTED!');
                break;
            case 'wreck': {
                const img = this.scene.add.image(at.x, at.y, CombatTextures.Wreck).setScale(2).setDepth(Depth.Seabed + 2).setRotation(Math.random() * 6);
                this.scene.time.delayedCall(5 * 60 * 1000, () => img.destroy());
                this.collectibles.spawnLoot(['chest', 'coins', 'coins', 'crate', 'barrel'], at.x, at.y, { tag: ev.id, coinValue: coin * 1.5, spread: 70, delayMs: 300 });
                this.state.toast('A SHIPWRECK HAS BEEN SIGHTED!');
                break;
            }
            case 'convoy':
                for (let i = 0; i < 3; i++) {
                    ev.npcs.push(this.spawn({ role: 'merchant', cls: i ? 'sloop' : 'galleon', name: `CONVOY ${randomShipName()}`, x: at.x + i * 70, y: at.y + i * 40, toPort: Math.floor(Math.random() * 5) }));
                }
                this.state.toast('A MERCHANT CONVOY IS PASSING THROUGH');
                break;
            case 'raid':
                for (let i = 0; i < 3; i++) ev.npcs.push(this.spawn(this.pirateSpec(region, { x: at.x + i * 80, y: at.y - i * 50 })));
                this.state.toast('PIRATE RAID! THREE SHIPS INBOUND');
                break;
            case 'captain':
                ev.npcs.push(this.spawn(this.pirateSpec(region, at, true)));
                this.state.toast(`${ev.npcs[0].name} HAS APPEARED!`);
                break;
        }
        this.event = ev;
    }

    /** Award the event bonus once its treasure is gone or its fighters are sunk. */
    private checkEventCleared(): void {
        const ev = this.event;
        if (!ev || ev.rewarded) return;
        let cleared = false;
        if (ev.kind === 'flotilla' || ev.kind === 'wreck') cleared = this.collectibles.countTagged(ev.id) === 0;
        if (ev.kind === 'raid' || ev.kind === 'captain') cleared = ev.npcs.every((n) => !n.alive);
        if (!cleared) return;
        ev.rewarded = true;
        this.state.addXp(XP.eventBonus, 'WORLD EVENT COMPLETE');
        this.event = null;
    }

    // ---------------------------------------------------------------- update

    update(deltaMs: number, player: Combatant | null): void {
        this.clock += deltaMs;
        this.ctx.player = player;
        this.creatureCtx.player = player;

        if (player) {
            this.popTimer -= deltaMs;
            if (this.popTimer <= 0) {
                this.popTimer = 2000;
                this.populate(player);
                this.populateCreatures(player);
                this.tickMissions(player);
            }
            this.eventTimer -= deltaMs;
            if (this.eventTimer <= 0) {
                this.eventTimer = 150000 + Math.random() * 120000;
                if (!this.event) this.startEvent(player);
            }
        }
        if (this.event && this.clock > this.event.until) {
            this.collectibles.removeTagged(this.event.id);
            this.event = null;
        }

        const ref = player ?? this.flagship;
        for (const npc of [...this.npcs]) {
            if (npc.gone) {
                this.remove(npc);
                continue;
            }
            const d = ref ? Math.hypot(npc.x - ref.x, npc.y - ref.y) : 0;
            if (npc.role !== 'escort' && npc.missionId === undefined && d > DESPAWN_RANGE) {
                this.remove(npc);
                continue;
            }
            if (npc.role === 'escort' || d < ACTIVE_RANGE) npc.update(deltaMs, this.ctx);
        }
        for (const c of [...this.creatures]) {
            if (c.gone || (ref && Math.hypot(c.x - ref.x, c.y - ref.y) > DESPAWN_RANGE)) {
                this.removeCreature(c);
                continue;
            }
            c.update(deltaMs, this.creatureCtx);
        }
    }

    remove(npc: NpcShip): void {
        this.combat.remove(npc);
        npc.destroy();
        const i = this.npcs.indexOf(npc);
        if (i >= 0) this.npcs.splice(i, 1);
    }

    private removeCreature(c: AnyCreature): void {
        this.combat.remove(c);
        if (c instanceof Kraken) c.proxies.forEach((p) => this.combat.remove(p));
        c.destroy();
        const i = this.creatures.indexOf(c);
        if (i >= 0) this.creatures.splice(i, 1);
    }

    // ---------------------------------------------------------------- views

    /** Markers for the chart: objectives (big) and nearby ships (small). */
    markers(): MapMarker[] {
        const out: MapMarker[] = [];
        for (const m of this.state.missions) {
            if ((m.kind === 'deliver' || m.kind === 'escort') && m.targetPort !== undefined) {
                const p = this.world.ports[m.targetPort].dockEnd;
                out.push({ x: p.x, y: p.y, color: 0x8fe07a, big: true });
            } else if (m.targetPos) out.push({ ...m.targetPos, color: 0x8fe07a, big: true });
        }
        if (this.event) out.push({ x: this.event.x, y: this.event.y, color: 0xd070ff, big: true });
        for (const n of this.npcs) {
            if (!n.alive) continue;
            const color = n.faction === 'pirate' ? 0xff4a3a : n.faction === 'monster' ? 0xb06ad8 : n.faction === 'player' ? 0x8fe07a : 0xfdf3d6;
            out.push({ x: n.x, y: n.y, color });
        }
        for (const c of this.creatures) if (c.alive) out.push({ x: c.x, y: c.y, color: 0xb06ad8 });
        return out;
    }

    /** The biggest threat nearby, for the boss health bar. */
    boss(player: Combatant | null): { name: string; ratio: number } | null {
        if (!player) return null;
        const near = (c: Combatant) => c.alive && Math.hypot(c.x - player.x, c.y - player.y) < 700;
        const k = this.creatures.find((c) => c.role === 'kraken' && near(c));
        if (k) return { name: k.name, ratio: k.hpRatio };
        const cap = this.npcs.find((n) => n.role === 'captain' && near(n));
        return cap ? { name: cap.name, ratio: cap.hpRatio } : null;
    }

    destroy(): void {
        for (const n of [...this.npcs]) this.remove(n);
        for (const c of [...this.creatures]) this.removeCreature(c);
        this.event = null;
    }
}
