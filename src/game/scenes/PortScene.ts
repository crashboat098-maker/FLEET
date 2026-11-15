import { GameObjects, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys } from '../config/constants';
import { Palette } from '../config/palette';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { PortTextures } from '../gfx/portTextures';
import { ITEMS, ItemType } from '../state/items';
import { PlayerState } from '../state/PlayerState';
import { parchmentPanel, slotTexture } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';

export interface PortSceneData {
    state: PlayerState;
    portName: string;
}

/**
 * Harbour interface shown while docked. The ocean scene is paused underneath.
 * Shipyard / Merchant / Tavern are placeholders for later milestones.
 */
export class PortScene extends Scene {
    private data_!: PortSceneData;
    private status!: GameObjects.BitmapText;
    private closing = false;

    constructor() {
        super(SceneKeys.Port);
    }

    init(data: PortSceneData): void {
        this.data_ = data;
        this.closing = false;
    }

    create(): void {
        const { state, portName } = this.data_;
        const cx = GAME_WIDTH / 2;
        const W = 380;
        const H = 260;
        const top = (GAME_HEIGHT - H) / 2;

        this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, Palette.shadow, 0.55).setOrigin(0).setInteractive();
        const panel = this.add.container(0, 0);
        panel.add(this.add.image(cx, GAME_HEIGHT / 2, parchmentPanel(this, W, H)));

        // Header
        panel.add(this.add.image(cx - 118, top + 28, PortTextures.Anchor).setScale(PIXEL_SCALE));
        panel.add(this.add.image(cx + 118, top + 28, PortTextures.Anchor).setScale(PIXEL_SCALE));
        panel.add(pixelText(this, cx, top + 26, portName, Fonts.Ink, 2));
        panel.add(pixelText(this, cx, top + 46, 'SAFE HARBOUR, CAPTAIN', Fonts.Ink).setAlpha(0.75));

        // Cargo hold
        panel.add(pixelText(this, cx, top + 70, `CARGO HOLD  ${state.cargo.length}/${state.cargoCapacity}`, Fonts.Ink));
        const slot = 30;
        const gap = 8;
        const rowW = state.cargoCapacity * slot + (state.cargoCapacity - 1) * gap;
        for (let i = 0; i < state.cargoCapacity; i++) {
            const x = cx - rowW / 2 + slot / 2 + i * (slot + gap);
            const y = top + 98;
            panel.add(this.add.image(x, y, slotTexture(this, slot)));
            const item = state.cargo[i];
            if (item) panel.add(this.add.image(x, y, ITEMS[item].texture).setScale(PIXEL_SCALE));
        }
        panel.add(pixelText(this, cx, top + 124, this.cargoSummary(state.cargo), Fonts.Ink).setAlpha(0.8));

        // Placeholder services
        const services = ['SHIPYARD', 'MERCHANT', 'TAVERN'];
        services.forEach((name, i) => {
            const x = cx + (i - 1) * 114;
            panel.add(
                new PixelButton(this, x, top + 158, name, () => this.setStatus(`THE ${name} OPENS SOON. CHECK BACK, CAPTAIN!`), {
                    labelScale: 1,
                    width: 104
                })
            );
        });
        this.status = pixelText(this, cx, top + 184, '', Fonts.Ink);
        panel.add(this.status);

        panel.add(new PixelButton(this, cx, top + H - 36, 'LEAVE PORT', () => this.leave()));
        panel.add(pixelText(this, cx, top + H - 16, 'ESC / E', Fonts.Ink).setAlpha(0.6));

        // Pop-in
        panel.setScale(0.92).setAlpha(0);
        panel.x = (GAME_WIDTH * 0.08) / 2;
        panel.y = (GAME_HEIGHT * 0.08) / 2;
        this.tweens.add({ targets: panel, scale: 1, x: 0, y: 0, alpha: 1, duration: 180, ease: 'Back.easeOut' });

        // Ignore the keypress that opened the port.
        this.time.delayedCall(250, () => {
            const kb = this.input.keyboard!;
            kb.once('keydown-ESC', () => this.leave());
            kb.once('keydown-E', () => this.leave());
        });
    }

    private cargoSummary(cargo: ItemType[]): string {
        if (cargo.length === 0) return 'THE HOLD IS EMPTY';
        const counts = new Map<ItemType, number>();
        cargo.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
        return [...counts].map(([t, n]) => `${n} ${ITEMS[t].name}`).join('  ');
    }

    private setStatus(msg: string): void {
        this.status.setText(msg).setAlpha(1);
        this.tweens.killTweensOf(this.status);
        this.tweens.add({ targets: this.status, alpha: 0, delay: 1800, duration: 500 });
    }

    private leave(): void {
        if (this.closing) return;
        this.closing = true;
        this.scene.stop();
        this.scene.resume(SceneKeys.Ocean);
    }
}
