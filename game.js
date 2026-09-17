"use strict";

// Every tuneable number used by simulation or presentation is centralized here.
const CONFIG = Object.freeze({
  canvas: { width: 960, height: 540 },
  physics: { gravity: 1800, maxFall: 900, epsilon: 0.01, maxDt: 0.033 },
  player: { width: 30, height: 42, startX: 90, startY: 420, accel: 1900, airAccel: 1050, decel: 2200, maxSpeed: 270, jump: 610, jumpCut: 0.48, health: 4, invulnerability: 1.1, retries: 2, shotCooldown: 0.18, knockback: 560, wallSlideMaxFallSpeed: 155, wallJumpHorizontalSpeed: 145, wallJumpVerticalSpeed: 610, wallContactTolerance: 2, wallJumpControlLockDuration: 0.035, wallRecontactDuration: 0.05 },
  camera: { follow: 5.5, lead: 300 },
  ammo: { capacity: 5, orbitRadius: 35, orbitSpeed: 1.8 },
  projectile: { radius: 7, speed: 570, inherit: 0.18, lifetime: 4, damage: 1, bounceCount: 3, restitution: 0.82, explosionRadius: 105, freezeDuration: 5 },
  enemies: { width: 38, height: 34, health: 1, fireSpeed: 62, iceSpeed: 43, hopSpeed: 310, hopPeriod: 1.7, contactDamage: 1, hitTime: 0.15 },
  effects: { defaultLife: 0.65, explosionLife: 0.38, messageLife: 1.5, particleCount: 10 },
  checkpoint: { x: 3080, y: 390, width: 28, height: 90, respawnX: 3115, respawnY: 390 },
  level: { width: 5200, floorY: 480, killY: 700, goalX: 5090, goalWidth: 58, goalHeight: 110 },
  render: { grid: 80, slopeSteps: 8, fontSmall: 14, fontMedium: 20, fontLarge: 44, overlayAlpha: 0.78, playerBlinkRate: 14, trailLength: 18, pi2: Math.PI * 2 },
  colors: { sky: "#111b35", sky2: "#263d69", ground: "#33435f", edge: "#7488aa", player: "#f6f7fb", explosion: "#ff784f", bounce: "#72ee8b", freeze: "#62c9ff", gold: "#ffe166", danger: "#ff5577" }
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
  player: null, platforms: [], slopes: [], enemies: [], projectiles: [], effects: [],
  wall: null, switch: null, door: null, checkpoint: null, goal: null,
  collectible: { x: 1370, y: 342, radius: 13, collected: false }, assets: {}
};

function rect(x, y, w, h, kind = "solid") { return { x, y, w, h, kind, active: true }; }
function makeEnemy(type, x, y, minX, maxX) {
  return { type, x, y, w: CONFIG.enemies.width, h: CONFIG.enemies.height, vx: type === "ice" ? CONFIG.enemies.iceSpeed : CONFIG.enemies.fireSpeed, vy: 0, minX, maxX, hp: CONFIG.enemies.health, frozen: 0, hit: 0, hopClock: 0, alive: true, dropGranted: false, grounded: false };
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
  gameState.slopes = [{ x: 2380, y: f, w: 240, h: 100, direction: 1 }];
  gameState.enemies = [
    makeEnemy("fire", 760, 446, 650, 850), makeEnemy("slime", 1160, 446, 1010, 1450), makeEnemy("ice", 2080, 446, 1900, 2300),
    makeEnemy("fire", 3650, 446, 3580, 3880), makeEnemy("slime", 4100, 446, 3900, 4300), makeEnemy("ice", 4560, 446, 4400, 4800)
  ];
  gameState.wall = rect(1280, 270, 42, 210, "destructible");
  gameState.switch = { x: 2190, y: 220, w: 28, h: 28, active: false };
  gameState.door = rect(2340, 350, 34, 130, "door");
  gameState.checkpoint = { ...CONFIG.checkpoint, active: false };
  gameState.goal = { x: CONFIG.level.goalX, y: CONFIG.level.floorY - CONFIG.level.goalHeight, w: CONFIG.level.goalWidth, h: CONFIG.level.goalHeight };
  gameState.collectible = { x: 1370, y: 342, radius: 13, collected: false };
}
function resetGame() {
  buildLevel();
  gameState.phase = "playing"; gameState.result = null; gameState.time = 0; gameState.camera.x = 0;
  gameState.projectiles = []; gameState.effects = [];
  gameState.player = { x: CONFIG.player.startX, y: CONFIG.player.startY, w: CONFIG.player.width, h: CONFIG.player.height, vx: 0, vy: 0, grounded: false, health: CONFIG.player.health, retries: CONFIG.player.retries, invulnerable: 0, cooldown: 0, ammo: [], selectedAmmoIndex: 0, respawn: { x: CONFIG.player.startX, y: CONFIG.player.startY }, emptyFlash: 0, wallContact: { left: false, right: false }, isWallSliding: false, wallJumpLockTimer: 0, wallJumpBlockedSide: null, wallDetachTimer: 0 };
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
  const list = gameState.platforms.filter(p => p.active);
  if (gameState.wall?.active) list.push(gameState.wall);
  if (gameState.door?.active && !gameState.switch?.active) list.push(gameState.door);
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
function damageEnemy(enemy, amount, freeze = false) {
  if (!enemy?.alive) return; enemy.hp -= amount; enemy.hit = CONFIG.enemies.hitTime;
  if (freeze && enemy.hp > 0) enemy.frozen = CONFIG.projectile.freezeDuration;
  if (enemy.hp <= 0) { enemy.alive = false; grantAmmo(enemy); addEffect("burst", enemy.x + enemy.w/2, enemy.y + enemy.h/2, ammoColor({fire:"explosion",slime:"bounce",ice:"freeze"}[enemy.type])); }
}
function ammoColor(type) { return CONFIG.colors[type] || CONFIG.colors.gold; }

function resolveBody(body, dt, extraSolids = true) {
  body.x += body.vx * dt;
  for (const s of solids(extraSolids)) if (overlap(body, s)) { if (body.vx > 0) body.x = s.x - body.w; else if (body.vx < 0) body.x = s.x + s.w; body.vx = 0; }
  body.y += body.vy * dt; body.grounded = false;
  for (const s of solids(extraSolids)) if (overlap(body, s)) {
    if (body.vy > 0) { body.y = s.y - body.h; body.grounded = true; } else if (body.vy < 0) body.y = s.y + s.h;
    body.vy = 0;
  }
  // Stable stepped slope surface; other collision remains axis-aligned.
  for (const slope of gameState.slopes) {
    const center = body.x + body.w/2;
    if (center >= slope.x && center <= slope.x + slope.w && body.vy >= 0) {
      const surface = slope.y - slope.h * ((center - slope.x) / slope.w);
      if (body.y + body.h >= surface && body.y + body.h <= slope.y + body.h) { body.y = surface - body.h; body.vy = 0; body.grounded = true; }
    }
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
  for (const solid of solids(true)) {
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
  resolveBody(p, dt, true);
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
function damagePlayer(amount, direction) {
  const p = gameState.player; if (!p || p.invulnerable > 0) return;
  p.health -= amount; p.invulnerable = CONFIG.player.invulnerability; p.vx = direction * CONFIG.player.knockback * 0.45; p.vy = -CONFIG.player.knockback * 0.45;
  addEffect("text", p.x, p.y, CONFIG.colors.danger, CONFIG.effects.messageLife, `-${amount} HP`); if (p.health <= 0) killPlayer();
}
function killPlayer() {
  const p = gameState.player; if (p.retries <= 0) { finish("lose"); return; }
  p.retries -= 1; p.health = CONFIG.player.health; p.x = p.respawn.x; p.y = p.respawn.y; p.vx = 0; p.vy = 0; p.grounded = false; p.wallContact = { left: false, right: false }; p.isWallSliding = false; p.wallJumpLockTimer = 0; p.wallJumpBlockedSide = null; p.wallDetachTimer = 0; p.invulnerable = CONFIG.player.invulnerability; gameState.projectiles = []; clearGameplayInput();
  addEffect("text", p.x, p.y, CONFIG.colors.gold, CONFIG.effects.messageLife, `RESPAWN • ${p.retries} RETRIES`);
}
function activateCheckpoint() {
  const c = gameState.checkpoint, p = gameState.player; c.active = true; p.respawn = { x: c.respawnX, y: c.respawnY };
  // A small safety cache makes later mechanics testable without making ammo mandatory.
  for (const type of ["explosion", "bounce", "freeze"]) if (!p.ammo.includes(type) && p.ammo.length < CONFIG.ammo.capacity) p.ammo.push(type);
  clampAmmoIndex(); addEffect("text", c.x, c.y, CONFIG.colors.gold, CONFIG.effects.messageLife, "CHECKPOINT + AMMO CACHE");
}
function shoot() {
  const p = gameState.player; p.cooldown = CONFIG.player.shotCooldown;
  if (!p.ammo.length) { p.emptyFlash = CONFIG.effects.defaultLife; addEffect("text", p.x, p.y, CONFIG.colors.danger, CONFIG.effects.defaultLife, "EMPTY"); return; }
  clampAmmoIndex(); const type = p.ammo[p.selectedAmmoIndex]; if (!type) return;
  const sx = p.x + p.w/2, sy = p.y + p.h/2, wx = gameState.input.mouse.x + gameState.camera.x, wy = gameState.input.mouse.y;
  const angle = Math.atan2(wy - sy, wx - sx), dx = Math.cos(angle), dy = Math.sin(angle);
  gameState.projectiles.push({ type, x: sx + dx * p.w, y: sy + dy * p.h/2, radius: CONFIG.projectile.radius, vx: dx * CONFIG.projectile.speed + p.vx * CONFIG.projectile.inherit, vy: dy * CONFIG.projectile.speed + p.vy * CONFIG.projectile.inherit, life: CONFIG.projectile.lifetime, alive: true, bounces: 0, trail: [] });
  p.ammo.splice(p.selectedAmmoIndex, 1); clampAmmoIndex();
}

function updateEnemies(dt) {
  for (const e of gameState.enemies) {
    if (!e.alive || !validEntity(e)) continue; e.hit = Math.max(0, e.hit - dt); e.frozen = Math.max(0, e.frozen - dt);
    if (e.frozen > 0) { e.vx = 0; e.vy = 0; continue; }
    if (e.type === "slime") { e.hopClock += dt; if (e.grounded && e.hopClock >= CONFIG.enemies.hopPeriod) { e.vy = -CONFIG.enemies.hopSpeed; e.vx = e.x < (e.minX+e.maxX)/2 ? CONFIG.enemies.fireSpeed : -CONFIG.enemies.fireSpeed; e.hopClock = 0; } }
    else { const speed = e.type === "ice" ? CONFIG.enemies.iceSpeed : CONFIG.enemies.fireSpeed; if (!e.vx) e.vx = speed; if (e.x <= e.minX) e.vx = speed; if (e.x + e.w >= e.maxX) e.vx = -speed; }
    e.vy = Math.min(CONFIG.physics.maxFall, e.vy + CONFIG.physics.gravity * dt); resolveBody(e, dt, false);
  }
}
function projectileSolidHit(p) {
  for (const s of solids(false)) if (circleRect(p, s)) {
    const left = Math.abs((p.x + p.radius) - s.x), right = Math.abs((s.x+s.w) - (p.x-p.radius)), top = Math.abs((p.y+p.radius)-s.y), bottom = Math.abs((s.y+s.h)-(p.y-p.radius));
    const m = Math.min(left,right,top,bottom); return { solid:s, nx:m===left?-1:m===right?1:0, ny:m===top?-1:m===bottom?1:0 };
  } return null;
}
function explode(p) {
  p.alive = false; const hit = new Set();
  for (const e of gameState.enemies) if (e.alive) { const dx=e.x+e.w/2-p.x, dy=e.y+e.h/2-p.y; if (dx*dx+dy*dy <= CONFIG.projectile.explosionRadius**2 && !hit.has(e)) { hit.add(e); damageEnemy(e, CONFIG.projectile.damage); } }
  if (gameState.wall?.active) { const cx=gameState.wall.x+gameState.wall.w/2, cy=gameState.wall.y+gameState.wall.h/2; if ((cx-p.x)**2+(cy-p.y)**2 <= CONFIG.projectile.explosionRadius**2) { gameState.wall.active=false; addEffect("text", cx, cy, CONFIG.colors.explosion, CONFIG.effects.messageLife, "WALL DESTROYED"); } }
  const pl=gameState.player, dx=pl.x+pl.w/2-p.x, dy=pl.y+pl.h/2-p.y, d=Math.hypot(dx,dy);
  if (d < CONFIG.projectile.explosionRadius && d > CONFIG.physics.epsilon) { const force=CONFIG.player.knockback*(1-d/CONFIG.projectile.explosionRadius); pl.vx += dx/d*force; pl.vy += dy/d*force; }
  addEffect("explosion", p.x, p.y, CONFIG.colors.explosion, CONFIG.effects.explosionLife);
}
function updateProjectiles(dt) {
  for (const p of gameState.projectiles) {
    if (!p.alive || !validEntity(p)) continue; p.life -= dt; p.trail.push({x:p.x,y:p.y}); if (p.trail.length > CONFIG.render.trailLength) p.trail.shift();
    p.x += p.vx*dt; p.y += p.vy*dt;
    let target = null; for (const e of gameState.enemies) if (e.alive && circleRect(p,e)) { target=e; break; }
    if (target) { if (p.type === "explosion") explode(p); else { damageEnemy(target, p.type === "freeze" ? 0 : CONFIG.projectile.damage, p.type === "freeze"); p.alive=false; } continue; }
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
function cleanup() { gameState.projectiles = gameState.projectiles.filter(p => p.alive && p.life > 0 && validEntity(p)); gameState.effects = gameState.effects.filter(e => e.life > 0 && validEntity(e)); gameState.enemies = gameState.enemies.filter(e => e.alive && validEntity(e)); }
function updateCamera(dt) { const target=Math.max(0,Math.min(CONFIG.level.width-CONFIG.canvas.width,gameState.player.x-CONFIG.camera.lead)); gameState.camera.x += (target-gameState.camera.x)*Math.min(1,CONFIG.camera.follow*dt); }
function finish(result) { gameState.phase="gameover"; gameState.result=result; clearGameplayInput(); }
function update(dt) {
  if (gameState.phase !== "playing") return; gameState.time += dt; updateInput(dt); updatePlayer(dt); updateEnemies(dt); updateProjectiles(dt); updateEffects(dt); cleanup(); updateCamera(dt); gameState.input.pressed = {};
}

function drawWorldRect(r, fill, stroke=CONFIG.colors.edge) { if (!r?.active) return; ctx.fillStyle=fill; ctx.fillRect(r.x,r.y,r.w,r.h); ctx.strokeStyle=stroke; ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1); }
function drawBackground() {
  const g=ctx.createLinearGradient(0,0,0,CONFIG.canvas.height); g.addColorStop(0,CONFIG.colors.sky); g.addColorStop(1,CONFIG.colors.sky2); ctx.fillStyle=g; ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);
  ctx.globalAlpha=.16; ctx.strokeStyle="#b9d4ff"; for(let x=-(gameState.camera.x*.2)%CONFIG.render.grid;x<CONFIG.canvas.width;x+=CONFIG.render.grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CONFIG.canvas.height);ctx.stroke();} ctx.globalAlpha=1;
}
function renderLevel() {
  for (const p of gameState.platforms) drawWorldRect(p, p.kind === "platform" ? "#526a8d" : CONFIG.colors.ground);
  for (const s of gameState.slopes) { ctx.fillStyle=CONFIG.colors.ground; ctx.beginPath(); ctx.moveTo(s.x,s.y);ctx.lineTo(s.x+s.w,s.y-s.h);ctx.lineTo(s.x+s.w,s.y);ctx.closePath();ctx.fill();ctx.strokeStyle=CONFIG.colors.edge;ctx.stroke(); }
  drawWorldRect(gameState.wall,"#a45345",CONFIG.colors.explosion); drawWorldRect(gameState.door,"#7858a6",CONFIG.colors.bounce);
  const sw=gameState.switch; ctx.fillStyle=sw.active?CONFIG.colors.bounce:"#8d6cae";ctx.fillRect(sw.x,sw.y,sw.w,sw.h);ctx.strokeStyle="#fff";ctx.strokeRect(sw.x,sw.y,sw.w,sw.h);
  const c=gameState.checkpoint; ctx.fillStyle=c.active?CONFIG.colors.gold:"#66718a";ctx.fillRect(c.x,c.y,c.width,c.height);ctx.fillStyle=c.active?"#fff3a5":"#9da8bf";ctx.beginPath();ctx.moveTo(c.x+c.width,c.y);ctx.lineTo(c.x+c.width+38,c.y+16);ctx.lineTo(c.x+c.width,c.y+32);ctx.fill();
  const g=gameState.goal;ctx.fillStyle="#8bf7d0";ctx.fillRect(g.x,g.y,g.w,g.h);ctx.fillStyle="#132b35";ctx.fillRect(g.x+10,g.y+15,g.w-20,g.h-15);ctx.fillStyle="#8bf7d0";ctx.font=`${CONFIG.render.fontSmall}px sans-serif`;ctx.fillText("GOAL",g.x+7,g.y-8);
  if(!gameState.collectible.collected){const o=gameState.collectible;ctx.fillStyle=CONFIG.colors.gold;ctx.beginPath();ctx.arc(o.x,o.y,o.radius,0,CONFIG.render.pi2);ctx.fill();ctx.strokeStyle="#fff";ctx.stroke();}
}
function renderEnemies() { for(const e of gameState.enemies){ctx.save();if(e.hit>0)ctx.globalAlpha=.45;ctx.fillStyle=e.frozen>0?CONFIG.colors.freeze:e.type==="fire"?CONFIG.colors.explosion:e.type==="slime"?CONFIG.colors.bounce:"#9abfff";ctx.fillRect(e.x,e.y,e.w,e.h);ctx.strokeStyle=e.frozen>0?"#fff":"#1b2034";ctx.lineWidth=e.frozen>0?4:2;ctx.strokeRect(e.x,e.y,e.w,e.h);ctx.fillStyle="#172033";ctx.fillRect(e.x+8,e.y+10,5,5);ctx.fillRect(e.x+25,e.y+10,5,5);ctx.restore();} }
function renderProjectiles(){for(const p of gameState.projectiles){ctx.strokeStyle=ammoColor(p.type);ctx.globalAlpha=.25;ctx.beginPath();for(const t of p.trail)ctx.lineTo(t.x,t.y);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=ammoColor(p.type);ctx.beginPath();ctx.arc(p.x,p.y,p.radius,0,CONFIG.render.pi2);ctx.fill();ctx.strokeStyle="#fff";ctx.stroke();}}
function renderPlayer(){const p=gameState.player;if(!p)return;const blink=p.invulnerable>0&&Math.floor(gameState.time*CONFIG.render.playerBlinkRate)%2;ctx.globalAlpha=blink?.35:1;ctx.fillStyle=p.emptyFlash>0?CONFIG.colors.danger:CONFIG.colors.player;ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle="#26334e";ctx.fillRect(p.x+17,p.y+9,6,6);ctx.globalAlpha=1;
  const mx=gameState.input.mouse.x+gameState.camera.x,my=gameState.input.mouse.y,a=Math.atan2(my-(p.y+p.h/2),mx-(p.x+p.w/2));ctx.strokeStyle="#d9efff";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(p.x+p.w/2,p.y+p.h/2);ctx.lineTo(p.x+p.w/2+Math.cos(a)*28,p.y+p.h/2+Math.sin(a)*28);ctx.stroke();
  p.ammo.forEach((type,index)=>{const ang=gameState.time*CONFIG.ammo.orbitSpeed+index*CONFIG.render.pi2/p.ammo.length,selected=index===p.selectedAmmoIndex,r=selected?8:5;ctx.fillStyle=ammoColor(type);ctx.beginPath();ctx.arc(p.x+p.w/2+Math.cos(ang)*CONFIG.ammo.orbitRadius,p.y+p.h/2+Math.sin(ang)*CONFIG.ammo.orbitRadius,r,0,CONFIG.render.pi2);ctx.fill();if(selected){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();}});}
function renderEffects(){for(const e of gameState.effects){const alpha=Math.max(0,e.life/e.maxLife);ctx.globalAlpha=alpha;if(e.type==="explosion"){ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,CONFIG.projectile.explosionRadius*(1-alpha*.4),0,CONFIG.render.pi2);ctx.fill();}else if(e.type==="burst"){ctx.strokeStyle=e.color;ctx.lineWidth=5;ctx.beginPath();ctx.arc(e.x,e.y,30*(1-alpha),0,CONFIG.render.pi2);ctx.stroke();}else{ctx.fillStyle=e.color;ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(e.text,e.x,e.y);}ctx.globalAlpha=1;}}
function renderHud(){const p=gameState.player;ctx.fillStyle="#08101fdd";ctx.fillRect(16,16,470,74);ctx.fillStyle="#fff";ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(`HP ${"♥".repeat(Math.max(0,p.health))}   RETRIES ${p.retries}`,30,44);ctx.font=`${CONFIG.render.fontSmall}px sans-serif`;ctx.fillText("AMMO",30,72);if(!p.ammo.length){ctx.fillStyle="#8995ac";ctx.fillText("EMPTY — defeat enemies",92,72);}p.ammo.forEach((type,i)=>{const x=92+i*72;ctx.fillStyle=ammoColor(type);ctx.fillRect(x,58,14,14);ctx.fillStyle="#fff";ctx.fillText(type[0].toUpperCase(),x+20,71);if(i===p.selectedAmmoIndex)ctx.strokeRect(x-4,54,62,22);});ctx.fillStyle=gameState.collectible.collected?CONFIG.colors.gold:"#8995ac";ctx.fillText(`SECRET ${gameState.collectible.collected?"✓":"○"}`,385,71);}
function overlay(title, lines, footer, color="#fff"){ctx.fillStyle=`rgba(5,9,20,${CONFIG.render.overlayAlpha})`;ctx.fillRect(0,0,CONFIG.canvas.width,CONFIG.canvas.height);ctx.textAlign="center";ctx.fillStyle=color;ctx.font=`900 ${CONFIG.render.fontLarge}px sans-serif`;ctx.fillText(title,CONFIG.canvas.width/2,145);ctx.font=`${CONFIG.render.fontMedium}px sans-serif`;lines.forEach((line,i)=>ctx.fillText(line,CONFIG.canvas.width/2,215+i*34));ctx.fillStyle=CONFIG.colors.gold;ctx.font=`bold ${CONFIG.render.fontMedium}px sans-serif`;ctx.fillText(footer,CONFIG.canvas.width/2,410);ctx.textAlign="left";}
function render(){drawBackground();if(gameState.phase!=="start"&&gameState.player){ctx.save();ctx.translate(-gameState.camera.x,0);renderLevel();renderEnemies();renderProjectiles();renderPlayer();renderEffects();ctx.restore();renderHud();}if(gameState.phase==="start")overlay("ELEMENT RUN",["敵を倒して属性弾を獲得。順番を選び、道を切り拓こう。","A / D: 移動    マウス: 照準    左クリック: 発射","右クリック / Space: ジャンプ    ホイール: 弾薬切替"],"左クリック または Enter でスタート",CONFIG.colors.freeze);else if(gameState.phase==="gameover")overlay(gameState.result==="win"?"COURSE CLEAR!":"RUN OVER",[gameState.result==="win"?`秘密のコア: ${gameState.collectible.collected?"獲得!":"未獲得"}`:"リトライを使い切りました",gameState.result==="win"?"全ゾーンを走破しました。":"もう一度コースに挑戦しよう。"],"R または Enter で最初から",gameState.result==="win"?CONFIG.colors.gold:CONFIG.colors.danger);}

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
