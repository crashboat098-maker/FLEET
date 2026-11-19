import { Scene } from 'phaser';
import { Palette } from '../config/palette';
import { createRng, textureFromRows } from './pixelCanvas';
import { Raster } from './Raster';

/**
 * Original pixel art for combat, sea creatures, treasure, shipwrecks and the
 * tiered port buildings.
 */
export const CombatTextures = {
    Ball: 'cannonball',
    Flash: 'fx-flash',
    SharkFin: 'shark-fin',
    SharkShadow: 'shark-shadow',
    SharkBody: 'shark-body',
    SerpentHead: 'serpent-head',
    SerpentSeg: 'serpent-seg',
    KrakenHead: 'kraken-head',
    KrakenSeg: 'kraken-seg',
    KrakenTip: 'kraken-tip',
    Wreck: 'wreck',
    Coins: 'coins',
    Tower: 'port-tower',
    AwningA: 'port-awning-a',
    AwningB: 'port-awning-b',
    Warehouse: 'port-warehouse',
    SkullFlag: 'port-skullflag',
    Torch: 'port-torch',
    Cannon: 'port-cannon'
} as const;

const disc = (key: string, scene: Scene, size: number, paint: (r: Raster, d: number, x: number, y: number) => void) => {
    const r = new Raster(size, size);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) paint(r, Math.hypot(x - c, y - c) / (c + 0.5), x, y);
    r.toTexture(scene, key);
};

export const generateCombatTextures = (scene: Scene): void => {
    const K = CombatTextures;
    textureFromRows(scene, K.Ball, ['.#.', '###', '.#.'], { '#': Palette.ink });
    textureFromRows(scene, K.Flash, ['..y..', '.yWy.', 'yWWWy', '.yWy.', '..y..'], { y: 0xffb347, W: 0xfff4c0 });

    // Shark: a dorsal fin cutting the water above a dark body shadow.
    textureFromRows(scene, K.SharkFin, ['..#.', '.##.', '.###', '####', 'ffff'], { '#': 0x4a5560, f: Palette.foamWhite });
    const shadow = new Raster(22, 8);
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 22; x++) {
            const d = ((x - 9) / 11) ** 2 + ((y - 3.5) / 3.5) ** 2;
            if (d < 1 || (x > 17 && Math.abs(y - 3.5) < (x - 16) * 0.8 && x < 22)) shadow.set(x, y, 0x0b2a4a, 0.55);
        }
    shadow.toTexture(scene, K.SharkShadow);
    // Surfaced shark seen from above: head (and eyes) to the right, forked tail left, pectoral fins.
    textureFromRows(
        scene,
        K.SharkBody,
        [
            'o...........oo........',
            'oo.........ooo........',
            '.oo....oooooooooooo...',
            '..ooooGGGGGGGGGGGGGoo.',
            '...oGGLLLLLLLLLLLGGGeo',
            '..ooooGGGGGGGGGGGGGoo.',
            '.oo....oooooooooooo...',
            'oo.........ooo........',
            'o...........oo........'
        ],
        { o: 0x3a4752, G: 0x8697a3, L: 0x6a7a86, e: 0x101010 }
    );

    // Sea serpent: armoured head with glowing eyes, scaled body segments.
    textureFromRows(
        scene,
        K.SerpentHead,
        ['..ooo..', '.oGGGo.', 'oGyGyGo', 'oGGGGGo', 'oGgGgGo', '.oGGGo.', '.oGGGo.', '..ogo..'],
        { o: 0x0f3b33, G: 0x2e8b6e, g: 0x5fd0a8, y: 0xffd23f }
    );
    disc(K.SerpentSeg, scene, 9, (r, d, x, y) => {
        if (d > 1) return;
        r.set(x, y, d > 0.8 ? 0x0f3b33 : (x + y) % 3 === 0 ? 0x5fd0a8 : 0x2e8b6e);
    });

    // Kraken: a huge mottled dome with two eyes, and suckered tentacle segments.
    const KH = 44;
    const head = new Raster(KH, 36);
    const rng = createRng(77);
    for (let y = 0; y < 36; y++)
        for (let x = 0; x < KH; x++) {
            const d = ((x - 21.5) / 21.5) ** 2 + ((y - 18) / 18) ** 2;
            if (d > 1) continue;
            let c = d > 0.85 ? 0x2a1236 : (x - y) % 7 === 0 ? 0x8a3fa8 : 0x5e2a78;
            if (rng() < 0.05) c = 0xb06ad8;
            head.set(x, y, c);
        }
    for (const ex of [13, 30]) {
        head.rect(ex - 3, 22, 7, 5, 0xffe27a).rect(ex - 1, 23, 3, 3, Palette.ink);
    }
    head.toTexture(scene, K.KrakenHead);
    disc(K.KrakenSeg, scene, 11, (r, d, x, y) => {
        if (d > 1) return;
        r.set(x, y, d > 0.82 ? 0x2a1236 : d < 0.35 && (x + y) % 2 === 0 ? 0xd8a0e8 : 0x6e3290);
    });
    disc(K.KrakenTip, scene, 7, (r, d, x, y) => d <= 1 && r.set(x, y, d > 0.75 ? 0x2a1236 : 0x8a3fa8));

    // Shipwreck: broken hull listing in the shallows with a snapped mast.
    const wreck = new Raster(40, 22);
    for (let y = 0; y < 22; y++)
        for (let x = 0; x < 40; x++) {
            const d = ((x - 19) / 19) ** 2 + ((y - 11) / 9) ** 2;
            if (d > 1) continue;
            const broken = x > 26 && (x + y * 2) % 5 < 2;
            if (broken) continue;
            wreck.set(x, y, d > 0.75 ? Palette.woodDeep : y % 3 === 0 ? Palette.woodDark : 0x6a4a2a);
        }
    for (let i = 0; i < 16; i++) wreck.set(8 + i, 4 + Math.floor(i * 0.6), Palette.woodDeep);
    wreck.rect(10, 13, 8, 2, Palette.sailShade, 0.8);
    wreck.toTexture(scene, K.Wreck);

    // A small pile of gold coins.
    textureFromRows(scene, K.Coins, ['..Y.Y..', '.YgYgY.', 'YgYgYgY', '.oYoYo.'], { Y: Palette.gold, g: 0xffe27a, o: Palette.goldShade });

    // ---- Port tier buildings
    disc(K.Tower, scene, 17, (r, d, x, y) => {
        if (d > 1) return;
        let c = d > 0.86 ? 0x3a3a44 : (Math.floor(Math.atan2(y - 8, x - 8) * 3) + Math.floor(d * 4)) % 2 ? 0x8a8c98 : 0x75778a;
        if (d < 0.35) c = 0x4f5160;
        r.set(x, y, c);
    });
    const awning = (key: string, a: number, b: number) =>
        textureFromRows(scene, key, ['oooooooooo', 'oababababo', 'oababababo', 'oababababo', 'oooooooooo', '.d......d.'], {
            o: Palette.woodDeep,
            a,
            b,
            d: Palette.woodDark
        });
    awning(K.AwningA, Palette.flagRed, Palette.cream);
    awning(K.AwningB, 0x2e7d7a, Palette.cream);
    const wh = new Raster(34, 16);
    wh.rect(2, 2, 32, 14, Palette.ink, 0.35).rect(0, 0, 32, 14, 0x3a2a1a).rect(1, 1, 30, 6, 0x8a5a3a).rect(1, 7, 30, 6, 0x6a4028).rect(1, 6, 30, 1, Palette.woodDeep);
    for (let x = 3; x < 31; x += 4) wh.rect(x, 1, 1, 12, 0x5a3a20, 0.6);
    wh.toTexture(scene, K.Warehouse);
    textureFromRows(scene, K.SkullFlag, ['.kkkk', '.kwwk', '.kwkk', '.kkkk', '.d...', '.d...', '.d...', 'ddd..'], { k: Palette.ink, w: Palette.foamWhite, d: Palette.woodDeep });
    textureFromRows(scene, K.Torch, ['.d.', 'ddd', '.d.'], { d: Palette.woodDeep });
    textureFromRows(scene, K.Cannon, ['..rr..', '.rkkr.', 'rkkkkr', '.rkkr.', '..kk..', '..kk..', '..kk..'], { r: Palette.woodDark, k: 0x3a3a44 });
};
