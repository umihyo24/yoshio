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
vm.runInContext(`${gameSource}\n;globalThis.testApi={CONFIG,gameState,resetGame,update,updateInput,updatePlayer,cycleAmmo,solids,explode,activateCheckpoint,finish};`, sandbox);
const { CONFIG, gameState, resetGame, update, updateInput, updatePlayer, cycleAmmo, solids, explode, activateCheckpoint, finish } = sandbox.testApi;

assert.equal(gameState.phase, "start");
canvas.dispatch("mousedown", { button: 0 });
assert.equal(gameState.phase, "playing", "left click starts the game without firing");
cycleAmmo(1);
assert.equal(gameState.player.selectedAmmoIndex, 0, "empty ammo remains safe");
gameState.player.ammo = ["explosion"];
cycleAmmo(1); cycleAmmo(-1);
assert.equal(gameState.player.selectedAmmoIndex, 0, "one ammo remains selected");
gameState.player.ammo = ["explosion", "bounce", "freeze"];
cycleAmmo(1); assert.equal(gameState.player.selectedAmmoIndex, 1);
cycleAmmo(-1); assert.equal(gameState.player.selectedAmmoIndex, 0);
cycleAmmo(-1); assert.equal(gameState.player.selectedAmmoIndex, 2, "reverse selection wraps");
assert(canvas.dispatch("wheel", { deltaY: 1 }).defaultPrevented, "canvas wheel scrolling is prevented");
assert.equal(gameState.player.selectedAmmoIndex, 0, "wheel selection wraps forward");

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

console.log("All gameplay/input assertions passed");
