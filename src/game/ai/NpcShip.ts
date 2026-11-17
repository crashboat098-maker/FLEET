import { GameObjects, Scene } from 'phaser';
import { CannonSystem, CANNON_RANGE } from '../combat/CannonSystem';
import { Combatant, CombatWorld, Faction, newUid } from '../combat/Combatant';
import { CollectibleSystem } from '../entities/CollectibleSystem';
import { ShipBody } from '../entities/ShipBody';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { OwnedShip } from '../ships/profile';
import { computeStats, emptyUpgrades, ShipClassId, ShipStats, UpgradeLevels } from '../ships/shipClasses';
import { ItemType } from '../state/items';
import { damageLevelOf, DamageSource } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { Circle, WorldData } from '../world/WorldGenerator';
import { Depth } from '../world/worldConfig';

export type NpcRole = 'merchant' | 'explorer' | 'hunter' | 'pirate' | 'captain' | 'ghost' | 'escort';

export interface NpcContext {
    combat: CombatWorld;
    cannons: CannonSystem;
    collision: CollisionWorld;
    collectibles: CollectibleSystem;
    world: WorldData;
    hazards: Circle[];
    player: Combatant | null;
    /** Where an escort should hold station (null if no flagship). */
    formationSlot: (npc: NpcShip) => { x: number; y: number } | null;
}

export interface NpcSpec {
    role: NpcRole;
    cls: ShipClassId;
    x: number;
    y: number;
    heading?: number;
    upgrades?: UpgradeLevels;
    name?: string;
    /** For escorts: the player's owned ship this NPC represents. */
    owned?: OwnedShip;
    /** Mission this ship belongs to (escort missions). */
    missionId?: number;
    /** Merchants: destination port index. */
    toPort?: number;
    /** Event / bounty tag. */
    tag?: string;
}

const FACTION: Record<NpcRole, Faction> = {
    merchant: 'neutral',
    explorer: 'neutral',
    hunter: 'neutral',
    pirate: 'pirate',
    captain: 'pirate',
    ghost: 'monster',
    escort: 'player'
};

const LOOK: Record<NpcRole, { sail?: number; pennant?: number; ghost?: boolean }> = {
    merchant: { pennant: 0xf7c843 },
    explorer: { sail: 0xc8e4ff, pennant: 0x2a9fc0 },
    hunter: { sail: 0xd8f0c0, pennant: 0x4caf50 },
    pirate: { sail: 0x8a8494 },
    captain: { sail: 0xb04a4a },
    ghost: { ghost: true },
    escort: { pennant: 0xfdf3d6 }
};

/** Health fraction at which ships give up and run. */
const RETREAT_AT: Partial<Record<NpcRole, number>> = { pirate: 0.3, captain: 0.15, merchant: 1, explorer: 1, hunter: 1 };
const AGGRO: Partial<Record<NpcRole, number>> = { pirate: 620, captain: 900, ghost: 700, escort: 460 };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * An AI-controlled ship built on the shared sailing physics. Lightweight
 * behaviours: travel, wander, collect, chase, broadside, flee, follow.
 * Obstacle avoidance uses a fan of look-ahead feelers re-evaluated a few
 * times a second; a stuck detector reverses out of dead ends.
 */
export class NpcShip extends ShipBody implements Combatant {
    readonly uid = newUid();
    readonly faction: Faction;
    readonly kind = 'ship' as const;
    readonly role: NpcRole;
    readonly name: string;
    readonly stats: ShipStats;
    readonly owned?: OwnedShip;
    readonly missionId?: number;
    readonly tag?: string;
    hp: number;
    alive = true;
    /** Set once the sinking animation has finished. */
    gone = false;
    cargo: ItemType[] = [];
    toPort?: number;
    onSunk: ((npc: NpcShip, killer: Combatant | null) => void) | null = null;
    onDamaged: ((npc: NpcShip) => void) | null = null;

    private waypoint: { x: number; y: number } | null = null;
    private target: Combatant | null = null;
    private threat: Combatant | null = null;
    private threatUntil = 0;
    private clock = 0;
    private thinkTimer = 0;
    private avoidTimer = 0;
    private steerHeading = 0;
    private blocked = false;
    private reload = { port: 0, starboard: 0 };
    private stuck = { x: 0, y: 0, t: 0 };
    private unstickUntil = 0;
    private lastHit = -1e9;
    private readonly label: GameObjects.BitmapText;
    private readonly barBg: GameObjects.Rectangle;
    private readonly bar: GameObjects.Rectangle;

    constructor(scene: Scene, collision: CollisionWorld, worldSize: number, spec: NpcSpec) {
        const look = LOOK[spec.role];
        super(scene, collision, worldSize, spec.x, spec.y, spec.heading ?? Math.random() * Math.PI * 2, spec.cls, {
            wakeDepth: Depth.Wake,
            sailTint: look.sail,
            pennant: look.pennant,
            ghost: look.ghost
        });
        this.sprite.setDepth(Depth.Ship - 1);
        this.role = spec.role;
        this.faction = FACTION[spec.role];
        this.owned = spec.owned;
        this.missionId = spec.missionId;
        this.tag = spec.tag;
        this.toPort = spec.toPort;
        this.stats = computeStats(spec.cls, spec.owned?.upgrades ?? spec.upgrades ?? emptyUpgrades());
        this.hp = spec.owned ? spec.owned.hp : this.stats.maxHp;
        this.name = spec.owned?.name ?? spec.name ?? 'SHIP';
        this.steerHeading = this.heading;
        this.stuck = { x: this.x, y: this.y, t: 0 };

        const font = this.faction === 'pirate' || this.faction === 'monster' ? Fonts.Red : this.faction === 'player' ? Fonts.Green : Fonts.Cream;
        this.label = pixelText(scene, this.x, this.y, this.name, font).setDepth(Depth.WorldLabel).setVisible(false);
        this.barBg = scene.add.rectangle(0, 0, 34, 4, 0x06182b).setDepth(Depth.WorldLabel).setVisible(false);
        this.bar = scene.add.rectangle(0, 0, 32, 2, 0x8fe07a).setOrigin(0, 0.5).setDepth(Depth.WorldLabel).setVisible(false);
        this.sprite.setDamageLevel(damageLevelOf(this.hp, this.stats.maxHp));
    }

    get hpRatio(): number {
        return this.hp / this.stats.maxHp;
    }
    get creatureMult(): number {
        return this.stats.creatureMult;
    }

    // --------------------------------------------------------------- combat

    takeHit(damage: number, source: DamageSource, from: Combatant | null): void {
        if (!this.alive || damage <= 0) return;
        this.hp = Math.max(0, this.hp - damage * (1 - this.stats.armor));
        this.lastHit = this.clock;
        if (from && from.faction !== this.faction) {
            this.threat = from;
            this.threatUntil = this.clock + 9000;
            // Fighters turn on whoever shot them.
            if (this.role === 'pirate' || this.role === 'captain' || this.role === 'ghost' || this.role === 'escort') this.target = from;
        }
        this.sprite.setDamageLevel(damageLevelOf(this.hp, this.stats.maxHp));
        this.onDamaged?.(this);
        if (this.hp <= 0) {
            this.alive = false;
            this.stop();
            this.label.setVisible(false);
            this.barBg.setVisible(false);
            this.bar.setVisible(false);
            this.onSunk?.(this, from);
            this.sprite.sink(() => (this.gone = true));
        }
        void source;
    }

    private fire(side: -1 | 1, ctx: NpcContext): void {
        const key = side < 0 ? 'port' : 'starboard';
        if (this.clock < this.reload[key]) return;
        this.reload[key] = this.clock + this.stats.reloadMs * (0.9 + Math.random() * 0.4);
        ctx.cannons.fire(this, side, Math.ceil(this.stats.cannons / 2), this.stats.cannonDamage);
    }

    // ----------------------------------------------------------- navigation

    /** Is the water ahead along `angle` clear of land and hazards? */
    private clear(angle: number, ctx: NpcContext): boolean {
        const L = 70 + this.speed * 1.5 + this.halfLen;
        const fx = Math.sin(angle);
        const fy = -Math.cos(angle);
        for (const f of [0.45, 1]) {
            const px = this.x + fx * L * f;
            const py = this.y + fy * L * f;
            if (this.collision.coastDistance(px, py) < this.beam + 8) return false;
            if (ctx.hazards.some((h) => (h.x - px) ** 2 + (h.y - py) ** 2 < (h.r + 20) ** 2)) return false;
            // Give other hulls a wide berth (except the one being attacked).
            for (const c of ctx.combat.near(px, py, 30 + this.beam)) if (c !== this && c !== this.target && c.kind === 'ship') return false;
        }
        return true;
    }

    /** Steer toward (tx, ty) at a fraction of top speed, detouring around obstacles. */
    private navigate(tx: number, ty: number, speedFrac: number, deltaMs: number, ctx: NpcContext): void {
        const desired = Math.atan2(tx - this.x, -(ty - this.y));
        this.avoidTimer -= deltaMs;
        if (this.avoidTimer <= 0) {
            this.avoidTimer = 160;
            this.blocked = true;
            for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9]) {
                if (this.clear(desired + off, ctx)) {
                    this.steerHeading = desired + off;
                    this.blocked = false;
                    break;
                }
            }
        }
        this.steerTo(this.blocked ? this.heading + 1.5 : this.steerHeading, this.blocked ? 0.25 : speedFrac, deltaMs);
    }

    private steerTo(angle: number, speedFrac: number, deltaMs: number): void {
        const diff = wrap(angle - this.heading);
        const steer = Math.max(-1, Math.min(1, diff * 2));
        const throttle = Math.abs(diff) < 1 ? speedFrac : speedFrac * 0.4;
        const top = this.stats.maxSpeed * Math.max(0.3, speedFrac);
        if (this.clock < this.unstickUntil) this.drive(deltaMs, this.stats, -steer, 0, true, top);
        else this.drive(deltaMs, this.stats, steer, throttle, false, top);
    }

    private randomWaypoint(ctx: NpcContext, near?: { x: number; y: number }, radius = 1400): { x: number; y: number } {
        for (let i = 0; i < 30; i++) {
            const c = near ?? { x: this.x, y: this.y };
            const a = Math.random() * Math.PI * 2;
            const d = 300 + Math.random() * radius;
            const x = c.x + Math.cos(a) * d;
            const y = c.y + Math.sin(a) * d;
            if (this.collision.isOpenWater(x, y, 60) && !ctx.hazards.some((h) => Math.hypot(h.x - x, h.y - y) < h.r + 80)) return { x, y };
        }
        return { x: this.x + (Math.random() - 0.5) * 400, y: this.y + (Math.random() - 0.5) * 400 };
    }

    // ------------------------------------------------------------------ AI

    update(deltaMs: number, ctx: NpcContext): void {
        this.clock += deltaMs;
        if (!this.alive) return;
        this.thinkTimer -= deltaMs;
        const think = this.thinkTimer <= 0;
        if (think) this.thinkTimer = 300;

        // Stuck detector: barely moved in 3s while trying to sail.
        this.stuck.t += deltaMs;
        if (this.stuck.t > 3000) {
            if (Math.hypot(this.x - this.stuck.x, this.y - this.stuck.y) < 12 && this.clock > this.unstickUntil) {
                this.unstickUntil = this.clock + 1400;
                this.waypoint = null;
            }
            this.stuck = { x: this.x, y: this.y, t: 0 };
        }

        if (this.threat && (this.clock > this.threatUntil || !this.threat.alive)) this.threat = null;
        if (this.target && !this.target.alive) this.target = null;

        switch (this.role) {
            case 'merchant':
            case 'explorer':
            case 'hunter':
                this.peaceful(deltaMs, ctx, think);
                break;
            case 'escort':
                this.escort(deltaMs, ctx, think);
                break;
            default:
                this.hostile(deltaMs, ctx, think);
        }
        this.updateLabel(ctx);
    }

    private flee(from: Combatant, deltaMs: number, ctx: NpcContext): void {
        const a = Math.atan2(this.x - from.x, -(this.y - from.y));
        this.navigate(this.x + Math.sin(a) * 600, this.y - Math.cos(a) * 600, 1, deltaMs, ctx);
    }

    private peaceful(deltaMs: number, ctx: NpcContext, think: boolean): void {
        if (this.threat) return this.flee(this.threat, deltaMs, ctx);

        if (this.role === 'merchant' && this.toPort !== undefined) {
            const port = ctx.world.ports[this.toPort];
            const dest = port.spawn;
            if (Math.hypot(dest.x - this.x, dest.y - this.y) < 120) {
                // Escorted merchants wait at the destination for the mission to register arrival.
                if (this.missionId !== undefined) return this.steerTo(this.heading, 0, deltaMs);
                this.toPort = (this.toPort + 1 + Math.floor(Math.random() * (ctx.world.ports.length - 1))) % ctx.world.ports.length;
            } else return this.navigate(dest.x, dest.y, 0.85, deltaMs, ctx);
        }

        if (this.role === 'hunter' && think && this.cargo.length < this.stats.cargo) {
            const item = ctx.collectibles.nearestFor(this.x, this.y, 900);
            if (item) this.waypoint = { x: item.x, y: item.y };
        }
        if (this.role === 'hunter' && this.waypoint) {
            const got = ctx.collectibles.takeAt(this.x, this.y, this.halfLen + 12);
            if (got) {
                if (got !== 'coins' && got !== 'survivor') this.cargo.push(got);
                this.waypoint = null;
            }
        }

        if (!this.waypoint || Math.hypot(this.waypoint.x - this.x, this.waypoint.y - this.y) < 90) {
            // Explorers drift from island to island; others wander open water.
            if (this.role === 'explorer') {
                const isl = ctx.collision.islandsNear(this.x, this.y)[0] ?? ctx.world.islands[Math.floor(Math.random() * ctx.world.islands.length)];
                const a = Math.random() * Math.PI * 2;
                const c = isl.coastPoint(a);
                this.waypoint = this.randomWaypoint(ctx, { x: c.x + Math.cos(a) * 160, y: c.y + Math.sin(a) * 160 }, 200);
            } else this.waypoint = this.randomWaypoint(ctx);
        }
        this.navigate(this.waypoint.x, this.waypoint.y, this.role === 'explorer' ? 0.7 : 0.8, deltaMs, ctx);
    }

    private hostile(deltaMs: number, ctx: NpcContext, think: boolean): void {
        const retreat = RETREAT_AT[this.role];
        if (retreat !== undefined && this.hpRatio < retreat && (this.threat || this.target)) {
            return this.flee((this.threat ?? this.target)!, deltaMs, ctx);
        }
        if (think) {
            const aggro = AGGRO[this.role] ?? 600;
            if (this.target && Math.hypot(this.target.x - this.x, this.target.y - this.y) > aggro * 1.8) this.target = null;
            if (!this.target) {
                const p = ctx.player;
                // Pirates prefer easy prey: small or damaged ships draw them from further away.
                const weak = p && p.alive && (p.cls === 'sloop' || p.hpRatio < 0.5);
                const pd = p ? Math.hypot(p.x - this.x, p.y - this.y) : Infinity;
                if (p && p.alive && pd < aggro * (weak ? 1.3 : 1)) this.target = p;
                else this.target = ctx.combat.nearestHostile(this.x, this.y, aggro, this.faction, (c) => c.kind === 'ship');
            }
        }
        if (this.target) return this.engage(this.target, deltaMs, ctx);

        if (!this.waypoint || Math.hypot(this.waypoint.x - this.x, this.waypoint.y - this.y) < 90) this.waypoint = this.randomWaypoint(ctx);
        this.navigate(this.waypoint.x, this.waypoint.y, 0.6, deltaMs, ctx);
    }

    /** Close in, then turn to bring a broadside to bear and fire when lined up. */
    private engage(t: Combatant, deltaMs: number, ctx: NpcContext): void {
        const dx = t.x - this.x;
        const dy = t.y - this.y;
        const d = Math.hypot(dx, dy);
        const bearing = Math.atan2(dx, -dy);
        if (d > 230) {
            // Lead the target a little.
            return this.navigate(t.x + t.vx * 1.2, t.y + t.vy * 1.2, 1, deltaMs, ctx);
        }
        const rel = wrap(bearing - this.heading);
        const side: -1 | 1 = rel >= 0 ? 1 : -1;
        // Turn so the target sits abeam; edge closer or further to hold ~170 units.
        const drift = d > 190 ? 0.35 : d < 120 ? -0.35 : 0;
        const desired = bearing - side * (Math.PI / 2 - drift);
        if (!this.clear(desired, ctx)) this.navigate(t.x, t.y, 0.6, deltaMs, ctx);
        else this.steerTo(desired, 0.75, deltaMs);
        const abeam = Math.abs(wrap(rel - side * (Math.PI / 2)));
        if (abeam < 0.38 && d < CANNON_RANGE * 0.92) this.fire(side, ctx);
    }

    private escort(deltaMs: number, ctx: NpcContext, think: boolean): void {
        const slot = ctx.formationSlot(this);
        if (!slot) return this.steerTo(this.heading, 0, deltaMs);
        if (think) {
            if (this.target && Math.hypot(this.target.x - slot.x, this.target.y - slot.y) > 650) this.target = null;
            if (!this.target) this.target = ctx.combat.nearestHostile(slot.x, slot.y, AGGRO.escort!, 'player');
        }
        if (this.target && this.hpRatio > 0.2) return this.engage(this.target, deltaMs, ctx);

        const d = Math.hypot(slot.x - this.x, slot.y - this.y);
        // Fell far behind (e.g. after docking): rejoin the formation.
        if (d > 1600) {
            this.x = slot.x;
            this.y = slot.y;
            this.unstick();
            return;
        }
        const flag = ctx.player;
        const speedFrac = d < 40 ? 0.15 : d < 120 ? 0.6 : 1;
        if (d < 30 && flag) this.steerTo(flag.heading, Math.min(1, Math.hypot(flag.vx, flag.vy) / this.stats.maxSpeed), deltaMs);
        else this.navigate(slot.x, slot.y, speedFrac, deltaMs, ctx);
    }

    private updateLabel(ctx: NpcContext): void {
        const p = ctx.player;
        const near = !!p && Math.hypot(p.x - this.x, p.y - this.y) < 340;
        const recent = this.clock - this.lastHit < 6000;
        const y = this.y - this.halfLen - 14;
        this.label.setVisible(near).setPosition(this.x, y);
        const showBar = near && (recent || this.hp < this.stats.maxHp);
        this.barBg.setVisible(showBar).setPosition(this.x, y + 8);
        this.bar.setVisible(showBar).setPosition(this.x - 16, y + 8);
        this.bar.width = Math.max(0, 32 * this.hpRatio);
        this.bar.fillColor = this.hpRatio > 0.5 ? 0x8fe07a : this.hpRatio > 0.25 ? 0xf7c843 : 0xff6b5a;
    }

    destroy(): void {
        this.sprite.destroy();
        this.label.destroy();
        this.barBg.destroy();
        this.bar.destroy();
    }
}
