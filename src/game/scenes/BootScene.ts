import { Scene } from 'phaser';
import { SceneKeys } from '../config/constants';
import { bakePixelFonts } from '../gfx/pixelFont';
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
        this.scene.start(SceneKeys.Menu);
    }
}
