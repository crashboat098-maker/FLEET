import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { PixelCanvas, textureFromRows } from './pixelCanvas';

/** Harbour art: roofs, lighthouse, buoys, props and the anchor marker. */
export const PortTextures = {
    Roof: ['roof-thatch', 'roof-red', 'roof-teal'],
    Lighthouse: 'lighthouse',
    Beam: 'lighthouse-beam',
    BuoyRed: 'buoy-red',
    BuoyGreen: 'buoy-green',
    PropBarrel: 'prop-barrel',
    PropCrate: 'prop-crate',
    Anchor: 'anchor-marker'
} as const;

const ROOFS: { base: number; shade: number; dark: number }[] = [
    { base: Palette.sand, shade: Palette.sandShade, dark: Palette.wetSand },
    { base: 0xd2493a, shade: 0xa8352a, dark: 0x6e2019 },
    { base: 0x3f9c95, shade: 0x2e7d7a, dark: 0x1f5755 }
];

/** Top-down gabled roof: lit north slope, shaded south slope, shingle rows. */
const makeRoof = (scene: Scene, key: string, c: (typeof ROOFS)[number], chimney: boolean): void => {
    const W = 26;
    const H = 20;
    const pc = new PixelCanvas(W + 3, H + 3);
    pc.rect(3, 3, W, H, Palette.ink, 0.35); // drop shadow
    pc.rect(0, 0, W, H, c.dark);
    const mid = Math.floor(H / 2);
    pc.rect(1, 1, W - 2, mid - 1, c.base);
    pc.rect(1, mid, W - 2, H - mid - 1, c.shade);
    for (let y = 3; y < H - 1; y += 3) {
        if (y === mid) continue;
        for (let x = 1 + (y % 2); x < W - 1; x += 4) pc.rect(x, y, 2, 1, c.dark);
    }
    pc.rect(1, mid - 1, W - 2, 1, Palette.woodDark); // ridge beam
    if (chimney) pc.rect(W - 7, 3, 3, 3, Palette.rockShade).px(W - 7, 3, Palette.rock);
    pc.toTexture(scene, key);
};

export const generatePortTextures = (scene: Scene): void => {
    ROOFS.forEach((c, i) => makeRoof(scene, PortTextures.Roof[i], c, i !== 0));

    // Lighthouse from above: striped tower ring with a glowing lamp.
    const L = 15;
    const lh = new PixelCanvas(L + 2, L + 2);
    const c = (L - 1) / 2;
    for (let y = 0; y < L; y++) {
        for (let x = 0; x < L; x++) {
            const d = Math.hypot(x - c, y - c);
            if (d > 7.2) continue;
            let col: number = Palette.woodDeep;
            if (d < 6.4) col = Math.floor(Math.atan2(y - c, x - c) / (Math.PI / 4) + 8) % 2 ? Palette.cream : Palette.flagRed;
            if (d < 3.6) col = Palette.rockShade;
            if (d < 2.4) col = Palette.gold;
            if (d < 1.2) col = Palette.foamWhite;
            lh.px(x, y, col);
        }
    }
    lh.toTexture(scene, PortTextures.Lighthouse);

    // Light beam: a soft dithered cone, origin at the left.
    const BW = 70;
    const BH = 22;
    const beam = new PixelCanvas(BW, BH);
    for (let x = 0; x < BW; x++) {
        const half = 1 + (x / BW) * (BH / 2 - 1);
        const a = 0.8 * (1 - x / BW);
        for (let y = 0; y < BH; y++) {
            const dy = Math.abs(y - BH / 2 + 0.5);
            if (dy > half) continue;
            if ((x + y) % 2 === 0 || dy < half * 0.5) beam.px(x, y, Palette.gold, a);
        }
    }
    beam.toTexture(scene, PortTextures.Beam);

    const buoy = (key: string, color: number) =>
        textureFromRows(scene, key, ['..ooo..', '.oCCCo.', 'oCwwwCo', 'oCwYwCo', 'oCwwwCo', '.oCCCo.', '..ooo..'], {
            o: Palette.woodDeep,
            C: color,
            w: Palette.foamWhite,
            Y: Palette.gold
        });
    buoy(PortTextures.BuoyRed, Palette.flagRed);
    buoy(PortTextures.BuoyGreen, Palette.grass);

    textureFromRows(scene, PortTextures.PropBarrel, ['.oooo.', 'odwwdo', 'owgwgo', 'owwlwo', 'odwwdo', '.oooo.'], {
        o: Palette.woodDeep,
        d: Palette.woodDark,
        w: Palette.wood,
        l: Palette.woodLight,
        g: Palette.rock
    });
    textureFromRows(scene, PortTextures.PropCrate, ['oooooo', 'olllll', 'oldwdl', 'olwdwl', 'oldwdl', 'olllll'], {
        o: Palette.woodDeep,
        d: Palette.woodDark,
        w: Palette.sandShade,
        l: Palette.woodLight
    });

    // Gold anchor with a dark drop shadow: the harbour marker.
    const anchor = ['...ooo...', '...o.o...', '...ooo...', '.ooooooo.', '....o....', 'o...o...o', 'oo..o..oo', '.oo.o.oo.', '..ooooo..'];
    const ap = new PixelCanvas(10, 10);
    ap.stamp(anchor, { o: Palette.woodDeep }, 1, 1).stamp(anchor, { o: Palette.gold });
    ap.toTexture(scene, PortTextures.Anchor);
};

/** Dock texture sized to the generated harbour (vertical, planks across). */
export const makeDockTexture = (scene: Scene, key: string, widthPx: number, lengthPx: number): void => {
    if (scene.textures.exists(key)) return;
    const W = widthPx + 4;
    const pc = new PixelCanvas(W, lengthPx);
    for (let y = 0; y < lengthPx; y += 3) {
        pc.rect(2, y, widthPx, 2, y % 9 === 0 ? Palette.wood : Palette.woodLight);
        pc.rect(2, y + 2, widthPx, 1, Palette.woodDark);
    }
    pc.rect(2, 0, 1, lengthPx, Palette.woodDeep).rect(W - 3, 0, 1, lengthPx, Palette.woodDeep);
    for (let y = 4; y < lengthPx - 2; y += 14) {
        pc.rect(0, y, 3, 3, Palette.woodDeep).px(1, y, Palette.woodDark);
        pc.rect(W - 3, y, 3, 3, Palette.woodDeep).px(W - 2, y, Palette.woodDark);
    }
    // Mooring bollards at the seaward end.
    pc.rect(3, lengthPx - 5, 2, 2, Palette.ink).rect(W - 5, lengthPx - 5, 2, 2, Palette.ink);
    pc.toTexture(scene, key);
};
