import { Scene } from 'phaser';
import { toCss } from '../config/palette';

/**
 * Low-level helpers for authoring original pixel art in code.
 * Every texture in the prototype is generated at boot, so the project ships
 * with zero binary art assets and nothing borrowed from other games.
 */

export type PixelColors = Record<string, number>;

/** Small deterministic RNG (mulberry32) so procedural art is stable between runs. */
export const createRng = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** Mirror left-half rows (last char = centre column) into symmetric full rows. */
export const mirrorRows = (halfRows: string[]): string[] =>
    halfRows.map((row) => row + row.slice(0, -1).split('').reverse().join(''));

/**
 * Thin wrapper over a 2D canvas that plots single pixels in palette colours.
 */
export class PixelCanvas {
    readonly canvas: HTMLCanvasElement;
    readonly ctx: CanvasRenderingContext2D;

    constructor(readonly width: number, readonly height: number) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        this.ctx = ctx;
        this.ctx.imageSmoothingEnabled = false;
    }

    px(x: number, y: number, color: number, alpha = 1): this {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return this;
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = toCss(color);
        this.ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        this.ctx.globalAlpha = 1;
        return this;
    }

    rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): this {
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = toCss(color);
        this.ctx.fillRect(x, y, w, h);
        this.ctx.globalAlpha = 1;
        return this;
    }

    /** Stamp ASCII-art rows. '.' and ' ' are transparent; other chars map through `colors`. */
    stamp(rows: string[], colors: PixelColors, ox = 0, oy = 0): this {
        rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) {
                const c = colors[row[x]];
                if (c !== undefined) this.px(ox + x, oy + y, c);
            }
        });
        return this;
    }

    /** Register this canvas as a Phaser texture (replacing any existing one). */
    toTexture(scene: Scene, key: string): void {
        if (scene.textures.exists(key)) scene.textures.remove(key);
        scene.textures.addCanvas(key, this.canvas);
    }
}

/** Convenience: build a texture straight from ASCII-art rows. */
export const textureFromRows = (scene: Scene, key: string, rows: string[], colors: PixelColors): void => {
    const width = Math.max(...rows.map((r) => r.length));
    new PixelCanvas(width, rows.length).stamp(rows, colors).toTexture(scene, key);
};
