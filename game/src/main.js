// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, PLAYER_SPAWN, NODES } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { mulberry32 } from './rng.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(map.colliders);
const arsenal = createArsenal(camera, audio);
const bots = createBots(scene, map, random);
const grenades = createGrenades(scene, map.colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const shootTargets = map.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

// The player's body as a target for bot fire: invisible, but raycast still hits it.
const playerHitBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.7, 1.72, 0.7),
  new THREE.MeshBasicMaterial({ visible: false }),
);
playerHitBox.position.set(0, 0.86, -12);
scene.add(playerHitBox);

// The planted bomb: a small blinking case, shown only while a bomb is planted.
const bombProp = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.22, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.5 }),
);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.foe), 0, 8, 1.5);
bombLight.position.y = 0.4;
bombProp.add(bombCase, bombLight);
bombProp.visible = false;
scene.add(bombProp);

const body = player.state;
body.team = 'T';
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let shakeLeft = 0;
let shakeMag = 0;

const rounds = createRounds({
  bots,
  player: body,
  arsenal,
  hud,
  audio,
  map,
  resetPlayer() {
    player.reset(PLAYER_SPAWN[0], PLAYER_SPAWN[1], Math.PI);
    playerHitBox.position.set(PLAYER_SPAWN[0], 0.86, PLAYER_SPAWN[1]);
    grenades.clear();
    bombProp.visible = false;
    hud.setHealth(100);
    shakeLeft = 0;
  },
  onRoundEnd() {},
  onBombExploded(position) {
    audio.explosion();
    shakeLeft = 0.6;
    shakeMag = 0.05;
    applyBlast(position, 9, 200);
  },
});

// One handle for live debugging and automated play-tests: the whole game state in one place.
window.__duskline = { body, rounds, arsenal, bots, map };

const botCtx = {
  player: body,
  playerHitBox,
  phase: 'buy',
  bomb: rounds.state.bomb,
  onShotFired(position, team) {
    bots.hearShot(position, team, elapsed);
  },
  onBotDamaged(victim, damage, attacker) {
    const died = bots.damageBot(victim, damage);
    if (!died) return;
    hud.killfeed(`${attacker.name} downed ${victim.name}`);
    if (victim.isCarrier) rounds.transferCarrierFromBot(victim);
  },
  onPlayerDamaged(amount) {
    damagePlayer(amount);
  },
  onPlanted(bot) {
    rounds.onBotPlanted(bot);
  },
  onDefused(bot) {
    rounds.onBotDefused(bot);
  },
};

function applyBlast(position, radius, maxDamage) {
  const px = position.x;
  const pz = position.z;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const dist = Math.hypot(bot.position.x - px, bot.position.z - pz);
    if (dist > radius) continue;
    const died = bots.damageBot(bot, Math.round(maxDamage * (1 - dist / radius)));
    if (died) hud.killfeed(`Blast downed ${bot.name}`);
  }
  if (body.alive) {
    const dist = Math.hypot(body.position.x - px, body.position.z - pz);
    if (dist <= radius) damagePlayer(Math.round(maxDamage * (1 - dist / radius)));
  }
}

function damagePlayer(amount) {
  if (!body.alive) return;
  body.health -= amount;
  hud.setHealth(body.health);
  hud.damageFlash();
  if (body.health > 0) return;
  body.alive = false;
  hud.showBanner('YOU ARE DOWN — your crew fights on');
  if (document.pointerLockElement) document.exitPointerLock();
  rounds.transferCarrier();
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shakeLeft > 0) {
    camera.rotation.x += (random() * 2 - 1) * shakeMag * shakeLeft;
    camera.rotation.z += (random() * 2 - 1) * shakeMag * shakeLeft;
  }
  playerHitBox.position.set(body.position.x, body.position.y + 0.86, body.position.z);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!arsenal.fire()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootTargets, false)[0];
  bots.hearShot(body.position, 'T', elapsed);
  if (hit) {
    const hitBot = hit.object.userData.bot;
    if (hitBot && hitBot.alive) {
      const dist = hit.distance;
      const falloff = dist < 25 ? 1 : Math.max(0.6, 1 - (dist - 25) / 90);
      const def = arsenal.def();
      const damage = Math.round(def.damage * (hit.object.userData.part === 'head' ? def.headMult : 1) * falloff);
      const died = bots.damageBot(hitBot, damage);
      hud.hitMarker(died, shot ? 4000 : 90);
      audio.hit(died);
      if (died) {
        hud.killfeed(`You downed ${hitBot.name}`);
        rounds.onKill('CT', true);
        if (hitBot.isCarrier) rounds.transferCarrierFromBot(hitBot);
      }
    }
  }
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  return true;
}

function step(dt) {
  elapsed += dt;
  shakeLeft = Math.max(0, shakeLeft - dt);
  botCtx.phase = rounds.state.phase;
  botCtx.bomb = rounds.state.bomb;

  // Bomb prop follows the planted bomb and blinks.
  if (rounds.state.bomb.planted && rounds.state.bomb.position) {
    bombProp.visible = true;
    bombProp.position.set(rounds.state.bomb.position.x, 0.12, rounds.state.bomb.position.z);
    bombLight.intensity = Math.sin(elapsed * 9) > 0 ? 26 : 2;
  } else {
    bombProp.visible = false;
  }

  player.step(dt, input.state.keys);
  arsenal.step(dt);
  bots.step(dt, elapsed, botCtx);
  grenades.step(dt, (position, radius, maxDamage) => {
    audio.explosion();
    shakeLeft = Math.max(shakeLeft, 0.35);
    shakeMag = 0.04;
    applyBlast(position, radius, maxDamage);
  });
  rounds.step(dt);

  // Planting: hold E inside a site while carrying the bomb.
  const site = rounds.siteAt(body.position);
  if (input.state.keys.has('KeyE') && body.alive) {
    rounds.playerPlant(dt, true, site);
  } else {
    rounds.playerPlant(dt, false, site);
  }

  // HUD numbers, pushed every step; the HUD itself skips unchanged values.
  const a = arsenal.ammo[arsenal.state.current];
  hud.setAmmo(a.mag, a.reserve, arsenal.def().name);
  hud.setHealth(body.health);
  hud.setMoney(rounds.state.money);
  hud.setAlive(bots.aliveCount('T') + (body.alive ? 1 : 0), bots.aliveCount('CT'));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && started) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const pressed = input.takePressed();
    if (pressed.has('KeyR')) arsenal.reload();
    if (pressed.has('Digit1') || pressed.has('Digit2') || pressed.has('Digit3')) {
      if (rounds.state.phase === 'buy') {
        rounds.buy(pressed.has('Digit1') ? 'rifle' : pressed.has('Digit2') ? 'smg' : 'grenade');
      } else {
        arsenal.switchTo(pressed.has('Digit1') ? 'pistol' : pressed.has('Digit2') ? 'rifle' : 'smg');
      }
    }
    if (pressed.has('Digit4') && rounds.state.phase === 'buy') rounds.buy('ammo');
    if (pressed.has('KeyB') && rounds.state.phase === 'buy') {
      hud.showBuy(document.getElementById('buy-menu').hidden, arsenal.state.owned);
    }
    if (pressed.has('KeyG')) {
      if (arsenal.throwGrenade()) {
        camera.getWorldDirection(direction);
        muzzle.copy(camera.position).addScaledVector(direction, 0.5);
        grenades.throwFrom(muzzle, direction);
        audio.beep(false);
      }
    }
    if (input.state.firing && arsenal.ready()) shoot(shot ? 0 : arsenal.spread(player.groundSpeed()));
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  rounds.startMatch();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    body.position.set(PLAYER_SPAWN[0], 0, PLAYER_SPAWN[1]);
    body.yaw = Math.PI;
    settle(20);
    hud.showOverlay('start', 0);
    hud.showBuy(false);
  } else if (name === 'play') {
    // Skip the buy phase: jump straight into a live round, mid-fight.
    rounds.state.phase = 'live';
    rounds.state.timer = 62;
    hud.showBuy(false);
    body.position.set(2, 0, 8);
    body.yaw = 0;
    // Stage the fight: two defenders in the plaza, one down, one teammate on the left.
    const ctBots = bots.teamBots('CT');
    ctBots[0].position.set(0, 0, -2);
    ctBots[0].yaw = Math.PI;
    ctBots[1].position.set(-4, 0, 2);
    ctBots[1].yaw = Math.PI * 0.75;
    ctBots[2].alive = false;
    ctBots[2].fall = 1;
    ctBots[2].group.rotation.x = -1.45;
    ctBots[2].group.position.y = -0.08;
    ctBots[2].position.set(3, 0, 4);
    const tBots = bots.teamBots('T');
    tBots[0].position.set(-2, 0, 2);
    tBots[0].yaw = 0;
    settle(12);
    // Aim at the defender in the plaza and fire: a real shot, with flash and hit marker.
    aimAt(new THREE.Vector3(0, 1.3, -2));
    shoot(0);
    settle(2);
    aimAt(new THREE.Vector3(0, 1.3, -2));
    shoot(0);
    // Let the muzzle flash fade before freezing, so the frame shows the hit, not the flash.
    settle(6);
  } else {
    // end: a round just won at site A, the bomb's glow on the floor, defenders down.
    rounds.state.scoreT = 1;
    rounds.state.scoreCT = 0;
    rounds.state.phase = 'end';
    rounds.state.timer = 3;
    hud.showBuy(false);
    hud.setTimer(3, 'END');
    rounds.state.bomb.planted = true;
    rounds.state.bomb.site = map.sites[0];
    rounds.state.bomb.position = { x: -14.5, z: -10 };
    hud.setScore(1, 0, 1);
    hud.showBanner('ROUND WON — bomb detonated');
    hud.setBomb('planted');
    body.position.set(-9, 0, -4);
    const ctBots = bots.teamBots('CT');
    for (const bot of ctBots) {
      bot.alive = false;
      bot.fall = 1;
      bot.group.rotation.x = -1.45;
      bot.group.position.y = -0.08;
    }
    ctBots[0].position.set(-12, 0, -8);
    ctBots[1].position.set(-17, 0, -12);
    const tBots = bots.teamBots('T');
    tBots[0].position.set(-12, 0, -6);
    tBots[0].yaw = Math.PI;
    settle(20);
    aimAt(new THREE.Vector3(-14.5, 1, -10));
  }
  const a = arsenal.ammo[arsenal.state.current];
  hud.setAmmo(a.mag, a.reserve, arsenal.def().name);
  hud.setHealth(body.health);
  hud.setMoney(rounds.state.money);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(false);
  } else if (rounds.state.phase === 'buy') {
    // Free mouse during the buy phase so the menu can be clicked.
    hud.showBuy(true, arsenal.state.owned);
  } else if (rounds.state.phase !== 'match') {
    hud.showOverlay('paused');
  }
});

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!started || rounds.state.phase === 'match') rounds.startMatch();
  input.requestLock();
});

hud.onBuy((kind) => {
  rounds.buy(kind);
});

renderer.domElement.addEventListener('mousedown', () => {
  if (shot || input.state.locked) return;
  if (rounds.state.phase !== 'match' && document.getElementById('overlay').hidden) input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Backdrop before the first click: both teams at their spawns, timer held.
bots.assignRound();
bots.resetPositions();
syncCamera();
hud.setAmmo(12, 36, 'P9');
hud.setHealth(100);
hud.setMoney(800);
hud.setScore(0, 0, 1);
hud.setAlive(5, 5);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
