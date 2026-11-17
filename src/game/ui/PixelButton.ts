import { GameObjects, Scene } from 'phaser';
import { Palette } from '../config/palette';
import { makeButton, TextureKeys } from '../gfx/textures';
import { Fonts, pixelText } from '../gfx/pixelFont';

export interface PixelButtonOptions {
    /** Label scale (1 = small, 2 = default). */
    labelScale?: number;
    /** Plank width in pixels; defaults to fit the label (min 104). */
    width?: number;
}

/** Ensure plank textures exist for a given width; returns [idle, hover, down] keys. */
const plankKeys = (scene: Scene, width: number): [string, string, string] => {
    if (width === 104) return [TextureKeys.Button, TextureKeys.ButtonHover, TextureKeys.ButtonDown];
    const keys: [string, string, string] = [`btn-${width}`, `btn-${width}-hover`, `btn-${width}-down`];
    if (!scene.textures.exists(keys[0])) {
        makeButton(scene, keys[0], Palette.wood, Palette.woodLight, Palette.woodDark, width);
        makeButton(scene, keys[1], Palette.woodLight, Palette.sail, Palette.wood, width);
        makeButton(scene, keys[2], Palette.woodDark, Palette.wood, Palette.woodDeep, width);
    }
    return keys;
};

/**
 * Wooden plank button with hover / pressed states. Works with mouse & touch.
 */
export class PixelButton extends GameObjects.Container {
    private readonly plank: GameObjects.Image;
    private readonly label: GameObjects.BitmapText;
    private readonly keys: [string, string, string];
    private readonly labelY = 1;

    constructor(scene: Scene, x: number, y: number, text: string, onClick: () => void, opts: PixelButtonOptions = {}) {
        super(scene, x, y);
        const labelScale = opts.labelScale ?? 2;
        const labelWidth = text.length * 6 * labelScale;
        const width = opts.width ?? Math.max(104, labelWidth + 24);
        this.keys = plankKeys(scene, width);

        this.plank = scene.add.image(0, 0, this.keys[0]);
        this.label = pixelText(scene, 1, this.labelY, text, Fonts.Cream, labelScale);
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

    setLabel(text: string): this {
        this.label.setText(text.toUpperCase());
        return this;
    }

    /** Disabled buttons are dimmed and ignore input. */
    setEnabled(enabled: boolean): this {
        if (enabled) this.setInteractive({ useHandCursor: true });
        else this.disableInteractive();
        this.setAlpha(enabled ? 1 : 0.45);
        if (!enabled) this.setState('idle');
        return this;
    }

    override setState(value: string | number): this {
        super.setState(value);
        if (!this.plank) return this; // called by base constructor before init
        const key = value === 'down' ? this.keys[2] : value === 'hover' ? this.keys[1] : this.keys[0];
        this.plank.setTexture(key);
        this.label.setY(this.labelY + (value === 'down' ? 1 : 0));
        return this;
    }
}
