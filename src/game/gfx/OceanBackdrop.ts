import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE } from '../config/constants';
import { TextureKeys } from './textures';

/**
 * Reusable animated ocean: a drifting tiled water layer plus little wave
 * crests and sparkles that fade in and out. Cheap — one TileSprite and a
 * handful of pooled images.
 */
export class OceanBackdrop {
    private readonly water: GameObjects.TileSprite;
    private readonly drift = { x: 6, y: 3 }; // px per second

    constructor(private readonly scene: Scene, waveCount = 26, sparkleCount = 10) {
        this.water = scene.add
            .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, TextureKeys.OceanTile)
            .setOrigin(0)
            .setTileScale(PIXEL_SCALE)
            .setDepth(-100);

        for (let i = 0; i < waveCount; i++) this.spawnTwinkle(TextureKeys.Wave, 2200, 4200, 0.8);
        for (let i = 0; i < sparkleCount; i++) this.spawnTwinkle(TextureKeys.Sparkle, 500, 1100, 1);
    }

    private spawnTwinkle(key: string, minMs: number, maxMs: number, peakAlpha: number): void {
        const img = this.scene.add.image(0, 0, key).setScale(PIXEL_SCALE).setDepth(-90).setAlpha(0);
        const relocate = () => img.setPosition(PMath.Between(4, GAME_WIDTH - 4), PMath.Between(4, GAME_HEIGHT - 4));
        relocate();
        this.scene.tweens.add({
            targets: img,
            alpha: peakAlpha,
            x: '+=3',
            duration: PMath.Between(minMs, maxMs),
            delay: PMath.Between(0, maxMs * 2),
            yoyo: true,
            repeat: -1,
            repeatDelay: PMath.Between(200, 1600),
            onRepeat: relocate
        });
    }

    update(deltaMs: number): void {
        const dt = deltaMs / 1000;
        this.water.tilePositionX += this.drift.x * dt;
        this.water.tilePositionY += this.drift.y * dt;
    }
}
