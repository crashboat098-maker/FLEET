import { GameObjects, Scene } from 'phaser';
import { Palette } from '../config/palette';
import { PixelCanvas } from './pixelCanvas';

/**
 * An original 5x7 pixel font, baked at boot into RetroFont bitmap fonts.
 * Colour variants are baked separately so no runtime tinting is needed.
 */

export const GLYPHS: Record<string, string[]> = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
    ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
    '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
    ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
    '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
    '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
    '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
    '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
    '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
    '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....']
};

const CHARS = Object.keys(GLYPHS).join('');
const GLYPH_W = 5;
const GLYPH_H = 7;

interface FontStyle {
    fill: number;
    /** 1px drop shadow, down-right. */
    shadow?: number;
    /** 1px outline on all sides (good for big titles). */
    outline?: number;
}

/** Font keys available to every scene after boot. */
export const Fonts = {
    Cream: 'font-cream',
    Gold: 'font-gold',
    Ink: 'font-ink',
    Green: 'font-green',
    Red: 'font-red',
    Title: 'font-title',
    TitleShadow: 'font-title-shadow'
} as const;

export type FontKey = (typeof Fonts)[keyof typeof Fonts];

const STYLES: Record<FontKey, FontStyle> = {
    [Fonts.Cream]: { fill: Palette.cream, shadow: Palette.ink },
    [Fonts.Gold]: { fill: Palette.gold, shadow: Palette.woodDeep },
    [Fonts.Ink]: { fill: Palette.woodDeep },
    [Fonts.Green]: { fill: 0x8fe07a, shadow: Palette.ink },
    [Fonts.Red]: { fill: 0xff7a6a, shadow: Palette.ink },
    [Fonts.Title]: { fill: Palette.gold, outline: Palette.woodDeep },
    [Fonts.TitleShadow]: { fill: Palette.shadow, outline: Palette.shadow }
};

const bakeFont = (scene: Scene, key: string, style: FontStyle): void => {
    const pad = style.outline !== undefined ? 1 : 0;
    const cellW = GLYPH_W + 1 + pad; // 1px tracking (or outline)
    const cellH = GLYPH_H + 1 + pad;
    const perRow = 16;
    const rows = Math.ceil(CHARS.length / perRow);
    const pc = new PixelCanvas(cellW * perRow, cellH * rows);

    [...CHARS].forEach((ch, i) => {
        const glyph = GLYPHS[ch];
        const ox = (i % perRow) * cellW + pad;
        const oy = Math.floor(i / perRow) * cellH + pad;
        const on = (x: number, y: number) => glyph[y]?.[x] === '#';

        if (style.outline !== undefined) {
            for (let y = -1; y <= GLYPH_H; y++) {
                for (let x = -1; x <= GLYPH_W; x++) {
                    if (on(x, y)) continue;
                    let near = false;
                    for (let dy = -1; dy <= 1 && !near; dy++)
                        for (let dx = -1; dx <= 1 && !near; dx++) near = on(x + dx, y + dy);
                    if (near) pc.px(ox + x, oy + y, style.outline);
                }
            }
        }
        for (let y = 0; y < GLYPH_H; y++) {
            for (let x = 0; x < GLYPH_W; x++) {
                if (!on(x, y)) continue;
                if (style.shadow !== undefined && !on(x + 1, y + 1)) pc.px(ox + x + 1, oy + y + 1, style.shadow);
                pc.px(ox + x, oy + y, style.fill);
            }
        }
    });

    pc.toTexture(scene, key);

    const font = GameObjects.RetroFont.Parse(scene, {
        image: key,
        'offset.x': 0,
        'offset.y': 0,
        width: cellW,
        height: cellH,
        chars: CHARS,
        charsPerRow: perRow,
        'spacing.x': 0,
        'spacing.y': 0,
        lineSpacing: 2
    });
    // Phaser's typings say Parse returns BitmapFontData, but it returns the full cache entry.
    scene.cache.bitmapFont.add(key, font as unknown as object);
};

export const bakePixelFonts = (scene: Scene): void => {
    (Object.keys(STYLES) as FontKey[]).forEach((key) => bakeFont(scene, key, STYLES[key]));
};

/** Create crisp pixel text. Text is upper-cased because the font is caps-only. */
export const pixelText = (
    scene: Scene,
    x: number,
    y: number,
    text: string,
    font: FontKey = Fonts.Cream,
    scale = 1
): GameObjects.BitmapText =>
    scene.add.bitmapText(x, y, font, text.toUpperCase()).setScale(scale).setOrigin(0.5);
