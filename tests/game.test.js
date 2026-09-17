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
vm.runInContext(`${gameSource}\n;globalThis.testApi={CONFIG,gameState,createStartingAmmo,resetGame,update,updateInput,updatePlayer,updateEnemies,updateMovableBoxes,updateProjectiles,updateShards,cleanup,cycleAmmo,solids,explode,activateCheckpoint,finish,shoot,damageEnemy,triggerShatter,conveyorVelocity};`, sandbox);
const { CONFIG, gameState, createStartingAmmo, resetGame, update, updateInput, updatePlayer, updateEnemies, updateMovableBoxes, updateProjectiles, updateShards, cleanup, cycleAmmo, solids, explode, activateCheckpoint, finish, shoot, damageEnemy, triggerShatter, conveyorVelocity } = sandbox.testApi;

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
gameState.player.ammo = [];
gameState.player.selectedAmmoIndex = 99;
gameState.input.mouse.x = gameState.player.x + 200;
gameState.input.mouse.y = gameState.player.y + gameState.player.h / 2;
shoot();
assert.equal(gameState.projectiles.length, 1, "an empty special-ammo inventory fires a fallback projectile");
const normalShot = gameState.projectiles[0];
assert.equal(normalShot.type, "normal", "the fallback uses the shared projectile architecture");
assert.equal(normalShot.radius, CONFIG.normalShot.radius);
assert.equal(normalShot.life, CONFIG.normalShot.lifetime);
assert(normalShot.vx > 0 && Math.abs(normalShot.vy) < CONFIG.physics.epsilon, "Normal Shot uses the authoritative 360-degree aim vector");
assert.equal(gameState.player.ammo.length, 0, "Normal Shot is unlimited and never enters special-ammo inventory");
assert.equal(gameState.player.selectedAmmoIndex, 0, "empty-inventory firing repairs the selected index");
assert.equal(gameState.player.cooldown, CONFIG.normalShot.cooldown, "Normal Shot uses its configured shared firing cooldown state");
cycleAmmo(1); cycleAmmo(-1);
assert.equal(gameState.player.selectedAmmoIndex, 0, "wheel selection remains safe while empty");
assert.equal(gameState.player.ammo.length, 0);

gameState.projectiles = [];
const recoveryEnemy = gameState.enemies[2];
recoveryEnemy.x = gameState.player.x + 90; recoveryEnemy.y = gameState.player.y;
recoveryEnemy.hp = CONFIG.normalShot.damage * 2; recoveryEnemy.vx = 0;
shoot(); updateProjectiles(0.1); cleanup();
assert.equal(recoveryEnemy.hp, CONFIG.normalShot.damage, "Normal Shot deals configured damage through shared enemy damage");
assert.equal(recoveryEnemy.alive, true);
gameState.player.cooldown = 0; shoot(); updateProjectiles(0.1); cleanup();
assert.equal(recoveryEnemy.alive, false, "Normal Shot can defeat an ordinary enemy");
assert.equal(recoveryEnemy.dropGranted, true, "Normal Shot defeat runs one-time shared reward handling");
assert.deepEqual(Array.from(gameState.player.ammo), ["freeze"], "the defeated enemy grants its existing special ammo");
gameState.projectiles = []; gameState.player.cooldown = 0; shoot();
assert.equal(gameState.projectiles[0].type, "freeze", "newly acquired special ammo automatically takes priority over Normal Shot");
assert.equal(gameState.player.ammo.length, 0, "the recovered special ammo keeps its existing consumption rule");
gameState.projectiles = []; gameState.player.cooldown = 0; shoot();
assert.equal(gameState.projectiles[0].type, "normal", "firing automatically returns to Normal Shot after the last special is consumed");

resetGame();
gameState.player.ammo = ["bounce", "freeze"];
gameState.player.selectedAmmoIndex = 1;
shoot();
assert.equal(gameState.projectiles[0].type, "freeze", "selected special ammo has priority when multiple items are stored");
assert.deepEqual(Array.from(gameState.player.ammo), ["bounce"]);
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
gameState.projectiles = [{ type: "normal", x: gameState.wall.x - 8, y: gameState.wall.y + 30, radius: CONFIG.normalShot.radius, vx: CONFIG.normalShot.speed, vy: 0, life: CONFIG.normalShot.lifetime, alive: true, bounces: 0, trail: [] }];
updateProjectiles(1 / 30);
assert.equal(gameState.wall.active, true, "Normal Shot is blocked without destroying a destructible wall");
assert.equal(gameState.projectiles[0].alive, false);

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
gameState.projectiles.push({ type: "normal", x: gameState.switch.x + gameState.switch.w / 2, y: gameState.switch.y + gameState.switch.h / 2, radius: CONFIG.normalShot.radius, vx: 0, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(0);
assert.equal(gameState.switch.active, false, "Normal Shot cannot activate a Bounce-specific switch");

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
const normalFrozenTarget = gameState.enemies[0]; normalFrozenTarget.frozen = CONFIG.projectile.freezeDuration;
gameState.projectiles.push({ type: "normal", x: normalFrozenTarget.x + normalFrozenTarget.w / 2, y: normalFrozenTarget.y + normalFrozenTarget.h / 2, radius: CONFIG.normalShot.radius, vx: 0, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(0);
assert.equal(normalFrozenTarget.alive, false, "Normal Shot applies ordinary direct damage to a frozen enemy");
assert(!gameState.effects.some(effect => effect.type === "shatter"), "Normal Shot never triggers Shatter");

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

function placeOnBelt(body, belt) {
  body.x = belt.x + 20; body.y = belt.y - body.h;
  body.vx = 0; body.vy = 0; body.grounded = true; body.supportSurface = belt;
}

resetGame();
const [leftBelt, rightBelt] = gameState.conveyors;
assert.equal(leftBelt.direction, -1, "the stage contains an explicit left conveyor");
assert.equal(rightBelt.direction, 1, "the stage contains an explicit right conveyor");
assert(solids().includes(leftBelt) && solids().includes(rightBelt), "conveyors participate in ordinary solid collision");
placeOnBelt(gameState.player, rightBelt);
const stillStart = gameState.player.x;
updatePlayer(1 / 60);
assert(gameState.player.x > stillStart, "a supported idle player is carried right");
const withBeltStart = gameState.player.x;
gameState.input.keys.KeyD = true; updatePlayer(1 / 60);
assert(gameState.player.x - withBeltStart > CONFIG.conveyor.speed / 60, "player input adds to conveyor transport");
gameState.player.vx = -CONFIG.player.maxSpeed; gameState.input.keys = { KeyA: true };
const againstStart = gameState.player.x; updatePlayer(1 / 60);
assert(gameState.player.x < againstStart, "the player can run against a right conveyor");
gameState.input.keys = {}; gameState.input.jump.held = false; gameState.input.jump.pressed = true;
const jumpStart = gameState.player.x; updatePlayer(1 / 60);
assert(gameState.player.vy < 0 && !gameState.player.grounded, "jumping leaves conveyor support normally");
assert.equal(conveyorVelocity(gameState.player), 0, "an airborne player receives no conveyor velocity");

resetGame();
placeOnBelt(gameState.player, leftBelt);
const leftStart = gameState.player.x; updatePlayer(1 / 60);
assert(gameState.player.x < leftStart, "the left conveyor carries supported players left");

resetGame();
const collisionBelt = gameState.conveyors[1];
const stopWall = { x: collisionBelt.x + 100, y: 300, w: 30, h: 180, active: true };
gameState.platforms.push(stopWall); placeOnBelt(gameState.player, collisionBelt);
gameState.player.x = stopWall.x - gameState.player.w;
for (let frame = 0; frame < 30; frame++) updatePlayer(1 / 60);
assert.equal(gameState.player.x + gameState.player.w, stopWall.x, "conveyor transport cannot push the player through a wall");

resetGame();
const transportedEnemy = gameState.enemies[6];
placeOnBelt(transportedEnemy, gameState.conveyors[1]);
transportedEnemy.minX = -10000; transportedEnemy.maxX = 10000; transportedEnemy.vx = CONFIG.enemies.fireSpeed;
const livingStart = transportedEnemy.x; updateEnemies(1 / 60);
assert(transportedEnemy.x - livingStart > CONFIG.conveyor.speed / 60, "living enemy AI motion combines with conveyor transport");
transportedEnemy.frozen = CONFIG.projectile.freezeDuration; transportedEnemy.vx = 0;
const frozenStart = transportedEnemy.x; updateEnemies(1 / 60);
assert(transportedEnemy.x > frozenStart, "a frozen enemy remains conveyor-transported while its AI is stopped");

const rider = gameState.player;
rider.x = transportedEnemy.x + 4; rider.y = transportedEnemy.y - rider.h;
rider.vx = 0; rider.vy = 0; rider.grounded = true; rider.frozenSupport = transportedEnemy; rider.supportSurface = transportedEnemy;
const riderOffset = rider.x - transportedEnemy.x;
update(1 / 60);
assert(Math.abs((rider.x - transportedEnemy.x) - riderOffset) < 0.1, "the player rides a conveyor-carried frozen enemy without update-order slip");
assert(rider.frozenSupport === transportedEnemy && rider.grounded, "moving frozen support remains valid after transport");

resetGame();
assert(gameState.conveyors.every(belt => belt.active), "full restart restores static conveyor geometry");
gameState.player.frozenSupport = gameState.enemies[0]; gameState.player.supportSurface = gameState.enemies[0];
gameState.player.x = gameState.checkpoint.respawnX; gameState.player.y = CONFIG.level.killY + 1;
gameState.player.retries = 1; updatePlayer(0);
assert.equal(gameState.player.frozenSupport, null, "checkpoint respawn clears stale frozen support");
assert.equal(gameState.player.supportSurface, null, "checkpoint respawn clears stale ground support");

function isolatedBox(x = 3000, y = CONFIG.level.floorY - CONFIG.movableBox.height) {
  resetGame();
  const box = gameState.movableBoxes[0];
  box.x = x; box.y = y; box.previousX = x; box.previousY = y; box.vx = 0; box.vy = 0; box.grounded = true;
  box.supportSurface = gameState.platforms.find(surface => x >= surface.x && x < surface.x + surface.w);
  gameState.enemies.forEach(enemy => { enemy.x = 100; enemy.minX = 50; enemy.maxX = 150; });
  return box;
}

let box = isolatedBox();
const sidePlayer = gameState.player;
sidePlayer.x = box.x - sidePlayer.w; sidePlayer.y = box.y; sidePlayer.vx = CONFIG.player.maxSpeed; sidePlayer.vy = 0; sidePlayer.grounded = true;
updatePlayer(1 / 30);
assert.equal(sidePlayer.x + sidePlayer.w, box.x, "walking into a box side blocks the player");
assert.equal(box.vx, 0, "player movement never pushes a box");

box = isolatedBox();
const boxRider = gameState.player;
boxRider.x = box.x + 5; boxRider.y = box.y - boxRider.h - 3; boxRider.vy = 180; boxRider.grounded = false;
updatePlayer(1 / 30);
assert(boxRider.grounded && boxRider.boxSupport === box, "the player lands and stands on a movable box");
gameState.input.jump.pressed = true; gameState.input.jump.held = true; updatePlayer(1 / 60);
assert(boxRider.vy < 0 && !boxRider.grounded, "the player jumps normally from a movable box");

for (const [label, blast, test] of [
  ["left", { x: 2950, y: 457 }, value => value > 0],
  ["right", { x: 3100, y: 457 }, value => value < 0],
  ["below", { x: 3023, y: 520 }, (_value, target) => target.vy < 0]
]) {
  box = isolatedBox(); explode({ ...blast, alive: true });
  assert(test(box.vx, box), `an explosion ${label} of the box applies the expected impulse`);
}
box = isolatedBox(); explode({ x: box.x + box.w / 2, y: box.y + box.h / 2, alive: true });
assert(Number.isFinite(box.vx) && Number.isFinite(box.vy), "a zero-distance blast cannot introduce NaN or Infinity");

box = isolatedBox(3400); box.vx = CONFIG.movableBox.maxHorizontalSpeed;
const stopWallForBox = { x: 3470, y: 250, w: 25, h: 230, active: true }; gameState.platforms.push(stopWallForBox);
for (let frame = 0; frame < 20; frame++) updateMovableBoxes(1 / 30);
assert(box.x + box.w <= stopWallForBox.x, "a high-speed box cannot tunnel through a wall");
box.x = 3000; box.y = 300; box.vx = 0; box.vy = CONFIG.movableBox.maxVerticalSpeed; box.grounded = false;
for (let frame = 0; frame < 20; frame++) updateMovableBoxes(1 / 30);
assert(box.y + box.h <= CONFIG.level.floorY, "a high-speed falling box cannot tunnel through the floor");

box = isolatedBox(); box.vx = 300;
for (let frame = 0; frame < 120; frame++) updateMovableBoxes(1 / 60);
assert.equal(box.vx, 0, "ordinary ground deceleration settles blast momentum");

for (const beltIndex of [0, 1]) {
  resetGame(); box = gameState.movableBoxes[0]; placeOnBelt(box, gameState.conveyors[beltIndex]);
  const start = box.x; updateMovableBoxes(1 / 30);
  assert(Math.sign(box.x - start) === gameState.conveyors[beltIndex].direction, `${gameState.conveyors[beltIndex].direction < 0 ? "left" : "right"} conveyor transports a box`);
}
resetGame(); box = gameState.movableBoxes[0]; const rideBelt = gameState.conveyors[1]; placeOnBelt(box, rideBelt);
const conveyorRider = gameState.player; conveyorRider.x = box.x + 5; conveyorRider.y = box.y - conveyorRider.h; conveyorRider.vx = 0; conveyorRider.vy = 0; conveyorRider.grounded = true; conveyorRider.boxSupport = box; conveyorRider.supportSurface = box;
const rideOffset = conveyorRider.x - box.x; update(1 / 60);
assert(Math.abs((conveyorRider.x - box.x) - rideOffset) < 0.1, "a player rides a conveyor-transported box without support lag");

resetGame(); box = gameState.movableBoxes[0]; box.x = gameState.conveyors[1].x + 60; box.y = gameState.conveyors[1].y - box.h; box.grounded = true; box.supportSurface = gameState.conveyors[1];
explode({ x: box.x + box.w / 2, y: box.y + box.h + 70, alive: true });
for (let frame = 0; frame < 180; frame++) updateMovableBoxes(1 / 120);
assert(box.supportSurface === gameState.conveyors[1] || box.x > gameState.conveyors[1].x, "an explosion-launched box can land on and be transported by a conveyor");

box = isolatedBox(3000); const impactEnemy = gameState.enemies[0]; impactEnemy.x = 3065; impactEnemy.y = CONFIG.level.floorY - impactEnemy.h; impactEnemy.minX = impactEnemy.x; impactEnemy.maxX = impactEnemy.x + impactEnemy.w; impactEnemy.vx = 0; impactEnemy.hp = 2;
box.vx = CONFIG.movableBox.enemyDamageMinSpeed + 100; updateMovableBoxes(1 / 10);
assert.equal(impactEnemy.hp, 1, "one fast box impact uses shared enemy damage once");
updateMovableBoxes(1 / 60); assert.equal(impactEnemy.hp, 1, "continued contact cannot damage every frame");
box.x = impactEnemy.x - box.w + 1; box.vx = CONFIG.movableBox.enemyDamageMinSpeed - 1; updateMovableBoxes(0);
assert.equal(impactEnemy.hp, 1, "a slow touching box deals no damage");
box.impactCooldowns = {}; box.vx = CONFIG.movableBox.enemyDamageMinSpeed + 10; updateMovableBoxes(0);
assert.equal(impactEnemy.alive, false, "a later meaningful impact can defeat the enemy");
assert.equal(impactEnemy.dropGranted, true, "box defeat grants the normal drop exactly once");

box = isolatedBox();
gameState.projectiles.push({ type: "normal", x: box.x - 5, y: box.y + box.h / 2, radius: CONFIG.normalShot.radius, vx: CONFIG.normalShot.speed, vy: 0, life: CONFIG.normalShot.lifetime, alive: true, bounces: 0, trail: [] });
updateProjectiles(1 / 60);
assert.equal(gameState.projectiles[0].alive, false, "Normal Shot disappears on movable-box collision");
assert.equal(box.vx, 0, "Normal Shot gives a movable box no impulse");
gameState.projectiles = [];
gameState.projectiles.push({ type: "bounce", x: box.x - 5, y: box.y + box.h / 2, radius: CONFIG.projectile.radius, vx: 500, vy: 0, life: 1, alive: true, bounces: 0, trail: [] });
updateProjectiles(1 / 60); assert(gameState.projectiles[0].vx < 0 && box.vx === 0, "Bounce reflects from a box without launching it");
gameState.projectiles = [{ type: "freeze", x: box.x - 5, y: box.y + box.h / 2, radius: CONFIG.projectile.radius, vx: 500, vy: 0, life: 1, alive: true, bounces: 0, trail: [] }];
updateProjectiles(1 / 60); assert.equal(box.vx, 0, "Freeze creates no box state or impulse");
gameState.shards = [{ x: box.x - 5, y: box.y + box.h / 2, radius: CONFIG.shatter.shardSize, vx: 500, vy: 0, angle: 0, life: 1, alive: true, source: null }];
updateShards(1 / 60); assert.equal(box.vx, 0, "Shatter shards create no box impulse");

box = isolatedBox(); gameState.player.boxSupport = box; gameState.player.supportSurface = box; gameState.player.grounded = true; box.y = CONFIG.level.killY + CONFIG.movableBox.cleanupMargin + 1;
updateMovableBoxes(0); cleanup();
assert.equal(gameState.movableBoxes.length, 0, "a box falling beyond world bounds is cleaned up");
assert(!gameState.player.boxSupport && !gameState.player.supportSurface && !gameState.player.grounded, "box cleanup clears stale player support");
gameState.player.x = gameState.checkpoint.respawnX; gameState.player.y = CONFIG.level.killY + 1; gameState.player.retries = 1; updatePlayer(0);
assert.equal(gameState.player.boxSupport, null, "checkpoint respawn keeps box support null-safe");
resetGame(); assert.equal(gameState.movableBoxes.length, 1, "a full restart restores level-defined boxes");
gameState.movableBoxes[0].active = false; cleanup(); gameState.player.x = gameState.goal.x; gameState.player.y = gameState.goal.y; updatePlayer(0);
assert.equal(gameState.result, "win", "losing the optional box cannot block normal level completion");

resetGame();
gameState.player.ammo = [];
gameState.input.mouse.x = CONFIG.canvas.width;
gameState.input.mouse.y = gameState.player.y;
for (let shot = 0; shot < 80; shot++) { gameState.player.cooldown = 0; shoot(); }
assert.equal(gameState.projectiles.length, 80, "repeated fallback firing uses the common projectile collection");
for (let elapsed = 0; elapsed < CONFIG.normalShot.lifetime + 0.1; elapsed += 1 / 60) { updateProjectiles(1 / 60); cleanup(); }
assert.equal(gameState.projectiles.length, 0, "repeated Normal Shots expire and are cleaned up without accumulation");

resetGame();
gameState.player.ammo = [];
activateCheckpoint();
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze"], "empty-inventory checkpoint recovery keeps the existing special-ammo cache behavior");
gameState.player.ammo = []; gameState.player.selectedAmmoIndex = 0; gameState.player.retries = 1; gameState.player.y = CONFIG.level.killY + 1;
updatePlayer(0);
assert.equal(gameState.player.ammo.length, 0, "checkpoint respawn does not add Normal Shot to inventory");
assert.equal(gameState.player.selectedAmmoIndex, 0, "checkpoint respawn preserves the safe empty-inventory selection value");
finish("lose"); windowStub.dispatch("keydown", { code: "KeyR" });
assert.deepEqual(Array.from(gameState.player.ammo), ["explosion", "bounce", "freeze"], "full restart still restores only configured starting special ammo");

console.log("All gameplay/input assertions passed");
