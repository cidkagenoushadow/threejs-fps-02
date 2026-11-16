// One seeded random source for the whole game, so a staged screenshot with a fixed seed
// always shows the same frame. Live play seeds from the clock.
export function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}
