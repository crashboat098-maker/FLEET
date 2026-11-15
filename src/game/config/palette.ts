/**
 * The FLEET.IO master palette. All procedural art pulls from here so the
 * look stays consistent. Values are 0xRRGGBB numbers.
 */
export const Palette = {
    // Ocean
    deepSea: 0x0b2a4a,
    sea: 0x14507e,
    seaMid: 0x1a6fa8,
    shallows: 0x2a9fc0,
    lagoon: 0x45c4cf,
    foam: 0xbff0f2,
    foamWhite: 0xf4feff,

    // Land
    sand: 0xf2d58b,
    sandShade: 0xd6b064,
    wetSand: 0xb89452,
    rock: 0x7b7d8a,
    rockShade: 0x4f5160,
    grass: 0x4caf50,
    leaf: 0x2e8b3e,
    leafShade: 0x1d5e2a,
    trunk: 0x8a5a2b,

    // Wood & sails
    wood: 0x8a5527,
    woodLight: 0xb4773a,
    woodDark: 0x5a3415,
    woodDeep: 0x3a200c,
    sail: 0xf3e6c4,
    sailShade: 0xcdb98c,
    flagRed: 0xc8312b,

    // UI
    gold: 0xf7c843,
    goldShade: 0xc28a1c,
    cream: 0xfdf3d6,
    ink: 0x1b1020,
    shadow: 0x06182b
} as const;

export type PaletteKey = keyof typeof Palette;

/** Convert a palette number to a CSS colour string. */
export const toCss = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
