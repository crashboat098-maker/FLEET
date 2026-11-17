import { GameObjects, Math as PMath, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { CombatTextures } from '../gfx/combatTextures';
import { WorldTextures } from '../gfx/worldTextures';
import { ItemTextures } from '../gfx/itemTextures';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { TextureKeys } from '../gfx/textures';
import { ITEMS, ItemType, pickItemType } from '../state/items';
import { PlayerState } from '../state/PlayerState';
import { XP } from '../state/progression';
import { CollisionWorld } from '../world/CollisionWorld';
import { REGIONS, regionAt } from '../world/regions';
import { Depth } from '../world/worldConfig';

export type Pickup = ItemType | 'coins' | 'survivor';

export interface Floating {
    type: Pickup;
    /** Gold value (coins only). */
    value: number;
    x: number;
    y: number;
    phase: number;
    active: boolean;
    sprite: GameObjects.Image;
    ripple: GameObjects.Image;
    glint?: GameObjects.Image;
    /** One-off pickup (sunk ship loot, events, missions): never respawns. */
    loot?: boolean;
    /** Mission / event this belongs to; NPCs leave tagged items alone. */
    tag?: string;
}

const PICKUP_RADIUS = 34;
const RESPAWN_MS: [number, number] = [40000, 70000];
const FULL_TOAST_COOLDOWN = 1800;
/** Share of the floating pool that is loose gold. */
const COIN_SHARE = 0.2;

const texFor = (t: Pickup) => (t === 'coins' ? CombatTextures.Coins : t === 'survivor' ? WorldTextures.Survivor : ITEMS[t].texture);

/**
 * Floating treasure: cargo (barrels, crates, supplies, chests) and gold
 * coins. Contents and coin values depend on the region. A fixed pool
 * respawns elsewhere after collection so the ocean never empties; one-off
 * loot (wrecks, events, missions) is removed for good once taken, so
 * nothing can be collected twice. Only on-screen items animate.
 */
export class CollectibleSystem {
    private readonly items: Floating[] = [];
    private lastFullToast = -Infinity;
    private elapsed = 0;
    /** Called when the player picks up a tagged item. */
    onTaggedPickup: ((tag: string) => void) | null = null;
    /** Preferred respawn spots (trade routes, wrecks, dangerous waters); null = anywhere. */
    spotHint: (() => { x: number; y: number } | null) | null = null;

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
            const item = this.create('barrel');
            this.place(item, i < 5 ? start : undefined);
            this.items.push(item);
        }
    }

    private create(type: Pickup, value = 0): Floating {
        const S = PIXEL_SCALE;
        const ripple = this.scene.add.image(0, 0, ItemTextures.Ripple).setScale(S).setAlpha(0.55).setDepth(Depth.Collectible - 1);
        const sprite = this.scene.add.image(0, 0, texFor(type)).setScale(S).setDepth(Depth.Collectible);
        const item: Floating = { type, value, x: 0, y: 0, phase: Math.random() * Math.PI * 2, active: true, sprite, ripple };
        this.setType(item, type, value);
        return item;
    }

    private setType(item: Floating, type: Pickup, value: number): void {
        item.type = type;
        item.value = value;
        item.sprite.setTexture(texFor(type));
        const shiny = type === 'chest' || type === 'coins';
        if (shiny && !item.glint) item.glint = this.scene.add.image(0, 0, TextureKeys.Sparkle).setScale(PIXEL_SCALE).setDepth(Depth.Collectible + 1);
        else if (!shiny && item.glint) {
            item.glint.destroy();
            item.glint = undefined;
        }
    }

    /** Roll contents for a spot: richer treasure in dangerous regions. */
    private roll(x: number, y: number): { type: Pickup; value: number } {
        const region = REGIONS[regionAt(x, y)];
        if (Math.random() < COIN_SHARE) return { type: 'coins', value: PMath.Between(region.coinValue[0], region.coinValue[1]) };
        return { type: pickItemType(Math.random(), region.chestWeight), value: 0 };
    }

    /** Pick an open-water spot. With `near`, stay within a ring around it; otherwise avoid the camera view. */
    private place(item: Floating, near?: { x: number; y: number }): void {
        const view = this.scene.cameras.main.worldView;
        for (let attempt = 0; attempt < 60; attempt++) {
            let x: number;
            let y: number;
            const hint = !near && this.spotHint && Math.random() < 0.7 ? this.spotHint() : null;
            if (near || hint) {
                const c = (near ?? hint)!;
                const a = Math.random() * Math.PI * 2;
                const d = near ? PMath.Between(160, 520) : PMath.Between(30, 260);
                x = c.x + Math.cos(a) * d;
                y = c.y + Math.sin(a) * d;
                if (hint && view.width > 0 && view.contains(x, y)) continue;
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
        const r = this.roll(item.x, item.y);
        this.setType(item, r.type, r.value);
        this.show(item);
    }

    private show(item: Floating): void {
        item.active = true;
        item.sprite.setPosition(item.x, item.y).setAlpha(1).setScale(PIXEL_SCALE).setAngle(0).setVisible(true);
        item.ripple.setPosition(item.x, item.y + 3).setAlpha(0.55).setVisible(true);
        item.glint?.setVisible(true);
    }

    // --------------------------------------------------------- one-off loot

    /**
     * Scatter one-off pickups (sunk ship cargo, coins, event treasure) around
     * (x, y). Collected exactly once, then removed.
     */
    spawnLoot(types: Pickup[], x: number, y: number, opts: { coinValue?: number; tag?: string; spread?: number; delayMs?: number } = {}): void {
        const spread = opts.spread ?? 30;
        types.forEach((type, i) => {
            const item = this.create(type, type === 'coins' ? (opts.coinValue ?? 20) : 0);
            item.loot = true;
            item.tag = opts.tag;
            const a = (i / Math.max(1, types.length)) * Math.PI * 2 + Math.random() * 0.6;
            const d = 20 + Math.random() * spread;
            item.x = x + Math.cos(a) * d;
            item.y = y + Math.sin(a) * d;
            if (!this.collision.isOpenWater(item.x, item.y, 6)) {
                item.x = x;
                item.y = y;
            }
            item.sprite.setPosition(x, y).setAlpha(0);
            item.ripple.setPosition(item.x, item.y + 3).setAlpha(0);
            this.scene.tweens.add({ targets: item.sprite, x: item.x, y: item.y, alpha: 1, duration: 900, ease: 'Cubic.easeOut' });
            this.scene.tweens.add({ targets: item.ripple, alpha: 0.55, duration: 900 });
            item.active = false;
            this.scene.time.delayedCall(opts.delayMs ?? 900, () => item.sprite.active && (item.active = true));
            this.items.push(item);
        });
    }

    /** Remove every remaining item with a tag (e.g. an expired event). */
    removeTagged(tag: string): void {
        for (const item of [...this.items]) if (item.tag === tag) this.destroyItem(item);
    }

    countTagged(tag: string): number {
        return this.items.filter((i) => i.tag === tag && i.active).length;
    }

    private destroyItem(item: Floating): void {
        item.sprite.destroy();
        item.ripple.destroy();
        item.glint?.destroy();
        const i = this.items.indexOf(item);
        if (i >= 0) this.items.splice(i, 1);
    }

    // ------------------------------------------------------- NPC collection

    /** Nearest untagged item for treasure-hunter NPCs. */
    nearestFor(x: number, y: number, r: number): Floating | null {
        let best: Floating | null = null;
        let bestD = r * r;
        for (const it of this.items) {
            if (!it.active || it.tag) continue;
            const d = (it.x - x) ** 2 + (it.y - y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = it;
            }
        }
        return best;
    }

    /** An NPC scoops up whatever untagged item is within `r`. */
    takeAt(x: number, y: number, r: number): Pickup | null {
        const it = this.nearestFor(x, y, r);
        if (!it) return null;
        this.consume(it);
        return it.type;
    }

    // ------------------------------------------------------------- update

    update(deltaMs: number, ship: { x: number; y: number } | null): void {
        this.elapsed += deltaMs;
        const t = this.elapsed / 1000;
        const view = this.scene.cameras.main.worldView;
        const r2 = PICKUP_RADIUS * PICKUP_RADIUS;

        for (const item of this.items) {
            if (!item.active) continue;
            if (ship) {
                const dx = item.x - ship.x;
                const dy = item.y - ship.y;
                if (dx * dx + dy * dy < r2) {
                    this.tryCollect(item);
                    if (!item.active) continue;
                }
            }
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
        if (!this.state.seaworthy) return;
        let label: string;
        if (item.type === 'survivor') {
            label = '+ CITIZEN RESCUED';
        } else if (item.type === 'coins') {
            this.state.addGold(item.value);
            this.state.addXp(XP.coinsFound);
            label = `+${item.value} GOLD`;
        } else {
            if (this.state.cargoFull) {
                if (this.elapsed - this.lastFullToast > FULL_TOAST_COOLDOWN) {
                    this.lastFullToast = this.elapsed;
                    this.state.toast('CARGO FULL!');
                }
                return;
            }
            this.state.addCargo(item.type);
            label = `+ ${ITEMS[item.type].name}`;
        }
        if (item.tag) this.onTaggedPickup?.(item.tag);
        this.consume(item);

        const text = pixelText(this.scene, item.x, item.y - 18, label, Fonts.Gold).setDepth(Depth.WorldLabel);
        this.scene.tweens.add({ targets: text, y: item.y - 46, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
    }

    /** Hide with a flourish; loot is destroyed, pool items respawn later. */
    private consume(item: Floating): void {
        item.active = false;
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
        if (item.loot) {
            this.scene.time.delayedCall(1200, () => this.destroyItem(item));
            return;
        }
        this.scene.time.delayedCall(PMath.Between(...RESPAWN_MS), () => this.place(item));
    }

    get activeCount(): number {
        return this.items.filter((i) => i.active).length;
    }

    /** Exposed for debugging / tests. */
    get all(): readonly Floating[] {
        return this.items;
    }
}
