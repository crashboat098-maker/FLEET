import { GameObjects, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Palette } from '../config/palette';
import { Fonts, FontKey, pixelText } from '../gfx/pixelFont';
import { PortTextures } from '../gfx/portTextures';
import { ShipSprite } from '../gfx/ShipSprite';
import { OwnedShip } from '../ships/profile';
import { ratings, SHIP_CLASSES, ShipClassId, STARTER_CLASSES } from '../ships/shipClasses';
import { PlayerState } from '../state/PlayerState';
import { parchmentPanel, selectFrame } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';
import type { PortSceneData } from './PortScene';

export interface ShipSelectSceneData {
    state: PlayerState;
    /** Everything the full port menu needs, for the PORT SERVICES button. */
    port: PortSceneData;
}

const PANEL_W = 740;
const PANEL_H = 412;
const CARD_H = 262;
const GAP = 10;
const PAGE_SIZE = 4;

/** One choice on screen: a free starter class (new captain) or a ship already owned. */
type Choice = { kind: 'starter'; cls: ShipClassId } | { kind: 'owned'; ship: OwnedShip };

interface Card {
    choice: Choice;
    selectable: boolean;
    frame: GameObjects.Image;
}

const clsOf = (c: Choice): ShipClassId => (c.kind === 'starter' ? c.cls : c.ship.cls);
const keyOf = (c: Choice): string => (c.kind === 'starter' ? c.cls : c.ship.id);

/** Flagship first, then ships ready to sail, then ones that can't. */
const ORDER: Record<OwnedShip['status'], number> = { active: 0, escort: 1, stored: 2, repair: 3, sunk: 4 };

/**
 * Harbour departure screen, shown over the paused ocean when a voyage starts.
 * A new captain picks a free starter ship; a returning captain picks which of
 * their ships to sail as flagship. SET SAIL launches it from this port.
 */
export class ShipSelectScene extends Scene {
    private data_!: ShipSelectSceneData;
    private content!: GameObjects.Container;
    private sprites: ShipSprite[] = [];
    private cards: Card[] = [];
    private selected: string | null = null;
    private page = 0;
    private sailBtn!: PixelButton;
    private message!: GameObjects.BitmapText;
    private hint!: GameObjects.BitmapText;
    private closing = false;
    private left = 0;
    private top = 0;

    constructor() {
        super(SceneKeys.ShipSelect);
    }

    init(data: ShipSelectSceneData): void {
        this.data_ = data;
        this.closing = false;
        this.page = 0;
        this.sprites = [];
        this.cards = [];
        this.selected = null;
    }

    private get state(): PlayerState {
        return this.data_.state;
    }

    private get isNewCaptain(): boolean {
        return this.state.ships.length === 0;
    }

    create(): void {
        this.left = (GAME_WIDTH - PANEL_W) / 2;
        this.top = (GAME_HEIGHT - PANEL_H) / 2;
        const cx = GAME_WIDTH / 2;
        const s = this.state;

        this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, Palette.shadow, 0.6).setOrigin(0).setInteractive();
        this.add.image(cx, GAME_HEIGHT / 2, parchmentPanel(this, PANEL_W, PANEL_H));
        this.add.image(cx - 170, this.top + 20, PortTextures.Anchor).setScale(PIXEL_SCALE);
        this.add.image(cx + 170, this.top + 20, PortTextures.Anchor).setScale(PIXEL_SCALE);
        pixelText(this, cx, this.top + 18, this.data_.port.portName, Fonts.Ink, 2);
        pixelText(this, cx, this.top + 34, this.isNewCaptain ? 'CHOOSE YOUR FIRST SHIP - IT IS FREE' : 'CHOOSE YOUR SHIP', Fonts.Ink).setAlpha(0.8);
        pixelText(this, this.left + 16, this.top + 18, `CAPT. ${s.captain}  LV ${s.level}`, Fonts.Ink).setOrigin(0, 0.5);
        pixelText(this, this.left + PANEL_W - 16, this.top + 18, `GOLD: ${s.gold}`, Fonts.Ink).setOrigin(1, 0.5);

        this.content = this.add.container(0, 0);
        const bottom = this.top + PANEL_H - 40;
        this.sailBtn = new PixelButton(this, cx, bottom, 'SET SAIL', () => this.setSail(), { width: 150 });
        if (!this.isNewCaptain) {
            new PixelButton(this, this.left + 92, bottom, 'PORT SERVICES', () => this.openPortServices(), { labelScale: 1, width: 132 });
        }
        this.hint = pixelText(this, cx, this.top + PANEL_H - 18, 'CLICK A SHIP OR PRESS 1-4    ENTER TO SET SAIL', Fonts.Ink).setAlpha(0.7);
        this.message = pixelText(this, cx, this.top + PANEL_H - 18, '', Fonts.Ink).setVisible(false);

        const choices = this.choices();
        const first = choices.find((c) => this.canSail(c) && (c.kind === 'starter' || c.ship.status === 'active')) ?? choices.find((c) => this.canSail(c));
        this.selected = first ? keyOf(first) : null;
        this.render();

        // Ignore the keypress that started the voyage.
        this.time.delayedCall(250, () => this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e)));
        // Ships in dry dock become ready while the screen is open.
        this.time.addEvent({ delay: 1000, loop: true, callback: () => (this.state.settleDryDock() ? this.render() : this.refreshTimers()) });
        this.events.once('shutdown', () => this.clearCards());
    }

    // ---------------------------------------------------------------- data

    private choices(): Choice[] {
        if (this.isNewCaptain) return STARTER_CLASSES.map((cls) => ({ kind: 'starter', cls }));
        return [...this.state.ships].sort((a, b) => ORDER[a.status] - ORDER[b.status]).map((ship) => ({ kind: 'owned', ship }));
    }

    private canSail(c: Choice): boolean {
        if (c.kind === 'starter') return true;
        return c.ship.status !== 'sunk' && c.ship.status !== 'repair' && c.ship.hp > 0;
    }

    private get pageCount(): number {
        return Math.max(1, Math.ceil(this.choices().length / PAGE_SIZE));
    }

    // -------------------------------------------------------------- layout

    private clearCards(): void {
        this.sprites.forEach((sp) => sp.destroy());
        this.sprites = [];
        this.cards = [];
        this.content.removeAll(true);
    }

    private render(): void {
        this.clearCards();
        const all = this.choices();
        this.page = Math.min(this.page, this.pageCount - 1);
        const shown = all.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
        const slots = this.isNewCaptain ? shown.length : PAGE_SIZE;
        const w = Math.floor((PANEL_W - 28 - GAP * (slots - 1)) / slots);
        const x0 = GAME_WIDTH / 2 - (slots * w + (slots - 1) * GAP) / 2;
        shown.forEach((c, i) => this.buildCard(c, x0 + i * (w + GAP), this.top + 48, w));

        if (this.pageCount > 1) {
            const bx = this.left + PANEL_W - 70;
            const by = this.top + PANEL_H - 40;
            this.content.add(pixelText(this, bx - 52, by, `PAGE ${this.page + 1}/${this.pageCount}`, Fonts.Ink));
            const prev = new PixelButton(this, bx, by, '<', () => this.turnPage(-1), { labelScale: 1, width: 36 }).setEnabled(this.page > 0);
            const next = new PixelButton(this, bx + 42, by, '>', () => this.turnPage(1), { labelScale: 1, width: 36 }).setEnabled(this.page < this.pageCount - 1);
            this.content.add([prev, next]);
        }
        this.highlight();
    }

    private buildCard(choice: Choice, x: number, y: number, w: number): void {
        const cls = clsOf(choice);
        const def = SHIP_CLASSES[cls];
        const selectable = this.canSail(choice);
        const cx = x + w / 2;
        const parts: GameObjects.GameObject[] = [];
        const text = (tx: number, ty: number, s: string, font: FontKey = Fonts.Ink, scale = 1, originX = 0.5) => {
            const t = pixelText(this, tx, ty, s, font, scale).setOrigin(originX, 0.5);
            parts.push(t);
            return t;
        };

        const bg = this.add.rectangle(x, y, w, CARD_H, Palette.sailShade, 0.45).setOrigin(0).setStrokeStyle(2, Palette.woodDark);
        parts.push(bg);
        if (selectable) {
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerup', () => this.select(keyOf(choice)));
        }

        text(cx, y + 14, def.name, Fonts.Ink, 2);
        if (choice.kind === 'owned') text(cx, y + 31, choice.ship.name);
        else text(cx, y + 31, def.role).setAlpha(0.7);

        const sprite = new ShipSprite(this, cx, y + 68, Math.PI / 2, cls, { preview: true }).setSailing(selectable ? 0.8 : 0);
        if (!selectable) sprite.setAlpha(0.5);
        this.sprites.push(sprite);

        // Stat bars.
        ratings(cls).forEach((r, i) => {
            const ry = y + 104 + i * 9;
            text(x + 12, ry, r.label, Fonts.Ink, 1, 0);
            for (let k = 0; k < 5; k++) {
                parts.push(this.add.rectangle(x + w - 66 + k * 11, ry, 9, 5, k < r.value ? Palette.gold : Palette.sail).setStrokeStyle(1, Palette.woodDeep));
            }
        });

        if (choice.kind === 'starter') {
            def.strengths.forEach((t, i) => text(x + 12, y + 156 + i * 9, `+${t}`, Fonts.Green, 1, 0));
            def.weaknesses.forEach((t, i) => text(x + w / 2 + 4, y + 156 + i * 9, `-${t}`, Fonts.Red, 1, 0));
            text(cx, y + 194, `ABILITY: ${def.ability.name}`);
            def.ability.description.forEach((t, i) => text(cx, y + 206 + i * 9, t).setAlpha(0.8));
            text(cx, y + CARD_H - 14, 'FREE STARTER SHIP', Fonts.Green);
        } else {
            const ship = choice.ship;
            const st = this.state.statsOf(ship);
            const ratio = ship.hp / Math.max(1, st.maxHp);
            text(x + 12, y + 158, `HULL ${Math.ceil(ship.hp)}/${st.maxHp}`, Fonts.Ink, 1, 0);
            const barW = w - 24;
            parts.push(this.add.rectangle(x + 12, y + 170, barW, 6, Palette.sail).setOrigin(0, 0.5).setStrokeStyle(1, Palette.woodDeep));
            const color = ratio > 0.5 ? 0x5cb85c : ratio > 0.25 ? Palette.goldShade : Palette.flagRed;
            parts.push(this.add.rectangle(x + 13, y + 170, Math.max(0, (barW - 2) * ratio), 4, color).setOrigin(0, 0.5));
            const upgrades = Object.values(ship.upgrades).reduce((a, b) => a + b, 0);
            text(x + 12, y + 184, `CARGO ${ship.cargo.length}/${st.cargo}   UPGRADES ${upgrades}`, Fonts.Ink, 1, 0);
            text(x + 12, y + 196, `ABILITY: ${def.ability.name}`, Fonts.Ink, 1, 0);

            const [badge, font] = this.badge(ship);
            const label = text(cx, y + CARD_H - 14, badge, font);
            label.setData('repairOf', ship.status === 'repair' ? ship : null);
            if (ship.status === 'sunk') text(cx, y + CARD_H - 26, 'RECOVER IN PORT SERVICES').setAlpha(0.8);
        }

        if (!selectable) parts.forEach((p) => p !== bg && (p as GameObjects.BitmapText).setAlpha?.(0.55));
        const frame = this.add.image(x - 2, y - 2, selectFrame(this, w + 4, CARD_H + 4)).setOrigin(0).setVisible(false);
        parts.push(frame);
        this.content.add(parts);
        this.cards.push({ choice, selectable, frame });
    }

    private badge(ship: OwnedShip): [string, FontKey] {
        switch (ship.status) {
            case 'active':
                return ['FLAGSHIP', Fonts.Green];
            case 'escort':
                return ['SAILING AS ESCORT', Fonts.Green];
            case 'stored':
                return [ship.hp <= 0 ? 'NEEDS REPAIR' : 'IN PORT', ship.hp <= 0 ? Fonts.Red : Fonts.Ink];
            case 'repair':
                return [this.repairLabel(ship), Fonts.Red];
            case 'sunk':
                return ['SUNK', Fonts.Red];
        }
    }

    private repairLabel(ship: OwnedShip): string {
        const left = Math.max(0, Math.ceil(((ship.repairUntil ?? 0) - Date.now()) / 1000));
        return `DRY DOCK ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }

    private refreshTimers(): void {
        for (const obj of this.content.list) {
            const ship = (obj as GameObjects.BitmapText).getData?.('repairOf') as OwnedShip | null;
            if (ship) (obj as GameObjects.BitmapText).setText(this.repairLabel(ship));
        }
    }

    // ------------------------------------------------------------- actions

    private select(key: string): void {
        if (!this.cards.some((c) => c.selectable && keyOf(c.choice) === key)) return;
        this.selected = key;
        this.highlight();
    }

    private highlight(): void {
        this.cards.forEach((c) => c.frame.setVisible(keyOf(c.choice) === this.selected));
        const ready = this.choices().some((c) => keyOf(c) === this.selected && this.canSail(c));
        this.sailBtn.setEnabled(ready);
        if (!ready && !this.message.visible) this.say('NO SHIP IS READY - RECOVER OR REPAIR ONE IN PORT SERVICES', false);
    }

    private turnPage(dir: number): void {
        this.page = Math.max(0, Math.min(this.pageCount - 1, this.page + dir));
        this.render();
    }

    private onKey(e: KeyboardEvent): void {
        if (this.closing) return;
        if (e.key === 'Enter') return this.setSail();
        const n = Number(e.key);
        if (n >= 1 && n <= this.cards.length) return this.select(keyOf(this.cards[n - 1].choice));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const dir = e.key === 'ArrowLeft' ? -1 : 1;
            const i = this.cards.findIndex((c) => keyOf(c.choice) === this.selected);
            for (let k = 1; k <= this.cards.length; k++) {
                const c = this.cards[(i + dir * k + this.cards.length * 2) % this.cards.length];
                if (c.selectable) return this.select(keyOf(c.choice));
            }
        }
    }

    private say(msg: string, fade = true): void {
        this.hint.setVisible(false);
        this.message.setText(msg.toUpperCase()).setVisible(true).setAlpha(1);
        this.tweens.killTweensOf(this.message);
        if (fade) {
            this.tweens.add({
                targets: this.message,
                alpha: 0,
                delay: 2600,
                duration: 400,
                onComplete: () => {
                    this.message.setVisible(false);
                    this.hint.setVisible(true);
                }
            });
        }
    }

    private setSail(): void {
        if (this.closing) return;
        const choice = this.choices().find((c) => keyOf(c) === this.selected);
        if (!choice || !this.canSail(choice)) return this.say('PICK A SHIP THAT IS READY TO SAIL');
        const ok = choice.kind === 'starter' ? !!this.state.claimStarterShip(choice.cls) : this.state.makeFlagship(choice.ship);
        if (!ok || !this.state.seaworthy) return this.say('THAT SHIP CANNOT SAIL RIGHT NOW');
        this.closing = true;
        this.scene.stop();
        this.scene.resume(SceneKeys.Ocean);
    }

    private openPortServices(): void {
        if (this.closing) return;
        this.closing = true;
        this.scene.start(SceneKeys.Port, this.data_.port);
    }
}
