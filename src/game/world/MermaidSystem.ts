import { GameObjects, Scene, Sound } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { SirenSong } from '../audio/SirenSong';
import { WorldTextures } from '../gfx/worldTextures';
import type { PlayerState } from '../state/PlayerState';
import { MermaidSpot } from './worldFeatures';
import { Depth } from './worldConfig';

const S = PIXEL_SCALE;
const SING_RANGE = 420;
const PULL_RANGE = 480;
const SONG_MS = 9000;
const COOLDOWN_MS = 45000;

/** What the siren needs from the player's ship. */
export interface Lurable {
    x: number;
    y: number;
    lure: { x: number; y: number; strength: number } | null;
}

interface Siren {
    spot: MermaidSpot;
    rock?: GameObjects.Image;
    body?: GameObjects.Image;
    notes?: GameObjects.Particles.ParticleEmitter;
    singingUntil: number;
    cooldownUntil: number;
    frameT: number;
    frame: number;
    rippleT: number;
}

/**
 * Mermaids on rocks by reefs and lonely islands. Every so often one sings:
 * a warning appears, music plays, notes drift — and the ship's helm is
 * slowly pulled toward her rocks. Steering away or leaving range breaks the
 * spell; each siren then rests before she can sing again.
 */
export class MermaidSystem {
    private readonly sirens: Siren[];
    private readonly song: SirenSong;
    private clock = 0;
    private singing: Siren | null = null;
    onSongStart: ((spot: MermaidSpot) => void) | null = null;

    constructor(
        private readonly scene: Scene,
        spots: MermaidSpot[],
        private readonly state: PlayerState
    ) {
        this.sirens = spots.map((spot) => ({ spot, singingUntil: 0, cooldownUntil: 0, frameT: 0, frame: 0, rippleT: Math.random() * 1200 }));
        const ctx = scene.sound instanceof Sound.WebAudioSoundManager ? scene.sound.context : null;
        this.song = new SirenSong(ctx);
    }

    private show(s: Siren): void {
        const { x, y } = s.spot;
        s.rock = this.scene.add.image(x, y + 6, WorldTextures.Rock).setScale(S).setDepth(Depth.IslandDecor + 2);
        s.body = this.scene.add.image(x - 2, y - 4, WorldTextures.Mermaid[0]).setScale(S).setDepth(Depth.IslandDecor + 3);
    }

    private hide(s: Siren): void {
        s.rock?.destroy();
        s.body?.destroy();
        s.notes?.destroy();
        s.rock = s.body = undefined;
        s.notes = undefined;
    }

    private startSong(s: Siren): void {
        s.singingUntil = this.clock + SONG_MS;
        s.cooldownUntil = this.clock + SONG_MS + COOLDOWN_MS;
        this.singing = s;
        this.state.toast("A SIREN'S SONG... STEER AWAY!");
        this.song.start();
        s.notes = this.scene.add.particles(s.spot.x, s.spot.y - 10, WorldTextures.Note, {
            speedX: { min: -25, max: 25 },
            speedY: { min: -35, max: -15 },
            lifespan: 1800,
            frequency: 260,
            scale: { start: S, end: S * 0.6 },
            alpha: { start: 1, end: 0 },
            tint: [0x7fe0e8, 0xd8a0e8, 0xffffff]
        });
        s.notes.setDepth(Depth.WorldLabel);
        this.onSongStart?.(s.spot);
    }

    private endSong(s: Siren, escaped: boolean): void {
        if (this.singing !== s) return;
        this.singing = null;
        s.singingUntil = 0;
        this.song.stop();
        s.notes?.stop();
        if (escaped) this.state.toast('YOU BROKE FREE OF THE SONG');
    }

    update(deltaMs: number, ship: Lurable | null, view: Phaser.Geom.Rectangle): void {
        this.clock += deltaMs;
        if (ship) ship.lure = null;
        for (const s of this.sirens) {
            const visible = Math.abs(s.spot.x - view.centerX) < view.width + 300 && Math.abs(s.spot.y - view.centerY) < view.height + 300;
            if (visible && !s.rock) this.show(s);
            else if (!visible && s.rock && this.singing !== s) this.hide(s);
            if (!s.body) continue;

            // Tail flicks and ripples around the rock.
            s.frameT += deltaMs;
            if (s.frameT > (this.singing === s ? 260 : 600)) {
                s.frameT = 0;
                s.frame ^= 1;
                s.body.setTexture(WorldTextures.Mermaid[s.frame]);
            }
            s.rippleT -= deltaMs;
            if (s.rippleT <= 0) {
                s.rippleT = this.singing === s ? 500 : 1400;
                const ring = this.scene.add.image(s.spot.x, s.spot.y + 8, 'fx-ring').setScale(S * 0.3).setAlpha(0.7).setDepth(Depth.Wake).setTint(this.singing === s ? 0xd8a0e8 : 0xffffff);
                this.scene.tweens.add({ targets: ring, scale: S * (this.singing === s ? 1.8 : 0.9), alpha: 0, duration: 1500, onComplete: () => ring.destroy() });
            }

            if (!ship) continue;
            const d = Math.hypot(ship.x - s.spot.x, ship.y - s.spot.y);
            if (!this.singing && d < SING_RANGE && this.clock > s.cooldownUntil) this.startSong(s);
            if (this.singing === s) {
                if (this.clock > s.singingUntil) this.endSong(s, false);
                else if (d > PULL_RANGE) this.endSong(s, true);
                else {
                    // The song pulls the helm toward her rocks; strongest up close.
                    const strength = 0.9 * (1 - d / PULL_RANGE) + 0.2;
                    ship.lure = { x: s.spot.x, y: s.spot.y, strength };
                    this.song.setVolume(1 - d / PULL_RANGE + 0.15);
                }
            }
        }
    }

    /** Is any siren singing right now (for the HUD)? */
    get active(): boolean {
        return this.singing !== null;
    }

    destroy(): void {
        this.song.stop();
        this.sirens.forEach((s) => this.hide(s));
    }
}
