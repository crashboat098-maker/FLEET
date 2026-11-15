import { PIXEL_SCALE } from '../config/constants';
import { Palette } from '../config/palette';
import { createRng } from '../gfx/pixelCanvas';
import { Raster } from '../gfx/Raster';
import { Island, IslandKind } from './Island';
import { bayer, hash, valueNoise } from './noise';
import { Circle } from './WorldGenerator';
import { SHALLOW_HALO } from './worldConfig';

/**
 * Procedural art definition for one island, in island-local art pixels
 * (1 art pixel = PIXEL_SCALE world units). Nothing is rasterised here —
 * the TerrainStreamer asks for tiles on demand via `shade()` + `stamps`.
 */

/** A decoration painted onto terrain tiles it overlaps. Coordinates: island art px. */
export interface Stamp {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    draw(r: Raster, ox: number, oy: number): void;
}

/** Animated sprite effects attached to an island while it is near the camera. */
export interface FxSpec {
    kind: 'smoke' | 'lavaGlow' | 'fire' | 'eyeGlow';
    x: number;
    y: number;
    scale?: number;
}

interface WaterStyle {
    coral: number;
    rocks: number;
    lagoon: number;
    shallows: number;
    rockColor: number;
}

const WATER: Record<IslandKind, WaterStyle> = {
    tropical: { coral: 1, rocks: 1, lagoon: Palette.lagoon, shallows: Palette.shallows, rockColor: Palette.rockShade },
    basic: { coral: 0.45, rocks: 1.3, lagoon: Palette.lagoon, shallows: Palette.shallows, rockColor: Palette.rockShade },
    jungle: { coral: 0.8, rocks: 1, lagoon: 0x3fb8a8, shallows: 0x2a9fa8, rockColor: Palette.rockShade },
    volcanic: { coral: 0, rocks: 2.2, lagoon: 0x3d8a96, shallows: 0x2c7392, rockColor: 0x2a2930 },
    skull: { coral: 0, rocks: 1.8, lagoon: 0x3f7f86, shallows: 0x2d6a80, rockColor: 0x2e2a36 }
};

const CORAL = [0xff7a8a, 0xff9f43, 0xb06ad8, 0xffd166];
const CONE = [0x2e2228, 0x3f2e2c, 0x523a33, 0x67493b, 0x7d5a44];
const LAVA_HOT = 0xffd23f;
const LAVA = 0xff7a1a;
const LAVA_EDGE = 0xb3321a;
const BONE = 0xd9d2bf;
const BONE_LIGHT = 0xefe9d8;
const BONE_DARK = 0xa89f8a;
const CREVICE = 0x1b1020;

const S = PIXEL_SCALE;

export class IslandArt {
    /** World position of art pixel (0,0). */
    readonly left: number;
    readonly top: number;
    /** Size in art pixels. */
    readonly W: number;
    readonly H: number;
    /** Art-pixel radius beyond which nothing is drawn. */
    readonly reach: number;
    readonly cx: number;
    readonly cy: number;
    readonly stamps: Stamp[] = [];
    readonly palms: { x: number; y: number }[] = [];
    readonly fx: FxSpec[] = [];

    private readonly water: WaterStyle;
    private readonly seed: number;
    /** Volcano cone (art px), volcanic islands only. */
    private cone: { x: number; y: number; r: number } | null = null;

    constructor(readonly island: Island, private readonly exclude: Circle[] = []) {
        const ext = Math.ceil(island.boundRadius + SHALLOW_HALO + 8);
        this.left = island.x - ext;
        this.top = island.y - ext;
        this.W = Math.ceil((ext * 2) / S);
        this.H = this.W;
        this.reach = (island.boundRadius + SHALLOW_HALO + 4) / S;
        this.cx = (island.x - this.left) / S;
        this.cy = (island.y - this.top) / S;
        this.water = WATER[island.kind];
        this.seed = island.seed;

        if (island.kind === 'volcanic') {
            const main = island.blobs[0];
            this.cone = { x: (main.x - this.left) / S, y: (main.y - this.top) / S, r: (main.maxRadius * 0.5) / S };
        }
        this.plan();
    }

    // ------------------------------------------------------------------ queries

    worldX(px: number): number {
        return this.left + (px + 0.5) * S;
    }

    worldY(py: number): number {
        return this.top + (py + 0.5) * S;
    }

    edgeAt(px: number, py: number): number {
        return this.island.edge(this.worldX(px), this.worldY(py), SHALLOW_HALO + 1);
    }

    private sandWidth(px: number, py: number): number {
        const n = valueNoise(px / 14, py / 14, this.seed);
        switch (this.island.kind) {
            case 'basic':
                return 8 + 10 * n;
            case 'jungle':
                return 10 + 12 * n;
            case 'volcanic':
                return 10 + 16 * n;
            case 'skull':
                return 8 + 12 * n;
            default:
                return 14 + 18 * n;
        }
    }

    /** Paint one art pixel of this island into `out` at (rx, ry). Transparent pixels are skipped. */
    shade(px: number, py: number, out: Raster, rx: number, ry: number): void {
        const dx = px + 0.5 - this.cx;
        const dy = py + 0.5 - this.cy;
        if (dx * dx + dy * dy > this.reach * this.reach) return;
        const e = this.edgeAt(px, py);
        if (e > SHALLOW_HALO) return;
        const b = bayer(px, py);
        if (e > 0) this.shadeWater(px, py, e, b, out, rx, ry);
        else this.shadeLand(px, py, e, b, out, rx, ry);
    }

    private shadeWater(px: number, py: number, e: number, b: number, out: Raster, rx: number, ry: number): void {
        const w = this.water;
        const seed = this.seed;
        if (e < 3) return out.set(rx, ry, Palette.foamWhite, 0.95);
        if (e < 7 && b < 0.55) return out.set(rx, ry, Palette.foam, 0.8);
        const clump = valueNoise(px / 9, py / 9, seed + 7);
        if (w.coral > 0 && e > 12 && e < SHALLOW_HALO * 0.8 && clump > 1 - 0.3 * w.coral && valueNoise(px / 2.5, py / 2.5, seed + 3) > 0.42) {
            const tint = CORAL[Math.floor(valueNoise(px / 6, py / 6, seed + 11) * CORAL.length)];
            return out.set(rx, ry, hash(px, py, seed) < 0.1 ? Palette.foam : tint, 0.85);
        }
        if (e > 10 && clump < 0.16 * w.rocks && valueNoise(px / 2.5, py / 2.5, seed + 5) > 0.5) {
            return out.set(rx, ry, w.rockColor, 0.6);
        }
        const level = Math.floor((1 - e / SHALLOW_HALO) * 3.2 + b - 0.5);
        if (level >= 3) out.set(rx, ry, w.lagoon, 0.9);
        else if (level === 2) out.set(rx, ry, w.lagoon, 0.62);
        else if (level === 1) out.set(rx, ry, w.shallows, 0.5);
        else if (level === 0 && b < 0.5) out.set(rx, ry, w.shallows, 0.3);
    }

    private shadeLand(px: number, py: number, e: number, b: number, out: Raster, rx: number, ry: number): void {
        const seed = this.seed;
        const sw = this.sandWidth(px, py);
        const beach = e > -sw || (e > -sw - 3 && b < 0.5);
        const kind = this.island.kind;

        // Volcano cone overrides everything inside its radius.
        if (this.cone) {
            const cdx = px + 0.5 - this.cone.x;
            const cdy = py + 0.5 - this.cone.y;
            const d = Math.sqrt(cdx * cdx + cdy * cdy);
            const t = d / this.cone.r;
            if (t < 1 && e < -6) {
                if (t < 0.11) return out.set(rx, ry, valueNoise(px / 2, py / 2, seed + 1) > 0.55 ? LAVA_HOT : LAVA);
                if (t < 0.16) return out.set(rx, ry, t < 0.13 ? LAVA_EDGE : 0x241a20);
                // Lit from the top-left; alternating rings read as elevation.
                const light = d > 0 ? (-cdx - cdy) / (d * Math.SQRT2) : 0;
                const ring = Math.floor(t * 8) % 2 ? 0.35 : -0.35;
                const fade = t > 0.85 ? (t - 0.85) * 6 : 0; // blend into the surrounding ash
                const idx = Math.round(2 + light * 1.6 + ring + b - 0.5 - fade);
                return out.set(rx, ry, CONE[Math.max(0, Math.min(4, idx))]);
            }
        }

        switch (kind) {
            case 'volcanic': {
                if (e > -4) return out.set(rx, ry, 0x22222a);
                if (beach) return out.set(rx, ry, hash(px, py, seed + 3) < 0.12 ? 0x5a5866 : 0x3b3a44);
                const n = valueNoise(px / 7, py / 7, seed + 2);
                if (valueNoise(px / 5, py / 5, seed + 9) > 0.8) return out.set(rx, ry, 0x4d5a36);
                return out.set(rx, ry, n > 0.62 ? 0x5d5866 : n < 0.3 ? 0x3a3640 : 0x4f4a57);
            }
            case 'skull': {
                if (e > -4) return out.set(rx, ry, 0x5e5446);
                if (beach) return out.set(rx, ry, hash(px, py, seed + 3) < 0.1 ? 0x7a6e5c : 0x8f826e);
                const n = valueNoise(px / 7, py / 7, seed + 2);
                const g = valueNoise(px / 6, py / 6, seed + 4);
                if (g > 0.72) return out.set(rx, ry, g > 0.8 ? 0x5a5a38 : 0x6b6a45);
                return out.set(rx, ry, n > 0.65 ? 0x575062 : n < 0.22 ? 0x332d3a : 0x4a4352);
            }
            case 'jungle': {
                if (e > -4) return out.set(rx, ry, Palette.wetSand);
                if (beach) return out.set(rx, ry, hash(px, py, seed + 3) < 0.08 ? Palette.sandShade : Palette.sand);
                if (e > -sw - 6) return out.set(rx, ry, Palette.grass);
                const v = valueNoise(px / 3.5, py / 3.5, seed + 21) * 0.65 + valueNoise(px / 12, py / 12, seed + 22) * 0.35;
                return out.set(rx, ry, v > 0.62 ? Palette.grass : v > 0.47 ? Palette.leaf : v > 0.33 ? Palette.leafShade : 0x123f1f);
            }
            case 'basic': {
                if (e > -4) return out.set(rx, ry, Palette.wetSand);
                if (beach) return out.set(rx, ry, hash(px, py, seed + 3) < 0.08 ? Palette.sandShade : Palette.sand);
                const r = valueNoise(px / 7, py / 7, seed + 6);
                if (r > 0.78) return out.set(rx, ry, b < 0.5 ? Palette.rock : 0x9a9caa);
                if (r > 0.74) return out.set(rx, ry, Palette.rockShade);
                return out.set(rx, ry, hash(px, py, seed + 9) < 0.07 ? 0x7ccf6a : 0x5cb85c);
            }
            default: {
                if (e > -4) return out.set(rx, ry, Palette.wetSand);
                if (beach) return out.set(rx, ry, hash(px, py, seed + 3) < 0.08 ? Palette.sandShade : Palette.sand);
                const inner = -e - sw;
                const n = valueNoise(px / 6, py / 6, seed + 5);
                let c: number = Palette.grass;
                if (inner > 26 && n > 0.48) c = n > 0.7 ? Palette.leafShade : Palette.leaf;
                else if (hash(px, py, seed + 9) < 0.06) c = Palette.leaf;
                else if (hash(px, py, seed + 13) < 0.004) c = hash(px, py, 1) < 0.5 ? Palette.flagRed : Palette.gold;
                return out.set(rx, ry, c);
            }
        }
    }

    // ----------------------------------------------------------------- planning

    private excluded(px: number, py: number): boolean {
        const wx = this.worldX(px);
        const wy = this.worldY(py);
        return this.exclude.some((c) => Math.hypot(c.x - wx, c.y - wy) < c.r);
    }

    /** Random land/water sample positions matching a predicate (on edge distance & sand width). */
    private sample(rng: () => number, tries: number, max: number, ok: (e: number, sw: number, px: number, py: number) => boolean, spacing = 0) {
        const pts: { px: number; py: number }[] = [];
        for (let i = 0; i < tries && pts.length < max; i++) {
            const px = Math.floor(rng() * this.W);
            const py = Math.floor(rng() * this.H);
            const e = this.edgeAt(px, py);
            if (e > SHALLOW_HALO) continue;
            if (!ok(e, this.sandWidth(px, py), px, py)) continue;
            if (this.excluded(px, py)) continue;
            if (spacing && pts.some((p) => Math.abs(p.px - px) < spacing && Math.abs(p.py - py) < spacing)) continue;
            pts.push({ px, py });
        }
        return pts;
    }

    private addStamp(x0: number, y0: number, x1: number, y1: number, draw: Stamp['draw']): void {
        this.stamps.push({ x0, y0, x1, y1, draw });
    }

    private plan(): void {
        const rng = createRng(this.seed ^ 0x5eed);
        const area = this.W * this.H;
        const kind = this.island.kind;
        const size = this.island.size;
        const onGrass = (gap: number) => (e: number, sw: number) => e < -sw - gap;
        const onBeach = (e: number, sw: number) => e < -3 && e > -sw + 2;
        const inShallows = (e: number) => e > 8 && e < 26;

        // Boulders on the beach and in the shallows (all kinds).
        const dark = kind === 'volcanic' || kind === 'skull';
        for (const p of this.sample(rng, 4 + area / 2500, 4 + area / 6000, (e, sw) => onBeach(e, sw) || inShallows(e))) {
            this.boulder(p.px, p.py, 2 + Math.floor(rng() * 3), this.edgeAt(p.px, p.py) > 0, dark);
        }

        if (kind === 'tropical') {
            for (const p of this.sample(rng, area / 900, area / 900, onGrass(6))) this.bush(p.px, p.py);
            const palms = { tiny: 1, small: 4, medium: 9, large: 16, huge: 24 }[size];
            this.addPalms(rng, palms, (e, sw) => e < -8 && e > -sw - 40);
        } else if (kind === 'basic') {
            for (const p of this.sample(rng, area / 700, area / 1400, onGrass(5), 6)) this.roundTree(p.px, p.py, 3 + Math.floor(rng() * 3));
            for (const p of this.sample(rng, area / 3000, area / 3000, onGrass(2))) this.boulder(p.px, p.py, 3 + Math.floor(rng() * 3), false, false);
            const palms = size === 'tiny' ? (rng() < 0.6 ? 1 : 0) : Math.floor(rng() * 3);
            this.addPalms(rng, palms, (e, sw) => e < -6 && e > -sw - 10);
        } else if (kind === 'jungle') {
            this.planJungle(rng, area);
        } else if (kind === 'volcanic') {
            this.planVolcano(rng);
        } else if (kind === 'skull') {
            this.planSkull(rng, area);
        }
    }

    private addPalms(rng: () => number, count: number, ok: (e: number, sw: number) => boolean): void {
        for (const p of this.sample(rng, 400, count, ok, 12)) this.palms.push({ x: this.worldX(p.px), y: this.worldY(p.py) });
    }

    // ---------------------------------------------------------- kind-specific

    private planJungle(rng: () => number, area: number): void {
        const canopy = (gap: number) => (e: number, sw: number) => e < -sw - gap;

        // Rivers wind from the interior down to the sea.
        for (let i = 0; i < 3; i++) {
            const [start] = this.sample(rng, 300, 1, (e) => e < -320);
            if (start) this.river(rng, start.px, start.py);
        }

        // Pick hidden clearings first so trees can stay out of them...
        const clearings = this.sample(rng, 600, 3, (e) => e < -200, 60);

        // Tall emergent trees poke out of the canopy.
        for (const p of this.sample(rng, area / 350, area / 650, canopy(10), 7)) {
            if (clearings.some((c) => Math.hypot(c.px - p.px, c.py - p.py) < 34)) continue;
            this.roundTree(p.px, p.py, 5 + Math.floor(rng() * 4), 0x123f1f, Palette.leaf, Palette.grass);
        }
        // ...then paint them on top: a hut and a campfire in each.
        for (const c of clearings) this.clearing(rng, c.px, c.py);
        this.addPalms(rng, 30, (e, sw) => e < -5 && e > -sw - 4);
    }

    private planVolcano(rng: () => number): void {
        const cone = this.cone!;
        const craterWorld = { x: this.left + cone.x * S, y: this.top + cone.y * S };
        // Lava flows spill from the crater rim toward the sea.
        const flows = 3 + Math.floor(rng() * 2);
        for (let i = 0; i < flows; i++) {
            const a = (i / flows) * Math.PI * 2 + rng() * 0.8;
            this.lavaFlow(rng, cone.x + Math.cos(a) * cone.r * 0.13, cone.y + Math.sin(a) * cone.r * 0.13, a);
        }
        this.fx.push({ kind: 'lavaGlow', ...craterWorld, scale: Math.max(1, (cone.r * 0.3) / 8) });
        this.fx.push({ kind: 'smoke', x: craterWorld.x - 6, y: craterWorld.y - 4, scale: 1.4 });
        this.fx.push({ kind: 'smoke', x: craterWorld.x + 8, y: craterWorld.y + 2, scale: 1 });
    }

    private planSkull(rng: () => number, area: number): void {
        const k = 1.5;
        this.skullRock(this.cx, this.cy, k);
        const eyeY = this.worldY(this.cy + 2 * k);
        this.fx.push({ kind: 'eyeGlow', x: this.worldX(this.cx - 13 * k), y: eyeY });
        this.fx.push({ kind: 'eyeGlow', x: this.worldX(this.cx + 13 * k), y: eyeY });

        // Fire pits ring the skull.
        let placed = 0;
        for (let i = 0; i < 24 && placed < 5; i++) {
            const a = (i / 24) * Math.PI * 2 + rng() * 0.2;
            const d = 70 + rng() * 40;
            const px = Math.round(this.cx + Math.cos(a) * d);
            const py = Math.round(this.cy + Math.sin(a) * d);
            if (this.edgeAt(px, py) > -30) continue;
            if (i % 5 !== 0 && placed > 0 && rng() < 0.5) continue;
            this.firePit(px, py);
            this.fx.push({ kind: 'fire', x: this.worldX(px), y: this.worldY(py) - 3 });
            this.fx.push({ kind: 'smoke', x: this.worldX(px), y: this.worldY(py) - 8, scale: 0.6 });
            placed++;
        }
        for (const p of this.sample(rng, area / 1500, area / 3000, (e, sw) => e < -sw - 4, 8)) {
            if (Math.hypot(p.px - this.cx, p.py - this.cy) < 85) continue;
            this.deadTree(p.px, p.py, rng);
        }
    }

    // ------------------------------------------------------------ decorations

    private bush(px: number, py: number): void {
        this.addStamp(px - 2, py - 2, px + 4, py + 3, (r, ox, oy) => {
            const x = px + ox;
            const y = py + oy;
            r.rect(x - 2, y + 1, 6, 2, Palette.leafShade, 0.6)
                .rect(x - 2, y - 1, 5, 3, Palette.leaf)
                .rect(x - 1, y - 2, 3, 1, Palette.leaf);
            r.blend(x - 1, y - 1, Palette.grass);
            r.blend(x + 1, y - 2, Palette.grass);
        });
    }

    private boulder(px: number, py: number, w: number, wet: boolean, dark: boolean): void {
        const base = dark ? 0x3a3640 : Palette.rock;
        const shade = dark ? 0x242129 : Palette.rockShade;
        this.addStamp(px - 1, py, px + w + 2, py + 3, (r, ox, oy) => {
            const x = px + ox;
            const y = py + oy;
            r.rect(x, y + 1, w + 1, 2, shade).rect(x, y, w, 2, base);
            r.blend(x, y, dark ? 0x6a6470 : Palette.foamWhite);
            if (wet) r.rect(x - 1, y + 2, w + 3, 1, Palette.foam, 0.7);
        });
    }

    /** Round canopy tree with drop shadow, lit from the top-left. */
    private roundTree(px: number, py: number, rad: number, dark: number = Palette.leafShade, mid: number = Palette.leaf, light: number = Palette.grass): void {
        this.addStamp(px - rad - 1, py - rad - 1, px + rad + 3, py + rad + 3, (r, ox, oy) => {
            const x = px + ox;
            const y = py + oy;
            r.disc(x + 2, y + 2, rad, Palette.ink, 0.3);
            r.disc(x, y, rad, mid);
            for (let yy = -rad; yy <= rad; yy++)
                for (let xx = -rad; xx <= rad; xx++) {
                    if (xx * xx + yy * yy > rad * rad) continue;
                    if (xx + yy > rad * 0.7) r.blend(x + xx, y + yy, dark);
                }
            r.disc(x - rad * 0.35, y - rad * 0.35, rad * 0.45, light);
        });
    }

    private deadTree(px: number, py: number, rng: () => number): void {
        const branches = Array.from({ length: 4 }, () => ({ a: rng() * Math.PI * 2, l: 3 + rng() * 3 }));
        this.addStamp(px - 7, py - 7, px + 8, py + 8, (r, ox, oy) => {
            const x = px + ox;
            const y = py + oy;
            r.rect(x + 1, y + 1, 2, 2, Palette.ink, 0.3);
            for (const b of branches) {
                for (let t = 0; t <= b.l; t++) r.blend(x + Math.cos(b.a) * t, y + Math.sin(b.a) * t, t < 2 ? 0x5a4a3a : 0x7a6a58);
            }
            r.rect(x - 1, y - 1, 2, 2, 0x4a3a2c);
        });
    }

    private firePit(px: number, py: number): void {
        this.addStamp(px - 5, py - 5, px + 6, py + 6, (r, ox, oy) => {
            const x = px + ox;
            const y = py + oy;
            r.disc(x, y, 4.5, 0x6a6470).disc(x, y, 3, 0x241a20).disc(x, y, 1.6, LAVA_EDGE);
        });
    }

    private clearing(rng: () => number, px: number, py: number): void {
        const rad = 14 + Math.floor(rng() * 8);
        const seed = this.seed;
        this.addStamp(px - rad - 1, py - rad - 1, px + rad + 2, py + rad + 2, (r, ox, oy) => {
            for (let yy = -rad; yy <= rad; yy++)
                for (let xx = -rad; xx <= rad; xx++) {
                    const d = Math.sqrt(xx * xx + yy * yy) / rad;
                    if (d > 1 || (d > 0.8 && bayer(xx + px, yy + py) > (1 - d) * 5)) continue;
                    r.blend(px + xx + ox, py + yy + oy, hash(px + xx, py + yy, seed) < 0.1 ? 0x7ccf6a : 0x5cb85c);
                }
            // Thatched hut and a stone fire ring.
            const hx = px - 6 + ox;
            const hy = py - 6 + oy;
            r.rect(hx + 2, hy + 2, 11, 9, Palette.ink, 0.35)
                .rect(hx, hy, 11, 9, Palette.wetSand)
                .rect(hx + 1, hy + 1, 9, 3, Palette.sand)
                .rect(hx + 1, hy + 4, 9, 4, Palette.sandShade)
                .rect(hx + 1, hy + 4, 9, 1, Palette.woodDark);
            r.disc(px + 6 + ox, py + 5 + oy, 2.5, 0x6a6470).disc(px + 6 + ox, py + 5 + oy, 1.4, 0x241a20);
        });
        this.fx.push({ kind: 'fire', x: this.worldX(px + 6), y: this.worldY(py + 5) - 3, scale: 0.8 });
    }

    /** Polyline stamp helper: draws discs along `pts`. */
    private pathStamp(pts: { x: number; y: number; w: number }[], paint: (r: Raster, x: number, y: number, w: number) => void): void {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of pts) {
            x0 = Math.min(x0, p.x - p.w - 2);
            y0 = Math.min(y0, p.y - p.w - 2);
            x1 = Math.max(x1, p.x + p.w + 2);
            y1 = Math.max(y1, p.y + p.w + 2);
        }
        this.addStamp(x0, y0, x1, y1, (r, ox, oy) => {
            for (const p of pts) paint(r, p.x + ox, p.y + oy, p.w);
        });
    }

    /** Random walk from (x,y) heading outward until it reaches water. */
    private walkToSea(rng: () => number, x: number, y: number, angle: number, wiggle: number): { x: number; y: number }[] {
        const pts = [{ x, y }];
        let a = angle;
        for (let i = 0; i < 1500; i++) {
            const out = Math.atan2(y - this.cy, x - this.cx);
            // Drift back toward "downhill" (away from the centre) so paths reach the coast.
            let diff = out - a;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            a += diff * 0.08 + (rng() - 0.5) * wiggle;
            x += Math.cos(a) * 1.5;
            y += Math.sin(a) * 1.5;
            pts.push({ x, y });
            if (this.edgeAt(Math.round(x), Math.round(y)) > 2) break;
        }
        return pts;
    }

    private river(rng: () => number, px: number, py: number): void {
        const raw = this.walkToSea(rng, px, py, Math.atan2(py - this.cy, px - this.cx), 0.7);
        const pts = raw.map((p, i) => ({ x: p.x, y: p.y, w: 1.2 + (i / raw.length) * 2.8 }));
        this.pathStamp(pts, (r, x, y, w) => r.disc(x, y, w + 1, Palette.wetSand));
        this.pathStamp(pts, (r, x, y, w) => r.disc(x, y, w, Palette.shallows).disc(x, y, Math.max(0.6, w - 1.2), Palette.seaMid));
    }

    private lavaFlow(rng: () => number, px: number, py: number, angle: number): void {
        const raw = this.walkToSea(rng, px, py, angle, 0.5);
        const pts = raw.map((p, i) => ({ x: p.x, y: p.y, w: 2.2 - (i / raw.length) * 0.8 }));
        this.pathStamp(pts, (r, x, y, w) => r.disc(x, y, w + 0.8, 0x241a20));
        this.pathStamp(pts, (r, x, y, w) => {
            r.disc(x, y, w, LAVA_EDGE).disc(x, y, w * 0.6, LAVA);
            if (hash(Math.round(x), Math.round(y), 5) < 0.3) r.blend(x, y, LAVA_HOT);
        });
    }

    /** A colossal skull carved into rock, seen from above. `k` scales it up. */
    private skullRock(cx: number, cy: number, k: number): void {
        const inCranium = (u: number, v: number) => (u / 32) ** 2 + ((v + 8) / 28) ** 2 <= 1;
        const inJaw = (u: number, v: number) => (u / 21) ** 2 + ((v - 20) / 13) ** 2 <= 1;
        const inShape = (u: number, v: number) => inCranium(u, v) || inJaw(u, v);
        const inEye = (u: number, v: number) => ((Math.abs(u) - 13) / 9) ** 2 + ((v - 2) / 8) ** 2 <= 1;
        const inEyeCore = (u: number, v: number) => ((Math.abs(u) - 13) / 3.5) ** 2 + ((v - 3) / 3.5) ** 2 <= 1;
        const inNose = (u: number, v: number) => v >= 9 && v <= 17 && Math.abs(u) <= (v - 8) * 0.5;
        const inTeeth = (u: number, v: number) => v >= 22 && v <= 30 && Math.abs(u) < 16 && (Math.round(u + 16) % 4 === 0 || v === 26);
        const seed = this.seed;
        const hw = 34 * k;
        const x0 = Math.floor(cx - hw);
        const y0 = Math.floor(cy - 38 * k);
        const x1 = Math.ceil(cx + hw + 6);
        const y1 = Math.ceil(cy + 36 * k + 6);

        this.addStamp(x0, y0, x1, y1, (r, ox, oy) => {
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const u = (x - cx) / k;
                    const v = (y - cy) / k;
                    if (!inShape(u, v)) {
                        // Cast shadow down-right.
                        if (inShape(u - 4 / k, v - 4 / k)) r.blend(x + ox, y + oy, Palette.ink, 0.45);
                        continue;
                    }
                    const edge = !inShape(u + 1 / k, v) || !inShape(u - 1 / k, v) || !inShape(u, v + 1 / k) || !inShape(u, v - 1 / k);
                    let c = BONE;
                    if (edge) c = CREVICE;
                    else if (inEyeCore(u, v)) c = 0x6e1a1a;
                    else if (inEye(u, v) || inNose(u, v) || inTeeth(u, v)) c = CREVICE;
                    else if (u + v < -26 + (bayer(x, y) - 0.5) * 14) c = BONE_LIGHT;
                    else if (u + v > 22 + (bayer(x, y) - 0.5) * 14 || hash(x, y, seed) < 0.05) c = BONE_DARK;
                    else if (valueNoise(x / 3, y / 3, seed + 31) > 0.8) c = BONE_DARK;
                    r.blend(x + ox, y + oy, c);
                }
            }
        });
    }
}
