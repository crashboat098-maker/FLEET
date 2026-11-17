import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { CombatTextures } from '../gfx/combatTextures';
import { FxTextures } from '../gfx/fxTextures';
import { CollisionWorld } from '../world/CollisionWorld';
import { Depth } from '../world/worldConfig';
import { Combatant, CombatWorld, hullDistance } from './Combatant';

interface Ball {
    img: GameObjects.Image;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    damage: number;
    shooter: Combatant;
    active: boolean;
}

export const CANNON_SPEED = 250;
export const CANNON_RANGE = 300;

/**
 * Broadside cannon fire for every ship. Balls are pooled images; each frame
 * they fly, hit hulls (capsule test), hit land (dust) or drop short (splash).
 * Smoke, flashes, splashes and splinters use a few shared particle emitters.
 */
export class CannonSystem {
    private readonly balls: Ball[] = [];
    private readonly smoke: GameObjects.Particles.ParticleEmitter;
    private readonly splash: GameObjects.Particles.ParticleEmitter;
    private readonly splinters: GameObjects.Particles.ParticleEmitter;
    private readonly dust: GameObjects.Particles.ParticleEmitter;

    constructor(
        private readonly scene: Scene,
        private readonly combat: CombatWorld,
        private readonly collision: CollisionWorld
    ) {
        const S = PIXEL_SCALE;
        this.smoke = scene.add.particles(0, 0, FxTextures.Smoke, {
            lifespan: { min: 600, max: 1100 },
            speed: { min: 6, max: 22 },
            scale: { start: S * 0.6, end: S * 1.6 },
            alpha: { start: 0.65, end: 0 },
            emitting: false
        });
        this.splash = scene.add.particles(0, 0, 'fx-splash', { lifespan: 500, speed: { min: 10, max: 40 }, scale: { start: S * 0.8, end: S * 1.4 }, alpha: { start: 0.9, end: 0 }, emitting: false });
        this.splinters = scene.add.particles(0, 0, 'fx-splinter', { lifespan: 900, speed: { min: 30, max: 80 }, rotate: { min: 0, max: 360 }, scale: S, alpha: { start: 1, end: 0 }, emitting: false });
        this.dust = scene.add.particles(0, 0, 'fx-steam', { lifespan: 500, speed: { min: 10, max: 30 }, scale: { start: S * 0.5, end: S }, alpha: { start: 0.6, end: 0 }, tint: 0xc8b088, emitting: false });
        this.smoke.setDepth(Depth.Smoke);
        this.splash.setDepth(Depth.Wake + 1);
        this.splinters.setDepth(Depth.Ship + 2);
        this.dust.setDepth(Depth.Smoke);
    }

    private ball(): Ball {
        let b = this.balls.find((x) => !x.active);
        if (!b) {
            const img = this.scene.add.image(0, 0, CombatTextures.Ball).setScale(PIXEL_SCALE).setDepth(Depth.Ship + 3);
            b = { img, x: 0, y: 0, vx: 0, vy: 0, life: 0, damage: 0, shooter: null as unknown as Combatant, active: false };
            this.balls.push(b);
        }
        return b;
    }

    /**
     * Fire one side's guns. side: -1 = port (left), 1 = starboard (right).
     * Balls leave from evenly spaced ports along the hull and carry the ship's
     * own velocity, with a little spread.
     */
    fire(shooter: Combatant, side: -1 | 1, guns: number, damage: number): void {
        const fx = Math.sin(shooter.heading);
        const fy = -Math.cos(shooter.heading);
        const rx = Math.cos(shooter.heading) * side;
        const ry = Math.sin(shooter.heading) * side;
        const n = Math.max(1, guns);
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : -0.55 + (1.1 * i) / (n - 1);
            const px = shooter.x + fx * shooter.halfLen * t + rx * (shooter.beam + 2);
            const py = shooter.y + fy * shooter.halfLen * t + ry * (shooter.beam + 2);
            const spread = (Math.random() - 0.5) * 0.12;
            const dx = rx * Math.cos(spread) - ry * Math.sin(spread);
            const dy = rx * Math.sin(spread) + ry * Math.cos(spread);
            const b = this.ball();
            b.x = px;
            b.y = py;
            b.vx = dx * CANNON_SPEED + shooter.vx;
            b.vy = dy * CANNON_SPEED + shooter.vy;
            b.life = (CANNON_RANGE / CANNON_SPEED) * (0.92 + Math.random() * 0.16) * 1000;
            b.damage = damage;
            b.shooter = shooter;
            b.active = true;
            b.img.setVisible(true).setPosition(px, py);
            // Staggered muzzle flashes and smoke.
            this.scene.time.delayedCall(i * 45, () => {
                const flash = this.scene.add.image(px, py, CombatTextures.Flash).setScale(PIXEL_SCALE).setDepth(Depth.Ship + 4);
                this.scene.time.delayedCall(70, () => flash.destroy());
                this.smoke.emitParticleAt(px + rx * 4, py + ry * 4, 3);
            });
        }
    }

    update(deltaMs: number): void {
        const dt = deltaMs / 1000;
        for (const b of this.balls) {
            if (!b.active) continue;
            b.life -= deltaMs;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.img.setPosition(b.x, b.y);
            if (b.life <= 0) {
                this.splash.emitParticleAt(b.x, b.y, 5);
                this.retire(b);
                continue;
            }
            // Hits are checked before land so shore targets (archers) can be struck.
            let hitSomething = false;
            for (const c of this.combat.near(b.x, b.y, 140)) {
                if (c === b.shooter || c.faction === b.shooter.faction) continue;
                if (hullDistance(c, b.x, b.y) > c.beam + 3) continue;
                const mult = c.kind === 'creature' ? (b.shooter.creatureMult ?? 1) : 1;
                c.takeHit(b.damage * mult, 'cannonball', b.shooter);
                this.splinters.emitParticleAt(b.x, b.y, 6);
                const flash = this.scene.add.image(b.x, b.y, CombatTextures.Flash).setScale(PIXEL_SCALE * 1.4).setDepth(Depth.Ship + 4);
                this.scene.time.delayedCall(90, () => flash.destroy());
                this.retire(b);
                hitSomething = true;
                break;
            }
            if (!hitSomething && this.collision.isSolid(b.x, b.y)) {
                this.dust.emitParticleAt(b.x, b.y, 5);
                this.retire(b);
            }
        }
    }

    private retire(b: Ball): void {
        b.active = false;
        b.img.setVisible(false);
    }

    destroy(): void {
        this.balls.forEach((b) => b.img.destroy());
        [this.smoke, this.splash, this.splinters, this.dust].forEach((e) => e.destroy());
    }
}
