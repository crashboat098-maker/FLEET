/**
 * Captain progression: XP curve, rewards table and level unlocks.
 * Captain XP is permanent and independent of any single ship.
 */

export const MAX_LEVEL = 30;

/** XP needed to go from `level` to `level + 1` — rises gradually. */
export const xpToNext = (level: number): number => Math.round(100 * Math.pow(level, 1.4));

export const levelInfo = (xp: number): { level: number; into: number; need: number } => {
    let level = 1;
    let left = Math.max(0, xp);
    while (level < MAX_LEVEL && left >= xpToNext(level)) {
        left -= xpToNext(level);
        level++;
    }
    return { level, into: left, need: level >= MAX_LEVEL ? 1 : xpToNext(level) };
};

/** XP awarded per activity. One-time discoveries are tracked in the profile. */
export const XP = {
    islandDiscovered: 20,
    regionDiscovered: 100,
    chestFound: 10,
    coinsFound: 1,
    /** 1 XP per this much gold earned by selling cargo. */
    tradeGoldPerXp: 25,
    kill: { pirate: 40, captain: 160, ghost: 90, shark: 15, serpent: 90, kraken: 500, archer: 8, merchant: 0, explorer: 0, hunter: 0 } as Record<string, number>,
    eventBonus: 80
};

/** Escort slots unlock with captain level. */
export const maxEscorts = (level: number): number => (level >= 6 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0);
