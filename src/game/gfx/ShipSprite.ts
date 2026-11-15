import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { TextureKeys } from './textures';

/**
 * Visual-only ship: hull sprite with a gentle bob and a fading foam wake.
 * Movement/physics will be layered on in Milestone 1.
 */
export class ShipSprite extends GameObjects.Container {
    private readonly hull: GameObjects.Image;
    private wakeTimer = 0;

    constructor(scene: Scene, x: number, y: number, headingDeg = 0, private readonly wakeEnabled = true) {
        super(scene, x, y);
        this.hull = scene.add.image(0, 0, TextureKeys.Sloop).setScale(PIXEL_SCALE);
        this.add(this.hull);
        this.setAngle(headingDeg);
        scene.add.existing(this);
        this.addToUpdateList();

        scene.tweens.add({
            targets: this.hull,
            y: { from: -1, to: 1 },
            angle: { from: -1.5, to: 1.5 },
            duration: 1400,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1
        });
    }

    /** Containers aren't on the update list by default; we opt in via addToUpdateList(). */
    preUpdate(_time: number, delta: number): void {
        if (!this.wakeEnabled) return;
        this.wakeTimer -= delta;
        if (this.wakeTimer > 0) return;
        this.wakeTimer = 140;
        this.spawnWake();
    }

    private spawnWake(): void {
        // Stern is "down" in local space; convert to world space.
        const rad = this.rotation;
        const sternDist = (this.hull.height * PIXEL_SCALE) / 2 - 2;
        const side = (Math.random() - 0.5) * 10;
        const wx = this.x - Math.sin(rad) * sternDist + Math.cos(rad) * side;
        const wy = this.y + Math.cos(rad) * sternDist + Math.sin(rad) * side;
        const foam = this.scene.add.image(wx, wy, TextureKeys.Sparkle).setScale(PIXEL_SCALE).setDepth(this.depth - 1);
        this.scene.tweens.add({
            targets: foam,
            alpha: 0,
            x: wx - Math.sin(rad) * 24,
            y: wy + Math.cos(rad) * 24,
            duration: 1100,
            onComplete: () => foam.destroy()
        });
    }
}
