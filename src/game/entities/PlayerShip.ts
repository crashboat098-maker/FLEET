import { Input, Scene } from 'phaser';
import { SPEED_CAP } from '../config/constants';
import { Combatant, Faction, newUid } from '../combat/Combatant';
import { ShipClassId, ShipStats, TAILWIND } from '../ships/shipClasses';
import type { DamageSource } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { Depth } from '../world/worldConfig';
import { ShipBody } from './ShipBody';

interface Controls {
    up: Input.Keyboard.Key[];
    down: Input.Keyboard.Key[];
    left: Input.Keyboard.Key[];
    right: Input.Keyboard.Key[];
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The player's flagship: keyboard + mouse steering, Tailwind, broadside
 * reload timers, and the Combatant interface (damage is routed to the
 * persistent PlayerState through `onHit`).
 */
export class PlayerShip extends ShipBody implements Combatant {
    readonly uid = newUid();
    readonly faction: Faction = 'player';
    readonly kind = 'ship' as const;
    readonly role = 'flagship';
    name = 'FLAGSHIP';
    private readonly controls: Controls;
    /** When false, input is ignored (docked, sinking...). */
    controlsEnabled = true;
    /** Mouse destination, or null when steering by keyboard. */
    target: { x: number; y: number } | null = null;
    /** A siren's pull on the helm (set each frame by the mermaid system). */
    lure: { x: number; y: number; strength: number } | null = null;
    private tailwindUntil = 0;
    private tailwindReadyAt = 0;
    private clock = 0;
    /** Broadside reload: ms timestamps when each side is ready (port = -1, starboard = 1). */
    private reloadReady = { port: 0, starboard: 0 };
    /** Called with the speed lost in a collision with land or a dock. */
    onImpact: ((impactSpeed: number) => void) | null = null;
    /** Damage from cannonballs, rams, creatures (wired to PlayerState). */
    onHit: ((damage: number, source: DamageSource, from: Combatant | null) => void) | null = null;
    /** Live HP ratio and alive flag provided by the scene. */
    status: () => { alive: boolean; hpRatio: number } = () => ({ alive: true, hpRatio: 1 });

    constructor(
        scene: Scene,
        collision: CollisionWorld,
        worldSize: number,
        x: number,
        y: number,
        heading: number,
        cls: ShipClassId,
        private readonly getStats: () => ShipStats
    ) {
        super(scene, collision, worldSize, x, y, heading, cls, { wakeDepth: Depth.Wake });
        this.sprite.setDepth(Depth.Ship);
        const kb = scene.input.keyboard!;
        const K = Input.Keyboard.KeyCodes;
        const key = (code: number) => kb.addKey(code, false);
        this.controls = {
            up: [key(K.W), key(K.UP)],
            down: [key(K.S), key(K.DOWN)],
            left: [key(K.A), key(K.LEFT)],
            right: [key(K.D), key(K.RIGHT)]
        };
    }

    // ------------------------------------------------------------ combatant

    get alive(): boolean {
        return this.status().alive;
    }
    get hpRatio(): number {
        return this.status().hpRatio;
    }
    get creatureMult(): number {
        return this.getStats().creatureMult;
    }
    takeHit(damage: number, source: DamageSource, from: Combatant | null): void {
        this.onHit?.(damage, source, from);
    }

    // ------------------------------------------------------------- cannons

    /** ms until a side can fire again. */
    reloadLeft(side: -1 | 1): number {
        return Math.max(0, (side < 0 ? this.reloadReady.port : this.reloadReady.starboard) - this.clock);
    }

    /** Start reloading a side; returns false if it isn't ready yet. */
    tryFire(side: -1 | 1): boolean {
        if (!this.controlsEnabled || this.reloadLeft(side) > 0) return false;
        const t = this.clock + this.getStats().reloadMs;
        if (side < 0) this.reloadReady.port = t;
        else this.reloadReady.starboard = t;
        return true;
    }

    // ------------------------------------------------------------- Tailwind

    get tailwindActive(): boolean {
        return this.clock < this.tailwindUntil;
    }
    get tailwindRemaining(): number {
        return Math.max(0, (this.tailwindActive ? this.tailwindUntil : this.tailwindReadyAt) - this.clock);
    }
    get tailwindReady(): boolean {
        return this.clock >= this.tailwindReadyAt;
    }
    triggerTailwind(): boolean {
        if (!this.tailwindReady || !this.controlsEnabled) return false;
        this.tailwindUntil = this.clock + TAILWIND.durationMs;
        this.tailwindReadyAt = this.clock + TAILWIND.cooldownMs;
        return true;
    }
    /** Current top speed including Tailwind — never above SPEED_CAP. */
    get topSpeed(): number {
        const base = this.getStats().maxSpeed;
        return Math.min(SPEED_CAP, this.tailwindActive ? base * TAILWIND.speedMult : base);
    }

    // ---------------------------------------------------------------- input

    private held(keys: Input.Keyboard.Key[]): boolean {
        return this.controlsEnabled && keys.some((k) => k.isDown);
    }

    override stop(): void {
        super.stop();
        this.target = null;
    }

    setTarget(x: number, y: number): void {
        if (this.controlsEnabled) this.target = { x, y };
    }

    update(deltaMs: number): void {
        const H = this.getStats();
        this.clock += deltaMs;

        // Keyboard overrides (and cancels) the mouse destination.
        const kSteer = (this.held(this.controls.right) ? 1 : 0) - (this.held(this.controls.left) ? 1 : 0);
        const kUp = this.held(this.controls.up);
        const kDown = this.held(this.controls.down);
        if (kSteer || kUp || kDown || !this.controlsEnabled) this.target = null;

        let steer = kSteer;
        let throttle = kUp ? 1 : 0;
        let reverse = kDown;
        if (this.target) {
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const dist = Math.hypot(dx, dy);
            const diff = wrapAngle(Math.atan2(dx, -dy) - this.heading);
            const fwd = Math.max(0, this.forwardSpeed);
            const stopDist = (fwd * fwd) / (2 * Math.max(1, H.brake)) + this.halfLen * 0.5;
            if (dist < this.halfLen * 0.6 + 12) {
                this.target = null;
            } else {
                steer = Math.max(-1, Math.min(1, diff * 2.2));
                throttle = dist <= stopDist ? 0 : Math.abs(diff) < 0.9 ? 1 : Math.abs(diff) < 2 ? 0.4 : 0.15;
                reverse = false;
            }
        }

        // Siren song: the helm drifts toward her rocks. Counter-steering fights it.
        if (this.lure && this.controlsEnabled) {
            const pull = wrapAngle(Math.atan2(this.lure.x - this.x, -(this.lure.y - this.y)) - this.heading);
            steer = Math.max(-1, Math.min(1, steer + Math.max(-1, Math.min(1, pull * 1.5)) * this.lure.strength));
            throttle = Math.max(throttle, 0.35 * this.lure.strength);
        }

        const accel = H.accel * (this.tailwindActive ? TAILWIND.accelMult : 1);
        const lost = this.drive(deltaMs, H, steer, throttle, reverse, this.topSpeed, accel);
        if (lost > 0.5 && this.onImpact) this.onImpact(lost);
    }
}
