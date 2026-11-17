import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { bayer } from '../world/noise';
import { GLYPHS } from './pixelFont';
import { Raster } from './Raster';

/**
 * The FLEET title logo, generated as original pixel art:
 * chunky bevelled gold lettering with layered outlines and a drop shadow,
 * a twisted rope with anchors, crossed cannons, and a parchment ribbon.
 */

export const LOGO_KEY = 'fleet-logo';
/** Ribbon centre in logo art pixels (for placing the subtitle text). */
export const LOGO_RIBBON = { y: 60 };

const CELL = 5;
const GAP = 4;
const TOP = 15;
const SIDE = 26;
const LETTER_H = 7 * CELL;

const GOLD_LIGHT = 0xffe27a;
const GOLD_DEEP = 0x9c6a12;
const IRON = 0x3a3a44;
const IRON_LIGHT = 0x6a6a76;

const ANCHOR = ['...ooo...', '...o.o...', '...ooo...', '.ooooooo.', '....o....', 'o...o...o', 'oo..o..oo', '.oo.o.oo.', '..ooooo..'];

export const generateLogo = (scene: Scene, word = 'FLEET'): void => {
    const lettersW = word.length * 5 * CELL + (word.length - 1) * GAP;
    const W = lettersW + SIDE * 2;
    const H = 70;
    const r = new Raster(W, H);

    // --- Letter mask
    const mask = new Uint8Array(W * H);
    [...word].forEach((ch, i) => {
        const glyph = GLYPHS[ch];
        const ox = SIDE + i * (5 * CELL + GAP);
        for (let gy = 0; gy < 7; gy++)
            for (let gx = 0; gx < 5; gx++) {
                if (glyph[gy][gx] !== '#') continue;
                for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) mask[(TOP + gy * CELL + y) * W + ox + gx * CELL + x] = 1;
            }
    });
    const m = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
    const near = (x: number, y: number, d: number) => {
        for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (m(x + dx, y + dy)) return true;
        return false;
    };

    // --- Rope across the middle, behind the letters
    const ropeY = TOP + LETTER_H / 2 - 1;
    for (let x = 6; x < W - 6; x++) {
        r.set(x, ropeY - 2, Palette.woodDeep);
        for (let k = 0; k < 3; k++) r.set(x, ropeY - 1 + k, (x + k) % 4 < 2 ? Palette.woodLight : Palette.woodDark);
        r.set(x, ropeY + 2, Palette.woodDeep);
    }

    // --- Anchors (double size) at both ends of the rope
    const anchor = (ax: number, ay: number) => {
        ANCHOR.forEach((row, y) =>
            [...row].forEach((ch, x) => {
                if (ch !== 'o') return;
                for (let dy = 0; dy < 2; dy++)
                    for (let dx = 0; dx < 2; dx++) {
                        r.blend(ax + x * 2 + dx + 1, ay + y * 2 + dy + 1, Palette.woodDeep);
                        r.blend(ax + x * 2 + dx, ay + y * 2 + dy, dy === 0 && dx === 0 ? GOLD_LIGHT : Palette.goldShade);
                    }
            })
        );
    };
    anchor(1, ropeY - 8);
    anchor(W - 20, ropeY - 8);

    // --- Crossed cannons above the centre
    const cx = Math.floor(W / 2);
    const barrel = (x0: number, y0: number, x1: number, y1: number) => {
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;
            const rad = 2.2 - t * 0.6;
            r.disc(x + 1, y + 1, rad, Palette.ink, 0.6);
            r.disc(x, y, rad, IRON);
            r.blend(x - 0.5, y - 1, IRON_LIGHT);
        }
        r.disc(x1, y1, 2.4, Palette.woodDeep).disc(x1, y1, 1.2, Palette.ink); // muzzle
    };
    barrel(cx - 15, 13, cx + 13, 1);
    barrel(cx + 15, 13, cx - 13, 1);
    for (const dx of [-5, 0, 5]) r.disc(cx + dx, 13, 1.8, IRON).blend(cx + dx - 1, 12, IRON_LIGHT);

    // --- Letters: shadow, double outline, gradient fill, bevel, shine
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (m(x, y)) {
                const ly = (y - TOP) / LETTER_H;
                const b = bayer(x, y);
                let c = ly < 0.3 + (b - 0.5) * 0.08 ? GOLD_LIGHT : ly < 0.64 + (b - 0.5) * 0.08 ? Palette.gold : Palette.goldShade;
                if (!m(x, y - 1) || !m(x - 1, y)) c = Palette.cream;
                else if (!m(x, y + 1) || !m(x + 1, y)) c = GOLD_DEEP;
                else if ((x + y) % 28 < 2 && ly < 0.7) c = Palette.cream;
                r.set(x, y, c);
            } else if (near(x, y, 1)) {
                r.set(x, y, Palette.woodDeep);
            } else if (near(x, y, 2)) {
                r.set(x, y, Palette.ink);
            } else if (m(x - 4, y - 4) || near(x - 4, y - 4, 1)) {
                r.blend(x, y, Palette.ink, 0.55);
            }
        }
    }

    // --- Parchment ribbon beneath the letters
    const ry = LOGO_RIBBON.y - 6;
    const rh = 12;
    const rx0 = SIDE + 14;
    const rx1 = W - SIDE - 14;
    const tail = (x0: number, dir: number) => {
        for (let y = 0; y < rh; y++) {
            const notch = Math.abs(y - rh / 2) < (rh / 2 - Math.abs(y - rh / 2)) * 0.6 ? 4 - Math.abs(y - rh / 2) * 0.6 : 0;
            for (let i = 0; i < 12; i++) {
                const x = x0 + dir * i;
                if (i > 11 - notch) continue;
                const edge = y === 0 || y === rh - 1 || i === 11 - Math.floor(notch);
                r.set(x, ry + 3 + y, edge ? Palette.woodDeep : Palette.sailShade);
            }
        }
    };
    tail(rx0 - 1, -1);
    tail(rx1 + 1, 1);
    for (let y = 0; y < rh; y++)
        for (let x = rx0; x <= rx1; x++) {
            const edge = y === 0 || y === rh - 1 || x === rx0 || x === rx1;
            r.set(x, ry + y, edge ? Palette.woodDeep : y >= rh - 3 ? Palette.sailShade : Palette.sail);
        }

    r.toTexture(scene, LOGO_KEY);
};
