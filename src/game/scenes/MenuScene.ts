import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_SUBTITLE, GAME_VERSION, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Palette } from '../config/palette';
import { LOGO_KEY, LOGO_RIBBON } from '../gfx/logo';
import { OceanBackdrop } from '../gfx/OceanBackdrop';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { ShipSprite } from '../gfx/ShipSprite';
import { TextureKeys } from '../gfx/textures';
import { clearProfile, createShip, loadProfile, newProfile, OwnedShip, Profile, saveProfile, setActiveShip } from '../ships/profile';
import { ratings, SHIP_CLASSES, ShipClassId, STARTER_CLASSES as SHIP_CLASS_ORDER } from '../ships/shipClasses';
import { hudPanel, selectFrame } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';

export interface OceanSceneData {
    profile: Profile;
}

const CARD_W = 240;
const CARD_H = 184;
const CARD_Y = 176;
const NAME_MAX = 12;

interface Card {
    cls: ShipClassId;
    frame: GameObjects.Image;
    selectable: boolean;
}

/**
 * Start screen: the FLEET logo, captain name entry, and a choice of three
 * ship classes with previews, stats, strengths/weaknesses and abilities.
 * The chosen class becomes the ship actually sailed in game.
 */
export class MenuScene extends Scene {
    private ocean!: OceanBackdrop;
    private clouds: GameObjects.Image[] = [];
    private cards: Card[] = [];
    private selected: ShipClassId = 'sloop';
    private profile: Profile | null = null;
    private name = '';
    private nameText!: GameObjects.BitmapText;
    private nameFocused = false;
    private elapsed = 0;
    private leaving = false;
    private resetArmed = false;
    /** True once the player picks a card; otherwise a returning captain keeps their flagship. */
    private chosen = false;

    constructor() {
        super(SceneKeys.Menu);
    }

    create(): void {
        this.leaving = false;
        this.clouds = [];
        this.cards = [];
        this.resetArmed = false;
        this.profile = loadProfile();
        this.name = this.profile?.captain ?? '';
        this.nameFocused = !this.name;
        const active = this.profile?.ships.find((s) => s.id === this.profile!.activeId);
        this.chosen = false;
        this.selected = active && SHIP_CLASS_ORDER.includes(active.cls) ? active.cls : 'sloop';

        this.cameras.main.fadeIn(400, 6, 24, 43);
        this.ocean = new OceanBackdrop(this);
        this.buildScenery();
        this.buildLogo();
        this.buildNameField();
        SHIP_CLASS_ORDER.forEach((cls, i) => this.buildCard(cls, 12 + i * (CARD_W + 12)));
        this.select(this.selected, false);
        if (active) {
            pixelText(this, GAME_WIDTH / 2, 366, `FLAGSHIP: ${active.name} (${SHIP_CLASSES[active.cls].name})${active.status === 'sunk' ? ' - SUNK' : ''}   OR PICK A SHIP`, Fonts.Gold).setDepth(30);
        }

        new PixelButton(this, GAME_WIDTH / 2, 388, 'PLAY', () => this.play(), { width: 150 }).setDepth(30);
        pixelText(this, GAME_WIDTH / 2, 414, 'CLICK A SHIP OR PRESS 1-3   ENTER TO SET SAIL', Fonts.Cream).setDepth(30).setAlpha(0.85);
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
        const logo = this.add.image(GAME_WIDTH / 2, 4, LOGO_KEY).setOrigin(0.5, 0).setScale(PIXEL_SCALE).setDepth(20);
        const sub = pixelText(this, GAME_WIDTH / 2, 4 + LOGO_RIBBON.y * PIXEL_SCALE, GAME_SUBTITLE, Fonts.Ink).setDepth(21);
        this.tweens.add({ targets: [logo, sub], y: '-=3', duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // Twinkles around the lettering.
        for (let i = 0; i < 6; i++) {
            const sp = this.add.image(0, 0, TextureKeys.Sparkle).setScale(PIXEL_SCALE).setDepth(22).setAlpha(0);
            const place = () => sp.setPosition(GAME_WIDTH / 2 + PMath.Between(-180, 180), PMath.Between(30, 100));
            place();
            this.tweens.add({ targets: sp, alpha: 1, duration: 300, yoyo: true, repeat: -1, delay: i * 450, repeatDelay: 2200, onRepeat: place });
        }
    }

    private buildNameField(): void {
        const y = 156;
        pixelText(this, GAME_WIDTH / 2 - 92, y, 'CAPTAIN:', Fonts.Gold).setOrigin(1, 0.5).setDepth(20);
        const box = this.add.image(GAME_WIDTH / 2 + 8, y, hudPanel(this, 180, 18)).setDepth(20);
        box.setInteractive({ useHandCursor: true }).on('pointerdown', () => (this.nameFocused = true));
        this.nameText = pixelText(this, GAME_WIDTH / 2 - 76, y + 1, '', Fonts.Cream).setOrigin(0, 0.5).setDepth(21);
    }

    private buildCard(cls: ShipClassId, x: number): void {
        const def = SHIP_CLASSES[cls];
        const owned = this.profile?.ships.filter((s) => s.cls === cls) ?? [];
        const hasFleet = (this.profile?.ships.length ?? 0) > 0;
        const selectable = !hasFleet || owned.length > 0;
        const cx = x + CARD_W / 2;
        const d = 20;

        const bg = this.add.image(x, CARD_Y, hudPanel(this, CARD_W, CARD_H)).setOrigin(0).setDepth(d).setAlpha(selectable ? 0.95 : 0.7);
        const frame = this.add.image(x, CARD_Y, selectFrame(this, CARD_W, CARD_H)).setOrigin(0).setDepth(d + 5).setVisible(false);
        if (selectable) bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(cls));

        pixelText(this, cx, CARD_Y + 13, def.name, Fonts.Gold, 2).setDepth(d + 1);
        pixelText(this, cx, CARD_Y + 29, def.role, Fonts.Cream).setDepth(d + 1).setAlpha(0.8);

        // Live ship preview, sailing east.
        new ShipSprite(this, x + 62, CARD_Y + 66, Math.PI / 2, cls, { preview: true }).setDepth(d + 2).setSailing(0.8);

        // Stat bars.
        ratings(cls).forEach((r, i) => {
            const y = CARD_Y + 44 + i * 9;
            pixelText(this, x + 122, y, r.label, Fonts.Cream).setOrigin(0, 0.5).setDepth(d + 1);
            for (let s = 0; s < 5; s++) {
                this.add.rectangle(x + 176 + s * 11, y, 9, 5, s < r.value ? Palette.gold : Palette.shadow).setStrokeStyle(1, Palette.woodDeep).setDepth(d + 1);
            }
        });

        // Strengths / weaknesses columns.
        def.strengths.forEach((t, i) => pixelText(this, x + 10, CARD_Y + 100 + i * 9, `+${t}`, Fonts.Green).setOrigin(0, 0.5).setDepth(d + 1));
        def.weaknesses.forEach((t, i) => pixelText(this, x + 128, CARD_Y + 100 + i * 9, `-${t}`, Fonts.Red).setOrigin(0, 0.5).setDepth(d + 1));

        // Special ability.
        pixelText(this, cx, CARD_Y + 134, `ABILITY: ${def.ability.name}`, Fonts.Gold).setDepth(d + 1);
        def.ability.description.forEach((t, i) => pixelText(this, cx, CARD_Y + 146 + i * 9, t, Fonts.Cream).setDepth(d + 1));

        // Ownership badge.
        let badge = 'STARTER SHIP';
        let font: (typeof Fonts)[keyof typeof Fonts] = Fonts.Green;
        if (hasFleet) {
            const afloat = owned.some((s) => s.status !== 'sunk');
            if (!owned.length) [badge, font] = [`SHIPYARD: ${def.price} GOLD`, Fonts.Cream];
            else if (afloat) [badge, font] = [owned.length > 1 ? `OWNED x${owned.length}` : 'OWNED', Fonts.Green];
            else [badge, font] = ['SUNK - RECOVER AT PORT', Fonts.Red];
        }
        pixelText(this, cx, CARD_Y + CARD_H - 11, badge, font).setDepth(d + 1);

        this.cards.push({ cls, frame, selectable });
    }

    // ------------------------------------------------------------- actions

    private select(cls: ShipClassId, byPlayer = true): void {
        const card = this.cards.find((c) => c.cls === cls);
        if (!card?.selectable) return;
        this.selected = cls;
        if (byPlayer) this.chosen = true;
        this.cards.forEach((c) => c.frame.setVisible(c.cls === cls));
    }

    private onKey(e: KeyboardEvent): void {
        if (e.key === 'Enter') return this.play();
        if (this.nameFocused) {
            if (e.key === 'Backspace') this.name = this.name.slice(0, -1);
            else if (e.key === 'Escape') this.nameFocused = false;
            else if (/^[a-zA-Z0-9 ]$/.test(e.key) && this.name.length < NAME_MAX) this.name += e.key.toUpperCase();
            return;
        }
        const n = Number(e.key);
        if (n >= 1 && n <= 3) this.select(SHIP_CLASS_ORDER[n - 1]);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const i = SHIP_CLASS_ORDER.indexOf(this.selected);
            const dir = e.key === 'ArrowLeft' ? -1 : 1;
            for (let k = 1; k <= 3; k++) {
                const next = SHIP_CLASS_ORDER[(i + dir * k + 3) % 3];
                if (this.cards.find((c) => c.cls === next)?.selectable) return this.select(next);
            }
        }
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
        const captain = this.name.trim() || 'CAPTAIN';
        let profile = this.profile;
        if (!profile || profile.ships.length === 0) {
            profile = newProfile(captain);
            const ship = createShip(this.selected, 'active');
            profile.ships.push(ship);
            profile.activeId = ship.id;
        } else {
            profile.captain = captain;
            // No card picked: carry on with the current flagship.
            const current = profile.ships.find((s) => s.id === profile!.activeId);
            if (!this.chosen && current) {
                saveProfile(profile);
                return this.launch(profile);
            }
            const owned = profile.ships.filter((s) => s.cls === this.selected);
            const pick: OwnedShip | undefined =
                owned.find((s) => s.id === profile!.activeId && s.status !== 'sunk') ?? owned.find((s) => s.status !== 'sunk') ?? owned[0];
            if (!pick) return;
            setActiveShip(profile, pick);
        }
        saveProfile(profile);
        this.launch(profile);
    }

    private launch(profile: Profile): void {
        this.leaving = true;
        this.cameras.main.fadeOut(350, 6, 24, 43);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            const data: OceanSceneData = { profile };
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
