import { Scene } from 'phaser';

/**
 * Fast CPU pixel buffer for procedural art. Writes go straight into an
 * ImageData array (no per-pixel canvas calls), then `toTexture` uploads once.
 */
export class Raster {
    readonly data: Uint8ClampedArray;
    private readonly img: ImageData;

    constructor(readonly w: number, readonly h: number) {
        this.img = new ImageData(w, h);
        this.data = this.img.data;
    }

    /** Overwrite a pixel (no bounds check — caller guarantees range). */
    set(x: number, y: number, color: number, alpha = 1): void {
        const i = (y * this.w + x) * 4;
        const d = this.data;
        d[i] = (color >> 16) & 255;
        d[i + 1] = (color >> 8) & 255;
        d[i + 2] = color & 255;
        d[i + 3] = (alpha * 255 + 0.5) | 0;
    }

    /** Alpha-composite a pixel over what's there; silently clips. */
    blend(x: number, y: number, color: number, alpha = 1): void {
        x |= 0;
        y |= 0;
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        if (alpha >= 1) {
            this.set(x, y, color, 1);
            return;
        }
        const i = (y * this.w + x) * 4;
        const d = this.data;
        const da = d[i + 3] / 255;
        const oa = alpha + da * (1 - alpha);
        if (oa <= 0) return;
        const mix = (src: number, dst: number) => (src * alpha + dst * da * (1 - alpha)) / oa;
        d[i] = mix((color >> 16) & 255, d[i]);
        d[i + 1] = mix((color >> 8) & 255, d[i + 1]);
        d[i + 2] = mix(color & 255, d[i + 2]);
        d[i + 3] = oa * 255;
    }

    rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): this {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.blend(xx, yy, color, alpha);
        return this;
    }

    disc(cx: number, cy: number, r: number, color: number, alpha = 1): this {
        const r2 = r * r;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx * dx + dy * dy <= r2) this.blend(x, y, color, alpha);
            }
        }
        return this;
    }

    /**
     * Upload the raw pixels straight to a texture — no canvas, no read-back.
     * Much cheaper than `toTexture`; used for streamed terrain tiles.
     */
    toTextureRaw(scene: Scene, key: string): void {
        if (scene.textures.exists(key)) scene.textures.remove(key);
        scene.textures.addUint8Array(key, new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.length), this.w, this.h);
    }

    /** Upload as a Phaser canvas texture (replacing any texture with this key). */
    toTexture(scene: Scene, key: string): void {
        const canvas = document.createElement('canvas');
        canvas.width = this.w;
        canvas.height = this.h;
        canvas.getContext('2d')!.putImageData(this.img, 0, 0);
        if (scene.textures.exists(key)) scene.textures.remove(key);
        scene.textures.addCanvas(key, canvas);
    }
}
