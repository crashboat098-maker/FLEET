import { resolveRam } from '../ships/combat';
import { ShipClassId } from '../ships/shipClasses';
import type { DamageSource } from '../state/PlayerState';

/**
 * Anything that can be shot, rammed or bitten: the player's flagship,
 * escorts, NPC ships and sea creatures. Hulls are modelled as capsules
 * (a line from bow to stern with a radius of `beam`) — cheap and accurate
 * enough for long thin ships.
 */

export type Faction = 'player' | 'neutral' | 'pirate' | 'monster';

export interface Combatant {
    readonly uid: number;
    readonly faction: Faction;
    readonly kind: 'ship' | 'creature' | 'unit';
    /** AI role or creature kind (pirate, merchant, shark, kraken...). */
    readonly role: string;
    readonly name: string;
    x: number;
    y: number;
    heading: number;
    vx: number;
    vy: number;
    /** Half the hull length and the hull half-width, in world units. */
    readonly halfLen: number;
    readonly beam: number;
    readonly alive: boolean;
    /** 0..1 */
    readonly hpRatio: number;
    /** Ship class (ships only) — drives ram damage and BROADSIDE. */
    readonly cls?: ShipClassId;
    /** Damage multiplier this attacker has against creatures (harpoons). */
    readonly creatureMult?: number;
    takeHit(damage: number, source: DamageSource, from: Combatant | null): void;
    /** Push the body (collision separation). */
    nudge(dx: number, dy: number): void;
}

let nextUid = 1;
export const newUid = () => nextUid++;

/** Would `a` attack `b` of its own accord? (Cannonballs can still hit neutrals.) */
export const isHostile = (a: Faction, b: Faction): boolean => {
    if (a === b) return false;
    if (a === 'monster' || b === 'monster') return true;
    if (a === 'pirate' || b === 'pirate') return true;
    return false; // player <-> neutral are at peace unless provoked
};

/** Closest distance from point (px,py) to a combatant's hull centre line. */
export const hullDistance = (c: Combatant, px: number, py: number): number => {
    const fx = Math.sin(c.heading);
    const fy = -Math.cos(c.heading);
    const dx = px - c.x;
    const dy = py - c.y;
    const along = Math.max(-c.halfLen, Math.min(c.halfLen, dx * fx + dy * fy));
    return Math.hypot(dx - fx * along, dy - fy * along);
};

/** Registry of everything that can fight, plus ship-on-ship collisions. */
export class CombatWorld {
    readonly list: Combatant[] = [];
    private readonly ramCooldown = new Map<string, number>();
    private clock = 0;

    add(c: Combatant): void {
        this.list.push(c);
    }

    remove(c: Combatant): void {
        const i = this.list.indexOf(c);
        if (i >= 0) this.list.splice(i, 1);
    }

    /** Living combatants within `r` of a point. */
    near(x: number, y: number, r: number): Combatant[] {
        const r2 = r * r;
        return this.list.filter((c) => c.alive && (c.x - x) ** 2 + (c.y - y) ** 2 <= r2);
    }

    /** Nearest living combatant hostile to `faction` within `r`. */
    nearestHostile(x: number, y: number, r: number, faction: Faction, filter?: (c: Combatant) => boolean): Combatant | null {
        let best: Combatant | null = null;
        let bestD = r * r;
        for (const c of this.list) {
            if (!c.alive || !isHostile(faction, c.faction) || (filter && !filter(c))) continue;
            const d = (c.x - x) ** 2 + (c.y - y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        return best;
    }

    /**
     * Separate overlapping hulls and apply ram damage when ships meet at speed.
     * Pairs are cheap to reject (bounding circles) and NPC counts are small.
     */
    update(deltaMs: number): void {
        this.clock += deltaMs;
        const ships = this.list.filter((c) => c.alive && c.kind === 'ship');
        for (let i = 0; i < ships.length; i++) {
            for (let j = i + 1; j < ships.length; j++) {
                const a = ships[i];
                const b = ships[j];
                const reach = a.halfLen + b.halfLen;
                if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach) continue;
                // Sample a's bow, centre and stern against b's capsule.
                const fx = Math.sin(a.heading);
                const fy = -Math.cos(a.heading);
                let worst = 0;
                let nx = 0;
                let ny = 0;
                for (const t of [-0.8, 0, 0.8]) {
                    const px = a.x + fx * a.halfLen * t;
                    const py = a.y + fy * a.halfLen * t;
                    const d = hullDistance(b, px, py);
                    const overlap = a.beam + b.beam - d;
                    if (overlap > worst) {
                        worst = overlap;
                        const len = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                        nx = (a.x - b.x) / len;
                        ny = (a.y - b.y) / len;
                    }
                }
                if (worst <= 0) continue;
                a.nudge(nx * worst * 0.5, ny * worst * 0.5);
                b.nudge(-nx * worst * 0.5, -ny * worst * 0.5);

                // Closing speed along the contact normal.
                const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
                const key = a.uid < b.uid ? `${a.uid}:${b.uid}` : `${b.uid}:${a.uid}`;
                if (closing < 20 || (this.ramCooldown.get(key) ?? 0) > this.clock) continue;
                this.ramCooldown.set(key, this.clock + 900);
                // Whoever is driving harder into the other is the rammer.
                const aInto = -(a.vx * nx + a.vy * ny);
                const bInto = b.vx * nx + b.vy * ny;
                const [atk, def] = aInto >= bInto ? [a, b] : [b, a];
                // Only deliberate rams hurt: the player, or a ship hostile to its victim.
                // Accidental bumps from peaceful traffic just push apart.
                if (atk.faction !== 'player' && !isHostile(atk.faction, def.faction)) continue;
                const r = resolveRam(atk.cls ?? 'sloop', def.cls ?? 'sloop', closing);
                def.takeHit(r.toDefender, 'ram', atk);
                atk.takeHit(r.toAttacker, 'ram', def);
            }
        }
    }
}
