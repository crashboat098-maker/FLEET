import { createRng } from '../gfx/pixelCanvas';
import { Blob, Harmonic, Island, IslandSize } from './Island';
import { WORLD_SIZE, WORLD_SEED } from './worldConfig';

/**
 * Deterministic world layout: islands, deep-water patches, reefs and the
 * port location. Pure data — no Phaser objects — so it is easy to test,
 * reuse for the minimap, and later share with a multiplayer server.
 */

export interface Circle {
    x: number;
    y: number;
    r: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface PortLayout {
    name: string;
    island: Island;
    /** Where the dock meets the beach. */
    dockBase: { x: number; y: number };
    /** Seaward end of the dock (docking happens here). */
    dockEnd: { x: number; y: number };
    dockWidth: number;
    /** Solid collider for the dock. */
    dockRect: Rect;
    buildings: { x: number; y: number; variant: number }[];
    props: { x: number; y: number; kind: 'barrel' | 'crate' }[];
    lighthouse: { x: number; y: number };
    buoys: { x: number; y: number; color: 'red' | 'green' }[];
    /** Player spawn just off the dock. */
    spawn: { x: number; y: number; heading: number };
}

export interface WorldData {
    size: number;
    islands: Island[];
    deepPatches: Circle[];
    reefs: { x: number; y: number; variant: number }[];
    port: PortLayout;
}

const ISLAND_NAMES = [
    'Driftwood Cove',
    'Gullrest Key',
    'Saltbone Isle',
    'Coralmoth Atoll',
    'Lantern Rock',
    'Palmshade Key',
    'Brinehook Isle',
    'Sunspoke Atoll',
    'Tidewhistle Key',
    'Cutlass Spit',
    'Mangrove Hollow',
    'Pelican Crown',
    'Starfish Shoal',
    'Rumbarrel Isle',
    'Seaglass Key',
    'Kettle Reef'
];

const SIZE_PLAN: { size: IslandSize; min: number; max: number; extra: [number, number] }[] = [
    ...Array(3).fill({ size: 'large', min: 210, max: 280, extra: [2, 3] }),
    ...Array(6).fill({ size: 'medium', min: 125, max: 185, extra: [1, 2] }),
    ...Array(5).fill({ size: 'small', min: 60, max: 95, extra: [0, 1] })
];

const makeHarmonics = (rng: () => number, roughness = 1): Harmonic[] => {
    const spec: [number, number, number][] = [
        [2, 0.05, 0.15],
        [3, 0.04, 0.1],
        [4, 0.02, 0.06],
        [5, 0.015, 0.04],
        [7, 0.01, 0.03],
        [11, 0.005, 0.015]
    ];
    return spec.map(([k, lo, hi]) => ({ k, amp: (lo + rng() * (hi - lo)) * roughness, phase: rng() * Math.PI * 2 }));
};

const buildIsland = (
    id: number,
    x: number,
    y: number,
    size: IslandSize,
    r: number,
    extraCount: number,
    rng: () => number,
    /** Restrict extra lobes to this angular range (used to keep the port's harbour side clean). */
    lobeArc: [number, number] = [0, Math.PI * 2]
): Island => {
    const blobs = [new Blob(x, y, r, makeHarmonics(rng))];
    for (let i = 0; i < extraCount; i++) {
        const a = lobeArc[0] + rng() * (lobeArc[1] - lobeArc[0]);
        const dist = r * (0.45 + rng() * 0.3);
        const br = r * (0.4 + rng() * 0.25);
        blobs.push(new Blob(x + Math.cos(a) * dist, y + Math.sin(a) * dist, br, makeHarmonics(rng, 1.2)));
    }
    return new Island(id, ISLAND_NAMES[id % ISLAND_NAMES.length], x, y, size, blobs, Math.floor(rng() * 1e9));
};

const buildPort = (island: Island): PortLayout => {
    const down = Math.PI / 2; // screen-space "south"
    const coast = island.coastPoint(down);
    const dockWidth = 26;
    const dockLen = 150;
    const dockBase = { x: Math.round(coast.x), y: Math.round(coast.y - 16) };
    const dockEnd = { x: dockBase.x, y: dockBase.y + 16 + dockLen };

    const onLand = (x: number, y: number, pad: number) => island.edge(x, y) < -pad;

    const candidates = [
        { dx: -78, dy: -52, variant: 0 },
        { dx: 62, dy: -60, variant: 1 },
        { dx: -20, dy: -118, variant: 2 },
        { dx: 120, dy: -120, variant: 0 },
        { dx: -130, dy: -110, variant: 1 }
    ];
    const buildings = candidates
        .map((c) => ({ x: dockBase.x + c.dx, y: dockBase.y + c.dy, variant: c.variant }))
        .filter((b) => onLand(b.x, b.y, 34));

    const props: PortLayout['props'] = [
        { x: dockBase.x - 26, y: dockBase.y - 12, kind: 'barrel' },
        { x: dockBase.x - 36, y: dockBase.y - 4, kind: 'barrel' },
        { x: dockBase.x + 26, y: dockBase.y - 14, kind: 'crate' },
        { x: dockBase.x + 38, y: dockBase.y - 8, kind: 'crate' },
        { x: dockBase.x + 30, y: dockBase.y - 26, kind: 'barrel' },
        { x: dockBase.x + 6, y: dockEnd.y - 22, kind: 'crate' },
        { x: dockBase.x - 6, y: dockEnd.y - 40, kind: 'barrel' }
    ];

    // Lighthouse on the headland beside the harbour.
    const lhCoast = island.coastPoint(down + 0.42);
    const toCentre = Math.atan2(island.y - lhCoast.y, island.x - lhCoast.x);
    const lighthouse = { x: lhCoast.x + Math.cos(toCentre) * 26, y: lhCoast.y + Math.sin(toCentre) * 26 };

    return {
        name: island.name,
        island,
        dockBase,
        dockEnd,
        dockWidth,
        dockRect: { x: dockBase.x - dockWidth / 2, y: dockBase.y, w: dockWidth, h: dockEnd.y - dockBase.y },
        buildings,
        props,
        lighthouse,
        buoys: [
            { x: dockEnd.x - 44, y: dockEnd.y + 18, color: 'red' },
            { x: dockEnd.x + 44, y: dockEnd.y + 18, color: 'green' }
        ],
        spawn: { x: dockEnd.x + 64, y: dockEnd.y - 36, heading: Math.PI }
    };
};

export const generateWorld = (seed = WORLD_SEED): WorldData => {
    const rng = createRng(seed);
    const size = WORLD_SIZE;
    const islands: Island[] = [];

    // Home port: a large island near the middle; extra lobes only to the north
    // so the southern harbour stays open.
    const portIsland = buildIsland(0, size / 2, size / 2 - 120, 'large', 250, 3, rng, [Math.PI * 1.1, Math.PI * 1.9]);
    islands.push(portIsland);

    const GAP = 280; // open water between neighbouring islands
    let id = 1;
    for (const plan of SIZE_PLAN) {
        const r = plan.min + rng() * (plan.max - plan.min);
        const extras = plan.extra[0] + Math.floor(rng() * (plan.extra[1] - plan.extra[0] + 1));
        for (let attempt = 0; attempt < 400; attempt++) {
            const margin = r * 1.8 + 140;
            const x = margin + rng() * (size - margin * 2);
            const y = margin + rng() * (size - margin * 2);
            const candidate = buildIsland(id, x, y, plan.size, r, extras, rng);
            const clear = islands.every(
                (o) => Math.hypot(o.x - x, o.y - y) > o.boundRadius + candidate.boundRadius + GAP
            );
            if (clear) {
                islands.push(candidate);
                id++;
                break;
            }
        }
    }

    const farFromIslands = (x: number, y: number, pad: number) => islands.every((i) => !i.near(x, y, pad));

    const deepPatches: Circle[] = [];
    for (let i = 0; i < 400 && deepPatches.length < 22; i++) {
        const r = 260 + rng() * 420;
        const x = rng() * size;
        const y = rng() * size;
        if (farFromIslands(x, y, r * 0.6 + 120)) deepPatches.push({ x, y, r });
    }

    const reefs: WorldData['reefs'] = [];
    for (let i = 0; i < 600 && reefs.length < 34; i++) {
        const x = 150 + rng() * (size - 300);
        const y = 150 + rng() * (size - 300);
        if (farFromIslands(x, y, 140) && reefs.every((r) => Math.hypot(r.x - x, r.y - y) > 260)) {
            reefs.push({ x, y, variant: Math.floor(rng() * 3) });
        }
    }

    return { size, islands, deepPatches, reefs, port: buildPort(portIsland) };
};
