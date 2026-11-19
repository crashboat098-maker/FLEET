import { GameObjects, Input, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_TITLE, GAME_WIDTH, SceneKeys } from '../config/constants';
import { Palette } from '../config/palette';
import { FontKey, Fonts, pixelText } from '../gfx/pixelFont';
import type { MapMarker } from '../ai/Director';
import { SHIP_CLASSES } from '../ships/shipClasses';
import type { GunPosition } from '../entities/PlayerShip';
import { PlayerState, StateEvents } from '../state/PlayerState';
import { hudPanel } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';
import { REGIONS, RegionId } from '../world/regions';
import { MINIMAP_SIZE } from '../world/terrainTextures';
import { WorldData } from '../world/WorldGenerator';

/** Ships per page in the read-only fleet overview (TAB). */
const FLEET_PAGE = 10;

/** What the HUD needs to know about the flagship each frame. */
export interface HudShipView {
    x: number;
    y: number;
    abilityStatus(): { text: string; ready: boolean };
    /** 0..1 reload progress (1 = ready) for port (-1), starboard (1), bow or stern. */
    reload(gun: GunPosition): number;
    /** Which chaser guns the flagship has (from Cannons upgrades). */
    chasers(): { bow: boolean; stern: boolean };
}

export interface HudSceneData {
    state: PlayerState;
    world: WorldData;
    minimapKey: string;
    getShip: () => HudShipView | null;
    getMarkers: () => MapMarker[];
    getBoss: () => { name: string; ratio: number } | null;
}

const BAR_W = 126;
const MAX_MARKERS = 40;

/**
 * Screen-space HUD: captain progress, flagship stats, chart with markers,
 * missions, cannon reloads, ability, docking, region banners, boss bar,
 * rewards, level-up celebration and a read-only fleet overview.
 */
export class HudScene extends Scene {
    private data_!: HudSceneData;
    private lines: Record<string, GameObjects.BitmapText> = {};
    private hullBar!: GameObjects.Rectangle;
    private xpBar!: GameObjects.Rectangle;
    private toastText!: GameObjects.BitmapText;
    private dockGroup!: GameObjects.Container;
    private dockLabel!: GameObjects.BitmapText;
    private dockBtn!: PixelButton;
    private progressGroup!: GameObjects.Container;
    private progressBar!: GameObjects.Rectangle;
    private progressBg!: GameObjects.Rectangle;
    private abilityName!: GameObjects.BitmapText;
    private abilityStatus!: GameObjects.BitmapText;
    private reloadBars: Record<'port' | 'starboard' | 'bow' | 'stern', GameObjects.Rectangle> = {} as never;
    /** Bow / stern rows (shown once the flagship has those guns). */
    private chaserRows: Record<'bow' | 'stern', GameObjects.GameObject[]> = { bow: [], stern: [] };
    private chaserPanel!: GameObjects.Image;
    private mapDot!: GameObjects.Rectangle;
    private markerPool: GameObjects.Rectangle[] = [];
    private mapOrigin = { x: 0, y: 0 };
    private missionText: GameObjects.BitmapText[] = [];
    private missionPanel!: GameObjects.Image;
    private banner!: GameObjects.Container;
    private bannerTitle!: GameObjects.BitmapText;
    private bannerSub!: GameObjects.BitmapText;
    private bossGroup!: GameObjects.Container;
    private bossName!: GameObjects.BitmapText;
    private bossBar!: GameObjects.Rectangle;
    private fleetPanel!: GameObjects.Container;
    private fleetPage = 0;
    private elapsed = 0;
    private markerTimer = 0;
    private rewardY = 0;

    constructor() {
        super(SceneKeys.Hud);
    }

    init(data: HudSceneData): void {
        this.data_ = data;
        this.markerPool = [];
        this.missionText = [];
    }

    create(): void {
        const { state, world } = this.data_;

        // --- Captain plate (top-left)
        this.add.image(4, 4, hudPanel(this, 140, 110)).setOrigin(0);
        pixelText(this, 10, 10, GAME_TITLE, Fonts.Gold).setOrigin(0);
        this.lines.level = pixelText(this, 138, 10, '', Fonts.Gold).setOrigin(1, 0);
        this.add.rectangle(10, 20, BAR_W, 4, Palette.shadow).setOrigin(0).setStrokeStyle(1, Palette.woodDeep);
        this.xpBar = this.add.rectangle(10, 20, BAR_W, 4, 0xb06ad8).setOrigin(0);
        const line = (key: string, y: number) => (this.lines[key] = pixelText(this, 10, y, '', Fonts.Cream).setOrigin(0));
        line('captain', 28);
        line('ship', 38);
        line('hull', 48);
        this.add.rectangle(10, 58, BAR_W, 5, Palette.shadow).setOrigin(0).setStrokeStyle(1, Palette.woodDeep);
        this.hullBar = this.add.rectangle(10, 58, BAR_W, 5, 0x8fe07a).setOrigin(0);
        line('cargo', 66);
        line('gold', 76);
        line('mats', 87);
        line('fleet', 97);

        // --- Chart (top-right)
        const mm = MINIMAP_SIZE;
        const mx = GAME_WIDTH - mm - 8;
        const my = 8;
        this.mapOrigin = { x: mx, y: my };
        this.add.image(mx - 4, my - 4, hudPanel(this, mm + 8, mm + 8)).setOrigin(0);
        this.add.image(mx, my, this.data_.minimapKey).setOrigin(0);
        const scale = mm / world.size;
        for (const port of world.ports) {
            const p = port.dockEnd;
            this.add.rectangle(mx + p.x * scale, my + p.y * scale, 3, 3, Palette.gold).setStrokeStyle(1, Palette.woodDeep);
        }
        for (let i = 0; i < MAX_MARKERS; i++) this.markerPool.push(this.add.rectangle(0, 0, 2, 2, 0xffffff).setVisible(false));
        this.mapDot = this.add.rectangle(mx, my, 3, 3, Palette.flagRed).setStrokeStyle(1, Palette.foamWhite);
        pixelText(this, mx + mm / 2, my + mm + 9, 'CHART', Fonts.Cream).setAlpha(0.8);

        // --- Mission tracker (under the chart)
        this.missionPanel = this.add.image(GAME_WIDTH - 4, my + mm + 18, hudPanel(this, 232, 40)).setOrigin(1, 0);
        for (let i = 0; i < 3; i++) this.missionText.push(pixelText(this, GAME_WIDTH - 230, my + mm + 25 + i * 11, '', Fonts.Cream).setOrigin(0, 0));

        // --- Weapons (bottom-right): reload bars + ability
        const wx = GAME_WIDTH - 206;
        const wy = GAME_HEIGHT - 26;
        this.add.image(wx, wy, hudPanel(this, 120, 36));
        pixelText(this, wx - 52, wy - 7, 'PORT', Fonts.Cream).setOrigin(0, 0.5);
        pixelText(this, wx - 52, wy + 7, 'STBD', Fonts.Cream).setOrigin(0, 0.5);
        for (const [side, y] of [['port', wy - 7], ['starboard', wy + 7]] as const) {
            this.add.rectangle(wx - 22, y, 74, 5, Palette.shadow).setOrigin(0, 0.5).setStrokeStyle(1, Palette.woodDeep);
            this.reloadBars[side] = this.add.rectangle(wx - 22, y, 74, 5, Palette.gold).setOrigin(0, 0.5);
        }
        // Bow / stern chasers sit in a panel just above, shown once unlocked.
        const cy = wy - 38;
        this.chaserPanel = this.add.image(wx, cy, hudPanel(this, 120, 36)).setVisible(false);
        for (const [gun, y, label] of [['bow', cy - 7, 'BOW'], ['stern', cy + 7, 'STRN']] as const) {
            const t = pixelText(this, wx - 52, y, label, Fonts.Cream).setOrigin(0, 0.5);
            const bg = this.add.rectangle(wx - 22, y, 74, 5, Palette.shadow).setOrigin(0, 0.5).setStrokeStyle(1, Palette.woodDeep);
            this.reloadBars[gun] = this.add.rectangle(wx - 22, y, 74, 5, Palette.gold).setOrigin(0, 0.5);
            this.chaserRows[gun] = [t, bg, this.reloadBars[gun]];
            this.chaserRows[gun].forEach((o) => (o as GameObjects.Image).setVisible(false));
        }
        const ax = GAME_WIDTH - 72;
        const abilityBg = this.add.image(ax, wy, hudPanel(this, 136, 36));
        abilityBg.setInteractive({ useHandCursor: true }).on('pointerup', () => state.emit(StateEvents.AbilityRequest));
        this.abilityName = pixelText(this, ax, wy - 7, '', Fonts.Gold);
        this.abilityStatus = pixelText(this, ax, wy + 6, '', Fonts.Cream);

        // --- Control hints (bottom-left, two lines)
        const h1 = 'WASD/CLICK: SAIL   Z/C: BROADSIDES   X/V: BOW/STERN   Q: ABILITY';
        const h2 = 'RIGHT-CLICK: FIRE AT CURSOR   E: DOCK   F: FORMATION   TAB: FLEET   ESC: MENU';
        this.add.image(4, GAME_HEIGHT - 28, hudPanel(this, Math.max(h1.length, h2.length) * 6 + 10, 24)).setOrigin(0).setAlpha(0.85);
        pixelText(this, 9, GAME_HEIGHT - 25, h1, Fonts.Cream).setOrigin(0);
        pixelText(this, 9, GAME_HEIGHT - 15, h2, Fonts.Cream).setOrigin(0);

        // --- Toast, region banner, boss bar
        this.toastText = pixelText(this, GAME_WIDTH / 2, 112, '', Fonts.Gold, 2).setAlpha(0);
        this.bannerTitle = pixelText(this, 0, 0, '', Fonts.Gold, 3);
        this.bannerSub = pixelText(this, 0, 22, '', Fonts.Cream);
        this.banner = this.add.container(GAME_WIDTH / 2, 56, [this.bannerTitle, this.bannerSub]).setAlpha(0);
        this.bossName = pixelText(this, 0, -8, '', Fonts.Red);
        const bossBg = this.add.rectangle(0, 2, 202, 7, Palette.shadow).setStrokeStyle(1, Palette.woodDeep);
        this.bossBar = this.add.rectangle(-100, 2, 200, 5, 0xff4a3a).setOrigin(0, 0.5);
        this.bossGroup = this.add.container(GAME_WIDTH / 2, 20, [this.bossName, bossBg, this.bossBar]).setVisible(false);

        // --- Dock button (bottom-centre), only inside a port's radius
        this.dockLabel = pixelText(this, 0, -20, '', Fonts.Gold);
        this.dockBtn = new PixelButton(this, 0, 0, 'DOCK AT PORT (E)', () => state.emit(StateEvents.DockRequest), { labelScale: 1, width: 170 });
        // Salvage progress bar (shown while working a wreck).
        this.progressBar = this.add.rectangle(-80, 26, 160, 5, Palette.gold).setOrigin(0, 0.5);
        this.progressBg = this.add.rectangle(0, 26, 162, 7, Palette.shadow).setStrokeStyle(1, Palette.woodDeep);
        this.dockGroup = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 70, [this.dockLabel, this.dockBtn]).setVisible(false);
        this.progressGroup = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 96, [this.progressBg, this.progressBar]).setVisible(false);

        // --- Fleet overview (TAB)
        this.fleetPanel = this.add.container(0, 0).setVisible(false).setDepth(50);
        this.input.keyboard?.on('keydown-TAB', (e: KeyboardEvent) => {
            e.preventDefault?.();
            this.toggleFleet();
        });

        // --- Wire up state
        const handlers: [string, (...a: never[]) => void][] = [
            [StateEvents.Changed, () => this.refresh()],
            [StateEvents.Toast, (msg: string) => this.showToast(msg)],
            [StateEvents.Prompt, (msg: string | null) => this.showPrompt(msg)],
            [StateEvents.RegionEntered, (id: RegionId, first: boolean) => this.showRegion(id, first)],
            [StateEvents.LevelUp, (lvl: number) => this.celebrate(lvl)],
            [StateEvents.Reward, (r: { gold: number; xp: number }) => this.popReward(r)]
        ];
        handlers.forEach(([ev, fn]) => state.on(ev, fn));
        this.events.once('shutdown', () => handlers.forEach(([ev, fn]) => state.off(ev, fn)));
        this.refresh();
        this.showPrompt(state.currentPrompt);
    }

    /** Fill a progress bar over `ms` (salvaging). */
    showProgress(ms: number): void {
        this.progressGroup.setVisible(true);
        this.progressBar.width = 0;
        this.tweens.add({ targets: this.progressBar, width: 160, duration: ms, onComplete: () => this.progressGroup.setVisible(false) });
    }

    /** True if the pointer is over any interactive HUD element (so the ocean ignores the click). */
    isPointerOverUI(pointer: Input.Pointer): boolean {
        return this.input.hitTestPointer(pointer).length > 0;
    }

    private refresh(): void {
        const s = this.data_.state;
        const sunk = !s.seaworthy;
        const xp = s.xpInfo;
        this.lines.level.setText(`CAPTAIN LV ${xp.level}`);
        this.xpBar.width = Math.max(1, Math.round(BAR_W * (xp.into / xp.need)));
        this.lines.captain.setText(`CAPT. ${s.captain}`);
        const cls = s.active ? SHIP_CLASSES[s.active.cls].name : '';
        this.lines.ship.setText(`${s.shipName}${sunk ? ' (SUNK)' : ` - ${cls}`}`);
        this.lines.hull.setText(`HULL: ${s.hull}/${s.hullMax}`);
        this.lines.cargo.setText(`CARGO: ${s.cargo.length}/${s.cargoCapacity}`);
        this.lines.gold.setText(`GOLD: ${s.gold}`);
        this.lines.fleet.setText(`ESCORTS ${s.escorts.length}/${s.escortSlots}  ${s.formation.toUpperCase()}`);
        this.lines.mats.setText(`WOOD ${s.materialCount('wood')}  IRON ${s.materialCount('iron')}  CLOTH ${s.materialCount('cloth')}`);
        this.lines.cargo.setFont(s.cargoFull ? Fonts.Gold : Fonts.Cream);
        this.lines.hull.setFont(s.damageLevel >= 3 || sunk ? Fonts.Red : Fonts.Cream);
        const ratio = Math.max(0, s.hull / Math.max(1, s.hullMax));
        this.hullBar.width = Math.max(0, Math.round(BAR_W * ratio));
        this.hullBar.fillColor = ratio > 0.5 ? 0x8fe07a : ratio > 0.25 ? Palette.gold : 0xff6b5a;
        this.abilityName.setText(s.active ? SHIP_CLASSES[s.active.cls].ability.name : '');

        const ms = s.missions;
        this.missionPanel.setVisible(ms.length > 0).setDisplaySize(232, 10 + ms.length * 11);
        this.missionText.forEach((t, i) => {
            const m = ms[i];
            if (!m) return t.setText('');
            const title = m.title.length > 30 ? `${m.title.slice(0, 29)}.` : m.title;
            t.setText(`${title} ${m.progress}/${m.count}`).setFont(m.progress >= m.count ? Fonts.Green : Fonts.Cream);
        });
        if (this.fleetPanel.visible) this.buildFleet();
    }

    private showToast(msg: string): void {
        this.tweens.killTweensOf(this.toastText);
        this.toastText.setText(msg.toUpperCase()).setAlpha(1).setY(112);
        this.tweens.add({ targets: this.toastText, alpha: 0, y: 104, delay: 1700, duration: 500 });
    }

    private showPrompt(msg: string | null): void {
        this.dockGroup.setVisible(!!msg);
        if (!msg) return;
        // "LABEL|BUTTON" — e.g. "DRIFTWOOD COVE|DOCK AT PORT (E)" or "SUNKEN GALLEON|SALVAGE (E)".
        const [label, button] = msg.split('|');
        this.dockLabel.setText(label.toUpperCase());
        this.dockBtn.setLabel(button ?? 'DOCK AT PORT (E)');
    }

    private showRegion(id: RegionId, first: boolean): void {
        const r = REGIONS[id];
        this.bannerTitle.setText(r.name);
        this.bannerSub.setText(first ? `NEW REGION DISCOVERED - ${r.tagline}` : r.tagline);
        this.tweens.killTweensOf(this.banner);
        this.banner.setAlpha(0).setY(48);
        this.tweens.add({ targets: this.banner, alpha: 1, y: 56, duration: 600, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: this.banner, alpha: 0, delay: 3200, duration: 800 });
    }

    private popReward(r: { gold: number; xp: number }): void {
        const parts = [r.gold ? `+${r.gold} GOLD` : '', r.xp ? `+${r.xp} XP` : ''].filter(Boolean).join('  ');
        if (!parts) return;
        this.rewardY = (this.rewardY + 1) % 4;
        const t = pixelText(this, 150, 30 + this.rewardY * 11, parts, r.gold ? Fonts.Gold : Fonts.Green).setOrigin(0, 0.5);
        this.tweens.add({ targets: t, x: 160, alpha: 0, delay: 1200, duration: 600, onComplete: () => t.destroy() });
    }

    /** Short level-up celebration: big banner, sparkle burst. */
    private celebrate(level: number): void {
        const cx = GAME_WIDTH / 2;
        const cy = GAME_HEIGHT / 2 - 40;
        const big = pixelText(this, cx, cy, 'LEVEL UP!', Fonts.Title, 4).setScale(0.5);
        const sub = pixelText(this, cx, cy + 28, `CAPTAIN LEVEL ${level}`, Fonts.Gold, 2).setAlpha(0);
        this.tweens.add({ targets: big, scale: 4, duration: 450, ease: 'Back.easeOut' });
        this.tweens.add({ targets: sub, alpha: 1, delay: 250, duration: 300 });
        const burst = this.add.particles(cx, cy, 'sparkle', { speed: { min: 60, max: 180 }, lifespan: 1100, scale: { start: 2, end: 0.5 }, alpha: { start: 1, end: 0 }, tint: [0xf7c843, 0xffffff, 0xb06ad8], emitting: false });
        burst.explode(40);
        this.time.delayedCall(2400, () => {
            this.tweens.add({ targets: [big, sub], alpha: 0, duration: 400, onComplete: () => [big, sub].forEach((o) => o.destroy()) });
            burst.destroy();
        });
    }

    // ------------------------------------------------------------- fleet

    /** TAB opens the overview, then flips through its pages, then closes it. */
    private toggleFleet(): void {
        const pages = Math.max(1, Math.ceil(this.data_.state.ships.length / FLEET_PAGE));
        if (!this.fleetPanel.visible) {
            this.fleetPage = 0;
            this.fleetPanel.setVisible(true);
        } else if (this.fleetPage < pages - 1) this.fleetPage++;
        else this.fleetPanel.setVisible(false);
        if (this.fleetPanel.visible) this.buildFleet();
    }

    /** Read-only overview of every owned ship (manage them at a port). */
    private buildFleet(): void {
        const s = this.data_.state;
        this.fleetPanel.removeAll(true);
        const pages = Math.max(1, Math.ceil(s.ships.length / FLEET_PAGE));
        this.fleetPage = Math.min(this.fleetPage, pages - 1);
        const ships = s.ships.slice(this.fleetPage * FLEET_PAGE, (this.fleetPage + 1) * FLEET_PAGE);
        const w = 500;
        const h = 58 + Math.max(1, ships.length) * 14;
        const x0 = GAME_WIDTH / 2 - w / 2;
        const y0 = 110;
        const add = (x: number, y: number, t: string, f: FontKey = Fonts.Cream, originX = 0) => this.fleetPanel.add(pixelText(this, x, y, t, f).setOrigin(originX, 0.5));
        this.fleetPanel.add(this.add.image(x0, y0, hudPanel(this, w, h)).setOrigin(0));
        this.fleetPanel.add(pixelText(this, GAME_WIDTH / 2, y0 + 12, `YOUR FLEET - ${s.ships.length} SHIP${s.ships.length === 1 ? '' : 'S'} (READ-ONLY - MANAGE AT PORTS)`, Fonts.Gold));
        const hy = y0 + 28;
        [['SHIP', 10], ['CLASS', 130], ['STATUS', 200], ['CARGO', 336], ['UPG', 400]].forEach(([t, x]) => this.fleetPanel.add(pixelText(this, x0 + (x as number), hy, t as string, Fonts.Gold).setOrigin(0, 0.5).setAlpha(0.7)));
        add(x0 + w - 10, hy, 'HULL', Fonts.Gold, 1);
        if (!ships.length) add(x0 + 10, y0 + 42, 'NO SHIPS YET - CHOOSE ONE AT PORT');
        const font = { active: Fonts.Green, escort: Fonts.Green, sunk: Fonts.Red, stored: Fonts.Cream, repair: Fonts.Gold } as const;
        ships.forEach((sh, i) => {
            const y = y0 + 42 + i * 14;
            const st = s.statsOf(sh);
            let status = sh.status === 'active' ? 'FLAGSHIP' : sh.status === 'repair' ? 'DRY DOCK' : sh.status.toUpperCase();
            if (sh.status === 'repair') {
                const left = Math.max(0, Math.ceil(((sh.repairUntil ?? 0) - Date.now()) / 1000));
                status += ` ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            }
            const dmg = sh.status !== 'sunk' && sh.status !== 'repair' && sh.hp < st.maxHp ? ' DAMAGED' : '';
            const upgrades = Object.values(sh.upgrades).reduce((a, b) => a + b, 0);
            add(x0 + 10, y, sh.name);
            this.fleetPanel.add(pixelText(this, x0 + 130, y, SHIP_CLASSES[sh.cls].name, Fonts.Cream).setOrigin(0, 0.5).setAlpha(0.8));
            add(x0 + 200, y, `${status}${dmg}`, font[sh.status]);
            add(x0 + 336, y, `${sh.cargo.length + sh.protectedCargo.length}/${st.cargo}`);
            add(x0 + 400, y, `${upgrades}`);
            add(x0 + w - 10, y, `${Math.ceil(sh.hp)}/${st.maxHp}`, Fonts.Cream, 1);
        });
        const foot = pages > 1 ? `PAGE ${this.fleetPage + 1}/${pages} - TAB: ${this.fleetPage < pages - 1 ? 'NEXT PAGE' : 'CLOSE'}` : 'TAB TO CLOSE';
        this.fleetPanel.add(pixelText(this, GAME_WIDTH / 2, y0 + h - 8, foot, Fonts.Cream).setAlpha(0.6));
    }

    // ------------------------------------------------------------- update

    update(_time: number, delta: number): void {
        this.elapsed += delta;
        const ship = this.data_.getShip();
        const scale = MINIMAP_SIZE / this.data_.world.size;
        if (ship) {
            this.mapDot.setPosition(Math.round(this.mapOrigin.x + ship.x * scale), Math.round(this.mapOrigin.y + ship.y * scale));
            this.mapDot.setVisible(Math.floor(this.elapsed / 400) % 3 !== 0);
            const st = ship.abilityStatus();
            this.abilityStatus.setText(st.text).setFont(st.ready ? Fonts.Green : Fonts.Cream);
            const has = ship.chasers();
            this.chaserPanel.setVisible(has.bow || has.stern);
            (['bow', 'stern'] as const).forEach((g) => this.chaserRows[g].forEach((o) => (o as GameObjects.Image).setVisible(has[g])));
            for (const [gun, key] of [[-1, 'port'], [1, 'starboard'], ['bow', 'bow'], ['stern', 'stern']] as const) {
                if ((key === 'bow' || key === 'stern') && !has[key]) continue;
                const r = ship.reload(gun);
                this.reloadBars[key].width = Math.max(1, 74 * r);
                this.reloadBars[key].fillColor = r >= 1 ? 0x8fe07a : Palette.gold;
            }
        }
        this.markerTimer -= delta;
        if (this.markerTimer <= 0) {
            this.markerTimer = 250;
            const markers = this.data_.getMarkers();
            this.markerPool.forEach((r, i) => {
                const m = markers[i];
                if (!m) return r.setVisible(false);
                const size = m.big ? 4 : 2;
                r.setPosition(Math.round(this.mapOrigin.x + m.x * scale), Math.round(this.mapOrigin.y + m.y * scale)).setSize(size, size).setFillStyle(m.color).setVisible(true);
                r.setOrigin(0.5);
            });
            const boss = this.data_.getBoss();
            this.bossGroup.setVisible(!!boss);
            if (boss) {
                this.bossName.setText(boss.name);
                this.bossBar.width = Math.max(0, 200 * boss.ratio);
            }
        }
        if (this.dockGroup.visible) this.dockLabel.setAlpha(0.7 + 0.3 * Math.sin(this.elapsed / 180));
    }
}
