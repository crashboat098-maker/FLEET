import { GameObjects, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Fonts, pixelText } from '../gfx/pixelFont';
import { makeDockTexture, PortTextures } from '../gfx/portTextures';
import { CARDINAL_VEC, Circle, PortLayout } from './WorldGenerator';
import { Depth, HARBOUR_RADIUS } from './worldConfig';
import { Palette } from '../config/palette';
import { CombatTextures } from '../gfx/combatTextures';
import { FxTextures } from '../gfx/fxTextures';
import { tierOf } from './portTiers';

/** Rotation that turns the (south-pointing) dock texture to face each direction. */
const DOCK_ANGLE = { S: 0, N: 180, E: -90, W: 90 } as const;

/**
 * Builds one harbour's visuals and answers "is the ship inside this port's
 * safe-harbour radius?" (dock from anywhere inside it; no fighting).
 * The radius is drawn as a dashed ring on the water.
 */
export class PortSystem {
    private readonly beam: GameObjects.Image | null = null;
    private readonly bobbers: { obj: GameObjects.Image; baseY: number; phase: number }[] = [];
    private readonly marker: GameObjects.Image;
    private readonly markerBaseY: number;
    private elapsed = 0;
    private readonly torches: GameObjects.Image[] = [];

    constructor(private readonly scene: Scene, readonly layout: PortLayout) {
        const S = PIXEL_SCALE;
        const { dockBase, dockEnd, dockWidth, dir } = layout;
        const f = CARDINAL_VEC[dir];

        // Safe-harbour ring: a faint tint inside a dashed rope line (drawn under land).
        const ring = scene.add.graphics().setDepth(Depth.WaterFx + 1);
        ring.fillStyle(Palette.cream, 0.05).fillCircle(dockEnd.x, dockEnd.y, HARBOUR_RADIUS);
        const dashes = 64;
        for (let i = 0; i < dashes; i += 2) {
            const a0 = (i / dashes) * Math.PI * 2;
            const a1 = ((i + 1) / dashes) * Math.PI * 2;
            ring.lineStyle(4, Palette.woodDeep, 0.25).beginPath().arc(dockEnd.x, dockEnd.y, HARBOUR_RADIUS, a0, a1).strokePath();
            ring.lineStyle(2, Palette.cream, 0.6).beginPath().arc(dockEnd.x, dockEnd.y, HARBOUR_RADIUS, a0, a1).strokePath();
        }

        const length = Math.hypot(dockEnd.x - dockBase.x, dockEnd.y - dockBase.y);
        const dockKey = `dock-${Math.round(length)}`;
        makeDockTexture(scene, dockKey, dockWidth / S, length / S);
        scene.add
            .image((dockBase.x + dockEnd.x) / 2, (dockBase.y + dockEnd.y) / 2, dockKey)
            .setScale(S)
            .setAngle(DOCK_ANGLE[dir])
            .setDepth(Depth.IslandDecor);

        for (const b of layout.buildings) {
            scene.add.image(b.x, b.y, PortTextures.Roof[b.variant]).setScale(S).setDepth(Depth.IslandDecor + 1);
        }
        for (const p of layout.props) {
            const key = p.kind === 'barrel' ? PortTextures.PropBarrel : PortTextures.PropCrate;
            scene.add.image(p.x, p.y, key).setScale(S).setDepth(Depth.IslandDecor + 2);
        }

        if (layout.lighthouse) {
            scene.add.image(layout.lighthouse.x, layout.lighthouse.y, PortTextures.Lighthouse).setScale(S).setDepth(Depth.Canopy);
            this.beam = scene.add
                .image(layout.lighthouse.x, layout.lighthouse.y, PortTextures.Beam)
                .setOrigin(0, 0.5)
                .setScale(S)
                .setDepth(Depth.Canopy + 1);
        }

        for (const buoy of layout.buoys) {
            const key = buoy.color === 'red' ? PortTextures.BuoyRed : PortTextures.BuoyGreen;
            const obj = scene.add.image(buoy.x, buoy.y, key).setScale(S).setDepth(Depth.Collectible);
            this.bobbers.push({ obj, baseY: buoy.y, phase: Math.random() * 6 });
        }

        // Harbour marker: a gold anchor hovering over the dock head.
        const mx = dockEnd.x - f.x * 30;
        this.markerBaseY = dockEnd.y - f.y * 30;
        this.marker = scene.add.image(mx, this.markerBaseY, PortTextures.Anchor).setScale(S).setDepth(Depth.WorldLabel);
        pixelText(scene, layout.label.x, layout.label.y, layout.name, Fonts.Gold, 1).setDepth(Depth.WorldLabel);
        pixelText(scene, layout.label.x, layout.label.y + 10, `TIER ${layout.tier} - ${tierOf(layout.index).title}`, Fonts.Cream, 1).setDepth(Depth.WorldLabel).setAlpha(0.85);

        // Tier architecture.
        const tex: Record<string, string> = {
            tower: CombatTextures.Tower,
            warehouse: CombatTextures.Warehouse,
            skullflag: CombatTextures.SkullFlag,
            torch: CombatTextures.Torch,
            cannon: CombatTextures.Cannon
        };
        layout.extras.forEach((e, i) => {
            const key = e.kind === 'awning' ? (i % 2 ? CombatTextures.AwningB : CombatTextures.AwningA) : tex[e.kind];
            const img = scene.add.image(e.x, e.y, key).setScale(S).setDepth(Depth.IslandDecor + 3);
            if (e.kind === 'cannon') img.setAngle(DOCK_ANGLE[dir] + 180);
            if (e.kind === 'torch') this.torches.push(scene.add.image(e.x, e.y - 2, FxTextures.Fire[0]).setOrigin(0.5, 0.9).setScale(S).setDepth(Depth.IslandDecor + 4));
        });
    }

    /** Areas on the port island that vegetation should avoid. */
    static exclusions(layout: PortLayout): Circle[] {
        const list: Circle[] = [
            ...layout.buildings.map((b) => ({ x: b.x, y: b.y, r: 36 })),
            ...layout.props.map((p) => ({ x: p.x, y: p.y, r: 14 })),
            { x: layout.dockBase.x, y: layout.dockBase.y, r: 40 },
            { x: layout.label.x, y: layout.label.y, r: 30 },
            ...layout.extras.map((e) => ({ x: e.x, y: e.y, r: e.kind === 'warehouse' ? 40 : 18 }))
        ];
        if (layout.lighthouse) list.push({ x: layout.lighthouse.x, y: layout.lighthouse.y, r: 26 });
        return list;
    }

    /** Distance from a point to the centre of the docking radius (the dock head). */
    distanceToDock(x: number, y: number): number {
        return Math.hypot(x - this.layout.dockEnd.x, y - this.layout.dockEnd.y);
    }

    /** Inside the safe-harbour radius? (Dock from anywhere inside it.) */
    canDock(x: number, y: number): boolean {
        return this.distanceToDock(x, y) <= HARBOUR_RADIUS;
    }

    /** The safe zone as a circle (centred on the dock head). */
    get safeZone(): Circle {
        return { x: this.layout.dockEnd.x, y: this.layout.dockEnd.y, r: HARBOUR_RADIUS };
    }

    update(deltaMs: number): void {
        this.elapsed += deltaMs;
        const view = this.scene.cameras.main.worldView;
        const { dockEnd } = this.layout;
        // Skip all animation when the harbour is well off-screen.
        if (Math.abs(dockEnd.x - view.centerX) > view.width + 300 || Math.abs(dockEnd.y - view.centerY) > view.height + 300) return;

        const t = this.elapsed / 1000;
        if (this.beam) this.beam.rotation = t * 0.9;
        for (const b of this.bobbers) b.obj.y = b.baseY + Math.round(Math.sin(t * 2 + b.phase) * 1.5);
        const frame = Math.floor(t * 9);
        this.torches.forEach((f, i) => f.setTexture(FxTextures.Fire[(frame + i) % FxTextures.Fire.length]));
        this.marker.y = this.markerBaseY + Math.round(Math.sin(t * 2.5) * 3);
    }
}
