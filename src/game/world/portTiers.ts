import { ShipClassId, UpgradeId } from '../ships/shipClasses';
import { ItemType } from '../state/items';
import type { MissionKind } from '../missions/missions';

/**
 * Port tiers. Each of the five ports has one tier with its own services,
 * prices and missions. Lower tiers stay useful through cheaper repairs,
 * regional trade advantages and starter-friendly offers.
 */

export interface PortTierDef {
    tier: number;
    title: string;
    services: string;
    /** What makes this port worth a visit. */
    advantage: string;
    /** Gold per HP for instant repairs. */
    repairRate: number;
    /** Highest upgrade level purchasable here, per upgrade. */
    upgradeCap: Record<UpgradeId, number>;
    shipyard: ShipClassId[];
    missionKinds: MissionKind[];
    /** Price multipliers per item (sell = what the port pays you, buy = what you pay). */
    prices: Partial<Record<ItemType, { sell: number; buy: number }>>;
    /** Mission reward multiplier. */
    rewardMult: number;
}

const caps = (hull: number, cannons: number, sails: number, rudder: number, cargo: number, harpoons: number): Record<UpgradeId, number> => ({
    hull,
    cannons,
    sails,
    rudder,
    cargo,
    harpoons
});

export const PORT_TIERS: Record<number, PortTierDef> = {
    1: {
        tier: 1,
        title: 'SMALL SETTLEMENT',
        services: 'TRADING - REPAIRS - STARTER UPGRADES - SIMPLE MISSIONS',
        advantage: 'CHEAPEST REPAIRS, CHEAP WOOD AND SUPPLIES',
        repairRate: 1.0,
        upgradeCap: caps(1, 1, 1, 1, 1, 1),
        shipyard: ['sloop'],
        missionKinds: ['deliver', 'explore', 'lost', 'wreck'],
        prices: { supplies: { sell: 1, buy: 0.75 }, barrel: { sell: 0.95, buy: 1 }, wood: { sell: 0.9, buy: 0.75 } },
        rewardMult: 1
    },
    2: {
        tier: 2,
        title: 'TRADING PORT',
        services: 'IMPROVED MARKET - BETTER REPAIRS - MORE UPGRADES - MERCHANT MISSIONS',
        advantage: 'BEST PRICES FOR RUM AND CRATES, CHEAP CLOTH',
        repairRate: 1.2,
        // Cannons 2 here so ships can get their stern gun without reaching a naval harbour.
        upgradeCap: caps(2, 2, 2, 2, 2, 1),
        shipyard: ['sloop', 'galleon'],
        missionKinds: ['deliver', 'escort', 'missing', 'lost'],
        prices: { barrel: { sell: 1.3, buy: 0.9 }, crate: { sell: 1.25, buy: 0.9 }, cloth: { sell: 1, buy: 0.75 } },
        rewardMult: 1.3
    },
    3: {
        tier: 3,
        title: 'NAVAL HARBOR',
        services: 'FORTIFIED DOCKS - COMBAT UPGRADES - WARSHIPS - BOUNTY MISSIONS',
        advantage: 'CHEAP IRON, CANNON AND HARPOON REFITS',
        repairRate: 1.1,
        upgradeCap: caps(3, 3, 2, 3, 2, 3),
        shipyard: ['sloop', 'brigantine'],
        missionKinds: ['hunt', 'bounty', 'protect', 'creature'],
        prices: { supplies: { sell: 1.4, buy: 1 }, iron: { sell: 1, buy: 0.75 } },
        rewardMult: 1.7
    },
    4: {
        tier: 4,
        title: 'MAJOR TRADING CITY',
        services: 'LARGE SHIPYARD - HIGH-VALUE TRADE - FLEET SERVICES - VALUABLE MISSIONS',
        advantage: 'TOP PRICES FOR CHESTS, CLOTH AND WOOD',
        repairRate: 1.3,
        upgradeCap: caps(3, 3, 3, 3, 4, 2),
        shipyard: ['sloop', 'brigantine', 'galleon'],
        missionKinds: ['escort', 'missing', 'rescue', 'bounty', 'wreck'],
        prices: { chest: { sell: 1.35, buy: 1 }, crate: { sell: 1.15, buy: 1 }, cloth: { sell: 1.35, buy: 1.1 }, wood: { sell: 1.25, buy: 1 } },
        rewardMult: 2.3
    },
    5: {
        tier: 5,
        title: 'PIRATE STRONGHOLD',
        services: 'RARE SHIPS - MASTER REFITS - DANGEROUS MISSIONS - BLACK MARKET',
        advantage: 'BLACK MARKET: IRON, RUM AND CHESTS SELL HIGH',
        repairRate: 1.6,
        upgradeCap: caps(4, 4, 4, 4, 4, 4),
        shipyard: ['sloop', 'brigantine', 'galleon', 'corsair'],
        missionKinds: ['bounty', 'rescue', 'siren', 'creature'],
        prices: { barrel: { sell: 1.4, buy: 1.2 }, chest: { sell: 1.25, buy: 1 }, iron: { sell: 1.5, buy: 1.3 } },
        rewardMult: 3.2
    }
};

/** Tier of each port by index (0 Driftwood Cove, 1 Saltmarrow, 2 Gullwing, 3 Coralreach, 4 Lanternfall). */
export const PORT_TIER_BY_INDEX = [1, 2, 5, 4, 3];

export const tierOf = (portIndex: number): PortTierDef => PORT_TIERS[PORT_TIER_BY_INDEX[portIndex] ?? 1];
