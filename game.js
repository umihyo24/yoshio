"use strict";

// Every tuneable number used by simulation or presentation is centralized here.
const CONFIG = Object.freeze({
  canvas: { width: 960, height: 540 },
  physics: { gravity: 1800, maxFall: 900, epsilon: 0.01, maxDt: 0.033 },
  player: { width: 30, height: 42, startX: 90, startY: 420, accel: 1900, airAccel: 1050, decel: 2200, maxSpeed: 270, jump: 610, jumpCut: 0.48, health: 4, invulnerability: 1.1, retries: 2, shotCooldown: 0.18, knockback: 560, wallSlideMaxFallSpeed: 155, wallJumpHorizontalSpeed: 145, wallJumpVerticalSpeed: 610, wallContactTolerance: 2, wallJumpControlLockDuration: 0.035, wallRecontactDuration: 0.05, startingAmmo: Object.freeze(["explosion", "bounce", "freeze"]) },
  camera: { follow: 5.5, lead: 300 },
  ammo: { types: Object.freeze(["explosion", "bounce", "freeze"]), capacity: 5, followerSpacing: 18, followerLift: 10 },
  conveyor: { speed: 95, contactTolerance: 2, visualStripeSpacing: 28, visualScrollSpeed: 70 },
  movableBox: { width: 46, height: 46, gravity: 1800, maxFallSpeed: 900, explosionImpulse: 520, maxHorizontalSpeed: 620, maxVerticalSpeed: 760, groundDeceleration: 620, enemyDamageMinSpeed: 230, enemyImpactDamage: 1, enemyImpactCooldown: 0.35, impactVelocityRetain: -0.18, contactTolerance: 2, maxMoveStep: 8, cleanupMargin: 160, borderWidth: 3, cornerSize: 9, flashDuration: 0.16 },
  projectile: { radius: 7, speed: 570, inherit: 0.18, lifetime: 4, damage: 1, bounceCount: 3, restitution: 0.82, explosionRadius: 105, freezeDuration: 5 },
  normalShot: { radius: 4, speed: 650, velocityInheritance: 0.18, lifetime: 1.6, damage: 1, cooldown: 0.24 },
  shatter: { shardCount: 6, shardSpeed: 360, shardLifetime: 0.7, shardDamage: 1, shardSize: 7, flashDuration: 0.28, flashRadius: 48, flashStartScale: 0.65 },
  enemies: { width: 38, height: 34, health: 1, fireSpeed: 62, iceSpeed: 43, hopSpeed: 310, hopPeriod: 1.7, contactDamage: 1, hitTime: 0.15 },
  interactions: { frozenLandingTolerance: 8, thawWarning: 1, thawLiftSpeed: 120, wallShardRadius: 34, switchPulseSpeed: 5, collectiblePulseSpeed: 4, collectiblePulseAmount: 3 },
  effects: { defaultLife: 0.65, explosionLife: 0.38, destructionLife: 0.7, messageLife: 1.5, particleCount: 10 },
  checkpoint: { x: 3080, y: 390, width: 28, height: 90, respawnX: 3115, respawnY: 390 },
  level: { width: 5200, floorY: 480, killY: 700, goalX: 5090, goalWidth: 58, goalHeight: 110 },
  render: { grid: 80, slopeSteps: 8, fontSmall: 14, fontMedium: 20, fontLarge: 44, overlayAlpha: 0.78, playerBlinkRate: 14, trailLength: 18, pi2: Math.PI * 2 },
  colors: { sky: "#111b35", sky2: "#263d69", ground: "#33435f", edge: "#7488aa", player: "#f6f7fb", normal: "#e8f5ff", explosion: "#ff784f", bounce: "#72ee8b", freeze: "#62c9ff", gold: "#ffe166", danger: "#ff5577" }
});

const ASSET_IDS = Object.freeze({
  fire: "monster_fire_enemy_idle", slime: "monster_slime_enemy_idle", ice: "monster_ice_enemy_idle",
  explosion: "card_fire_single_explosion", bounce: "card_slime_single_bounce", freeze: "card_ice_single_freeze"
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// The sole mutable root. Event handlers only write into this tree.
const gameState = {
  phase: "start", result: null, time: 0, lastFrame: 0,
  camera: { x: 0 }, input: { keys: {}, pressed: {}, mouse: { x: 700, y: 280, down: false, jumpDown: false }, jump: { pressed: false, held: false, released: false } },
  player: null, platforms: [], conveyors: [], slopes: [], movableBoxes: [], enemies: [], projectiles: [], shards: [], effects: [],
  wall: null, switch: null, door: null, checkpoint: null, goal: null,
  collectible: { x: 1370, y: 342, radius: 13, collected: false }, assets: {}
};

function rect(x, y, w, h, kind = "solid") { return { x, y, w, h, kind, active: true }; }
function conveyor(x, y, w, h, direction) { return { x, y, w, h, kind: "conveyor", direction: Math.sign(direction) || 1, active: true }; }
function makeEnemy(type, x, y, minX, maxX) {
  return { type, x, y, w: CONFIG.enemies.width, h: CONFIG.enemies.height, vx: type === "ice" ? CONFIG.enemies.iceSpeed : CONFIG.enemies.fireSpeed, vy: 0, minX, maxX, hp: CONFIG.enemies.health, frozen: 0, hit: 0, hopClock: 0, alive: true, dropGranted: false, grounded: false };
}
function makeMovableBox(definition) {
  return { type: "movableBox", x: definition.x, y: definition.y, w: CONFIG.movableBox.width, h: CONFIG.movableBox.height, vx: 0, vy: 0, grounded: false, supportSurface: null, previousX: definition.x, previousY: definition.y, surfaceDeltaX: 0, active: true, impactCooldowns: {}, flash: 0 };
}
function buildLevel() {
  const f = CONFIG.level.floorY;
  gameState.platforms = [
    rect(0, f, 880, 80), rect(940, f, 780, 80), rect(1780, f, 700, 80), rect(2540, f, 950, 80), rect(3550, f, 1650, 80),
    rect(520, 390, 170, 20, "platform"), rect(1050, 400, 160, 20, "platform"), rect(1300, 370, 160, 20, "platform"),
    rect(1840, 385, 190, 20, "platform"), rect(2110, 300, 180, 20, "platform"), rect(2640, 400, 180, 20, "platform"),
    rect(3300, 355, 180, 20, "platform"), rect(3700, 395, 170, 20, "platform"), rect(3970, 325, 170, 20, "platform"), rect(4300, 390, 170, 20, "platform"), rect(4630, 315, 180, 20, "platform"),
    rect(1600, 270, 35, 210), rect(1690, 350, 30, 130), rect(2240, 185, 35, 115)
  ];
  // Static environment data. The late right belt and ledge form an optional
  // freeze-and-ride route; neither belt blocks the ordinary floor route.
  gameState.conveyors = [conveyor(1840, f, 290, 80, -1), conveyor(3890, f, 390, 80, 1)];
  // One optional demonstration area: the crate rides toward an enemy and can
  // be blast-positioned beneath the nearby ledge; the floor route stays open.
  const environment = [{ type: "movableBox", x: 4200, y: f - CONFIG.movableBox.height }];
  gameState.movableBoxes = environment.filter(item => item.type === "movableBox").map(makeMovableBox);
  gameState.slopes = [{ x: 2380, y: f, w: 240, h: 100, direction: 1 }];
  gameState.enemies = [
    makeEnemy("fire", 760, 446, 650, 850), makeEnemy("slime", 1160, 446, 1010, 1450), makeEnemy("ice", 2080, 446, 1900, 2300),
    makeEnemy("fire", 3650, 446, 3600, 3670), makeEnemy("slime", 3725, 446, 3700, 3755), makeEnemy("ice", 3800, 446, 3780, 3840),
    makeEnemy("slime", 4100, 446, 3900, 4300), makeEnemy("ice", 4560, 446, 4400, 4800)
  ];
  gameState.enemies.forEach((enemy, index) => { enemy.entityId = index; });
  gameState.wall = rect(1280, 270, 42, 210, "destructible");
  gameState.switch = { x: 2190, y: 220, w: 28, h: 28, active: false };
  gameState.door = rect(2340, 350, 34, 130, "door");
  gameState.checkpoint = { ...CONFIG.checkpoint, active: false };
  gameState.goal = { x: CONFIG.level.goalX, y: CONFIG.level.floorY - CONFIG.level.goalHeight, w: CONFIG.level.goalWidth, h: CONFIG.level.goalHeight };
  gameState.collectible = { x: 1370, y: 342, radius: 13, collected: false };
}
function createStartingAmmo() {
  const configuredAmmo = Array.isArray(CONFIG.player.startingAmmo) ? CONFIG.player.startingAmmo : [];
  const validTypes = new Set(Array.isArray(CONFIG.ammo.types) ? CONFIG.ammo.types : []);
  const capacity = Number.isFinite(CONFIG.ammo.capacity) ? Math.max(0, Math.floor(CONFIG.ammo.capacity)) : 0;
  return configuredAmmo.filter(type => validTypes.has(type)).slice(0, capacity);
}
function resetGame() {
  buildLevel();
  gameState.phase = "playing"; gameState.result = null; gameState.time = 0; gameState.camera.x = 0;
  gameState.projectiles = []; gameState.shards = []; gameState.effects = [];
  gameState.player = { x: CONFIG.player.startX, y: CONFIG.player.startY, w: CONFIG.player.width, h: CONFIG.player.height, vx: 0, vy: 0, grounded: false, supportSurface: null, frozenSupport: null, boxSupport: null, health: CONFIG.player.health, retries: CONFIG.player.retries, invulnerable: 0, cooldown: 0, ammo: createStartingAmmo(), selectedAmmoIndex: 0, respawn: { x: CONFIG.player.startX, y: CONFIG.player.startY }, emptyFlash: 0, wallContact: { left: false, right: false }, isWallSliding: false, wallJumpLockTimer: 0, wallJumpBlockedSide: null, wallDetachTimer: 0 };
  clearGameplayInput();
}

function clearGameplayInput() {
  const i = gameState.input;
  i.keys = {}; i.pressed = {}; i.mouse.down = false; i.mouse.jumpDown = false;
  i.jump.pressed = false; i.jump.held = false; i.jump.released = false;
}

function overlap(a, b) { return Boolean(a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y); }
function circleRect(c, r) { const x = Math.max(r.x, Math.min(c.x, r.x + r.w)); const y = Math.max(r.y, Math.min(c.y, r.y + r.h)); return (c.x-x)**2 + (c.y-y)**2 <= c.radius**2; }
function validEntity(e) { return e && Number.isFinite(e.x) && Number.isFinite(e.y); }
function solids(includeFrozen = false) {
  // Belts precede overlapping base floor so their top is recorded as support.
  const list = gameState.conveyors.filter(p => p.active).concat(gameState.platforms.filter(p => p.active));
  if (gameState.wall?.active) list.push(gameState.wall);
  if (gameState.door?.active && !gameState.switch?.active) list.push(gameState.door);
  for (const box of gameState.movableBoxes) if (box.active) list.push(box);
  if (includeFrozen) for (const e of gameState.enemies) if (e.alive && e.frozen > 0) list.push(e);
  return list;
}
function addEffect(type, x, y, color, life = CONFIG.effects.defaultLife, text = "") { gameState.effects.push({ type, x, y, color, life, maxLife: life, text }); }
function clampAmmoIndex() { const p = gameState.player; p.selectedAmmoIndex = p.ammo.length ? Math.max(0, Math.min(p.selectedAmmoIndex, p.ammo.length - 1)) : 0; }
function cycleAmmo(direction) {
  const p = gameState.player; if (!p) return;
  const count = p.ammo.length;
  if (!count) { p.selectedAmmoIndex = 0; return; }
  clampAmmoIndex();
  p.selectedAmmoIndex = (p.selectedAmmoIndex + Math.sign(direction) + count) % count;
}
function grantAmmo(enemy) {
  if (enemy.dropGranted) return; enemy.dropGranted = true;
  const map = { fire: "explosion", slime: "bounce", ice: "freeze" }; const ammo = map[enemy.type];
  if (ammo && gameState.player.ammo.length < CONFIG.ammo.capacity) { gameState.player.ammo.push(ammo); clampAmmoIndex(); addEffect("text", enemy.x, enemy.y, ammoColor(ammo), CONFIG.effects.messageLife, `+ ${ammo.toUpperCase()}`); }
  else addEffect("text", enemy.x, enemy.y, CONFIG.colors.danger, CONFIG.effects.messageLife, "AMMO FULL");
}
function defeatEnemy(enemy) {
  if (!enemy?.alive) return false;
  const player = gameState.player;
  if (player?.frozenSupport === enemy) { player.frozenSupport = null; player.supportSurface = null; player.grounded = false; }
  enemy.alive = false; enemy.frozen = 0;
  grantAmmo(enemy);
  addEffect("burst", enemy.x + enemy.w/2, enemy.y + enemy.h/2, ammoColor({fire:"explosion",slime:"bounce",ice:"freeze"}[enemy.type]));
  return true;
}
function damageEnemy(enemy, amount, freeze = false) {
  if (!enemy?.alive) return; enemy.hp -= amount; enemy.hit = CONFIG.enemies.hitTime;
  if (freeze && enemy.hp > 0) { enemy.frozen = CONFIG.projectile.freezeDuration; enemy.vx = 0; enemy.vy = 0; }
  if (enemy.hp <= 0) defeatEnemy(enemy);
}
function triggerShatter(enemy) {
  if (!enemy?.alive || !(enemy.frozen > 0)) return false;
  const x = enemy.x + enemy.w/2, y = enemy.y + enemy.h/2;
  const player = gameState.player;
  if (player?.frozenSupport === enemy) { player.frozenSupport = null; player.grounded = false; }
  enemy.frozen = 0;
  if (!defeatEnemy(enemy)) return false;
  addEffect("shatter", x, y, CONFIG.colors.freeze, CONFIG.shatter.flashDuration);
  for (let index = 0; index < CONFIG.shatter.shardCount; index++) {
    const angle = index * CONFIG.render.pi2 / CONFIG.shatter.shardCount;
    gameState.shards.push({ x, y, radius: CONFIG.shatter.shardSize, vx: Math.cos(angle) * CONFIG.shatter.shardSpeed, vy: Math.sin(angle) * CONFIG.shatter.shardSpeed, angle, life: CONFIG.shatter.shardLifetime, alive: true, source: enemy });
  }
  return true;
}
function ammoColor(type) { return CONFIG.colors[type] || CONFIG.colors.gold; }

function validTopSupport(body, support) {
  if (!body?.grounded || !support || support.active === false) return false;
  const tolerance = CONFIG.conveyor.contactTolerance;
  return body.x + body.w > support.x && body.x < support.x + support.w && Math.abs(body.y + body.h - support.y) <= tolerance;
}
function conveyorVelocity(body) {
  return validTopSupport(body, body.supportSurface) && body.supportSurface.kind === "conveyor"
    ? body.supportSurface.direction * CONFIG.conveyor.speed : 0;
}
function moveBodyHorizontal(body, amount, extraSolids = false) {
  if (!amount) return 0;
  const start = body.x;
  body.x += amount;
  for (const s of solids(extraSolids)) if (s !== body && overlap(body, s)) {
    if (amount > 0) body.x = Math.min(body.x, s.x - body.w);
    else body.x = Math.max(body.x, s.x + s.w);
  }
  return body.x - start;
}
function resolveBody(body, dt, extraSolids = true) {
  if (!body.grounded) {
    const resting = solids(extraSolids).find(s => s !== body && body.x + body.w > s.x && body.x < s.x + s.w && Math.abs(body.y + body.h - s.y) <= CONFIG.conveyor.contactTolerance);
    if (resting) { body.grounded = true; body.supportSurface = resting; }
  }
  const ownDx = body.vx * dt;
  const surfaceDx = conveyorVelocity(body) * dt;
  const moved = moveBodyHorizontal(body, ownDx + surfaceDx, extraSolids);
  if (Math.abs(moved - (ownDx + surfaceDx)) > CONFIG.physics.epsilon && Math.sign(body.vx) === Math.sign(ownDx + surfaceDx)) body.vx = 0;
  body.y += body.vy * dt; body.grounded = false;
  body.supportSurface = null;
  for (const s of solids(extraSolids)) if (overlap(body, s)) {
    if (body.vy > 0) { body.y = s.y - body.h; body.grounded = true; body.supportSurface = s; } else if (body.vy < 0) body.y = s.y + s.h;
    body.vy = 0;
  }
  // Stable stepped slope surface; other collision remains axis-aligned.
  for (const slope of gameState.slopes) {
    const center = body.x + body.w/2;
    if (center >= slope.x && center <= slope.x + slope.w && body.vy >= 0) {
      const surface = slope.y - slope.h * ((center - slope.x) / slope.w);
      if (body.y + body.h >= surface && body.y + body.h <= slope.y + body.h) { body.y = surface - body.h; body.vy = 0; body.grounded = true; body.supportSurface = slope; }
    }
  }
  if (!body.grounded) {
    const resting = solids(extraSolids).find(s => s !== body && body.x + body.w > s.x && body.x < s.x + s.w && Math.abs(body.y + body.h - s.y) <= CONFIG.conveyor.contactTolerance);
    if (resting) { body.grounded = true; body.supportSurface = resting; }
  }
}

function updateInput(dt) {
  const i = gameState.input;
  const held = Boolean(i.keys.Space || i.mouse.jumpDown);
  i.jump.pressed = !i.jump.held && Boolean(held || i.pressed.Space || i.pressed.MouseJump);
  i.jump.released = i.jump.held && !held;
  i.jump.held = held;
}
function detectWallContact(body) {
  const tolerance = CONFIG.player.wallContactTolerance;
  const contact = { left: false, right: false };
  // Frozen enemies are one-way landing surfaces, never sticky wall-jump walls.
  for (const solid of solids(false)) {
    const verticalOverlap = body.y + body.h > solid.y + tolerance && body.y < solid.y + solid.h - tolerance;
    if (!verticalOverlap) continue;
    if (Math.abs(body.x - (solid.x + solid.w)) <= tolerance) contact.left = true;
    if (Math.abs(body.x + body.w - solid.x) <= tolerance) contact.right = true;
  }
  return contact;
}
function getWallJumpSide(p) {
  if (p.wallContact.left && p.wallJumpBlockedSide !== "left") return "left";
  if (p.wallContact.right && p.wallJumpBlockedSide !== "right") return "right";
  return null;
}
function updateWallRecontact(p, dt) {
  if (!p.wallJumpBlockedSide) return;
  if (p.wallContact[p.wallJumpBlockedSide]) p.wallDetachTimer = 0;
  else {
    p.wallDetachTimer += dt;
    if (p.wallDetachTimer >= CONFIG.player.wallRecontactDuration) { p.wallJumpBlockedSide = null; p.wallDetachTimer = 0; }
  }
}
function updatePlayer(dt) {
  const p = gameState.player, i = gameState.input; if (!p) return;
  const riding = p.boxSupport || p.frozenSupport;
  const ridingValid = p.boxSupport ? riding?.active : riding?.alive && riding.frozen > 0;
  if (ridingValid && Number.isFinite(riding.surfaceDeltaX) && validTopSupport(p, riding)) {
    moveBodyHorizontal(p, riding.surfaceDeltaX, false);
  } else if (riding && !ridingValid) {
    p.frozenSupport = null; p.boxSupport = null; p.supportSurface = null; p.grounded = false;
  }
  p.wallContact = detectWallContact(p);
  updateWallRecontact(p, dt);
  p.wallJumpLockTimer = Math.max(0, p.wallJumpLockTimer - dt);
  const direction = (i.keys.KeyD ? 1 : 0) - (i.keys.KeyA ? 1 : 0);
  const acceleration = p.grounded ? CONFIG.player.accel : CONFIG.player.airAccel;
  if (p.wallJumpLockTimer <= 0) {
    if (direction) p.vx = Math.max(-CONFIG.player.maxSpeed, Math.min(CONFIG.player.maxSpeed, p.vx + direction * acceleration * dt));
    else { const decel = CONFIG.player.decel * dt; p.vx = Math.abs(p.vx) <= decel ? 0 : p.vx - Math.sign(p.vx) * decel; }
  }
  const wallSide = !p.grounded ? getWallJumpSide(p) : null;
  // Held jump may use a newly re-contacted wall. wallJumpBlockedSide still
  // requires a real detach first, so uninterrupted contact cannot retrigger it.
  const wantsWallJump = wallSide && (i.jump.pressed || i.jump.held) && p.wallJumpLockTimer <= 0;
  if (i.jump.pressed || wantsWallJump) {
    if (p.grounded) { p.vy = -CONFIG.player.jump; p.grounded = false; }
    else if (wantsWallJump) {
      p.vx = wallSide === "left" ? CONFIG.player.wallJumpHorizontalSpeed : -CONFIG.player.wallJumpHorizontalSpeed;
      p.vy = -CONFIG.player.wallJumpVerticalSpeed; p.wallJumpLockTimer = CONFIG.player.wallJumpControlLockDuration;
      p.wallJumpBlockedSide = wallSide; p.wallDetachTimer = 0;
    }
  }
  if (!i.jump.held && p.vy < 0) p.vy *= Math.pow(CONFIG.player.jumpCut, dt);
  p.vy = Math.min(CONFIG.physics.maxFall, p.vy + CONFIG.physics.gravity * dt);
  const previousBottom = p.y + p.h;
  resolveBody(p, dt, false);
  resolveFrozenEnemyPlatforms(p, previousBottom);
  p.boxSupport = p.grounded && p.supportSurface?.type === "movableBox" ? p.supportSurface : null;
  p.wallContact = detectWallContact(p);
  p.isWallSliding = !p.grounded && (p.wallContact.left || p.wallContact.right) && p.vy >= 0;
  if (p.isWallSliding) p.vy = Math.min(p.vy, CONFIG.player.wallSlideMaxFallSpeed);
  p.invulnerable = Math.max(0, p.invulnerable - dt); p.cooldown = Math.max(0, p.cooldown - dt); p.emptyFlash = Math.max(0, p.emptyFlash - dt);
  if (i.mouse.down && p.cooldown <= 0) shoot();
  for (const e of gameState.enemies) if (e.alive && e.frozen <= 0 && overlap(p, e)) {
    const cameFromAbove = p.vy > 0 && p.y + p.h - p.vy * dt <= e.y + CONFIG.physics.epsilon;
    if (cameFromAbove) { damageEnemy(e, CONFIG.enemies.health); p.vy = -CONFIG.player.jump * CONFIG.player.jumpCut; }
    else damagePlayer(CONFIG.enemies.contactDamage, p.x < e.x ? -1 : 1);
  }
  if (p.y > CONFIG.level.killY) killPlayer();
  if (!gameState.checkpoint.active && overlap(p, gameState.checkpoint)) activateCheckpoint();
  if (!gameState.collectible.collected && circleRect(gameState.collectible, p)) { gameState.collectible.collected = true; addEffect("text", p.x, p.y, CONFIG.colors.gold, CONFIG.effects.messageLife, "SECRET CORE!"); }
  if (overlap(p, gameState.goal)) finish("win");
}
function resolveFrozenEnemyPlatforms(player, previousBottom) {
  player.frozenSupport = null;
  if (player.vy < 0) return;
  let landing = null;
  for (const enemy of gameState.enemies) {
    if (!enemy.alive || enemy.frozen <= 0) continue;
    const horizontal = player.x + player.w > enemy.x && player.x < enemy.x + enemy.w;
    const crossedTop = previousBottom <= enemy.y + CONFIG.interactions.frozenLandingTolerance && player.y + player.h >= enemy.y;
    if (horizontal && crossedTop && (!landing || enemy.y < landing.y)) landing = enemy;
  }
  if (landing) { player.y = landing.y - player.h; player.vy = 0; player.grounded = true; player.frozenSupport = landing; player.supportSurface = landing; }
}
function damagePlayer(amount, direction) {
  const p = gameState.player; if (!p || p.invulnerable > 0) return;
  p.health -= amount; p.invulnerable = CONFIG.player.invulnerability; p.vx = direction * CONFIG.player.knockback * 0.45; p.vy = -CONFIG.player.knockback * 0.45;
  addEffect("text", p.x, p.y, CONFIG.colors.danger, CONFIG.effects.messageLife, `-${amount} HP`); if (p.health <= 0) killPlayer();
}
function killPlayer() {
  const p = gameState.player; if (p.retries <= 0) { finish("lose"); return; }
  p.retries -= 1; p.health = CONFIG.player.health; p.x = p.respawn.x; p.y = p.respawn.y; p.vx = 0; p.vy = 0; p.grounded = false; p.supportSurface = null; p.frozenSupport = null; p.boxSupport = null; p.wallContact = { left: false, right: false }; p.isWallSliding = false; p.wallJumpLockTimer = 0; p.wallJumpBlockedSide = null; p.wallDetachTimer = 0; p.invulnerable = CONFIG.player.invulnerability; gameState.projectiles = []; gameState.shards = []; clearGameplayInput();
  addEffect("text", p.x, p.y, CONFIG.colors.gold, CONFIG.effects.messageLife, `RESPAWN • ${p.retries} RETRIES`);
}
function activateCheckpoint() {
  const c = gameState.checkpoint, p = gameState.player; c.active = true; p.respawn = { x: c.respawnX, y: c.respawnY };
  // A small safety cache makes later mechanics testable without making ammo mandatory.
  for (const type of ["explosion", "bounce", "freeze"]) if (!p.ammo.includes(type) && p.ammo.length < CONFIG.ammo.capacity) p.ammo.push(type);
  clampAmmoIndex(); addEffect("text", c.x, c.y, CONFIG.colors.gold, CONFIG.effects.messageLife, "CHECKPOINT + AMMO CACHE");
}
function getAimVector() {
  const p = gameState.player;
  const sx = p.x + p.w / 2, sy = p.y + p.h / 2;
  const wx = gameState.input.mouse.x + gameState.camera.x, wy = gameState.input.mouse.y;
  const angle = Math.atan2(wy - sy, wx - sx);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
function shoot() {
  const p = gameState.player;
  const hasSpecialAmmo = p.ammo.length > 0;
  if (hasSpecialAmmo) clampAmmoIndex();
  else p.selectedAmmoIndex = 0;
  const type = hasSpecialAmmo ? p.ammo[p.selectedAmmoIndex] : "normal";
  if (!type) return;
  const tuning = type === "normal" ? CONFIG.normalShot : CONFIG.projectile;
  const inheritance = type === "normal" ? tuning.velocityInheritance : tuning.inherit;
  const direction = getAimVector();
  const sx = p.x + p.w / 2, sy = p.y + p.h / 2;
  gameState.projectiles.push({ type, x: sx + direction.x * p.w, y: sy + direction.y * p.h / 2, radius: tuning.radius, vx: direction.x * tuning.speed + p.vx * inheritance, vy: direction.y * tuning.speed + p.vy * inheritance, life: tuning.lifetime, alive: true, bounces: 0, trail: [] });
  p.cooldown = type === "normal" ? CONFIG.normalShot.cooldown : CONFIG.player.shotCooldown;
  if (hasSpecialAmmo) { p.ammo.splice(p.selectedAmmoIndex, 1); clampAmmoIndex(); }
}

function updateEnemies(dt) {
  for (const e of gameState.enemies) {
    if (!e.alive || !validEntity(e)) continue;
    const oldX = e.x;
    const wasFrozen = e.frozen > 0;
    e.hit = Math.max(0, e.hit - dt); e.frozen = Math.max(0, e.frozen - dt);
    if (e.frozen > 0) {
      e.vx = 0; e.vy = 0;
      resolveBody(e, dt, false);
      e.surfaceDeltaX = e.x - oldX;
      continue;
    }
    if (wasFrozen) {
      const p = gameState.player;
      if (p?.frozenSupport === e) { p.y = Math.min(p.y, e.y - p.h); p.vy = -CONFIG.interactions.thawLiftSpeed; p.grounded = false; p.frozenSupport = null; }
      addEffect("burst", e.x + e.w/2, e.y, CONFIG.colors.freeze, CONFIG.effects.defaultLife);
    }
    if (e.type === "slime") { e.hopClock += dt; if (e.grounded && e.hopClock >= CONFIG.enemies.hopPeriod) { e.vy = -CONFIG.enemies.hopSpeed; e.vx = e.x < (e.minX+e.maxX)/2 ? CONFIG.enemies.fireSpeed : -CONFIG.enemies.fireSpeed; e.hopClock = 0; } }
    else { const speed = e.type === "ice" ? CONFIG.enemies.iceSpeed : CONFIG.enemies.fireSpeed; if (!e.vx) e.vx = speed; if (e.x <= e.minX) e.vx = speed; if (e.x + e.w >= e.maxX) e.vx = -speed; }
    e.vy = Math.min(CONFIG.physics.maxFall, e.vy + CONFIG.physics.gravity * dt); resolveBody(e, dt, false);
    e.surfaceDeltaX = e.x - oldX;
  }
}
function damageEnemiesFromBox(box, impactSpeed) {
  if (impactSpeed < CONFIG.movableBox.enemyDamageMinSpeed) return;
  for (const enemy of gameState.enemies) {
    if (!enemy.alive || enemy.frozen > 0 || !overlap(box, enemy) || (box.impactCooldowns[enemy.entityId] || 0) > 0) continue;
    box.impactCooldowns[enemy.entityId] = CONFIG.movableBox.enemyImpactCooldown;
    damageEnemy(enemy, CONFIG.movableBox.enemyImpactDamage);
    box.vx *= CONFIG.movableBox.impactVelocityRetain;
    box.vy *= Math.abs(CONFIG.movableBox.impactVelocityRetain);
    break;
  }
}
function updateMovableBoxes(dt) {
  for (const box of gameState.movableBoxes) {
    if (!box.active || !validEntity(box)) continue;
    box.previousX = box.x; box.previousY = box.y; box.flash = Math.max(0, box.flash - dt);
    for (const key of Object.keys(box.impactCooldowns)) {
      box.impactCooldowns[key] -= dt;
      if (box.impactCooldowns[key] <= 0) delete box.impactCooldowns[key];
    }
    if (box.grounded) {
      const deceleration = CONFIG.movableBox.groundDeceleration * dt;
      box.vx = Math.abs(box.vx) <= deceleration ? 0 : box.vx - Math.sign(box.vx) * deceleration;
    }
    box.vy = Math.min(CONFIG.movableBox.maxFallSpeed, box.vy + CONFIG.movableBox.gravity * dt);
    box.vx = Math.max(-CONFIG.movableBox.maxHorizontalSpeed, Math.min(CONFIG.movableBox.maxHorizontalSpeed, box.vx));
    box.vy = Math.max(-CONFIG.movableBox.maxVerticalSpeed, Math.min(CONFIG.movableBox.maxVerticalSpeed, box.vy));
    const travel = Math.max(Math.abs(box.vx * dt + conveyorVelocity(box) * dt), Math.abs(box.vy * dt));
    const steps = Math.max(1, Math.ceil(travel / CONFIG.movableBox.maxMoveStep));
    for (let step = 0; step < steps; step++) {
      const impactSpeed = Math.hypot(box.vx, box.vy);
      resolveBody(box, dt / steps, true);
      damageEnemiesFromBox(box, impactSpeed);
    }
    box.surfaceDeltaX = box.x - box.previousX;
    if (box.y > CONFIG.level.killY + CONFIG.movableBox.cleanupMargin || box.x + box.w < -CONFIG.movableBox.cleanupMargin || box.x > CONFIG.level.width + CONFIG.movableBox.cleanupMargin) {
      box.active = false;
      const player = gameState.player;
      if (player?.boxSupport === box || player?.supportSurface === box) { player.boxSupport = null; player.supportSurface = null; player.grounded = false; }
    }
  }
}
function projectileSolidHit(p) {
  for (const s of solids(false)) if (circleRect(p, s)) {
    const left = Math.abs((p.x + p.radius) - s.x), right = Math.abs((s.x+s.w) - (p.x-p.radius)), top = Math.abs((p.y+p.radius)-s.y), bottom = Math.abs((s.y+s.h)-(p.y-p.radius));
    const m = Math.min(left,right,top,bottom); return { solid:s, nx:m===left?-1:m===right?1:0, ny:m===top?-1:m===bottom?1:0 };
  } return null;
}
function explode(p) {
  if (p.explosionResolved) return;
  p.explosionResolved = true;
  p.alive = false; const hit = new Set();
  for (const e of gameState.enemies) if (e.alive) { const dx=e.x+e.w/2-p.x, dy=e.y+e.h/2-p.y; if (dx*dx+dy*dy <= CONFIG.projectile.explosionRadius**2 && !hit.has(e)) { hit.add(e); if (!triggerShatter(e)) damageEnemy(e, CONFIG.projectile.damage); } }
  if (gameState.wall?.active && circleRect({ x:p.x, y:p.y, radius:CONFIG.projectile.explosionRadius }, gameState.wall)) {
    const cx=gameState.wall.x+gameState.wall.w/2, cy=gameState.wall.y+gameState.wall.h/2;
    gameState.wall.active=false;
    addEffect("destruction", cx, cy, CONFIG.colors.explosion, CONFIG.effects.destructionLife);
    addEffect("text", cx, cy, CONFIG.colors.explosion, CONFIG.effects.messageLife, "WALL DESTROYED");
  }
  const blast = { x: p.x, y: p.y, radius: CONFIG.projectile.explosionRadius };
  for (const box of gameState.movableBoxes) if (box.active && circleRect(blast, box)) {
    let dx = box.x + box.w / 2 - p.x, dy = box.y + box.h / 2 - p.y;
    let distance = Math.hypot(dx, dy);
    if (distance <= CONFIG.physics.epsilon) { dx = 0; dy = -1; distance = 1; }
    box.vx = Math.max(-CONFIG.movableBox.maxHorizontalSpeed, Math.min(CONFIG.movableBox.maxHorizontalSpeed, box.vx + dx / distance * CONFIG.movableBox.explosionImpulse));
    box.vy = Math.max(-CONFIG.movableBox.maxVerticalSpeed, Math.min(CONFIG.movableBox.maxVerticalSpeed, box.vy + dy / distance * CONFIG.movableBox.explosionImpulse));
    box.grounded = false; box.supportSurface = null; box.flash = CONFIG.movableBox.flashDuration;
    addEffect("burst", box.x + box.w / 2, box.y + box.h / 2, CONFIG.colors.explosion);
  }
  const pl=gameState.player, dx=pl.x+pl.w/2-p.x, dy=pl.y+pl.h/2-p.y, d=Math.hypot(dx,dy);
  if (d < CONFIG.projectile.explosionRadius && d > CONFIG.physics.epsilon) { const force=CONFIG.player.knockback*(1-d/CONFIG.projectile.explosionRadius); pl.vx += dx/d*force; pl.vy += dy/d*force; }
  addEffect("explosion", p.x, p.y, CONFIG.colors.explosion, CONFIG.effects.explosionLife);
}
function updateShards(dt) {
  for (const shard of gameState.shards) {
    if (!shard.alive || !validEntity(shard)) continue;
    shard.life -= dt; shard.x += shard.vx * dt; shard.y += shard.vy * dt;
    if (shard.life <= 0 || shard.x < 0 || shard.x > CONFIG.level.width || shard.y > CONFIG.level.killY || projectileSolidHit(shard)) { shard.alive = false; continue; }
    for (const enemy of gameState.enemies) {
      if (!enemy?.alive || enemy === shard.source || !circleRect(shard, enemy)) continue;
      damageEnemy(enemy, CONFIG.shatter.shardDamage); shard.alive = false; break;
    }
  }
}
function updateProjectiles(dt) {
  for (const p of gameState.projectiles) {
    if (!p.alive || !validEntity(p)) continue; p.life -= dt; p.trail.push({x:p.x,y:p.y}); if (p.trail.length > CONFIG.render.trailLength) p.trail.shift();
    p.x += p.vx*dt; p.y += p.vy*dt;
    let target = null; for (const e of gameState.enemies) if (e.alive && circleRect(p,e)) { target=e; break; }
    if (target) { if (p.type === "explosion") explode(p); else { damageEnemy(target, p.type === "freeze" ? 0 : p.type === "normal" ? CONFIG.normalShot.damage : CONFIG.projectile.damage, p.type === "freeze"); p.alive=false; } continue; }
    if (p.type === "bounce" && gameState.switch && !gameState.switch.active && circleRect(p,gameState.switch)) { gameState.switch.active=true; gameState.door.active=false; p.alive=false; addEffect("text", gameState.switch.x, gameState.switch.y, CONFIG.colors.bounce, CONFIG.effects.messageLife, "SHORTCUT OPEN"); continue; }
    const hit=projectileSolidHit(p); if (hit) {
      if (p.type === "explosion") explode(p);
      else if (p.type === "bounce" && p.bounces < CONFIG.projectile.bounceCount) { if (hit.nx) p.vx=-p.vx*CONFIG.projectile.restitution; if (hit.ny) p.vy=-p.vy*CONFIG.projectile.restitution; p.x += hit.nx*p.radius; p.y += hit.ny*p.radius; p.bounces++; }
      else p.alive=false;
    }
    if (p.life <= 0 || p.x < 0 || p.x > CONFIG.level.width || p.y > CONFIG.level.killY) p.alive=false;
  }
}
function updateEffects(dt) { for (const e of gameState.effects) { e.life -= dt; if (e.type === "text") e.y -= CONFIG.render.fontMedium * dt; } }
function cleanup() { gameState.projectiles = gameState.projectiles.filter(p => p.alive && p.life > 0 && validEntity(p)); gameState.shards = gameState.shards.filter(s => s.alive && s.life > 0 && validEntity(s)); gameState.effects = gameState.effects.filter(e => e.life > 0 && validEntity(e)); gameState.enemies = gameState.enemies.filter(e => e.alive && validEntity(e)); gameState.movableBoxes = gameState.movableBoxes.filter(box => box.active && validEntity(box)); }
function updateCamera(dt) { const target=Math.max(0,Math.min(CONFIG.level.width-CONFIG.canvas.width,gameState.player.x-CONFIG.camera.lead)); gameState.camera.x += (target-gameState.camera.x)*Math.min(1,CONFIG.camera.follow*dt); }
function finish(result) { gameState.phase="gameover"; gameState.result=result; clearGameplayInput(); }
function update(dt) {
  if (gameState.phase !== "playing") return; gameState.time += dt; updateInput(dt); updateMovableBoxes(dt); updateEnemies(dt); updatePlayer(dt); updateProjectiles(dt); updateShards(dt); updateEffects(dt); cleanup(); updateCamera(dt); gameState.input.pressed = {};
}

function drawWorldRect(r, fill, stroke=CONFIG.colors.edge) { if (!r?.active) return; ctx.fillStyle=fill; ctx.fillRect(r.x,r.y,r.w,r.h); ctx.strokeStyle=stroke; ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1); }
function drawBackground() {
  const g=ctx.createLinearGradient(0,0,0,CONFIG.canvas.height); g.addColorStop(0,CONFIG.colors.sky); g.addColorStop(1,CONFIG.colors.sky2); ctx.fillStyle=g; ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);
  ctx.globalAlpha=.16; ctx.strokeStyle="#b9d4ff"; for(let x=-(gameState.camera.x*.2)%CONFIG.render.grid;x<CONFIG.canvas.width;x+=CONFIG.render.grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CONFIG.canvas.height);ctx.stroke();} ctx.globalAlpha=1;
}
function renderLevel() {
  for (const p of gameState.platforms) drawWorldRect(p, p.kind === "platform" ? "#526a8d" : CONFIG.colors.ground);
  for (const belt of gameState.conveyors) drawConveyor(belt);
  for (const s of gameState.slopes) { ctx.fillStyle=CONFIG.colors.ground; ctx.beginPath(); ctx.moveTo(s.x,s.y);ctx.lineTo(s.x+s.w,s.y-s.h);ctx.lineTo(s.x+s.w,s.y);ctx.closePath();ctx.fill();ctx.strokeStyle=CONFIG.colors.edge;ctx.stroke(); }
  drawWorldRect(gameState.wall,"#a45345",CONFIG.colors.explosion);
  if(gameState.wall?.active){ctx.strokeStyle="#ffd0bf";ctx.beginPath();ctx.moveTo(gameState.wall.x+5,gameState.wall.y+12);ctx.lineTo(gameState.wall.x+26,gameState.wall.y+45);ctx.lineTo(gameState.wall.x+10,gameState.wall.y+78);ctx.lineTo(gameState.wall.x+34,gameState.wall.y+112);ctx.stroke();}
  if(gameState.door?.active)drawWorldRect(gameState.door,"#7858a6",CONFIG.colors.bounce);else if(gameState.door){ctx.save();ctx.globalAlpha=.35;ctx.strokeStyle=CONFIG.colors.bounce;ctx.setLineDash([8,8]);ctx.strokeRect(gameState.door.x,gameState.door.y,gameState.door.w,gameState.door.h);ctx.restore();}
  const sw=gameState.switch;if(sw){const pulse=sw.active?Math.sin(gameState.time*CONFIG.interactions.switchPulseSpeed)*2:0;ctx.fillStyle=sw.active?CONFIG.colors.bounce:"#8d6cae";ctx.fillRect(sw.x-pulse,sw.y-pulse,sw.w+pulse*2,sw.h+pulse*2);ctx.strokeStyle="#fff";ctx.strokeRect(sw.x,sw.y,sw.w,sw.h);}
  const c=gameState.checkpoint; ctx.fillStyle=c.active?CONFIG.colors.gold:"#66718a";ctx.fillRect(c.x,c.y,c.width,c.height);ctx.fillStyle=c.active?"#fff3a5":"#9da8bf";ctx.beginPath();ctx.moveTo(c.x+c.width,c.y);ctx.lineTo(c.x+c.width+38,c.y+16);ctx.lineTo(c.x+c.width,c.y+32);ctx.fill();
  const g=gameState.goal;ctx.fillStyle="#8bf7d0";ctx.fillRect(g.x,g.y,g.w,g.h);ctx.fillStyle="#132b35";ctx.fillRect(g.x+10,g.y+15,g.w-20,g.h-15);ctx.fillStyle="#8bf7d0";ctx.font=`${CONFIG.render.fontSmall}px sans-serif`;ctx.fillText("GOAL",g.x+7,g.y-8);
  if(!gameState.collectible.collected){const o=gameState.collectible,pulse=Math.sin(gameState.time*CONFIG.interactions.collectiblePulseSpeed)*CONFIG.interactions.collectiblePulseAmount;ctx.fillStyle=CONFIG.colors.gold;ctx.beginPath();ctx.arc(o.x,o.y,o.radius+pulse,0,CONFIG.render.pi2);ctx.fill();ctx.strokeStyle="#fff";ctx.stroke();}
}
function drawConveyor(belt) {
  if (!belt?.active) return;
  drawWorldRect(belt, "#29384e", "#b8d7e8");
  const spacing = CONFIG.conveyor.visualStripeSpacing;
  const offset = (gameState.time * CONFIG.conveyor.visualScrollSpeed * belt.direction) % spacing;
  ctx.save(); ctx.beginPath(); ctx.rect(belt.x, belt.y, belt.w, belt.h); ctx.clip();
  ctx.strokeStyle = "#d8f4ff"; ctx.fillStyle = "#d8f4ff"; ctx.lineWidth = 3;
  for (let x = belt.x - spacing + offset; x < belt.x + belt.w + spacing; x += spacing) {
    const centerY = belt.y + belt.h / 2;
    ctx.beginPath();
    ctx.moveTo(x - belt.direction * 8, centerY - 9);
    ctx.lineTo(x + belt.direction * 7, centerY);
    ctx.lineTo(x - belt.direction * 8, centerY + 9);
    ctx.stroke();
  }
  ctx.restore();
}
function renderMovableBoxes() {
  for (const box of gameState.movableBoxes) {
    ctx.save();
    ctx.fillStyle = box.flash > 0 ? "#ffd8b8" : "#9b6845";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "#f0bd78"; ctx.lineWidth = CONFIG.movableBox.borderWidth;
    ctx.strokeRect(box.x + CONFIG.movableBox.borderWidth / 2, box.y + CONFIG.movableBox.borderWidth / 2, box.w - CONFIG.movableBox.borderWidth, box.h - CONFIG.movableBox.borderWidth);
    const corner = CONFIG.movableBox.cornerSize;
    ctx.fillStyle = "#60412f";
    for (const x of [box.x, box.x + box.w - corner]) for (const y of [box.y, box.y + box.h - corner]) ctx.fillRect(x, y, corner, corner);
    ctx.strokeStyle = "#e5a968"; ctx.beginPath(); ctx.moveTo(box.x + corner, box.y + corner); ctx.lineTo(box.x + box.w - corner, box.y + box.h - corner); ctx.moveTo(box.x + box.w - corner, box.y + corner); ctx.lineTo(box.x + corner, box.y + box.h - corner); ctx.stroke();
    ctx.restore();
  }
}
function renderEnemies() { for(const e of gameState.enemies){ctx.save();if(e.hit>0)ctx.globalAlpha=.45;ctx.fillStyle=e.frozen>0?CONFIG.colors.freeze:e.type==="fire"?CONFIG.colors.explosion:e.type==="slime"?CONFIG.colors.bounce:"#9abfff";ctx.fillRect(e.x,e.y,e.w,e.h);ctx.strokeStyle=e.frozen>0?"#fff":"#1b2034";ctx.lineWidth=e.frozen>0?4:2;ctx.strokeRect(e.x,e.y,e.w,e.h);if(e.frozen>0){ctx.fillStyle="#dff8ff";ctx.fillRect(e.x-3,e.y-5,e.w+6,5);if(e.frozen<=CONFIG.interactions.thawWarning){ctx.globalAlpha=.45+.35*Math.sin(gameState.time*CONFIG.interactions.switchPulseSpeed);ctx.fillStyle="#fff";ctx.fillRect(e.x,e.y,e.w,e.h);}}ctx.fillStyle="#172033";ctx.fillRect(e.x+8,e.y+10,5,5);ctx.fillRect(e.x+25,e.y+10,5,5);ctx.restore();} }
function renderProjectiles(){for(const p of gameState.projectiles){ctx.strokeStyle=ammoColor(p.type);ctx.globalAlpha=p.type==="normal"?.14:.25;ctx.beginPath();for(const t of p.trail)ctx.lineTo(t.x,t.y);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=ammoColor(p.type);ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,CONFIG.render.pi2);ctx.fill();if(p.type!=="normal"){ctx.strokeStyle="#fff";ctx.stroke();}}}
function renderShards(){for(const shard of gameState.shards){ctx.save();ctx.translate(shard.x,shard.y);ctx.rotate(shard.angle);ctx.fillStyle="#dff8ff";ctx.strokeStyle=CONFIG.colors.freeze;ctx.beginPath();ctx.moveTo(CONFIG.shatter.shardSize,0);ctx.lineTo(0,CONFIG.shatter.shardSize/2);ctx.lineTo(-CONFIG.shatter.shardSize,0);ctx.lineTo(0,-CONFIG.shatter.shardSize/2);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}}
function renderPlayer(){const p=gameState.player;if(!p)return;const blink=p.invulnerable>0&&Math.floor(gameState.time*CONFIG.render.playerBlinkRate)%2;ctx.globalAlpha=blink?.35:1;ctx.fillStyle=p.emptyFlash>0?CONFIG.colors.danger:CONFIG.colors.player;ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle="#26334e";ctx.fillRect(p.x+17,p.y+9,6,6);ctx.globalAlpha=1;
  const aim=getAimVector();ctx.strokeStyle="#d9efff";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(p.x+p.w/2,p.y+p.h/2);ctx.lineTo(p.x+p.w/2+aim.x*28,p.y+p.h/2+aim.y*28);ctx.stroke();
  const facing=p.vx<0?-1:1,ordered=p.ammo.map((type,index)=>({type,index}));ordered.sort((a,b)=>(a.index===p.selectedAmmoIndex?-1:b.index===p.selectedAmmoIndex?1:a.index-b.index));
  ordered.forEach(({type,index},slot)=>{const selected=index===p.selectedAmmoIndex,r=selected?8:5,x=p.x+p.w/2-facing*(CONFIG.ammo.followerSpacing*(slot+1)),y=p.y+p.h/2-CONFIG.ammo.followerLift+slot*2;ctx.fillStyle=ammoColor(type);ctx.beginPath();ctx.arc(x,y,r,0,CONFIG.render.pi2);ctx.fill();if(selected){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();}});}
function renderEffects(){for(const e of gameState.effects){const alpha=Math.max(0,e.life/e.maxLife);ctx.globalAlpha=alpha;if(e.type==="explosion"||e.type==="shatter"){ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,e.type==="shatter"?CONFIG.shatter.flashRadius*(1-alpha*(1-CONFIG.shatter.flashStartScale)):CONFIG.projectile.explosionRadius*(1-alpha*.4),0,CONFIG.render.pi2);ctx.fill();}else if(e.type==="burst"||e.type==="destruction"){ctx.strokeStyle=e.color;ctx.lineWidth=5;const radius=(e.type==="destruction"?CONFIG.interactions.wallShardRadius:30)*(1-alpha);ctx.beginPath();ctx.arc(e.x,e.y,radius,0,CONFIG.render.pi2);ctx.stroke();if(e.type==="destruction"){for(let i=0;i<CONFIG.effects.particleCount;i++){const a=i*CONFIG.render.pi2/CONFIG.effects.particleCount;ctx.fillRect(e.x+Math.cos(a)*radius-2,e.y+Math.sin(a)*radius-2,4,4);}}}else{ctx.fillStyle=e.color;ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(e.text,e.x,e.y);}ctx.globalAlpha=1;}}
function renderHud(){const p=gameState.player;ctx.fillStyle="#08101fdd";ctx.fillRect(16,16,470,74);ctx.fillStyle="#fff";ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(`HP ${"♥".repeat(Math.max(0,p.health))}   RETRIES ${p.retries}`,30,44);ctx.font=`${CONFIG.render.fontSmall}px sans-serif`;ctx.fillText("AMMO",30,72);if(!p.ammo.length){ctx.fillStyle="#8995ac";ctx.fillText("EMPTY — defeat enemies",92,72);}p.ammo.forEach((type,i)=>{const x=92+i*72;ctx.fillStyle=ammoColor(type);ctx.fillRect(x,58,14,14);ctx.fillStyle="#fff";ctx.fillText(type[0].toUpperCase(),x+20,71);if(i===p.selectedAmmoIndex)ctx.strokeRect(x-4,54,62,22);});ctx.fillStyle=gameState.collectible.collected?CONFIG.colors.gold:"#8995ac";ctx.fillText(`SECRET ${gameState.collectible.collected?"✓":"○"}`,385,71);}
function overlay(title, lines, footer, color="#fff"){ctx.fillStyle=`rgba(5,9,20,${CONFIG.render.overlayAlpha})`;ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);ctx.textAlign="center";ctx.fillStyle=color;ctx.font=`900 ${CONFIG.render.fontLarge}px sans-serif`;ctx.fillText(title,CONFIG.canvas.width/2,145);ctx.font=`${CONFIG.render.fontMedium}px sans-serif`;lines.forEach((line,i)=>ctx.fillText(line,CONFIG.canvas.width/2,215+i*34));ctx.fillStyle=CONFIG.colors.gold;ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(footer,CONFIG.canvas.width/2,410);ctx.textAlign="left";}
function render(){drawBackground();if(gameState.phase!=="start"&&gameState.player){ctx.save();ctx.translate(-gameState.camera.x,0);renderLevel();renderMovableBoxes();renderEnemies();renderProjectiles();renderShards();renderPlayer();renderEffects();ctx.restore();renderHud();}if(gameState.phase==="start")overlay("ELEMENT RUN",["敵を倒して属性弾を獲得。順番を選び、道を切り拓こう。","A / D: 移動    マウス: 照準    左クリック: 発射","右クリック / Space: ジャンプ    ホイール: 弾薬切替"],"左クリック または Enter でスタート",CONFIG.colors.freeze);else if(gameState.phase==="gameover")overlay(gameState.result==="win"?"COURSE CLEAR!":"RUN OVER",[gameState.result==="win"?`秘密のコア: ${gameState.collectible.collected?"獲得!":"未獲得"}`:"リトライを使い切りました",gameState.result==="win"?"全ゾーンを走破しました。":"もう一度コースに挑戦しよう。"],"R または Enter で最初から",gameState.result==="win"?CONFIG.colors.gold:CONFIG.colors.danger);}

function frame(now){const dt=Math.min(CONFIG.physics.maxDt,(now-gameState.lastFrame)/1000||0);gameState.lastFrame=now;update(dt);render();requestAnimationFrame(frame);}
function pressStartOrRestart(){if(gameState.phase==="start"||gameState.phase==="gameover")resetGame();}
window.addEventListener("keydown",e=>{gameState.input.keys[e.code]=true;if(!e.repeat)gameState.input.pressed[e.code]=true;if(e.code==="Space")e.preventDefault();if((e.code==="Enter"||e.code==="KeyR")&&(gameState.phase!=="playing"))pressStartOrRestart();});
window.addEventListener("keyup",e=>{gameState.input.keys[e.code]=false;});
canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();gameState.input.mouse.x=(e.clientX-r.left)*CONFIG.canvas.width/r.width;gameState.input.mouse.y=(e.clientY-r.top)*CONFIG.canvas.height/r.height;});
canvas.addEventListener("mousedown",e=>{if(e.button===0){if(gameState.phase!=="playing")pressStartOrRestart();else gameState.input.mouse.down=true;}else if(e.button===2&&gameState.phase==="playing"){gameState.input.mouse.jumpDown=true;gameState.input.pressed.MouseJump=true;}});
window.addEventListener("mouseup",e=>{if(e.button===0)gameState.input.mouse.down=false;else if(e.button===2)gameState.input.mouse.jumpDown=false;});
canvas.addEventListener("wheel",e=>{e.preventDefault();if(gameState.phase==="playing"&&e.deltaY)cycleAmmo(e.deltaY>0?1:-1);},{passive:false});
canvas.addEventListener("contextmenu",e=>e.preventDefault());window.addEventListener("blur",clearGameplayInput);
requestAnimationFrame(frame);
