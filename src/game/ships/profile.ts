import type { ActiveMission } from '../missions/missions';
import { ItemType } from '../state/items';
import { computeStats, emptyUpgrades, ShipClassId, SHIP_CLASSES, UpgradeLevels } from './shipClasses';

/**
 * Persistent captain profile: owned ships (with upgrades, cargo and status),
 * gold, Captain XP, discoveries and missions.
 *
 * Ships are NEVER deleted when they sink — they are marked 'sunk' and keep
 * their class, upgrades and protected cargo until recovered at a port.
 * Stored in localStorage; the shape is plain JSON so it can move server-side.
 */

/**
 * active = the flagship, stored = docked at port, escort = sailing with the
 * flagship, sunk = wrecked (recoverable), repair = in dry dock.
 */
export type ShipStatus = 'active' | 'stored' | 'escort' | 'sunk' | 'repair';

export type Formation = 'line' | 'wedge' | 'flank';

export interface OwnedShip {
    id: string;
    cls: ShipClassId;
    name: string;
    hp: number;
    status: ShipStatus;
    upgrades: UpgradeLevels;
    cargo: ItemType[];
    /** Cargo saved by the Galleon's SECURE ability; returned on recovery. */
    protectedCargo: ItemType[];
    /** Dry-dock completion time (ms epoch) while status is 'repair'. */
    repairUntil?: number;
}

export interface Profile {
    version: 2;
    captain: string;
    gold: number;
    xp: number;
    ships: OwnedShip[];
    activeId: string | null;
    discoveredIslands: number[];
    discoveredRegions: string[];
    missions: ActiveMission[];
    /** Monotonic id source for missions (prevents duplicated rewards). */
    missionSeq: number;
    /** Mission board refresh counter per port. */
    boardEpoch: number[];
    formation: Formation;
    stats: { kills: number; missions: number; treasure: number };
    /** One-time interactions (wreck salvage, shore chests): id -> time used (ms). */
    used: Record<string, number>;
}

const STORAGE_KEY = 'fleet.profile.v1';
export const STARTING_GOLD = 100;

const NAME_A = ['SEA', 'SALT', 'GOLDEN', 'STORM', 'SILVER', 'CRIMSON', 'GHOST', 'LUCKY', 'IRON', 'CORAL', 'TIDE', 'BRASS', 'EMERALD', 'MIDNIGHT', 'SUNNY', 'WILD'];
const NAME_B = ['SPARROW', 'GULL', 'MAIDEN', 'RAVEN', 'DOLPHIN', 'TERN', 'ROVER', 'WIND', 'FANG', 'PEARL', 'MARLIN', 'HERON', 'SERPENT', 'COMET', 'PETREL', 'ALBATROSS'];

export const randomShipName = (): string =>
    `${NAME_A[Math.floor(Math.random() * NAME_A.length)]} ${NAME_B[Math.floor(Math.random() * NAME_B.length)]}`;

const newId = (cls: ShipClassId) => `${cls}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export const createShip = (cls: ShipClassId, status: ShipStatus = 'stored'): OwnedShip => ({
    id: newId(cls),
    cls,
    name: randomShipName(),
    hp: SHIP_CLASSES[cls].stats.maxHp,
    status,
    upgrades: emptyUpgrades(),
    cargo: [],
    protectedCargo: []
});

export const newProfile = (captain: string): Profile => ({
    version: 2,
    captain,
    gold: STARTING_GOLD,
    xp: 0,
    ships: [],
    activeId: null,
    discoveredIslands: [],
    discoveredRegions: [],
    missions: [],
    missionSeq: 1,
    boardEpoch: [0, 0, 0, 0, 0],
    formation: 'wedge',
    stats: { kills: 0, missions: 0, treasure: 0 },
    used: {}
});

/** Bring any older or partial save up to the current shape. */
const migrate = (raw: Record<string, unknown>): Profile | null => {
    if (!raw || !Array.isArray(raw.ships) || typeof raw.gold !== 'number') return null;
    const p = { ...newProfile(String(raw.captain ?? 'CAPTAIN')), ...raw, version: 2 } as Profile;
    p.gold = Math.max(0, Math.floor(p.gold));
    p.xp = Math.max(0, Math.floor(p.xp ?? 0));
    p.discoveredIslands ??= [];
    p.discoveredRegions ??= [];
    p.missions ??= [];
    p.missionSeq ??= 1;
    p.boardEpoch ??= [0, 0, 0, 0, 0];
    p.formation ??= 'wedge';
    p.stats ??= { kills: 0, missions: 0, treasure: 0 };
    p.used ??= {};
    for (const s of p.ships) {
        if ((s.status as string) === 'docked') s.status = 'stored';
        if (!SHIP_CLASSES[s.cls]) s.cls = 'sloop';
        if (!s.name || s.name === SHIP_CLASSES[s.cls].name) s.name = randomShipName();
        s.upgrades = { ...emptyUpgrades(), ...s.upgrades };
        s.cargo ??= [];
        s.protectedCargo ??= [];
        const max = computeStats(s.cls, s.upgrades).maxHp;
        s.hp = Math.max(0, Math.min(max, s.hp));
    }
    return p;
};

export const loadProfile = (): Profile | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? migrate(JSON.parse(raw)) : null;
    } catch {
        return null;
    }
};

export const saveProfile = (p: Profile): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
        // Storage unavailable (private mode / blocked): play continues unsaved.
    }
};

export const clearProfile = (): void => {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* ignore */
    }
};

/** Make `ship` the flagship; the previous flagship is stored at port. */
export const setActiveShip = (p: Profile, ship: OwnedShip): void => {
    for (const s of p.ships) if (s.status === 'active') s.status = 'stored';
    if (ship.status !== 'sunk' && ship.status !== 'repair') ship.status = 'active';
    p.activeId = ship.id;
};
