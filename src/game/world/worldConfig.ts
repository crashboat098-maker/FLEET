/** Tunables for the explorable ocean world. */
export const WORLD_SIZE = 6000;

/** Seed for deterministic world generation — same world every run. */
export const WORLD_SEED = 20261115;

/** Width (world units) of the turquoise shallow-water halo around coastlines. */
export const SHALLOW_HALO = 64;

/** Keep ships this far from the world edge. */
export const WORLD_EDGE_MARGIN = 48;

/** Draw-order bands. */
export const Depth = {
    Water: -100,
    DeepWater: -95,
    Seabed: -90,
    WaterFx: -85,
    Island: -50,
    IslandDecor: -40,
    Collectible: 0,
    Wake: 5,
    Ship: 10,
    Canopy: 20,
    WorldLabel: 30
} as const;
