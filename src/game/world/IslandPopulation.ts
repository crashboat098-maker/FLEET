import { GameObjects, Math as PMath, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Combatant, CombatWorld, Faction, hullDistance, newUid } from '../combat/Combatant';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { personKey, PersonKind, WorldTextures } from '../gfx/worldTextures';
import { ItemType } from '../state/items';
import type { DamageSource, PlayerState } from '../state/PlayerState';
import { REGIONS, regionAt } from './regions';
import { Community, ShoreChest, WorldFeatures } from './worldFeatures';
import { Depth } from './worldConfig';

const S = PIXEL_SCALE;
const ACTIVATE_RANGE = 1000;
export const CHEST_RANGE = 80;
const ARCHER_RANGE = 270;
const ARROW_SPEED = 230;

interface Person {
    img: GameObjects.Image;
    kind: PersonKind;
    home: { x: number; y: number };
    target: { x: number; y: number } | null;
    wait: number;
    frame: number;
    frameT: number;
}

interface Arrow {
    img: GameObjects.Image;
    vx: number;
    vy: number;
    life: number;
    target: Combatant;
    from: Combatant;
}

/** A hostile archer on a shore: a small, killable Combatant. */
class Archer implements Combatant {
    readonly uid = newUid();
    readonly faction: Faction = 'pirate';
    readonly kind = 'unit' as const;
    readonly role = 'archer';
    readonly name = 'ARCHER';
    heading = 0;
    vx = 0;
    vy = 0;
    readonly halfLen = 4;
    readonly beam = 6;
    hp = 12;
    alive = true;
    reload = Math.random() * 2000;
    readonly img: GameObjects.Image;
    onKilled: ((a: Archer, killer: Combatant | null) => void) | null = null;

    constructor(scene: Scene, public x: number, public y: number) {
        this.img = scene.add.image(x, y, personKey('archer', 0)).setScale(S).setDepth(Depth.Canopy - 1);
    }
    get hpRatio() {
        return this.hp / 12;
    }
    takeHit(d: number, _s: DamageSource, from: Combatant | null): void {
        if (!this.alive) return;
        this.hp -= d;
        this.img.setTint(0xff6b5a);
        this.img.scene.time.delayedCall(120, () => this.img.active && this.img.clearTint());
        if (this.hp <= 0) {
            this.alive = false;
            this.onKilled?.(this, from);
            this.img.scene.tweens.add({ targets: this.img, alpha: 0, angle: 90, duration: 600 });
        }
    }
    nudge(): void {}
}

interface Live {
    people: Person[];
    archers: Archer[];
    chests: { chest: ShoreChest; img: GameObjects.Image; cover?: GameObjects.Image }[];
}

/**
 * People of the islands: villagers, fishermen, merchants, guards, pirates
 * and tribes walking their shores; hostile archers guarding dangerous
 * coasts; and shore treasure waiting to be found. Islands only come alive
 * near the camera, and only on-screen people animate.
 */
export class IslandPopulation {
    private readonly live = new Map<number, Live>();
    private readonly arrows: Arrow[] = [];
    private timer = 0;
    private clock = 0;
    /** Extra treasure placed by missions (lost treasure). */
    readonly missionChests: ShoreChest[] = [];

    constructor(
        private readonly scene: Scene,
        private readonly features: WorldFeatures,
        private readonly combat: CombatWorld,
        private readonly state: PlayerState
    ) {}

    private chestsFor(islandId: number): ShoreChest[] {
        return [...this.features.chests, ...this.missionChests].filter((c) => c.island.id === islandId);
    }

    private activate(c: Community | null, islandId: number): void {
        const live: Live = { people: [], archers: [], chests: [] };
        if (c) {
            for (const kind of c.people) {
                const home = this.walkSpot(c, null) ?? { x: c.island.x, y: c.island.y };
                const img = this.scene.add.image(home.x, home.y, personKey(kind, 0)).setScale(S).setDepth(Depth.Canopy - 1);
                live.people.push({ img, kind, home, target: null, wait: Math.random() * 3000, frame: 0, frameT: 0 });
            }
            for (const p of c.archers) {
                const a = new Archer(this.scene, p.x, p.y);
                a.onKilled = (arch, killer) => {
                    if (killer?.faction === 'player') {
                        this.state.recordKill('archer', regionAt(arch.x, arch.y));
                        this.state.addGold(10);
                    }
                };
                live.archers.push(a);
                this.combat.add(a);
            }
        }
        for (const chest of this.chestsFor(islandId)) {
            if (this.state.wasUsed(chest.id)) continue;
            const key = chest.rarity === 'legendary' ? WorldTextures.ChestLegend : chest.rarity === 'rare' ? 'item-chest' : WorldTextures.ChestCommon;
            const img = this.scene.add.image(chest.x, chest.y, key).setScale(S).setDepth(Depth.IslandDecor + 3);
            // Hidden caches sit under foliage: only a corner peeks out.
            const cover = chest.hidden ? this.scene.add.image(chest.x + 3, chest.y - 2, WorldTextures.Bush).setScale(S).setDepth(Depth.IslandDecor + 4) : undefined;
            live.chests.push({ chest, img, cover });
        }
        this.live.set(islandId, live);
    }

    private deactivate(id: number): void {
        const live = this.live.get(id);
        if (!live) return;
        live.people.forEach((p) => p.img.destroy());
        live.archers.forEach((a) => {
            this.combat.remove(a);
            a.img.destroy();
        });
        live.chests.forEach((c) => {
            c.img.destroy();
            c.cover?.destroy();
        });
        this.live.delete(id);
    }

    /** A random walkable spot near the settlement: beaches and paths, not water. */
    private walkSpot(c: Community, near: { x: number; y: number } | null): { x: number; y: number } | null {
        for (let i = 0; i < 20; i++) {
            const base = near ?? c.island.coastPoint(Math.random() * Math.PI * 2);
            const x = base.x + PMath.Between(-60, 60);
            const y = base.y + PMath.Between(-60, 60);
            const e = c.island.edge(x, y);
            if (e < -6 && e > -70) return { x, y };
        }
        return null;
    }

    /** The nearest unopened chest the ship can reach from the water. */
    nearestChest(x: number, y: number): ShoreChest | null {
        let best: ShoreChest | null = null;
        let bestD = CHEST_RANGE * CHEST_RANGE;
        for (const live of this.live.values()) {
            for (const { chest } of live.chests) {
                const d = (chest.x - x) ** 2 + (chest.y - y) ** 2;
                if (d < bestD && !this.state.wasUsed(chest.id)) {
                    bestD = d;
                    best = chest;
                }
            }
        }
        return best;
    }

    /** Open a chest exactly once: rewards depend on rarity and region. */
    openChest(chest: ShoreChest): string {
        if (this.state.wasUsed(chest.id)) return '';
        this.state.markUsed(chest.id);
        const danger = REGIONS[regionAt(chest.x, chest.y)].danger;
        const roll = (pool: ItemType[], n: number) => Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
        const table = {
            common: { gold: PMath.Between(20, 40), items: roll(['wood', 'cloth', 'wood'], 1), xp: 15 },
            rare: { gold: PMath.Between(60, 100), items: [...roll(['wood', 'cloth', 'iron'], 2), 'iron' as ItemType], xp: 30 },
            legendary: { gold: PMath.Between(140, 220), items: ['chest' as ItemType, ...roll(['iron', 'cloth'], 2)], xp: 60 }
        }[chest.rarity];
        const gold = Math.round(table.gold * (0.8 + danger * 0.15));
        const left = this.state.grantLoot(gold, table.items, `${chest.rarity.toUpperCase()} CHEST`);
        this.state.addXp(table.xp);
        if (chest.id.startsWith('lost:')) this.state.missionEvent({ type: 'objective', missionId: Number(chest.id.slice(5)) });
        for (const live of this.live.values()) {
            const c = live.chests.find((x) => x.chest === chest);
            if (!c) continue;
            c.img.setTexture(WorldTextures.ChestOpen);
            c.cover?.destroy();
            const burst = this.scene.add.particles(chest.x, chest.y, 'sparkle', { speed: { min: 20, max: 70 }, lifespan: 800, scale: { start: S, end: 0 }, tint: [0xf7c843, 0xffffff], emitting: false });
            burst.setDepth(Depth.WorldLabel).explode(16);
            this.scene.tweens.add({ targets: c.img, alpha: 0, delay: 2500, duration: 800, onComplete: () => burst.destroy() });
        }
        const label = pixelText(this.scene, chest.x, chest.y - 16, `+${gold} GOLD`, Fonts.Gold).setDepth(Depth.WorldLabel);
        this.scene.tweens.add({ targets: label, y: chest.y - 44, alpha: 0, duration: 1400, onComplete: () => label.destroy() });
        return `${chest.rarity.toUpperCase()} CHEST: +${gold} GOLD, ${table.items.length - left.length} GOODS${left.length ? ' (HOLD FULL)' : ''}`;
    }

    update(deltaMs: number, player: Combatant | null, view: Phaser.Geom.Rectangle): void {
        this.clock += deltaMs;
        this.timer -= deltaMs;
        if (this.timer <= 0) {
            this.timer = 500;
            const cx = view.centerX;
            const cy = view.centerY;
            const ids = new Set<number>();
            for (const c of this.features.communities) ids.add(c.island.id);
            for (const ch of [...this.features.chests, ...this.missionChests]) ids.add(ch.island.id);
            for (const id of ids) {
                const c = this.features.communities.find((x) => x.island.id === id) ?? null;
                const isl = c?.island ?? [...this.features.chests, ...this.missionChests].find((x) => x.island.id === id)!.island;
                const near = Math.hypot(isl.x - cx, isl.y - cy) < isl.boundRadius + ACTIVATE_RANGE;
                if (near && !this.live.has(id)) this.activate(c, id);
                else if (!near && this.live.has(id)) this.deactivate(id);
            }
        }

        const dt = deltaMs / 1000;
        for (const [id, live] of this.live) {
            const c = this.features.communities.find((x) => x.island.id === id);
            // Walk between spots on the shore; only animate what's visible.
            for (const p of live.people) {
                if (!view.contains(p.img.x, p.img.y)) continue;
                if (!p.target) {
                    p.wait -= deltaMs;
                    if (p.wait <= 0 && c) {
                        p.target = p.kind === 'fisher' ? null : this.walkSpot(c, p.home);
                        p.wait = 1500 + Math.random() * 4000;
                    }
                    continue;
                }
                const dx = p.target.x - p.img.x;
                const dy = p.target.y - p.img.y;
                const d = Math.hypot(dx, dy);
                if (d < 3) {
                    p.target = null;
                    continue;
                }
                p.img.x += (dx / d) * 14 * dt;
                p.img.y += (dy / d) * 14 * dt;
                p.img.setFlipX(dx < 0);
                p.frameT += deltaMs;
                if (p.frameT > 220) {
                    p.frameT = 0;
                    p.frame ^= 1;
                    p.img.setTexture(personKey(p.kind, p.frame));
                }
            }
            // Archers loose arrows at ships near their shore.
            for (const a of live.archers) {
                if (!a.alive) continue;
                a.reload -= deltaMs;
                const target = player && player.alive && Math.hypot(player.x - a.x, player.y - a.y) < ARCHER_RANGE ? player : null;
                if (!target || a.reload > 0) continue;
                a.reload = 2200 + Math.random() * 800;
                a.img.setTexture(personKey('archer', 1));
                this.scene.time.delayedCall(200, () => a.img.active && a.img.setTexture(personKey('archer', 0)));
                // Lead the target slightly.
                const tx = target.x + target.vx * 0.8;
                const ty = target.y + target.vy * 0.8;
                const ang = Math.atan2(ty - a.y, tx - a.x) + (Math.random() - 0.5) * 0.12;
                const img = this.scene.add.image(a.x, a.y, WorldTextures.Arrow).setScale(S).setRotation(ang).setDepth(Depth.Ship + 3);
                this.arrows.push({ img, vx: Math.cos(ang) * ARROW_SPEED, vy: Math.sin(ang) * ARROW_SPEED, life: (Math.hypot(tx - a.x, ty - a.y) / ARROW_SPEED) * 1000 + 250, target, from: a });
            }
        }

        for (const ar of [...this.arrows]) {
            ar.life -= deltaMs;
            ar.img.x += ar.vx * dt;
            ar.img.y += ar.vy * dt;
            const hit = ar.target.alive && hullDistance(ar.target, ar.img.x, ar.img.y) < ar.target.beam + 2;
            if (hit) {
                ar.target.takeHit(2, 'arrow', ar.from);
                const puff = this.scene.add.particles(ar.img.x, ar.img.y, 'fx-splinter', { speed: { min: 10, max: 40 }, lifespan: 400, scale: S * 0.8, alpha: { start: 1, end: 0 }, emitting: false });
                puff.setDepth(Depth.Ship + 2).explode(4);
                this.scene.time.delayedCall(500, () => puff.destroy());
            }
            if (hit || ar.life <= 0) {
                if (!hit) {
                    const sp = this.scene.add.image(ar.img.x, ar.img.y, 'fx-splash').setScale(S * 0.6).setAlpha(0.8).setDepth(Depth.Wake + 1);
                    this.scene.tweens.add({ targets: sp, alpha: 0, scale: S, duration: 400, onComplete: () => sp.destroy() });
                }
                ar.img.destroy();
                this.arrows.splice(this.arrows.indexOf(ar), 1);
            }
        }
    }

    destroy(): void {
        for (const id of [...this.live.keys()]) this.deactivate(id);
        this.arrows.forEach((a) => a.img.destroy());
    }
}
