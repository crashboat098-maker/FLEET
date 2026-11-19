import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { formationOffset } from '../ships/formation';
import type { Formation } from '../ships/profile';
import { Raster } from './Raster';

const SIZE = 25;
const C = (SIZE - 1) / 2;
/** Escorts shown in the preview (the most a captain can have). */
const ESCORTS = 3;

/**
 * A small round chart of a formation, seen from above with the bow pointing
 * up: the flagship is the gold arrow, escorts are green hulls. Positions come
 * from the same formationOffset the escorts really sail to.
 */
export const formationIcon = (scene: Scene, formation: Formation, active: boolean): string => {
    const key = `formation-${formation}-${active ? 'on' : 'off'}`;
    if (scene.textures.exists(key)) return key;
    const r = new Raster(SIZE, SIZE);

    // Water disc with a rim (gold when this formation is selected).
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const d = Math.hypot(x - C, y - C);
            if (d > C + 0.5) continue;
            const rim = d > C - 0.9;
            r.set(x, y, rim ? (active ? Palette.gold : Palette.woodDark) : (x + y) % 5 === 0 ? 0x2a85bf : 0x1a6fa8);
        }
    }

    // Fit flagship + escorts inside the disc, centred.
    const pts = [{ back: 0, side: 0 }, ...Array.from({ length: ESCORTS }, (_, i) => formationOffset(formation, i))];
    const minB = Math.min(...pts.map((p) => p.back));
    const maxB = Math.max(...pts.map((p) => p.back));
    const minS = Math.min(...pts.map((p) => p.side));
    const maxS = Math.max(...pts.map((p) => p.side));
    const midS = (minS + maxS) / 2;
    const midB = (minB + maxB) / 2;
    // Scale so the farthest ship (plus its 2px hull) stays inside the round rim.
    const reach = Math.max(1, ...pts.map((p) => Math.hypot(p.side - midS, p.back - midB)));
    const scale = (C - 4) / reach;
    const toPx = (p: { back: number; side: number }) => ({
        x: Math.round(C + (p.side - midS) * scale),
        y: Math.round(C + (p.back - midB) * scale)
    });

    // Escorts: small green hulls (2 wide, 3 long) with a light bow.
    for (const p of pts.slice(1).map(toPx)) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) r.set(p.x - 1 + dx, p.y + dy, 0x3f9a4a);
        r.set(p.x - 1, p.y - 1, 0x8fe07a);
        r.set(p.x, p.y - 1, 0x8fe07a);
    }
    // Flagship: a gold arrow pointing forward (up).
    const f = toPx(pts[0]);
    r.set(f.x, f.y - 2, Palette.gold);
    for (let dx = -1; dx <= 1; dx++) r.set(f.x + dx, f.y - 1, Palette.gold);
    for (let dx = -1; dx <= 1; dx++) r.set(f.x + dx, f.y, Palette.goldShade);
    r.set(f.x, f.y + 1, Palette.goldShade);

    r.toTexture(scene, key);
    return key;
};
