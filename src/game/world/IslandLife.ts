import { BlendModes, GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { FxTextures } from '../gfx/fxTextures';
import { TextureKeys } from '../gfx/textures';
import { IslandArt } from './IslandArt';
import { Depth } from './worldConfig';

interface Living {
    palms: { img: GameObjects.Image; phase: number }[];
    fires: GameObjects.Image[];
    glows: { img: GameObjects.Image; phase: number; base: number }[];
    emitters: GameObjects.Particles.ParticleEmitter[];
}

/**
 * Animated sprites for islands near the camera: swaying palms, flickering
 * fire pits, glowing eyes/lava and drifting smoke. Created when an island
 * comes into range and destroyed when it leaves, so distant islands cost
 * nothing. Only on-screen sprites are animated each frame.
 */
export class IslandLife {
    private readonly active = new Map<number, Living>();
    private elapsed = 0;
    private fireFrame = 0;
    private fireTimer = 0;

    constructor(private readonly scene: Scene) {}

    isActive(id: number): boolean {
        return this.active.has(id);
    }

    get activeCount(): number {
        return this.active.size;
    }

    activate(art: IslandArt): void {
        const id = art.island.id;
        if (this.active.has(id)) return;
        const S = PIXEL_SCALE;
        const scene = this.scene;
        const living: Living = { palms: [], fires: [], glows: [], emitters: [] };

        for (const p of art.palms) {
            const img = scene.add.image(p.x, p.y, TextureKeys.Palm).setScale(S).setDepth(Depth.Canopy);
            living.palms.push({ img, phase: (p.x * 0.013 + p.y * 0.007) % (Math.PI * 2) });
        }

        for (const fx of art.fx) {
            const k = fx.scale ?? 1;
            switch (fx.kind) {
                case 'fire':
                    living.fires.push(scene.add.image(fx.x, fx.y, FxTextures.Fire[0]).setOrigin(0.5, 0.8).setScale(S * k).setDepth(Depth.IslandDecor + 5));
                    break;
                case 'eyeGlow':
                case 'lavaGlow': {
                    const key = fx.kind === 'eyeGlow' ? FxTextures.GlowRed : FxTextures.GlowLava;
                    const img = scene.add.image(fx.x, fx.y, key).setScale(S * k).setDepth(Depth.IslandDecor + 4).setBlendMode(BlendModes.ADD);
                    living.glows.push({ img, phase: Math.random() * 6, base: fx.kind === 'eyeGlow' ? 0.75 : 0.6 });
                    break;
                }
                case 'smoke': {
                    const em = scene.add.particles(fx.x, fx.y, FxTextures.Smoke, {
                        lifespan: { min: 2600, max: 4200 },
                        frequency: 240 / k,
                        speedX: { min: 4, max: 12 },
                        speedY: { min: -24 * k, max: -12 * k },
                        scale: { start: S * 0.7 * k, end: S * 2.2 * k },
                        alpha: { start: 0.5, end: 0 }
                    });
                    em.setDepth(Depth.Smoke);
                    living.emitters.push(em);
                    break;
                }
            }
        }
        this.active.set(id, living);
    }

    deactivate(id: number): void {
        const living = this.active.get(id);
        if (!living) return;
        living.palms.forEach((p) => p.img.destroy());
        living.fires.forEach((f) => f.destroy());
        living.glows.forEach((g) => g.img.destroy());
        living.emitters.forEach((e) => e.destroy());
        this.active.delete(id);
    }

    activeIds(): number[] {
        return [...this.active.keys()];
    }

    update(deltaMs: number): void {
        this.elapsed += deltaMs;
        const t = this.elapsed / 1000;
        this.fireTimer -= deltaMs;
        const advanceFire = this.fireTimer <= 0;
        if (advanceFire) {
            this.fireTimer = 110;
            this.fireFrame = (this.fireFrame + 1) % FxTextures.Fire.length;
        }
        const v = this.scene.cameras.main.worldView;
        const visible = (o: GameObjects.Image) => o.x > v.x - 48 && o.x < v.right + 48 && o.y > v.y - 48 && o.y < v.bottom + 48;

        for (const living of this.active.values()) {
            for (const p of living.palms) if (visible(p.img)) p.img.angle = Math.sin(t * 1.6 + p.phase) * 4;
            if (advanceFire) {
                living.fires.forEach((f, i) => visible(f) && f.setTexture(FxTextures.Fire[(this.fireFrame + i) % FxTextures.Fire.length]));
            }
            for (const g of living.glows) if (visible(g.img)) g.img.setAlpha(g.base + Math.sin(t * 2.4 + g.phase) * 0.25);
        }
    }

    destroyAll(): void {
        for (const id of this.activeIds()) this.deactivate(id);
    }
}
