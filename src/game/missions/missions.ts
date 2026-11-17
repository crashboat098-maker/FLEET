import { createRng } from '../gfx/pixelCanvas';
import type { ItemType } from '../state/items';
import { REGIONS, RegionId, regionAt } from '../world/regions';
import { tierOf } from '../world/portTiers';
import type { WorldFeatures } from '../world/worldFeatures';
import type { WorldData } from '../world/WorldGenerator';

/**
 * Port missions: pure data + logic (no Phaser), so they can be saved and
 * later run server-side. Boards are generated deterministically per port and
 * "epoch"; accepted missions live in the profile until completed.
 */

export type MissionKind =
    | 'deliver'
    | 'hunt'
    | 'explore'
    | 'recover'
    | 'escort'
    | 'creature'
    | 'rescue'
    | 'missing'
    | 'bounty'
    | 'lost'
    | 'protect'
    | 'wreck'
    | 'siren';
export type CreatureKind = 'shark' | 'serpent' | 'kraken';

export interface ActiveMission {
    id: number;
    kind: MissionKind;
    title: string;
    detail: string;
    issuer: number;
    targetPort?: number;
    targetIsland?: number;
    targetRegion?: RegionId;
    targetPos?: { x: number; y: number };
    targetWreck?: number;
    targetName?: string;
    creature?: CreatureKind;
    count: number;
    progress: number;
    reward: { gold: number; xp: number; items?: ItemType[] };
    minLevel: number;
    /** Escort ship launched / treasure placed for this mission. */
    started?: boolean;
}

export type MissionEvent =
    | { type: 'kill'; role: string; region: RegionId }
    | { type: 'discoverIsland'; id: number }
    | { type: 'discoverRegion'; id: RegionId }
    | { type: 'pickup'; missionId: number }
    | { type: 'escortArrived'; missionId: number }
    | { type: 'objective'; missionId: number }
    | { type: 'salvaged'; wreckId: number };

const up = (s: string) => s.toUpperCase();
const CAPTAINS = ['RED REGINALD', 'MAD MOLLY', 'IRONBEARD', 'SALTFANG', 'GALLOWS GREER', 'BLACKWATER BESS', 'CAPTAIN CINDER', 'ONE-EYED SILAS'];
const CITIZENS = ['A FISHERMAN', "THE MAYOR'S SON", 'A YOUNG SAILMAKER', 'THE OLD CARTOGRAPHER', 'A VILLAGE HEALER'];

const pointInRegion = (world: WorldData, rng: () => number, region: RegionId) => {
    for (let i = 0; i < 400; i++) {
        const x = 400 + rng() * (world.size - 800);
        const y = 400 + rng() * (world.size - 800);
        if (regionAt(x, y) !== region || world.islands.some((isl) => isl.near(x, y, 220))) continue;
        return { x: Math.round(x), y: Math.round(y) };
    }
    return { x: world.size / 2, y: world.size / 2 + 900 };
};

/** Materials a reward includes, scaled by difficulty (1..5). */
const mats = (rng: () => number, difficulty: number): ItemType[] => {
    const pool: ItemType[] = difficulty >= 4 ? ['iron', 'iron', 'cloth', 'wood'] : difficulty >= 2 ? ['wood', 'iron', 'cloth'] : ['wood', 'cloth'];
    return Array.from({ length: Math.min(4, 1 + Math.floor(difficulty / 2)) }, () => pool[Math.floor(rng() * pool.length)]);
};

/** Three offers for a port's board. Same port + epoch = same offers. */
export const generateOffers = (
    world: WorldData,
    features: WorldFeatures,
    portIndex: number,
    epoch: number,
    discoveredIslands: number[],
    nextId: number,
    usedIds: Record<string, number> = {}
): ActiveMission[] => {
    const tier = tierOf(portIndex);
    const rng = createRng(portIndex * 7919 + epoch * 104729 + 17);
    const port = world.ports[portIndex];
    const offers: ActiveMission[] = [];
    const R = tier.rewardMult;
    const otherPorts = world.ports.filter((p) => p.index !== portIndex);
    const pick = <T>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
    const regionsFor = (): RegionId[] =>
        tier.tier >= 5 ? ['skull', 'deep'] : tier.tier >= 4 ? ['skull', 'volcanic', 'jungle'] : tier.tier >= 3 ? ['jungle', 'volcanic'] : ['tropical', 'jungle'];

    for (let i = 0; i < 3; i++) {
        const kind = tier.missionKinds[(i + epoch) % tier.missionKinds.length];
        const base = { id: nextId + i, kind, issuer: portIndex, progress: 0, minLevel: 1, count: 1 };
        switch (kind) {
            case 'deliver': {
                const to = pick(otherPorts);
                const dist = Math.hypot(to.dockEnd.x - port.dockEnd.x, to.dockEnd.y - port.dockEnd.y);
                const count = 1 + Math.floor(rng() * 2);
                offers.push({
                    ...base,
                    title: `DELIVER ${count} PARCEL${count > 1 ? 'S' : ''} TO ${up(to.name)}`,
                    detail: 'SEALED CARGO - TAKES HOLD SPACE, CANNOT BE SOLD',
                    targetPort: to.index,
                    count,
                    reward: { gold: Math.round((40 + dist / 55) * count * R), xp: Math.round(30 + dist / 140), items: mats(rng, 1) }
                });
                break;
            }
            case 'hunt': {
                const region = pick(regionsFor());
                const count = 2 + Math.floor(rng() * 2);
                const d = REGIONS[region].danger;
                offers.push({
                    ...base,
                    title: `SINK ${count} PIRATES IN ${REGIONS[region].name}`,
                    detail: 'PIRATE BOUNTY - CAPTAINS COUNT TOO',
                    targetRegion: region,
                    count,
                    minLevel: d >= 4 ? 4 : 1,
                    reward: { gold: Math.round(55 * count * d * (R / 1.5)), xp: 40 * count * d, items: mats(rng, d) }
                });
                break;
            }
            case 'explore': {
                const unknown = world.islands.filter((isl) => !discoveredIslands.includes(isl.id) && !world.ports.some((p) => p.island === isl));
                const isl = unknown.length ? pick(unknown) : pick(world.islands);
                offers.push({
                    ...base,
                    title: `CHART ${up(isl.name)}`,
                    detail: `SAIL CLOSE TO THE ISLAND (${REGIONS[regionAt(isl.x, isl.y)].name})`,
                    targetIsland: isl.id,
                    targetPos: { x: Math.round(isl.x), y: Math.round(isl.y) },
                    reward: { gold: Math.round(70 * R), xp: 60 }
                });
                break;
            }
            case 'recover': {
                const region = pick(regionsFor());
                const d = REGIONS[region].danger;
                offers.push({
                    ...base,
                    title: `RECOVER LOST CARGO (${REGIONS[region].name})`,
                    detail: 'A SUNKEN CHEST IS MARKED ON YOUR CHART',
                    targetRegion: region,
                    targetPos: pointInRegion(world, rng, region),
                    minLevel: d >= 5 ? 5 : 1,
                    reward: { gold: Math.round(90 * d * R * 0.7), xp: 50 * d, items: mats(rng, d) }
                });
                break;
            }
            case 'escort': {
                const to = pick(otherPorts);
                const dist = Math.hypot(to.dockEnd.x - port.dockEnd.x, to.dockEnd.y - port.dockEnd.y);
                offers.push({
                    ...base,
                    title: `ESCORT A MERCHANT TO ${up(to.name)}`,
                    detail: 'IT SAILS WHEN YOU LEAVE PORT - KEEP IT AFLOAT',
                    targetPort: to.index,
                    minLevel: 2,
                    reward: { gold: Math.round((80 + dist / 40) * R), xp: Math.round(60 + dist / 90), items: ['cloth', 'cloth'] }
                });
                break;
            }
            case 'creature': {
                const kraken = tier.tier >= 5;
                const serpent = !kraken && rng() < 0.45;
                const count = kraken || serpent ? 1 : 2 + Math.floor(rng() * 2);
                const creature: CreatureKind = kraken ? 'kraken' : serpent ? 'serpent' : 'shark';
                offers.push({
                    ...base,
                    title: kraken ? 'KRAKEN HUNT' : serpent ? 'SLAY A SEA SERPENT' : `HUNT ${count} SHARKS`,
                    detail: kraken
                        ? 'A KRAKEN IS SINKING SHIPS ON THE DEEP ROUTES. FIND IT AND END IT.'
                        : serpent
                          ? 'FOUND IN VOLCANIC SEAS AND THE DEEP - HARPOONS HELP'
                          : 'SHARKS ARE HARRYING THE FISHING BOATS',
                    creature,
                    targetRegion: kraken ? 'deep' : undefined,
                    count,
                    minLevel: kraken ? 8 : serpent ? 3 : 1,
                    reward: kraken
                        ? { gold: 1600, xp: 900, items: ['iron', 'iron', 'iron', 'cloth'] }
                        : serpent
                          ? { gold: Math.round(220 * R * 0.6), xp: 160, items: ['iron', 'iron'] }
                          : { gold: Math.round(35 * count * R), xp: 25 * count, items: ['wood'] }
                });
                break;
            }
            case 'rescue': {
                const region = pick(regionsFor());
                const who = pick(CITIZENS);
                const captain = pick(CAPTAINS);
                const d = REGIONS[region].danger;
                offers.push({
                    ...base,
                    title: `RESCUE ${who}`,
                    detail: `HELD ABOARD ${captain}'S SHIP (${REGIONS[region].name}). SINK IT, PULL THEM FROM THE WATER, BRING THEM HOME.`,
                    targetRegion: region,
                    targetPos: pointInRegion(world, rng, region),
                    targetName: `CAPT. ${captain}`,
                    count: 2,
                    minLevel: d >= 4 ? 5 : 2,
                    reward: { gold: Math.round(160 * d * R * 0.6), xp: 70 * d, items: mats(rng, d) }
                });
                break;
            }
            case 'missing': {
                const region = pick(regionsFor());
                const d = REGIONS[region].danger;
                offers.push({
                    ...base,
                    title: 'THE MISSING MERCHANT',
                    detail: `A TRADER VANISHED NEAR ITS LAST KNOWN POSITION (${REGIONS[region].name}). FIND THE WRECK AND SALVAGE IT.`,
                    targetRegion: region,
                    targetPos: pointInRegion(world, rng, region),
                    reward: { gold: Math.round(110 * d * R * 0.6), xp: 55 * d, items: mats(rng, d) }
                });
                break;
            }
            case 'bounty': {
                const region = pick(regionsFor());
                const captain = pick(CAPTAINS);
                const d = REGIONS[region].danger;
                offers.push({
                    ...base,
                    title: `BOUNTY: CAPT. ${captain}`,
                    detail: `${captain} IS TERRORISING ${REGIONS[region].name}. SINK THEIR SHIP.`,
                    targetRegion: region,
                    targetPos: pointInRegion(world, rng, region),
                    targetName: `CAPT. ${captain}`,
                    minLevel: d >= 4 ? 5 : 3,
                    reward: { gold: Math.round(200 * d * R * 0.6), xp: 90 * d, items: ['iron', 'iron', ...mats(rng, d)] }
                });
                break;
            }
            case 'lost': {
                const remote = world.islands.filter((isl) => !world.ports.some((p) => p.island === isl) && isl.size !== 'tiny');
                const isl = remote.length ? pick(remote) : pick(world.islands);
                const a = rng() * Math.PI * 2;
                const c = isl.coastPoint(a);
                const pos = { x: Math.round(c.x - Math.cos(a) * 18), y: Math.round(c.y - Math.sin(a) * 18) };
                const dirs = ['NORTH', 'EAST', 'SOUTH', 'WEST'];
                const side = dirs[Math.round(((Math.atan2(Math.sin(a), Math.cos(a)) + Math.PI * 2.5) / (Math.PI / 2)) % 4) % 4];
                const d = REGIONS[regionAt(isl.x, isl.y)].danger;
                offers.push({
                    ...base,
                    title: `LOST TREASURE OF ${up(isl.name)}`,
                    detail: `AN OLD MAP SAYS: BURIED ON THE ${side} SHORE OF ${up(isl.name)}. SAIL CLOSE AND OPEN IT.`,
                    targetIsland: isl.id,
                    targetPos: pos,
                    reward: { gold: Math.round(120 * d * R * 0.5), xp: 45 * d, items: ['chest', ...mats(rng, d)] }
                });
                break;
            }
            case 'protect': {
                const villages = features.communities.filter((c) => !c.hostile && !world.ports.some((p) => p.island === c.island));
                const v = villages.length ? pick(villages) : features.communities[0];
                const d = REGIONS[regionAt(v.island.x, v.island.y)].danger;
                offers.push({
                    ...base,
                    title: `PROTECT ${up(v.name)}`,
                    detail: `PIRATES ARE CLOSING ON ${up(v.island.name)}. GET THERE AND SINK ALL THREE RAIDERS.`,
                    targetIsland: v.island.id,
                    targetPos: { x: Math.round(v.island.x), y: Math.round(v.island.y) },
                    count: 3,
                    minLevel: 3,
                    reward: { gold: Math.round(150 * Math.max(2, d) * R * 0.6), xp: 70 * Math.max(2, d), items: mats(rng, d + 1) }
                });
                break;
            }
            case 'wreck': {
                const fresh = features.wrecks.filter((w) => !usedIds[`wreck:${w.id}`]);
                const w = fresh.length ? pick(fresh) : pick(features.wrecks);
                const d = REGIONS[w.region].danger;
                offers.push({
                    ...base,
                    title: `SHIPWRECK RECOVERY`,
                    detail: `A ${w.kind.toUpperCase()} WENT DOWN IN ${REGIONS[w.region].name}. SALVAGE ITS SUPPLIES.`,
                    targetWreck: w.id,
                    targetPos: { x: w.x, y: w.y },
                    reward: { gold: Math.round(80 * d * R * 0.6), xp: 40 * d, items: mats(rng, d) }
                });
                break;
            }
            case 'siren': {
                const m = pick(features.mermaids);
                offers.push({
                    ...base,
                    title: "THE SIREN'S WATERS",
                    detail: 'SHIPS KEEP VANISHING NEAR A REEF. INVESTIGATE - AND DO NOT FOLLOW THE SONG.',
                    targetPos: { x: Math.round(m.x), y: Math.round(m.y) },
                    targetRegion: m.region,
                    minLevel: 4,
                    reward: { gold: Math.round(350 * R * 0.5), xp: 220, items: ['cloth', 'cloth', 'iron'] }
                });
                break;
            }
        }
    }
    return offers;
};

/** Apply a gameplay event; returns true if the mission's progress changed. */
export const applyMissionEvent = (m: ActiveMission, e: MissionEvent): boolean => {
    if (m.progress >= m.count) return false;
    let hit = false;
    switch (e.type) {
        case 'kill':
            if (m.kind === 'hunt') hit = (e.role === 'pirate' || e.role === 'captain') && (!m.targetRegion || m.targetRegion === e.region);
            if (m.kind === 'creature') hit = e.role === m.creature;
            break;
        case 'discoverIsland':
            hit = m.kind === 'explore' && m.targetIsland === e.id;
            break;
        case 'pickup':
            hit = m.kind === 'recover' && m.id === e.missionId;
            break;
        case 'escortArrived':
            hit = m.kind === 'escort' && m.id === e.missionId;
            break;
        case 'objective':
            hit = m.id === e.missionId;
            break;
        case 'salvaged':
            hit = m.kind === 'wreck' && m.targetWreck === e.wreckId;
            break;
        default:
            break;
    }
    if (hit) m.progress++;
    return hit;
};

export const missionDone = (m: ActiveMission) => m.progress >= m.count;
export const MAX_ACTIVE_MISSIONS = 3;
