import { GameObjects, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, PIXEL_SCALE, SceneKeys, SPEED_CAP } from '../config/constants';
import { Palette } from '../config/palette';
import { Fonts, FontKey, pixelText } from '../gfx/pixelFont';
import { PortTextures } from '../gfx/portTextures';
import { generateOffers, MAX_ACTIVE_MISSIONS } from '../missions/missions';
import { Formation, OwnedShip } from '../ships/profile';
import { formatMaterials, ratings, SHIP_CLASSES, UPGRADE_ORDER, upgradeCost, upgradeMaterials, UPGRADES } from '../ships/shipClasses';
import { ITEM_ORDER, ITEMS } from '../state/items';
import { DRY_DOCK_MS, PlayerState } from '../state/PlayerState';
import { parchmentPanel } from '../ui/panels';
import { PixelButton } from '../ui/PixelButton';
import { PORT_TIERS, tierOf } from '../world/portTiers';
import { WorldData } from '../world/WorldGenerator';
import type { WorldFeatures } from '../world/worldFeatures';

export type PortTab = 'repair' | 'upgrades' | 'trading' | 'missions' | 'fleet' | 'shipyard';

export interface PortSceneData {
    state: PlayerState;
    world: WorldData;
    features: WorldFeatures;
    portName: string;
    portIndex: number;
    tab?: PortTab;
}

const PANEL_W = 740;
const PANEL_H = 412;
const TAB_W = 98;
const TAB_GAP = 4;
const TABS: { id: PortTab | 'leave'; label: string }[] = [
    { id: 'repair', label: 'REPAIR' },
    { id: 'upgrades', label: 'UPGRADES' },
    { id: 'trading', label: 'TRADING' },
    { id: 'missions', label: 'MISSIONS' },
    { id: 'fleet', label: 'FLEET' },
    { id: 'shipyard', label: 'SHIPYARD' },
    { id: 'leave', label: 'LEAVE PORT' }
];

/**
 * Harbour menu (the ocean is paused underneath). Every action is a real,
 * gold-backed transaction validated by PlayerState. What's on offer depends
 * on the port's tier; lower tiers keep their own advantages.
 */
export class PortScene extends Scene {
    private data_!: PortSceneData;
    private tab: PortTab = 'repair';
    private content!: GameObjects.Container;
    private message!: GameObjects.BitmapText;
    private goldText!: GameObjects.BitmapText;
    private tabMarker!: GameObjects.Rectangle;
    private leaveBtn!: PixelButton;
    private closing = false;
    private left = 0;
    private top = 0;

    constructor() {
        super(SceneKeys.Port);
    }

    init(data: PortSceneData): void {
        this.data_ = data;
        this.tab = data.tab ?? 'repair';
        this.closing = false;
    }

    private get state(): PlayerState {
        return this.data_.state;
    }
    private get port(): number {
        return this.data_.portIndex;
    }

    create(): void {
        this.left = (GAME_WIDTH - PANEL_W) / 2;
        this.top = (GAME_HEIGHT - PANEL_H) / 2;
        const cx = GAME_WIDTH / 2;
        const tier = tierOf(this.port);

        this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, Palette.shadow, 0.6).setOrigin(0).setInteractive();
        this.add.image(cx, GAME_HEIGHT / 2, parchmentPanel(this, PANEL_W, PANEL_H));
        this.add.image(cx - 160, this.top + 20, PortTextures.Anchor).setScale(PIXEL_SCALE);
        this.add.image(cx + 160, this.top + 20, PortTextures.Anchor).setScale(PIXEL_SCALE);
        pixelText(this, cx, this.top + 18, this.data_.portName, Fonts.Ink, 2);
        pixelText(this, cx, this.top + 33, `TIER ${tier.tier} ${tier.title} - ${tier.advantage}`, Fonts.Ink).setAlpha(0.8);
        pixelText(this, this.left + 16, this.top + 18, `CAPT. ${this.state.captain}  LV ${this.state.level}`, Fonts.Ink).setOrigin(0, 0.5);
        this.goldText = pixelText(this, this.left + PANEL_W - 16, this.top + 18, '', Fonts.Ink).setOrigin(1, 0.5);

        const startX = cx - (TABS.length * TAB_W + (TABS.length - 1) * TAB_GAP) / 2 + TAB_W / 2;
        this.tabMarker = this.add.rectangle(0, this.top + 64, TAB_W - 8, 3, Palette.gold);
        TABS.forEach((t, i) => {
            const btn = new PixelButton(this, startX + i * (TAB_W + TAB_GAP), this.top + 51, t.label, () => (t.id === 'leave' ? this.leave() : this.show(t.id)), { labelScale: 1, width: TAB_W });
            if (t.id === 'leave') this.leaveBtn = btn;
        });

        this.content = this.add.container(0, 0);
        this.message = pixelText(this, cx, this.top + PANEL_H - 14, '', Fonts.Ink);
        this.show(this.tab);

        // Ignore the keypress that opened the port.
        this.time.delayedCall(250, () => {
            const kb = this.input.keyboard!;
            kb.on('keydown-ESC', () => this.leave());
            kb.on('keydown-E', () => this.leave());
        });
        // Dry-dock timers tick while the menu is open.
        this.time.addEvent({ delay: 1000, loop: true, callback: () => this.state.settleDryDock() && this.render() });
    }

    // ------------------------------------------------------------- framework

    private show(tab: PortTab): void {
        this.tab = tab;
        const i = TABS.findIndex((t) => t.id === tab);
        const startX = GAME_WIDTH / 2 - (TABS.length * TAB_W + (TABS.length - 1) * TAB_GAP) / 2 + TAB_W / 2;
        this.tabMarker.setX(startX + i * (TAB_W + TAB_GAP));
        this.render();
    }

    private render(): void {
        this.content.removeAll(true);
        this.goldText.setText(`GOLD: ${this.state.gold}`);
        this.leaveBtn.setEnabled(this.state.seaworthy);
        const r: Record<PortTab, () => void> = {
            repair: () => this.renderRepair(),
            upgrades: () => this.renderUpgrades(),
            trading: () => this.renderTrading(),
            missions: () => this.renderMissions(),
            fleet: () => this.renderFleet(),
            shipyard: () => this.renderShipyard()
        };
        r[this.tab]();
        if (!this.state.seaworthy && !this.message.text) this.say('NO SEAWORTHY FLAGSHIP: RECOVER ONE OR PICK ANOTHER IN FLEET');
    }

    private say(msg: string): void {
        this.message.setText(msg.toUpperCase()).setAlpha(1);
        this.tweens.killTweensOf(this.message);
        this.tweens.add({ targets: this.message, alpha: 0, delay: 3200, duration: 500, onComplete: () => this.message.setText('') });
    }

    private text(x: number, y: number, s: string, font: FontKey = Fonts.Ink, scale = 1, originX = 0): GameObjects.BitmapText {
        const t = pixelText(this, x, y, s, font, scale).setOrigin(originX, 0.5);
        this.content.add(t);
        return t;
    }

    private button(x: number, y: number, label: string, onClick: () => void, enabled = true, width = 112): PixelButton {
        const b = new PixelButton(this, x, y, label, onClick, { labelScale: 1, width });
        b.setEnabled(enabled);
        this.content.add(b);
        return b;
    }

    private shipIcon(x: number, y: number, ship: { cls: OwnedShip['cls'] }, dim = false): void {
        const img = this.add.image(x, y, `${ship.cls}-hull`).setAngle(90);
        if (dim) img.setTint(0x6a7f90).setAlpha(0.7);
        this.content.add(img);
    }

    private bar(x: number, y: number, w: number, ratio: number): void {
        const color = ratio > 0.5 ? 0x5cb85c : ratio > 0.25 ? Palette.goldShade : Palette.flagRed;
        this.content.add(this.add.rectangle(x, y, w, 6, Palette.sailShade).setOrigin(0, 0.5).setStrokeStyle(1, Palette.woodDeep));
        this.content.add(this.add.rectangle(x + 1, y, Math.max(0, (w - 2) * ratio), 4, color).setOrigin(0, 0.5));
    }

    private act(ok: boolean, success: string, failure: string): void {
        this.say(ok ? success : failure);
        this.render();
    }

    private get L(): number {
        return this.left + 26;
    }
    private get T(): number {
        return this.top + 84;
    }

    // ------------------------------------------------------------------ tabs

    private renderRepair(): void {
        const s = this.state;
        const L = this.L;
        let y = this.T;
        this.text(L, y, `SHIPWRIGHT - ${Math.round(tierOf(this.port).repairRate * 1.5 * 10) / 10} GOLD PER HULL POINT`, Fonts.Ink, 1);
        y += 18;
        const afloat = s.ships.filter((sh) => sh.status !== 'sunk');
        for (const ship of afloat.slice(0, 4)) {
            const max = s.statsOf(ship).maxHp;
            const q = s.repairQuote(ship, this.port);
            const cost = q.gold;
            this.shipIcon(L + 26, y + 6, ship);
            this.text(L + 62, y, `${ship.name} (${SHIP_CLASSES[ship.cls].name})${ship.status === 'active' ? ' FLAGSHIP' : ''}`);
            this.text(L + 62, y + 12, `HULL ${Math.ceil(ship.hp)}/${max}`);
            this.bar(L + 160, y + 12, 120, ship.hp / max);
            if (q.wood) this.text(L + 290, y + 12, `${q.wood} WOOD (${q.fromHold} OWN, ${q.bought} BOUGHT)`).setAlpha(0.8);
            if (ship.status === 'repair') {
                const left = Math.max(0, Math.ceil(((ship.repairUntil ?? 0) - Date.now()) / 1000));
                this.text(L + 540, y + 6, `UNDER REPAIR ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, Fonts.Ink, 1, 0.5);
            } else if (cost <= 0) this.text(L + 540, y + 6, 'FULLY REPAIRED', Fonts.Ink, 1, 0.5);
            else {
                this.button(L + 480, y + 6, `REPAIR ${cost}G`, () => this.act(s.repair(ship, this.port), 'REPAIRS COMPLETE', `NOT ENOUGH GOLD (NEED ${cost})`), s.gold >= cost, 118);
                if (ship.status === 'stored') {
                    const half = s.dryDockCost(ship, this.port);
                    this.button(L + 610, y + 6, `DRY DOCK ${half}G`, () => this.act(s.dryDock(ship, this.port), `DRY DOCK: READY IN ${DRY_DOCK_MS / 60000} MIN`, `NOT ENOUGH GOLD (NEED ${half})`), s.gold >= half, 128);
                }
            }
            y += 32;
        }
        y = Math.max(y + 4, this.T + 160);
        this.text(L, y, 'SHIP RECOVERY - SUNK SHIPS KEEP THEIR UPGRADES', Fonts.Ink, 1);
        y += 18;
        const sunk = s.ships.filter((sh) => sh.status === 'sunk');
        if (!sunk.length) this.text(L, y, 'NO SUNK SHIPS - YOUR WHOLE FLEET IS AFLOAT.');
        for (const ship of sunk.slice(0, 3)) {
            const cost = s.recoveryCost(ship);
            const free = s.freeTowAvailable(ship);
            const up = Object.values(ship.upgrades).reduce((a, b) => a + b, 0);
            this.shipIcon(L + 26, y + 6, ship, true);
            this.text(L + 62, y, `${ship.name} (${SHIP_CLASSES[ship.cls].name}) - SUNK`, Fonts.Red);
            this.text(L + 62, y + 12, `UPGRADES KEPT: ${up}   SAVED CARGO: ${ship.protectedCargo.length}   RETURNS AT 35% HULL`);
            this.button(L + 560, y + 6, free ? 'FREE TOW' : `RECOVER ${cost}G`, () => this.act(s.recover(ship), `${ship.name} RECOVERED`, `NOT ENOUGH GOLD (NEED ${cost})`), free || s.gold >= cost, 130);
            y += 32;
        }
    }

    private renderUpgrades(): void {
        const s = this.state;
        const ship = s.active;
        const L = this.L;
        let y = this.T;
        if (!ship || !s.seaworthy) {
            this.text(L, y, 'RECOVER OR SELECT A FLAGSHIP TO REFIT IT.');
            return;
        }
        const st = s.stats;
        const cap = tierOf(this.port).upgradeCap;
        this.text(L, y, `${ship.name} REFIT`, Fonts.Ink, 2);
        this.text(L + 250, y, `SPEED ${st.maxSpeed}/${SPEED_CAP}  TURN ${st.turnRate.toFixed(2)}  HULL ${st.maxHp}  HOLD ${st.cargo}  GUNS ${st.cannons}x${st.cannonDamage.toFixed(1)}`);
        y += 24;
        for (const id of UPGRADE_ORDER) {
            const def = UPGRADES[id];
            const lvl = ship.upgrades[id];
            const cost = upgradeCost(ship.cls, id, lvl);
            this.text(L, y, def.name);
            for (let i = 0; i < def.maxLevel; i++) {
                this.content.add(this.add.rectangle(L + 74 + i * 13, y, 9, 8, i < lvl ? Palette.gold : i < cap[id] ? Palette.sailShade : 0x9a8c78).setStrokeStyle(1, Palette.woodDeep));
            }
            const mats = upgradeMaterials(id, lvl);
            this.text(L + 134, y - 5, `TIER ${lvl}/${def.maxLevel}  NEXT: ${def.effect}`);
            if (cost !== null) this.text(L + 134, y + 6, `NEEDS ${cost}G + ${formatMaterials(mats)}`).setAlpha(0.75);
            if (cost === null) this.text(L + 580, y, 'MAXED', Fonts.Ink, 1, 0.5);
            else if (lvl >= cap[id]) {
                const where = Object.values(PORT_TIERS).find((t) => t.upgradeCap[id] > lvl);
                this.text(L + 580, y, where ? `TIER ${where.tier}+ PORT NEEDED` : 'NOT SOLD HERE', Fonts.Ink, 1, 0.5).setAlpha(0.65);
            } else {
                const short = s.missingMaterials(mats);
                this.button(L + 580, y, short ? `NEED ${short}` : `BUY ${cost}G`, () => this.act(s.buyUpgrade(id, this.port), `${def.name} UPGRADED TO TIER ${lvl + 1}`, short ? `MISSING ${short} - BUY OR SALVAGE IT` : `NOT ENOUGH GOLD (NEED ${cost})`), !short && s.gold >= cost, 130);
            }
            y += 34;
        }
        this.text(L, y - 6, 'UPGRADES ARE PERMANENT AND STAY WITH THE SHIP - EVEN IF IT SINKS. SPEED NEVER EXCEEDS 84.').setAlpha(0.7);
    }

    private renderTrading(): void {
        const s = this.state;
        const L = this.L;
        let y = this.T;
        this.text(L, y, `MARKET - ${tierOf(this.port).advantage}`, Fonts.Ink, 1);
        y += 22;
        for (const type of ITEM_ORDER) {
            const def = ITEMS[type];
            const held = s.cargo.filter((c) => c === type).length;
            const sell = s.sellPrice(type, this.port);
            const buy = s.buyPrice(type, this.port);
            this.content.add(this.add.image(L + 12, y, def.texture).setScale(PIXEL_SCALE));
            this.text(L + 34, y - 5, def.name);
            this.text(L + 34, y + 6, `IN HOLD: ${held}`);
            this.text(L + 170, y, `SELL ${sell}G`);
            this.button(L + 285, y, 'SELL 1', () => this.act(s.sell(type, this.port, 1) > 0, `SOLD ${def.name} FOR ${sell}G`, 'NONE IN THE HOLD'), held > 0, 84);
            this.button(L + 377, y, 'SELL ALL', () => {
                const n = s.sell(type, this.port, held);
                this.act(n > 0, `SOLD ${n} FOR ${n * sell}G`, 'NONE IN THE HOLD');
            }, held > 0, 84);
            if (buy === null) this.text(L + 560, y, 'NOT SOLD AT PORTS', Fonts.Ink, 1, 0.5).setAlpha(0.6);
            else this.button(L + 560, y, `BUY ${buy}G`, () => this.act(s.buy(type, this.port), `BOUGHT ${def.name}`, s.cargoFull ? 'CARGO HOLD IS FULL' : `NOT ENOUGH GOLD (NEED ${buy})`), s.seaworthy && !s.cargoFull && s.gold >= buy, 112);
            y += 36;
        }
        const parcels = s.cargo.filter((c) => c === 'parcel').length;
        this.text(L, y + 2, `CARGO ${s.cargo.length}/${s.cargoCapacity}${parcels ? `  (${parcels} MISSION PARCEL)` : ''}    GOLD ${s.gold}    EACH PORT HAS ITS OWN PRICES.`);
    }

    private renderMissions(): void {
        const s = this.state;
        const L = this.L;
        let y = this.T;
        this.text(L, y, `MISSION BOARD (ACTIVE ${s.missions.length}/${MAX_ACTIVE_MISSIONS})`, Fonts.Ink, 1);
        y += 18;
        const offers = generateOffers(this.data_.world, this.data_.features, this.port, s.profile.boardEpoch[this.port] ?? 0, s.profile.discoveredIslands, s.profile.missionSeq, s.profile.used);
        for (const m of offers) {
            const taken = s.missions.some((x) => x.id === m.id);
            this.text(L, y, m.title, Fonts.Ink);
            this.text(L, y + 11, m.detail.length > 70 ? `${m.detail.slice(0, 69)}.` : m.detail).setAlpha(0.75);
            this.text(L + 430, y + 5, `${m.reward.gold}G + ${m.reward.xp} XP${m.minLevel > 1 ? `  LV${m.minLevel}` : ''}`, Fonts.Ink, 1, 0);
            const err = s.level < m.minLevel ? `LV ${m.minLevel}` : null;
            this.button(L + 630, y + 5, taken ? 'TAKEN' : err ?? 'ACCEPT', () => {
                const why = s.acceptMission(m);
                this.act(!why, `ACCEPTED: ${m.title}`, why ?? '');
            }, !taken && !err && s.missions.length < MAX_ACTIVE_MISSIONS, 80);
            y += 30;
        }
        y += 6;
        this.text(L, y, 'ACTIVE MISSIONS', Fonts.Ink, 1);
        y += 16;
        if (!s.missions.length) this.text(L, y, 'NONE - ACCEPT AN OFFER ABOVE.');
        for (const m of s.missions) {
            this.text(L, y, `${m.title}  -  ${m.progress}/${m.count}`, m.progress >= m.count ? Fonts.Green : Fonts.Ink);
            this.text(L + 430, y, `${m.reward.gold}G + ${m.reward.xp} XP`);
            this.button(L + 630, y, 'ABANDON', () => {
                s.abandonMission(m.id);
                this.act(true, 'MISSION ABANDONED', '');
            }, true, 80);
            y += 22;
        }
    }

    private renderFleet(): void {
        const s = this.state;
        const L = this.L;
        let y = this.T;
        this.text(L, y, `FLEET MANAGER - ${s.ships.length} SHIPS   ESCORTS ${s.escorts.length}/${s.escortSlots} (MORE AT CAPTAIN LV 2/4/6)`, Fonts.Ink, 1);
        // Formation picker.
        (['line', 'wedge', 'flank'] as Formation[]).forEach((f, i) => {
            this.button(L + 470 + i * 78, y, f.toUpperCase(), () => {
                s.setFormation(f);
                this.act(true, `FORMATION: ${f.toUpperCase()}`, '');
            }, s.formation !== f, 72);
        });
        y += 22;
        for (const ship of s.ships.slice(0, 7)) {
            const st = s.statsOf(ship);
            const sunk = ship.status === 'sunk';
            this.shipIcon(L + 24, y + 4, ship, sunk || ship.status === 'repair');
            this.text(L + 58, y - 3, `${ship.name}  ${SHIP_CLASSES[ship.cls].name}`);
            const label = { active: 'FLAGSHIP', stored: 'STORED', escort: 'ESCORT', sunk: 'SUNK', repair: 'UNDER REPAIR' }[ship.status];
            const font = ship.status === 'sunk' ? Fonts.Red : ship.status === 'active' || ship.status === 'escort' ? Fonts.Green : Fonts.Ink;
            this.text(L + 250, y - 3, `${label}${!sunk && ship.hp < st.maxHp ? ' - DAMAGED' : ''}`, font);
            const u = ship.upgrades;
            this.text(L + 58, y + 8, `HULL ${Math.ceil(ship.hp)}/${st.maxHp} CARGO ${ship.cargo.length}/${st.cargo} SPD ${st.maxSpeed} GUNS ${st.cannons}  UPG H${u.hull} C${u.cannons} S${u.sails} R${u.rudder} K${u.cargo} P${u.harpoons}`);
            const bx = L + 468;
            if (ship.status === 'stored') {
                this.button(bx, y + 3, 'FLAGSHIP', () => this.act(s.makeFlagship(ship), `${ship.name} IS NOW YOUR FLAGSHIP`, 'CANNOT'), true, 74);
                this.button(bx + 80, y + 3, 'ESCORT', () => this.act(s.deployEscort(ship), `${ship.name} WILL SAIL AS ESCORT`, s.escorts.length >= s.escortSlots ? 'NO FREE ESCORT SLOTS (LEVEL UP)' : 'SHIP MUST BE AFLOAT'), s.escorts.length < s.escortSlots, 66);
                if (ship.cargo.length) this.button(bx + 152, y + 3, 'CARGO>', () => this.act(s.transferCargoToFlagship(ship) > 0, 'CARGO MOVED TO FLAGSHIP', 'FLAGSHIP HOLD IS FULL'), s.seaworthy, 60);
            } else if (ship.status === 'escort') {
                this.button(bx, y + 3, 'STORE', () => this.act(s.storeShip(ship), `${ship.name} RECALLED TO PORT`, 'CANNOT'), true, 74);
            } else if (sunk) this.button(bx, y + 3, 'RECOVERY', () => this.show('repair'), true, 74);
            y += 32;
        }
        this.text(L, this.top + PANEL_H - 32, 'ESCORTS FOLLOW YOUR FLAGSHIP AND FIGHT PIRATES AND MONSTERS. SUNK ESCORTS CAN BE RECOVERED HERE.').setAlpha(0.7);
    }

    private renderShipyard(): void {
        const s = this.state;
        const stock = tierOf(this.port).shipyard;
        const colW = Math.min(176, (PANEL_W - 40) / stock.length);
        const x0 = GAME_WIDTH / 2 - ((stock.length - 1) * colW) / 2;
        this.text(this.L, this.T, `SHIPYARD - ${stock.length} CLASS${stock.length > 1 ? 'ES' : ''} FOR SALE AT THIS TIER`, Fonts.Ink, 1);
        stock.forEach((cls, i) => {
            const def = SHIP_CLASSES[cls];
            const cx = x0 + i * colW;
            let y = this.T + 26;
            const owned = s.ships.filter((sh) => sh.cls === cls).length;
            this.text(cx, y, def.name, Fonts.Ink, 2, 0.5);
            this.text(cx, y + 15, def.role, Fonts.Ink, 1, 0.5).setAlpha(0.7);
            this.content.add(this.add.image(cx, y + 42, `${cls}-hull`).setAngle(90).setScale(PIXEL_SCALE * 0.7));
            y += 70;
            for (const r of ratings(cls)) {
                this.text(cx - 76, y, r.label);
                for (let k = 0; k < 5; k++) this.content.add(this.add.rectangle(cx + 4 + k * 13, y, 10, 6, k < r.value ? Palette.gold : Palette.sailShade).setStrokeStyle(1, Palette.woodDeep));
                y += 11;
            }
            this.text(cx, y + 6, `ABILITY: ${def.ability.name}`, Fonts.Ink, 1, 0.5);
            this.text(cx, y + 18, `OWNED: ${owned}   NEEDS LV ${def.requiredLevel}`, Fonts.Ink, 1, 0.5).setAlpha(0.75);
            const lvlOk = s.level >= def.requiredLevel;
            this.button(cx, y + 40, lvlOk ? `BUY ${def.price}G` : `LEVEL ${def.requiredLevel}`, () => {
                const ship = s.buyShip(cls);
                this.act(!!ship, `${ship?.name} JOINS YOUR FLEET - SEE FLEET TAB`, `NOT ENOUGH GOLD (NEED ${def.price})`);
            }, lvlOk && s.gold >= def.price, 124);
        });
    }

    private leave(): void {
        if (this.closing) return;
        if (!this.state.seaworthy) {
            this.say('NO SEAWORTHY FLAGSHIP: RECOVER ONE OR PICK ANOTHER IN FLEET');
            return;
        }
        this.closing = true;
        this.scene.stop();
        this.scene.resume(SceneKeys.Ocean);
    }
}
