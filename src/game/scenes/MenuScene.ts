import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_SUBTITLE, GAME_TITLE, GAME_VERSION, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { OceanBackdrop } from '../gfx/OceanBackdrop';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { ShipSprite } from '../gfx/ShipSprite';
import { TextureKeys } from '../gfx/textures';
import { PixelButton } from '../ui/PixelButton';

/**
 * Placeholder start screen: animated ocean, an island, a sloop under sail,
 * the FLEET.IO title and a PLAY button.
 */
export class MenuScene extends Scene {
    private ocean!: OceanBackdrop;
    private clouds: GameObjects.Image[] = [];
    private leaving = false;

    constructor() {
        super(SceneKeys.Menu);
    }

    create(): void {
        this.leaving = false;
        this.clouds = [];
        this.cameras.main.fadeIn(400, 6, 24, 43);

        this.ocean = new OceanBackdrop(this);
        this.buildScenery();
        new ShipSprite(this, 470, 262, 90).setDepth(5);
        this.buildTitle();

        new PixelButton(this, GAME_WIDTH / 2, 214, 'PLAY', () => this.startVoyage()).setDepth(20);

        const hint = pixelText(this, GAME_WIDTH / 2, 244, 'PRESS ENTER TO SET SAIL', Fonts.Cream).setDepth(20);
        this.tweens.add({ targets: hint, alpha: 0.25, duration: 700, yoyo: true, repeat: -1 });

        pixelText(this, GAME_WIDTH - 6, GAME_HEIGHT - 6, `V${GAME_VERSION}`, Fonts.Cream).setOrigin(1, 1).setDepth(20);

        this.input.keyboard?.on('keydown-ENTER', () => this.startVoyage());
        this.input.keyboard?.on('keydown-SPACE', () => this.startVoyage());
    }

    private buildScenery(): void {
        const s = PIXEL_SCALE;

        // Home island, bottom-left, with palms and a jetty.
        this.add.image(96, 300, TextureKeys.Island).setScale(s).setDepth(0);
        this.add.image(196, 286, TextureKeys.Dock).setScale(s).setAngle(90).setDepth(1);
        this.addPalm(70, 286, 0);
        this.addPalm(110, 300, 400);
        this.addPalm(88, 318, 800);

        // Distant island, top-right.
        this.add.image(600, 40, TextureKeys.Island).setScale(s).setFlipX(true).setDepth(0);
        this.addPalm(596, 34, 200);

        // Clouds drift over everything, with a soft shadow on the water.
        for (let i = 0; i < 3; i++) {
            const x = PMath.Between(0, GAME_WIDTH);
            const y = 40 + i * 110;
            const shadow = this.add.image(x + 14, y + 22, TextureKeys.Cloud).setScale(s).setTint(0x000000).setAlpha(0.12).setDepth(8);
            const cloud = this.add.image(x, y, TextureKeys.Cloud).setScale(s).setAlpha(0.85).setDepth(9);
            cloud.setData('shadow', shadow).setData('speed', 6 + i * 3);
            this.clouds.push(cloud);
        }
    }

    private addPalm(x: number, y: number, delay: number): void {
        const palm = this.add.image(x, y, TextureKeys.Palm).setScale(PIXEL_SCALE).setDepth(2);
        this.tweens.add({ targets: palm, angle: { from: -3, to: 3 }, duration: 1800, delay, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    private buildTitle(): void {
        const cx = GAME_WIDTH / 2;
        const ty = 82;
        const scale = 5;
        const shadow = pixelText(this, cx + 5, ty + 5, GAME_TITLE, Fonts.TitleShadow, scale).setAlpha(0.45).setDepth(18);
        const title = pixelText(this, cx, ty, GAME_TITLE, Fonts.Title, scale).setDepth(19);
        this.tweens.add({ targets: [title, shadow], y: '-=3', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

        pixelText(this, cx, 136, GAME_SUBTITLE, Fonts.Gold, 2).setDepth(19);
    }

    private startVoyage(): void {
        if (this.leaving) return;
        this.leaving = true;
        this.cameras.main.fadeOut(350, 6, 24, 43);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SceneKeys.Ocean));
    }

    update(_time: number, delta: number): void {
        this.ocean.update(delta);
        const dt = delta / 1000;
        for (const cloud of this.clouds) {
            cloud.x += (cloud.getData('speed') as number) * dt;
            if (cloud.x - cloud.displayWidth / 2 > GAME_WIDTH) cloud.x = -cloud.displayWidth / 2;
            const shadow = cloud.getData('shadow') as GameObjects.Image;
            shadow.setX(cloud.x + 14);
        }
    }
}
