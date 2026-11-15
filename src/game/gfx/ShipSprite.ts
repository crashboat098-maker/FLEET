import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { ShipTextures, SLOOP_FLAG_ROW, SLOOP_MAST_ROW } from './shipTextures';
import { TextureKeys } from './textures';

export interface ShipSpriteOptions {
    /** Velocity applied to wake foam (px/s); used when the ship is "parked" in a scrolling scene. */
    wakeDrift?: { x: number; y: number };
    /** Depth for the wake emitter. */
    wakeDepth?: number;
}

/**
 * Visual-only pirate sloop: hull, sail and flag layers plus a foam wake.
 * Headings are radians, 0 = north (bow up), increasing clockwise.
 * Gameplay code drives it through `setSailing()` and position/rotation.
 */
export class ShipSprite extends GameObjects.Container {
    private readonly hull: GameObjects.Image;
    private readonly sail: GameObjects.Image;
    private readonly flag: GameObjects.Image;
    private readonly wake: GameObjects.Particles.ParticleEmitter;
    private intensity = 0;
    private wakeBudget = 0;
    private flagTimer = 0;
    private flagFrame = false;
    private readonly halfLength: number;

    constructor(scene: Scene, x: number, y: number, heading = 0, opts: ShipSpriteOptions = {}) {
        super(scene, x, y);
        const S = PIXEL_SCALE;

        this.hull = scene.add.image(0, 0, ShipTextures.Hull).setScale(S);
        this.halfLength = (this.hull.height * S) / 2;
        const top = -this.halfLength;
        this.sail = scene.add
            .image(0, top + (SLOOP_MAST_ROW + 1) * S, ShipTextures.SailFull)
            .setOrigin(0.5, 1)
            .setScale(S);
        this.flag = scene.add.image(0, top + SLOOP_FLAG_ROW * S, ShipTextures.FlagA).setOrigin(0.5, 0).setScale(S);
        this.add([this.hull, this.flag, this.sail]);
        this.setRotation(heading);

        const drift = opts.wakeDrift ?? { x: 0, y: 0 };
        this.wake = scene.add.particles(0, 0, TextureKeys.Sparkle, {
            lifespan: { min: 700, max: 1300 },
            alpha: { start: 0.85, end: 0 },
            scale: { start: S, end: S * 0.5 },
            speedX: { min: drift.x - 6, max: drift.x + 6 },
            speedY: { min: drift.y - 6, max: drift.y + 6 },
            emitting: false
        });
        this.wake.setDepth(opts.wakeDepth ?? -1);

        scene.add.existing(this);
        this.addToUpdateList();

        // Gentle bob: the whole vessel rises and settles on the swell.
        scene.tweens.add({
            targets: [this.hull, this.sail, this.flag],
            y: '+=1',
            duration: 1300,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });

        this.once(GameObjects.Events.DESTROY, () => this.wake.destroy());
    }

    /** 0 = becalmed, 1 = full sail. Drives sail shape, flag speed and wake. */
    setSailing(intensity: number): this {
        this.intensity = Math.max(0, Math.min(1, intensity));
        this.sail.setTexture(this.intensity > 0.3 ? ShipTextures.SailFull : ShipTextures.SailSlack);
        return this;
    }

    /** Containers aren't on the update list by default; we opt in via addToUpdateList(). */
    preUpdate(_time: number, delta: number): void {
        // Flag flaps faster the harder we sail.
        this.flagTimer -= delta;
        if (this.flagTimer <= 0) {
            this.flagFrame = !this.flagFrame;
            this.flag.setTexture(this.flagFrame ? ShipTextures.FlagB : ShipTextures.FlagA);
            this.flagTimer = 420 - this.intensity * 300;
        }

        // Wake: foam at the stern and spray off the bow, scaled by speed.
        if (this.intensity < 0.04) return;
        this.wakeBudget += (delta / 1000) * (10 + 50 * this.intensity);
        const sin = Math.sin(this.rotation);
        const cos = Math.cos(this.rotation);
        // Local (lx, ly) → world. Local +y is toward the stern.
        const toWorld = (lx: number, ly: number) => ({ x: this.x + lx * cos - ly * sin, y: this.y + lx * sin + ly * cos });
        while (this.wakeBudget >= 1) {
            this.wakeBudget -= 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            const stern = toWorld(side * (2 + Math.random() * 6), this.halfLength - 2);
            this.wake.emitParticleAt(stern.x, stern.y);
            if (this.intensity > 0.5 && Math.random() < 0.35) {
                const bow = toWorld(side * 8, -this.halfLength + 14);
                this.wake.emitParticleAt(bow.x, bow.y);
            }
        }
    }
}
