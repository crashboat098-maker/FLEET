import { ItemTextures } from '../gfx/itemTextures';
import { WorldTextures } from '../gfx/worldTextures';

/**
 * Physical cargo. Every item occupies one hold slot. Wood, Iron and Cloth
 * are crafting materials used for repairs and upgrades; gold is currency
 * and never takes cargo space.
 */
export type ItemType = 'barrel' | 'crate' | 'chest' | 'supplies' | 'parcel' | 'wood' | 'iron' | 'cloth';
export type Material = 'wood' | 'iron' | 'cloth';
export const MATERIALS: Material[] = ['wood', 'iron', 'cloth'];

export interface ItemDef {
    type: ItemType;
    name: string;
    texture: string;
    /** Relative spawn weight among floating cargo (0 = never floats). */
    weight: number;
    /** Base sale price at a port (gold); 0 = cannot be sold. */
    sell: number;
    /** Base purchase price, or null if ports don't sell it. */
    buy: number | null;
}

export const ITEMS: Record<ItemType, ItemDef> = {
    wood: { type: 'wood', name: 'Wood', texture: WorldTextures.Wood, weight: 22, sell: 8, buy: 14 },
    iron: { type: 'iron', name: 'Iron', texture: WorldTextures.Iron, weight: 9, sell: 16, buy: 26 },
    cloth: { type: 'cloth', name: 'Cloth', texture: WorldTextures.Cloth, weight: 14, sell: 11, buy: 19 },
    barrel: { type: 'barrel', name: 'Rum Barrel', texture: ItemTextures.Barrel, weight: 20, sell: 15, buy: 24 },
    crate: { type: 'crate', name: 'Cargo Crate', texture: ItemTextures.Crate, weight: 15, sell: 22, buy: 34 },
    supplies: { type: 'supplies', name: 'Supplies', texture: ItemTextures.Supplies, weight: 12, sell: 10, buy: 16 },
    chest: { type: 'chest', name: 'Treasure Chest', texture: ItemTextures.Chest, weight: 6, sell: 90, buy: null },
    // Sealed mission cargo: delivered for a reward, never sold.
    parcel: { type: 'parcel', name: 'Sealed Parcel', texture: ItemTextures.Parcel, weight: 0, sell: 0, buy: null }
};

/** Goods shown at port markets. */
export const ITEM_ORDER: ItemType[] = ['wood', 'iron', 'cloth', 'barrel', 'crate', 'supplies', 'chest'];

/** Pick a floating cargo type; `chestWeight` scales treasure (and iron) odds by region. */
export const pickItemType = (r: number, chestWeight = 1): ItemType => {
    const defs = Object.values(ITEMS).filter((d) => d.weight > 0);
    const w = (d: ItemDef) => (d.type === 'chest' || d.type === 'iron' ? d.weight * chestWeight : d.weight);
    const total = defs.reduce((s, d) => s + w(d), 0);
    let t = r * total;
    for (const d of defs) {
        t -= w(d);
        if (t < 0) return d.type;
    }
    return 'wood';
};

/** Count of one item type in a cargo list. */
export const countOf = (cargo: ItemType[], t: ItemType) => cargo.reduce((n, c) => n + (c === t ? 1 : 0), 0);
