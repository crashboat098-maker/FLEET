import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { PixelCanvas } from '../gfx/pixelCanvas';

/** Dark translucent HUD plate with a thin gold rule. Cached per size. */
export const hudPanel = (scene: Scene, w: number, h: number): string => {
    const key = `hud-panel-${w}x${h}`;
    if (scene.textures.exists(key)) return key;
    const pc = new PixelCanvas(w, h);
    pc.rect(1, 0, w - 2, h, Palette.woodDeep).rect(0, 1, w, h - 2, Palette.woodDeep);
    pc.rect(1, 1, w - 2, h - 2, Palette.goldShade);
    pc.rect(2, 2, w - 4, h - 4, Palette.shadow, 1);
    pc.rect(2, 2, w - 4, h - 4, Palette.deepSea, 0.6);
    pc.toTexture(scene, key);
    return key;
};

/** Parchment sheet in a wooden frame with brass corner nails. Cached per size. */
export const parchmentPanel = (scene: Scene, w: number, h: number): string => {
    const key = `parchment-${w}x${h}`;
    if (scene.textures.exists(key)) return key;
    const pc = new PixelCanvas(w, h);
    pc.rect(2, 0, w - 4, h, Palette.woodDeep).rect(0, 2, w, h - 4, Palette.woodDeep);
    pc.rect(2, 2, w - 4, h - 4, Palette.wood);
    pc.rect(2, 2, w - 4, 1, Palette.woodLight);
    pc.rect(6, 6, w - 12, h - 12, Palette.woodDark);
    pc.rect(7, 7, w - 14, h - 14, Palette.sail);
    // Paper texture: faint speckle and darker edges.
    for (let i = 0; i < (w * h) / 40; i++) {
        const x = 7 + Math.floor(Math.random() * (w - 14));
        const y = 7 + Math.floor(Math.random() * (h - 14));
        pc.px(x, y, Palette.sailShade);
    }
    pc.rect(7, h - 9, w - 14, 2, Palette.sailShade);
    [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]].forEach(([x, y]) =>
        pc.rect(x, y, 2, 2, Palette.goldShade).px(x, y, Palette.gold)
    );
    pc.toTexture(scene, key);
    return key;
};

/** Recessed cargo slot. */
export const slotTexture = (scene: Scene, size: number): string => {
    const key = `slot-${size}`;
    if (scene.textures.exists(key)) return key;
    const pc = new PixelCanvas(size, size);
    pc.rect(0, 0, size, size, Palette.woodDark);
    pc.rect(1, 1, size - 2, size - 2, Palette.sailShade);
    pc.rect(1, 1, size - 2, 1, Palette.wetSand);
    pc.toTexture(scene, key);
    return key;
};
