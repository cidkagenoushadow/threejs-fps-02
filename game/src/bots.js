// The bots: four teammates and five enemies, each with a role, a route through the map, and
// a small state machine — route, hold, engage, plant, defuse. They see through line of sight,
// hear gunfire, burst-fire with error that shrinks as they aim, and follow the bomb.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NODES, ROUTES_T, HOLDS_CT, SPAWNS_T, SPAWNS_CT } from './map.js';
import { range, pick } from './rng.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.55;
const SIGHT_RANGE = 42;
const HEAR_RANGE = 26;
const BOT_DAMAGE = 26;
const BOT_HEAD_MULT = 3.5;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;

const NAMES_T = ['Vex', 'Mara', 'Ilya', 'Dario'];
const NAMES_CT = ['Sable', 'Rook', 'Fenn', 'Wren', 'Kade'];

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _end = new THREE.Vector3();
const _probe = new THREE.Box3();
const _ray = new THREE.Raycaster();

function buildBotMesh(team) {
  const group = new THREE.Group();
  const teamColor = team === 'T' ? PALETTE.foe : PALETTE.ally;
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.65, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), darkMat);
  legL.position.set(-0.11, 0.4, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), darkMat);
  legR.position.set(0.11, 0.4, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), torsoMat);
  torso.position.y = 1.16;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skinMat);
  head.position.y = 1.66;
  head.userData.part = 'head';
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.22, 1.18, -0.3);
  group.add(legL, legR, torso, head, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head, gun };
}

function makeTracer(scene) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  return line;
}

export function createBots(scene, map, random) {
  const bots = [];
  const hitMeshes = [];

  const rayTargets = map.shootables.concat(hitMeshes);

  function addBot(team, name, spawn) {
    const { group, torso, head } = buildBotMesh(team);
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);
    const tracer = makeTracer(scene);
    const bot = {
      id: bots.length,
      team,
      name,
      group,
      torso,
      head,
      tracer,
      tracerLeft: 0,
      position: group.position,
      yaw: team === 'T' ? Math.PI : 0,
      hp: 100,
      alive: true,
      fall: 0,
      role: 'attack',
      route: [],
      routeIndex: 0,
      hold: null,
      site: null,
      state: 'route',
      enemy: null,
      enemyIsPlayer: false,
      lastSeen: new THREE.Vector3(),
      lastSeenTime: -99,
      lastHeard: new THREE.Vector3(),
      lastHeardTime: -99,
      aimTime: 0,
      burstLeft: 0,
      burstTimer: 0,
      pauseTimer: 0,
      thinkTimer: random() * 0.12,
      speed: 3.6 + random() * 0.7,
      plantProgress: 0,
      defuseProgress: 0,
      isCarrier: false,
      walkPhase: random() * Math.PI * 2,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < SPAWNS_T.length; i += 1) addBot('T', NAMES_T[i], SPAWNS_T[i]);
  for (let i = 0; i < SPAWNS_CT.length; i += 1) addBot('CT', NAMES_CT[i], SPAWNS_CT[i]);

  function overlaps(x, z, height, lift) {
    _probe.min.set(x - RADIUS, lift, z - RADIUS);
    _probe.max.set(x + RADIUS, height - lift, z + RADIUS);
    for (const collider of map.colliders) if (_probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speedScale = 1) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return true;
    const speed = bot.speed * speedScale;
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;
    const nx = bot.position.x + stepX;
    if (!overlaps(nx, bot.position.z, HEIGHT, 0.04)) bot.position.x = nx;
    const nz = bot.position.z + stepZ;
    if (!overlaps(bot.position.x, nz, HEIGHT, 0.04)) bot.position.z = nz;
    bot.yaw = Math.atan2(dx, dz) + Math.PI;
    bot.walkPhase += dt * 9;
    return false;
  }

  function canSee(bot, targetPos, targetIsPlayer) {
    _eye.set(bot.position.x, EYE, bot.position.z);
    _to.copy(targetPos).sub(_eye);
    const dist = _to.length();
    if (dist > SIGHT_RANGE) return false;
    _to.normalize();
    _fwd.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    // The group's forward is -z, so forward is (-sin yaw, 0, -cos yaw).
    const facing = _fwd.dot(_to);
    if (facing < 0.25 && dist > 7) return false;
    _ray.set(_eye, _to);
    _ray.far = dist + 0.5;
    const hit = _ray.intersectObjects(map.shootables, false)[0];
    if (hit && hit.distance < dist - 0.6) return false;
    return true;
  }

  function fireAt(bot, targetPos, target, targetIsPlayer, ctx) {
    // One burst round: an error cone that shrinks as the bot keeps aiming.
    const error = 0.035 + (bot.aimTime < 0.6 ? 0.05 : 0) + (bot.state === 'route' ? 0.02 : 0);
    _dir.copy(targetPos).sub(_eye.set(bot.position.x, EYE, bot.position.z)).normalize();
    _dir.x += (random() * 2 - 1) * error;
    _dir.y += (random() * 2 - 1) * error;
    _dir.z += (random() * 2 - 1) * error;
    _dir.normalize();
    _ray.set(_eye, _dir);
    _ray.far = 60;
    // One preallocated list: world surfaces plus every bot's hit meshes; the player's
    // hit box is pushed on only while a bot is shooting at the player.
    if (targetIsPlayer) rayTargets.push(ctx.playerHitBox);
    const hit = _ray.intersectObjects(rayTargets, false)[0];
    if (targetIsPlayer) rayTargets.pop();
    // Tracer from the gun to the hit point (or 30 m out).
    if (hit) _end.copy(hit.point);
    else _end.copy(_eye).addScaledVector(_dir, 30);
    const positions = bot.tracer.geometry.attributes.position;
    positions.setXYZ(0, bot.position.x - Math.sin(bot.yaw) * 0.3, 1.25, bot.position.z - Math.cos(bot.yaw) * 0.3);
    positions.setXYZ(1, _end.x, _end.y, _end.z);
    positions.needsUpdate = true;
    bot.tracer.material.opacity = 0.85;
    bot.tracerLeft = 0.07;
    ctx.onShotFired(bot.position, bot.team);
    if (!hit) return;
    const hitBot = hit.object.userData.bot;
    if (hitBot && hitBot.team !== bot.team && hitBot.alive) {
      const part = hit.object.userData.part;
      const damage = BOT_DAMAGE * (part === 'head' ? BOT_HEAD_MULT : 1);
      ctx.onBotDamaged(hitBot, damage, bot);
    } else if (targetIsPlayer && hit.object === ctx.playerHitBox) {
      ctx.onPlayerDamaged(BOT_DAMAGE, bot);
    }
  }

  function assignRound() {
    const tBots = bots.filter((b) => b.team === 'T');
    const ctBots = bots.filter((b) => b.team === 'CT');
    const plans = [
      { site: 'A', route: ROUTES_T.A },
      { site: 'A', route: ROUTES_T.laneW },
      { site: 'B', route: ROUTES_T.B },
      { site: 'B', route: ROUTES_T.laneE },
    ];
    tBots.forEach((bot, i) => {
      bot.role = 'attack';
      bot.site = plans[i].site;
      bot.route = plans[i].route.slice();
      bot.routeIndex = 0;
      bot.state = 'route';
      bot.isCarrier = false;
    });
    ctBots.forEach((bot, i) => {
      bot.role = 'defend';
      bot.hold = HOLDS_CT[i];
      bot.site = i === 0 || i === 3 ? 'A' : i === 1 || i === 4 ? 'B' : null;
      bot.state = 'hold';
      bot.isCarrier = false;
    });
  }

  function resetPositions() {
    const tBots = bots.filter((b) => b.team === 'T');
    const ctBots = bots.filter((b) => b.team === 'CT');
    tBots.forEach((bot, i) => {
      bot.position.set(SPAWNS_T[i][0], 0, SPAWNS_T[i][1]);
      bot.yaw = Math.PI;
      resetBot(bot);
    });
    ctBots.forEach((bot, i) => {
      bot.position.set(SPAWNS_CT[i][0], 0, SPAWNS_CT[i][1]);
      bot.yaw = 0;
      resetBot(bot);
    });
  }

  function resetBot(bot) {
    bot.hp = 100;
    bot.alive = true;
    bot.fall = 0;
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.y = 0;
    bot.enemy = null;
    bot.enemyIsPlayer = false;
    bot.aimTime = 0;
    bot.burstLeft = 0;
    bot.burstTimer = 0;
    bot.pauseTimer = 0;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.tracer.material.opacity = 0;
    bot.tracerLeft = 0;
  }

  function damageBot(bot, amount) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    bot.enemy = null;
    return true;
  }

  function hearShot(position, team, time) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === team) continue;
      const dist = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
      if (dist < HEAR_RANGE) {
        bot.lastHeard.set(position.x, 0, position.z);
        bot.lastHeardTime = time;
      }
    }
  }

  function step(dt, time, ctx) {
    for (const bot of bots) {
      if (bot.tracerLeft > 0) {
        bot.tracerLeft -= dt;
        if (bot.tracerLeft <= 0) bot.tracer.material.opacity = 0;
      }
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
        continue;
      }
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = 0.12;
        perceive(bot, ctx, time);
      }
      act(bot, dt, time, ctx);
      bot.group.rotation.y = bot.yaw;
    }
  }

  function perceive(bot, ctx, time) {
    if (ctx.phase === 'buy') return;
    let best = null;
    let bestDist = Infinity;
    let bestIsPlayer = false;
    // Enemies: the player (if on the other team) and the other team's bots.
    const player = ctx.player;
    if (player.alive && player.team !== bot.team) {
      _to.set(player.position.x, player.position.y + 1.3, player.position.z);
      if (canSee(bot, _to)) {
        const dist = Math.hypot(player.position.x - bot.position.x, player.position.z - bot.position.z);
        if (dist < bestDist) {
          bestDist = dist;
          best = player;
          bestIsPlayer = true;
        }
      }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      _to.set(other.position.x, 1.3, other.position.z);
      if (canSee(bot, _to)) {
        const dist = Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z);
        if (dist < bestDist) {
          bestDist = dist;
          best = other;
          bestIsPlayer = false;
        }
      }
    }
    if (best) {
      bot.enemy = best;
      bot.enemyIsPlayer = bestIsPlayer;
      if (bestIsPlayer) bot.lastSeen.set(best.position.x, best.position.y + 1.3, best.position.z);
      else bot.lastSeen.set(best.position.x, 1.3, best.position.z);
      bot.lastSeenTime = time;
      if (bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'engage';
    } else if (bot.enemy && time - bot.lastSeenTime > 1.2) {
      bot.enemy = null;
      bot.enemyIsPlayer = false;
      if (bot.state === 'engage') bot.state = bot.role === 'attack' ? 'route' : 'hold';
    }
  }

  function act(bot, dt, time, ctx) {
    const phase = ctx.phase;
    if (bot.enemy && !bot.enemy.alive) {
      bot.enemy = null;
      bot.enemyIsPlayer = false;
      if (bot.state === 'engage') bot.state = bot.role === 'attack' ? 'route' : 'hold';
    }
    if (phase === 'buy') {
      // Idle at spawn during the buy phase; defenders drift to their holds.
      if (bot.role === 'defend' && bot.hold) {
        const node = NODES[bot.hold];
        moveToward(bot, node[0], node[1], dt, 0.7);
      }
      return;
    }

    // Bomb planted: defenders converge on it; attackers hold the site.
    if (ctx.bomb.planted && bot.team === 'CT' && bot.state !== 'defuse') {
      const bombPos = ctx.bomb.position;
      const dist = Math.hypot(bot.position.x - bombPos.x, bot.position.z - bombPos.z);
      if (dist > 1.2) {
        moveToward(bot, bombPos.x, bombPos.z, dt);
        return;
      }
      bot.state = 'defuse';
    }

    if (bot.state === 'defuse') {
      bot.defuseProgress += dt;
      bot.yaw += dt * 0.4;
      if (bot.defuseProgress >= DEFUSE_TIME) ctx.onDefused(bot);
      return;
    }

    if (bot.state === 'plant') {
      bot.plantProgress += dt;
      if (bot.plantProgress >= PLANT_TIME) ctx.onPlanted(bot);
      return;
    }

    if (bot.enemy) {
      // Engage: face the enemy, aim, then fire in bursts.
      const target = bot.enemyIsPlayer
        ? _to.set(bot.enemy.position.x, bot.enemy.position.y + 1.3, bot.enemy.position.z)
        : _to.set(bot.enemy.position.x, 1.3, bot.enemy.position.z);
      const dx = target.x - bot.position.x;
      const dz = target.z - bot.position.z;
      const wantYaw = Math.atan2(dx, dz) + Math.PI;
      let dyaw = wantYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.yaw += dyaw * Math.min(1, dt * 8);
      bot.aimTime += dt;
      if (bot.burstLeft > 0) {
        bot.burstTimer -= dt;
        if (bot.burstTimer <= 0) {
          bot.burstTimer = 0.12;
          bot.burstLeft -= 1;
          fireAt(bot, target, bot.enemy, bot.enemyIsPlayer, ctx);
        }
      } else {
        bot.pauseTimer -= dt;
        if (bot.pauseTimer <= 0 && bot.aimTime > 0.4) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.pauseTimer = 0.7 + random() * 0.6;
          bot.aimTime = 0;
        }
      }
      // Strafe a little while engaging, but never walk into a wall.
      if (bot.pauseTimer > 0.3) {
        const strafe = Math.sin(time * 0.7 + bot.id * 2.1) * 0.8;
        const nx = bot.position.x + Math.cos(bot.yaw) * strafe * dt;
        const nz = bot.position.z - Math.sin(bot.yaw) * strafe * dt;
        if (!overlaps(nx, bot.position.z, HEIGHT, 0.04)) bot.position.x = nx;
        if (!overlaps(bot.position.x, nz, HEIGHT, 0.04)) bot.position.z = nz;
      }
      return;
    }

    // No enemy: follow the role.
    if (bot.state === 'route') {
      if (bot.routeIndex >= bot.route.length) {
        if (bot.isCarrier) {
          // At the site with the bomb: plant it.
          bot.state = 'plant';
          bot.plantProgress = 0;
        } else {
          bot.state = 'hold';
        }
        return;
      }
      const node = NODES[bot.route[bot.routeIndex]];
      if (moveToward(bot, node[0], node[1], dt)) bot.routeIndex += 1;
      return;
    }

    if (bot.state === 'hold') {
      // Scan: slow turn, and walk toward a heard shot if one is fresh.
      bot.yaw += dt * 0.35;
      if (time - bot.lastHeardTime < 2.5 && bot.role === 'defend') {
        const dist = Math.hypot(bot.lastHeard.x - bot.position.x, bot.lastHeard.z - bot.position.z);
        if (dist > 2) moveToward(bot, bot.lastHeard.x, bot.lastHeard.z, dt, 0.8);
      }
      return;
    }
  }

  function makeCarrier(bot) {
    // Hand the bomb to a teammate and point it at its site: nearest waypoint first, then
    // the approach and the site itself, so it walks a clear lane instead of backtracking.
    bot.isCarrier = true;
    let nearest = null;
    let nearestDist = Infinity;
    for (const [name, pos] of Object.entries(NODES)) {
      const dist = Math.hypot(bot.position.x - pos[0], bot.position.z - pos[1]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = name;
      }
    }
    const approach = bot.site === 'A' ? 'aApproach' : 'bApproach';
    const siteNode = bot.site === 'A' ? 'siteA' : 'siteB';
    bot.route = nearest === siteNode ? [siteNode] : [nearest, approach, siteNode];
    bot.routeIndex = 0;
    bot.state = 'route';
  }

  return {
    bots,
    hitMeshes,
    assignRound,
    resetPositions,
    damageBot,
    hearShot,
    makeCarrier,
    step,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    teamBots(team) {
      return bots.filter((b) => b.team === team);
    },
  };
}
