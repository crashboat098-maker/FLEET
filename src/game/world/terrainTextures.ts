import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { createRng } from '../gfx/pixelCanvas';
import { Raster } from '../gfx/Raster';
import { CollisionWorld } from './CollisionWorld';
import { bayer, valueNoise } from './noise';
import { WorldData } from './WorldGenerator';

/**
 * World-wide baked textures: open-ocean reefs, the deep-water overlay and
 * the HUD minimap. Island terrain is streamed separately (TerrainStreamer).
 */

const CORAL = [0xff7a8a, 0xff9f43, 0xb06ad8, 0xffd166];

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
        for (let i = 0; i < 5; i++) {
            r.blend(10 + Math.floor(rng() * (W - 20)), 8 + Math.floor(rng() * (H - 16)), Palette.foamWhite, 0.7);
        }
        r.toTexture(scene, key);
    }
    return keys;
};

/** Dithered deep-water overlay for the whole world (1 texel = DEEP_CELL world units). */
export const DEEP_CELL = 8;
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
    r.toTexture(scene, key);
    return key;
};

/** Land colour on the chart for each island kind. */
const CHART_LAND: Record<string, number> = {
    tropical: Palette.grass,
    basic: 0x5cb85c,
    jungle: Palette.leafShade,
    volcanic: 0x4f4a57,
    skull: 0x6b6270
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
            let c: number = Palette.seaMid;
            let best = 1e6;
            let kind = 'tropical';
            for (const isl of collision.islandsNear(wx, wy)) {
                const e = isl.edge(wx, wy, best);
                if (e < best) {
                    best = e;
                    kind = isl.kind;
                }
            }
            if (best < -45) c = CHART_LAND[kind];
            else if (best < 0) c = kind === 'volcanic' ? 0x3b3a44 : Palette.sand;
            else if (best < 70) c = Palette.lagoon;
            else if (world.deepPatches.some((p) => Math.hypot(p.x - wx, p.y - wy) < p.r * 0.7)) c = Palette.sea;
            r.set(x, y, c);
        }
    }
    r.toTexture(scene, key);
    return key;
};
