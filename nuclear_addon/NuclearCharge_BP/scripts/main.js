// ============================================================================
//  NUCLEAR CHARGE — Ядерный заряд для Minecraft Bedrock
//  Script API v2 (@minecraft/server 2.0.0+, @minecraft/server-ui 2.0.0)
//
//  v1.2 — по итогам игровых тестов:
//   • Фикс «колец-свидетелей»: ретраи колонок + верификационные проходы сферы
//   • Кратер-«чаша»: интерьер сфер срезается цилиндром (сухо, включая воду)
//   • Сирена/взрыв звучат над головой КАЖДОГО игрока сервера (без ограничения)
//   • Пусковая станция (кастомный блок): вставьте заряд, введите координаты,
//     ракета летит по дуге и взрывается в точке (в радиусе 4096 блоков)
// ============================================================================

import { world, system, BlockVolume, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// ----------------------------------------------------------------------------
// НАСТРОЙКИ
// ----------------------------------------------------------------------------
const CONFIG = {
    explosionRadius: 100,        // радиус взрыва (блоков)
    coreExplosionRadius: 30,     // мгновенный нативный взрыв в центре

    bowlMode: true,              // кратер-«чаша»: цилиндр до самого края — ровный круг без «полок»
    bowlExtra: 10,               // насколько выше поверхности срезать интерьер

    waveTicksPerStep: 2,         // пауза между шагами ударной волны (в тиках)
    waveStripsPerStep: 20,       // полос-строк за шаг (полоса = до ~40 колонок одним fillBlocks)
    verifyPasses: 3,             // контрольных проходов сферы после волны

    flintTimerSeconds: 20,       // таймер при поджиге кремнём и огнивом
    redstoneTimerSeconds: 10,    // таймер при активации красным камнем
    remoteTimerSeconds: 3,       // таймер с пульта
    remoteSearchRadius: 512,     // радиус поиска заряда пультом

    radiationSeconds: 600,       // сколько секунд держится зона радиации
    firesCount: 140,             // сколько очагов огня после взрыва

    mushroomRiseTicks: 700,      // подъём гриба (в тиках)
    mushroomLingerTicks: 500,    // послесвечение шляпки

    sirenEveryTicks: 320,        // длина трека сирены (16 c)

    missileMaxRange: 4096,       // максимальная дальность пуска
    missileMinRange: 24,         // минимальная дальность (иначе нет смысла)
};

// ----------------------------------------------------------------------------
// КОНСТАНТЫ
// ----------------------------------------------------------------------------
const CHARGE_ID       = "nuclear:nuclear_charge";
const CHARGE_ARMED_ID = "nuclear:nuclear_charge_armed";
const DETONATOR_ID    = "nuclear:nuclear_detonator";
const STATION_ID      = "nuclear:launch_station";
const STATION_LOADED  = "nuclear:launch_station_loaded";
const MARKER_ID       = "nuclear:target_marker";
const isChargeId  = (id) => id === CHARGE_ID || id === CHARGE_ARMED_ID;
const isStationId = (id) => id === STATION_ID || id === STATION_LOADED;

const AREA_KEEP_PREFIX = "ncq_keep_";
const AREA_RING_PREFIX = "ncq_ring_";
const RING_SECTORS = 8;
const RING_MOVE_STEP = 40;

// ----------------------------------------------------------------------------
// СОСТОЯНИЕ
// ----------------------------------------------------------------------------
const charges = new Map();           // заряды (включая «виртуальные» в воздухе)
const stations = new Map();          // key -> { dimId, dim, pos, loaded, target, launching }

const targetMarkers = new Map();     // key -> { dimId, x, y, z } — цели-метки
const MARKERS_PROP = "ncq_markers";

function saveMarkers() {
    try {
        world.setDynamicProperty(MARKERS_PROP, JSON.stringify([...targetMarkers.entries()]));
    } catch { }
}

function loadMarkers() {
    targetMarkers.clear();
    let raw;
    try { raw = world.getDynamicProperty(MARKERS_PROP); } catch { }
    if (typeof raw === "string") {
        try { for (const [k, v] of JSON.parse(raw)) targetMarkers.set(k, v); } catch { }
    }
}

function registerMarker(block) {
    if (block.typeId !== MARKER_ID) return;
    const key = keyOf(block.dimension.id, block.location);
    targetMarkers.set(key, {
        dimId: block.dimension.id,
        x: block.location.x, y: block.location.y, z: block.location.z
    });
    saveMarkers();
}

function unregisterMarker(dimId, pos) {
    const key = keyOf(dimId, pos);
    if (targetMarkers.delete(key)) {
        saveMarkers();
        // станции, целящиеся в эту метку, теряют цель
        for (const st of stations.values()) {
            if (st.targetMarkerKey === key) { st.target = undefined; st.targetMarkerKey = undefined; }
        }
    }
}
const radiationZones = [];
const irradiated = new Map();
const failedParticles = new Set();
let areaCounter = 0;
let trackedAreas = [];

const keyOf = (dimId, pos) => `${dimId}|${pos.x},${pos.y},${pos.z}`;
const dist3D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const rnd = (min, max) => min + Math.random() * (max - min);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// детерминированная «вариация» высоты: одинакова для всех игроков (синхронный звук)
const detPitch = (base, step, i) => base + (Math.abs(Math.floor(i)) % 8) * step;

// ----------------------------------------------------------------------------
// БАЗОВЫЕ ХЕЛПЕРЫ
// ----------------------------------------------------------------------------
function runCmd(dim, cmd) {
    try { dim.runCommand(cmd); } catch { }
}

// Звук: играет НАД ГОЛОВОЙ каждого игрока сервера (глобально, без лимита дистанции)
function soundAtPlayers(dim, loc, sound, volume = 1, pitch = 1) {
    try {
        for (const p of dim.getPlayers()) {
            try { p.playSound(sound, { location: { x: p.location.x, y: p.location.y + 1.6, z: p.location.z }, volume, pitch }); } catch { }
        }
    } catch { }
    // запасной путь для игроков других измерений
    try {
        for (const p of world.getAllPlayers()) {
            if (p.dimension.id !== dim.id) {
                try { p.playSound(sound, { location: { x: p.location.x, y: p.location.y + 1.6, z: p.location.z }, volume: volume * 0.8, pitch }); } catch { }
            }
        }
    } catch { }
}

// Локальный позиционный звук (близкие объекты: писки, фронт волны)
function playSoundAt(dim, loc, sound, volume = 2, pitch = 1) {
    const r = Math.min(16 * volume, 900);
    runCmd(dim,
        `playsound ${sound} @a[x=${Math.floor(loc.x)},y=${Math.floor(loc.y)},z=${Math.floor(loc.z)},r=${r}] ` +
        `${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} ${volume} ${pitch}`);
}

function safeParticle(dim, name, loc) {
    if (failedParticles.has(name)) return;
    try { dim.spawnParticle(name, loc); }
    catch { failedParticles.add(name); }
}

function messagePlayersAround(dim, loc, radius, text) {
    try {
        for (const p of dim.getPlayers({ location: loc, maxDistance: radius })) {
            try { p.sendMessage(text); } catch { }
        }
    } catch { }
}

function announceServer(dim, text) {
    try { world.sendMessage(text); } catch { }
    soundAtPlayers(dim, { x: 0, y: 0, z: 0 }, "raid.horn", 0.8, 0.6);
}

// Показ формы с повторами.
// Bedrock отклоняет формы, показанные слишком рано после другой формы или
// взаимодействия (cancelationReason = "UserBusy") — без ретраев окно
// «просто закрывается» и поля ввода не появляются.
function showForm(player, form, maxTries = 15) {
    return new Promise((resolve) => {
        let tries = 0;
        const attempt = () => {
            tries++;
            try {
                form.show(player).then((resp) => {
                    if (resp && resp.cancelationReason === "UserBusy" && tries < maxTries) {
                        system.runTimeout(attempt, 10);
                    } else {
                        resolve(resp);
                    }
                }).catch(() => resolve(undefined));
            } catch {
                resolve(undefined);
            }
        };
        attempt();
    });
}

// ----------------------------------------------------------------------------
// ТИКАЮЩИЕ ОБЛАСТИ
// ----------------------------------------------------------------------------
function saveAreas() {
    try { world.setDynamicProperty("ncq_areas", JSON.stringify(trackedAreas)); } catch { }
}

function addTickingArea(dim, name, x, z) {
    runCmd(dim, `tickingarea add circle ${Math.floor(x)} 1 ${Math.floor(z)} 4 ${name}`);
    if (!trackedAreas.includes(name)) { trackedAreas.push(name); saveAreas(); }
}

function removeTickingArea(dim, name) {
    runCmd(dim, `tickingarea remove ${name}`);
    trackedAreas = trackedAreas.filter((n) => n !== name);
    saveAreas();
}

function ensureKeepArea(entry) {
    if (entry.keepArea) return;
    entry.keepArea = AREA_KEEP_PREFIX + (++areaCounter);
    addTickingArea(entry.dim, entry.keepArea, entry.pos.x, entry.pos.z);
}

function dropKeepArea(entry) {
    if (!entry.keepArea) return;
    removeTickingArea(entry.dim, entry.keepArea);
    entry.keepArea = undefined;
}

function moveRingAreas(dim, center, r) {
    const rr = r + 32;
    for (let s = 0; s < RING_SECTORS; s++) {
        const a = ((s + 0.5) / RING_SECTORS) * Math.PI * 2;
        const name = AREA_RING_PREFIX + s;
        runCmd(dim, `tickingarea remove ${name}`);
        runCmd(dim, `tickingarea add circle ${Math.floor(center.x + Math.cos(a) * rr)} 1 ${Math.floor(center.z + Math.sin(a) * rr)} 4 ${name}`);
        if (!trackedAreas.includes(name)) { trackedAreas.push(name); saveAreas(); }
    }
}

function dropRingAreas(dim) {
    for (let s = 0; s < RING_SECTORS; s++) removeTickingArea(dim, AREA_RING_PREFIX + s);
}

function cleanupLeftoverAreas(dim) {
    let raw;
    try { raw = world.getDynamicProperty("ncq_areas"); } catch { }
    if (typeof raw === "string") {
        try { for (const name of JSON.parse(raw)) runCmd(dim, `tickingarea remove ${name}`); } catch { }
    }
    trackedAreas = [];
    saveAreas();
}

// ----------------------------------------------------------------------------
// ВСПЫШКА И ТРЯСКА
// ----------------------------------------------------------------------------
function doFlash(dim, center, radius) {
    try {
        for (const p of dim.getPlayers({ location: center, maxDistance: radius })) {
            const d = dist3D(p.location, center);
            const hold = Math.max(0.5, 1.8 - d / radius);
            const tin = d < radius ? 0.12 : 0;
            try {
                // трёхфазная вспышка как у настоящего ядерного взрыва:
                // 1) мгновенное ослепление 2) белое плато 3) оранжевый жар
                p.camera.fade({ fadeColor: { red: 1, green: 1, blue: 1 }, fadeInTime: tin, holdTime: 0.12, fadeOutTime: 0.1 });
                p.camera.fade({ fadeColor: { red: 1.0, green: 0.96, blue: 0.85 }, fadeInTime: 0, holdTime: hold, fadeOutTime: 1.6 });
                p.camera.fade({ fadeColor: { red: 1.0, green: 0.55, blue: 0.2 }, fadeInTime: 0.8, holdTime: 0.6, fadeOutTime: 3.2 });
            } catch { }
        }
    } catch { }
}

function doShake(dim, center, radius) {
    try {
        for (const p of dim.getPlayers({ location: center, maxDistance: radius })) {
            const d = dist3D(p.location, center);
            const intensity = Math.max(0.15, 2.0 * (1 - d / radius));
            try { p.camera.addShake({ intensity, duration: 4 }); }
            catch { runCmd(dim, `camerashake add @a[name="${p.name}"] ${intensity.toFixed(2)} 4 positional`); }
        }
    } catch { }
}

// ----------------------------------------------------------------------------
// УРОН И ОТБРОСЫВАНИЕ
// ----------------------------------------------------------------------------
function knockbackCompat(entity, dirX, dirZ, horizontal, vertical) {
    try { entity.applyKnockback({ x: dirX, z: dirZ }, vertical); }
    catch { try { entity.applyKnockback(dirX, dirZ, horizontal, vertical); } catch { } }
}

function shockwaveDamage(dim, center, R) {
    let ents = [];
    try { ents = dim.getEntities({ location: center, maxDistance: R * 2.2 }); } catch { }
    for (const e of ents) {
        const d = dist3D(e.location, center);
        const inv = 1 / (d || 1);
        const k = Math.max(0, 1 - d / (R * 2));
        knockbackCompat(e, (e.location.x - center.x) * inv, (e.location.z - center.z) * inv, 3 + 5 * k, 1 + 2.5 * k);
        let dmg = 0;
        if (d < 45) dmg = 1000;
        else if (d < 90) dmg = 60;
        else if (d < 140) dmg = 30;
        else if (d < R * 2) dmg = 10;
        if (dmg > 0) {
            try { e.applyDamage(dmg, { cause: "override" }); }
            catch { try { e.applyDamage(dmg); } catch { } }
        }
    }
}

// ----------------------------------------------------------------------------
// ЗАРЯДЫ: РЕЕСТР
// ----------------------------------------------------------------------------
function registerCharge(block) {
    if (!isChargeId(block.typeId)) return null;
    const pos = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dim = block.dimension;
    const key = keyOf(dim.id, pos);
    let entry = charges.get(key);
    if (!entry) {
        entry = { dimId: dim.id, dim, pos, state: "idle", ticksLeft: 0, blinkOn: false, detonated: false, redstonePowered: false, keepArea: undefined, virtual: false };
        charges.set(key, entry);
    } else {
        entry.dim = dim;
    }
    return entry;
}

function setChargeBlock(entry, armed) {
    try { entry.dim.getBlock(entry.pos)?.setType(armed ? CHARGE_ARMED_ID : CHARGE_ID); } catch { }
}

function setChargeBlockWithRetry(entry, armed, attempts) {
    setChargeBlock(entry, armed);
    if (attempts <= 0) return;
    system.runTimeout(() => {
        if (entry.detonated && armed) return;
        try {
            const b = entry.dim.getBlock(entry.pos);
            if (b && b.typeId !== (armed ? CHARGE_ARMED_ID : CHARGE_ID) && isChargeId(b.typeId)) {
                setChargeBlockWithRetry(entry, armed, attempts - 1);
            }
        } catch { setChargeBlockWithRetry(entry, armed, attempts - 1); }
    }, 10);
}

function armCharge(entry, ticks) {
    if (!entry || entry.state === "armed" || entry.detonated) return;
    entry.state = "armed";
    entry.ticksLeft = ticks;
    entry.blinkOn = true;
    if (!entry.virtual) {
        ensureKeepArea(entry);
        setChargeBlockWithRetry(entry, true, 3);
    }
    soundAtPlayers(entry.dim, entry.pos, "nuclear.siren", 1, 1);
    messagePlayersAround(entry.dim, entry.pos, 96,
        `§c☢ Ядерный заряд активирован! §7До взрыва: §e${Math.ceil(ticks / 20)}§7 сек.`);
}

function disarmCharge(entry, player) {
    if (!entry || entry.state !== "armed") return;
    entry.state = "idle";
    entry.ticksLeft = 0;
    setChargeBlockWithRetry(entry, false, 3);
    dropKeepArea(entry);
    playSoundAt(entry.dim, entry.pos, "random.click", 3, 1.4);
    messagePlayersAround(entry.dim, entry.pos, 64, "§a✔ Заряд обезврежен.");
}

// ----------------------------------------------------------------------------
// ТАЙМЕР ЗАРЯДОВ (не останавливается при выгрузке чанка)
// ----------------------------------------------------------------------------
function countdownTick() {
    for (const entry of [...charges.values()]) {
        if (entry.state !== "armed") continue;

        if (!entry.virtual) {
            try {
                const b = entry.dim.getBlock(entry.pos);
                if (b && !isChargeId(b.typeId)) {
                    dropKeepArea(entry);
                    charges.delete(keyOf(entry.dimId, entry.pos));
                    continue;
                }
            } catch { /* чанк выгружен — таймер идёт */ }
            entry.ticksLeft--;

            const period = entry.ticksLeft > 100 ? 10 : entry.ticksLeft > 30 ? 5 : 2;
            if (entry.ticksLeft % period === 0) {
                entry.blinkOn = !entry.blinkOn;
                setChargeBlock(entry, entry.blinkOn);
                if (period <= 5) playSoundAt(entry.dim, entry.pos, "note.hat", 3, 1.9);
            }
        } else {
            entry.ticksLeft--;
        }

        if (entry.ticksLeft % CONFIG.sirenEveryTicks === 0 && entry.ticksLeft > 0) {
            soundAtPlayers(entry.dim, entry.pos, "nuclear.siren", 1, 1);
        }

        if (entry.ticksLeft % 20 === 0 && entry.ticksLeft > 0) {
            try {
                for (const p of entry.dim.getPlayers({ location: entry.pos, maxDistance: 64 })) {
                    p.onScreenDisplay.setActionBar(
                        `§4☢ §cЯДЕРНЫЙ УДАР ЧЕРЕЗ §e${Math.ceil(entry.ticksLeft / 20)} §cсек.`);
                }
            } catch { }
        }

        if (entry.ticksLeft <= 0) detonate(entry);
    }
}

// ----------------------------------------------------------------------------
// КРАСНЫЙ КАМЕНЬ (по фронту сигнала)
// ----------------------------------------------------------------------------
function hasRedstonePower(dim, pos) {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [dx, dy, dz] of dirs) {
        let b;
        try { b = dim.getBlock({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }); } catch { continue; }
        if (!b) continue;
        const id = b.typeId;
        if (id === "minecraft:redstone_block" || id === "minecraft:redstone_torch") return true;
        if (id === "minecraft:lever") {
            try { if (b.getProperty("open_button_state") === true) return true; } catch { }
        }
        if (id.endsWith("button")) {
            try { if (b.getProperty("button_pressed_bit") === true) return true; } catch { }
        }
        if (id === "minecraft:observer") {
            try { if (b.getProperty("powered_bit") === true) return true; } catch { }
        }
        try {
            const sig = b.getProperty("redstone_signal");
            if (typeof sig === "number" && sig > 0) return true;
        } catch { }
    }
    return false;
}

function redstonePoll() {
    for (const entry of charges.values()) {
        if (entry.state !== "idle" || entry.virtual) continue;
        try {
            const powered = hasRedstonePower(entry.dim, entry.pos);
            if (powered && !entry.redstonePowered) {
                armCharge(entry, CONFIG.redstoneTimerSeconds * 20);
                messagePlayersAround(entry.dim, entry.pos, 64, "§c⚠ Обнаружен сигнал красного камня!");
            }
            entry.redstonePowered = powered;
        } catch { }
    }
}

// ----------------------------------------------------------------------------
// СФЕРА РАЗРУШЕНИЯ v1.2
//  - «чаша»: интерьер срезается цилиндром до верха сферы (+bowlExtra):
//    сухой круглый кратер, вода внутри испаряется
//  - ретраи колонок (чанк мог быть ещё не загружен)
//  - верификационные проходы: недостреленные колонки добиваются
// ----------------------------------------------------------------------------
const discCellsCache = new Map();

function getDiscCells(R) {
    if (discCellsCache.has(R)) return discCellsCache.get(R);
    const map = new Map();
    for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
            const r = Math.round(Math.sqrt(dx * dx + dz * dz));
            if (r > R) continue;
            if (!map.has(r)) map.set(r, []);
            map.get(r).push([dx, dz]);
        }
    }
    discCellsCache.set(R, map);
    return map;
}

// одна попытка испарить колонку; false = чанк не загружен (надо повторить)
function vaporizeColumnAttempt(dim, x, z, yBot, yTop) {
    try {
        dim.fillBlocks(new BlockVolume({ x, y: yBot, z }, { x, y: yTop, z }), "minecraft:air");
        return true;
    } catch {
        try {
            for (let y = yBot; y <= yTop; y++) {
                const b = dim.getBlock({ x, y, z });
                if (b && !b.isAir) b.setType("minecraft:air");
            }
            return true;
        } catch {
            return false;
        }
    }
}

function magmaAt(dim, x, y, z) {
    try { dim.getBlock({ x, y, z })?.setType("minecraft:magma"); } catch { }
}

// Полоса: отрезок строки (фикс. z) с почти одинаковым дном —
// один fillBlocks вместо десятков колонок. Строится один раз на детонацию.
function buildSphereStrips(center, R, minY, maxY) {
    const strips = [];
    const topAll = Math.min(maxY, center.y + R + CONFIG.bowlExtra);
    const cx = Math.floor(center.x), cz = Math.floor(center.z);
    for (let dz = -R; dz <= R; dz++) {
        const z = cz + dz;
        const rowMax = Math.floor(Math.sqrt(Math.max(0, R * R - dz * dz)));
        let seg = null;
        for (let dx = -rowMax; dx <= rowMax; dx++) {
            const d = Math.sqrt(dx * dx + dz * dz);
            const k = Math.sqrt(Math.max(0, 1 - (d / R) * (d / R)));
            const yBot = Math.max(minY, center.y - Math.floor(R * 0.5 * k));
            if (seg && Math.abs(yBot - seg.yBot) <= 3) {
                // сегмент тянем: дно меняется слабо
                seg.x1 = cx + dx;
                if (yBot < seg.yBot) seg.yBot = yBot;   // чуть глубже — без остатков
                seg.rMax = Math.max(seg.rMax, Math.round(d));
            } else {
                if (seg) strips.push(seg);
                seg = { x0: cx + dx, x1: cx + dx, z, yBot, yTop: topAll, rMax: Math.round(d) };
            }
        }
        if (seg) strips.push(seg);
    }
    // волна от центра к краю
    strips.sort((a, b) => a.rMax - b.rMax);
    return strips;
}

// одна попытка испарить полосу одним fillBlocks
function vaporizeStripAttempt(dim, st) {
    try {
        dim.fillBlocks(new BlockVolume({ x: st.x0, y: st.yBot, z: st.z }, { x: st.x1, y: st.yTop, z: st.z }), "minecraft:air");
        return true;
    } catch {
        try {
            for (let x = st.x0; x <= st.x1; x++) {
                for (let y = st.yBot; y <= st.yTop; y++) {
                    const b = dim.getBlock({ x, y, z: st.z });
                    if (b && !b.isAir) b.setType("minecraft:air");
                }
            }
            return true;
        } catch {
            return false;   // чанк не загружен
        }
    }
}

function startSphereWave(dim, center, R) {
    const minY = dim.heightRange.min + 6;
    const maxY = dim.heightRange.max - 1;
    const strips = buildSphereStrips(center, R, minY, maxY);
    const pending = [];                 // недостреленные полосы
    let idx = 0, lastRingMove = -RING_MOVE_STEP, lastFxRing = -1, lastPushRing = -1;

    const handle = system.runInterval(() => {
        // фаза 1: фронт из полос
        let done = 0;
        while (done < CONFIG.waveStripsPerStep && idx < strips.length) {
            const st = strips[idx++];

            if (st.rMax - lastRingMove >= RING_MOVE_STEP || lastRingMove < 0) {
                moveRingAreas(dim, center, st.rMax);
                lastRingMove = st.rMax;
            }
            // эффекты фронта для каждого пересечённого кольца
            for (let rr = lastFxRing + 1; rr <= st.rMax; rr++) ringFrontFx(dim, center, rr);
            if (st.rMax > lastPushRing) {
                playerFrontPush(dim, center, st.rMax, R);
                lastPushRing = st.rMax;
            }
            lastFxRing = Math.max(lastFxRing, st.rMax);

            if (vaporizeStripAttempt(dim, st)) {
                // магма на дне кратера (несколько точек на полосу)
                if (((st.rMax < 18 && Math.random() < 0.5) ||
                     (st.rMax > 38 && st.rMax < 44 && Math.random() < 0.3)) && st.yBot > minY) {
                    const cells = Math.min(5, st.x1 - st.x0 + 1);
                    for (let i = 0; i < cells; i++) {
                        const mx = st.x0 + Math.floor(Math.random() * (st.x1 - st.x0 + 1));
                        magmaAt(dim, mx, st.yBot, st.z);
                    }
                }
            } else if (pending.length < 20000) {
                pending.push(st);
            }
            done++;
        }

        // фаза 2: добивка — ротация очереди
        let pw = 0;
        while (pw < 8 && pending.length) {
            const st = pending.shift();
            if (vaporizeStripAttempt(dim, st)) {
                // добились
            } else {
                pending.push(st);
                if (pw >= pending.length) break;   // чанки ещё грузятся — ждём
            }
            pw++;
        }

        // пока есть недостреленные — подтягиваем тикающие области к ним
        if (idx >= strips.length && pending.length && (system.currentTick % 100 === 0)) {
            let sx = 0, sz = 0;
            const sample = Math.min(200, pending.length);
            for (let i = 0; i < sample; i++) { sx += (pending[i].x0 + pending[i].x1) / 2; sz += pending[i].z; }
            moveRingAreas(dim, { x: sx / sample, y: 0, z: sz / sample }, 24);
        }

        if (idx >= strips.length && !pending.length) {
            system.clearRun(handle);
            dropRingAreas(dim);
            scheduleVerifyPasses(dim, center, R, minY, maxY);
        }
    }, CONFIG.waveTicksPerStep);
}

function ringFrontFx(dim, center, r) {
    const steps = 26;
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = center.x + 0.5 + Math.cos(a) * r;
        const pz = center.z + 0.5 + Math.sin(a) * r;
        safeParticle(dim, "minecraft:basic_flame_particle", { x: px, y: center.y + rnd(0, 6), z: pz });
        safeParticle(dim, "minecraft:campfire_smoke_particle", { x: px, y: center.y + rnd(2, 14), z: pz });
        safeParticle(dim, "minecraft:basic_smoke_particle", { x: px, y: center.y + rnd(6, 22), z: pz });
    }
    if (r % 10 === 0 && r > 0) {
        const a = Math.random() * Math.PI * 2;
        safeParticle(dim, "minecraft:huge_explosion_emitter", { x: center.x + 0.5 + Math.cos(a) * r, y: center.y + 3, z: center.z + 0.5 + Math.sin(a) * r });
    }
    if (r % 25 === 0 && r > 0) {
        const a = Math.random() * Math.PI * 2;
        safeParticle(dim, "minecraft:sonic_explosion", { x: center.x + 0.5 + Math.cos(a) * r, y: center.y + 4, z: center.z + 0.5 + Math.sin(a) * r });
    }
    if (r % 16 === 0) {
        const a = Math.random() * Math.PI * 2;
        playSoundAt(dim, { x: center.x + Math.cos(a) * r, y: center.y, z: center.z + Math.sin(a) * r }, "random.explode", 6, detPitch(0.60, 0.04, r));
    }
}

function playerFrontPush(dim, center, r, R) {
    try {
        for (const p of dim.getPlayers({ location: center, maxDistance: R + 20 })) {
            const pd = dist3D(p.location, center);
            if (Math.abs(pd - r) < 10) {
                const inv = 1 / (pd || 1);
                knockbackCompat(p, (p.location.x - center.x) * inv, (p.location.z - center.z) * inv, 4, 1.4);
                try { p.camera.addShake({ intensity: 0.7, duration: 1 }); } catch { }
            }
        }
    } catch { }
}

// контрольные проходы: добиваем всё, что пропустили (незагруженные чанки и т.п.)
function scheduleVerifyPasses(dim, center, R, minY, maxY) {
    const cells = getDiscCells(R);
    const top = Math.min(maxY, center.y + R + CONFIG.bowlExtra);
    const columnList = [];
    for (const [r, ring] of cells) {
        for (const [dx, dz] of ring) {
            const d2 = (dx * dx + dz * dz) / (R * R);
            const k = Math.sqrt(Math.max(0, 1 - d2));
            const down = Math.floor(R * 0.5 * k);
            columnList.push([
                Math.floor(center.x + dx), Math.floor(center.z + dz),
                Math.max(minY, center.y - down), top
            ]);
        }
    }
    let pass = 0, idx = 0;

    // колонка чиста, если пробные блоки (дно+1, середина, верх-1) — воздух/магма
    const columnClean = (x, z, yBot, yTop) => {
        try {
            const probes = [yBot + 1, Math.floor((yBot + yTop) / 2), yTop - 1];
            for (const py of probes) {
                if (py <= yBot || py > yTop) continue;
                const b = dim.getBlock({ x, y: py, z });
                if (b && !b.isAir) return false;
            }
        } catch { return false; }
        return true;
    };

    const handle = system.runInterval(() => {
        let n = 0;
        while (n < 400 && idx < columnList.length) {
            const [x, z, yBot, yTop] = columnList[idx++];
            if (!columnClean(x, z, yBot, yTop)) {
                vaporizeColumnAttempt(dim, x, z, yBot + 1, yTop);
                // дно: накрываем мусор магмой
                try {
                    const b = dim.getBlock({ x, y: yBot, z });
                    if (b && !b.isAir && b.typeId !== "minecraft:magma") b.setType("minecraft:magma");
                } catch { }
            }
            n++;
        }
        if (idx >= columnList.length) {
            idx = 0;
            pass++;
            if (pass >= CONFIG.verifyPasses) {
                system.clearRun(handle);
                announceServer(dim, "§7☢ Зона взрыва стабилизирована.");
            }
        }
    }, 2);
}

// ----------------------------------------------------------------------------
// AAA-ВИЗУАЛ: огненный шар, base surge, гроза, искры
// ----------------------------------------------------------------------------
// огненный шар-купол: 0..4 сек, растёт от 5 до ~40 блоков
function startFireballDome(dim, center, R) {
    const total = 80;
    let t = 0;
    const handle = system.runInterval(() => {
        t += 2;
        const pr = 5 + (R * 0.42) * Math.min(1, t / total);   // радиус купола
        const rise = t / total;
        const cy = center.y + 6 + rise * rise * 26;           // купол всплывает
        const count = 16;
        for (let i = 0; i < count; i++) {
            // точки в объёме полусферы
            const a = Math.random() * Math.PI * 2;
            const rr = Math.sqrt(Math.random()) * pr;
            const hy = cy + Math.abs(Math.sin(a)) * pr * 0.55 * (1 - rr / pr);
            const px = center.x + Math.cos(a) * rr;
            const pz = center.z + Math.sin(a) * rr;
            const isFire = rr < pr * 0.6 || Math.random() < 0.4;
            safeParticle(dim, isFire ? "minecraft:basic_flame_particle" : "minecraft:campfire_smoke_particle",
                { x: px + rnd(-1, 1), y: hy, z: pz + rnd(-1, 1) });
        }
        if (t % 6 === 0) {
            safeParticle(dim, "minecraft:huge_explosion_emitter",
                { x: center.x + rnd(-pr * 0.4, pr * 0.4), y: cy + rnd(0, 6), z: center.z + rnd(-pr * 0.4, pr * 0.4) });
        }
        if (t >= total) system.clearRun(handle);
    }, 2);
}

// base surge: пыльное кольцо, стелющееся по земле 0..12 c, 5 -> R*1.15
function startBaseSurge(dim, center, R) {
    const total = 240;
    let t = 0;
    const handle = system.runInterval(() => {
        t += 2;
        const k = t / total;
        const r = 5 + (R * 1.15 - 5) * Math.sqrt(k);          // быстрый старт, замедление
        const steps = 44;
        for (let i = 0; i < steps; i++) {
            const a = (i / steps) * Math.PI * 2 + t * 0.01;
            const px = center.x + Math.cos(a) * r;
            const pz = center.z + Math.sin(a) * r;
            const white = i % 3 === 0;
            safeParticle(dim, white ? "minecraft:basic_smoke_particle" : "minecraft:campfire_smoke_particle",
                { x: px + rnd(-1, 1), y: center.y + rnd(0.5, 7 - 4 * k), z: pz + rnd(-1, 1) });
            if (i % 4 === 0) {
                safeParticle(dim, "minecraft:basic_flame_particle",
                    { x: px, y: center.y + rnd(0, 2.5), z: pz });
            }
        }
        if (t >= total) system.clearRun(handle);
    }, 2);
}

// гроза над эпицентром: 12 молний за ~9 секунд + гром
function startLightningStorm(dim, center) {
    for (let i = 0; i < 12; i++) {
        system.runTimeout(() => {
            try {
                dim.spawnEntity("minecraft:lightning_bolt",
                    { x: center.x + rnd(-55, 55), y: center.y, z: center.z + rnd(-55, 55) });
            } catch { }
        }, 4 + i * 15);
    }
}

// дождь искр по зоне: первые ~5 c
function startEmberRain(dim, center, R) {
    let t = 0;
    const handle = system.runInterval(() => {
        t++;
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * R * 0.8;
            safeParticle(dim, "minecraft:lava_particle", {
                x: center.x + Math.cos(a) * d, y: center.y + rnd(8, 40), z: center.z + Math.sin(a) * d
            });
        }
        if (t >= 100) system.clearRun(handle);
    }, 1);
}

// ----------------------------------------------------------------------------
// ЯДЕРНЫЙ ГРИБ
// ----------------------------------------------------------------------------
function startMushroomCloud(dim, center, R) {
    const rise = CONFIG.mushroomRiseTicks;
    const linger = CONFIG.mushroomLingerTicks;
    const total = rise + linger;
    const capR = R * 0.55;
    const H = Math.min(R * 1.7, 170);
    const t0 = center.y;
    let t = 0;

    // стартовая пыльная шапка по земле
    for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * R;
        safeParticle(dim, "minecraft:basic_smoke_particle", { x: center.x + Math.cos(a) * d, y: t0 + rnd(0, 3), z: center.z + Math.sin(a) * d });
    }

    const handle = system.runInterval(() => {
        t++;
        const riseP = Math.min(1, t / rise);
        const riseY = t0 + riseP * riseP * H;
        const capY = t0 + Math.min(riseP * 1.15, 1.15) * H;
        const grow = Math.min(1, t / (rise * 0.6));
        const cr = capR * grow;

        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = rnd(1, 4 + 7 * riseP);
            const hy = t0 + riseY * rnd(0.15, 1);
            safeParticle(dim, i % 3 === 0 ? "minecraft:campfire_smoke_particle" : "minecraft:basic_smoke_particle",
                { x: center.x + 0.5 + Math.cos(a) * rr, y: hy, z: center.z + 0.5 + Math.sin(a) * rr });
        }
        if (t % 2 === 0) {
            for (let i = 0; i < 4; i++) {
                const a = Math.random() * Math.PI * 2;
                safeParticle(dim, "minecraft:basic_flame_particle",
                    { x: center.x + 0.5 + Math.cos(a) * rnd(2, 9), y: t0 + rnd(0, 5), z: center.z + 0.5 + Math.sin(a) * rnd(2, 9) });
            }
        }

        if (t > rise * 0.1) {
            const rings = [1, 0.72, 0.45];
            for (let ri = 0; ri < rings.length; ri++) {
                const rr = cr * rings[ri];
                const steps = ri === 0 ? 26 : 18;
                for (let i = 0; i < steps; i++) {
                    const a = (i / steps) * Math.PI * 2 + t * 0.03 * (ri % 2 ? -1 : 1);
                    const px = center.x + 0.5 + Math.cos(a) * rr;
                    const pz = center.z + 0.5 + Math.sin(a) * rr;
                    safeParticle(dim, "minecraft:basic_smoke_particle", { x: px, y: capY + rnd(-2, ri === 0 ? 5 : 3), z: pz });
                    if (i % 3 === 0) safeParticle(dim, "minecraft:basic_flame_particle", { x: px, y: capY + rnd(-1, 2), z: pz });
                }
            }
            for (let i = 0; i < 4; i++) {
                safeParticle(dim, "minecraft:basic_smoke_particle",
                    { x: center.x + rnd(-cr * 0.4, cr * 0.4), y: capY + rnd(1, 8), z: center.z + rnd(-cr * 0.4, cr * 0.4) });
            }
            if (t % 6 === 0) {
                safeParticle(dim, "minecraft:huge_explosion_emitter",
                    { x: center.x + rnd(-cr, cr) * 0.6, y: capY + rnd(0, 4), z: center.z + rnd(-cr, cr) * 0.6 });
            }
        }

        if (t % 2 === 0) {
            safeParticle(dim, "minecraft:lava_particle",
                { x: center.x + rnd(-cr, cr) * 0.8, y: riseY + rnd(0, 10), z: center.z + rnd(-cr, cr) * 0.8 });
        }
        const a = Math.random() * Math.PI * 2;
        const dd = Math.sqrt(Math.random()) * R;
        safeParticle(dim, "minecraft:basic_smoke_particle", { x: center.x + Math.cos(a) * dd, y: t0 + rnd(0, 3), z: center.z + Math.sin(a) * dd });

        if (t >= total) system.clearRun(handle);
    }, 1);
}

// ----------------------------------------------------------------------------
// ОГНЕННЫЙ ШТОРМ
// ----------------------------------------------------------------------------
function startFirestorm(dim, center, R) {
    let placed = 0, attempts = 0;
    const maxY = dim.heightRange.max - 2;
    const handle = system.runInterval(() => {
        let n = 0;
        while (n < 4 && placed < CONFIG.firesCount && attempts < 700) {
            attempts++; n++;
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * R * 0.85;
            const x = Math.floor(center.x + Math.cos(a) * d);
            const z = Math.floor(center.z + Math.sin(a) * d);
            let y = Math.min(maxY, center.y + 60);
            let found = false;
            for (let i = 0; i < 80; i++, y--) {
                try {
                    const b = dim.getBlock({ x, y, z });
                    if (b && !b.isAir && !b.isLiquid) { found = true; break; }
                } catch { break; }
            }
            if (!found) continue;
            try {
                const above = dim.getBlock({ x, y: y + 1, z });
                if (above && above.isAir) { above.setType("minecraft:fire"); placed++; }
            } catch { }
        }
        if (placed >= CONFIG.firesCount || attempts >= 700) system.clearRun(handle);
    }, 4);
}

// ----------------------------------------------------------------------------
// РАДИАЦИЯ
// ----------------------------------------------------------------------------
const SPECK_CHARS = ["·", "•", "▪", "·", "•", ":", "."];

function speckleString(density) {
    let s = "§f";
    for (let i = 0; i < 34; i++) {
        s += Math.random() < density ? SPECK_CHARS[(Math.random() * SPECK_CHARS.length) | 0] : " ";
    }
    return s;
}

function geigerRate(d) {
    if (d < 30) return 0.55;
    if (d < 60) return 0.30;
    if (d < 100) return 0.14;
    return 0.06;
}

function radiationFxTick() {
    const nowTick = system.currentTick;
    for (const [pid, info] of [...irradiated]) {
        if (info.untilTick <= nowTick) { irradiated.delete(pid); continue; }
        try {
            const p = world.getEntity(pid);
            if (!p || p.typeId !== "minecraft:player") { irradiated.delete(pid); continue; }
            const d = dist3D(p.location, info.center);
            const density = d < 30 ? 0.34 : d < 60 ? 0.20 : 0.10;
            const left = Math.ceil((info.untilTick - nowTick) / 20);
            const timer = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
            p.onScreenDisplay.setActionBar(speckleString(density) + " §2☢" + timer);
            if (Math.random() < geigerRate(d)) {
                p.playSound("nuclear.geiger", { volume: 0.7, pitch: rnd(0.85, 1.2) });
            }
        } catch { irradiated.delete(pid); }
    }
}

function radiationTick() {
    for (let i = radiationZones.length - 1; i >= 0; i--) {
        const zone = radiationZones[i];
        zone.ticksLeft -= 20;
        if (zone.ticksLeft <= 0) {
            messagePlayersAround(zone.dim, zone.center, zone.radius, "§a☢ Радиация в зоне взрыва спала.");
            radiationZones.splice(i, 1);
            continue;
        }

        // ── сирена тревоги НЕ умолкает после взрыва: цикл всю зону радиации
        zone.sirenTimer = (zone.sirenTimer ?? CONFIG.sirenEveryTicks) - 20;
        if (zone.sirenTimer <= 0) {
            zone.sirenTimer = CONFIG.sirenEveryTicks;
            const vol = zone.ticksLeft > (CONFIG.radiationSeconds - 120) * 20 ? 1.0 : 0.6;
            soundAtPlayers(zone.dim, zone.center, "nuclear.siren", vol, 1);
        }
        let ents = [];
        try { ents = zone.dim.getEntities({ location: zone.center, maxDistance: zone.radius }); } catch { }
        for (const e of ents) {
            const d = dist3D(e.location, zone.center);
            try {
                if (d < 25) {
                    e.addEffect("wither", 60, { amplifier: 1 });
                    e.addEffect("poison", 100, { amplifier: 2 });
                    e.addEffect("nausea", 200, { amplifier: 0 });
                    e.addEffect("hunger", 200, { amplifier: 1 });
                } else if (d < 60) {
                    e.addEffect("poison", 160, { amplifier: 1 });
                    e.addEffect("weakness", 200, { amplifier: 0 });
                    e.addEffect("hunger", 200, { amplifier: 0 });
                } else {
                    e.addEffect("poison", 120, { amplifier: 0 });
                    if (Math.random() < 0.3) e.addEffect("hunger", 160, { amplifier: 0 });
                }
            } catch { }
        }
        try {
            for (const p of zone.dim.getPlayers({ location: zone.center, maxDistance: zone.radius })) {
                irradiated.set(p.id, { center: zone.center, untilTick: system.currentTick + Math.max(40, zone.ticksLeft) });
            }
        } catch { }
        for (let k = 0; k < 4; k++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.random() * zone.radius;
            safeParticle(zone.dim, "minecraft:basic_smoke_particle", {
                x: zone.center.x + Math.cos(a) * d, y: zone.center.y + Math.random() * 20, z: zone.center.z + Math.sin(a) * d
            });
        }

        // ── ПЕПЛОПАД: серые и белые хлопья над игроками в зоне ( densely у эпицентра )
        const fade = Math.min(1, zone.ticksLeft / (60 * 20));   // в последнюю минуту редеет
        try {
            for (const p of zone.dim.getPlayers({ location: zone.center, maxDistance: zone.radius })) {
                const near = dist3D(p.location, zone.center);
                const flakes = near < 40 ? 10 : near < 70 ? 7 : 4;
                for (let k = 0; k < flakes * fade; k++) {
                    const name = Math.random() < 0.62 ? "minecraft:ash_particle"
                               : (Math.random() < 0.6 ? "minecraft:white_ash_particle" : "minecraft:black_ash_particle");
                    safeParticle(zone.dim, name, {
                        x: p.location.x + rnd(-13, 13),
                        y: p.location.y + rnd(4, 11),
                        z: p.location.z + rnd(-13, 13)
                    });
                }
                // редкие тлеющие угольки ближе к эпицентру
                if (near < 45 && Math.random() < 0.35) {
                    safeParticle(zone.dim, "minecraft:basic_flame_particle", {
                        x: p.location.x + rnd(-10, 10), y: p.location.y + rnd(0, 6), z: p.location.z + rnd(-10, 10)
                    });
                }
            }
        } catch { }
    }
}

// ----------------------------------------------------------------------------
// ДЕТОНАЦИЯ
// ----------------------------------------------------------------------------
function detonate(entry) {
    if (!entry || entry.detonated) return;
    entry.detonated = true;
    dropKeepArea(entry);
    charges.delete(keyOf(entry.dimId, entry.pos));

    const dim = entry.dim;
    const cx = entry.pos.x + 0.5;
    const cy = entry.pos.y;
    const cz = entry.pos.z + 0.5;
    const center = { x: cx, y: cy, z: cz };
    const R = CONFIG.explosionRadius;

    doFlash(dim, center, 350);
    doShake(dim, center, 280);

    // глобальный звук: над головой каждого игрока (в этом измерении и в других)
    soundAtPlayers(dim, center, "nuclear.boom", 1, 1);
    soundAtPlayers(dim, center, "ambient.weather.thunder", 1, 0.4);
    playSoundAt(dim, center, "random.explode", 30, 0.5);

    try { dim.createExplosion(center, CONFIG.coreExplosionRadius, { breaksBlocks: true, causesFire: false }); } catch { }

    safeParticle(dim, "minecraft:knockback_roar_particle", { x: cx, y: cy + 1, z: cz });
    safeParticle(dim, "minecraft:sonic_explosion", { x: cx, y: cy + 2, z: cz });
    // горизонтальная ударная линия
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        safeParticle(dim, "minecraft:huge_explosion_emitter", { x: cx + Math.cos(a) * 12, y: cy + 2, z: cz + Math.sin(a) * 12 });
    }
    // AAA: огненный шар-купол, base surge, гроза, искры
    startFireballDome(dim, center, R);
    startBaseSurge(dim, center, R);
    startLightningStorm(dim, center);
    startEmberRain(dim, center, R);

    // волна разрушения (вертикальный столб сажи/дыма над эпицентром на старте)
    for (let i = 0; i < 30; i++) {
        safeParticle(dim, i % 2 ? "minecraft:campfire_smoke_particle" : "minecraft:basic_flame_particle",
            { x: cx + rnd(-2, 2), y: cy + i * 2.5, z: cz + rnd(-2, 2) });
    }
    system.runTimeout(() => startSphereWave(dim, center, R), 15);

    shockwaveDamage(dim, center, R);

    // цепная реакция
    for (const [key, other] of [...charges]) {
        if (other === entry || other.dimId !== entry.dimId || other.detonated) continue;
        const d = dist3D(other.pos, entry.pos);
        if (d <= R) {
            charges.delete(key);
            other.detonated = true;
            system.runTimeout(() => detonate(other), 20 + Math.floor(d * CONFIG.waveTicksPerStep));
        }
    }

    startMushroomCloud(dim, center, R);
    system.runTimeout(() => startFirestorm(dim, center, R), R * CONFIG.waveTicksPerStep + 120);

    radiationZones.push({ dimId: entry.dimId, dim, center, radius: R, ticksLeft: CONFIG.radiationSeconds * 20 });
    announceServer(dim, "§4☢☢☢ ЯДЕРНЫЙ ВЗРЫВ ☢☢☢");
}

// ----------------------------------------------------------------------------
// ПУСКОВАЯ СТАНЦИЯ
// ----------------------------------------------------------------------------
function registerStation(block) {
    if (!isStationId(block.typeId)) return null;
    const pos = { x: block.location.x, y: block.location.y, z: block.location.z };
    const dim = block.dimension;
    const key = keyOf(dim.id, pos);
    let st = stations.get(key);
    if (!st) {
        st = { dimId: dim.id, dim, pos, loaded: block.typeId === STATION_LOADED, target: undefined, launching: false };
        stations.set(key, st);
    } else {
        st.dim = dim;
        st.loaded = block.typeId === STATION_LOADED;
    }
    return st;
}

function setStationBlock(st, loaded) {
    try { st.dim.getBlock(st.pos)?.setType(loaded ? STATION_LOADED : STATION_ID); } catch { }
}

function stationStatusText(st) {
    if (st.launching) return "§c▶ РАКЕТА В ПОЛЁТЕ";
    if (!st.loaded) return "§7Отсек пуст — вставьте §fЯдерный заряд§7.";
    if (!st.target) return "§eЗаряд установлен. §7Цель не задана.";
    const t = st.target;
    return `§aГотов к пуску §7→ цель §f${t.x}, ${t.y}, ${t.z}§7 (§e${Math.round(dist3D(t, st.pos))}м§7)`;
}

function showStationMenu(player, st) {
    const actions = [];
    if (!st.launching) {
        if (!st.loaded) actions.push("insert"); else actions.push("extract");
        actions.push("marker");
    }
    if (st.loaded && st.target && !st.launching) actions.push("launch");
    actions.push("close");

    const form = new ActionFormData()
        .title("Пусковая станция")
        .body(stationStatusText(st) +
            "\n\n§8Как целиться: поставьте §fЦель-метку§8 в точке удара и выберите её здесь. Клавиатура не нужна.");
    for (const a of actions) {
        if (a === "insert") form.button("Вставить ядерный заряд (в руке)");
        if (a === "extract") form.button("Извлечь заряд");
        if (a === "marker") form.button("🎯 Выбрать ближайшую цель-метку");
        if (a === "launch") form.button("§c► ПУСК ◄");
        if (a === "close") form.button("Закрыть");
    }
    showForm(player, form).then((resp) => {
        if (!resp || resp.canceled) return;
        const act = actions[resp.selection];
        if (act === "insert") insertCharge(player, st);
        else if (act === "extract") extractCharge(player, st);
        else if (act === "marker") selectMarker(player, st);
        else if (act === "launch") doLaunch(player, st);
    }).catch(() => { });
}

// выбор ближайшей цели-метки (клавиатура не нужна — всё блоками)
function selectMarker(player, st) {
    let best = null, bestD = CONFIG.missileMaxRange;
    for (const [key, m] of targetMarkers) {
        if (m.dimId !== st.dimId) continue;
        // метку могли сломать в прошлой сессии — проверяем, если чанк загружен
        try {
            const b = st.dim.getBlock({ x: m.x, y: m.y, z: m.z });
            if (b && b.typeId !== MARKER_ID) { targetMarkers.delete(key); saveMarkers(); continue; }
        } catch { /* чанк не загружен — верим реестру */ }
        const d = dist3D(m, st.pos);
        if (d < bestD) { bestD = d; best = { key, pos: m }; }
    }
    if (!best) {
        player.sendMessage(`§7В радиусе §e${CONFIG.missileMaxRange}§7 блоков нет целей-меток. Скрафтите и поставьте блок §fЦель-метка§7 в точке удара.`);
        return;
    }
    if (bestD < CONFIG.missileMinRange) {
        player.sendMessage(`§cМетка слишком близко: минимальная дальность ${CONFIG.missileMinRange} блоков.`);
        return;
    }
    st.target = { x: best.pos.x, y: best.pos.y, z: best.pos.z };
    st.targetMarkerKey = best.key;
    player.sendMessage(`§a🎯 Метка принята: §f${st.target.x}, ${st.target.y}, ${st.target.z}§7 (§e${Math.round(bestD)}§7 м). Готов к пуску.`);
}

function insertCharge(player, st) {
    const equippable = player.getComponent("minecraft:equippable");
    let item = undefined;
    try { item = equippable?.getEquipment("Mainhand"); } catch { }
    if (!item || item.typeId !== CHARGE_ID) {
        player.sendMessage("§7Возьмите §fЯдерный заряд§7 в руку и повторите.");
        return;
    }
    try {
        const inv = player.getComponent("minecraft:inventory");
        inv.container.setItem(player.selectedSlotIndex, undefined);
    } catch { }
    st.loaded = true;
    setStationBlockWithRetry(st, true, 3);
    playSoundAt(st.dim, st.pos, "note.block", 2, 0.8);
    player.sendMessage("§a☢ Заряд установлен в станцию.");
}

function extractCharge(player, st) {
    if (!st.loaded) return;
    st.loaded = false;
    setStationBlockWithRetry(st, false, 3);
    try {
        player.getComponent("minecraft:inventory").container.addItem(new ItemStack(CHARGE_ID, 1));
        player.sendMessage("§aЗаряд извлечён в инвентарь.");
    } catch {
        try { st.dim.spawnItem(new ItemStack(CHARGE_ID, 1), { x: st.pos.x + 0.5, y: st.pos.y + 1.5, z: st.pos.z + 0.5 }); } catch { }
    }
    playSoundAt(st.dim, st.pos, "note.block", 2, 1.1);
}

function setStationBlockWithRetry(st, loaded, attempts) {
    setStationBlock(st, loaded);
    if (attempts <= 0) return;
    system.runTimeout(() => {
        try {
            const b = st.dim.getBlock(st.pos);
            if (b && b.typeId !== (loaded ? STATION_LOADED : STATION_ID) && isStationId(b.typeId)) {
                setStationBlockWithRetry(st, loaded, attempts - 1);
            }
        } catch { setStationBlockWithRetry(st, loaded, attempts - 1); }
    }, 10);
}

// ---------- ПУСК: видимая ракета летит по дуге ----------
function doLaunch(player, st) {
    if (st.launching || !st.loaded || !st.target) return;
    const target = { ...st.target };
    st.launching = true;
    st.loaded = false;
    setStationBlock(st, false);   // станция опустела (ракета ушла)

    const dim = st.dim;
    const start = { x: st.pos.x + 0.5, y: st.pos.y + 1.2, z: st.pos.z + 0.5 };
    const apexY = Math.max(start.y, target.y) + 110 + Math.min(60, dist3D(target, st.pos) / 40);
    const mid = { x: (start.x + target.x) / 2, y: apexY, z: (start.z + target.z) / 2 };
    const dist = dist3D(target, st.pos);
    const flightTicks = clamp(Math.round((4 + dist / 45) * 20), 100, 500);

    announceServer(dim, `§6🚀 ПУСК! §7Ядерный удар по §f${target.x}, ${target.y}, ${target.z}§7 через §e${Math.ceil(flightTicks / 20)}§7 c.`);
    soundAtPlayers(dim, start, "mob.ghast.fireball", 1, 0.7);
    playSoundAt(dim, start, "fire.ignite", 8, 0.6);

    // стартовый пыльной столб под станцией
    for (let i = 0; i < 24; i++) {
        safeParticle(dim, "minecraft:campfire_smoke_particle",
            { x: start.x + rnd(-1.5, 1.5), y: start.y - 1 - i * 0.4, z: start.z + rnd(-1.5, 1.5) });
    }

    // видимая ракета: кастомная сущность (корпус, конус, стабилизаторы)
    let rocket = undefined;
    try { rocket = dim.spawnEntity("nuclear:missile", start); } catch { }

    const t0 = system.currentTick;
    const P0 = start, P1 = mid, P2 = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    const bezier = (t) => ({
        x: (1 - t) * (1 - t) * P0.x + 2 * (1 - t) * t * P1.x + t * t * P2.x,
        y: (1 - t) * (1 - t) * P0.y + 2 * (1 - t) * t * P1.y + t * t * P2.y,
        z: (1 - t) * (1 - t) * P0.z + 2 * (1 - t) * t * P1.z + t * t * P2.z,
    });
    const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };

    const handle = system.runInterval(() => {
        const elapsed = system.currentTick - t0;
        const tt = clamp(elapsed / flightTicks, 0, 1);
        const pos = bezier(tt);
        const nxt = bezier(Math.min(1, tt + 0.012));
        const dir = norm({ x: nxt.x - pos.x, y: nxt.y - pos.y, z: nxt.z - pos.z });

        // ориентируем ракету носом по вектору скорости
        try {
            rocket?.teleport(pos, { dimension: dim, facingLocation: { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z } });
        } catch { try { rocket?.teleport(pos, { dimension: dim }); } catch { } }

        // ── шлейф из хвоста ракеты
        const tail = { x: pos.x - dir.x * 1.3, y: pos.y - dir.y * 1.3, z: pos.z - dir.z * 1.3 };
        safeParticle(dim, "minecraft:basic_flame_particle", { x: tail.x + rnd(-0.2, 0.2), y: tail.y + rnd(-0.2, 0.2), z: tail.z + rnd(-0.2, 0.2) });
        safeParticle(dim, "minecraft:basic_flame_particle", { x: tail.x + rnd(-0.35, 0.35), y: tail.y + rnd(-0.35, 0.35), z: tail.z + rnd(-0.35, 0.35) });
        safeParticle(dim, "minecraft:campfire_smoke_particle", { x: tail.x + rnd(-0.5, 0.5), y: tail.y - 0.6, z: tail.z + rnd(-0.5, 0.5) });
        safeParticle(dim, "minecraft:basic_smoke_particle", { x: tail.x + rnd(-0.8, 0.8), y: tail.y - 1.2, z: tail.z + rnd(-0.8, 0.8) });
        if (elapsed % 3 === 0) safeParticle(dim, "minecraft:lava_particle", { x: tail.x, y: tail.y, z: tail.z });

        // ── рёв двигателя + вспышки выхлопа
        if (elapsed % 10 === 0) playSoundAt(dim, pos, "mob.blaze.shoot", 6, detPitch(0.45, 0.025, elapsed));
        if (elapsed % 25 === 0) safeParticle(dim, "minecraft:huge_explosion_emitter", { x: tail.x, y: tail.y - 1, z: tail.z });

        if (tt >= 1) {
            system.clearRun(handle);
            // ракета входит в цель: огненная вспышка и удаление
            for (let i = 0; i < 10; i++) {
                safeParticle(dim, "minecraft:basic_flame_particle",
                    { x: pos.x + rnd(-1.5, 1.5), y: pos.y + rnd(-1.5, 1.5), z: pos.z + rnd(-1.5, 1.5) });
            }
            safeParticle(dim, "minecraft:huge_explosion_emitter", pos);
            try { rocket?.remove(); } catch { }
            st.launching = false;
            st.target = undefined;
            st.targetMarkerKey = undefined;
            impact(dim, target);
        }
    }, 1);
}

// прибытие ракеты: локальный бум + виртуальный заряд с таймером 8 c
function impact(dim, target) {
    const center = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    try { dim.createExplosion(center, 12, { breaksBlocks: true, causesFire: true }); } catch { }
    playSoundAt(dim, center, "random.explode", 20, 0.8);
    announceServer(dim, "§c☢ Боевая часть в точке цели! Готовится детонация заряда...");

    const virtual = {
        dimId: dim.id, dim,
        pos: { x: target.x, y: target.y, z: target.z },
        state: "armed", ticksLeft: 8 * 20, blinkOn: false,
        detonated: false, redstonePowered: false, keepArea: undefined,
        virtual: true
    };
    charges.set(keyOf(dim.id, virtual.pos), virtual);
}

// ----------------------------------------------------------------------------
// СОБЫТИЯ
// ----------------------------------------------------------------------------
try { world.afterEvents.playerPlaceBlock?.subscribe((ev) => { registerCharge(ev.block); registerStation(ev.block); registerMarker(ev.block); }); } catch { }
try {
    world.afterEvents.blockPlace?.subscribe((ev) => {
        if (!ev.block) return;
        registerCharge(ev.block);
        registerStation(ev.block);
        registerMarker(ev.block);
    });
} catch { }

try {
    world.afterEvents.playerBreakBlock?.subscribe((ev) => {
        const id = ev.brokenBlockPermutation?.id ?? "";
        if (isChargeId(id)) {
            const key = keyOf(ev.dimension.id, ev.block.location);
            const entry = charges.get(key);
            if (entry) { dropKeepArea(entry); charges.delete(key); }
        }
        // станция: заряженная роняет заряд
        if (id === STATION_LOADED) {
            try {
                ev.dimension.spawnItem(new ItemStack(CHARGE_ID, 1),
                    { x: ev.block.location.x + 0.5, y: ev.block.location.y + 1, z: ev.block.location.z + 0.5 });
            } catch { }
        }
        if (id === MARKER_ID) {
            unregisterMarker(ev.dimension.id, ev.block.location);
        }
        if (isStationId(id)) {
            stations.delete(keyOf(ev.dimension.id, ev.block.location));
        }
    });
} catch { }

try {
    world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
        const block = ev.block;
        if (!block) return;

        // заряд: кремень / обезвреживание
        if (isChargeId(block.typeId)) {
            ev.cancel = true;
            const flint = ev.itemStack?.typeId === "minecraft:flint_and_steel";
            const player = ev.player;
            system.run(() => {
                const entry = registerCharge(block);
                if (!entry) return;
                if (flint) {
                    if (entry.state === "armed") {
                        player.sendMessage("§7Заряд уже активирован — отойдите или обезвредьте (ПКМ рукой).");
                    } else {
                        armCharge(entry, CONFIG.flintTimerSeconds * 20);
                    }
                } else if (entry.state === "armed") {
                    disarmCharge(entry, player);
                } else {
                    player.sendMessage("§7Подожгите §fкремнем и огнивом§7, подайте §fкрасный камень§7 или вставьте в §fпусковую станцию§7.");
                }
            });
            return;
        }

        // станция: меню
        if (isStationId(block.typeId)) {
            ev.cancel = true;
            const player = ev.player;
            system.run(() => {
                const st = registerStation(block);
                if (!st || st.launching) return;
                // если в руке заряд и станция пуста — сразу вставляем
                if (!st.loaded && ev.itemStack?.typeId === CHARGE_ID) {
                    insertCharge(player, st);
                    return;
                }
                showStationMenu(player, st);
            });
        }
    });
} catch { }

try {
    world.afterEvents.itemUse.subscribe((ev) => {
        if (ev.itemStack?.typeId !== DETONATOR_ID) return;
        const player = ev.source;
        if (!player) return;
        system.run(() => {
            try {
                const dim = player.dimension;
                let best = null, bestD = CONFIG.remoteSearchRadius;
                for (const c of charges.values()) {
                    if (c.dimId !== dim.id || c.detonated || c.virtual) continue;
                    const d = dist3D(c.pos, player.location);
                    if (d < bestD) { bestD = d; best = c; }
                }
                if (!best) {
                    player.sendMessage(`§7Рядом (§e${CONFIG.remoteSearchRadius}§7 блоков) нет зарядов.`);
                    return;
                }
                if (best.state === "armed") {
                    player.sendMessage("§c📡 Команда на подрыв отправлена!");
                    detonate(best);
                } else {
                    armCharge(best, CONFIG.remoteTimerSeconds * 20);
                    player.sendMessage(`§e📡 Пульт: заряд приведён в боевую готовность (§c${CONFIG.remoteTimerSeconds}§e сек.).`);
                }
            } catch { }
        });
    });
} catch { }

// ----------------------------------------------------------------------------
// СТАРТ
// ----------------------------------------------------------------------------
world.afterEvents.worldLoad.subscribe(() => {
    cleanupLeftoverAreas(world.getDimension("overworld"));
    loadMarkers();
    system.runInterval(countdownTick, 1);
    system.runInterval(redstonePoll, 4);
    system.runInterval(radiationTick, 20);
    system.runInterval(radiationFxTick, 2);
    // «пыльца» целей-меток: парящие искры над каждой меткой
    system.runInterval(() => {
        let i = 0;
        for (const [, m] of targetMarkers) {
            if (++i > 40) break;                      // лимит частиц
            try {
                const dim = world.getDimension(m.dimId);
                const bx = m.x + 0.5, by = m.y + 0.9, bz = m.z + 0.5;
                safeParticle(dim, "minecraft:endrod", { x: bx + rnd(-0.8, 0.8), y: by + rnd(0, 1.5), z: bz + rnd(-0.8, 0.8) });
                if (Math.random() < 0.3) safeParticle(dim, "minecraft:redstone_wire_dust_particle",
                    { x: bx + rnd(-1, 1), y: by + rnd(0, 1.8), z: bz + rnd(-1, 1) });
            } catch { }
        }
    }, 8);
});
