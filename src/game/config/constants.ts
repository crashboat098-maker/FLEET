/**
 * Global constants for FLEET.IO.
 *
 * The game renders at a low 16:9 internal resolution and is scaled up with
 * nearest-neighbour filtering, which keeps every pixel chunky and crisp.
 */
export const GAME_TITLE = 'FLEET';
export const GAME_SUBTITLE = "CAPTAIN'S LEGACY";
export const GAME_VERSION = '0.1.0';

/**
 * Internal (logical) resolution — 16:9. Raised from 640x360 to 768x432 to
 * show ~20% more of the world (a crisp "zoom out" without fractional
 * camera zoom, which would make pixel art shimmer).
 */
export const GAME_WIDTH = 768;
export const GAME_HEIGHT = 432;

/** World art is drawn at 1 art-pixel = PIXEL_SCALE screen pixels. */
export const PIXEL_SCALE = 2;

/** Scene keys, kept in one place so scenes never use raw strings. */
export const SceneKeys = {
    Boot: 'Boot',
    Menu: 'Menu',
    Ocean: 'Ocean',
    Hud: 'Hud',
    Port: 'Port',
    ShipSelect: 'ShipSelect'
} as const;

export type SceneKey = (typeof SceneKeys)[keyof typeof SceneKeys];

/**
 * Absolute sailing speed limit (world units/s). No ship class, upgrade or
 * ability may ever exceed this.
 */
export const SPEED_CAP = 84;
