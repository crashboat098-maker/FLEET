import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Combatant, CombatWorld, Faction, hullDistance, isProtected, newUid } from '../combat/Combatant';
import { CombatTextures } from '../gfx/combatTextures';
import type { DamageSource } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { Depth } from '../world/worldConfig';

export interface CreatureContext {
    combat: CombatWorld;
    collision: CollisionWorld;
    player: Combatant | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const S = PIXEL_SCALE;

/** Shared base: a hittable, hostile animal with simple steering. */
abstract class Creature implements Combatant {
    readonly uid = newUid();
    readonly faction: Faction = 'monster';
    readonly kind = 'creature' as const;
    abstract readonly role: 'shark' | 'serpent' | 'kraken';
    abstract readonly name: string;
    x: number;
    y: number;
    heading = Math.random() * Math.PI * 2;
    vx = 0;
    vy = 0;
    alive = true;
    /** Death animation finished; safe to remove. */
    gone = false;
    hp: number;
    onKilled: ((c: Creature, killer: Combatant | null) => void) | null = null;
    protected clock = 0;
    protected target: Combatant | null = null;

    constructor(
        protected readonly scene: Scene,
        x: number,
        y: number,
        readonly maxHp: number,
        readonly halfLen: number,
        readonly beam: number
    ) {
        this.x = x;
        this.y = y;
        this.hp = maxHp;
    }

    get hpRatio(): number {
        return this.hp / this.maxHp;
    }

    takeHit(damage: number, _source: DamageSource, from: Combatant | null): void {
        if (!this.alive || damage <= 0 || isProtected(this)) return;
        this.hp -= damage;
        if (from && from.faction !== 'monster') this.target = from;
        this.flashHit();
        if (this.hp <= 0) {
            this.alive = false;
            this.onKilled?.(this, from);
            this.die();
        }
    }

    nudge(dx: number, dy: number): void {
        this.x += dx;
        this.y += dy;
    }

    /** Swim toward an angle at a speed, turning smoothly and avoiding land. */
    protected swim(angle: number, speed: number, turnRate: number, dt: number, collision: CollisionWorld): void {
        let desired = angle;
        const ahead = (a: number) => collision.coastDistance(this.x + Math.sin(a) * 50, this.y - Math.cos(a) * 50) > 12;
        if (!ahead(desired)) desired = ahead(desired + 1) ? desired + 1 : desired - 1;
        const diff = wrap(desired - this.heading);
        this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
        this.vx = Math.sin(this.heading) * speed;
        this.vy = -Math.cos(this.heading) * speed;
        const nx = this.x + this.vx * dt;
        const ny = this.y + this.vy * dt;
        if (collision.coastDistance(nx, ny) > 6) {
            this.x = nx;
            this.y = ny;
        } else this.heading += Math.PI * 0.5;
    }

    /** Nearest ship this creature wants to attack. */
    protected pickPrey(ctx: CreatureContext, range: number, choosy: boolean): Combatant | null {
        let best: Combatant | null = null;
        let bestD = range * range;
        for (const c of ctx.combat.near(this.x, this.y, range)) {
            if (c.kind !== 'ship' || c.faction === 'monster' || isProtected(c)) continue;
            // Sharks go for small or wounded hulls.
            if (choosy && c.cls !== 'sloop' && c.hpRatio >= 0.5) continue;
            const d = (c.x - this.x) ** 2 + (c.y - this.y) ** 2 * (c === ctx.player ? 0.7 : 1);
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        return best;
    }

    abstract update(deltaMs: number, ctx: CreatureContext): void;
    protected abstract flashHit(): void;
    protected abstract die(): void;
    abstract destroy(): void;
}

// --------------------------------------------------------------------- shark

export class Shark extends Creature {
    readonly role = 'shark' as const;
    readonly name = 'SHARK';
    private readonly fin: GameObjects.Image;
    private readonly body: GameObjects.Image;
    private mode: 'roam' | 'stalk' | 'dash' | 'flee' = 'roam';
    private modeUntil = 0;
    private biteReady = 0;
    private orbit = Math.random() < 0.5 ? 1 : -1;
    private home: { x: number; y: number };

    constructor(scene: Scene, x: number, y: number) {
        super(scene, x, y, 30, 12, 6);
        this.home = { x, y };
        this.body = scene.add.image(x, y, CombatTextures.SharkShadow).setScale(S).setDepth(Depth.Seabed + 1);
        this.fin = scene.add.image(x, y, CombatTextures.SharkFin).setScale(S).setDepth(Depth.Collectible + 1);
    }

    update(deltaMs: number, ctx: CreatureContext): void {
        if (!this.alive) return;
        const dt = deltaMs / 1000;
        this.clock += deltaMs;
        if (this.hpRatio < 0.35 && this.mode !== 'flee') {
            this.mode = 'flee';
            this.modeUntil = this.clock + 4000;
        }
        if (this.clock % 600 < deltaMs && this.mode === 'roam') this.target = this.pickPrey(ctx, 420, true);
        const t = this.target && this.target.alive && !isProtected(this.target) ? this.target : null;

        if (this.mode === 'flee') {
            const a = t ? Math.atan2(this.x - t.x, -(this.y - t.y)) : this.heading;
            this.swim(a, 90, 3, dt, ctx.collision);
            this.fin.setAlpha(Math.max(0, (this.modeUntil - this.clock) / 4000));
            if (this.clock > this.modeUntil) {
                // Dived away for good.
                this.alive = false;
                this.gone = true;
            }
        } else if (!t) {
            this.mode = 'roam';
            const a = Math.atan2(this.home.x - this.x, -(this.home.y - this.y)) + Math.sin(this.clock / 1800) * 1.4;
            this.swim(a, 28, 1.5, dt, ctx.collision);
        } else {
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const bearing = Math.atan2(dx, -dy);
            if (this.mode === 'roam') {
                this.mode = 'stalk';
                this.modeUntil = this.clock + 2200 + Math.random() * 2000;
            }
            if (this.mode === 'stalk') {
                // Circle the ship before darting in.
                const d = Math.hypot(dx, dy);
                const a = bearing + this.orbit * (Math.PI / 2 - (d > 110 ? 0.6 : 0));
                this.swim(a, 55, 2.5, dt, ctx.collision);
                if (this.clock > this.modeUntil) this.mode = 'dash';
            } else {
                this.swim(bearing, 100, 4, dt, ctx.collision);
                if (hullDistance(t, this.x, this.y) < t.beam + 8 && this.clock > this.biteReady) {
                    t.takeHit(5, 'creature', this);
                    this.biteReady = this.clock + 1800;
                    this.mode = 'stalk';
                    this.modeUntil = this.clock + 1800 + Math.random() * 1500;
                }
                if (Math.hypot(dx, dy) > 500) this.target = null;
            }
        }
        this.body.setPosition(this.x, this.y).setRotation(this.heading - Math.PI / 2);
        this.fin.setPosition(this.x, this.y - 4);
    }

    protected flashHit(): void {
        this.fin.setTint(0xff6b5a);
        this.scene.time.delayedCall(120, () => this.fin.active && this.fin.clearTint());
    }

    protected die(): void {
        this.scene.tweens.add({ targets: [this.fin, this.body], alpha: 0, y: '+=6', duration: 900, onComplete: () => (this.gone = true) });
    }

    destroy(): void {
        this.fin.destroy();
        this.body.destroy();
    }
}

// ------------------------------------------------------------------- serpent

export class Serpent extends Creature {
    readonly role = 'serpent' as const;
    readonly name = 'SEA SERPENT';
    private readonly head: GameObjects.Image;
    private readonly segs: GameObjects.Image[] = [];
    private readonly trail: { x: number; y: number }[] = [];
    private biteReady = 0;

    constructor(scene: Scene, x: number, y: number) {
        super(scene, x, y, 170, 18, 9);
        for (let i = 0; i < 10; i++) {
            this.segs.push(scene.add.image(x, y, CombatTextures.SerpentSeg).setScale(S * (1 - i * 0.05)).setDepth(Depth.Ship - 2));
        }
        this.head = scene.add.image(x, y, CombatTextures.SerpentHead).setScale(S).setDepth(Depth.Ship - 1);
    }

    update(deltaMs: number, ctx: CreatureContext): void {
        if (!this.alive) return;
        const dt = deltaMs / 1000;
        this.clock += deltaMs;
        if (this.clock % 700 < deltaMs) {
            const prey = this.pickPrey(ctx, 520, false);
            if (prey && (!this.target || !this.target.alive)) this.target = prey;
        }
        const t = this.target && this.target.alive && !isProtected(this.target) ? this.target : null;
        const wiggle = Math.sin(this.clock / 260) * 0.5;
        if (t) {
            const bearing = Math.atan2(t.x - this.x, -(t.y - this.y));
            this.swim(bearing + wiggle, 62, 2, dt, ctx.collision);
            if (hullDistance(t, this.x, this.y) < t.beam + 12 && this.clock > this.biteReady) {
                t.takeHit(12, 'creature', this);
                this.biteReady = this.clock + 2400;
            }
            if (Math.hypot(t.x - this.x, t.y - this.y) > 900) this.target = null;
        } else this.swim(this.heading + wiggle * 0.3, 30, 1, dt, ctx.collision);

        // Body segments follow the head's path.
        this.trail.unshift({ x: this.x, y: this.y });
        if (this.trail.length > 90) this.trail.pop();
        this.segs.forEach((s, i) => {
            const p = this.trail[Math.min(this.trail.length - 1, (i + 1) * 6)];
            s.setPosition(p.x, p.y);
        });
        this.head.setPosition(this.x, this.y).setRotation(this.heading);
    }

    protected flashHit(): void {
        this.head.setTint(0xff6b5a);
        this.scene.time.delayedCall(120, () => this.head.active && this.head.clearTint());
    }

    protected die(): void {
        this.scene.tweens.add({ targets: [this.head, ...this.segs], alpha: 0, scale: S * 0.6, duration: 1400, onComplete: () => (this.gone = true) });
    }

    destroy(): void {
        this.head.destroy();
        this.segs.forEach((s) => s.destroy());
    }
}

// -------------------------------------------------------------------- kraken

interface Tentacle {
    base: { x: number; y: number };
    segs: GameObjects.Image[];
    tip: GameObjects.Image;
    warn: GameObjects.Image;
    phase: 'idle' | 'windup' | 'slam' | 'hold';
    phaseUntil: number;
    aim: { x: number; y: number };
    reach: number;
    proxy: TentacleProxy;
}

/** Tentacles are separate hit targets that wound the Kraken itself. */
class TentacleProxy implements Combatant {
    readonly uid = newUid();
    readonly faction: Faction = 'monster';
    readonly kind = 'creature' as const;
    readonly role = 'kraken';
    readonly name = 'KRAKEN';
    x = 0;
    y = 0;
    heading = 0;
    vx = 0;
    vy = 0;
    readonly halfLen = 30;
    readonly beam = 9;
    constructor(private readonly kraken: Kraken) {}
    get alive() {
        return this.kraken.alive;
    }
    get hpRatio() {
        return this.kraken.hpRatio;
    }
    takeHit(d: number, s: DamageSource, f: Combatant | null) {
        this.kraken.takeHit(d * 0.6, s, f);
    }
    nudge() {}
}

export class Kraken extends Creature {
    readonly role = 'kraken' as const;
    readonly name = 'THE KRAKEN';
    private readonly head: GameObjects.Image;
    private readonly tentacles: Tentacle[] = [];
    readonly proxies: TentacleProxy[] = [];
    private emerge = 0;
    private combat: CombatWorld | null = null;

    constructor(scene: Scene, x: number, y: number) {
        super(scene, x, y, 700, 30, 34);
        this.head = scene.add.image(x, y, CombatTextures.KrakenHead).setScale(S * 0.2).setAlpha(0).setDepth(Depth.Ship - 2);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const base = { x: x + Math.cos(a) * 80, y: y + Math.sin(a) * 60 };
            const segs = Array.from({ length: 8 }, (_, k) =>
                scene.add.image(base.x, base.y, CombatTextures.KrakenSeg).setScale(S * (1 - k * 0.07)).setDepth(Depth.Ship - 1).setAlpha(0)
            );
            const tip = scene.add.image(base.x, base.y, CombatTextures.KrakenTip).setScale(S).setDepth(Depth.Ship - 1).setAlpha(0);
            const warn = scene.add.image(0, 0, 'fx-ring').setScale(S).setDepth(Depth.Wake).setAlpha(0).setTint(0xff6b5a);
            const proxy = new TentacleProxy(this);
            this.proxies.push(proxy);
            this.tentacles.push({ base, segs, tip, warn, phase: 'idle', phaseUntil: 1500 + i * 700, aim: { ...base }, reach: 0, proxy });
        }
    }

    update(deltaMs: number, ctx: CreatureContext): void {
        if (!this.alive) return;
        this.clock += deltaMs;
        const dt = deltaMs / 1000;
        // Rise from the depths.
        if (this.emerge < 1) {
            this.emerge = Math.min(1, this.emerge + dt / 2.5);
            this.head.setScale(S * (0.2 + 0.8 * this.emerge)).setAlpha(this.emerge);
        }
        const p = ctx.player && ctx.player.alive ? ctx.player : null;
        // Drift slowly toward the player if they back off.
        if (p && Math.hypot(p.x - this.x, p.y - this.y) > 260) this.swim(Math.atan2(p.x - this.x, -(p.y - this.y)), 14, 0.6, dt, ctx.collision);
        this.head.setPosition(this.x, this.y + Math.sin(this.clock / 500) * 2);

        this.tentacles.forEach((t, i) => {
            const a = (i / 6) * Math.PI * 2 + Math.sin(this.clock / 2000) * 0.2;
            t.base = { x: this.x + Math.cos(a) * 80, y: this.y + Math.sin(a) * 60 };
            const idle = { x: t.base.x + Math.cos(a) * 60 + Math.sin(this.clock / 400 + i) * 14, y: t.base.y + Math.sin(a) * 50 };
            let tip = idle;
            this.combat = ctx.combat;
            if (this.clock > t.phaseUntil) this.advance(t, p);
            if (t.phase === 'windup') tip = { x: t.base.x + (t.aim.x - t.base.x) * 0.2, y: t.base.y + (t.aim.y - t.base.y) * 0.2 - 20 };
            if (t.phase === 'slam' || t.phase === 'hold') tip = t.aim;
            t.warn.setPosition(t.aim.x, t.aim.y).setAlpha(t.phase === 'windup' ? 0.5 + 0.4 * Math.sin(this.clock / 60) : 0);
            // Lay segments along a bowed curve from base to tip.
            t.segs.forEach((s, k) => {
                const f = (k + 1) / (t.segs.length + 1);
                const bow = Math.sin(f * Math.PI) * 22 * Math.sin(this.clock / 300 + i);
                const nx = -(tip.y - t.base.y);
                const ny = tip.x - t.base.x;
                const len = Math.hypot(nx, ny) || 1;
                s.setPosition(t.base.x + (tip.x - t.base.x) * f + (nx / len) * bow, t.base.y + (tip.y - t.base.y) * f + (ny / len) * bow).setAlpha(this.emerge);
            });
            t.tip.setPosition(tip.x, tip.y).setAlpha(this.emerge);
            t.proxy.x = (t.base.x + tip.x) / 2;
            t.proxy.y = (t.base.y + tip.y) / 2;
            t.proxy.heading = Math.atan2(tip.x - t.base.x, -(tip.y - t.base.y));
        });
    }

    /** Idle → telegraphed windup (red ring) → slam (damage) → hold → idle. */
    private advance(t: Tentacle, p: Combatant | null): void {
        switch (t.phase) {
            case 'idle':
                if (p && Math.hypot(p.x - t.base.x, p.y - t.base.y) < 300) {
                    t.aim = { x: p.x + p.vx * 0.8, y: p.y + p.vy * 0.8 };
                    t.phase = 'windup';
                    t.phaseUntil = this.clock + 1100;
                } else t.phaseUntil = this.clock + 800;
                break;
            case 'windup':
                t.phase = 'slam';
                t.phaseUntil = this.clock + 200;
                break;
            case 'slam': {
                t.phase = 'hold';
                t.phaseUntil = this.clock + 700;
                // Every hull caught under the tentacle takes the blow.
                const combat = this.combat;
                const victims = combat ? combat.near(t.aim.x, t.aim.y, 120).filter((c) => c.kind === 'ship' && hullDistance(c, t.aim.x, t.aim.y) < c.beam + 30) : p ? [p] : [];
                victims.forEach((v) => v.takeHit(16, 'creature', this));
                const splash = this.scene.add.particles(t.aim.x, t.aim.y, 'fx-splash', { speed: { min: 20, max: 60 }, lifespan: 600, scale: { start: S, end: S * 1.6 }, alpha: { start: 0.9, end: 0 }, emitting: false });
                splash.setDepth(Depth.Ship + 1).explode(10);
                this.scene.time.delayedCall(900, () => splash.destroy());
                break;
            }
            default:
                t.phase = 'idle';
                t.phaseUntil = this.clock + 1200 + Math.random() * 1600;
        }
    }

    protected flashHit(): void {
        this.head.setTint(0xff6b5a);
        this.scene.time.delayedCall(120, () => this.head.active && this.head.clearTint());
    }

    protected die(): void {
        const all = [this.head, ...this.tentacles.flatMap((t) => [...t.segs, t.tip, t.warn])];
        this.scene.tweens.add({ targets: all, alpha: 0, duration: 2500, onComplete: () => (this.gone = true) });
        this.scene.tweens.add({ targets: this.head, scale: S * 0.3, duration: 2500 });
    }

    destroy(): void {
        this.head.destroy();
        this.tentacles.forEach((t) => [...t.segs, t.tip, t.warn].forEach((o) => o.destroy()));
    }
}

export type AnyCreature = Shark | Serpent | Kraken;
