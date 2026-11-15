import { GameObjects, Scene } from 'phaser';
import { TextureKeys } from '../gfx/textures';
import { Fonts, pixelText } from '../gfx/pixelFont';

/**
 * Wooden plank button with hover / pressed states. Works with mouse & touch.
 */
export class PixelButton extends GameObjects.Container {
    private readonly plank: GameObjects.Image;
    private readonly label: GameObjects.BitmapText;
    private readonly labelY: number;

    constructor(scene: Scene, x: number, y: number, text: string, onClick: () => void) {
        super(scene, x, y);

        this.plank = scene.add.image(0, 0, TextureKeys.Button);
        this.label = pixelText(scene, 0, 0, text, Fonts.Cream, 2);
        // Bitmap glyph cells include 1px tracking; nudge so text sits optically centred.
        this.labelY = 1;
        this.label.setPosition(1, this.labelY);
        this.add([this.plank, this.label]);

        this.setSize(this.plank.width, this.plank.height);
        this.setInteractive({ useHandCursor: true });

        this.on('pointerover', () => this.setState('hover'));
        this.on('pointerout', () => this.setState('idle'));
        this.on('pointerdown', () => this.setState('down'));
        this.on('pointerup', () => {
            this.setState('hover');
            onClick();
        });

        scene.add.existing(this);
    }

    override setState(value: string | number): this {
        super.setState(value);
        if (!this.plank) return this; // called by base constructor before init
        const key =
            value === 'down' ? TextureKeys.ButtonDown : value === 'hover' ? TextureKeys.ButtonHover : TextureKeys.Button;
        this.plank.setTexture(key);
        this.label.setY(this.labelY + (value === 'down' ? 1 : 0));
        return this;
    }
}
