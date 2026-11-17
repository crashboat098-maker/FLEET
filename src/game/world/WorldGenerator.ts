import { createRng } from '../gfx/pixelCanvas';
import { Blob, Harmonic, Island, IslandKind, IslandSize } from './Island';
import { WORLD_SIZE, WORLD_SEED } from './worldConfig';

/**
 * Deterministic world layout: islands of five kinds, five ports, deep-water
 * patches and reefs. Pure data — no Phaser objects — so it is easy to test,
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

export type Cardinal = 'N' | 'E' | 'S' | 'W';

/** Unit vectors (screen space, +y = south) for each dock direction. */
export const CARDINAL_VEC: Record<Cardinal, { x: number; y: number }> = {
    N: { x: 0, y: -1 },
    E: { x: 1, y: 0 },
    S: { x: 0, y: 1 },
    W: { x: -1, y: 0 }
};

export interface PortLayout {
    index: number;
    name: string;
    island: Island;
    /** Direction the dock points out to sea. */
    dir: Cardinal;
    /** Where the dock meets the beach. */
    dockBase: { x: number; y: number };
    /** Seaward end of the dock (centre of the docking radius). */
    dockEnd: { x: number; y: number };
    dockWidth: number;
    /** Solid collider for the dock. */
    dockRect: Rect;
    buildings: { x: number; y: number; variant: number }[];
    props: { x: number; y: number; kind: 'barrel' | 'crate' }[];
    lighthouse: { x: number; y: number } | null;
    buoys: { x: number; y: number; color: 'red' | 'green' }[];
    /** Tier 1..5 and its extra buildings. */
    tier: number;
    extras: { x: number; y: number; kind: PortExtraKind }[];
    /** Where the town name is shown. */
    label: { x: number; y: number };
    /** Player spawn just off the dock. */
    spawn: { x: number; y: number; heading: number };
}

export interface WorldData {
    size: number;
    islands: Island[];
    ports: PortLayout[];
    deepPatches: Circle[];
    reefs: { x: number; y: number; variant: number }[];
}

export type PortExtraKind = 'tower' | 'awning' | 'warehouse' | 'skullflag' | 'torch' | 'cannon';

interface PortSpec {
    name: string;
    dir: Cardinal;
    roofs: number[];
    lighthouse: boolean;
    /** Port tier 1..5 — drives architecture and services. */
    tier: number;
}

/** Five harbours, each with its own name, orientation and look. */
const PORTS: (PortSpec & { anchor: [number, number]; r: number })[] = [
    // Tier 1 settlement: a few thatched huts.
    { name: 'Driftwood Cove', dir: 'S', roofs: [0, 0, 0], lighthouse: true, tier: 1, anchor: [6000, 5900], r: 240 },
    // Tier 2 trading port: colourful roofs and market stalls.
    { name: 'Saltmarrow Harbor', dir: 'E', roofs: [1, 2, 1, 0], lighthouse: false, tier: 2, anchor: [2500, 2300], r: 210 },
    // Tier 5 pirate stronghold: charred roofs, skull banners, torches, guns.
    { name: 'Gullwing Landing', dir: 'W', roofs: [4, 4, 4, 4, 4], lighthouse: false, tier: 5, anchor: [9700, 2500], r: 220 },
    // Tier 4 trading city: many buildings, warehouses, a wide dock.
    { name: 'Coralreach', dir: 'N', roofs: [1, 2, 1, 2, 0, 1], lighthouse: true, tier: 4, anchor: [2400, 9800], r: 220 },
    // Tier 3 naval harbor: slate roofs, stone towers, dockside cannons.
    { name: 'Lanternfall Wharf', dir: 'S', roofs: [3, 3, 3, 1], lighthouse: true, tier: 3, anchor: [9700, 9500], r: 200 }
];

interface IslandSpec {
    kind: IslandKind;
    r: number;
    extras: number;
    roughness: number;
    anchor?: [number, number];
    name?: string;
    port?: PortSpec;
}

const PREFIXES = [
    'Gull', 'Salt', 'Coral', 'Palm', 'Brine', 'Sun', 'Tide', 'Cutlass', 'Pelican', 'Starfish', 'Rum', 'Seaglass',
    'Kettle', 'Barnacle', 'Driftbone', 'Hook', 'Parrot', 'Shell', 'Mango', 'Squall', 'Anchor', 'Bilge', 'Compass',
    'Doubloon', 'Gale', 'Mist', 'Coconut', 'Turtle', 'Kelp', 'Gannet', 'Plank', 'Tern', 'Hermit', 'Pearl', 'Scurvy',
    'Lagoon', 'Foam', 'Cannon', 'Sextant', 'Marlin', 'Bosun', 'Jolly', 'Mutiny', 'Spyglass', 'Grog', 'Whelk', 'Crab',
    'Ballast', 'Wreck', 'Dagger', 'Tallow', 'Oyster', 'Saber', 'Rigging', 'Lookout', 'Bramble', 'Cormorant'
];
const SUFFIX: Record<IslandSize, string[]> = {
    tiny: ['Rock', 'Spit', 'Cay', 'Shoal'],
    small: ['Key', 'Cay', 'Islet', 'Rock'],
    medium: ['Isle', 'Key', 'Atoll', 'Island'],
    large: ['Isle', 'Island', 'Atoll', 'Hollow'],
    huge: ['Island', 'Reach', 'Wilds']
};

const sizeFor = (r: number): IslandSize =>
    r < 55 ? 'tiny' : r < 130 ? 'small' : r < 240 ? 'medium' : r < 500 ? 'large' : 'huge';

const makeHarmonics = (rng: () => number, roughness = 1): Harmonic[] => {
    const spec: [number, number, number][] = [
        [2, 0.05, 0.15],
        [3, 0.04, 0.1],
        [4, 0.02, 0.06],
        [5, 0.015, 0.04],
        [7, 0.01, 0.03],
        [11, 0.005, 0.015],
        [17, 0.002, 0.008]
    ];
    return spec.map(([k, lo, hi]) => ({
        k,
        // Rough kinds get disproportionately more high-frequency detail (jagged coasts).
        amp: (lo + rng() * (hi - lo)) * (k > 6 ? roughness * roughness : roughness),
        phase: rng() * Math.PI * 2
    }));
};

const buildIsland = (
    id: number,
    name: string,
    x: number,
    y: number,
    spec: IslandSpec,
    rng: () => number,
    /** Restrict extra lobes to this angular range (keeps a port's harbour side clean). */
    lobeArc: [number, number] = [0, Math.PI * 2]
): Island => {
    const { r } = spec;
    const blobs = [new Blob(x, y, r, makeHarmonics(rng, spec.roughness))];
    const big = spec.kind === 'jungle';
    for (let i = 0; i < spec.extras; i++) {
        const a = lobeArc[0] + rng() * (lobeArc[1] - lobeArc[0]);
        const dist = r * (big ? 0.55 + rng() * 0.35 : 0.45 + rng() * 0.3);
        const br = r * (big ? 0.45 + rng() * 0.25 : 0.4 + rng() * 0.25);
        blobs.push(new Blob(x + Math.cos(a) * dist, y + Math.sin(a) * dist, br, makeHarmonics(rng, spec.roughness * 1.15)));
    }
    return new Island(id, name, x, y, sizeFor(r), blobs, Math.floor(rng() * 1e9), spec.kind);
};

const dirAngle = (d: Cardinal) => Math.atan2(CARDINAL_VEC[d].y, CARDINAL_VEC[d].x);

const buildPort = (index: number, island: Island, spec: PortSpec): PortLayout => {
    const f = CARDINAL_VEC[spec.dir]; // seaward
    const l = { x: -f.y, y: f.x }; // lateral (right-hand when facing seaward)
    const coast = island.coastPoint(dirAngle(spec.dir));
    const dockWidth = spec.tier >= 4 ? 34 : 26;
    const dockLen = 150;
    const dockBase = { x: Math.round(coast.x - f.x * 16), y: Math.round(coast.y - f.y * 16) };
    const reach = 16 + dockLen;
    const dockEnd = { x: dockBase.x + f.x * reach, y: dockBase.y + f.y * reach };
    const at = (lat: number, inland: number) => ({
        x: dockBase.x + l.x * lat - f.x * inland,
        y: dockBase.y + l.y * lat - f.y * inland
    });
    const onLand = (p: { x: number; y: number }, pad: number) => island.edge(p.x, p.y) < -pad;

    const slots: [number, number][] = [
        [-78, 52],
        [62, 60],
        [-20, 118],
        [120, 120],
        [-130, 110],
        [40, 170]
    ];
    const buildings: PortLayout['buildings'] = [];
    for (const [lat, inland] of slots) {
        if (buildings.length >= spec.roofs.length) break;
        const p = at(lat, inland);
        if (onLand(p, 34)) buildings.push({ ...p, variant: spec.roofs[buildings.length] });
    }

    const prop = (lat: number, inland: number, kind: 'barrel' | 'crate') => ({ ...at(lat, inland), kind });
    const props = [
        prop(-26, 12, 'barrel'),
        prop(-36, 4, 'barrel'),
        prop(26, 14, 'crate'),
        prop(38, 8, 'crate'),
        prop(30, 26, 'barrel'),
        prop(6, -(reach - 22), 'crate'),
        prop(-6, -(reach - 40), 'barrel')
    ];

    let lighthouse: PortLayout['lighthouse'] = null;
    if (spec.lighthouse) {
        const lhCoast = island.coastPoint(dirAngle(spec.dir) + 0.42);
        const toCentre = Math.atan2(island.y - lhCoast.y, island.x - lhCoast.x);
        lighthouse = { x: lhCoast.x + Math.cos(toCentre) * 26, y: lhCoast.y + Math.sin(toCentre) * 26 };
    }

    // Tier architecture: market stalls, warehouses, stone towers, guns, banners and torches.
    const extras: PortLayout['extras'] = [];
    const extra = (kind: PortExtraKind, lat: number, inland: number, pad = 12) => {
        const p = at(lat, inland);
        if (inland < 0 || onLand(p, pad)) extras.push({ ...p, kind });
    };
    const t = spec.tier;
    if (t === 2 || t === 4) [-46, 46, 0].forEach((lat, i) => extra('awning', lat, 32 + i * 10));
    if (t === 4) [-150, 150, -100, 100].forEach((lat) => extra('warehouse', lat, 60, 22));
    if (t === 3 || t === 5) [-58, 58].forEach((lat) => extra('tower', lat, 12, 10));
    if (t === 3 || t === 5) [-1, 1].forEach((s) => extra('cannon', s * 8, -(reach - 10)));
    if (t === 5) {
        [-26, 26].forEach((lat) => extra('skullflag', lat, 2, 2));
        [1, 2, 3].forEach((k) => [-1, 1].forEach((s) => extra('torch', s * (dockWidth / 2 + 3), -k * 42)));
    }

    const buoyAt = (lat: number) => ({ x: dockEnd.x + f.x * 18 + l.x * lat, y: dockEnd.y + f.y * 18 + l.y * lat });
    const spawnPos = { x: dockEnd.x - f.x * 36 + l.x * 64, y: dockEnd.y - f.y * 36 + l.y * 64 };

    const minX = Math.min(dockBase.x, dockEnd.x) - (f.x === 0 ? dockWidth / 2 : 0);
    const maxX = Math.max(dockBase.x, dockEnd.x) + (f.x === 0 ? dockWidth / 2 : 0);
    const minY = Math.min(dockBase.y, dockEnd.y) - (f.y === 0 ? dockWidth / 2 : 0);
    const maxY = Math.max(dockBase.y, dockEnd.y) + (f.y === 0 ? dockWidth / 2 : 0);

    return {
        index,
        name: spec.name,
        island,
        dir: spec.dir,
        dockBase,
        dockEnd,
        dockWidth,
        dockRect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        buildings,
        props,
        lighthouse,
        buoys: [
            { ...buoyAt(-44), color: 'red' },
            { ...buoyAt(44), color: 'green' }
        ],
        extras,
        tier: spec.tier,
        label: at(0, 92),
        // Heading points the bow out to sea (0 = north, clockwise).
        spawn: { ...spawnPos, heading: Math.atan2(f.x, -f.y) }
    };
};

export const generateWorld = (seed = WORLD_SEED): WorldData => {
    const rng = createRng(seed);
    const size = WORLD_SIZE;
    const islands: Island[] = [];
    const ports: PortLayout[] = [];
    const usedPrefixes = new Set<string>();

    const nameFor = (r: number): string => {
        let p = PREFIXES[Math.floor(rng() * PREFIXES.length)];
        for (let i = 0; i < 20 && usedPrefixes.has(p); i++) p = PREFIXES[Math.floor(rng() * PREFIXES.length)];
        usedPrefixes.add(p);
        const s = SUFFIX[sizeFor(r)];
        return `${p} ${s[Math.floor(rng() * s.length)]}`;
    };

    // Anchored set pieces first, then random fill. Order matters: bigger first.
    const specs: IslandSpec[] = [
        ...PORTS.map((p) => ({ kind: 'tropical' as const, r: p.r, extras: 3, roughness: 1, anchor: p.anchor, name: p.name, port: p })),
        { kind: 'jungle', r: 860, extras: 4, roughness: 1.3, anchor: [6200, 9900], name: 'The Verdant Tangle' },
        { kind: 'jungle', r: 700, extras: 4, roughness: 1.3, anchor: [3700, 5600], name: 'Mossbeard Wilds' },
        { kind: 'volcanic', r: 330, extras: 1, roughness: 1.4, anchor: [6100, 1900], name: 'Mount Cinderjaw' },
        { kind: 'volcanic', r: 250, extras: 1, roughness: 1.4, anchor: [10300, 6900], name: 'Emberhook Isle' },
        { kind: 'skull', r: 360, extras: 2, roughness: 1.5, anchor: [8600, 4300], name: 'Skullmaw Isle' }
    ];
    for (let i = 0; i < 14; i++) specs.push({ kind: 'tropical', r: 120 + rng() * 200, extras: 1 + Math.floor(rng() * 3), roughness: 1 });
    for (let i = 0; i < 18; i++) specs.push({ kind: 'basic', r: 60 + rng() * 110, extras: Math.floor(rng() * 3), roughness: 1.1 });
    for (let i = 0; i < 14; i++) specs.push({ kind: 'basic', r: 24 + rng() * 24, extras: 0, roughness: 0.6 });

    const GAP = 260;
    const PORT_GAP = 520; // keep harbour approaches wide open
    const fits = (c: Island, isPort: boolean) => {
        const m = c.boundRadius + 160;
        if (c.x < m || c.y < m || c.x > size - m || c.y > size - m) return false;
        return islands.every((o) => {
            const gap = isPort || ports.some((p) => p.island === o) ? PORT_GAP : GAP;
            return Math.hypot(o.x - c.x, o.y - c.y) > o.boundRadius + c.boundRadius + gap;
        });
    };

    let id = 0;
    for (const spec of specs) {
        const lobeArc: [number, number] | undefined = spec.port
            ? [dirAngle(spec.port.dir) + Math.PI * 0.55, dirAngle(spec.port.dir) + Math.PI * 1.45]
            : undefined;
        for (let attempt = 0; attempt < 500; attempt++) {
            let x: number;
            let y: number;
            if (spec.anchor && attempt < 300) {
                const jitter = 80 + attempt * 4;
                x = spec.anchor[0] + (rng() - 0.5) * 2 * jitter;
                y = spec.anchor[1] + (rng() - 0.5) * 2 * jitter;
            } else {
                x = rng() * size;
                y = rng() * size;
            }
            const candidate = buildIsland(id, spec.name ?? nameFor(spec.r), x, y, spec, rng, lobeArc);
            if (!fits(candidate, !!spec.port)) continue;
            islands.push(candidate);
            if (spec.port) ports.push(buildPort(ports.length, candidate, spec.port));
            id++;
            break;
        }
    }

    const farFromIslands = (x: number, y: number, pad: number) => islands.every((i) => !i.near(x, y, pad));

    const deepPatches: Circle[] = [];
    for (let i = 0; i < 1500 && deepPatches.length < 80; i++) {
        const r = 260 + rng() * 480;
        const x = rng() * size;
        const y = rng() * size;
        if (farFromIslands(x, y, r * 0.6 + 140)) deepPatches.push({ x, y, r });
    }

    const reefs: WorldData['reefs'] = [];
    for (let i = 0; i < 4000 && reefs.length < 120; i++) {
        const x = 150 + rng() * (size - 300);
        const y = 150 + rng() * (size - 300);
        const nearPort = ports.some((p) => Math.hypot(p.dockEnd.x - x, p.dockEnd.y - y) < 400);
        if (!nearPort && farFromIslands(x, y, 140) && reefs.every((r) => Math.hypot(r.x - x, r.y - y) > 260)) {
            reefs.push({ x, y, variant: Math.floor(rng() * 3) });
        }
    }

    return { size, islands, ports, deepPatches, reefs };
};
