// Дымовой тест v1.4: маркер-цель без клавиатуры, чаша-цилиндр, добивка с ротацией
import { world, system, dimension, testPlayer, stats, errors } from "@minecraft/server";

await import("../nuclear_addon/NuclearCharge_BP/scripts/main.js");

const pass = [], fail = [];
const check = (name, cond) => (cond ? pass : fail).push(name + (cond ? "" : " <<<"));
const flush = () => new Promise((r) => setTimeout(r, 30));
async function runTicks(n) {
    for (let i = 0; i < n; i++) {
        system.__tick(1);
        await new Promise((r) => setTimeout(r, 2));
    }
    await flush();
}

world.afterEvents.worldLoad._fire({});
check("markers loaded", true);

// ---------- заряд ----------
const charge = dimension.getBlock({ x: 0, y: 64, z: 0 });
charge.setType("nuclear:nuclear_charge");
world.afterEvents.blockPlace._fire({ block: charge, previousBlock: undefined, dimension });

const lever = dimension.getBlock({ x: 1, y: 64, z: 0 });
lever.typeId = "minecraft:lever";
lever.getProperty = (n) => (n === "open_button_state" ? true : undefined);
system.__tick(6);
check("redstone arms", charge.typeId === "nuclear:nuclear_charge_armed");

world.beforeEvents.playerInteractWithBlock._fire({
    block: charge, itemStack: undefined, player: testPlayer, cancel: false, isFirstEvent: true,
});
system.__tick(6);
check("disarm works", charge.typeId === "nuclear:nuclear_charge");

world.beforeEvents.playerInteractWithBlock._fire({
    block: charge, itemStack: { typeId: "minecraft:flint_and_steel" },
    player: testPlayer, cancel: false, isFirstEvent: true,
});
system.__tick(2);
check("flint arms", charge.typeId === "nuclear:nuclear_charge_armed");

dimension.unloadedChunks = true;
system.__tick(21 * 20);
dimension.unloadedChunks = false;
check("detonated while away", stats.explosions >= 1);

// ---------- станция + маркер ----------
const station = dimension.getBlock({ x: 200, y: 64, z: 200 });
station.setType("nuclear:launch_station");
world.afterEvents.blockPlace._fire({ block: station, previousBlock: undefined, dimension });

const marker = dimension.getBlock({ x: 320, y: 70, z: 60 });
marker.setType("nuclear:target_marker");
world.afterEvents.blockPlace._fire({ block: marker, previousBlock: undefined, dimension });

testPlayer.heldItem = { typeId: "nuclear:nuclear_charge" };
world.beforeEvents.playerInteractWithBlock._fire({
    block: station, itemStack: testPlayer.heldItem, player: testPlayer, cancel: false, isFirstEvent: true,
});
system.__tick(3);
check("charge inserted -> loaded", station.typeId === "nuclear:launch_station_loaded");
testPlayer.heldItem = undefined;

// UserBusy: первая попытка меню отклоняется -> ретрай -> выбор метки (индекс 1)
globalThis.__busyActionForms = 1;
globalThis.__formSelection = 1;
world.beforeEvents.playerInteractWithBlock._fire({
    block: station, itemStack: undefined, player: testPlayer, cancel: false, isFirstEvent: true,
});
await runTicks(35);
check("UserBusy retry -> menu shown", true);
check("marker target accepted", (stats.lastMsg || "").includes("Метка принята"));
check("marker coords correct", (stats.lastMsg || "").includes("320, 70, 60"));

// меню заряженной станции с целью: [extract, marker, launch, close] -> ПУСК = индекс 2
globalThis.__formSelection = 2;
world.beforeEvents.playerInteractWithBlock._fire({
    block: station, itemStack: undefined, player: testPlayer, cancel: false, isFirstEvent: true,
});
await runTicks(10);
check("missile in flight / station empty", station.typeId === "nuclear:launch_station");
check("visible missile entity spawned", (stats.spawnedTypes || []).includes("nuclear:missile"));

// полёт ~184 м => ~162 тика, потом подрыв боеголовки
await runTicks(220);
check("impact explosion", stats.explosions >= 2);
check("rocket flew with facing + trail", stats.facing === true && (stats.teleports || 0) > 150 && stats.rocketRemoved === true);

// виртуальный заряд 8 c -> ядерная детонация
await runTicks(200);
check("nuclear detonation at marker", stats.explosions >= 3);

// полный цикл: чаша-цилиндр, добивка, верификация, гриб, радиация
await runTicks(3200);

if (errors.length) {
    console.log("FAIL: runtime errors:", errors.slice(0, 4));
    process.exit(1);
}
check("geiger clicks", (stats.playerSounds || 0) > 10);
check("actionbar radiation", typeof stats.lastBar === "string" && stats.lastBar.includes("☢"));
check("big sphere processed", (stats.filled || 0) > 2_000_000);
check("marker pollen particles", (stats.particles || 0) > 100000);
check("ASHFALL over radiation zone", (stats.ashCount || 0) > 50);
// сирена продолжает выть в зоне радиации: в командах есть nuclear.siren ПОСЛЕ детонации
const boomTick = (stats.explosionTicks || [])[0] ?? 0;
const sirenAfter = (stats.soundLog || []).some(([id, tick]) => id === "nuclear.siren" && tick > boomTick + 100);
check("siren continues AFTER explosion", sirenAfter);

console.log("PASS:", pass.length, "| FAIL:", fail.length);
for (const p of pass) console.log("  ✔", p);
for (const f of fail) console.log("  ✘", f);
console.log("STATS:", JSON.stringify({ ...stats, lastCmds: undefined }));
process.exit(fail.length ? 1 : 0);
