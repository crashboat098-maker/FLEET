import { GameObjects, Geom, Scene } from 'phaser';
import { PIXEL_SCALE } from '../config/constants';
import { Raster } from '../gfx/Raster';
import { Island } from './Island';
import { IslandArt, Stamp } from './IslandArt';
import { IslandLife } from './IslandLife';
import { Circle } from './WorldGenerator';
import { Depth, SHALLOW_HALO } from './worldConfig';

/** Tile edge in art pixels (= TILE * PIXEL_SCALE world units). */
const TILE = 256;
/** Bake tiles this far beyond the view so they're ready before they scroll in. */
const LOAD_MARGIN = 700;
/** Unload tiles once they're this far outside the view. */
const UNLOAD_MARGIN = 1700;
/** Activate island sprites/effects within this margin. */
const LIFE_MARGIN = 500;
const LIFE_DROP_MARGIN = 1300;
/** Max milliseconds of baking per frame. */
const FRAME_BUDGET_MS = 5;

interface TileRef {
    key: string;
    art: IslandArt;
    x0: number;
    y0: number;
    w: number;
    h: number;
    /** World rect. */
    rect: Geom.Rectangle;
}

interface Job {
    tile: TileRef;
    raster: Raster;
    /** Next terrain row to rasterise. */
    row: number;
    /** Stamps overlapping this tile (collected once rows are done) and progress through them. */
    stamps: Stamp[] | null;
    stamp: number;
}

const expand = (r: Geom.Rectangle, m: number) => new Geom.Rectangle(r.x - m, r.y - m, r.width + m * 2, r.height + m * 2);

const circleHitsRect = (x: number, y: number, rad: number, r: Geom.Rectangle) => {
    const cx = Math.max(r.x, Math.min(x, r.right));
    const cy = Math.max(r.y, Math.min(y, r.bottom));
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};

/**
 * Streams island terrain around the camera.
 *
 * Each island's art is split into 256x256 art-pixel tiles. Tiles near the
 * view are rasterised a few rows at a time within a per-frame time budget,
 * uploaded as textures, and destroyed again when the camera moves far away.
 * This keeps memory and start-up cost flat no matter how big the world or
 * individual islands get.
 */
export class TerrainStreamer {
    private readonly arts = new Map<number, IslandArt>();
    private readonly tiles = new Map<number, TileRef[]>();
    private readonly loaded = new Map<string, GameObjects.Image>();
    private readonly queued = new Set<string>();
    private queue: Job[] = [];
    private scanTimer = 0;

    constructor(
        private readonly scene: Scene,
        private readonly islands: Island[],
        private readonly exclusions: Map<number, Circle[]>,
        private readonly life: IslandLife
    ) {}

    get loadedTiles(): number {
        return this.loaded.size;
    }

    get pending(): number {
        return this.queue.length;
    }

    artFor(island: Island): IslandArt {
        let art = this.arts.get(island.id);
        if (!art) {
            art = new IslandArt(island, this.exclusions.get(island.id));
            this.arts.set(island.id, art);
        }
        return art;
    }

    private tilesFor(island: Island): TileRef[] {
        let list = this.tiles.get(island.id);
        if (list) return list;
        const art = this.artFor(island);
        const S = PIXEL_SCALE;
        list = [];
        for (let ty = 0; ty * TILE < art.H; ty++) {
            for (let tx = 0; tx * TILE < art.W; tx++) {
                const x0 = tx * TILE;
                const y0 = ty * TILE;
                const w = Math.min(TILE, art.W - x0);
                const h = Math.min(TILE, art.H - y0);
                // Skip corner tiles that the island's reach never touches.
                const nx = Math.max(x0, Math.min(art.cx, x0 + w));
                const ny = Math.max(y0, Math.min(art.cy, y0 + h));
                if ((nx - art.cx) ** 2 + (ny - art.cy) ** 2 > art.reach ** 2) continue;
                list.push({
                    key: `isl-${island.id}-${tx}-${ty}`,
                    art,
                    x0,
                    y0,
                    w,
                    h,
                    rect: new Geom.Rectangle(art.left + x0 * S, art.top + y0 * S, w * S, h * S)
                });
            }
        }
        this.tiles.set(island.id, list);
        return list;
    }

    /** Decide which tiles to bake/unload and which islands are "alive". */
    private scan(view: Geom.Rectangle): void {
        const near = expand(view, LOAD_MARGIN);
        const far = expand(view, UNLOAD_MARGIN);
        const lifeOn = expand(view, LIFE_MARGIN);
        const lifeOff = expand(view, LIFE_DROP_MARGIN);

        for (const island of this.islands) {
            const reach = island.boundRadius + SHALLOW_HALO;
            if (circleHitsRect(island.x, island.y, reach, far)) {
                for (const t of this.tilesFor(island)) {
                    const wanted = Geom.Rectangle.Overlaps(t.rect, near);
                    if (wanted && !this.loaded.has(t.key) && !this.queued.has(t.key)) {
                        this.queued.add(t.key);
                        this.queue.push({ tile: t, raster: new Raster(t.w, t.h), row: 0, stamps: null, stamp: 0 });
                    } else if (!Geom.Rectangle.Overlaps(t.rect, far)) {
                        this.unload(t.key);
                    }
                }
            } else if (this.tiles.has(island.id)) {
                for (const t of this.tiles.get(island.id)!) this.unload(t.key);
            }

            if (circleHitsRect(island.x, island.y, island.boundRadius, lifeOn)) this.life.activate(this.artFor(island));
            else if (!circleHitsRect(island.x, island.y, island.boundRadius, lifeOff)) this.life.deactivate(island.id);
        }

        // Drop queued jobs that drifted out of range; bake nearest first.
        this.queue = this.queue.filter((j) => {
            const keep = Geom.Rectangle.Overlaps(j.tile.rect, far);
            if (!keep) this.queued.delete(j.tile.key);
            return keep;
        });
        const cx = view.centerX;
        const cy = view.centerY;
        this.queue.sort(
            (a, b) =>
                (a.tile.rect.centerX - cx) ** 2 + (a.tile.rect.centerY - cy) ** 2 - ((b.tile.rect.centerX - cx) ** 2 + (b.tile.rect.centerY - cy) ** 2)
        );
    }

    private unload(key: string): void {
        const img = this.loaded.get(key);
        if (!img) return;
        img.destroy();
        this.scene.textures.remove(key);
        this.loaded.delete(key);
    }

    /**
     * Work through queued tiles until the time budget runs out:
     * terrain rows first, then decoration stamps, then the GPU upload.
     * Each phase yields between items so no single frame does too much.
     */
    private process(budgetMs: number): void {
        const t0 = performance.now();
        const over = () => performance.now() - t0 > budgetMs;
        while (this.queue.length) {
            const job = this.queue[0];
            const { tile, raster } = job;
            const art = tile.art;
            while (job.row < tile.h) {
                const py = tile.y0 + job.row;
                for (let x = 0; x < tile.w; x++) art.shade(tile.x0 + x, py, raster, x, job.row);
                job.row++;
                if (over()) return;
            }
            if (!job.stamps) {
                const x1 = tile.x0 + tile.w;
                const y1 = tile.y0 + tile.h;
                job.stamps = art.stamps.filter((s) => !(s.x1 < tile.x0 || s.x0 > x1 || s.y1 < tile.y0 || s.y0 > y1));
            }
            while (job.stamp < job.stamps.length) {
                job.stamps[job.stamp++].draw(raster, -tile.x0, -tile.y0);
                if (over()) return;
            }
            this.finish(job);
            this.queue.shift();
            if (over()) return;
        }
    }

    private finish(job: Job): void {
        const { tile, raster } = job;
        raster.toTextureRaw(this.scene, tile.key);
        const img = this.scene.add
            .image(tile.rect.x, tile.rect.y, tile.key)
            .setOrigin(0)
            .setScale(PIXEL_SCALE)
            .setDepth(Depth.Island);
        this.loaded.set(tile.key, img);
        this.queued.delete(tile.key);
    }

    update(deltaMs: number): void {
        this.scanTimer -= deltaMs;
        if (this.scanTimer <= 0) {
            this.scanTimer = 200;
            this.scan(this.scene.cameras.main.worldView);
        }
        this.process(FRAME_BUDGET_MS);
    }

    /** Synchronously bake everything around `view` (used behind the loading screen). */
    primeAround(view: Geom.Rectangle): void {
        // Plan every island now (~40ms total) so no plan is built mid-voyage.
        for (const island of this.islands) this.artFor(island);
        this.scan(view);
        this.process(Infinity);
    }

    destroy(): void {
        for (const key of [...this.loaded.keys()]) this.unload(key);
        this.queue = [];
        this.queued.clear();
        this.life.destroyAll();
    }
}
