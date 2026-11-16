// The arsenal: pistol, rifle and SMG as view models with magazines, reloads and the spread
// that punishes moving, plus the frag grenade the player throws with G. It owns the numbers;
// main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9', damage: 28, headMult: 3.5, mag: 12, reserve: 36, gap: 0.22, reload: 1.4, spreadStill: 0.003, spreadMove: 0.02, auto: false, price: 0, sound: 'pistol' },
  rifle: { name: 'VK-47', damage: 34, headMult: 4, mag: 30, reserve: 90, gap: 0.1, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, auto: true, price: 2700, sound: 'rifle' },
  smg: { name: 'Rook-9', damage: 22, headMult: 3, mag: 25, reserve: 100, gap: 0.075, reload: 1.7, spreadStill: 0.004, spreadMove: 0.032, auto: true, price: 1400, sound: 'smg' },
};

const GRENADE_PRICE = 300;

function buildGunModel(kind) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f4a'), roughness: 0.45, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  if (kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), body);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.07), grip);
    handle.position.set(0, -0.08, 0.08);
    model.add(slide, handle);
    model.position.set(0.22, -0.19, -0.34);
  } else if (kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), grip);
    barrel.position.set(0, 0.02, -0.28);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.08), accent);
    mag.position.set(0, -0.12, -0.05);
    model.add(receiver, barrel, mag);
    model.position.set(0.23, -0.2, -0.4);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
    sight.position.set(0, 0.07, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
  }
  return model;
}

export function createArsenal(camera, audio) {
  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    models[kind] = buildGunModel(kind);
    models[kind].visible = kind === 'pistol';
    camera.add(models[kind]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.11, 0.11),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.82);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const [kind, def] of Object.entries(WEAPONS)) ammo[kind] = { mag: def.mag, reserve: def.reserve };

  const state = {
    current: 'pistol',
    owned: { pistol: true, rifle: false, smg: false },
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = (state.current === 'pistol' ? -0.34 : state.current === 'smg' ? -0.4 : -0.42) + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const d = def();
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - ammo[state.current].mag;
        const take = Math.min(need, ammo[state.current].reserve);
        ammo[state.current].mag += take;
        ammo[state.current].reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    def,
    step,
    ready() {
      return ammo[state.current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // Consumes one round and starts the flash/kick. Returns false when nothing fires.
    fire() {
      const a = ammo[state.current];
      if (a.mag <= 0) {
        audio.dryFire();
        return false;
      }
      a.mag -= 1;
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
      audio.shot(def().sound);
      return true;
    },
    reload() {
      const d = def();
      const a = ammo[state.current];
      if (state.reloadLeft > 0 || a.mag === d.mag || a.reserve === 0) return;
      state.reloadLeft = d.reload;
      audio.reload();
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
    },
    switchTo(kind) {
      if (!state.owned[kind] || kind === state.current) return false;
      models[state.current].visible = false;
      state.current = kind;
      models[kind].visible = true;
      state.reloadLeft = 0;
      state.cooldown = 0.1;
      return true;
    },
    buy(kind) {
      if (kind === 'grenade') return false;
      if (state.owned[kind]) return false;
      state.owned[kind] = true;
      ammo[kind] = { mag: WEAPONS[kind].mag, reserve: WEAPONS[kind].reserve };
      this.switchTo(kind);
      return true;
    },
    buyGrenade() {
      state.grenades += 1;
      return true;
    },
    refillAmmo() {
      for (const [kind, d] of Object.entries(WEAPONS)) {
        if (!state.owned[kind]) continue;
        ammo[kind] = { mag: d.mag, reserve: d.reserve };
      }
    },
    throwGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    resetForMatch() {
      state.owned = { pistol: true, rifle: false, smg: false };
      state.grenades = 0;
      state.current = 'pistol';
      for (const kind of Object.keys(WEAPONS)) {
        models[kind].visible = kind === 'pistol';
        ammo[kind] = { mag: WEAPONS[kind].mag, reserve: WEAPONS[kind].reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    grenadePrice: GRENADE_PRICE,
  };
}
