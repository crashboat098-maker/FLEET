import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { mirrorRows, PixelCanvas, textureFromRows } from './pixelCanvas';

/**
 * The player's pirate sloop, built from layered parts so the sail can
 * billow and the flag can flap independently of the hull.
 * All parts are authored bow-up (heading 0 = north).
 */
export const ShipTextures = {
    Hull: 'sloop-hull',
    SailFull: 'sloop-sail-full',
    SailSlack: 'sloop-sail-slack',
    FlagA: 'sloop-flag-a',
    FlagB: 'sloop-flag-b'
} as const;

/** Art-pixel row of the mast on the hull texture, used to align the sail. */
export const SLOOP_MAST_ROW = 11;
/** Art-pixel row of the stern flagpole. */
export const SLOOP_FLAG_ROW = 28;

const HULL_HALF = [
    '.......o',
    '.......d',
    '......od',
    '......od',
    '.....odl',
    '.....odw',
    '....odwl',
    '....odww',
    '...odwwl',
    '...odwlw',
    '..odwwwl',
    '..odwlww',
    '..odwwwl',
    '.odwwlww',
    '.odwwwwl',
    '.odwlwww',
    '.odwwwwl',
    '.odwwlww',
    '.odwwwhh',
    '.odwwlhh',
    '.odwwwwl',
    '.odwlwww',
    '..odwwwl',
    '..odDDDD',
    '..odCCCC',
    '..odCcCC',
    '..odCCCC',
    '..odDDDD',
    '...odddd',
    '....oooo'
];

const SAIL_FULL_HALF = ['....sssssss', '..sssssssss', '.ssssssssss', 'Sssssssssss', 'SSSssssssss', 'yyyyyyyyyym'];
const SAIL_SLACK_HALF = ['...........', '....sssssss', '.ssssssssss', 'Sssssssssss', 'SSSSSSsssss', 'yyyyyyyyyym'];

export const generateShipTextures = (scene: Scene): void => {
    const hull = mirrorRows(HULL_HALF);
    const pc = new PixelCanvas(hull[0].length, hull.length);
    pc.stamp(hull, {
        o: Palette.woodDeep,
        d: Palette.woodDark,
        w: Palette.wood,
        l: Palette.woodLight,
        h: Palette.woodDeep,
        D: Palette.woodDark,
        C: Palette.woodLight,
        c: Palette.gold
    });
    // Mast step and flagpole.
    pc.px(7, SLOOP_MAST_ROW, Palette.woodDeep).px(7, SLOOP_FLAG_ROW - 1, Palette.woodDeep);
    pc.toTexture(scene, ShipTextures.Hull);

    const sailColors = { s: Palette.sail, S: Palette.sailShade, y: Palette.woodDark, m: Palette.woodDeep };
    textureFromRows(scene, ShipTextures.SailFull, mirrorRows(SAIL_FULL_HALF), sailColors);
    textureFromRows(scene, ShipTextures.SailSlack, mirrorRows(SAIL_SLACK_HALF), sailColors);

    // Black pirate flag with a tiny white skull, streaming aft.
    const flagColors = { k: Palette.ink, w: Palette.foamWhite };
    textureFromRows(scene, ShipTextures.FlagA, ['kkk', 'kwk', 'kkk', '.k.'], flagColors);
    textureFromRows(scene, ShipTextures.FlagB, ['kkk', 'kwk', 'kk.', 'k..'], flagColors);
};
