import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { TextureKeys } from '../gfx/textures';
import { Depth } from './worldConfig';

/**
 * Swaying palm canopies. Palms sit above the ship so sailing close to shore
 * passes under the fronds. Only palms inside the camera view are animated.
 */
export class IslandDecor {
    private readonly palms: { img: GameObjects.Image; phase: number }[] = [];
    private elapsed = 0;

    constructor(private readonly scene: Scene) {}

    addPalm(x: number, y: number): void {
        const img = this.scene.add.image(x, y, TextureKeys.Palm).setScale(PIXEL_SCALE).setDepth(Depth.Canopy);
        this.palms.push({ img, phase: (x * 0.013 + y * 0.007) % (Math.PI * 2) });
    }

    get count(): number {
        return this.palms.length;
    }

    update(deltaMs: number): void {
        this.elapsed += deltaMs;
        const t = this.elapsed / 1000;
        const v = this.scene.cameras.main.worldView;
        for (const p of this.palms) {
            const { x, y } = p.img;
            if (x < v.x - 40 || x > v.right + 40 || y < v.y - 40 || y > v.bottom + 40) continue;
            p.img.angle = Math.sin(t * 1.6 + p.phase) * 4;
        }
    }
}
