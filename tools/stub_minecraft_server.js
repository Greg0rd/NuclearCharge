// Минимальная заглушка @minecraft/server для дымового теста main.js
const now = () => Date.now();

class ItemStack {
    constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; }
}

class BlockVolume {
    constructor(min, max) { this.min = min; this.max = max; }
}

const errors = [];

// --- блок ---
function makeBlock(typeId, x, y, z, dim) {
    return {
        typeId,
        location: { x, y, z },
        dimension: dim,
        isAir: typeId === "minecraft:air",
        isLiquid: false,
        setType(t) { this.typeId = t; this.isAir = t === "minecraft:air"; },
        getProperty() { return undefined; },
        getComponent() { return undefined; },
    };
}

// --- сущность ---
function makeEntity(dim) {
    return {
        location: { x: 5, y: 64, z: 5 },
        dimension: dim,
        typeId: "minecraft:zombie",
        removed: false,
        applyDamage() { },
        applyKnockback() { },
        addEffect() { },
        kill() { this.removed = true; },
        remove() { this.removed = true; stats.rocketRemoved = true; },
        teleport(loc, opts) {
            this.location = { ...loc };
            stats.teleports = (stats.teleports || 0) + 1;
            if (opts?.facingLocation) stats.facing = true;
        },
    };
}

// --- сигнал событий ---
function signal() {
    const subs = [];
    return {
        subscribe(fn) { subs.push(fn); return fn; },
        _fire(ev) { for (const fn of [...subs]) fn(ev); },
        get _count() { return subs.length; },
    };
}

// --- планировщик ---
let nextId = 1;
let currentTick = 0;
const jobs = new Map(); // id -> { fn, every, left, dead }
const system = {
    runInterval(fn, every = 1) {
        const id = nextId++;
        jobs.set(id, { fn, every, left: every, dead: false });
        return id;
    },
    runTimeout(fn, delay = 1) {
        const id = nextId++;
        jobs.set(id, { fn, every: 0, left: delay, dead: false, once: true });
        return id;
    },
    clearRun(id) {
        const j = jobs.get(id);
        if (j) j.dead = true;
    },
    get currentTick() { return currentTick; },
    __tick(n = 1) {
        for (let tt = 0; tt < n; tt++) currentTick++;
        const queueNow = runQueue.splice(0);
        for (const fn of queueNow) { try { fn(); } catch (e) { errors.push(e); } }
        for (let t = 0; t < n; t++) {
            const q = runQueue.splice(0);
            for (const fn of q) { try { fn(); } catch (e) { errors.push(e); } }
            for (const [, j] of [...jobs]) {
                if (j.dead) { jobs.delete(j.id); continue; }
                j.left--;
                if (j.left <= 0) {
                    j.left = j.every;
                    if (j.once) j.dead = true;
                    try { j.fn(); } catch (e) { errors.push(e); }
                }
            }
        }
    },
};
const runQueue = [];
system.run = (fn) => { runQueue.push(fn); return 0; };

// --- измерение ---
const stats = { commands: 0, particles: 0, explosions: 0 };
const blockStore = new Map(); // "x,y,z" -> block
const dimension = {
    id: "minecraft:overworld",
    heightRange: { min: -64, max: 319 },
    unloadedChunks: false,
    getBlock({ x, y, z }) {
        if (dimension.unloadedChunks) { const e = new Error("UnloadedChunksError"); throw e; }
        const key = `${x},${y},${z}`;
        let b = blockStore.get(key);
        if (!b) { b = makeBlock("minecraft:stone", x, y, z, dimension); blockStore.set(key, b); }
        return b;
    },
    fillBlocks(vol, block) {
        // не материализуем блоки (в игре это нативный вызов) — только считаем
        const dx = vol.max.x - vol.min.x + 1, dy = vol.max.y - vol.min.y + 1, dz = vol.max.z - vol.min.z + 1;
        stats.filled = (stats.filled || 0) + Math.max(0, dx * dy * dz);
        return { getBlocks() { return []; } };
    },
    spawnParticle(name) {
        stats.particles++;
        if (typeof name === "string" && name.includes("ash")) stats.ashCount = (stats.ashCount || 0) + 1;
    },
    spawnItem(item, loc) { stats.itemsSpawned = (stats.itemsSpawned || 0) + 1; stats.lastItem = item?.typeId; return item; },
    spawnEntity(typeId) {
        stats.spawnedEntities = (stats.spawnedEntities || 0) + 1;
        stats.lastSpawned = typeId;
        if (!Array.isArray(stats.spawnedTypes)) stats.spawnedTypes = [];
        stats.spawnedTypes.push(typeId);
        return makeEntity(dimension);
    },
    createExplosion() {
        stats.explosions++;
        if (!Array.isArray(stats.explosionTicks)) stats.explosionTicks = [];
        stats.explosionTicks.push(currentTick);
    },
    runCommand(cmd) {
        stats.commands++;
        if (!Array.isArray(stats.lastCmds)) stats.lastCmds = [];
        stats.lastCmds.push(cmd);
        if (stats.lastCmds.length > 300) stats.lastCmds.shift();
    },
    getEntities() { return [testEntity]; },
    getPlayers() { return [testPlayer]; },
};

const testEntity = makeEntity(dimension);
const testPlayer = {
    id: "tester",
    name: "tester",
    typeId: "minecraft:player",
    location: { x: 40, y: 64, z: 40 },
    dimension,
    sendMessage(m) { stats.lastMsg = m; },
    onScreenDisplay: { setActionBar(t) { stats.actionBars = (stats.actionBars || 0) + 1; stats.lastBar = t; } },
    camera: { fade() { }, addShake() { } },
    playSound(id, opts) {
        stats.playerSounds = (stats.playerSounds || 0) + 1;
        stats.lastPlayerSound = id;
        if (!Array.isArray(stats.soundLog)) stats.soundLog = [];
        stats.soundLog.push([id, currentTick]);
    },
    selectedSlotIndex: 0,
    heldItem: undefined,
    getComponent(id) {
        if (id === "minecraft:equippable") return { getEquipment: () => testPlayer.heldItem };
        if (id === "minecraft:inventory") {
            return { container: {
                setItem(i, it) { testPlayer.heldItem = it; },
                addItem(it) { stats.givenItems = (stats.givenItems || 0) + 1; stats.lastGiven = it?.typeId; },
            } };
        }
        return undefined;
    },
    applyDamage() { },
    applyKnockback() { },
    addEffect() { },
};

// --- мир ---
const worldProps = {};
const world = {
    getDynamicProperty(name) { return worldProps[name]; },
    setDynamicProperty(name, v) { worldProps[name] = v; },
    getDimension(id) { return dimension; },
    getEntity(pid) { return pid === "tester" ? testPlayer : (pid === "zombie" ? testEntity : undefined); },
    getAllPlayers() { return [testPlayer]; },
    afterEvents: {
        worldLoad: signal(),
        worldInitialize: signal(),
        blockPlace: signal(),
        playerPlaceBlock: signal(),
        playerBreakBlock: signal(),
        itemUse: signal(),
    },
    beforeEvents: {
        playerInteractWithBlock: signal(),
    },
};

export { world, system, BlockVolume, ItemStack, dimension, testPlayer, testEntity, stats, errors };
