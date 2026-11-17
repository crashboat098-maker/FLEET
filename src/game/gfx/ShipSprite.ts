import { GameObjects, Math as PMath, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { ShipClassId } from '../ships/shipClasses';
import { FxTextures } from './fxTextures';
import { FLAG_KEYS, PENNANT_KEYS, sailKey, ShipArt, shipArt } from './shipTextures';
import { TextureKeys } from './textures';

export interface ShipSpriteOptions {
    /** Velocity applied to wake foam (px/s); used when the ship is "parked" in a scrolling scene. */
    wakeDrift?: { x: number; y: number };
    /** Depth for wake / smoke emitters. */
    wakeDepth?: number;
    /** Static preview (menus): no wake, smoke or bobbing particles. */
    preview?: boolean;
    /** Multiplicative sail colour (faction look). */
    sailTint?: number;
    /** Flag colour (pirates keep the black flag). */
    flagTint?: number;
    /** Spectral ghost-ship look. */
    ghost?: boolean;
    /** Fly a coloured pennant instead of the black pirate flag. */
    pennant?: number;
}

/** Smoke emission interval (ms) per damage level; 0 = none. */
const SMOKE_INTERVAL = [0, 520, 230, 90];

/**
 * Visual-only ship of any class: hull, damage overlays, sails, flag, wake,
 * smoke and deck fires. Headings are radians, 0 = north, clockwise.
 * Gameplay drives it via setSailing(), setDamageLevel() and sink().
 */
export class ShipSprite extends GameObjects.Container {
    readonly art: ShipArt;
    private readonly hull: GameObjects.Image;
    private readonly cracks: GameObjects.Image;
    private readonly flood: GameObjects.Image;
    private readonly sails: GameObjects.Image[] = [];
    private readonly flag: GameObjects.Image;
    private readonly fires: GameObjects.Image[] = [];
    private readonly wake: GameObjects.Particles.ParticleEmitter | null = null;
    private readonly smoke: GameObjects.Particles.ParticleEmitter | null = null;
    private readonly halfLength: number;
    private readonly flagKeys: readonly string[];
    private intensity = 0;
    private damage = 0;
    private wakeBudget = 0;
    private flagTimer = 0;
    private flagFrame = 0;
    private fireTimer = 0;
    private fireFrame = 0;
    private leakTimer = 0;
    private sinking = false;
    private baseScale = 1;

    constructor(scene: Scene, x: number, y: number, heading: number, readonly cls: ShipClassId, private readonly opts: ShipSpriteOptions = {}) {
        super(scene, x, y);
        const S = PIXEL_SCALE;
        this.art = shipArt(cls);
        const art = this.art;
        this.halfLength = (art.length * S) / 2;
        const top = -this.halfLength;

        this.hull = scene.add.image(0, 0, art.hull).setScale(S);
        this.cracks = scene.add.image(0, 0, art.cracks[0]).setScale(S).setVisible(false);
        this.flood = scene.add.image(0, 0, art.flood).setScale(S).setVisible(false);
        this.flagKeys = opts.pennant !== undefined ? PENNANT_KEYS : FLAG_KEYS;
        this.flag = scene.add.image(0, top + art.flagRow * S, this.flagKeys[0]).setOrigin(0.5, 0).setScale(S);
        if (opts.pennant !== undefined) this.flag.setTint(opts.pennant);
        this.add([this.hull, this.cracks, this.flood, this.flag]);
        art.masts.forEach((row, i) => {
            const sail = scene.add.image(0, top + (row + 1) * S, sailKey(cls, i, true, 0)).setOrigin(0.5, 1).setScale(S);
            this.sails.push(sail);
            this.add(sail);
        });
        for (const [fx, fy] of art.fireSpots) {
            const f = scene.add.image(fx * S, fy * S, FxTextures.Fire[0]).setOrigin(0.5, 0.8).setScale(S).setVisible(false);
            this.fires.push(f);
            this.add(f);
        }
        this.setRotation(heading);
        if (opts.sailTint !== undefined) this.sails.forEach((s) => s.setTint(opts.sailTint!));
        if (opts.flagTint !== undefined) this.flag.setTint(opts.flagTint);
        if (opts.ghost) {
            this.list.forEach((o) => (o as GameObjects.Image).setTint?.(0x9fe8d8));
            this.setAlpha(0.72);
        }

        if (!opts.preview) {
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
            this.smoke = scene.add.particles(0, 0, FxTextures.Smoke, {
                lifespan: { min: 1400, max: 2400 },
                speedX: { min: 2, max: 10 },
                speedY: { min: -18, max: -8 },
                scale: { start: S * 0.6, end: S * 2 },
                alpha: { start: 0.55, end: 0 },
                emitting: false
            });
            this.smoke.setDepth((opts.wakeDepth ?? 0) + 20);
        }

        scene.add.existing(this);
        this.addToUpdateList();

        // Gentle bob: the whole vessel rises and settles on the swell.
        scene.tweens.add({ targets: [this.hull, this.cracks, this.flood, this.flag, ...this.sails], y: '+=1', duration: 1300, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

        this.once(GameObjects.Events.DESTROY, () => {
            this.wake?.destroy();
            this.smoke?.destroy();
        });
    }

    /** Half the hull length in world units. */
    get halfLen(): number {
        return this.halfLength;
    }

    /** 0 = becalmed, 1 = full sail. Drives sail shape, flag speed and wake. */
    setSailing(intensity: number): this {
        this.intensity = Math.max(0, Math.min(1, intensity));
        this.refreshSails();
        return this;
    }

    /** 0 healthy, 1 light, 2 heavy, 3 critical. Repairs simply set a lower level. */
    setDamageLevel(level: number): this {
        level = Math.max(0, Math.min(3, level));
        if (level === this.damage) return this;
        this.damage = level;
        this.refreshSails();
        this.cracks.setVisible(level >= 1).setTexture(this.art.cracks[level >= 2 ? 1 : 0]).setAlpha(level === 1 ? 0.7 : 1);
        this.flood.setVisible(level >= 3);
        // Small deck fire when heavily damaged, larger fires when critical.
        this.fires.forEach((f, i) => f.setVisible(level >= 3 || (level === 2 && i === 0)).setScale(PIXEL_SCALE * (level >= 3 && i === 0 ? 1.5 : 1)));
        // Critical ships ride low: darker, a touch smaller.
        this.baseScale = level >= 3 ? 0.94 : 1;
        if (!this.sinking) this.setScale(this.baseScale);
        if (!this.opts.ghost) this.hull.setTint(level >= 3 ? 0xa8b8c8 : 0xffffff);
        return this;
    }

    private refreshSails(): void {
        const full = this.intensity > 0.3;
        this.sails.forEach((s, i) => s.setTexture(sailKey(this.cls, i, full, this.damage)));
    }

    private local(lx: number, ly: number) {
        const sin = Math.sin(this.rotation);
        const cos = Math.cos(this.rotation);
        return { x: this.x + lx * cos - ly * sin, y: this.y + lx * sin + ly * cos };
    }

    /** Containers aren't on the update list by default; we opt in via addToUpdateList(). */
    preUpdate(_time: number, delta: number): void {
        this.flagTimer -= delta;
        if (this.flagTimer <= 0) {
            this.flagFrame ^= 1;
            this.flag.setTexture(this.flagKeys[this.flagFrame]);
            this.flagTimer = 420 - this.intensity * 300;
        }

        if (this.damage >= 2 || this.sinking) {
            this.fireTimer -= delta;
            if (this.fireTimer <= 0) {
                this.fireTimer = 110;
                this.fireFrame = (this.fireFrame + 1) % FxTextures.Fire.length;
                this.fires.forEach((f, i) => f.visible && f.setTexture(FxTextures.Fire[(this.fireFrame + i) % FxTextures.Fire.length]));
            }
        }

        // Smoke rises from the deck; the emitter follows the ship.
        if (this.smoke) {
            const interval = this.sinking ? 60 : SMOKE_INTERVAL[this.damage];
            this.smoke.emitting = interval > 0;
            if (interval > 0) {
                const p = this.local(0, this.halfLength * 0.2);
                this.smoke.setPosition(p.x, p.y);
                this.smoke.frequency = interval;
            }
        }

        // Critical: water splashes over the gunwales.
        if (this.damage >= 3 && this.wake && !this.sinking) {
            this.leakTimer -= delta;
            if (this.leakTimer <= 0) {
                this.leakTimer = 380;
                const side = Math.random() < 0.5 ? -1 : 1;
                const p = this.local(side * this.art.beam * PIXEL_SCALE, (Math.random() - 0.3) * this.halfLength);
                this.wake.emitParticleAt(p.x, p.y, 2);
            }
        }

        if (!this.wake || this.sinking || this.intensity < 0.04) return;
        this.wakeBudget += (delta / 1000) * (10 + 50 * this.intensity);
        const beam = this.art.beam * PIXEL_SCALE * 0.6;
        while (this.wakeBudget >= 1) {
            this.wakeBudget -= 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            const stern = this.local(side * (2 + Math.random() * beam), this.halfLength - 2);
            this.wake.emitParticleAt(stern.x, stern.y);
            if (this.intensity > 0.5 && Math.random() < 0.35) {
                const bow = this.local(side * beam, -this.halfLength + 14);
                this.wake.emitParticleAt(bow.x, bow.y);
            }
        }
    }

    /**
     * Sinking sequence (~3.5s): fire and smoke, debris and splashes burst out,
     * then the ship lists, darkens and slips under amid bubbles and ripples.
     */
    sink(onComplete: () => void): void {
        if (this.sinking) return;
        this.sinking = true;
        this.setDamageLevel(3);
        this.fires.forEach((f) => f.setVisible(true));
        const scene = this.scene;
        const S = PIXEL_SCALE;
        const depth = (this.opts.wakeDepth ?? 0) + 1;

        const debris = scene.add.particles(this.x, this.y, 'fx-plank', {
            speed: { min: 15, max: 55 },
            lifespan: { min: 5000, max: 8000 },
            rotate: { min: 0, max: 360 },
            scale: S,
            alpha: { start: 1, end: 0 },
            emitting: false
        });
        debris.setDepth(depth);
        debris.explode(14);
        const splinters = scene.add.particles(this.x, this.y, 'fx-splinter', { speed: { min: 20, max: 70 }, lifespan: 4000, rotate: { min: 0, max: 360 }, scale: S, alpha: { start: 1, end: 0 }, emitting: false });
        splinters.setDepth(depth);
        splinters.explode(16);
        const splash = scene.add.particles(this.x, this.y, 'fx-splash', { speed: { min: 20, max: 60 }, lifespan: 700, scale: { start: S, end: S * 1.6 }, alpha: { start: 0.9, end: 0 }, emitting: false });
        splash.setDepth(depth + 2);
        splash.explode(12);
        const bubbles = scene.add.particles(this.x, this.y, 'fx-bubble', {
            x: { min: -this.art.beam * S, max: this.art.beam * S },
            y: { min: -this.halfLength * 0.6, max: this.halfLength * 0.6 },
            speedY: { min: -12, max: -4 },
            lifespan: { min: 500, max: 1100 },
            scale: S,
            alpha: { start: 0.9, end: 0 },
            frequency: 45
        });
        bubbles.setDepth(depth + 2);

        // Expanding ripple rings.
        const ripples = scene.time.addEvent({
            delay: 420,
            repeat: 8,
            callback: () => {
                const ring = scene.add.image(this.x, this.y, 'fx-ring').setScale(S * 0.6).setAlpha(0.8).setDepth(depth).setRotation(this.rotation + Math.PI / 2);
                scene.tweens.add({ targets: ring, scale: S * (1.6 + this.art.beam / 12), alpha: 0, duration: 1600, onComplete: () => ring.destroy() });
            }
        });

        const tint = { v: 0 };
        scene.tweens.add({
            targets: tint,
            v: 1,
            delay: 500,
            duration: 3000,
            ease: 'Quad.easeIn',
            onUpdate: () => {
                const c = Math.round(255 - tint.v * 170);
                const col = (Math.round(c * 0.55) << 16) | (Math.round(c * 0.75) << 8) | c;
                this.list.forEach((o) => (o as GameObjects.Image).setTint?.(col));
                this.setScale(this.baseScale * (1 - 0.45 * tint.v));
                this.setAlpha(1 - tint.v);
                this.rotation += 0.0025;
                bubbles.setPosition(this.x, this.y);
            },
            onComplete: () => {
                this.setVisible(false);
                bubbles.stop();
                ripples.remove();
                this.smoke && (this.smoke.emitting = false);
                scene.time.delayedCall(1600, () => {
                    bubbles.destroy();
                    splash.destroy();
                });
                scene.time.delayedCall(8500, () => {
                    debris.destroy();
                    splinters.destroy();
                });
                onComplete();
            }
        });
        // A couple of late splashes as the hull goes under.
        scene.time.delayedCall(2600, () => splash.setPosition(this.x, this.y).explode(8));
        scene.time.delayedCall(PMath.Between(1200, 1800), () => splinters.setPosition(this.x, this.y).explode(6));
    }
}
