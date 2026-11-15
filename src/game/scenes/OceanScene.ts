import { Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../config/constants';
import { OceanBackdrop } from '../gfx/OceanBackdrop';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { ShipSprite } from '../gfx/ShipSprite';

/**
 * Ocean gameplay scene — placeholder only.
 * Milestone 1 will add the scrolling world, camera follow and ship movement.
 */
export class OceanScene extends Scene {
    private ocean!: OceanBackdrop;

    constructor() {
        super(SceneKeys.Ocean);
    }

    create(): void {
        this.cameras.main.fadeIn(400, 6, 24, 43);
        this.ocean = new OceanBackdrop(this, 40, 14);

        new ShipSprite(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 0).setDepth(5);

        pixelText(this, GAME_WIDTH / 2, 28, 'THE OPEN SEA', Fonts.Gold, 3).setDepth(20);
        pixelText(this, GAME_WIDTH / 2, 56, 'SAILING ARRIVES IN MILESTONE 1', Fonts.Cream, 1).setDepth(20);
        pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 16, 'ESC - RETURN TO MENU', Fonts.Cream, 1).setDepth(20);

        this.input.keyboard?.once('keydown-ESC', () => {
            this.cameras.main.fadeOut(300, 6, 24, 43);
            this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SceneKeys.Menu));
        });
    }

    update(_time: number, delta: number): void {
        this.ocean.update(delta);
    }
}
