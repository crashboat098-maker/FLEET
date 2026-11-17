import { ShipClassId } from '../ships/shipClasses';
import { valueNoise } from './noise';

/**
 * Exploration regions of the one connected ocean. Each point belongs to the
 * nearest region "seed" after a smooth noise warp, so borders meander
 * naturally instead of following straight lines.
 */

export type RegionId = 'tropical' | 'jungle' | 'volcanic' | 'skull' | 'deep';

export interface RegionDef {
    id: RegionId;
    name: string;
    tagline: string;
    /** 1 (calm) .. 5 (deadly). */
    danger: number;
    /** Multiplicative tint for the sea surface. */
    waterTint: number;
    /** Screen haze colour + strength. */
    haze: { color: number; alpha: number };
    /** Minimap water colour. */
    chart: number;
    /** Floating gold coin value range. */
    coinValue: [number, number];
    /** Relative weight of treasure chests among floating cargo. */
    chestWeight: number;
    /** NPC ships wanted near the player while in this region. */
    population: { merchant: number; explorer: number; hunter: number; pirate: number; ghost: number };
    pirateClasses: ShipClassId[];
    /** Upgrade level applied to pirates here (difficulty). */
    pirateUpgrade: number;
    /** Chance that a pirate spawn is a captain instead. */
    captainChance: number;
    creatures: { shark: number; serpent: number; kraken: boolean };
}

export const REGIONS: Record<RegionId, RegionDef> = {
    tropical: {
        id: 'tropical',
        name: 'TROPICAL WATERS',
        tagline: 'CALM SEAS - BEGINNER WATERS',
        danger: 1,
        waterTint: 0xffffff,
        haze: { color: 0xffffff, alpha: 0 },
        chart: 0x1a6fa8,
        coinValue: [8, 14],
        chestWeight: 1,
        population: { merchant: 2, explorer: 1, hunter: 1, pirate: 1, ghost: 0 },
        pirateClasses: ['sloop'],
        pirateUpgrade: 0,
        captainChance: 0,
        creatures: { shark: 1, serpent: 0, kraken: false }
    },
    jungle: {
        id: 'jungle',
        name: 'EMERALD JUNGLE',
        tagline: 'HIDDEN COVES - TOUGHER PIRATES',
        danger: 2,
        waterTint: 0xd4f2d8,
        haze: { color: 0x2e8b3e, alpha: 0.06 },
        chart: 0x1d7a86,
        coinValue: [12, 20],
        chestWeight: 1.5,
        population: { merchant: 1, explorer: 1, hunter: 1, pirate: 2, ghost: 0 },
        pirateClasses: ['sloop', 'brigantine'],
        pirateUpgrade: 1,
        captainChance: 0.1,
        creatures: { shark: 2, serpent: 0, kraken: false }
    },
    volcanic: {
        id: 'volcanic',
        name: 'VOLCANIC SEAS',
        tagline: 'BOILING WATERS - RARE TREASURE',
        danger: 3,
        waterTint: 0xf0d0c8,
        haze: { color: 0xc8312b, alpha: 0.07 },
        chart: 0x5a4a6e,
        coinValue: [18, 30],
        chestWeight: 2.2,
        population: { merchant: 0, explorer: 1, hunter: 1, pirate: 2, ghost: 0 },
        pirateClasses: ['sloop', 'brigantine'],
        pirateUpgrade: 2,
        captainChance: 0.15,
        creatures: { shark: 1, serpent: 1, kraken: false }
    },
    skull: {
        id: 'skull',
        name: 'SKULL COAST',
        tagline: 'PIRATE STRONGHOLDS - DEADLY CAPTAINS',
        danger: 4,
        waterTint: 0xcfc8e0,
        haze: { color: 0x4a2a5a, alpha: 0.1 },
        chart: 0x3a3a6a,
        coinValue: [20, 35],
        chestWeight: 2.5,
        population: { merchant: 0, explorer: 0, hunter: 1, pirate: 3, ghost: 0 },
        pirateClasses: ['brigantine', 'sloop', 'corsair'],
        pirateUpgrade: 2,
        captainChance: 0.3,
        creatures: { shark: 1, serpent: 0, kraken: false }
    },
    deep: {
        id: 'deep',
        name: 'THE DEEP',
        tagline: 'REMOTE WATERS - MONSTERS AND GHOSTS',
        danger: 5,
        waterTint: 0xa8b8e0,
        haze: { color: 0x06182b, alpha: 0.16 },
        chart: 0x0b2a4a,
        coinValue: [30, 50],
        chestWeight: 3,
        population: { merchant: 0, explorer: 0, hunter: 1, pirate: 1, ghost: 1 },
        pirateClasses: ['brigantine', 'corsair'],
        pirateUpgrade: 3,
        captainChance: 0.2,
        creatures: { shark: 2, serpent: 1, kraken: true }
    }
};

export const REGION_ORDER: RegionId[] = ['tropical', 'jungle', 'volcanic', 'skull', 'deep'];

/** Region seeds placed around the world's landmarks; the outer rim is The Deep. */
const SEEDS: [number, number, RegionId][] = [
    [6000, 6000, 'tropical'],
    [4700, 7300, 'tropical'],
    [7400, 7300, 'tropical'],
    [7300, 5600, 'tropical'],
    [2900, 2400, 'tropical'],
    [4300, 3600, 'tropical'],
    [9700, 9800, 'tropical'],
    [8400, 8800, 'tropical'],
    [3600, 5500, 'jungle'],
    [6200, 9900, 'jungle'],
    [2300, 9500, 'jungle'],
    [4000, 8900, 'jungle'],
    [6100, 1900, 'volcanic'],
    [4800, 1500, 'volcanic'],
    [10300, 6900, 'volcanic'],
    [10600, 8200, 'volcanic'],
    [8700, 4300, 'skull'],
    [9400, 2500, 'skull'],
    [10200, 4000, 'skull'],
    [8400, 3000, 'skull'],
    [500, 500, 'deep'],
    [11500, 11500, 'deep'],
    [500, 11500, 'deep'],
    [11500, 500, 'deep'],
    [400, 6000, 'deep'],
    [6000, 11650, 'deep'],
    [11650, 5600, 'deep'],
    [6000, 350, 'deep'],
    [2800, 11650, 'deep'],
    [11650, 9800, 'deep']
];

export const regionAt = (x: number, y: number): RegionId => {
    // Smooth warp makes the borders wander naturally.
    const wx = x + (valueNoise(x / 1500, y / 1500, 11) - 0.5) * 900;
    const wy = y + (valueNoise(x / 1500, y / 1500, 23) - 0.5) * 900;
    let best: RegionId = 'tropical';
    let bestD = Infinity;
    for (const [sx, sy, id] of SEEDS) {
        const d = (sx - wx) ** 2 + (sy - wy) ** 2;
        if (d < bestD) {
            bestD = d;
            best = id;
        }
    }
    return best;
};
