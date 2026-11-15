import { Input, Scene } from 'phaser';
import { ShipSprite } from '../gfx/ShipSprite';
import { CollisionWorld } from '../world/CollisionWorld';
import { Depth, WORLD_EDGE_MARGIN } from '../world/worldConfig';

/**
 * Starter sloop handling — deliberately slow and basic so that future sail
 * and rudder upgrades feel rewarding. Gentle acceleration, long glide,
 * lazy rudder.
 */
export const SLOOP_HANDLING = {
    maxSpeed: 84, // world units / s (~60% slower than the original 210)
    reverseMax: 22,
    accel: 34, // ~2.5s to full sail
    brake: 60,
    coastDrag: 0.35, // exponential decay per second with no throttle
    keelGrip: 3.0, // how quickly sideways drift is cancelled
    turnRate: 1.0, // rad/s at speed
    turnAtRest: 0.45, // fraction of turnRate available when stopped
    turnResponse: 2.5 // how quickly the rudder reaches its target
};

/** Hull collision probes in local space (+y = toward stern). */
const HULL_PROBES: readonly [number, number][] = [
    [0, -29],
    [-6, -19],
    [6, -19],
    [-11, -4],
    [11, -4],
    [-11, 12],
    [11, 12],
    [-8, 25],
    [8, 25],
    [0, 29]
];

interface Controls {
    up: Input.Keyboard.Key[];
    down: Input.Keyboard.Key[];
    left: Input.Keyboard.Key[];
    right: Input.Keyboard.Key[];
}

export class PlayerShip {
    readonly sprite: ShipSprite;
    x: number;
    y: number;
    heading: number;
    vx = 0;
    vy = 0;
    private angVel = 0;
    private controls: Controls;
    /** When false, input is ignored (e.g. while docked). */
    controlsEnabled = true;
    private readonly probeBuf = HULL_PROBES.map(() => ({ x: 0, y: 0 }));

    constructor(
        scene: Scene,
        private readonly collision: CollisionWorld,
        private readonly worldSize: number,
        x: number,
        y: number,
        heading: number
    ) {
        this.x = x;
        this.y = y;
        this.heading = heading;
        this.sprite = new ShipSprite(scene, x, y, heading, { wakeDepth: Depth.Wake }).setDepth(Depth.Ship);

        const kb = scene.input.keyboard!;
        const K = Input.Keyboard.KeyCodes;
        const key = (code: number) => kb.addKey(code);
        this.controls = {
            up: [key(K.W), key(K.UP)],
            down: [key(K.S), key(K.DOWN)],
            left: [key(K.A), key(K.LEFT)],
            right: [key(K.D), key(K.RIGHT)]
        };
        this.unstick();
    }

    get speed(): number {
        return Math.hypot(this.vx, this.vy);
    }

    /** Signed speed along the bow direction. */
    get forwardSpeed(): number {
        return this.vx * Math.sin(this.heading) - this.vy * Math.cos(this.heading);
    }

    private held(keys: Input.Keyboard.Key[]): boolean {
        return this.controlsEnabled && keys.some((k) => k.isDown);
    }

    private probes(x: number, y: number, heading: number) {
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        HULL_PROBES.forEach(([lx, ly], i) => {
            this.probeBuf[i].x = x + lx * cos - ly * sin;
            this.probeBuf[i].y = y + lx * sin + ly * cos;
        });
        return this.probeBuf;
    }

    private free(x: number, y: number, heading: number): boolean {
        return this.collision.pointsFree(this.probes(x, y, heading));
    }

    /** If the hull overlaps land (spawn, rotation edge cases), nudge it back into open water. */
    private unstick(): void {
        // Bounded per call; anything left over resolves on the next frame.
        for (let i = 0; i < 200 && !this.free(this.x, this.y, this.heading); i++) {
            const dir = this.collision.escapeDirection(this.x, this.y);
            this.x += dir.x * 4;
            this.y += dir.y * 4;
        }
    }

    stop(): void {
        this.vx = 0;
        this.vy = 0;
        this.angVel = 0;
    }

    update(deltaMs: number): void {
        const H = SLOOP_HANDLING;
        const dt = Math.min(deltaMs, 50) / 1000;

        // --- Steering: rudder eases toward its target rate.
        const steer = (this.held(this.controls.right) ? 1 : 0) - (this.held(this.controls.left) ? 1 : 0);
        let fwd = this.forwardSpeed;
        const speedFactor = Math.min(1, Math.abs(fwd) / H.maxSpeed);
        const targetTurn = steer * H.turnRate * (H.turnAtRest + (1 - H.turnAtRest) * speedFactor);
        this.angVel += (targetTurn - this.angVel) * Math.min(1, H.turnResponse * dt);
        const newHeading = this.heading + this.angVel * dt;
        if (this.free(this.x, this.y, newHeading)) this.heading = newHeading;
        else this.angVel = 0;

        // --- Throttle along the bow; the keel bleeds off sideways drift.
        const sin = Math.sin(this.heading);
        const cos = Math.cos(this.heading);
        let lat = this.vx * cos + this.vy * sin;
        fwd = this.vx * sin - this.vy * cos;

        const throttle = this.held(this.controls.up);
        const reverse = this.held(this.controls.down);
        if (throttle) fwd = Math.min(H.maxSpeed, fwd + H.accel * dt);
        else if (reverse) fwd = fwd > 0 ? Math.max(0, fwd - H.brake * dt) : Math.max(-H.reverseMax, fwd - H.accel * 0.4 * dt);
        else fwd *= Math.exp(-H.coastDrag * dt);
        if (Math.abs(fwd) < 0.5 && !throttle && !reverse) fwd = 0;
        lat *= Math.exp(-H.keelGrip * dt);

        this.vx = fwd * sin + lat * cos;
        this.vy = -fwd * cos + lat * sin;

        // --- Move with sliding collision response.
        const nx = this.x + this.vx * dt;
        const ny = this.y + this.vy * dt;
        if (this.free(nx, ny, this.heading)) {
            this.x = nx;
            this.y = ny;
        } else if (this.free(nx, this.y, this.heading)) {
            this.x = nx;
            this.vy *= 0.3;
            this.vx *= 0.85;
        } else if (this.free(this.x, ny, this.heading)) {
            this.y = ny;
            this.vx *= 0.3;
            this.vy *= 0.85;
        } else {
            // Head-on: small bounce back.
            this.vx *= -0.2;
            this.vy *= -0.2;
        }
        this.unstick();

        // --- World edge.
        const m = WORLD_EDGE_MARGIN;
        const max = this.worldSize - m;
        if (this.x < m || this.x > max) {
            this.x = Math.max(m, Math.min(max, this.x));
            this.vx = 0;
        }
        if (this.y < m || this.y > max) {
            this.y = Math.max(m, Math.min(max, this.y));
            this.vy = 0;
        }

        this.sprite.setPosition(this.x, this.y).setRotation(this.heading);
        this.sprite.setSailing(Math.max(0, this.forwardSpeed) / H.maxSpeed);
    }
}
