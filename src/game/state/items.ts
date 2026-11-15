import { ItemTextures } from '../gfx/itemTextures';

export type ItemType = 'barrel' | 'crate' | 'chest' | 'supplies';

export interface ItemDef {
    type: ItemType;
    name: string;
    texture: string;
    /** Relative spawn weight. */
    weight: number;
}

export const ITEMS: Record<ItemType, ItemDef> = {
    barrel: { type: 'barrel', name: 'Rum Barrel', texture: ItemTextures.Barrel, weight: 35 },
    crate: { type: 'crate', name: 'Cargo Crate', texture: ItemTextures.Crate, weight: 30 },
    supplies: { type: 'supplies', name: 'Supplies', texture: ItemTextures.Supplies, weight: 25 },
    chest: { type: 'chest', name: 'Treasure Chest', texture: ItemTextures.Chest, weight: 10 }
};

export const pickItemType = (r: number): ItemType => {
    const defs = Object.values(ITEMS);
    const total = defs.reduce((s, d) => s + d.weight, 0);
    let t = r * total;
    for (const d of defs) {
        t -= d.weight;
        if (t < 0) return d.type;
    }
    return 'barrel';
};
