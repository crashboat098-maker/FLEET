import { BROADSIDE, SHIP_CLASSES, ShipClassId } from './shipClasses';

/**
 * Ship-versus-ship collision damage. Used when two hulls collide; the
 * Brigantine's BROADSIDE ability doubles ram damage dealt and halves ram
 * damage taken. Kept pure so AI ships / multiplayer can reuse it later.
 */

/** Relative speeds below this are bumps, not rams. */
export const RAM_MIN_SPEED = 20;

export interface RamResult {
    toDefender: number;
    toAttacker: number;
}

const isBroadside = (cls: ShipClassId) => SHIP_CLASSES[cls].ability.id === 'broadside';

/** Base ram damage scales with closing speed and the attacker's hull mass. */
export const resolveRam = (attacker: ShipClassId, defender: ShipClassId, closingSpeed: number): RamResult => {
    if (closingSpeed < RAM_MIN_SPEED) return { toDefender: 0, toAttacker: 0 };
    const mass = (cls: ShipClassId) => SHIP_CLASSES[cls].stats.maxHp / 100;
    const base = (closingSpeed - RAM_MIN_SPEED) * 0.6;
    let toDefender = base * mass(attacker);
    let toAttacker = base * 0.4 * mass(defender);
    if (isBroadside(attacker)) {
        toDefender *= BROADSIDE.dealtMult;
        toAttacker *= BROADSIDE.takenMult;
    }
    if (isBroadside(defender)) toDefender *= BROADSIDE.takenMult;
    return { toDefender, toAttacker };
};
