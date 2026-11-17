import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { textureFromRows } from './pixelCanvas';

/** Floating collectibles. Each type has a distinct silhouette and colour. */
export const ItemTextures = {
    Barrel: 'item-barrel',
    Crate: 'item-crate',
    Chest: 'item-chest',
    Supplies: 'item-supplies',
    Ripple: 'item-ripple',
    Parcel: 'item-parcel'
} as const;

export const generateItemTextures = (scene: Scene): void => {
    // Sealed mission parcel: wrapped bundle with twine and a red wax seal.
    textureFromRows(scene, ItemTextures.Parcel, ['ooooooooo', 'osstsssso', 'osstsssso', 'otttRtttO', 'osstsssso', 'osstsssso', 'ooooooooo'], {
        o: Palette.woodDark,
        O: Palette.woodDark,
        s: Palette.sandShade,
        t: Palette.woodLight,
        R: Palette.flagRed
    });
    // Barrel floating on its side, iron hoops.
    textureFromRows(
        scene,
        ItemTextures.Barrel,
        [
            '.ooooooooo.',
            'odgdwwwdgdo',
            'owglwlwlgwo',
            'owgwwwwwgwo',
            'owglwlwlgwo',
            'odgdwwwdgdo',
            '.ooooooooo.'
        ],
        { o: Palette.woodDeep, d: Palette.woodDark, w: Palette.wood, l: Palette.woodLight, g: Palette.rock }
    );

    // Plank crate with a cross brace.
    textureFromRows(
        scene,
        ItemTextures.Crate,
        ['ooooooooo', 'olllllllo', 'oldwwwdlo', 'olwdwdwlo', 'olwwdwwlo', 'olwdwdwlo', 'oldwwwdlo', 'olllllllo', 'ooooooooo'],
        { o: Palette.woodDeep, d: Palette.woodDark, w: Palette.sandShade, l: Palette.woodLight }
    );

    // Treasure chest: dark lid, gold straps and lock.
    textureFromRows(
        scene,
        ItemTextures.Chest,
        [
            'ooooooooooo',
            'oGwwwGwwwGo',
            'oGlllGlllGo',
            'oGwwwGwwwGo',
            'oGGGGYGGGGo',
            'oGwwwkwwwGo',
            'oGlllGlllGo',
            'oGwwwGwwwGo',
            'ooooooooooo'
        ],
        { o: Palette.woodDeep, G: Palette.gold, Y: Palette.foamWhite, k: Palette.goldShade, w: 0x7a2a1c, l: 0x9c3b2a }
    );

    // Cloth supply sack tied with rope.
    textureFromRows(
        scene,
        ItemTextures.Supplies,
        ['...rrr...', '..oSSSo..', '.oSsssSo.', 'oSssrssSo', 'oSsrrrsSo', 'oSssrssSo', '.oSsssSo.', '..ooooo..'],
        { o: Palette.woodDark, s: Palette.sail, S: Palette.sailShade, r: Palette.woodLight }
    );

    textureFromRows(
        scene,
        ItemTextures.Ripple,
        [
            '....#######....',
            '..##.......##..',
            '.#...........#.',
            '#.............#',
            '.#...........#.',
            '..##.......##..',
            '....#######....'
        ],
        { '#': Palette.foam }
    );
};
