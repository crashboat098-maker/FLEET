import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { createRng, textureFromRows } from './pixelCanvas';
import { Raster } from './Raster';

/**
 * Original pixel art for resources, shipwrecks, island inhabitants,
 * archers, shore chests and mermaids.
 */
export const WorldTextures = {
    Wood: 'item-wood',
    Iron: 'item-iron',
    Cloth: 'item-cloth',
    Survivor: 'item-survivor',
    Wreck: { small: 'wreck-small', merchant: 'wreck-merchant', galleon: 'wreck-galleon', pirate: 'wreck-pirate' },
    Arrow: 'fx-arrow',
    Note: 'fx-note',
    Rock: 'siren-rock',
    Mermaid: ['mermaid-a', 'mermaid-b'],
    ChestOpen: 'chest-open',
    ChestCommon: 'chest-common',
    ChestLegend: 'chest-legend',
    Bush: 'shore-bush'
} as const;

/** Inhabitant kinds and their palette (shirt, trousers, head/hat). */
export const PEOPLE = {
    villager: { shirt: 0xfdf3d6, legs: 0x8a5527, hat: 0x5a3415 },
    fisher: { shirt: 0x2a9fc0, legs: 0x5a3415, hat: 0xf2d58b },
    merchant: { shirt: 0xc8312b, legs: 0x3a200c, hat: 0xf7c843 },
    pirate: { shirt: 0x1b1020, legs: 0x5a3415, hat: 0xc8312b },
    guard: { shirt: 0x8a8c98, legs: 0x4f5160, hat: 0x4f5160 },
    tribe: { shirt: 0x6b8a2e, legs: 0x8a5527, hat: 0x4caf50 },
    archer: { shirt: 0x2e5a2a, legs: 0x3a200c, hat: 0x1d3a1a }
} as const;
export type PersonKind = keyof typeof PEOPLE;

export const personKey = (kind: PersonKind, frame: number) => `person-${kind}-${frame}`;

/** Top-down shipwreck: a listing hull, half under water, broken masts and torn sail. */
const wreck = (scene: Scene, key: string, len: number, beam: number, sail: number, seed: number) => {
    const W = beam * 2 + 10;
    const H = len + 6;
    const r = new Raster(W, H);
    const rng = createRng(seed);
    const cx = W / 2;
    for (let y = 0; y < len; y++) {
        const t = y / len;
        const hw = t < 0.3 ? beam * Math.pow(t / 0.3, 0.6) : beam * (t > 0.9 ? 0.85 : 1);
        for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
            const edge = Math.abs(x - cx) > hw - 1.2;
            // The stern half sinks: tinted toward water and broken up.
            const sunk = t > 0.55;
            if (sunk && rng() < (t - 0.55) * 1.6) continue;
            const base = edge ? Palette.woodDeep : y % 4 === 0 ? Palette.woodDark : 0x6a4a2a;
            r.set(x, y + 3, base, sunk ? 0.55 : 1);
            if (sunk) r.blend(x, y + 3, Palette.seaMid, 0.35);
        }
    }
    // Snapped mast lying across the deck and a torn sail.
    for (let i = 0; i < beam * 2 + 4; i++) r.blend(2 + i, 4 + Math.floor(len * 0.3) + Math.floor(i * 0.4), Palette.woodDeep);
    r.rect(Math.floor(cx - beam * 0.6), Math.floor(len * 0.45), Math.floor(beam * 1.3), 4, sail, 0.85);
    for (let i = 0; i < 8; i++) r.blend(cx - beam * 0.6 + rng() * beam * 1.3, len * 0.45 + rng() * 4, Palette.seaMid, 1);
    // Foam where water laps the wreck.
    for (let i = 0; i < len; i += 3) r.blend(cx + (rng() < 0.5 ? -1 : 1) * (beam + 1), i + 3, Palette.foam, 0.7);
    r.toTexture(scene, key);
};

/** A tiny person seen from above at an angle: hat/head, shirt, legs (two walk frames). */
const person = (scene: Scene, kind: PersonKind) => {
    const c = PEOPLE[kind];
    const colors = { h: c.hat, s: c.shirt, l: c.legs, k: 0xe8b48a, b: Palette.woodDark };
    const extra = kind === 'archer' ? 'b' : kind === 'guard' ? 'b' : '.';
    textureFromRows(scene, personKey(kind, 0), ['.hh.', '.kk.', `ss s`.replace(' ', 's'), `.ss${extra}`, '.l.l', '.l.l'], colors);
    textureFromRows(scene, personKey(kind, 1), ['.hh.', '.kk.', 'ssss', `.ss${extra}`, 'l..l', '.ll.'], colors);
};

export const generateWorldTextures = (scene: Scene): void => {
    const K = WorldTextures;
    // Resources: a lashed bundle of planks, iron ingots, and a rolled bolt of sailcloth.
    textureFromRows(scene, K.Wood, ['.ooooooo.', 'oLLLLLLLo', 'oWWWWWWWo', 'orrrrrrro', 'oLLLLLLLo', 'oWWWWWWWo', '.ooooooo.'], {
        o: Palette.woodDeep,
        L: Palette.woodLight,
        W: Palette.wood,
        r: Palette.sandShade
    });
    textureFromRows(scene, K.Iron, ['..ooooo..', '.oGGGGGo.', 'oGgGgGgGo', 'oooooooooo'.slice(0, 9), 'oGGgGgGGo', '.ooooooo.'], {
        o: 0x24242c,
        G: 0x6a6a76,
        g: 0x9a9caa
    });
    textureFromRows(scene, K.Cloth, ['..oooo...', '.oCCCCo..', 'oCcCcCCo.', 'oCCCCCCoo', 'oCcCcCCoO', '.oCCCCoo.', '..oooo...'], {
        o: Palette.woodDark,
        O: Palette.woodDark,
        C: 0xe8d8f0,
        c: 0xb06ad8
    });
    textureFromRows(scene, K.Survivor, ['..hh..', 'k.kk.k', '.ksskk', '..ss..', 'ffffff'], {
        h: Palette.woodDark,
        k: 0xe8b48a,
        s: Palette.cream,
        f: Palette.foamWhite
    });

    wreck(scene, K.Wreck.small, 24, 5, Palette.sail, 11);
    wreck(scene, K.Wreck.merchant, 34, 7, Palette.sailShade, 23);
    wreck(scene, K.Wreck.galleon, 46, 10, Palette.sail, 37);
    wreck(scene, K.Wreck.pirate, 38, 8, 0x3a3440, 51);

    (Object.keys(PEOPLE) as PersonKind[]).forEach((k) => person(scene, k));

    textureFromRows(scene, K.Arrow, ['w....', '.dddb', 'w....'], { w: Palette.cream, d: Palette.woodLight, b: 0x9a9caa });
    textureFromRows(scene, K.Note, ['..##', '..#.', '..#.', '###.', '##..'], { '#': 0x7fe0e8 });
    textureFromRows(scene, K.Rock, ['..oooo..', '.oRRRRo.', 'oRrRRRRo', 'oRRRrRRo', '.oRRRRo.', 'ffoooo ff'.slice(0, 8)], {
        o: 0x3a3a44,
        R: Palette.rock,
        r: 0x9a9caa,
        f: Palette.foam
    });
    // Mermaid on a rock: flowing hair, scaled tail that flicks between frames.
    const mermaidColors = { h: 0xc8312b, k: 0xe8b48a, t: 0x2e8b6e, T: 0x5fd0a8, f: 0x7fe0e8, s: 0xb06ad8 };
    textureFromRows(scene, K.Mermaid[0], ['.hhh....', 'hhkkh...', 'h.kk....', '..ss....', '..tTt...', '...tTt..', '....tTf.', '.....ff.'], mermaidColors);
    textureFromRows(scene, K.Mermaid[1], ['.hhh....', 'hhkkh...', 'h.kk....', '..ss....', '..tTt...', '..tTt...', '.tTt....', 'ff......'], mermaidColors);

    // Shore chests by rarity.
    textureFromRows(scene, K.ChestCommon, ['ooooooo', 'oWwWwWo', 'oooKooo', 'oWwWwWo', 'ooooooo'], { o: Palette.woodDeep, W: Palette.wood, w: Palette.woodLight, K: 0x9a9caa });
    textureFromRows(scene, K.ChestLegend, ['ooooooooo', 'oGYGYGYGo', 'oGGGkGGGo', 'oYGYGYGYo', 'ooooooooo'], { o: Palette.woodDeep, G: Palette.gold, Y: 0xffe27a, k: Palette.ink });
    textureFromRows(scene, K.ChestOpen, ['oGGGGGGGo', 'oYyYyYyYo', 'ooooooooo', 'oWwWwWwWo', 'ooooooooo'], { o: Palette.woodDeep, G: Palette.goldShade, Y: Palette.gold, y: 0xffe27a, W: Palette.wood, w: Palette.woodLight });
    textureFromRows(scene, K.Bush, ['..LLL..', '.LlLLL.', 'LLLlLLL', 'LlLLLlL', '.LLLLL.'], { L: Palette.leaf, l: Palette.grass });
};
