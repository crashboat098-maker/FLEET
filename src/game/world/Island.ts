/**
 * Island shape model shared by rendering, collision and the minimap.
 *
 * An island is a union of "blobs". Each blob is a star-shaped polygon whose
 * radius varies with angle (a sum of sine harmonics), giving natural,
 * irregular coastlines. Radii are pre-baked into a lookup table so queries
 * are a sqrt + atan2 + array read.
 */

const LUT_SIZE = 256;
const TWO_PI = Math.PI * 2;

export interface Harmonic {
    k: number;
    amp: number;
    phase: number;
}

export class Blob {
    readonly maxRadius: number;
    private readonly lut: Float32Array;

    constructor(
        readonly x: number,
        readonly y: number,
        radius: number,
        harmonics: Harmonic[]
    ) {
        this.lut = new Float32Array(LUT_SIZE);
        let max = 0;
        for (let i = 0; i < LUT_SIZE; i++) {
            const a = (i / LUT_SIZE) * TWO_PI;
            let f = 1;
            for (const h of harmonics) f += h.amp * Math.sin(h.k * a + h.phase);
            const r = radius * Math.max(0.35, f);
            this.lut[i] = r;
            max = Math.max(max, r);
        }
        this.maxRadius = max;
    }

    /** Coastline radius in the direction of angle `a` (radians), linearly interpolated. */
    radiusAt(a: number): number {
        // `a` comes from atan2, so it's in [-PI, PI].
        let t = (a / TWO_PI) * LUT_SIZE;
        if (t < 0) t += LUT_SIZE;
        if (t >= LUT_SIZE) t -= LUT_SIZE;
        const i = t | 0;
        const f = t - i;
        return this.lut[i] * (1 - f) + this.lut[(i + 1) % LUT_SIZE] * f;
    }

    /** Approximate signed distance to coastline: negative = on land. */
    edge(px: number, py: number): number {
        const dx = px - this.x;
        const dy = py - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-3) return -this.radiusAt(0);
        return d - this.radiusAt(Math.atan2(dy, dx));
    }
}

export type IslandSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

/** Visual / thematic island type. Each kind has its own terrain and landmarks. */
export type IslandKind = 'tropical' | 'basic' | 'jungle' | 'volcanic' | 'skull';

export class Island {
    /** Bounding circle (land only). */
    readonly boundRadius: number;

    constructor(
        readonly id: number,
        readonly name: string,
        readonly x: number,
        readonly y: number,
        readonly size: IslandSize,
        readonly blobs: Blob[],
        readonly seed: number,
        readonly kind: IslandKind = 'tropical'
    ) {
        let r = 0;
        for (const b of blobs) r = Math.max(r, Math.hypot(b.x - x, b.y - y) + b.maxRadius);
        this.boundRadius = r;
    }

    /**
     * Signed coastline distance for the union of blobs (min over blobs).
     * Results above `limit` are clamped to `limit`, which lets far-away
     * blobs be skipped without the costly angle lookup.
     */
    edge(px: number, py: number, limit = Infinity): number {
        let best = limit;
        for (const b of this.blobs) {
            const dx = px - b.x;
            const dy = py - b.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            // Lower bound on this blob's edge distance; skip if it can't win.
            if (d - b.maxRadius >= best) continue;
            const e = d < 1e-3 ? -b.radiusAt(0) : d - b.radiusAt(Math.atan2(dy, dx));
            if (e < best) best = e;
        }
        return best;
    }

    /** Cheap reject: is the point within `pad` of this island's bounding circle? */
    near(px: number, py: number, pad = 0): boolean {
        const r = this.boundRadius + pad;
        const dx = px - this.x;
        const dy = py - this.y;
        return dx * dx + dy * dy <= r * r;
    }

    isLand(px: number, py: number): boolean {
        return this.near(px, py) && this.edge(px, py) < 0;
    }

    /**
     * March outward from the island centre along `angle` until we reach water.
     * Returns the first coastline point.
     */
    coastPoint(angle: number): { x: number; y: number } {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        let d = 0;
        while (d < this.boundRadius + 10 && this.edge(this.x + dx * d, this.y + dy * d) < 0) d += 2;
        return { x: this.x + dx * d, y: this.y + dy * d };
    }
}
