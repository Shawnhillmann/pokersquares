// Tiny seeded RNG (Mulberry32). If no seed is provided, falls back to Math.random.
export function createRng(seed) {
  if (seed == null) {
    return {
      next: () => Math.random(),
      int: (maxExclusive) => Math.floor(Math.random() * maxExclusive)
    };
  }

  let t = (seed >>> 0) || 1;
  const next = () => {
    // mulberry32
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive)
  };
}

