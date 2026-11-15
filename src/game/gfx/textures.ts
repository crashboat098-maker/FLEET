import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { createRng, PixelCanvas, textureFromRows } from './pixelCanvas';
import { generateItemTextures } from './itemTextures';
import { generatePortTextures } from './portTextures';
import { generateShipTextures } from './shipTextures';

/**
 * Procedurally generated placeholder art. Swap any of these for hand-made
 * sprite sheets later without touching scene code — keys stay the same.
 */
export const TextureKeys = {
    OceanTile: 'ocean-tile',
    Wave: 'wave',
    Sparkle: 'sparkle',
    Speck: 'speck',
    Island: 'island',
    Palm: 'palm',
    Dock: 'dock',
    Cloud: 'cloud',
    Button: 'btn',
    ButtonHover: 'btn-hover',
    ButtonDown: 'btn-down'
} as const;

const OCEAN_TILE = 64;

/** Seamless water tile with soft speckles and small crests. */
const makeOceanTile = (scene: Scene): void => {
    const pc = new PixelCanvas(OCEAN_TILE, OCEAN_TILE);
    const rng = createRng(1337);
    pc.rect(0, 0, OCEAN_TILE, OCEAN_TILE, Palette.seaMid);

    // Gentle diagonal banding gives the water some depth.
    for (let y = 0; y < OCEAN_TILE; y++) {
        for (let x = 0; x < OCEAN_TILE; x++) {
            const band =
                Math.sin(((x + y) / OCEAN_TILE) * Math.PI * 2) * 0.6 +
                Math.sin(((x * 2 - y) / OCEAN_TILE) * Math.PI * 2) * 0.4;
            if (band > 0.7 && rng() < 0.2) pc.px(x, y, Palette.sea);
            else if (rng() < 0.025) pc.px(x, y, Palette.sea);
            else if (rng() < 0.012) pc.px(x, y, Palette.shallows);
        }
    }

    // Small crest marks (wrap around edges so the tile stays seamless).
    const crest = (cx: number, cy: number) => {
        const pts: [number, number][] = [[0, 1], [1, 0], [2, 0], [3, 1], [4, 1], [5, 0]];
        pts.forEach(([dx, dy]) => pc.px((cx + dx) % OCEAN_TILE, (cy + dy) % OCEAN_TILE, Palette.shallows));
    };
    for (let i = 0; i < 6; i++) crest(Math.floor(rng() * OCEAN_TILE), Math.floor(rng() * OCEAN_TILE));

    pc.toTexture(scene, TextureKeys.OceanTile);
};

const makeWave = (scene: Scene): void =>
    textureFromRows(scene, TextureKeys.Wave, ['.##....', '#..#..#', '....##.'], { '#': Palette.foam });

const makeSparkle = (scene: Scene): void =>
    textureFromRows(scene, TextureKeys.Sparkle, ['.#.', '###', '.#.'], { '#': Palette.foamWhite });


const makeSpeck = (scene: Scene): void =>
    textureFromRows(scene, TextureKeys.Speck, ['##'], { '#': Palette.foamWhite });

/** Organic island blob: shallows ring, foam, beach, grass, a few rocks. */
const makeIsland = (scene: Scene): void => {
    const W = 120;
    const H = 80;
    const pc = new PixelCanvas(W, H);
    const rng = createRng(42);
    const cx = W / 2;
    const cy = H / 2;
    const rx = W * 0.36;
    const ry = H * 0.34;
    const p1 = rng() * 6;
    const p2 = rng() * 6;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const dx = (x - cx) / rx;
            const dy = (y - cy) / ry;
            const a = Math.atan2(dy, dx);
            const wobble = 1 + 0.12 * Math.sin(a * 3 + p1) + 0.07 * Math.sin(a * 5 + p2);
            const d = Math.sqrt(dx * dx + dy * dy) / wobble;

            if (d > 1.32) continue;
            if (d > 1.12) pc.px(x, y, Palette.lagoon, d > 1.24 ? 0.35 : 0.6);
            else if (d > 1.05) pc.px(x, y, Palette.foam);
            else if (d > 0.97) pc.px(x, y, Palette.wetSand);
            else if (d > 0.72) pc.px(x, y, (x + y) % 7 === 0 ? Palette.sandShade : Palette.sand);
            else if (d > 0.66) pc.px(x, y, Palette.sandShade);
            else pc.px(x, y, rng() < 0.08 ? Palette.leaf : Palette.grass);
        }
    }

    // A couple of boulders on the beach.
    const rock = (x: number, y: number) => {
        pc.rect(x, y, 4, 3, Palette.rock).rect(x + 1, y + 3, 3, 1, Palette.rockShade).px(x + 1, y, Palette.foamWhite);
    };
    rock(20, 46);
    rock(88, 28);
    rock(93, 33);

    pc.toTexture(scene, TextureKeys.Island);
};

/** Top-down palm crown with radiating fronds. */
const makePalm = (scene: Scene): void => {
    const S = 17;
    const c = 8;
    const pc = new PixelCanvas(S, S + 3);
    // Shadow under the crown.
    pc.rect(c - 3, c + 4, 9, 2, Palette.leafShade, 0.5);
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        for (let r = 1; r <= 7; r++) {
            const droop = r > 4 ? (r - 4) * 0.5 : 0;
            const x = c + Math.cos(a) * r;
            const y = c + Math.sin(a) * r * 0.85 + droop;
            pc.px(x, y + 1, Palette.leafShade);
            pc.px(x, y, r < 5 ? Palette.grass : Palette.leaf);
        }
    }
    pc.rect(c - 1, c - 1, 2, 2, Palette.trunk);
    pc.px(c - 1, c - 1, Palette.woodLight);
    pc.toTexture(scene, TextureKeys.Palm);
};

/** Short wooden jetty. */
const makeDock = (scene: Scene): void => {
    const W = 10;
    const H = 26;
    const pc = new PixelCanvas(W, H);
    for (let y = 0; y < H; y += 3) {
        pc.rect(1, y, W - 2, 2, Palette.woodLight).rect(1, y + 2, W - 2, 1, Palette.woodDark);
    }
    pc.rect(0, 0, 1, H, Palette.woodDeep).rect(W - 1, 0, 1, H, Palette.woodDeep);
    [2, 12, 22].forEach((y) => pc.rect(0, y, 2, 2, Palette.woodDark).rect(W - 2, y, 2, 2, Palette.woodDark));
    pc.toTexture(scene, TextureKeys.Dock);
};

const makeCloud = (scene: Scene): void => {
    const rows = [
        '.......####.........',
        '....########..###...',
        '..##################',
        '####################',
        '.##################.',
        '...############.....'
    ];
    textureFromRows(scene, TextureKeys.Cloud, rows, { '#': Palette.foamWhite });
};

/** Wooden plank button in three states. */
export const makeButton = (scene: Scene, key: string, fill: number, top: number, bottom: number, W = 104): void => {
    const H = 26;
    const pc = new PixelCanvas(W, H);
    pc.rect(1, 0, W - 2, H, Palette.woodDeep).rect(0, 1, W, H - 2, Palette.woodDeep);
    pc.rect(2, 2, W - 4, H - 4, fill);
    pc.rect(2, 2, W - 4, 1, top);
    pc.rect(2, H - 4, W - 4, 2, bottom);
    // Horizontal plank seam + grain.
    pc.rect(2, 12, W - 4, 1, bottom);
    for (let x = 14; x < W - 4; x += 23) pc.rect(x, 3, 6, 1, bottom);
    // Brass nails.
    [[4, 4], [W - 6, 4], [4, H - 7], [W - 6, H - 7]].forEach(([x, y]) =>
        pc.rect(x, y, 2, 2, Palette.goldShade).px(x, y, Palette.gold)
    );
    pc.toTexture(scene, key);
};

export const generateTextures = (scene: Scene): void => {
    makeOceanTile(scene);
    makeWave(scene);
    makeSparkle(scene);
    makeSpeck(scene);
    generateShipTextures(scene);
    generateItemTextures(scene);
    generatePortTextures(scene);
    makeIsland(scene);
    makePalm(scene);
    makeDock(scene);
    makeCloud(scene);
    makeButton(scene, TextureKeys.Button, Palette.wood, Palette.woodLight, Palette.woodDark);
    makeButton(scene, TextureKeys.ButtonHover, Palette.woodLight, Palette.sail, Palette.wood);
    makeButton(scene, TextureKeys.ButtonDown, Palette.woodDark, Palette.wood, Palette.woodDeep);
};
