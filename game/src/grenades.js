// Thrown frag grenades: an arc, a bounce off the world's boxes, a fuse, then a blast that
// hurts whatever is close and shakes the player's view. One shared mesh per live grenade.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const FUSE = 1.6;
const BLAST_RADIUS = 6;
const BLAST_MAX = 90;

export function createGrenades(scene, colliders) {
  const live = [];
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.6 });
  const probe = new THREE.Box3();
  const next = new THREE.Vector3();
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14, 1.5);
  scene.add(flashLight);
  let flashLeft = 0;

  function overlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function explode(grenade, onBlast) {
    flashLight.position.copy(grenade.position);
    flashLight.intensity = 220;
    flashLeft = 0.22;
    onBlast(grenade.position, BLAST_RADIUS, BLAST_MAX);
    scene.remove(grenade.mesh);
  }

  return {
    live,
    throwFrom(position, direction) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      scene.add(mesh);
      live.push({
        mesh,
        position: mesh.position,
        velocity: new THREE.Vector3(direction.x * 15, direction.y * 15 + 2.5, direction.z * 15),
        fuse: FUSE,
      });
    },
    step(dt, onBlast) {
      flashLeft = Math.max(0, flashLeft - dt);
      if (flashLeft === 0) flashLight.intensity = 0;
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const grenade = live[i];
        grenade.fuse -= dt;
        grenade.velocity.y -= GRAVITY * dt;
        next.copy(grenade.position).addScaledVector(grenade.velocity, dt);
        const hit = overlaps(next.x, next.y, next.z);
        if (hit) {
          // Bounce: flip the velocity on the axis the box is thinnest along.
          const dx = Math.min(Math.abs(next.x - hit.min.x), Math.abs(next.x - hit.max.x));
          const dz = Math.min(Math.abs(next.z - hit.min.z), Math.abs(next.z - hit.max.z));
          const dy = Math.min(Math.abs(next.y - hit.min.y), Math.abs(next.y - hit.max.y));
          if (dy <= dx && dy <= dz) grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.45;
          else if (dx <= dz) grenade.velocity.x = -grenade.velocity.x * 0.45;
          else grenade.velocity.z = -grenade.velocity.z * 0.45;
          grenade.velocity.multiplyScalar(0.7);
        } else {
          grenade.position.copy(next);
        }
        if (grenade.position.y < 0.09) {
          grenade.position.y = 0.09;
          grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
          grenade.velocity.x *= 0.7;
          grenade.velocity.z *= 0.7;
        }
        if (grenade.fuse <= 0) {
          explode(grenade, onBlast);
          live.splice(i, 1);
        }
      }
    },
    clear() {
      for (const grenade of live) scene.remove(grenade.mesh);
      live.length = 0;
      flashLight.intensity = 0;
    },
  };
}
