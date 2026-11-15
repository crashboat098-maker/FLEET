import { GameObjects, Math as PMath, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { ItemTextures } from '../gfx/itemTextures';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { TextureKeys } from '../gfx/textures';
import { ITEMS, ItemType, pickItemType } from '../state/items';
import { PlayerState } from '../state/PlayerState';
import { CollisionWorld } from '../world/CollisionWorld';
import { Depth } from '../world/worldConfig';

interface Floating {
    type: ItemType;
    x: number;
    y: number;
    phase: number;
    active: boolean;
    sprite: GameObjects.Image;
    ripple: GameObjects.Image;
    glint?: GameObjects.Image;
}

const PICKUP_RADIUS = 34;
const RESPAWN_MS: [number, number] = [18000, 32000];
const FULL_TOAST_COOLDOWN = 1800;

/**
 * Floating barrels, crates, chests and supply bundles.
 * Fixed-size pool: collected items hide, then respawn elsewhere (off-screen)
 * after a delay, so the ocean never empties. Only on-screen items animate.
 */
export class CollectibleSystem {
    private readonly items: Floating[] = [];
    private lastFullToast = -Infinity;
    private elapsed = 0;

    constructor(
        private readonly scene: Scene,
        private readonly collision: CollisionWorld,
        private readonly state: PlayerState,
        private readonly worldSize: number,
        count: number,
        /** A few items are seeded near here so there's something to find right away. */
        start: { x: number; y: number }
    ) {
        for (let i = 0; i < count; i++) {
            const near = i < 5 ? start : undefined;
            const item = this.create(pickItemType(Math.random()));
            this.place(item, near);
            this.items.push(item);
        }
    }

    private create(type: ItemType): Floating {
        const S = PIXEL_SCALE;
        const ripple = this.scene.add.image(0, 0, ItemTextures.Ripple).setScale(S).setAlpha(0.55).setDepth(Depth.Collectible - 1);
        const sprite = this.scene.add.image(0, 0, ITEMS[type].texture).setScale(S).setDepth(Depth.Collectible);
        const item: Floating = { type, x: 0, y: 0, phase: Math.random() * Math.PI * 2, active: true, sprite, ripple };
        if (type === 'chest') {
            item.glint = this.scene.add.image(0, 0, TextureKeys.Sparkle).setScale(S).setDepth(Depth.Collectible + 1);
        }
        return item;
    }

    /** Pick an open-water spot. With `near`, stay within a ring around it; otherwise avoid the camera view. */
    private place(item: Floating, near?: { x: number; y: number }): void {
        const view = this.scene.cameras.main.worldView;
        for (let attempt = 0; attempt < 60; attempt++) {
            let x: number;
            let y: number;
            if (near) {
                const a = Math.random() * Math.PI * 2;
                const d = PMath.Between(160, 520);
                x = near.x + Math.cos(a) * d;
                y = near.y + Math.sin(a) * d;
            } else {
                x = PMath.Between(80, this.worldSize - 80);
                y = PMath.Between(80, this.worldSize - 80);
                if (view.width > 0 && view.contains(x, y)) continue;
            }
            if (!this.collision.isOpenWater(x, y, 30)) continue;
            if (this.items.some((o) => o !== item && o.active && Math.hypot(o.x - x, o.y - y) < 60)) continue;
            item.x = x;
            item.y = y;
            break;
        }
        item.active = true;
        item.sprite.setPosition(item.x, item.y).setAlpha(1).setScale(PIXEL_SCALE).setAngle(0).setVisible(true);
        item.ripple.setPosition(item.x, item.y + 3).setAlpha(0.55).setVisible(true);
        item.glint?.setVisible(true);
    }

    update(deltaMs: number, ship: { x: number; y: number }): void {
        this.elapsed += deltaMs;
        const t = this.elapsed / 1000;
        const view = this.scene.cameras.main.worldView;
        const r2 = PICKUP_RADIUS * PICKUP_RADIUS;

        for (const item of this.items) {
            if (!item.active) continue;

            const dx = item.x - ship.x;
            const dy = item.y - ship.y;
            if (dx * dx + dy * dy < r2) {
                this.tryCollect(item);
                if (!item.active) continue;
            }

            // Animate only what the camera can see (plus a small margin).
            if (item.x < view.x - 40 || item.x > view.right + 40 || item.y < view.y - 40 || item.y > view.bottom + 40) continue;
            const bob = Math.sin(t * 2.2 + item.phase);
            item.sprite.y = item.y + Math.round(bob * 1.5);
            item.sprite.angle = Math.sin(t * 1.3 + item.phase) * 6;
            item.ripple.setScale(PIXEL_SCALE * (1 + 0.08 * bob), PIXEL_SCALE);
            if (item.glint) {
                const g = Math.max(0, Math.sin(t * 3 + item.phase * 3));
                item.glint.setPosition(item.x + 7, item.sprite.y - 7).setAlpha(g * g);
            }
        }
    }

    private tryCollect(item: Floating): void {
        if (this.state.cargoFull) {
            if (this.elapsed - this.lastFullToast > FULL_TOAST_COOLDOWN) {
                this.lastFullToast = this.elapsed;
                this.state.toast('CARGO FULL!');
            }
            return;
        }
        this.state.addCargo(item.type);
        item.active = false;

        // Pickup flourish: hop up, spin, fade; plus a floating label.
        this.scene.tweens.add({
            targets: item.sprite,
            y: item.y - 26,
            scale: PIXEL_SCALE * 1.4,
            angle: 25,
            alpha: 0,
            duration: 450,
            ease: 'Back.easeIn',
            onComplete: () => item.sprite.setVisible(false)
        });
        this.scene.tweens.add({ targets: item.ripple, alpha: 0, scaleX: PIXEL_SCALE * 2, duration: 400 });
        item.glint?.setVisible(false);

        const label = pixelText(this.scene, item.x, item.y - 18, `+ ${ITEMS[item.type].name}`, Fonts.Gold).setDepth(Depth.WorldLabel);
        this.scene.tweens.add({
            targets: label,
            y: item.y - 46,
            alpha: 0,
            duration: 1100,
            ease: 'Cubic.easeOut',
            onComplete: () => label.destroy()
        });

        this.scene.time.delayedCall(PMath.Between(...RESPAWN_MS), () => {
            // Respawned items get a fresh random type.
            const type = pickItemType(Math.random());
            if (type !== item.type) {
                item.sprite.setTexture(ITEMS[type].texture);
                if (type === 'chest' && !item.glint) {
                    item.glint = this.scene.add.image(0, 0, TextureKeys.Sparkle).setScale(PIXEL_SCALE).setDepth(Depth.Collectible + 1);
                } else if (type !== 'chest' && item.glint) {
                    item.glint.destroy();
                    item.glint = undefined;
                }
                item.type = type;
            }
            this.place(item);
        });
    }

    /** For debugging / tests. */
    get activeCount(): number {
        return this.items.filter((i) => i.active).length;
    }
}
