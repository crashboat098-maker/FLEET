import { Events } from 'phaser';
import { ActiveMission, applyMissionEvent, MAX_ACTIVE_MISSIONS, MissionEvent, missionDone } from '../missions/missions';
import { cleanShipName, createShip, Formation, OwnedShip, Profile, saveProfile, setActiveShip, STORAGE_CAPACITY } from '../ships/profile';
import { computeStats, SECURE, SHIP_CLASSES, ShipClassId, ShipStats, upgradeCost, UpgradeId, upgradeMaterials, UPGRADE_ORDER, UPGRADES } from '../ships/shipClasses';
import { tierOf } from '../world/portTiers';
import { RegionId, REGIONS } from '../world/regions';
import { countOf, ITEMS, ItemType, Material } from './items';
import { levelInfo, maxEscorts, XP } from './progression';

export const StateEvents = {
    Changed: 'state-changed',
    Toast: 'toast',
    Prompt: 'prompt',
    /** The flagship just reached 0 HP. Payload: dropped cargo, kept count. */
    Sunk: 'ship-sunk',
    /** HUD asked to dock (clicked the Dock button). */
    DockRequest: 'dock-request',
    /** HUD asked to trigger the active ability. */
    AbilityRequest: 'ability-request',
    /** Payload: new level. */
    LevelUp: 'level-up',
    /** Payload: region id (first time or re-entry). */
    RegionEntered: 'region-entered',
    /** Payload: mission. */
    MissionComplete: 'mission-complete',
    /** Payload: { gold, xp, label } — a reward popup. */
    Reward: 'reward'
} as const;

export type DamageSource = 'cannonball' | 'ram' | 'creature' | 'hazard' | 'impact' | 'arrow';

const byValue = (a: ItemType, b: ItemType) => ITEMS[b].sell - ITEMS[a].sell;

/** Dry-dock repairs: half price, ready after this long. */
export const DRY_DOCK_MS = 2 * 60 * 1000;

/**
 * The captain's state: profile (fleet, gold, XP, missions) plus the flagship.
 * Every mutation goes through a method that validates (no negative gold, no
 * duplicate rewards), saves and broadcasts. No rendering code here.
 */
export class PlayerState extends Events.EventEmitter {
    /** The prompt currently on offer, so late-starting UI can show it. */
    currentPrompt: string | null = null;

    constructor(readonly profile: Profile) {
        super();
        this.settleDryDock();
    }

    // ------------------------------------------------------------- queries

    get captain(): string {
        return this.profile.captain;
    }
    get gold(): number {
        return this.profile.gold;
    }
    get ships(): OwnedShip[] {
        return this.profile.ships;
    }
    get level(): number {
        return levelInfo(this.profile.xp).level;
    }
    get xpInfo() {
        return levelInfo(this.profile.xp);
    }
    get formation(): Formation {
        return this.profile.formation;
    }
    get missions(): ActiveMission[] {
        return this.profile.missions;
    }

    /** The ship the captain is aboard (may be sunk). */
    get active(): OwnedShip | null {
        return this.profile.ships.find((s) => s.id === this.profile.activeId) ?? null;
    }
    get seaworthy(): boolean {
        return !!this.active && this.active.status === 'active' && this.active.hp > 0;
    }
    get escorts(): OwnedShip[] {
        return this.profile.ships.filter((s) => s.status === 'escort');
    }
    get escortSlots(): number {
        return maxEscorts(this.level);
    }

    statsOf(ship: OwnedShip): ShipStats {
        return computeStats(ship.cls, ship.upgrades);
    }
    get stats(): ShipStats {
        const a = this.active;
        return a ? this.statsOf(a) : computeStats('sloop', { hull: 0, cannons: 0, sails: 0, rudder: 0, cargo: 0, harpoons: 0 });
    }
    get shipName(): string {
        return this.active ? `${this.active.name}` : 'NONE';
    }
    get hull(): number {
        return Math.ceil(this.active?.hp ?? 0);
    }
    get hullMax(): number {
        return this.stats.maxHp;
    }
    get cargo(): ItemType[] {
        return this.active?.cargo ?? [];
    }
    get cargoCapacity(): number {
        return this.stats.cargo;
    }
    get cargoFull(): boolean {
        return this.cargo.length >= this.cargoCapacity;
    }
    /** 0 healthy, 1 light, 2 heavy, 3 critical. */
    get damageLevel(): number {
        return damageLevelOf(this.hull, this.hullMax);
    }

    // ------------------------------------------------------------ plumbing

    commit(): void {
        saveProfile(this.profile);
        this.emit(StateEvents.Changed);
    }

    toast(message: string): void {
        this.emit(StateEvents.Toast, message);
    }

    /** Contextual prompt (the docking offer). Pass null to clear. */
    prompt(message: string | null): void {
        this.currentPrompt = message;
        this.emit(StateEvents.Prompt, message);
    }

    // ---------------------------------------------------------- gold & XP

    /** The only way gold is earned. */
    addGold(amount: number, label?: string): void {
        const n = Math.max(0, Math.floor(amount));
        if (!n) return;
        this.profile.gold += n;
        if (label) this.emit(StateEvents.Reward, { gold: n, xp: 0, label });
        this.commit();
    }

    /** The only way gold is spent: refuses (and changes nothing) if it would go negative. */
    private spend(amount: number): boolean {
        const n = Math.max(0, Math.ceil(amount));
        if (this.profile.gold < n) return false;
        this.profile.gold -= n;
        return true;
    }

    addXp(amount: number, reason?: string): void {
        const n = Math.max(0, Math.floor(amount));
        if (!n) return;
        const before = this.level;
        this.profile.xp += n;
        if (reason) this.emit(StateEvents.Reward, { gold: 0, xp: n, label: reason });
        const after = this.level;
        this.commit();
        if (after > before) this.emit(StateEvents.LevelUp, after);
    }

    // -------------------------------------------------------- discoveries

    /** One-time XP for charting an island. Returns true the first time. */
    discoverIsland(id: number, name: string): boolean {
        if (this.profile.discoveredIslands.includes(id)) return false;
        this.profile.discoveredIslands.push(id);
        this.toast(`DISCOVERED ${name}`);
        this.addXp(XP.islandDiscovered);
        this.missionEvent({ type: 'discoverIsland', id });
        return true;
    }

    /** One-time XP for a region; always announces the region on entry. */
    enterRegion(id: RegionId): void {
        const first = !this.profile.discoveredRegions.includes(id);
        if (first) this.profile.discoveredRegions.push(id);
        this.emit(StateEvents.RegionEntered, id, first);
        if (first) {
            this.addXp(XP.regionDiscovered, `NEW REGION: ${REGIONS[id].name}`);
            this.missionEvent({ type: 'discoverRegion', id });
        }
    }

    // ---------------------------------------------------------------- cargo

    /** Returns false (and changes nothing) when the hold is full or there is no ship. */
    addCargo(item: ItemType): boolean {
        if (!this.seaworthy || this.cargoFull) return false;
        this.active!.cargo.push(item);
        if (item === 'chest') {
            this.profile.stats.treasure++;
            this.addXp(XP.chestFound);
        }
        this.commit();
        return true;
    }

    // -------------------------------------------------------- port storage

    /** The shared warehouse: the same contents at every port. */
    get storage(): ItemType[] {
        return this.profile.storage;
    }
    get storageFull(): boolean {
        return this.storage.length >= STORAGE_CAPACITY;
    }

    /** Move up to `count` of an item from the flagship's hold into storage. Returns how many moved. */
    storeItem(item: ItemType, count = 1): number {
        const ship = this.active;
        if (!ship || item === 'parcel') return 0;
        let moved = 0;
        while (moved < count && !this.storageFull) {
            const idx = ship.cargo.indexOf(item);
            if (idx < 0) break;
            ship.cargo.splice(idx, 1);
            this.storage.push(item);
            moved++;
        }
        if (moved) this.commit();
        return moved;
    }

    /** Move up to `count` of an item from storage into the flagship's hold. Returns how many moved. */
    takeItem(item: ItemType, count = 1): number {
        const ship = this.active;
        if (!ship || !this.seaworthy) return 0;
        let moved = 0;
        while (moved < count && !this.cargoFull) {
            const idx = this.storage.indexOf(item);
            if (idx < 0) break;
            this.storage.splice(idx, 1);
            ship.cargo.push(item);
            moved++;
        }
        if (moved) this.commit();
        return moved;
    }

    // --------------------------------------------------------------- damage

    /**
     * Damage the flagship (armour applies). At 0 HP it is marked SUNK — never
     * deleted. SECURE keeps part of the cargo; the rest is removed and returned
     * as loot to drop, so cargo can't be duplicated. Mission parcels sink too.
     */
    damage(amount: number, _source: DamageSource): number {
        const ship = this.active;
        if (!ship || !this.seaworthy || amount <= 0) return 0;
        const dealt = amount * (1 - this.stats.armor);
        ship.hp = Math.max(0, ship.hp - dealt);
        if (ship.hp > 0) {
            this.commit();
            return dealt;
        }
        const { dropped, kept } = this.wreck(ship);
        this.commit();
        this.emit(StateEvents.Sunk, dropped, kept);
        return dealt;
    }

    /** Mark a ship sunk; returns cargo to drop and how much SECURE saved. */
    private wreck(ship: OwnedShip): { dropped: ItemType[]; kept: number } {
        const cargo = ship.cargo.filter((c) => c !== 'parcel').sort(byValue);
        const keep = SHIP_CLASSES[ship.cls].ability.id === 'secure' && cargo.length ? Math.ceil(cargo.length * SECURE.fraction) : 0;
        ship.protectedCargo = [...ship.protectedCargo, ...cargo.slice(0, keep)];
        ship.cargo = [];
        ship.hp = 0;
        ship.status = 'sunk';
        // Delivery missions whose parcels went down are lost.
        const lost = this.profile.missions.filter((m) => m.kind === 'deliver');
        if (lost.length) {
            this.profile.missions = this.profile.missions.filter((m) => m.kind !== 'deliver');
            this.toast('DELIVERY LOST WITH THE SHIP');
        }
        return { dropped: cargo.slice(keep), kept: keep };
    }

    /** Escort ship took damage at sea (HP is tracked on the owned ship). */
    setEscortHp(ship: OwnedShip, hp: number): void {
        ship.hp = Math.max(0, hp);
    }

    escortSunk(ship: OwnedShip): ItemType[] {
        const { dropped } = this.wreck(ship);
        this.toast(`ESCORT ${ship.name} WAS SUNK`);
        this.commit();
        return dropped;
    }

    // -------------------------------------------------------------- repairs

    /**
     * Repairs need labour (gold) and Wood: 1 Wood per 30 hull points. Wood is
     * taken from port storage first, then the ship's own hold, then the
     * flagship's; any shortfall is bought from the shipwright at this port's
     * price and added to the bill. Repairs only happen when the player clicks.
     */
    repairQuote(ship: OwnedShip, port: number, labourMult = 1): { gold: number; wood: number; fromStorage: number; fromHold: number; bought: number } {
        const missing = Math.max(0, this.statsOf(ship).maxHp - ship.hp);
        if (missing <= 0) return { gold: 0, wood: 0, fromStorage: 0, fromHold: 0, bought: 0 };
        const wood = Math.ceil(missing / 30);
        const fromStorage = Math.min(wood, countOf(this.storage, 'wood'));
        const held = countOf(ship.cargo, 'wood') + (this.active && this.active !== ship ? countOf(this.active.cargo, 'wood') : 0);
        const fromHold = Math.min(wood - fromStorage, held);
        const bought = wood - fromStorage - fromHold;
        const labour = Math.ceil(missing * 1.2 * tierOf(port).repairRate * labourMult);
        return { gold: labour + bought * (this.buyPrice('wood', port) ?? 14), wood, fromStorage, fromHold, bought };
    }

    repairCost(ship: OwnedShip, port: number): number {
        return this.repairQuote(ship, port).gold;
    }

    private takeWood(ship: OwnedShip, n: number, fromStorage = 0): void {
        for (let i = 0; i < fromStorage; i++) this.storage.splice(this.storage.indexOf('wood'), 1);
        for (const holder of [ship, this.active]) {
            while (n > 0 && holder && holder.cargo.includes('wood')) {
                holder.cargo.splice(holder.cargo.indexOf('wood'), 1);
                n--;
            }
        }
    }

    repair(ship: OwnedShip, port: number): boolean {
        const q = this.repairQuote(ship, port);
        if (ship.status === 'sunk' || ship.status === 'repair' || q.gold <= 0 || !this.spend(q.gold)) return false;
        this.takeWood(ship, q.fromHold, q.fromStorage);
        ship.hp = this.statsOf(ship).maxHp;
        this.commit();
        return true;
    }

    /** Half-price labour, but the ship is out of service for a while. */
    dryDock(ship: OwnedShip, port: number): boolean {
        const q = this.repairQuote(ship, port, 0.5);
        if (ship.status !== 'stored' || q.gold <= 0 || !this.spend(q.gold)) return false;
        this.takeWood(ship, q.fromHold, q.fromStorage);
        ship.status = 'repair';
        ship.repairUntil = Date.now() + DRY_DOCK_MS;
        this.commit();
        return true;
    }

    dryDockCost(ship: OwnedShip, port: number): number {
        return this.repairQuote(ship, port, 0.5).gold;
    }

    // ------------------------------------------------------------ materials

    materialCount(m: Material): number {
        return countOf(this.cargo, m);
    }

    /** Materials available for upgrades: port storage plus the flagship's hold. */
    availableMaterial(m: Material): number {
        return countOf(this.storage, m) + this.materialCount(m);
    }

    /** Which materials are short for a requirement, counting storage and hold (empty = ok). */
    missingMaterials(req: Partial<Record<Material, number>>): string {
        return Object.entries(req)
            .filter(([m, n]) => this.availableMaterial(m as Material) < (n ?? 0))
            .map(([m, n]) => `${(n ?? 0) - this.availableMaterial(m as Material)} ${m.toUpperCase()}`)
            .join(' + ');
    }

    /** Use up materials: port storage first, then the flagship's hold. */
    private consumeMaterials(req: Partial<Record<Material, number>>): void {
        const hold = this.active?.cargo ?? [];
        for (const [m, n] of Object.entries(req)) {
            for (let i = 0; i < (n ?? 0); i++) {
                const s = this.storage.indexOf(m as Material);
                if (s >= 0) this.storage.splice(s, 1);
                else hold.splice(hold.indexOf(m as Material), 1);
            }
        }
    }

    /**
     * Grant salvage/treasure: gold directly, items into the hold while there
     * is room. Returns the items that did not fit (caller floats them).
     */
    grantLoot(gold: number, items: ItemType[], label?: string): ItemType[] {
        if (gold > 0) this.profile.gold += Math.floor(gold);
        const left: ItemType[] = [];
        for (const it of items) {
            if (this.seaworthy && !this.cargoFull) this.active!.cargo.push(it);
            else left.push(it);
        }
        if (label) this.emit(StateEvents.Reward, { gold: Math.floor(gold), xp: 0, label });
        this.commit();
        return left;
    }

    /** Persisted one-time interactions (salvaged wrecks, opened chests). */
    wasUsed(id: string, cooldownMs = Infinity): boolean {
        const at = this.profile.used[id];
        return at !== undefined && Date.now() - at < cooldownMs;
    }

    markUsed(id: string): void {
        this.profile.used[id] = Date.now();
        this.commit();
    }

    /** Finish any dry-dock repairs whose time is up. */
    settleDryDock(): boolean {
        let changed = false;
        for (const s of this.profile.ships) {
            if (s.status === 'repair' && (s.repairUntil ?? 0) <= Date.now()) {
                s.status = 'stored';
                s.hp = this.statsOf(s).maxHp;
                delete s.repairUntil;
                changed = true;
            }
        }
        if (changed) this.commit();
        return changed;
    }

    recoveryCost(ship: OwnedShip): number {
        return Math.round(SHIP_CLASSES[ship.cls].price * 0.2);
    }

    /** A free harbour tow is offered when the captain is stranded and can't pay. */
    freeTowAvailable(ship: OwnedShip): boolean {
        const anyAfloat = this.ships.some((s) => s.status !== 'sunk' && s.status !== 'repair');
        return ship.status === 'sunk' && !anyAfloat && this.gold < this.recoveryCost(ship);
    }

    /** Raise a sunk ship: keeps class, upgrades and protected cargo; comes back fully repaired. */
    recover(ship: OwnedShip): boolean {
        if (ship.status !== 'sunk') return false;
        const free = this.freeTowAvailable(ship);
        if (!free && !this.spend(this.recoveryCost(ship))) return false;
        ship.hp = this.statsOf(ship).maxHp;
        ship.cargo = [...ship.cargo, ...ship.protectedCargo];
        ship.protectedCargo = [];
        ship.status = 'stored';
        if (this.profile.activeId === ship.id || !this.seaworthy) setActiveShip(this.profile, ship);
        this.commit();
        return true;
    }

    // ---------------------------------------------------------------- fleet

    /** Give one of your ships a new name. Returns the saved name, or null if it was empty. */
    renameShip(ship: OwnedShip, raw: string): string | null {
        const name = cleanShipName(raw);
        if (!name || !this.ships.includes(ship)) return null;
        ship.name = name;
        this.commit();
        return name;
    }

    makeFlagship(ship: OwnedShip): boolean {
        if (ship.status === 'sunk' || ship.status === 'repair') return false;
        setActiveShip(this.profile, ship);
        this.commit();
        return true;
    }

    /** A new captain's free first ship. Only allowed while the fleet is empty. */
    claimStarterShip(cls: ShipClassId): OwnedShip | null {
        if (this.profile.ships.length > 0) return null;
        const ship = createShip(cls, 'active');
        this.profile.ships.push(ship);
        this.profile.activeId = ship.id;
        this.commit();
        return ship;
    }

    deployEscort(ship: OwnedShip): boolean {
        if (ship.status !== 'stored' || ship.hp <= 0 || this.escorts.length >= this.escortSlots) return false;
        ship.status = 'escort';
        this.commit();
        return true;
    }

    storeShip(ship: OwnedShip): boolean {
        if (ship.status !== 'escort') return false;
        ship.status = 'stored';
        this.commit();
        return true;
    }

    setFormation(f: Formation): void {
        this.profile.formation = f;
        this.commit();
    }

    /** Move as much of a stored ship's cargo as fits into the flagship. */
    transferCargoToFlagship(ship: OwnedShip): number {
        const flag = this.active;
        if (!flag || flag === ship || !this.seaworthy) return 0;
        let moved = 0;
        while (ship.cargo.length && flag.cargo.length < this.cargoCapacity) {
            flag.cargo.push(ship.cargo.shift()!);
            moved++;
        }
        if (moved) this.commit();
        return moved;
    }

    // ------------------------------------------------------------- upgrades

    buyUpgrade(id: UpgradeId, port: number): boolean {
        const ship = this.active;
        if (!ship || ship.status !== 'active') return false;
        const lvl = ship.upgrades[id];
        if (lvl >= tierOf(port).upgradeCap[id]) return false;
        const cost = upgradeCost(ship.cls, id, lvl);
        const mats = upgradeMaterials(id, lvl);
        if (cost === null || this.missingMaterials(mats) || !this.spend(cost)) return false;
        this.consumeMaterials(mats);
        const before = this.statsOf(ship).maxHp;
        ship.upgrades[id]++;
        // A hull upgrade raises max HP; keep the same amount of damage.
        if (id === 'hull') ship.hp += this.statsOf(ship).maxHp - before;
        this.commit();
        return true;
    }

    // ------------------------------------------------------------- shipyard

    canBuyShip(cls: ShipClassId): boolean {
        return this.level >= SHIP_CLASSES[cls].requiredLevel && this.gold >= SHIP_CLASSES[cls].price;
    }

    /** Owned ships that still have upgrades left to buy. */
    get shipsNotMaxed(): OwnedShip[] {
        return this.ships.filter((s) => UPGRADE_ORDER.some((id) => s.upgrades[id] < UPGRADES[id].maxLevel));
    }

    /** A new ship can only be bought once every ship you own is fully upgraded. */
    get canBuyShips(): boolean {
        return this.shipsNotMaxed.length === 0;
    }

    buyShip(cls: ShipClassId): OwnedShip | null {
        if (!this.canBuyShips) return null;
        if (this.level < SHIP_CLASSES[cls].requiredLevel || !this.spend(SHIP_CLASSES[cls].price)) return null;
        const ship = createShip(cls);
        this.profile.ships.push(ship);
        this.addXp(25, `NEW SHIP: ${ship.name}`);
        this.commit();
        return ship;
    }

    // -------------------------------------------------------------- trading

    sellPrice(item: ItemType, port: number): number {
        if (ITEMS[item].sell <= 0) return 0;
        return Math.round(ITEMS[item].sell * (tierOf(port).prices[item]?.sell ?? 1));
    }

    buyPrice(item: ItemType, port: number): number | null {
        const base = ITEMS[item].buy;
        return base === null ? null : Math.round(base * (tierOf(port).prices[item]?.buy ?? 1));
    }

    sell(item: ItemType, port: number, count = 1): number {
        const ship = this.active;
        const price = this.sellPrice(item, port);
        if (!ship || price <= 0) return 0;
        let sold = 0;
        for (let i = 0; i < count; i++) {
            const idx = ship.cargo.indexOf(item);
            if (idx < 0) break;
            ship.cargo.splice(idx, 1);
            this.profile.gold += price;
            sold++;
        }
        if (sold) {
            this.commit();
            this.addXp(Math.floor((sold * price) / XP.tradeGoldPerXp));
        }
        return sold;
    }

    buy(item: ItemType, port: number): boolean {
        const price = this.buyPrice(item, port);
        if (price === null || !this.seaworthy || this.cargoFull || !this.spend(price)) return false;
        this.active!.cargo.push(item);
        this.commit();
        return true;
    }

    // ------------------------------------------------------------- missions

    acceptMission(m: ActiveMission): string | null {
        if (this.profile.missions.length >= MAX_ACTIVE_MISSIONS) return 'MISSION LOG FULL (3 MAX)';
        if (this.level < m.minLevel) return `REQUIRES CAPTAIN LEVEL ${m.minLevel}`;
        if (this.profile.missions.some((x) => x.id === m.id)) return 'ALREADY ACCEPTED';
        if (m.kind === 'deliver') {
            if (!this.seaworthy || this.cargoCapacity - this.cargo.length < m.count) return `NEED ${m.count} FREE CARGO SLOTS`;
            for (let i = 0; i < m.count; i++) this.active!.cargo.push('parcel');
        }
        this.profile.missions.push({ ...m });
        this.profile.missionSeq = Math.max(this.profile.missionSeq, m.id + 1);
        // Refresh this port's board so the same offer can't be taken twice.
        this.profile.boardEpoch[m.issuer] = (this.profile.boardEpoch[m.issuer] ?? 0) + 1;
        this.commit();
        return null;
    }

    abandonMission(id: number): void {
        const m = this.profile.missions.find((x) => x.id === id);
        if (!m) return;
        if (m.kind === 'deliver' && this.active) {
            for (let i = 0; i < m.count; i++) {
                const idx = this.active.cargo.indexOf('parcel');
                if (idx >= 0) this.active.cargo.splice(idx, 1);
            }
        }
        this.profile.missions = this.profile.missions.filter((x) => x.id !== id);
        this.commit();
    }

    /** Route a gameplay event to all missions; completes and rewards those finished. */
    missionEvent(e: MissionEvent): void {
        let changed = false;
        for (const m of [...this.profile.missions]) {
            if (applyMissionEvent(m, e)) {
                changed = true;
                if (missionDone(m)) this.completeMission(m);
            }
        }
        if (changed) this.commit();
    }

    /** Deliveries complete when docking at the destination with the parcels aboard. */
    onDocked(port: number): void {
        for (const m of [...this.profile.missions]) {
            // Rescued citizens are brought home to the port that asked for help.
            if (m.kind === 'rescue' && m.progress === 1 && m.issuer === port) {
                m.progress = 2;
                this.toast('CITIZEN RETURNED HOME SAFELY!');
                this.completeMission(m);
                continue;
            }
            if (m.kind !== 'deliver' || m.targetPort !== port) continue;
            const ship = this.active;
            const have = ship?.cargo.filter((c) => c === 'parcel').length ?? 0;
            if (!ship || have < m.count) continue;
            for (let i = 0; i < m.count; i++) ship.cargo.splice(ship.cargo.indexOf('parcel'), 1);
            m.progress = m.count;
            this.completeMission(m);
        }
    }

    failMission(id: number, reason: string): void {
        if (!this.profile.missions.some((m) => m.id === id)) return;
        this.profile.missions = this.profile.missions.filter((m) => m.id !== id);
        this.toast(reason);
        this.commit();
    }

    /** Pay out exactly once: the mission is removed before rewards are granted. */
    private completeMission(m: ActiveMission): void {
        if (!this.profile.missions.includes(m)) return;
        this.profile.missions = this.profile.missions.filter((x) => x !== m);
        this.profile.stats.missions++;
        this.emit(StateEvents.MissionComplete, m);
        this.addGold(m.reward.gold, `MISSION COMPLETE: ${m.title}`);
        // Material rewards go to the hold; anything that doesn't fit is paid out at market value.
        const left = this.grantLoot(0, m.reward.items ?? []);
        const value = left.reduce((g, it) => g + ITEMS[it].sell, 0);
        if (value) this.addGold(value, 'HOLD FULL - REWARD GOODS SOLD');
        this.addXp(m.reward.xp);
    }

    recordKill(role: string, region: RegionId): void {
        this.profile.stats.kills++;
        const xp = XP.kill[role] ?? 0;
        if (xp) this.addXp(xp);
        this.missionEvent({ type: 'kill', role, region });
        this.commit();
    }
}

export const damageLevelOf = (hp: number, max: number): number => {
    const r = hp / Math.max(1, max);
    return r > 0.75 ? 0 : r > 0.5 ? 1 : r > 0.25 ? 2 : 3;
};
