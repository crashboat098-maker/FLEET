import { createRng } from '../gfx/pixelCanvas';
import type { PersonKind } from '../gfx/worldTextures';
import { Island } from './Island';
import { REGIONS, RegionId, regionAt } from './regions';
import { WorldData } from './WorldGenerator';

/**
 * Deterministic placement of everything that brings the ocean to life:
 * shipwrecks, mermaid haunts, island communities (peaceful and hostile)
 * and shore treasure. Pure data, generated once per page load.
 */

export type WreckKind = 'small' | 'merchant' | 'galleon' | 'pirate';
export type ChestRarity = 'common' | 'rare' | 'legendary';

export interface WreckSpot {
    id: number;
    x: number;
    y: number;
    rot: number;
    kind: WreckKind;
    region: RegionId;
}

export interface MermaidSpot {
    id: number;
    x: number;
    y: number;
    region: RegionId;
}

export interface Community {
    island: Island;
    name: string;
    hostile: boolean;
    people: PersonKind[];
    /** Archer posts (world coords) on hostile shores. */
    archers: { x: number; y: number }[];
}

export interface ShoreChest {
    id: string;
    island: Island;
    x: number;
    y: number;
    rarity: ChestRarity;
    hidden: boolean;
}

export interface WorldFeatures {
    wrecks: WreckSpot[];
    mermaids: MermaidSpot[];
    communities: Community[];
    chests: ShoreChest[];
}

const VILLAGES = ['Shellbay Folk', 'Palmroot Village', 'Netmenders', 'Driftcombers', 'Sunreef Clan', 'Gullfeather Tribe', 'Saltwind Hamlet', 'Conch Callers'];

/** A point on an island at a given edge depth (negative = inland), facing a random direction. */
const shorePoint = (isl: Island, rng: () => number, depth: [number, number]) => {
    for (let i = 0; i < 60; i++) {
        const a = rng() * Math.PI * 2;
        const c = isl.coastPoint(a);
        const d = depth[0] + rng() * (depth[1] - depth[0]);
        const x = c.x - Math.cos(a) * d;
        const y = c.y - Math.sin(a) * d;
        const e = isl.edge(x, y);
        if (e < -2 && e > -d - 12) return { x, y };
    }
    return null;
};

export const generateFeatures = (world: WorldData): WorldFeatures => {
    const rng = createRng(7331);
    const isPort = (isl: Island) => world.ports.some((p) => p.island === isl);
    const openWater = (x: number, y: number, pad: number) => world.islands.every((isl) => !isl.near(x, y, pad) || isl.edge(x, y) > pad);
    const awayFromPorts = (x: number, y: number) => world.ports.every((p) => Math.hypot(p.dockEnd.x - x, p.dockEnd.y - y) > 500);

    // --- Shipwrecks: near reefs, beside islands (partly submerged), on trade routes.
    const wrecks: WreckSpot[] = [];
    const addWreck = (x: number, y: number) => {
        if (wrecks.length >= 40 || !openWater(x, y, 30) || !awayFromPorts(x, y) || wrecks.some((w) => Math.hypot(w.x - x, w.y - y) < 450)) return;
        const region = regionAt(x, y);
        const danger = REGIONS[region].danger;
        const roll = rng();
        const kind: WreckKind =
            danger >= 4 && roll < 0.3 ? 'pirate' : danger >= 3 && roll < 0.55 ? 'galleon' : roll < 0.5 ? 'small' : roll < 0.85 ? 'merchant' : danger >= 2 ? 'galleon' : 'merchant';
        wrecks.push({ id: wrecks.length, x: Math.round(x), y: Math.round(y), rot: rng() * Math.PI * 2, kind, region });
    };
    for (const reef of world.reefs) {
        if (rng() < 0.18) {
            const a = rng() * Math.PI * 2;
            addWreck(reef.x + Math.cos(a) * 70, reef.y + Math.sin(a) * 50);
        }
    }
    for (const isl of world.islands) {
        if (isPort(isl) || rng() > 0.3) continue;
        const a = rng() * Math.PI * 2;
        const c = isl.coastPoint(a);
        addWreck(c.x + Math.cos(a) * 55, c.y + Math.sin(a) * 55);
    }
    // Trade routes between ports.
    for (let i = 0; i < 40 && wrecks.length < 38; i++) {
        const a = world.ports[Math.floor(rng() * world.ports.length)];
        const b = world.ports[Math.floor(rng() * world.ports.length)];
        if (a === b) continue;
        const t = 0.2 + rng() * 0.6;
        addWreck(a.dockEnd.x + (b.dockEnd.x - a.dockEnd.x) * t + (rng() - 0.5) * 500, a.dockEnd.y + (b.dockEnd.y - a.dockEnd.y) * t + (rng() - 0.5) * 500);
    }

    // --- Mermaids: by reefs and lonely islands in wilder waters.
    const mermaids: MermaidSpot[] = [];
    const lonely = world.islands.filter((isl) => !isPort(isl) && isl.size !== 'huge' && REGIONS[regionAt(isl.x, isl.y)].danger >= 2);
    for (const isl of lonely) {
        if (mermaids.length >= 6 || rng() > 0.5) continue;
        const a = rng() * Math.PI * 2;
        const c = isl.coastPoint(a);
        const x = c.x + Math.cos(a) * 36;
        const y = c.y + Math.sin(a) * 36;
        mermaids.push({ id: mermaids.length, x, y, region: regionAt(x, y) });
    }
    for (const reef of world.reefs) {
        if (mermaids.length >= 10 || rng() > 0.15 || REGIONS[regionAt(reef.x, reef.y)].danger < 2) continue;
        mermaids.push({ id: mermaids.length, x: reef.x, y: reef.y, region: regionAt(reef.x, reef.y) });
    }

    // --- Island communities.
    const communities: Community[] = [];
    let villageName = 0;
    for (const isl of world.islands) {
        const region = regionAt(isl.x, isl.y);
        const danger = REGIONS[region].danger;
        const port = world.ports.find((p) => p.island === isl);
        let hostile = false;
        let people: PersonKind[] = [];
        if (port) {
            people = ['villager', 'villager', 'fisher', 'merchant', 'merchant'];
            if (port.tier === 3) people.push('guard', 'guard', 'guard');
            if (port.tier === 5) people = ['pirate', 'pirate', 'pirate', 'merchant', 'villager', 'pirate'];
        } else if (isl.kind === 'skull' || (danger >= 3 && isl.size !== 'tiny' && rng() < 0.25) || (danger === 2 && isl.kind === 'jungle' && rng() < 0.5)) {
            hostile = true;
            people = isl.kind === 'jungle' ? ['tribe', 'tribe', 'tribe'] : ['pirate', 'pirate', 'pirate'];
        } else if (isl.size !== 'tiny' && rng() < (isl.kind === 'jungle' ? 0.6 : 0.4)) {
            people = isl.kind === 'jungle' ? ['tribe', 'tribe', 'fisher'] : ['villager', 'fisher', 'villager', 'fisher'];
        }
        if (!people.length) continue;
        const archers: { x: number; y: number }[] = [];
        if (hostile) {
            const n = isl.kind === 'skull' ? 5 : isl.size === 'large' || isl.size === 'huge' ? 4 : 2;
            for (let i = 0; i < n * 4 && archers.length < n; i++) {
                const p = shorePoint(isl, rng, [6, 16]);
                if (p && archers.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 120)) archers.push(p);
            }
        }
        const name = port ? `${port.name} Folk` : hostile ? (isl.kind === 'jungle' ? 'Thornspear Tribe' : 'Pirate Camp') : VILLAGES[villageName++ % VILLAGES.length];
        communities.push({ island: isl, name, hostile, people, archers });
    }

    // --- Shore treasure: easy finds on beaches, hidden ones further inland.
    const chests: ShoreChest[] = [];
    for (const isl of world.islands) {
        if (isPort(isl)) continue;
        const danger = REGIONS[regionAt(isl.x, isl.y)].danger;
        const count = isl.size === 'tiny' ? (rng() < 0.3 ? 1 : 0) : isl.size === 'small' ? 1 : 2;
        for (let i = 0; i < count; i++) {
            const hidden = rng() < 0.4;
            const p = shorePoint(isl, rng, hidden ? [20, 34] : [6, 14]);
            if (!p) continue;
            const roll = rng() + danger * 0.08 + (hidden ? 0.15 : 0);
            const rarity: ChestRarity = roll > 1.25 ? 'legendary' : roll > 0.8 ? 'rare' : 'common';
            chests.push({ id: `chest:${isl.id}:${i}`, island: isl, x: Math.round(p.x), y: Math.round(p.y), rarity, hidden });
        }
    }

    return { wrecks, mermaids, communities, chests };
};
