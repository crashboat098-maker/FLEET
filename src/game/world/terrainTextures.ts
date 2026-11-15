import { Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Palette } from '../config/palette';
import { createRng, PixelCanvas } from '../gfx/pixelCanvas';
import { CollisionWorld } from './CollisionWorld';
import { Island } from './Island';
import { Circle, WorldData } from './WorldGenerator';
import { SHALLOW_HALO } from './worldConfig';

/**
 * Bakes world terrain (islands, reefs, deep water, minimap) into textures.
 * Everything is generated once and cached in the texture manager, so
 * returning to the ocean from the menu costs nothing.
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER4[(y & 3) * 4 + (x & 3)];

/** Integer hash → [0,1). */
const hash = (x: number, y: number, seed: number): number => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
};

/** Smooth value noise in [0,1). */
const valueNoise = (x: number, y: number, seed: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, seed);
    const b = hash(xi + 1, yi, seed);
    const c = hash(xi, yi + 1, seed);
    const d = hash(xi + 1, yi + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};

class Raster {
    readonly pc: PixelCanvas;
    private readonly img: ImageData;

    constructor(readonly w: number, readonly h: number) {
        this.pc = new PixelCanvas(w, h);
        this.img = this.pc.ctx.createImageData(w, h);
    }

    set(x: number, y: number, color: number, alpha = 1): void {
        const i = (y * this.w + x) * 4;
        const d = this.img.data;
        d[i] = (color >> 16) & 255;
        d[i + 1] = (color >> 8) & 255;
        d[i + 2] = color & 255;
        d[i + 3] = (alpha * 255 + 0.5) | 0;
    }

    commit(): PixelCanvas {
        this.pc.ctx.putImageData(this.img, 0, 0);
        return this.pc;
    }
}

const CORAL = [0xff7a8a, 0xff9f43, 0xb06ad8, 0xffd166];

export interface IslandVisual {
    key: string;
    /** World position of the texture's top-left corner. */
    left: number;
    top: number;
    palms: { x: number; y: number }[];
}

/**
 * Rasterise one island at art resolution (1 art pixel = PIXEL_SCALE world units).
 * `exclude` keeps vegetation away from areas used by the port.
 */
export const bakeIsland = (scene: Scene, island: Island, exclude: Circle[] = []): IslandVisual => {
    const key = `island-${island.id}`;
    const S = PIXEL_SCALE;
    const ext = Math.ceil(island.boundRadius + SHALLOW_HALO + 8);
    const left = island.x - ext;
    const top = island.y - ext;
    const W = Math.ceil((ext * 2) / S);
    const H = W;
    const seed = island.seed;
    const rng = createRng(seed);

    // Per-pixel edge distances are reused for decor placement.
    const edge = new Float32Array(W * H).fill(1e6);
    const sandW = new Float32Array(W * H);
    const reach = island.boundRadius + SHALLOW_HALO + 4;
    const sandWidth = (px: number, py: number) => 14 + 18 * valueNoise(px / 14, py / 14, seed);
    /** Fill edge/sand arrays; calls `visit` for every pixel within reach of the coast. */
    const scan = (visit?: (px: number, py: number, e: number, sw: number) => void) => {
        for (let py = 0; py < H; py++) {
            const wy = top + (py + 0.5) * S;
            for (let px = 0; px < W; px++) {
                const wx = left + (px + 0.5) * S;
                const dx = wx - island.x;
                const dy = wy - island.y;
                if (dx * dx + dy * dy > reach * reach) continue;
                const e = island.edge(wx, wy, SHALLOW_HALO + 1);
                if (e > SHALLOW_HALO) continue;
                const sw = e <= 0 ? sandWidth(px, py) : 0;
                edge[py * W + px] = e;
                sandW[py * W + px] = sw;
                visit?.(px, py, e, sw);
            }
        }
    };

    if (!scene.textures.exists(key)) {
        const r = new Raster(W, H);
        scan((px, py, e, sw) => {
            const b = bayer(px, py);
            if (e > 0) {
                // Water side: foam line, coral and shallow turquoise fade.
                if (e < 3) {
                    r.set(px, py, Palette.foamWhite, 0.95);
                    return;
                }
                if (e < 7 && b < 0.55) {
                    r.set(px, py, Palette.foam, 0.8);
                    return;
                }
                // Coral grows in a few dense beds rather than scattered dots.
                const clump = valueNoise(px / 9, py / 9, seed + 7);
                if (e > 12 && e < SHALLOW_HALO * 0.8 && clump > 0.7 && valueNoise(px / 2.5, py / 2.5, seed + 3) > 0.42) {
                    const tint = CORAL[Math.floor(valueNoise(px / 6, py / 6, seed + 11) * CORAL.length)];
                    r.set(px, py, hash(px, py, seed) < 0.1 ? Palette.foam : tint, 0.85);
                    return;
                }
                if (e > 10 && clump < 0.16 && valueNoise(px / 2.5, py / 2.5, seed + 5) > 0.5) {
                    r.set(px, py, Palette.rockShade, 0.55);
                    return;
                }
                const t = 1 - e / SHALLOW_HALO;
                const level = Math.floor(t * 3.2 + b - 0.5);
                if (level >= 3) r.set(px, py, Palette.lagoon, 0.9);
                else if (level === 2) r.set(px, py, Palette.lagoon, 0.62);
                else if (level === 1) r.set(px, py, Palette.shallows, 0.5);
                else if (level === 0 && b < 0.5) r.set(px, py, Palette.shallows, 0.3);
                return;
            }

            // Land side.
            if (e > -4) {
                r.set(px, py, Palette.wetSand);
            } else if (e > -sw || (e > -sw - 3 && b < 0.5)) {
                r.set(px, py, hash(px, py, seed + 3) < 0.08 ? Palette.sandShade : Palette.sand);
            } else {
                const inner = -e - sw;
                const n = valueNoise(px / 6, py / 6, seed + 5);
                let c: number = Palette.grass;
                if (inner > 26 && n > 0.48) c = n > 0.7 ? Palette.leafShade : Palette.leaf;
                else if (hash(px, py, seed + 9) < 0.06) c = Palette.leaf;
                else if (hash(px, py, seed + 13) < 0.004) c = hash(px, py, 1) < 0.5 ? Palette.flagRed : Palette.gold;
                r.set(px, py, c);
            }
        });

        const pc = r.commit();
        const excluded = (wx: number, wy: number) => exclude.some((c) => Math.hypot(c.x - wx, c.y - wy) < c.r);
        const at = (px: number, py: number) => edge[Math.max(0, Math.min(H - 1, py)) * W + Math.max(0, Math.min(W - 1, px))];
        const sandAt = (px: number, py: number) => sandW[py * W + px];

        // Bushes on grass.
        const bushCount = Math.floor((W * H) / 900);
        for (let i = 0; i < bushCount; i++) {
            const px = Math.floor(rng() * W);
            const py = Math.floor(rng() * H);
            if (at(px, py) > -sandAt(px, py) - 6) continue;
            if (excluded(left + px * S, top + py * S)) continue;
            pc.rect(px - 2, py + 1, 6, 2, Palette.leafShade, 0.6)
                .rect(px - 2, py - 1, 5, 3, Palette.leaf)
                .rect(px - 1, py - 2, 3, 1, Palette.leaf)
                .px(px - 1, py - 1, Palette.grass)
                .px(px + 1, py - 2, Palette.grass);
        }

        // Boulders on beaches and in the shallows.
        const rockCount = 4 + Math.floor((W * H) / 6000);
        for (let i = 0; i < rockCount; i++) {
            const px = Math.floor(rng() * W);
            const py = Math.floor(rng() * H);
            const e = at(px, py);
            const onBeach = e < -3 && e > -sandAt(px, py) + 2;
            const inShallows = e > 8 && e < 26;
            if (!onBeach && !inShallows) continue;
            if (excluded(left + px * S, top + py * S)) continue;
            const w = 2 + Math.floor(rng() * 3);
            pc.rect(px, py + 1, w + 1, 2, Palette.rockShade)
                .rect(px, py, w, 2, Palette.rock)
                .px(px, py, Palette.foamWhite);
            if (inShallows) pc.rect(px - 1, py + 2, w + 3, 1, Palette.foam, 0.7);
        }

        pc.toTexture(scene, key);
    } else {
        // Texture cached: only recompute what decor placement needs.
        scan();
    }

    // Palm positions (rendered as swaying sprites, not baked). Uses its own
    // RNG so results are identical whether or not the texture was cached.
    const palmRng = createRng(seed ^ 0x5eed);
    const target = island.size === 'large' ? 16 : island.size === 'medium' ? 9 : 4;
    const palms: { x: number; y: number }[] = [];
    for (let i = 0; i < 400 && palms.length < target; i++) {
        const px = Math.floor(palmRng() * W);
        const py = Math.floor(palmRng() * H);
        const e = edge[py * W + px];
        const sw = sandW[py * W + px];
        if (e > -8 || e < -sw - 40) continue;
        const wx = left + px * S;
        const wy = top + py * S;
        if (exclude.some((c) => Math.hypot(c.x - wx, c.y - wy) < c.r)) continue;
        if (palms.some((p) => Math.hypot(p.x - wx, p.y - wy) < 26)) continue;
        palms.push({ x: wx, y: wy });
    }

    return { key, left, top, palms };
};

/** Open-ocean reef patches: coral, seabed rocks and a pale sandbar. */
export const bakeReefs = (scene: Scene): string[] => {
    const keys: string[] = [];
    for (let v = 0; v < 3; v++) {
        const key = `reef-${v}`;
        keys.push(key);
        if (scene.textures.exists(key)) continue;
        const W = 56;
        const H = 40;
        const seed = 900 + v * 31;
        const rng = createRng(seed);
        const r = new Raster(W, H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const dx = (x - W / 2) / (W / 2);
                const dy = (y - H / 2) / (H / 2);
                const d = Math.sqrt(dx * dx + dy * dy) + (valueNoise(x / 5, y / 5, seed) - 0.5) * 0.45;
                if (d > 1) continue;
                const b = bayer(x, y);
                const n = valueNoise(x / 3, y / 3, seed + 1);
                if (d < 0.75 && n > 0.66) {
                    r.set(x, y, CORAL[Math.floor(valueNoise(x / 2, y / 2, seed + 2) * CORAL.length)], 0.85);
                } else if (d < 0.8 && n < 0.14) {
                    r.set(x, y, Palette.rockShade, 0.6);
                } else {
                    const level = Math.floor((1 - d) * 3 + b - 0.4);
                    if (level >= 2) r.set(x, y, Palette.lagoon, 0.55);
                    else if (level === 1) r.set(x, y, Palette.shallows, 0.45);
                    else if (b < 0.4) r.set(x, y, Palette.shallows, 0.3);
                }
            }
        }
        const pc = r.commit();
        for (let i = 0; i < 5; i++) {
            const x = 10 + Math.floor(rng() * (W - 20));
            const y = 8 + Math.floor(rng() * (H - 16));
            pc.px(x, y, Palette.foamWhite, 0.7);
        }
        pc.toTexture(scene, key);
    }
    return keys;
};

/** Dithered deep-water overlay for the whole world (1 texel = DEEP_CELL world units). */
export const DEEP_CELL = 4;
export const bakeDeepWater = (scene: Scene, world: WorldData): string => {
    const key = 'deep-water';
    if (scene.textures.exists(key)) return key;
    const N = Math.ceil(world.size / DEEP_CELL);
    const depth = new Float32Array(N * N);
    for (const p of world.deepPatches) {
        const x0 = Math.max(0, Math.floor((p.x - p.r) / DEEP_CELL));
        const x1 = Math.min(N - 1, Math.ceil((p.x + p.r) / DEEP_CELL));
        const y0 = Math.max(0, Math.floor((p.y - p.r) / DEEP_CELL));
        const y1 = Math.min(N - 1, Math.ceil((p.y + p.r) / DEEP_CELL));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const wx = x * DEEP_CELL;
                const wy = y * DEEP_CELL;
                const wobble = (valueNoise(wx / 160, wy / 160, 77) - 0.5) * 0.5;
                const d = Math.hypot(wx - p.x, wy - p.y) / p.r + wobble;
                if (d >= 1) continue;
                const t = 1 - d;
                const v = t * t * (3 - 2 * t);
                if (v > depth[y * N + x]) depth[y * N + x] = v;
            }
        }
    }
    const r = new Raster(N, N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const v = depth[y * N + x];
            if (v <= 0) continue;
            const level = Math.floor(v * 3.4 + bayer(x, y) - 0.5);
            if (level === 1) r.set(x, y, Palette.sea, 0.5);
            else if (level === 2) r.set(x, y, Palette.sea, 0.95);
            else if (level >= 3) r.set(x, y, Palette.deepSea, 0.85);
        }
    }
    r.commit().toTexture(scene, key);
    return key;
};

/** Small overview map for the HUD. */
export const MINIMAP_SIZE = 88;
export const bakeMinimap = (scene: Scene, world: WorldData, collision: CollisionWorld): string => {
    const key = 'minimap';
    if (scene.textures.exists(key)) return key;
    const N = MINIMAP_SIZE;
    const step = world.size / N;
    const r = new Raster(N, N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const wx = (x + 0.5) * step;
            const wy = (y + 0.5) * step;
            const e = collision.coastDistance(wx, wy);
            let c: number = Palette.seaMid;
            if (e < -45) c = Palette.grass;
            else if (e < 0) c = Palette.sand;
            else if (e < 70) c = Palette.lagoon;
            else if (world.deepPatches.some((p) => Math.hypot(p.x - wx, p.y - wy) < p.r * 0.7)) c = Palette.sea;
            r.set(x, y, c);
        }
    }
    r.commit().toTexture(scene, key);
    return key;
};
