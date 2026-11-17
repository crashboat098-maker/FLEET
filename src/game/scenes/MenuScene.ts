import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_SUBTITLE, GAME_VERSION, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { LOGO_KEY, LOGO_RIBBON } from '../gfx/logo';
import { OceanBackdrop } from '../gfx/OceanBackdrop';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { ShipSprite } from '../gfx/ShipSprite';
import { TextureKeys } from '../gfx/textures';
import { clearProfile, loadProfile, newProfile, Profile, saveProfile } from '../ships/profile';
import { SHIP_CLASSES } from '../ships/shipClasses';
import { hudPanel } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';

export interface OceanSceneData {
    profile: Profile;
    /** Open the harbour's ship selection screen before sailing. */
    chooseShip?: boolean;
}

const NAME_Y = 196;
const NAME_MAX = 12;

/**
 * Start screen: the FLEET logo, captain name entry and PLAY. The ship is
 * chosen afterwards, in the harbour (see ShipSelectScene).
 */
export class MenuScene extends Scene {
    private ocean!: OceanBackdrop;
    private clouds: GameObjects.Image[] = [];
    private profile: Profile | null = null;
    private name = '';
    private nameText!: GameObjects.BitmapText;
    private nameFocused = false;
    private elapsed = 0;
    private leaving = false;
    private resetArmed = false;

    constructor() {
        super(SceneKeys.Menu);
    }

    create(): void {
        this.leaving = false;
        this.clouds = [];
        this.resetArmed = false;
        this.profile = loadProfile();
        this.name = this.profile?.captain ?? '';
        this.nameFocused = !this.name;

        this.cameras.main.fadeIn(400, 6, 24, 43);
        this.ocean = new OceanBackdrop(this);
        this.buildScenery();
        this.buildLogo();
        this.buildNameField();

        new PixelButton(this, GAME_WIDTH / 2, NAME_Y + 48, 'PLAY', () => this.play(), { width: 150 }).setDepth(30);
        pixelText(this, GAME_WIDTH / 2, NAME_Y + 74, 'PRESS ENTER TO SET SAIL', Fonts.Cream).setDepth(30).setAlpha(0.85);
        const ships = this.profile?.ships ?? [];
        if (ships.length) {
            const flag = ships.find((s) => s.id === this.profile!.activeId);
            const line = flag ? `FLAGSHIP: ${flag.name} (${SHIP_CLASSES[flag.cls].name})` : `FLEET: ${ships.length} SHIP${ships.length > 1 ? 'S' : ''}`;
            pixelText(this, GAME_WIDTH / 2, NAME_Y + 96, `${line} - CHOOSE YOUR SHIP AT PORT`, Fonts.Gold).setDepth(30);
        }
        pixelText(this, GAME_WIDTH - 6, GAME_HEIGHT - 6, `V${GAME_VERSION}`, Fonts.Cream).setOrigin(1, 1).setDepth(30);

        if (this.profile) {
            const reset = pixelText(this, 8, GAME_HEIGHT - 6, 'RESET SAVE', Fonts.Cream).setOrigin(0, 1).setDepth(30).setAlpha(0.6);
            reset.setInteractive({ useHandCursor: true }).on('pointerup', () => this.resetSave(reset));
        }

        this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
        this.input.on('pointerdown', (_p: unknown, over: GameObjects.GameObject[]) => {
            if (!over.length) this.nameFocused = false;
        });
    }

    // -------------------------------------------------------------- layout

    private buildScenery(): void {
        const s = PIXEL_SCALE;
        this.add.image(70, 410, TextureKeys.Island).setScale(s).setDepth(0);
        this.add.image(735, 34, TextureKeys.Island).setScale(s).setFlipX(true).setDepth(0);
        new ShipSprite(this, 600, 330, Math.PI / 2, 'sloop', { preview: true }).setDepth(5).setSailing(0.8);
        for (let i = 0; i < 3; i++) {
            const x = PMath.Between(0, GAME_WIDTH);
            const y = 60 + i * 140;
            const shadow = this.add.image(x + 14, y + 22, TextureKeys.Cloud).setScale(s).setTint(0x000000).setAlpha(0.12).setDepth(8);
            const cloud = this.add.image(x, y, TextureKeys.Cloud).setScale(s).setAlpha(0.85).setDepth(9);
            cloud.setData('shadow', shadow).setData('speed', 6 + i * 3);
            this.clouds.push(cloud);
        }
    }

    private buildLogo(): void {
        const logo = this.add.image(GAME_WIDTH / 2, 20, LOGO_KEY).setOrigin(0.5, 0).setScale(PIXEL_SCALE).setDepth(20);
        const sub = pixelText(this, GAME_WIDTH / 2, 20 + LOGO_RIBBON.y * PIXEL_SCALE, GAME_SUBTITLE, Fonts.Ink).setDepth(21);
        this.tweens.add({ targets: [logo, sub], y: '-=3', duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // Twinkles around the lettering.
        for (let i = 0; i < 6; i++) {
            const sp = this.add.image(0, 0, TextureKeys.Sparkle).setScale(PIXEL_SCALE).setDepth(22).setAlpha(0);
            const place = () => sp.setPosition(GAME_WIDTH / 2 + PMath.Between(-180, 180), PMath.Between(40, 120));
            place();
            this.tweens.add({ targets: sp, alpha: 1, duration: 300, yoyo: true, repeat: -1, delay: i * 450, repeatDelay: 2200, onRepeat: place });
        }
    }

    private buildNameField(): void {
        pixelText(this, GAME_WIDTH / 2 - 92, NAME_Y, 'CAPTAIN:', Fonts.Gold).setOrigin(1, 0.5).setDepth(20);
        const box = this.add.image(GAME_WIDTH / 2 + 8, NAME_Y, hudPanel(this, 180, 18)).setDepth(20);
        box.setInteractive({ useHandCursor: true }).on('pointerdown', () => (this.nameFocused = true));
        this.nameText = pixelText(this, GAME_WIDTH / 2 - 76, NAME_Y + 1, '', Fonts.Cream).setOrigin(0, 0.5).setDepth(21);
    }

    // ------------------------------------------------------------- actions

    private onKey(e: KeyboardEvent): void {
        if (e.key === 'Enter') return this.play();
        if (!this.nameFocused) return;
        if (e.key === 'Backspace') this.name = this.name.slice(0, -1);
        else if (e.key === 'Escape') this.nameFocused = false;
        else if (/^[a-zA-Z0-9 ]$/.test(e.key) && this.name.length < NAME_MAX) this.name += e.key.toUpperCase();
    }

    private resetSave(label: GameObjects.BitmapText): void {
        if (!this.resetArmed) {
            this.resetArmed = true;
            label.setText('CLICK AGAIN TO ERASE ALL SHIPS').setAlpha(1);
            this.time.delayedCall(3000, () => {
                this.resetArmed = false;
                label.active && label.setText('RESET SAVE').setAlpha(0.6);
            });
            return;
        }
        clearProfile();
        this.scene.restart();
    }

    private play(): void {
        if (this.leaving) return;
        const profile = this.profile ?? newProfile('CAPTAIN');
        profile.captain = this.name.trim() || 'CAPTAIN';
        saveProfile(profile);
        this.leaving = true;
        this.cameras.main.fadeOut(350, 6, 24, 43);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            const data: OceanSceneData = { profile, chooseShip: true };
            this.scene.start(SceneKeys.Ocean, data);
        });
    }

    update(_time: number, delta: number): void {
        this.elapsed += delta;
        this.ocean.update(delta);
        const cursor = this.nameFocused && Math.floor(this.elapsed / 400) % 2 === 0 ? '_' : '';
        this.nameText.setText(this.name || this.nameFocused ? this.name + cursor : 'CLICK TO TYPE NAME');
        this.nameText.setAlpha(this.name || this.nameFocused ? 1 : 0.5);

        const dt = delta / 1000;
        for (const cloud of this.clouds) {
            cloud.x += (cloud.getData('speed') as number) * dt;
            if (cloud.x - cloud.displayWidth / 2 > GAME_WIDTH) cloud.x = -cloud.displayWidth / 2;
            (cloud.getData('shadow') as GameObjects.Image).setX(cloud.x + 14);
        }
    }
}
