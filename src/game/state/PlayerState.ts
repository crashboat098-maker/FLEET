import { Events } from 'phaser';
import { ItemType } from './items';

export const StateEvents = {
    Changed: 'state-changed',
    Toast: 'toast',
    Prompt: 'prompt'
} as const;

/**
 * The player's captain/ship state. Scenes mutate it through methods and the
 * HUD listens for events. Kept free of rendering code so it can later be
 * persisted (save games) or synced (multiplayer).
 */
export class PlayerState extends Events.EventEmitter {
    shipName = 'SLOOP';
    hull = 100;
    hullMax = 100;
    gold = 0;
    cargoCapacity = 5;
    readonly cargo: ItemType[] = [];

    get cargoFull(): boolean {
        return this.cargo.length >= this.cargoCapacity;
    }

    /** Returns false (and changes nothing) when the hold is full. */
    addCargo(item: ItemType): boolean {
        if (this.cargoFull) return false;
        this.cargo.push(item);
        this.emit(StateEvents.Changed);
        return true;
    }

    toast(message: string): void {
        this.emit(StateEvents.Toast, message);
    }

    /** Contextual prompt (e.g. "E - DOCK"). Pass null to clear. */
    prompt(message: string | null): void {
        this.emit(StateEvents.Prompt, message);
    }
}
