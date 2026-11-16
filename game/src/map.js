// The map: Duskline Yard, a container depot at dusk, 40 x 32 m. Two bomb sites on the
// north side, a mid plaza, and west/east lanes. Every box is a collider for movement and a
// surface a bullet stops on. Axis-aligned boxes only, so the colliders match the meshes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph the bots walk. North is -z (attackers spawn there), south is +z.
export const NODES = {
  tspawn: [0, -13.5],
  tconnector: [0, -8],
  plaza: [0, 0],
  plazaW: [-10, 0],
  plazaE: [10, 0],
  laneW: [-17.5, -4],
  laneW2: [-17.5, 6],
  laneE: [17.5, -4],
  laneE2: [17.5, 6],
  aApproach: [-12, -7],
  siteA: [-14.5, -10],
  bApproach: [12, -7],
  siteB: [14.5, -10],
  cspawn: [0, 13.5],
  cmid: [0, 7],
  cwest: [-11, 9],
  ceast: [11, 9],
  aHold: [-15, -5.5],
  bHold: [15, -5.5],
  midHold: [0, 4],
  aLane: [-17.5, -10],
  bLane: [17.5, -10],
};

export const ROUTES_T = {
  A: ['tspawn', 'tconnector', 'aApproach', 'siteA'],
  B: ['tspawn', 'tconnector', 'bApproach', 'siteB'],
  mid: ['tspawn', 'tconnector', 'plaza'],
  laneW: ['tspawn', 'laneW', 'aLane', 'siteA'],
  laneE: ['tspawn', 'laneE', 'bLane', 'siteB'],
};

export const HOLDS_CT = ['aHold', 'bHold', 'midHold', 'cwest', 'ceast'];

export const SPAWNS_T = [[-4, -13.5], [-2, -14], [2, -14], [4, -13.5]];
export const SPAWNS_CT = [[-4, 13.5], [-2, 14], [0, 13.5], [2, 14], [4, 13.5]];
export const PLAYER_SPAWN = [0, -12];

function makeSignTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.surface;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = PALETTE.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = PALETTE.accent;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteGlow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.55,
    roughness: 0.6,
  });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.9, metalness: 0.02 });
  const containerMat = new THREE.MeshStandardMaterial({ color: 0x46648a, roughness: 0.7, metalness: 0.35 });
  const containerMat2 = new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.7, metalness: 0.35 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter walls, 4.2 m high.
  box(40.4, 0.4, 32.4, 0, -0.2, 0, materials.canvas);
  box(0.4, 4.2, 32.4, -20.2, 2.1, 0, materials.surface);
  box(0.4, 4.2, 32.4, 20.2, 2.1, 0, materials.surface);
  box(40.4, 4.2, 0.4, 0, 2.1, -16.2, materials.surface);
  box(40.4, 4.2, 0.4, 0, 2.1, 16.2, materials.surface);

  // Mid plaza: two containers and pillars that split the sightlines.
  box(5, 2.6, 1.6, -3, 1.3, -1.5, containerMat);
  box(1.6, 2.6, 5, 3, 1.3, 1.5, containerMat2);
  box(1.2, 3.2, 1.2, 0, 1.6, -4.5, materials.hairline);
  box(1.2, 3.2, 1.2, -8, 1.6, 4, materials.hairline);
  box(1.2, 3.2, 1.2, 8, 1.6, 4, materials.hairline);

  // Mid connector choke: two wall segments with a gap in the middle.
  box(0.8, 3.2, 3, -5, 1.6, -8, materials.surface);
  box(0.8, 3.2, 3, 5, 1.6, -8, materials.surface);

  // Site A cover: container along the west wall, crates, a low wall to crouch behind.
  box(1.8, 2.6, 4.5, -18, 1.3, -11, containerMat2);
  box(1.4, 1.1, 1.4, -16.5, 0.55, -6.5, crateMat);
  box(1.4, 1.1, 1.4, -11.5, 0.55, -12.5, crateMat);
  box(4.5, 1.1, 0.8, -13, 0.55, -6.8, materials.hairline);

  // Site B cover, mirrored.
  box(1.8, 2.6, 4.5, 18, 1.3, -11, containerMat);
  box(1.4, 1.1, 1.4, 16.5, 0.55, -6.5, crateMat);
  box(1.4, 1.1, 1.4, 11.5, 0.55, -12.5, crateMat);
  box(4.5, 1.1, 0.8, 13, 0.55, -6.8, materials.hairline);

  // Attacker-side crates and defender-side low wall.
  box(1.4, 1.1, 1.4, -8, 0.55, -11, crateMat);
  box(1.4, 1.1, 1.4, 8, 0.55, -11, crateMat);
  box(5, 1.1, 0.8, 0, 0.55, 8.5, materials.hairline);
  box(1.4, 1.1, 1.4, -7, 0.55, 11, crateMat);
  box(1.4, 1.1, 1.4, 7, 0.55, 11, crateMat);

  // Lane crates.
  box(1.4, 1.1, 1.4, -17.5, 0.55, 0, crateMat);
  box(1.4, 1.1, 1.4, 17.5, 0.55, 0, crateMat);

  // Bomb site floor plates, glowing so a site reads at a glance.
  const sites = [];
  for (const [id, cx, cz] of [['A', -14.5, -10], ['B', 14.5, -10]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), siteGlow);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(cx, 0.02, cz);
    plate.receiveShadow = true;
    group.add(plate);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(id) }),
    );
    sign.position.set(cx, 2.6, -15.9);
    group.add(sign);
    sites.push({
      id,
      center: new THREE.Vector3(cx, 0, cz),
      min: new THREE.Vector3(cx - 3.5, 0, cz - 3),
      max: new THREE.Vector3(cx + 3.5, 0, cz + 3),
    });
  }

  // Dusk light: cool moonlight key, warm sodium lamps over the sites and mid.
  const sky = new THREE.HemisphereLight(new THREE.Color('#3a4560'), new THREE.Color('#1a1d29'), 1.6);
  scene.add(sky);

  const moon = new THREE.DirectionalLight(new THREE.Color('#aebfe8'), 2.4);
  moon.position.set(-10, 16, -8);
  moon.target.position.set(0, 0, 2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 26;
  moon.shadow.camera.bottom = -26;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);

  const lamps = [];
  for (const [x, z, color, intensity] of [
    [-14.5, -10, PALETTE.accent, 110],
    [14.5, -10, PALETTE.accent, 110],
    [0, 0, '#c8d4f0', 70],
  ]) {
    const lamp = new THREE.PointLight(new THREE.Color(color), intensity, 24, 1.8);
    lamp.position.set(x, 4.4, z);
    scene.add(lamp);
    lamps.push(lamp);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
    );
    bulb.position.set(x, 4.4, z);
    group.add(bulb);
  }

  return { colliders, shootables, group, sites, lamps };
}
