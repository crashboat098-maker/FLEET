import { Island } from './Island';
import { Rect, WorldData } from './WorldGenerator';
import { WORLD_EDGE_MARGIN } from './worldConfig';

/**
 * Lightweight static-collision queries against islands and solid rects
 * (the dock). Islands are bucketed into a coarse grid so each query only
 * evaluates the one or two islands that could possibly be nearby.
 */
export class CollisionWorld {
    private readonly cell = 500;
    private readonly cols: number;
    private readonly grid: Island[][];
    private readonly rects: Rect[];

    constructor(private readonly world: WorldData) {
        this.cols = Math.ceil(world.size / this.cell);
        this.grid = Array.from({ length: this.cols * this.cols }, () => []);
        for (const island of world.islands) {
            const r = island.boundRadius;
            const x0 = this.clampCell(island.x - r);
            const x1 = this.clampCell(island.x + r);
            const y0 = this.clampCell(island.y - r);
            const y1 = this.clampCell(island.y + r);
            for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.grid[cy * this.cols + cx].push(island);
        }
        this.rects = [world.port.dockRect];
    }

    private clampCell(v: number): number {
        return Math.min(this.cols - 1, Math.max(0, Math.floor(v / this.cell)));
    }

    islandsNear(x: number, y: number): Island[] {
        return this.grid[this.clampCell(y) * this.cols + this.clampCell(x)];
    }

    /** Signed distance to the nearest coastline (negative = on land). Large positive if no island near. */
    coastDistance(x: number, y: number): number {
        let best = 1e6;
        for (const isl of this.islandsNear(x, y)) {
            if (!isl.near(x, y, 200)) continue;
            best = Math.min(best, isl.edge(x, y, best));
        }
        return best;
    }

    isSolid(x: number, y: number): boolean {
        for (const r of this.rects) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
        }
        for (const isl of this.islandsNear(x, y)) if (isl.isLand(x, y)) return true;
        return false;
    }

    /** True if every point is in open water. */
    pointsFree(points: readonly { x: number; y: number }[]): boolean {
        for (const p of points) if (this.isSolid(p.x, p.y)) return false;
        return true;
    }

    /** Is this a good open-water spot, at least `clearance` from any land or solid? */
    isOpenWater(x: number, y: number, clearance: number): boolean {
        const m = WORLD_EDGE_MARGIN + clearance;
        const size = this.world.size;
        if (x < m || y < m || x > size - m || y > size - m) return false;
        if (this.coastDistance(x, y) < clearance) return false;
        for (const r of this.rects) {
            if (x > r.x - clearance && x < r.x + r.w + clearance && y > r.y - clearance && y < r.y + r.h + clearance)
                return false;
        }
        return true;
    }

    /**
     * Direction that leads out of the nearest solid shape: away from the
     * nearest island blob centre, or out of the nearest rect edge.
     */
    escapeDirection(x: number, y: number): { x: number; y: number } {
        for (const r of this.rects) {
            if (x >= r.x - 40 && x <= r.x + r.w + 40 && y >= r.y - 40 && y <= r.y + r.h + 40) {
                const cx = r.x + r.w / 2;
                const cy = r.y + r.h / 2;
                // Push sideways out of a long thin dock.
                const dx = x - cx;
                const dy = y - cy;
                if (Math.abs(dx) / r.w > Math.abs(dy) / r.h) return { x: Math.sign(dx) || 1, y: 0 };
                return { x: 0, y: Math.sign(dy) || 1 };
            }
        }
        let best: { x: number; y: number } | null = null;
        let bestE = Infinity;
        for (const isl of this.islandsNear(x, y)) {
            for (const b of isl.blobs) {
                const e = b.edge(x, y);
                if (e < bestE) {
                    bestE = e;
                    const dx = x - b.x;
                    const dy = y - b.y;
                    const len = Math.hypot(dx, dy);
                    // Exactly on a blob centre there is no "outward"; pick south.
                    best = len < 1e-3 ? { x: 0, y: 1 } : { x: dx / len, y: dy / len };
                }
            }
        }
        return best ?? { x: 0, y: 1 };
    }
}
