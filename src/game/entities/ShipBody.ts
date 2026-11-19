import { Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { ShipSprite, ShipSpriteOptions } from '../gfx/ShipSprite';
import { ShipClassId, ShipStats, speedCapOf } from '../ships/shipClasses';
import { CollisionWorld } from '../world/CollisionWorld';
import { WORLD_EDGE_MARGIN } from '../world/worldConfig';

/**
 * Shared sailing physics for every ship (player, escorts, NPCs): rudder
 * easing, throttle along the bow, keel grip, sliding collision with land,
 * stuck recovery and the world edge. Subclasses decide steer/throttle.
 */
export class ShipBody {
    readonly sprite: ShipSprite;
    x: number;
    y: number;
    heading: number;
    vx = 0;
    vy = 0;
    protected angVel = 0;
    private readonly probesLocal: [number, number][];
    private readonly probeBuf: { x: number; y: number }[];

    constructor(
        scene: Scene,
        protected readonly collision: CollisionWorld,
        protected readonly worldSize: number,
        x: number,
        y: number,
        heading: number,
        readonly cls: ShipClassId,
        spriteOpts: ShipSpriteOptions = {}
    ) {
        this.x = x;
        this.y = y;
        this.heading = heading;
        this.sprite = new ShipSprite(scene, x, y, heading, cls, spriteOpts);
        // Collision probes follow the hull outline of this class.
        const L = this.sprite.halfLen - 1;
        const B = this.beam - 1;
        this.probesLocal = [
            [0, -L],
            [-B * 0.55, -L * 0.6],
            [B * 0.55, -L * 0.6],
            [-B, -L * 0.15],
            [B, -L * 0.15],
            [-B, L * 0.4],
            [B, L * 0.4],
            [-B * 0.85, L * 0.85],
            [B * 0.85, L * 0.85],
            [0, L]
        ];
        this.probeBuf = this.probesLocal.map(() => ({ x: 0, y: 0 }));
        this.unstick();
    }

    get halfLen(): number {
        return this.sprite.halfLen;
    }
    get beam(): number {
        return this.sprite.art.beam * PIXEL_SCALE;
    }
    get speed(): number {
        return Math.hypot(this.vx, this.vy);
    }
    /** Signed speed along the bow direction. */
    get forwardSpeed(): number {
        return this.vx * Math.sin(this.heading) - this.vy * Math.cos(this.heading);
    }

    private probes(x: number, y: number, heading: number) {
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        this.probesLocal.forEach(([lx, ly], i) => {
            this.probeBuf[i].x = x + lx * cos - ly * sin;
            this.probeBuf[i].y = y + lx * sin + ly * cos;
        });
        return this.probeBuf;
    }

    protected free(x: number, y: number, heading: number): boolean {
        return this.collision.pointsFree(this.probes(x, y, heading));
    }

    /** If the hull overlaps land, nudge it back into open water. */
    unstick(): void {
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

    /** External push (ship-to-ship separation); never into land. */
    nudge(dx: number, dy: number): void {
        if (this.free(this.x + dx, this.y + dy, this.heading)) {
            this.x += dx;
            this.y += dy;
        }
    }

    /**
     * Integrate one step. steer/throttle in -1..1 / 0..1. Returns the speed
     * lost to collisions this step (for impact damage).
     */
    protected drive(deltaMs: number, H: ShipStats, steer: number, throttle: number, reverse: boolean, top: number, accel = H.accel): number {
        const dt = Math.min(deltaMs, 50) / 1000;

        let fwd = this.forwardSpeed;
        const speedFactor = Math.min(1, Math.abs(fwd) / Math.max(1, H.maxSpeed));
        const targetTurn = steer * H.turnRate * (H.turnAtRest + (1 - H.turnAtRest) * speedFactor);
        this.angVel += (targetTurn - this.angVel) * Math.min(1, H.turnResponse * dt);
        const newHeading = this.heading + this.angVel * dt;
        if (this.free(this.x, this.y, newHeading)) this.heading = newHeading;
        else this.angVel = 0;

        const sin = Math.sin(this.heading);
        const cos = Math.cos(this.heading);
        let lat = this.vx * cos + this.vy * sin;
        fwd = this.vx * sin - this.vy * cos;
        if (throttle > 0) fwd = fwd > top ? fwd * Math.exp(-H.coastDrag * dt) : Math.min(top, fwd + accel * throttle * dt);
        else if (reverse) fwd = fwd > 0 ? Math.max(0, fwd - H.brake * dt) : Math.max(-H.reverseMax, fwd - accel * 0.4 * dt);
        else fwd *= Math.exp(-H.coastDrag * dt);
        if (Math.abs(fwd) < 0.5 && throttle === 0 && !reverse) fwd = 0;
        fwd = Math.min(fwd, speedCapOf(this.cls));
        lat *= Math.exp(-H.keelGrip * dt);
        this.vx = fwd * sin + lat * cos;
        this.vy = -fwd * cos + lat * sin;

        const before = this.speed;
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
            this.vx *= -0.2;
            this.vy *= -0.2;
        }
        const lost = before - this.speed;
        this.unstick();

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
        this.sprite.setSailing(Math.max(0, this.forwardSpeed) / Math.max(1, H.maxSpeed));
        return lost;
    }
}
