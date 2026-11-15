import { Scene } from 'phaser';
import { Raster } from './Raster';
import { textureFromRows } from './pixelCanvas';

/** Landmark effect sprites: smoke, flickering fire and glows. */
export const FxTextures = {
    Smoke: 'fx-smoke',
    Fire: ['fx-fire-0', 'fx-fire-1', 'fx-fire-2'],
    GlowRed: 'fx-glow-red',
    GlowLava: 'fx-glow-lava'
} as const;

const glow = (scene: Scene, key: string, size: number, color: number, peak: number) => {
    const r = new Raster(size, size);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const t = 1 - Math.hypot(x - c, y - c) / (c + 0.5);
            if (t <= 0) continue;
            // Quantised falloff keeps the glow pixel-crisp.
            const a = Math.ceil(t * 4) / 4;
            r.set(x, y, color, a * a * peak);
        }
    r.toTexture(scene, key);
};

export const generateFxTextures = (scene: Scene): void => {
    textureFromRows(scene, FxTextures.Smoke, ['..###..', '.#####.', '##ooo##', '##ooo##', '##ooo##', '.#####.', '..###..'], {
        '#': 0x8a8794,
        o: 0xb3b0bc
    });

    const fire = { y: 0xffd23f, o: 0xff7a1a, r: 0xc8312b };
    textureFromRows(scene, FxTextures.Fire[0], ['...y...', '..yy...', '..yoy..', '.yooy..', '.yoroy.', 'yorrroy', '.orrro.', '..ooo..'], fire);
    textureFromRows(scene, FxTextures.Fire[1], ['....y..', '...yy..', '..yoy..', '..yooy.', '.yoroy.', 'yorrroy', '.orrro.', '..ooo..'], fire);
    textureFromRows(scene, FxTextures.Fire[2], ['..y....', '..yy.y.', '.yoyy..', '.yooy..', 'yooroy.', 'yorrroy', '.orrro.', '..ooo..'], fire);

    glow(scene, FxTextures.GlowRed, 11, 0xff3b2a, 0.9);
    glow(scene, FxTextures.GlowLava, 17, 0xff9f43, 0.7);
};
