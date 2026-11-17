import { GameObjects, Math as PMath, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { WorldTextures } from '../gfx/worldTextures';
import { ItemType } from '../state/items';
import { PlayerState } from '../state/PlayerState';
import { REGIONS } from '../world/regions';
import { WreckKind, WreckSpot } from '../world/worldFeatures';
import { Depth } from '../world/worldConfig';
import { CollectibleSystem } from './CollectibleSystem';

/** Salvaged wrecks replenish after this long (persisted, so reloads can't reset them). */
const REPLENISH_MS = 20 * 60 * 1000;
export const SALVAGE_MS = 2200;
export const SALVAGE_RANGE = 95;

interface Wreck {
    spot: WreckSpot;
    img: GameObjects.Image;
    key: string;
    /** Mission this wreck was placed for (missing merchant). */
    missionId?: number;
}

const LOOT: Record<WreckKind, { items: ItemType[]; gold: [number, number]; xp: number; name: string }> = {
    small: { items: ['wood', 'wood', 'cloth'], gold: [20, 40], xp: 10, name: 'WRECKED SLOOP' },
    merchant: { items: ['wood', 'wood', 'cloth', 'cloth', 'crate'], gold: [40, 80], xp: 20, name: 'BROKEN MERCHANT SHIP' },
    galleon: { items: ['wood', 'wood', 'wood', 'iron', 'iron', 'cloth', 'cloth', 'chest'], gold: [90, 150], xp: 35, name: 'SUNKEN GALLEON' },
    pirate: { items: ['iron', 'iron', 'iron', 'wood', 'wood', 'chest'], gold: [140, 240], xp: 50, name: 'ABANDONED PIRATE SHIP' }
};

/**
 * Shipwrecks scattered across the ocean. Each holds a finite haul (better
 * for big wrecks in dangerous waters). Salvaging empties it; it fades away
 * and only replenishes after a long time.
 */
export class WreckSystem {
    private readonly wrecks: Wreck[] = [];
    private timer = 0;

    constructor(
        private readonly scene: Scene,
        spots: WreckSpot[],
        private readonly state: PlayerState,
        private readonly collectibles: CollectibleSystem
    ) {
        for (const spot of spots) this.add(spot, `wreck:${spot.id}`);
        this.refresh();
    }

    private add(spot: WreckSpot, key: string, missionId?: number): Wreck {
        const img = this.scene.add.image(spot.x, spot.y, WorldTextures.Wreck[spot.kind]).setScale(PIXEL_SCALE).setRotation(spot.rot).setDepth(Depth.Seabed + 2);
        const w: Wreck = { spot, img, key, missionId };
        this.wrecks.push(w);
        return w;
    }

    /** Place a mission wreck (missing merchant) if it isn't there yet. */
    placeMissionWreck(missionId: number, x: number, y: number): void {
        if (this.wrecks.some((w) => w.missionId === missionId)) return;
        const w = this.add({ id: 10000 + missionId, x, y, rot: Math.random() * 6, kind: 'merchant', region: 'tropical' }, `mwreck:${missionId}`, missionId);
        w.img.setTint(0xffe8c8);
    }

    private depleted(w: Wreck): boolean {
        return this.state.wasUsed(w.key, w.missionId !== undefined ? Infinity : REPLENISH_MS);
    }

    /** Hide wrecks that are emptied; bring back replenished ones. */
    private refresh(): void {
        for (const w of this.wrecks) w.img.setVisible(!this.depleted(w));
    }

    nameOf(w: Wreck): string {
        return w.missionId !== undefined ? 'THE MISSING MERCHANT' : LOOT[w.spot.kind].name;
    }

    /** Closest salvageable wreck within range of the ship. */
    nearest(x: number, y: number): Wreck | null {
        let best: Wreck | null = null;
        let bestD = SALVAGE_RANGE * SALVAGE_RANGE;
        for (const w of this.wrecks) {
            const d = (w.spot.x - x) ** 2 + (w.spot.y - y) ** 2;
            if (d < bestD && !this.depleted(w)) {
                bestD = d;
                best = w;
            }
        }
        return best;
    }

    /**
     * Salvage a wreck: a short working animation, then the haul. Gold goes to
     * the purse, goods into the hold; whatever doesn't fit floats beside the
     * wreck (still finite). The wreck is marked used immediately, so it can't
     * be salvaged twice.
     */
    salvage(w: Wreck, onDone: (summary: string) => void): void {
        const loot = LOOT[w.spot.kind];
        const danger = REGIONS[w.spot.region].danger;
        this.state.markUsed(w.key);
        const { x, y } = w.spot;
        const S = PIXEL_SCALE;
        const work = this.scene.add.particles(x, y, 'fx-splinter', {
            x: { min: -18, max: 18 },
            y: { min: -12, max: 12 },
            speed: { min: 10, max: 40 },
            lifespan: 600,
            rotate: { min: 0, max: 360 },
            scale: S,
            alpha: { start: 1, end: 0 },
            frequency: 90
        });
        work.setDepth(Depth.Ship + 2);
        const splash = this.scene.add.particles(x, y, 'fx-splash', { x: { min: -20, max: 20 }, speed: { min: 5, max: 20 }, lifespan: 500, scale: S, alpha: { start: 0.8, end: 0 }, frequency: 220 });
        splash.setDepth(Depth.Wake + 1);
        this.scene.tweens.add({ targets: w.img, angle: w.img.angle + 6, duration: 300, yoyo: true, repeat: 3 });

        this.scene.time.delayedCall(SALVAGE_MS, () => {
            work.destroy();
            splash.destroy();
            const gold = Math.round(PMath.Between(loot.gold[0], loot.gold[1]) * (0.7 + danger * 0.15));
            // Dangerous waters hide richer pickings: a bonus iron or chest.
            const items = [...loot.items, ...(danger >= 4 && Math.random() < 0.5 ? (['iron'] as ItemType[]) : []), ...(w.spot.kind === 'pirate' && Math.random() < 0.5 ? (['chest'] as ItemType[]) : [])];
            const left = this.state.grantLoot(gold, items, `SALVAGED ${this.nameOf(w)}`);
            if (left.length) this.collectibles.spawnLoot(left, x, y, { spread: 50 });
            this.state.addXp(loot.xp);
            this.state.missionEvent({ type: 'salvaged', wreckId: w.spot.id });
            if (w.missionId !== undefined) this.state.missionEvent({ type: 'objective', missionId: w.missionId });
            this.scene.tweens.add({ targets: w.img, alpha: 0, duration: 4000, delay: 2000, onComplete: () => w.img.setVisible(false).setAlpha(1) });
            const got = items.length - left.length;
            onDone(`+${gold} GOLD, ${got} GOODS${left.length ? ` (${left.length} FLOATING - HOLD FULL)` : ''}`);
        });
    }

    update(deltaMs: number): void {
        this.timer -= deltaMs;
        if (this.timer > 0) return;
        this.timer = 5000;
        this.refresh();
    }

    /** Positions of wrecks still holding salvage (for spawn hints / chart). */
    activeSpots(): { x: number; y: number }[] {
        return this.wrecks.filter((w) => !this.depleted(w)).map((w) => w.spot);
    }

    destroy(): void {
        this.wrecks.forEach((w) => w.img.destroy());
    }
}
