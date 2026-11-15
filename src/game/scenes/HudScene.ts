import { GameObjects, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_TITLE, GAME_WIDTH, SceneKeys } from '../config/constants';
import { Palette } from '../config/palette';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { PlayerState, StateEvents } from '../state/PlayerState';
import { hudPanel } from '../ui/panels';
import { MINIMAP_SIZE } from '../world/terrainTextures';
import { WorldData } from '../world/WorldGenerator';

export interface HudSceneData {
    state: PlayerState;
    world: WorldData;
    getShip: () => { x: number; y: number };
}

/**
 * Screen-space HUD drawn above the ocean: ship stats, minimap,
 * control hints, toasts and contextual prompts.
 */
export class HudScene extends Scene {
    private data_!: HudSceneData;
    private lines: GameObjects.BitmapText[] = [];
    private toastText!: GameObjects.BitmapText;
    private promptGroup!: GameObjects.Container;
    private promptText!: GameObjects.BitmapText;
    private mapDot!: GameObjects.Rectangle;
    private mapOrigin = { x: 0, y: 0 };
    private elapsed = 0;

    constructor() {
        super(SceneKeys.Hud);
    }

    init(data: HudSceneData): void {
        this.data_ = data;
    }

    create(): void {
        const { state, world } = this.data_;

        // --- Stats plate (top-left)
        this.add.image(4, 4, hudPanel(this, 104, 62)).setOrigin(0);
        pixelText(this, 10, 10, GAME_TITLE, Fonts.Gold).setOrigin(0);
        this.lines = [0, 1, 2, 3].map((i) => pixelText(this, 10, 22 + i * 10, '', Fonts.Cream).setOrigin(0));

        // --- Minimap (top-right)
        const mm = MINIMAP_SIZE;
        const mx = GAME_WIDTH - mm - 8;
        const my = 8;
        this.mapOrigin = { x: mx, y: my };
        this.add.image(mx - 4, my - 4, hudPanel(this, mm + 8, mm + 8)).setOrigin(0);
        this.add.image(mx, my, 'minimap').setOrigin(0);
        const scale = mm / world.size;
        const port = world.port.dockEnd;
        this.add.rectangle(mx + port.x * scale, my + port.y * scale, 3, 3, Palette.gold).setStrokeStyle(1, Palette.woodDeep);
        this.mapDot = this.add.rectangle(mx, my, 3, 3, Palette.flagRed).setStrokeStyle(1, Palette.foamWhite);
        pixelText(this, mx + mm / 2, my + mm + 9, 'CHART', Fonts.Cream).setAlpha(0.8);

        // --- Control hints (bottom-left)
        const hint = 'WASD/ARROWS: SAIL   E: DOCK   ESC: MENU';
        const hw = hint.length * 6 + 10;
        this.add.image(4, GAME_HEIGHT - 18, hudPanel(this, hw, 14)).setOrigin(0).setAlpha(0.85);
        pixelText(this, 9, GAME_HEIGHT - 15, hint, Fonts.Cream).setOrigin(0);

        // --- Toast (top-centre) & prompt (bottom-centre)
        this.toastText = pixelText(this, GAME_WIDTH / 2, 84, '', Fonts.Gold, 2).setAlpha(0);
        this.promptText = pixelText(this, 0, 0, '', Fonts.Cream);
        const promptBg = this.add.image(0, 0, hudPanel(this, 200, 16));
        this.promptGroup = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 52, [promptBg, this.promptText]).setVisible(false);

        // --- Wire up state
        const refresh = () => this.refresh();
        const onToast = (msg: string) => this.showToast(msg);
        const onPrompt = (msg: string | null) => this.showPrompt(msg);
        state.on(StateEvents.Changed, refresh);
        state.on(StateEvents.Toast, onToast);
        state.on(StateEvents.Prompt, onPrompt);
        this.events.once('shutdown', () => {
            state.off(StateEvents.Changed, refresh);
            state.off(StateEvents.Toast, onToast);
            state.off(StateEvents.Prompt, onPrompt);
        });
        this.refresh();
    }

    private refresh(): void {
        const s = this.data_.state;
        const text = [`SHIP: ${s.shipName}`, `HULL: ${s.hull}/${s.hullMax}`, `CARGO: ${s.cargo.length}/${s.cargoCapacity}`, `GOLD: ${s.gold}`];
        text.forEach((t, i) => this.lines[i].setText(t));
        // Cargo line turns gold when the hold is full.
        this.lines[2].setFont(s.cargoFull ? Fonts.Gold : Fonts.Cream);
    }

    private showToast(msg: string): void {
        this.tweens.killTweensOf(this.toastText);
        this.toastText.setText(msg.toUpperCase()).setAlpha(1).setY(84);
        this.tweens.add({ targets: this.toastText, alpha: 0, y: 76, delay: 1400, duration: 500 });
    }

    private showPrompt(msg: string | null): void {
        if (!msg) {
            this.promptGroup.setVisible(false);
            return;
        }
        this.promptText.setText(msg.toUpperCase());
        this.promptGroup.setVisible(true);
    }

    update(_time: number, delta: number): void {
        this.elapsed += delta;
        const ship = this.data_.getShip();
        const scale = MINIMAP_SIZE / this.data_.world.size;
        this.mapDot.setPosition(Math.round(this.mapOrigin.x + ship.x * scale), Math.round(this.mapOrigin.y + ship.y * scale));
        this.mapDot.setVisible(Math.floor(this.elapsed / 400) % 3 !== 0);
        if (this.promptGroup.visible) this.promptText.setAlpha(0.65 + 0.35 * Math.sin(this.elapsed / 180));
    }
}
