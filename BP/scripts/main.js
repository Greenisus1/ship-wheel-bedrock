// ShipWheel for Minecraft Bedrock (script API @minecraft/server 2.8.0). MIT, Greenisus1.
// Right-click a Ship Wheel block that is part of a build to start driving it.
// Move with forward/back/strafe keys; the build goes the way you LOOK (nearest compass direction). Sneak to stop.
// Limits: no rotation of the build, containers (chests, furnaces) stay behind, built from stepped block moves (about 5 per second).
import { world, system, BlockPermutation } from "@minecraft/server";

const WHEEL = "shipwheel:ship_wheel";
const MAX_BLOCKS = 2500;
const NOT_PART = new Set([
  "minecraft:air", "minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava",
  "minecraft:stone", "minecraft:dirt", "minecraft:grass_block", "minecraft:sand", "minecraft:gravel", "minecraft:sandstone",
  "minecraft:red_sand", "minecraft:clay", "minecraft:snow", "minecraft:ice", "minecraft:deepslate", "minecraft:bedrock",
  "minecraft:netherrack", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:mud",
  "minecraft:podzol", "minecraft:mycelium", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:grass_path",
  "minecraft:smooth_stone", "minecraft:polished_andesite",
]);
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const drivers = new Map(); // player id -> vehicle

function key(x, y, z) { return x + "," + y + "," + z; }
function blockAt(dim, x, y, z) { try { return dim.getBlock({ x, y, z }); } catch { return undefined; } }

function isPart(b) {
  if (!b || NOT_PART.has(b.typeId)) return false;
  if (b.typeId === WHEEL) return true;
  try { if (b.getComponent("minecraft:inventory")) return false; } catch { /* no inventory */ }
  return !b.isLiquid;
}

function assemble(dim, wheel) {
  const cells = [];
  const seen = new Set([key(wheel.x, wheel.y, wheel.z)]);
  const queue = [wheel];
  while (queue.length && cells.length < MAX_BLOCKS) {
    const b = queue.shift();
    cells.push({ dx: b.x - wheel.x, dy: b.y - wheel.y, dz: b.z - wheel.z, perm: b.permutation });
    for (const [ax, ay, az] of DIRS) {
      const n = blockAt(dim, b.x + ax, b.y + ay, b.z + az);
      if (!n) continue;
      const k = key(n.x, n.y, n.z);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isPart(n)) queue.push(n);
    }
  }
  return cells.length > 1 ? { dim, x: wheel.x, y: wheel.y, z: wheel.z, cells } : undefined;
}

function ownSet(v) { const s = new Set(); for (const c of v.cells) s.add(key(v.x + c.dx, v.y + c.dy, v.z + c.dz)); return s; }

function free(dim, x, y, z, own) {
  if (own.has(key(x, y, z))) return true;
  const b = blockAt(dim, x, y, z);
  if (!b) return false;
  return b.isAir || b.isLiquid || b.typeId === "minecraft:snow_layer";
}

function ridersOf(v) {
  const out = [];
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== v.dim.id) continue;
    const l = p.location;
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0, maxY = 0;
    for (const c of v.cells) { minX = Math.min(minX, c.dx); maxX = Math.max(maxX, c.dx); minZ = Math.min(minZ, c.dz); maxZ = Math.max(maxZ, c.dz); maxY = Math.max(maxY, c.dy); }
    if (l.x >= v.x + minX - 0.5 && l.x <= v.x + maxX + 1.5 && l.z >= v.z + minZ - 0.5 && l.z <= v.z + maxZ + 1.5 && l.y >= v.y - 6 && l.y <= v.y + maxY + 3) out.push(p);
  }
  return out;
}

function shift(v, dx, dy, dz) {
  const own = ownSet(v);
  for (const c of v.cells) if (!free(v.dim, v.x + c.dx + dx, v.y + c.dy + dy, v.z + c.dz + dz, own)) return false;
  const riders = ridersOf(v);
  for (const c of v.cells) { const b = blockAt(v.dim, v.x + c.dx, v.y + c.dy, v.z + c.dz); if (b) b.setPermutation(BlockPermutation.resolve("minecraft:air")); }
  for (const c of v.cells) { const b = blockAt(v.dim, v.x + c.dx + dx, v.y + c.dy + dy, v.z + c.dz + dz); if (b) b.setPermutation(c.perm); }
  v.x += dx; v.y += dy; v.z += dz;
  for (const p of riders) { const l = p.location; p.teleport({ x: l.x + dx, y: l.y + dy, z: l.z + dz }); }
  return true;
}

function floating(v) {
  const own = ownSet(v);
  for (const c of v.cells) {
    const x = v.x + c.dx, y = v.y + c.dy - 1, z = v.z + c.dz;
    if (own.has(key(x, y, z))) continue;
    const b = blockAt(v.dim, x, y, z);
    if (b && b.isLiquid) return true;
  }
  return false;
}

function cardinal(player) {
  const yaw = ((player.getRotation().y % 360) + 360) % 360; // Bedrock: 0 = south, 90 = west
  if (yaw >= 315 || yaw < 45) return [0, 1];
  if (yaw < 135) return [-1, 0];
  if (yaw < 225) return [0, -1];
  return [1, 0];
}

world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  const b = ev.block;
  if (b.typeId !== WHEEL) return;
  const p = ev.player;
  if (drivers.has(p.id)) { drivers.delete(p.id); p.onScreenDisplay.setActionBar("You let go of the wheel."); return; }
  const v = assemble(p.dimension, b);
  if (!v) { p.onScreenDisplay.setActionBar("Nothing is attached to this wheel."); return; }
  drivers.set(p.id, v);
  p.onScreenDisplay.setActionBar("Driving " + v.cells.length + " blocks. Look where you want to go. Sneak to stop.");
});

system.runInterval(() => {
  for (const [id, v] of [...drivers.entries()]) {
    const p = world.getAllPlayers().find((q) => q.id === id);
    if (!p) { drivers.delete(id); continue; }
    if (p.isSneaking) { drivers.delete(id); p.onScreenDisplay.setActionBar("Stopped."); continue; }
    const m = p.inputInfo.getMovementVector(); // x: strafe, y: forward
    const [fx, fz] = cardinal(p);
    let dx = 0, dz = 0;
    if (m.y > 0.5) { dx += fx; dz += fz; } else if (m.y < -0.5) { dx -= fx; dz -= fz; }
    if (Math.abs(m.x) > 0.5) { const s = m.x > 0 ? 1 : -1; dx += -fz * s; dz += fx * s; }
    if (dx !== 0 || dz !== 0) { if (!shift(v, dx, 0, dz)) shift(v, dx, 1, dz); }
    if (!floating(v)) shift(v, 0, -1, 0);
  }
}, 4);
