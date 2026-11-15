import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { makeDockTexture, PortTextures } from '../gfx/portTextures';
import { Circle, PortLayout } from './WorldGenerator';
import { Depth } from './worldConfig';

/** How close (world units) the ship must be to the dock to dock. */
export const DOCK_RANGE = 70;

/**
 * Builds the harbour's visuals and answers "can the ship dock here?".
 */
export class PortSystem {
    private readonly beam: GameObjects.Image;
    private readonly bobbers: { obj: GameObjects.Image; baseY: number; phase: number }[] = [];
    private readonly marker: GameObjects.Image;
    private readonly markerBaseY: number;
    private elapsed = 0;

    constructor(private readonly scene: Scene, readonly layout: PortLayout) {
        const S = PIXEL_SCALE;
        const { dockBase, dockEnd, dockWidth } = layout;

        const dockKey = 'dock-harbour';
        makeDockTexture(scene, dockKey, dockWidth / S, (dockEnd.y - dockBase.y) / S);
        scene.add.image(dockBase.x, dockBase.y, dockKey).setOrigin(0.5, 0).setScale(S).setDepth(Depth.IslandDecor);

        for (const b of layout.buildings) {
            scene.add.image(b.x, b.y, PortTextures.Roof[b.variant]).setScale(S).setDepth(Depth.IslandDecor + 1);
        }
        for (const p of layout.props) {
            const key = p.kind === 'barrel' ? PortTextures.PropBarrel : PortTextures.PropCrate;
            scene.add.image(p.x, p.y, key).setScale(S).setDepth(Depth.IslandDecor + 2);
        }

        scene.add.image(layout.lighthouse.x, layout.lighthouse.y, PortTextures.Lighthouse).setScale(S).setDepth(Depth.Canopy);
        this.beam = scene.add
            .image(layout.lighthouse.x, layout.lighthouse.y, PortTextures.Beam)
            .setOrigin(0, 0.5)
            .setScale(S)
            .setDepth(Depth.Canopy + 1);

        for (const buoy of layout.buoys) {
            const key = buoy.color === 'red' ? PortTextures.BuoyRed : PortTextures.BuoyGreen;
            const obj = scene.add.image(buoy.x, buoy.y, key).setScale(S).setDepth(Depth.Collectible);
            this.bobbers.push({ obj, baseY: buoy.y, phase: Math.random() * 6 });
        }

        // Harbour marker: a gold anchor hovering over the dock head.
        this.markerBaseY = dockEnd.y - 30;
        this.marker = scene.add.image(dockEnd.x, this.markerBaseY, PortTextures.Anchor).setScale(S).setDepth(Depth.WorldLabel);
        pixelText(scene, dockBase.x, dockBase.y - 168, layout.name, Fonts.Gold, 1).setDepth(Depth.WorldLabel);
    }

    /** Areas on the port island that vegetation should avoid. */
    static exclusions(layout: PortLayout): Circle[] {
        return [
            ...layout.buildings.map((b) => ({ x: b.x, y: b.y, r: 36 })),
            ...layout.props.map((p) => ({ x: p.x, y: p.y, r: 14 })),
            { x: layout.lighthouse.x, y: layout.lighthouse.y, r: 26 },
            { x: layout.dockBase.x, y: layout.dockBase.y, r: 40 }
        ];
    }

    /** Distance from a point to the dock (segment from base to end). */
    distanceToDock(x: number, y: number): number {
        const { dockBase, dockEnd } = this.layout;
        const cy = Math.max(dockBase.y + 40, Math.min(dockEnd.y, y));
        return Math.hypot(x - dockBase.x, y - cy);
    }

    canDock(x: number, y: number): boolean {
        return this.distanceToDock(x, y) < DOCK_RANGE;
    }

    update(deltaMs: number): void {
        this.elapsed += deltaMs;
        const view = this.scene.cameras.main.worldView;
        const { dockEnd } = this.layout;
        // Skip all animation when the harbour is well off-screen.
        if (Math.abs(dockEnd.x - view.centerX) > view.width + 300 || Math.abs(dockEnd.y - view.centerY) > view.height + 300) return;

        const t = this.elapsed / 1000;
        this.beam.rotation = t * 0.9;
        for (const b of this.bobbers) b.obj.y = b.baseY + Math.round(Math.sin(t * 2 + b.phase) * 1.5);
        this.marker.y = this.markerBaseY + Math.round(Math.sin(t * 2.5) * 3);
    }
}
