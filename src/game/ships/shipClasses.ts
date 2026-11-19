import type { Material } from '../state/items';
import { SPEED_CAP } from '../config/constants';

/**
 * Ship class definitions and the stat model.
 *
 * Every number that affects handling, durability or combat lives here so
 * upgrades (sails, hull, cannons, rudder, cargo, harpoons) only touch this
 * table. Every class has its own speed cap — SPEED_CAP (84) for most, but a
 * fully sail-upgraded sloop reaches SLOOP_SPEED_CAP (100, shark speed). No
 * upgrade or ability can push a ship past its class cap.
 */

export type ShipClassId = 'sloop' | 'brigantine' | 'galleon' | 'corsair';
export type AbilityId = 'tailwind' | 'broadside' | 'secure';
export type UpgradeId = 'hull' | 'cannons' | 'sails' | 'rudder' | 'cargo' | 'harpoons';

export interface ShipStats {
    maxSpeed: number;
    reverseMax: number;
    accel: number;
    brake: number;
    coastDrag: number;
    keelGrip: number;
    turnRate: number;
    turnAtRest: number;
    turnResponse: number;
    maxHp: number;
    /** Fraction of incoming damage ignored (0..1). */
    armor: number;
    cargo: number;
    /** Total broadside cannons (split between port and starboard). */
    cannons: number;
    /** Forward-firing bow chaser (unlocked by the 1st Cannons upgrade). */
    bowGuns: number;
    /** Rear-firing stern chaser (unlocked by the 2nd Cannons upgrade). */
    sternGuns: number;
    /** Damage per cannonball. */
    cannonDamage: number;
    /** Broadside reload time (ms) per side. */
    reloadMs: number;
    harpoons: number;
    /** Damage multiplier against sea creatures. */
    creatureMult: number;
}

export interface AbilityDef {
    id: AbilityId;
    name: string;
    /** Active abilities are triggered (Q); passives are always on. */
    active: boolean;
    description: string[];
}

export interface ShipClassDef {
    id: ShipClassId;
    name: string;
    role: string;
    /** Shipyard price in gold. */
    price: number;
    /** Captain level needed to buy one. */
    requiredLevel: number;
    stats: ShipStats;
    strengths: string[];
    weaknesses: string[];
    ability: AbilityDef;
    /** Multiplier on upgrade prices (bigger ships cost more to refit). */
    upgradeCostMult: number;
    /** Can this class mount a stern gun (Cannons upgrade 2)? Sloops can't. */
    sternGun: boolean;
    /** This class's absolute speed limit (SPEED_CAP for most; the sloop can reach shark speed). */
    speedCap: number;
    /** Top speed added per Sails upgrade level. */
    sailSpeedPerLevel: number;
}

/** A fully sail-upgraded sloop matches a charging shark. */
export const SLOOP_SPEED_CAP = 100;

const base = { creatureMult: 1, bowGuns: 0, sternGuns: 0 };

/** Cannons upgrade tier that adds the bow gun, and the one that adds the stern gun. */
export const BOW_GUN_TIER = 1;
export const STERN_GUN_TIER = 2;

export const SHIP_CLASSES: Record<ShipClassId, ShipClassDef> = {
    sloop: {
        id: 'sloop',
        name: 'SLOOP',
        role: 'EXPLORER',
        price: 400,
        requiredLevel: 1,
        upgradeCostMult: 1,
        // Too small for a stern gun: sloops only ever get the bow gun.
        sternGun: false,
        // Max Sails (tier 4) takes the sloop from 77 to 100 — as fast as a charging shark.
        speedCap: SLOOP_SPEED_CAP,
        sailSpeedPerLevel: (SLOOP_SPEED_CAP - 77) / 4,
        stats: {
            ...base,
            maxSpeed: 77,
            reverseMax: 20,
            accel: 34,
            brake: 60,
            coastDrag: 0.35,
            keelGrip: 3.0,
            turnRate: 1.15,
            turnAtRest: 0.45,
            turnResponse: 2.8,
            maxHp: 70,
            armor: 0,
            cargo: 4,
            cannons: 2,
            cannonDamage: 6,
            reloadMs: 2200,
            harpoons: 1
        },
        strengths: ['FASTEST CLASS', 'NIMBLE HANDLING', 'QUICK ACCEL'],
        weaknesses: ['LOW HULL', 'FEW CANNONS', 'SMALL HOLD'],
        ability: { id: 'tailwind', name: 'TAILWIND', active: true, description: ['Q: BRIEF BURST OF SPEED', '(NEVER ABOVE TOP SPEED)'] }
    },
    brigantine: {
        id: 'brigantine',
        name: 'BRIGANTINE',
        role: 'BATTLESHIP',
        price: 1500,
        requiredLevel: 3,
        upgradeCostMult: 1.5,
        sternGun: true,
        speedCap: SPEED_CAP,
        sailSpeedPerLevel: 3,
        stats: {
            ...base,
            maxSpeed: 60,
            reverseMax: 18,
            accel: 24,
            brake: 50,
            coastDrag: 0.3,
            keelGrip: 3.2,
            turnRate: 0.85,
            turnAtRest: 0.4,
            turnResponse: 2.2,
            maxHp: 140,
            armor: 0.25,
            cargo: 6,
            cannons: 8,
            cannonDamage: 8,
            reloadMs: 2600,
            harpoons: 2
        },
        strengths: ['STRONG CANNONS', 'GOOD ARMOR', 'BATTLE READY'],
        weaknesses: ['MEDIUM SPEED', 'MEDIUM CARGO', 'MEDIUM HANDLING'],
        ability: { id: 'broadside', name: 'BROADSIDE', active: false, description: ['PASSIVE: RAMMING SHIPS DEALS', 'DOUBLE DAMAGE, TAKES HALF'] }
    },
    galleon: {
        id: 'galleon',
        name: 'GALLEON',
        role: 'CARGO SHIP',
        price: 2200,
        requiredLevel: 4,
        upgradeCostMult: 1.8,
        sternGun: true,
        speedCap: SPEED_CAP,
        sailSpeedPerLevel: 3,
        stats: {
            ...base,
            maxSpeed: 50,
            reverseMax: 14,
            accel: 17,
            brake: 40,
            coastDrag: 0.25,
            keelGrip: 3.4,
            turnRate: 0.6,
            turnAtRest: 0.35,
            turnResponse: 1.6,
            maxHp: 200,
            armor: 0.15,
            cargo: 10,
            cannons: 2,
            cannonDamage: 7,
            reloadMs: 3000,
            harpoons: 1
        },
        strengths: ['LARGEST HOLD', 'MOST DURABLE', 'HAULS TREASURE'],
        weaknesses: ['SLOWEST CLASS', 'FEW CANNONS', 'POOR HANDLING'],
        ability: { id: 'secure', name: 'SECURE', active: false, description: ['PASSIVE: 40% OF CARGO IS', 'SAVED IF THE SHIP SINKS'] }
    },
    corsair: {
        id: 'corsair',
        name: 'CORSAIR',
        role: 'RARE WARSHIP',
        price: 4500,
        requiredLevel: 7,
        upgradeCostMult: 2,
        sternGun: true,
        speedCap: SPEED_CAP,
        sailSpeedPerLevel: 3,
        stats: {
            ...base,
            maxSpeed: 64,
            reverseMax: 18,
            accel: 26,
            brake: 52,
            coastDrag: 0.3,
            keelGrip: 3.2,
            turnRate: 0.9,
            turnAtRest: 0.4,
            turnResponse: 2.3,
            maxHp: 170,
            armor: 0.3,
            cargo: 5,
            cannons: 10,
            cannonDamage: 9,
            reloadMs: 2400,
            harpoons: 2
        },
        strengths: ['HEAVY CANNONS', 'THICK ARMOR', 'FAST FOR ITS SIZE'],
        weaknesses: ['SMALL HOLD', 'COSTLY REFITS', 'RARE TO FIND'],
        ability: { id: 'broadside', name: 'BROADSIDE', active: false, description: ['PASSIVE: RAMMING SHIPS DEALS', 'DOUBLE DAMAGE, TAKES HALF'] }
    }
};

/** A class's own speed limit — nothing (upgrades, Tailwind) can push a ship of this class past it. */
export const speedCapOf = (cls: ShipClassId): number => SHIP_CLASSES[cls].speedCap;

/** Classes offered on the start screen. */
export const STARTER_CLASSES: ShipClassId[] = ['sloop', 'brigantine', 'galleon'];
/** All classes, in shipyard order. */
export const SHIP_CLASS_ORDER: ShipClassId[] = ['sloop', 'brigantine', 'galleon', 'corsair'];

// --------------------------------------------------------------- abilities

export const TAILWIND = { durationMs: 5000, cooldownMs: 18000, speedMult: 1.2, accelMult: 1.7 };
export const BROADSIDE = { dealtMult: 2, takenMult: 0.5 };
export const SECURE = { fraction: 0.4 };

// ---------------------------------------------------------------- upgrades

export interface UpgradeDef {
    id: UpgradeId;
    name: string;
    maxLevel: number;
    /** Base gold cost per level (multiplied by the class's upgradeCostMult). */
    costs: number[];
    effect: string;
}

/** Early tiers are cheap; later tiers need real play to afford. */
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
    hull: { id: 'hull', name: 'HULL', maxLevel: 4, costs: [100, 260, 550, 1000], effect: '+15% MAX HULL' },
    cannons: { id: 'cannons', name: 'CANNONS', maxLevel: 4, costs: [120, 300, 620, 1100], effect: '+15% DAMAGE, -8% RELOAD' },
    sails: { id: 'sails', name: 'SAILS', maxLevel: 4, costs: [140, 320, 650, 1150], effect: '+SPEED, +8% ACCEL (CAPPED)' },
    rudder: { id: 'rudder', name: 'RUDDER', maxLevel: 4, costs: [100, 240, 500, 900], effect: '+10% TURNING' },
    cargo: { id: 'cargo', name: 'CARGO', maxLevel: 4, costs: [80, 200, 420, 800], effect: '+1 CARGO SLOT' },
    harpoons: { id: 'harpoons', name: 'HARPOONS', maxLevel: 4, costs: [100, 250, 520, 950], effect: '+25% DAMAGE VS CREATURES' }
};

export const UPGRADE_ORDER: UpgradeId[] = ['hull', 'cannons', 'sails', 'rudder', 'cargo', 'harpoons'];

export type UpgradeLevels = Record<UpgradeId, number>;

export const emptyUpgrades = (): UpgradeLevels => ({ hull: 0, cannons: 0, sails: 0, rudder: 0, cargo: 0, harpoons: 0 });

export const upgradeCost = (cls: ShipClassId, id: UpgradeId, currentLevel: number): number | null => {
    const def = UPGRADES[id];
    if (currentLevel >= def.maxLevel) return null;
    return Math.round(def.costs[currentLevel] * SHIP_CLASSES[cls].upgradeCostMult);
};

/** Effective stats for a class with upgrades applied. Speed is always capped. */
export const computeStats = (cls: ShipClassId, up: UpgradeLevels): ShipStats => {
    const b = SHIP_CLASSES[cls].stats;
    return {
        ...b,
        maxSpeed: Math.min(SHIP_CLASSES[cls].speedCap, Math.round(b.maxSpeed + SHIP_CLASSES[cls].sailSpeedPerLevel * up.sails)),
        accel: b.accel * (1 + 0.08 * up.sails),
        turnRate: b.turnRate * (1 + 0.1 * up.rudder),
        turnResponse: b.turnResponse * (1 + 0.1 * up.rudder),
        maxHp: Math.round(b.maxHp * (1 + 0.15 * up.hull)),
        cargo: b.cargo + up.cargo,
        cannonDamage: b.cannonDamage * (1 + 0.15 * up.cannons),
        bowGuns: up.cannons >= BOW_GUN_TIER ? 1 : 0,
        sternGuns: SHIP_CLASSES[cls].sternGun && up.cannons >= STERN_GUN_TIER ? 1 : 0,
        reloadMs: b.reloadMs * (1 - 0.08 * up.cannons),
        harpoons: b.harpoons + up.harpoons,
        creatureMult: 1 + 0.25 * up.harpoons
    };
};

/** 0..5 rating used for the bars on the start screen and shipyard. */
export const ratings = (cls: ShipClassId) => {
    const s = SHIP_CLASSES[cls].stats;
    return [
        { label: 'SPEED', value: Math.round((s.maxSpeed / SPEED_CAP) * 5) },
        { label: 'HANDLING', value: Math.round((s.turnRate / 1.15) * 5) },
        { label: 'HULL', value: Math.round((s.maxHp / 200) * 5) },
        { label: 'CARGO', value: Math.round((s.cargo / 10) * 5) },
        { label: 'CANNONS', value: Math.max(1, Math.round(((s.cannons * s.cannonDamage) / 90) * 5)) }
    ];
};

// ------------------------------------------------------- material costs


/** Materials each upgrade consumes, scaling with the tier being bought. */
const UPGRADE_MATERIALS: Record<UpgradeId, Material[]> = {
    hull: ['wood'],
    cannons: ['iron'],
    sails: ['cloth'],
    rudder: ['wood', 'iron'],
    cargo: ['wood'],
    harpoons: ['iron']
};

/** Materials needed to buy the next level (currentLevel 0 → buying tier 1). */
export const upgradeMaterials = (id: UpgradeId, currentLevel: number): Partial<Record<Material, number>> => {
    const out: Partial<Record<Material, number>> = {};
    const mats = UPGRADE_MATERIALS[id];
    for (const m of mats) out[m] = mats.length > 1 ? currentLevel + 1 : currentLevel + 2;
    return out;
};

export const formatMaterials = (m: Partial<Record<Material, number>>): string =>
    Object.entries(m)
        .map(([k, v]) => `${v} ${k.toUpperCase()}`)
        .join(' + ');
