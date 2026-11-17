import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { ShipClassId } from '../ships/shipClasses';
import { createRng, mirrorRows, textureFromRows } from './pixelCanvas';
import { Raster } from './Raster';

/**
 * Pixel art for every ship class, authored bow-up (heading 0 = north).
 * Ships are layered: hull, damage overlays (cracks, flooding), sails per
 * mast at four tear levels, and a pirate flag.
 */

export interface ShipArt {
    cls: ShipClassId;
    hull: string;
    /** Hull texture size in art pixels. */
    width: number;
    length: number;
    /** Hull half-width (art px) of the widest section. */
    beam: number;
    /** Art-pixel rows of each mast (from the bow). */
    masts: number[];
    flagRow: number;
    cracks: [string, string];
    flood: string;
    /** Deck spots (art px from hull centre) where fires break out. */
    fireSpots: [number, number][];
}

export const FLAG_KEYS = ['ship-flag-a', 'ship-flag-b'] as const;
export const PENNANT_KEYS = ['ship-pennant-a', 'ship-pennant-b'] as const;
export const sailKey = (cls: ShipClassId, mast: number, full: boolean, torn: number) => `${cls}-sail${mast}-${full ? 'full' : 'slack'}-${torn}`;

// ------------------------------------------------------------------ sloop

const SLOOP_HALF = [
    '.......o', '.......d', '......od', '......od', '.....odl', '.....odw', '....odwl', '....odww', '...odwwl', '...odwlw',
    '..odwwwl', '..odwlww', '..odwwwl', '.odwwlww', '.odwwwwl', '.odwlwww', '.odwwwwl', '.odwwlww', '.odwwwhh', '.odwwlhh',
    '.odwwwwl', '.odwlwww', '..odwwwl', '..odDDDD', '..odCCCC', '..odCcCC', '..odCCCC', '..odDDDD', '...odddd', '....oooo'
];

// --------------------------------------------------------- hull generator

interface HullSpec {
    beam: number;
    length: number;
    trim: number;
    castleRows: number;
    cannonsPerSide: number;
    deck: number;
    deckLight: number;
}

const OUT = Palette.woodDeep;

/** Procedural hull: tapered bow, straight sides, square transom, planked deck. */
const buildHull = (spec: HullSpec, masts: number[]): Raster => {
    const pad = 2; // room for cannon barrels
    const W = spec.beam * 2 + 1 + pad * 2;
    const r = new Raster(W, spec.length);
    const cx = spec.beam + pad;
    const half = (y: number) => {
        const t = y / (spec.length - 1);
        if (t < 0.32) return Math.max(0, Math.round(spec.beam * Math.pow(t / 0.32, 0.62)));
        if (t > 0.9) return Math.round(spec.beam * 0.9);
        return spec.beam;
    };
    const castleStart = spec.length - spec.castleRows;
    for (let y = 0; y < spec.length; y++) {
        const hw = half(y);
        for (let dx = -hw; dx <= hw; dx++) {
            const x = cx + dx;
            const edge = Math.abs(dx) === hw || y === spec.length - 1;
            let c: number;
            if (edge) c = OUT;
            else if (Math.abs(dx) === hw - 1) c = y >= castleStart ? Palette.gold : spec.trim;
            else if (y >= castleStart) c = y === castleStart ? Palette.gold : (dx + y) % 2 ? Palette.woodDark : Palette.wood;
            else c = y % 7 === 0 ? Palette.woodDark : Math.abs(dx) % 3 === 0 ? spec.deckLight : spec.deck;
            r.set(x, y, c);
        }
    }
    // Stern-castle windows on the transom.
    for (let dx = -spec.beam + 3; dx <= spec.beam - 3; dx += 3) r.set(cx + dx, spec.length - 2, Palette.gold);
    // Cannons: dark ports on the rail with barrels poking out.
    const top = Math.round(spec.length * 0.36);
    const bottom = castleStart - 3;
    for (let i = 0; i < spec.cannonsPerSide; i++) {
        const y = Math.round(top + ((bottom - top) * (i + 0.5)) / spec.cannonsPerSide);
        const hw = half(y);
        for (const side of [-1, 1]) {
            r.set(cx + side * (hw - 1), y, Palette.ink);
            r.set(cx + side * (hw + 1), y, Palette.rockShade);
            r.set(cx + side * (hw + 2), y, Palette.rock);
        }
    }
    // Hatches and mast steps.
    r.rect(cx - 1, Math.round(spec.length * 0.55), 3, 3, Palette.woodDeep);
    for (const m of masts) r.set(cx, m, Palette.woodDeep);
    return r;
};

const sloopHull = (): Raster => {
    const rows = mirrorRows(SLOOP_HALF);
    const colors: Record<string, number> = {
        o: OUT,
        d: Palette.woodDark,
        w: Palette.wood,
        l: Palette.woodLight,
        h: Palette.woodDeep,
        D: Palette.woodDark,
        C: Palette.woodLight,
        c: Palette.gold
    };
    const r = new Raster(rows[0].length, rows.length);
    rows.forEach((row, y) => [...row].forEach((ch, x) => colors[ch] !== undefined && r.set(x, y, colors[ch])));
    r.set(7, 11, Palette.woodDeep);
    r.set(7, 27, Palette.woodDeep);
    return r;
};

// ----------------------------------------------------------------- sails

/** A square sail seen from above, bellied forward, hung from a yard. */
const buildSail = (halfSpan: number, depth: number, full: boolean, torn: number, seed: number, cloth = { sail: Palette.sail as number, shade: Palette.sailShade as number }): Raster => {
    const W = halfSpan * 2 + 1;
    const r = new Raster(W, depth);
    const c = halfSpan;
    const yardRow = depth - 1;
    for (let y = 0; y < yardRow; y++) {
        const t = (y + 1) / yardRow;
        const reach = full ? 0.5 + 0.5 * Math.sqrt(t) : t < 0.3 ? 0 : 0.35 + 0.65 * t;
        const hw = Math.round(halfSpan * reach);
        for (let dx = -hw; dx <= hw; dx++) {
            const shade = Math.abs(dx) >= hw - 1 || y === yardRow - 1;
            r.set(c + dx, y, shade ? cloth.shade : cloth.sail);
        }
    }
    for (let dx = -halfSpan; dx <= halfSpan; dx++) r.set(c + dx, yardRow, Palette.woodDark);
    r.set(c, yardRow, Palette.woodDeep);

    if (torn > 0) {
        const rng = createRng(seed + torn * 101);
        const holes = [0, 0.05, 0.14, 0.3][torn];
        const clear = (x: number, y: number) => {
            if (x < 0 || y < 0 || x >= W || y >= yardRow) return;
            const i = (y * W + x) * 4;
            r.data[i + 3] = 0;
        };
        for (let y = 0; y < yardRow; y++) for (let x = 0; x < W; x++) if (rng() < holes) clear(x, y);
        // A diagonal rip from heavy damage onward.
        if (torn >= 2) for (let i = 0; i < depth + 2; i++) clear(c + 2 + i, Math.round(i * 0.7));
        // Critical: a whole corner of the sail is gone.
        if (torn >= 3) for (let y = 0; y < yardRow; y++) for (let x = 0; x < Math.round(W * 0.35) - y; x++) clear(x, y);
    }
    return r;
};

// --------------------------------------------------------- damage overlays

const deckMask = (hull: Raster) => (x: number, y: number) => {
    const a = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < hull.w && yy < hull.h && hull.data[(yy * hull.w + xx) * 4 + 3] > 0;
    return a(x, y) && a(x - 1, y) && a(x + 1, y) && a(x, y - 1) && a(x, y + 1);
};

const buildCracks = (hull: Raster, count: number, seed: number): Raster => {
    const r = new Raster(hull.w, hull.h);
    const onDeck = deckMask(hull);
    const rng = createRng(seed);
    for (let i = 0; i < count * 8 && count > 0; i++) {
        let x = Math.floor(rng() * hull.w);
        let y = Math.floor(rng() * hull.h);
        if (!onDeck(x, y)) continue;
        const len = 3 + Math.floor(rng() * 6);
        for (let s = 0; s < len && onDeck(x, y); s++) {
            r.set(x, y, Palette.ink, 0.9);
            if (rng() < 0.3 && onDeck(x + 1, y)) r.set(x + 1, y, Palette.woodLight, 0.8); // splinter
            x += rng() < 0.5 ? -1 : 1;
            y += rng() < 0.7 ? 1 : 0;
        }
        if (--count <= 0) break;
    }
    return r;
};

const buildFlood = (hull: Raster, seed: number): Raster => {
    const r = new Raster(hull.w, hull.h);
    const onDeck = deckMask(hull);
    const rng = createRng(seed);
    for (let y = 0; y < hull.h; y++) {
        const t = y / hull.h;
        for (let x = 0; x < hull.w; x++) {
            if (!onDeck(x, y)) continue;
            // Water pools toward the stern, with scattered puddles further forward.
            const wet = t > 0.62 ? 0.75 : rng() < 0.08 ? 1 : 0;
            if (wet && (x + y) % 2 === 0) r.set(x, y, Palette.seaMid, 0.7);
            else if (wet && rng() < 0.3) r.set(x, y, Palette.shallows, 0.6);
        }
    }
    return r;
};

// ------------------------------------------------------------- registry

interface ClassArtSpec {
    cls: ShipClassId;
    hull: () => Raster;
    beam: number;
    masts: number[];
    sailSpan: number;
    sailDepth: number;
    flagRow: number;
    fireSpots: [number, number][];
    cloth?: { sail: number; shade: number };
}

const SPECS: ClassArtSpec[] = [
    {
        cls: 'sloop',
        hull: sloopHull,
        beam: 6,
        masts: [11],
        sailSpan: 10,
        sailDepth: 6,
        flagRow: 28,
        fireSpots: [[-2, -4], [3, 6], [-3, 9]]
    },
    {
        cls: 'brigantine',
        hull: () =>
            buildHull({ beam: 9, length: 42, trim: 0x8e2420, castleRows: 7, cannonsPerSide: 4, deck: Palette.wood, deckLight: Palette.woodLight }, [13, 27]),
        beam: 9,
        masts: [13, 27],
        sailSpan: 11,
        sailDepth: 6,
        flagRow: 39,
        fireSpots: [[-3, -6], [4, 1], [-4, 10]]
    },
    {
        cls: 'galleon',
        hull: () =>
            buildHull({ beam: 12, length: 54, trim: Palette.goldShade, castleRows: 12, cannonsPerSide: 1, deck: 0x7a4a22, deckLight: Palette.wood }, [13, 26, 38]),
        beam: 12,
        masts: [13, 26, 38],
        sailSpan: 13,
        sailDepth: 7,
        flagRow: 51,
        fireSpots: [[-4, -10], [5, 0], [-5, 12]]
    },
    {
        cls: 'corsair',
        hull: () =>
            buildHull({ beam: 10, length: 46, trim: Palette.flagRed, castleRows: 8, cannonsPerSide: 5, deck: 0x4a2a14, deckLight: Palette.woodDark }, [14, 30]),
        beam: 10,
        masts: [14, 30],
        sailSpan: 12,
        sailDepth: 7,
        flagRow: 43,
        fireSpots: [[-3, -7], [4, 2], [-4, 11]],
        // Black sails mark the rare pirate warship.
        cloth: { sail: 0x3a3440, shade: 0x26222c }
    }
];

const ARTS = new Map<ShipClassId, ShipArt>();

export const shipArt = (cls: ShipClassId): ShipArt => {
    const art = ARTS.get(cls);
    if (!art) throw new Error(`Ship art for ${cls} not generated yet`);
    return art;
};

export const generateShipTextures = (scene: Scene): void => {
    for (const spec of SPECS) {
        const hull = spec.hull();
        const key = `${spec.cls}-hull`;
        hull.toTexture(scene, key);
        spec.masts.forEach((_, i) => {
            for (const full of [true, false]) {
                for (let torn = 0; torn < 4; torn++) {
                    buildSail(spec.sailSpan, spec.sailDepth, full, torn, i * 13 + spec.cls.length, spec.cloth).toTexture(scene, sailKey(spec.cls, i, full, torn));
                }
            }
        });
        const cracks: [string, string] = [`${spec.cls}-cracks-1`, `${spec.cls}-cracks-2`];
        buildCracks(hull, 3, 7).toTexture(scene, cracks[0]);
        buildCracks(hull, 9, 7).toTexture(scene, cracks[1]);
        const flood = `${spec.cls}-flood`;
        buildFlood(hull, 11).toTexture(scene, flood);
        ARTS.set(spec.cls, {
            cls: spec.cls,
            hull: key,
            width: hull.w,
            length: hull.h,
            beam: spec.beam,
            masts: spec.masts,
            flagRow: spec.flagRow,
            cracks,
            flood,
            fireSpots: spec.fireSpots
        });
    }

    // Black pirate flag with a tiny white skull, streaming aft.
    const flagColors = { k: Palette.ink, w: Palette.foamWhite };
    textureFromRows(scene, FLAG_KEYS[0], ['kkk', 'kwk', 'kkk', '.k.'], flagColors);
    textureFromRows(scene, FLAG_KEYS[1], ['kkk', 'kwk', 'kk.', 'k..'], flagColors);
    // White pennant, tinted per faction.
    textureFromRows(scene, PENNANT_KEYS[0], ['ww', 'ww', 'w.', 'w.'], { w: 0xffffff });
    textureFromRows(scene, PENNANT_KEYS[1], ['ww', 'w.', 'ww', '.w'], { w: 0xffffff });

    // Sinking debris and water effects.
    textureFromRows(scene, 'fx-plank', ['lllll', 'ddddd'], { l: Palette.woodLight, d: Palette.woodDark });
    textureFromRows(scene, 'fx-splinter', ['ll.', '.dd'], { l: Palette.woodLight, d: Palette.woodDark });
    textureFromRows(scene, 'fx-bubble', ['.#.', '#.#', '.#.'], { '#': Palette.foamWhite });
    textureFromRows(scene, 'fx-splash', ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'], { '#': Palette.foam });
    textureFromRows(scene, 'fx-steam', ['..#..', '.###.', '#####', '.###.', '..#..'], { '#': 0xe8f4f8 });
    textureFromRows(scene, 'fx-ember', ['#'], { '#': 0xffb347 });
    // Mouse destination marker.
    generateRingTexture(scene);
    textureFromRows(scene, 'fx-target', ['.##.##.', '#.....#', '#..#..#', '..###..', '#..#..#', '#.....#', '.##.##.'], { '#': Palette.gold });
};

/** Thin elliptical water ring for sinking ripples (large enough to scale up crisply). */
export const generateRingTexture = (scene: Scene): void => {
    const W = 41;
    const H = 21;
    const r = new Raster(W, H);
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const d = Math.hypot((x - (W - 1) / 2) / ((W - 1) / 2), (y - (H - 1) / 2) / ((H - 1) / 2));
            if (Math.abs(d - 0.92) < 0.08) r.set(x, y, Palette.foam, 0.9);
        }
    r.toTexture(scene, 'fx-ring');
};
