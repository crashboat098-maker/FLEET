import type { Formation } from './profile';

/**
 * Where the k-th escort (0-based) sails relative to the flagship, in world
 * units: `back` = distance behind, `side` = distance to starboard (negative =
 * port). Used both for real escort positions and for the formation previews.
 */
export const formationOffset = (formation: Formation, index: number): { back: number; side: number } => {
    const k = index + 1;
    switch (formation) {
        case 'line':
            return { back: 90 * k, side: 0 };
        case 'wedge':
            return { back: 70 * Math.ceil(k / 2), side: (k % 2 ? -1 : 1) * 60 * Math.ceil(k / 2) };
        case 'flank':
            return { back: 10, side: (k % 2 ? -1 : 1) * 75 * Math.ceil(k / 2) };
    }
};

export const FORMATION_ORDER: Formation[] = ['line', 'wedge', 'flank'];
