import { AUTO, Scale, Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GAME_TITLE, GAME_VERSION } from './constants';
import { Palette, toCss } from './palette';
import { BootScene } from '../scenes/BootScene';
import { MenuScene } from '../scenes/MenuScene';
import { OceanScene } from '../scenes/OceanScene';
import { HudScene } from '../scenes/HudScene';
import { PortScene } from '../scenes/PortScene';
import { ShipSelectScene } from '../scenes/ShipSelectScene';

export const createGameConfig = (parent: string): Types.Core.GameConfig => ({
    type: AUTO,
    title: GAME_TITLE,
    version: GAME_VERSION,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: toCss(Palette.deepSea),
    pixelArt: true,
    banner: false,
    scale: {
        // Fit the 16:9 canvas inside the window, letterboxing as needed.
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH
    },
    input: {
        activePointers: 2
    },
    // Boot is first, so it runs automatically.
    scene: [BootScene, MenuScene, OceanScene, HudScene, PortScene, ShipSelectScene]
});
