"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class EventTargetStub {
  constructor() { this.listeners = {}; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatch(type, data = {}) {
    const event = { button: 0, deltaY: 0, code: "", repeat: false, clientX: 0, clientY: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data };
    for (const listener of this.listeners[type] || []) listener(event);
    return event;
  }
}

const canvas = new EventTargetStub();
const noop = () => {};
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
canvas.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop: noop }) }, { get: (object, key) => object[key] || noop, set: (object, key, value) => (object[key] = value, true) });
const windowStub = new EventTargetStub();
const sandbox = { console, Math, Object, Boolean, Number, Set, document: { getElementById: () => canvas }, window: windowStub, requestAnimationFrame: noop };
vm.createContext(sandbox);
const gameSource = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
vm.runInContext(`${gameSource}\n;globalThis.testApi={CONFIG,gameState,createStartingAmmo,resetGame,update,updateInput,updatePlayer,updateEnemies,updateProjectiles,updateShards,cleanup,cycleAmmo,solids,explode,activateCheckpoint,finish,shoot,damageEnemy,triggerShatter};`, sandbox);
const { CONFIG, gameState, createStartingAmmo, resetGame, update, updateInput, updatePlayer, updateEnemies, updateProjectiles, updateShards, cleanup, cycleAmmo, solids, explode, activateCheckpoint, finish, shoot, damageEnemy, triggerShatter } = sandbox.testApi;

assert.equal(gameState.phase, "start");
canvas.dispatch("mousedown", { button: 0 });
assert.equal(gameState.phase, "playing", "left click starts the game without firing");
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze"], "a new run receives the configured starting ammo in order");
assert.equal(gameState.player.selectedAmmoIndex, 0, "explosion is initially selected");
assert.notStrictEqual(gameState.player.ammo, CONFIG.player.startingAmmo, "runtime ammo does not alias configuration");
gameState.player.ammo.pop();
assert.deepEqual(Array.from(CONFIG.player.startingAmmo), ["explosion", "bounce", "freeze"], "gameplay mutations cannot change starting ammo configuration");
resetGame();
gameState.player.ammo = ["explosion"];
cycleAmmo(1); cycleAmmo(-1);
assert.equal(gameState.player.selectedAmmoIndex, 0, "one ammo remains selected");
gameState.player.ammo = ["explosion", "bounce", "freeze"];
cycleAmmo(1); assert.equal(gameState.player.selectedAmmoIndex, 1);
cycleAmmo(-1); assert.equal(gameState.player.selectedAmmoIndex, 0);
cycleAmmo(-1); assert.equal(gameState.player.selectedAmmoIndex, 2, "reverse selection wraps");
assert(canvas.dispatch("wheel", { deltaY: 1 }).defaultPrevented, "canvas wheel scrolling is prevented");
assert.equal(gameState.player.selectedAmmoIndex, 0, "wheel selection wraps forward");

resetGame();
gameState.input.mouse.x = gameState.player.x + 200;
gameState.input.mouse.y = gameState.player.y;
shoot();
assert.deepEqual(Array.from(gameState.player.ammo), ["bounce", "freeze"], "shooting consumes the selected explosion and leaves a valid inventory");
assert.equal(gameState.player.selectedAmmoIndex, 0);
resetGame();
damageEnemy(gameState.enemies[0], CONFIG.enemies.health);
damageEnemy(gameState.enemies[1], CONFIG.enemies.health);
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze", "explosion", "bounce"], "enemy ammo appends in acquisition order up to capacity");
damageEnemy(gameState.enemies[2], CONFIG.enemies.health);
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze", "explosion", "bounce"], "enemy ammo is discarded at capacity");

const configuredStartingAmmo = CONFIG.player.startingAmmo;
CONFIG.player.startingAmmo = ["invalid", "freeze", "bounce", "explosion", "freeze", "bounce"];
assert.deepEqual(Array.from(createStartingAmmo()), ["freeze", "bounce", "explosion", "freeze", "bounce"], "starting ammo rejects invalid types and clamps to capacity");
CONFIG.player.startingAmmo = null;
assert.deepEqual(Array.from(createStartingAmmo()), [], "an absent starting loadout initializes safely");
CONFIG.player.startingAmmo = configuredStartingAmmo;

function groundJump(source) {
  resetGame();
  gameState.player.grounded = true;
  if (source === "mouse") canvas.dispatch("mousedown", { button: 2 });
  else windowStub.dispatch("keydown", { code: "Space" });
  updateInput(1 / 60); updatePlayer(1 / 60);
  return gameState.player.vy;
}
assert.equal(groundJump("mouse"), groundJump("space"), "right click and Space share jump physics");

resetGame();
gameState.player.ammo = ["explosion"];
canvas.dispatch("mousedown", { button: 2 });
assert.equal(gameState.input.mouse.down, false, "right click does not fire");
assert(canvas.dispatch("contextmenu").defaultPrevented, "canvas context menu is prevented");

const player = gameState.player;
player.x = 1600 - player.w; player.y = 300; player.vx = 0; player.vy = 500; player.grounded = false;
gameState.input.mouse.jumpDown = false; gameState.input.pressed = {};
updateInput(1 / 60); updatePlayer(1 / 60);
assert(player.isWallSliding, "falling wall contact starts a wall slide");
assert(player.vy <= CONFIG.player.wallSlideMaxFallSpeed, "wall slide caps fall speed");
canvas.dispatch("mousedown", { button: 2 }); updateInput(1 / 60); updatePlayer(1 / 60);
assert(player.vx < 0 && player.vy < 0, "right-wall jump launches up-left");
assert(CONFIG.player.wallJumpVerticalSpeed > CONFIG.player.wallJumpHorizontalSpeed * 3, "wall jump is primarily vertical");
assert.equal(player.wallJumpBlockedSide, "right");
const launchVelocity = player.vx;
gameState.input.keys.KeyD = true; gameState.input.pressed = {};
updateInput(1 / 60); updatePlayer(1 / 60);
updateInput(1 / 60); updatePlayer(1 / 60);
updateInput(1 / 60); updatePlayer(1 / 60);
assert(player.vx > launchVelocity, "toward-wall air control quickly overcomes the brief launch lock");

resetGame();
const leftWallPlayer = gameState.player;
leftWallPlayer.x = 1635; leftWallPlayer.y = 300; leftWallPlayer.vy = 100; leftWallPlayer.grounded = false;
canvas.dispatch("mousedown", { button: 2 }); updateInput(1 / 60); updatePlayer(1 / 60);
assert(leftWallPlayer.vx > 0 && leftWallPlayer.vy < 0, "left-wall jump launches up-right");

const blockedPlayer = gameState.player;
blockedPlayer.x = 1600 - blockedPlayer.w; blockedPlayer.y = 300; blockedPlayer.vy = 20; blockedPlayer.wallContact = { left: false, right: true }; blockedPlayer.wallJumpBlockedSide = "right";
gameState.input.jump.held = false; gameState.input.mouse.jumpDown = true; gameState.input.pressed = { MouseJump: true };
updateInput(1 / 60); updatePlayer(1 / 60);
assert(blockedPlayer.vy >= 0, "the same unchanged wall cannot be jumped repeatedly");
blockedPlayer.x = 1500; blockedPlayer.vy = -20; blockedPlayer.wallJumpBlockedSide = null; gameState.input.jump.held = false; gameState.input.pressed = { MouseJump: true };
updateInput(1 / 60); updatePlayer(1 / 60);
assert(blockedPlayer.vy > -20, "open air does not grant a second jump");

blockedPlayer.ammo = ["bounce"]; blockedPlayer.selectedAmmoIndex = 0; blockedPlayer.cooldown = 0; blockedPlayer.isWallSliding = true;
gameState.input.mouse.down = true; gameState.input.mouse.jumpDown = false; gameState.input.pressed = {};
update(1 / 60);
assert.equal(gameState.projectiles.length, 1, "shooting remains active during wall movement");

const previousVelocity = blockedPlayer.vx;
explode({ x: blockedPlayer.x - 10, y: blockedPlayer.y + blockedPlayer.h / 2, alive: true });
assert(blockedPlayer.vx > previousVelocity, "explosion knockback remains active");

resetGame();
const frozenEnemy = gameState.enemies[0]; frozenEnemy.frozen = 1;
assert(solids(true).includes(frozenEnemy), "frozen enemies remain platforms");
activateCheckpoint();
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze"], "checkpoint ammo remains intact");
gameState.input.mouse.down = true; gameState.input.mouse.jumpDown = true; finish("win");
assert.equal(gameState.phase, "gameover");
assert.equal(gameState.input.mouse.down, false); assert.equal(gameState.input.mouse.jumpDown, false, "phase changes clear held mouse input");
windowStub.dispatch("keydown", { code: "KeyR" });
assert.equal(gameState.phase, "playing", "R restarts after game over");
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze"], "a full restart restores starting ammo in order");
assert.equal(gameState.player.selectedAmmoIndex, 0, "a full restart selects explosion");

function heldWallClimb(side) {
  resetGame();
  const p = gameState.player;
  const wall = side === "right"
    ? { x: 3000, y: -1200, w: 40, h: 1680, active: true }
    : { x: 2900, y: -1200, w: 40, h: 1680, active: true };
  gameState.platforms.push(wall);
  p.x = side === "right" ? wall.x - p.w : wall.x + wall.w;
  p.y = 350; p.vx = 0; p.vy = 80; p.grounded = false;
  gameState.input.keys[side === "right" ? "KeyD" : "KeyA"] = true;
  gameState.input.mouse.jumpDown = true;
  gameState.input.jump.held = false;
  gameState.input.pressed = { MouseJump: true };
  let launches = 0;
  let wasBlocked = false;
  for (let frame = 0; frame < 240; frame++) {
    updateInput(1 / 120); updatePlayer(1 / 120);
    const blocked = p.wallJumpBlockedSide === side;
    if (blocked && !wasBlocked) launches++;
    wasBlocked = blocked;
    gameState.input.pressed = {};
  }
  assert(launches >= 3, `held jump repeatedly climbs the ${side} wall after detach/re-contact`);
  assert(p.y < 300, `repeated ${side}-wall jumps gain height`);
}
heldWallClimb("right");
heldWallClimb("left");

resetGame();
const wall = gameState.wall;
const wallBottomBlast = { x: wall.x - CONFIG.projectile.explosionRadius / 2, y: wall.y + wall.h - 4, alive: true };
explode(wallBottomBlast);
assert.equal(wall.active, false, "an overlapping explosion destroys the full wall rectangle, not only its center");
assert(!solids().includes(wall), "a destroyed wall immediately leaves solid collision");
assert(gameState.effects.some(effect => effect.type === "destruction"), "wall destruction creates debris feedback");

resetGame();
gameState.projectiles.push({ type: "freeze", x: gameState.wall.x - 8, y: gameState.wall.y + 30, radius: CONFIG.projectile.radius, vx: 500, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(1 / 30);
assert.equal(gameState.wall.active, true, "a non-explosion projectile cannot destroy the wall");

resetGame();
const switchEffectCount = gameState.effects.length;
gameState.projectiles.push({ type: "bounce", x: gameState.switch.x + gameState.switch.w / 2, y: gameState.switch.y + gameState.switch.h / 2, radius: CONFIG.projectile.radius, vx: 0, vy: 0, life: 1, alive: true, bounces: 1, trail: [] });
updateProjectiles(0);
assert.equal(gameState.switch.active, true, "a ricochet-capable projectile activates the indirect switch");
assert.equal(gameState.door.active, false, "switch activation opens the shortcut door");
const activatedEffectCount = gameState.effects.length;
updateProjectiles(0);
assert.equal(gameState.effects.length, activatedEffectCount, "the switch side effect runs only once");
assert(activatedEffectCount > switchEffectCount);

resetGame();
const platformEnemy = gameState.enemies[2];
platformEnemy.frozen = CONFIG.projectile.freezeDuration;
platformEnemy.vx = 0; platformEnemy.vy = 0;
gameState.player.x = platformEnemy.x + 4;
gameState.player.y = platformEnemy.y - gameState.player.h - 3;
gameState.player.vx = 0; gameState.player.vy = 180; gameState.player.grounded = false;
updatePlayer(1 / 30);
assert.equal(gameState.player.y, platformEnemy.y - gameState.player.h, "the player lands on a frozen enemy's top");
assert(gameState.player.grounded && gameState.player.frozenSupport === platformEnemy, "the player can stand and jump from the frozen platform");
const healthOnIce = gameState.player.health;
updatePlayer(1 / 60);
assert.equal(gameState.player.health, healthOnIce, "a frozen enemy has no contact damage");
platformEnemy.frozen = 0.001;
updateEnemies(1 / 60);
assert(gameState.player.vy < 0 && gameState.player.y + gameState.player.h <= platformEnemy.y, "thawing safely lifts a supported player clear");

resetGame();
gameState.wall.active = false; gameState.switch.active = true; gameState.door.active = false; gameState.collectible.collected = true;
resetGame();
assert(gameState.wall.active && !gameState.switch.active && gameState.door.active && !gameState.collectible.collected, "full restart resets every environmental interaction");

resetGame();
gameState.player.ammo = [];
gameState.player.x = gameState.goal.x; gameState.player.y = gameState.goal.y;
updatePlayer(0);
assert.equal(gameState.result, "win", "the goal has no ammo-state gate and remains reachable with an empty inventory");

resetGame();
gameState.player.ammo = [];
const shatterSource = gameState.enemies[0];
const shardTarget = gameState.enemies[1];
shatterSource.x = 500; shatterSource.y = 300; shatterSource.frozen = CONFIG.projectile.freezeDuration;
shardTarget.x = shatterSource.x + CONFIG.shatter.shardSpeed * CONFIG.shatter.shardLifetime / 2;
shardTarget.y = shatterSource.y; shardTarget.frozen = CONFIG.projectile.freezeDuration;
gameState.player.frozenSupport = shatterSource; gameState.player.grounded = true;
explode({ x: shatterSource.x + shatterSource.w / 2, y: shatterSource.y + shatterSource.h / 2, alive: true });
assert.equal(shatterSource.alive, false, "an explosion overlapping a frozen enemy shatters it");
assert.equal(shatterSource.frozen, 0, "shatter immediately removes frozen-platform state");
assert.equal(gameState.player.frozenSupport, null, "a supported player is released when its platform shatters");
assert.equal(gameState.player.grounded, false, "a player on the shattered platform begins falling");
assert.equal(gameState.player.ammo.length, 1, "shatter grants the normal enemy ammo drop exactly once");
assert.equal(gameState.shards.length, CONFIG.shatter.shardCount, "shatter emits the configured radial shard count");
assert(gameState.effects.some(effect => effect.type === "shatter"), "shatter creates bright visual feedback");
const angles = gameState.shards.map(shard => shard.angle);
for (let index = 1; index < angles.length; index++) assert(Math.abs(angles[index] - angles[index - 1] - CONFIG.render.pi2 / CONFIG.shatter.shardCount) < 1e-10, "shards use deterministic even angles");
assert.equal(triggerShatter(shatterSource), false, "the same enemy cannot shatter twice");
assert.equal(gameState.player.ammo.length, 1, "a repeated shatter attempt cannot duplicate its drop");
for (let elapsed = 0; elapsed < CONFIG.shatter.shardLifetime; elapsed += 1 / 120) updateShards(1 / 120);
assert.equal(shardTarget.alive, false, "a traveling shard damages another living enemy");
assert.equal(gameState.effects.filter(effect => effect.type === "shatter").length, 1, "a shard hitting a frozen target does not recursively shatter it");

resetGame();
const ordinaryTarget = gameState.enemies[0];
explode({ x: ordinaryTarget.x + ordinaryTarget.w / 2, y: ordinaryTarget.y + ordinaryTarget.h / 2, alive: true });
assert(!gameState.effects.some(effect => effect.type === "shatter"), "explosion damage on a non-frozen enemy is not shatter");
resetGame();
const bounceTarget = gameState.enemies[0]; bounceTarget.frozen = CONFIG.projectile.freezeDuration;
gameState.projectiles.push({ type: "bounce", x: bounceTarget.x + bounceTarget.w / 2, y: bounceTarget.y + bounceTarget.h / 2, radius: CONFIG.projectile.radius, vx: 0, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(0);
assert.equal(bounceTarget.alive, false, "bounce keeps its normal damage behavior against a frozen enemy");
assert(!gameState.effects.some(effect => effect.type === "shatter"), "bounce creates no shatter feedback");
resetGame();
const freezeTarget = gameState.enemies[0]; freezeTarget.frozen = CONFIG.projectile.freezeDuration;
gameState.projectiles.push({ type: "freeze", x: freezeTarget.x + freezeTarget.w / 2, y: freezeTarget.y + freezeTarget.h / 2, radius: CONFIG.projectile.radius, vx: 0, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(0);
assert(freezeTarget.alive && !gameState.effects.some(effect => effect.type === "shatter"), "freeze hitting an already frozen enemy does not shatter it");
resetGame(); gameState.enemies[0].frozen = CONFIG.projectile.freezeDuration; triggerShatter(gameState.enemies[0]);
resetGame();
assert.equal(gameState.shards.length, 0, "a full restart removes prior shatter shards");

console.log("All gameplay/input assertions passed");
