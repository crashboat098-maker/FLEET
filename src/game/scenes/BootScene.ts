import { Scene } from 'phaser';
import { SceneKeys } from '../config/constants';
import { bakePixelFonts } from '../gfx/pixelFont';
import { generateLogo } from '../gfx/logo';
import { generateTextures } from '../gfx/textures';

/**
 * Generates all procedural art and fonts, then hands off to the menu.
 * When real asset files arrive, load them in `preload()` here.
 */
export class BootScene extends Scene {
    constructor() {
        super(SceneKeys.Boot);
    }

    create(): void {
        bakePixelFonts(this);
        generateTextures(this);
        generateLogo(this);
        this.scene.start(SceneKeys.Menu);
    }
}
