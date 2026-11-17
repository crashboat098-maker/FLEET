import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE } from '../config/constants';
import { TextureKeys } from '../gfx/textures';
import { CollisionWorld } from './CollisionWorld';
import { DEEP_CELL } from './terrainTextures';
import { Depth } from './worldConfig';

interface Twinkle {
    img: GameObjects.Image;
    age: number;
    life: number;
    peak: number;
    vx: number;
    vy: number;
    lifeRange: [number, number];
    drift: number;
}

/**
 * The animated sea surface for the gameplay world.
 *
 *  - One camera-locked TileSprite whose texture offset tracks the camera,
 *    so the water scrolls with the world but costs a single quad.
 *  - A pre-baked deep-water overlay image.
 *  - A small fixed pool of wave crests / sparkles / drifting specks that
 *    only ever live inside the camera view. Nothing off-screen is updated.
 */
export class OceanLayer {
    private readonly water: GameObjects.TileSprite;
    private readonly pool: Twinkle[] = [];
    private current = { x: 0, y: 0 };
    private elapsed = 0;

    constructor(
        private readonly scene: Scene,
        deepKey: string,
        private readonly collision: CollisionWorld
    ) {
        this.water = scene.add
            .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, TextureKeys.OceanTile)
            .setOrigin(0)
            .setScrollFactor(0)
            .setTileScale(PIXEL_SCALE)
            .setDepth(Depth.Water);

        scene.add.image(0, 0, deepKey).setOrigin(0).setScale(DEEP_CELL).setDepth(Depth.DeepWater);

        const add = (key: string, n: number, life: [number, number], peak: number, drift: number) => {
            for (let i = 0; i < n; i++) {
                const img = scene.add.image(0, 0, key).setScale(PIXEL_SCALE).setDepth(Depth.WaterFx).setAlpha(0);
                const t: Twinkle = { img, age: 0, life: 1, peak, vx: 0, vy: 0, lifeRange: life, drift };
                this.respawn(t);
                t.age = Math.random() * t.life; // desync
                this.pool.push(t);
            }
        };
        add(TextureKeys.Wave, 30, [2200, 4200], 0.75, 4);
        add(TextureKeys.Sparkle, 12, [500, 1100], 1, 0);
        add(TextureKeys.Speck, 26, [3500, 6000], 0.55, 10);
    }

    private respawn(t: Twinkle): void {
        const { lifeRange: life, drift } = t;
        const view = this.scene.cameras.main.worldView;
        // Try a few times to land in open water, otherwise hide this cycle.
        for (let i = 0; i < 6; i++) {
            const x = view.x + PMath.Between(-20, view.width + 20);
            const y = view.y + PMath.Between(-20, view.height + 20);
            if (this.collision.coastDistance(x, y) > 6) {
                t.img.setPosition(x, y).setVisible(true);
                break;
            }
            t.img.setVisible(false);
        }
        t.age = 0;
        t.life = PMath.Between(life[0], life[1]);
        t.vx = drift + PMath.FloatBetween(-drift, drift) * 0.5;
        t.vy = PMath.FloatBetween(-drift, drift) * 0.3;
    }

    /** Multiplicative colour for the sea surface (regional water). */
    setTint(color: number): void {
        this.water.setTint(color);
    }

    update(deltaMs: number): void {
        this.elapsed += deltaMs;
        const cam = this.scene.cameras.main;
        const dt = deltaMs / 1000;

        // Slow surface current, plus camera scroll (texture px = world / tileScale).
        this.current.x += 5 * dt;
        this.current.y += 2.5 * dt;
        this.water.tilePositionX = (cam.scrollX + this.current.x) / PIXEL_SCALE;
        this.water.tilePositionY = (cam.scrollY + this.current.y) / PIXEL_SCALE;

        const view = cam.worldView;
        for (const t of this.pool) {
            t.age += deltaMs;
            const img = t.img;
            const offscreen =
                img.x < view.x - 60 || img.x > view.right + 60 || img.y < view.y - 60 || img.y > view.bottom + 60;
            if (t.age >= t.life || offscreen) {
                this.respawn(t);
                continue;
            }
            img.x += t.vx * dt;
            img.y += t.vy * dt;
            img.setAlpha(Math.sin((t.age / t.life) * Math.PI) * t.peak);
        }
    }
}
