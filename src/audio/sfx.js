let ctx = /** @type {AudioContext|null} */ (null);
let master = /** @type {GainNode|null} */ (null);
let enabled = true;
/** Master gain when SFX enabled at 100% (per-voice gains are small; this was ~0.18 and read quiet on phones). */
const MASTER_GAIN_ON = 0.34;
let volume = 1;

function ensureAudio() {
  if (ctx && master) return { ctx, master };
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = enabled ? MASTER_GAIN_ON * volume : 0;
  master.connect(ctx.destination);
  return { ctx, master };
}

async function resumeIfNeeded() {
  const a = ensureAudio();
  if (!a) return false;
  if (a.ctx.state === "suspended") {
    try {
      await a.ctx.resume();
    } catch {
      // ignored
    }
  }
  return a.ctx.state === "running";
}

/**
 * @param {number} t0
 * @param {number} t1
 * @param {number} v0
 * @param {number} v1
 */
function gainEnv(gain, t0, t1, v0, v1) {
  gain.gain.cancelScheduledValues(t0);
  gain.gain.setValueAtTime(v0, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v1), t1);
}

function playTone({ freq, dur = 0.07, type = "sine", detune = 0, sweepTo = null }) {
  if (!enabled) return;
  const a = ensureAudio();
  if (!a) return;

  const t = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (detune) osc.detune.setValueAtTime(detune, t);
  if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);

  const g = a.ctx.createGain();
  g.gain.value = 0.0001;
  osc.connect(g);
  g.connect(a.master);

  gainEnv(g, t, t + dur, 0.18, 0.0001);
  osc.start(t);
  osc.stop(t + dur + 0.01);
}

function playMetal({ freq, dur = 0.11, strength = 1 }) {
  if (!enabled) return;
  // Simple "coin-ish" clang: add a few detuned partials with fast decay.
  const a = ensureAudio();
  if (!a) return;
  const t = a.ctx.currentTime;

  const g = a.ctx.createGain();
  g.gain.value = 0.0001;
  g.connect(a.master);

  const partials = [
    { m: 1, d: 0, v: 0.16 },
    { m: 2.02, d: 7, v: 0.08 },
    { m: 3.08, d: -11, v: 0.06 },
    { m: 4.19, d: 13, v: 0.04 }
  ];

  for (const p of partials) {
    const osc = a.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * p.m, t);
    osc.detune.setValueAtTime(p.d, t);
    const og = a.ctx.createGain();
    og.gain.value = Math.max(0.0001, p.v * strength);
    osc.connect(og);
    og.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Fast attack, slightly longer tail
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.22 * strength, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function playNoise({ dur = 0.08, highpassHz = 600 } = {}) {
  if (!enabled) return;
  const a = ensureAudio();
  if (!a) return;

  const t = a.ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(a.ctx.sampleRate * dur));
  const buffer = a.ctx.createBuffer(1, bufferSize, a.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // small, crisp noise (not harsh)
    data[i] = (Math.random() * 2 - 1) * 0.6;
  }

  const src = a.ctx.createBufferSource();
  src.buffer = buffer;

  const hp = a.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(highpassHz, t);

  const g = a.ctx.createGain();
  g.gain.value = 0.0001;

  src.connect(hp);
  hp.connect(g);
  g.connect(a.master);

  gainEnv(g, t, t + dur, 0.14, 0.0001);
  src.start(t);
  src.stop(t + dur + 0.01);
}

function speedFromCombo(combo) {
  const c = Math.max(1, Math.floor(combo || 1));
  const speed = 1 + (c - 1) * 0.03;
  return Math.min(2.2, speed);
}

export const sfx = {
  setEnabled(v) {
    enabled = !!v;
    const a = ensureAudio();
    if (!a) return;
    a.master.gain.value = enabled ? MASTER_GAIN_ON * volume : 0;
  },

  isEnabled() {
    return enabled;
  },

  setVolume(v) {
    const n = Number(v);
    volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
    const a = ensureAudio();
    if (!a) return;
    a.master.gain.value = enabled ? MASTER_GAIN_ON * volume : 0;
  },

  getVolume() {
    return volume;
  },

  /**
   * Call once on the first user gesture (click) to unlock audio.
   */
  async unlock() {
    await resumeIfNeeded();
  },

  swapSuccess() {
    // bright double-click
    playTone({ freq: 740, dur: 0.045, type: "triangle", sweepTo: 980 });
    playTone({ freq: 1040, dur: 0.035, type: "sine" });
  },

  swapFail() {
    // dull low blip + tiny noise puff
    playTone({ freq: 210, dur: 0.085, type: "square", sweepTo: 160, detune: -15 });
    playNoise({ dur: 0.06, highpassHz: 900 });
  },

  gameOver() {
    // Soft "run ended" thud + tail (not harsh).
    playTone({ freq: 220, dur: 0.12, type: "triangle", sweepTo: 160, detune: -6 });
    setTimeout(() => playTone({ freq: 140, dur: 0.13, type: "sine", sweepTo: 120 }), 60);
    setTimeout(() => playNoise({ dur: 0.06, highpassHz: 1000 }), 40);
  },

  goalReached(goalIdx = 1) {
    // Bright, satisfying "checkpoint" ping.
    const g = Math.max(1, Math.min(5, Math.floor(goalIdx)));
    const base = 760 + g * 70;
    playMetal({ freq: base, dur: 0.12, strength: 0.9 });
    setTimeout(() => playTone({ freq: base * 1.25, dur: 0.07, type: "sine", sweepTo: base * 1.55 }), 70);
  },

  youWin() {
    // Short celebratory arpeggio.
    playMetal({ freq: 980, dur: 0.16, strength: 1.1 });
    setTimeout(() => playMetal({ freq: 1320, dur: 0.14, strength: 1.05 }), 90);
    setTimeout(() => playTone({ freq: 1760, dur: 0.12, type: "sine", sweepTo: 2200 }), 170);
  },

  hintPurchase() {
    // Short "purchase" chirp: bright + a little metallic tail.
    playTone({ freq: 980, dur: 0.045, type: "triangle", sweepTo: 1320 });
    playMetal({ freq: 1320, dur: 0.08, strength: 0.55 });
  },

  /**
   * Tiny click-ish "card flip" tick used during sequential grow.
   * @param {number} i index within the line
   * @param {number} combo current combo multiplier
   */
  cardFlipTick(i = 0, combo = 1) {
    const c = Math.min(8, Math.max(1, combo));
    const base = 860 + c * 18 + i * 10;
    const sp = speedFromCombo(combo);
    playNoise({ dur: 0.012 / sp, highpassHz: 2200 });
    playTone({ freq: base, dur: 0.03 / sp, type: "triangle", sweepTo: base * 1.08 });
  },

  shuffle() {
    // Short riffle/shuffle noise burst.
    playNoise({ dur: 0.06, highpassHz: 900 });
    playTone({ freq: 320, dur: 0.06, type: "sine", sweepTo: 420 });
  },

  clearStep(combo) {
    // subtle ascending tick; scales slightly with combo
    const base = 520 + Math.min(6, combo) * 45;
    const sp = speedFromCombo(combo);
    playTone({ freq: base, dur: 0.06 / sp, type: "sine", sweepTo: base * 1.15 });
  },

  scoreCoin(combo) {
    // Coin-ish chime layered on clearStep.
    const strength = 0.9 + Math.min(6, combo) * 0.08;
    const sp = speedFromCombo(combo);
    playNoise({ dur: 0.03 / sp, highpassHz: 1500 });
    playMetal({ freq: 880 + Math.min(6, combo) * 60, dur: 0.13, strength });
  },

  /**
   * Hand-type-specific scoring sound (distinct timbre/rhythm).
   * @param {string} type
   * @param {number} combo
   */
  scoreHand(type, combo) {
    const c = Math.min(8, Math.max(1, combo));
    const strength = 0.85 + c * 0.06;
    const sp = speedFromCombo(combo);

    // Small sparkle on every score
    playNoise({ dur: 0.02 / sp, highpassHz: 1800 });

    switch (type) {
      case "TWO_PAIR": {
        playMetal({ freq: 740, dur: 0.11 / sp, strength: 0.9 * strength });
        setTimeout(() => playMetal({ freq: 980, dur: 0.095 / sp, strength: 0.75 * strength }), 55 / sp);
        break;
      }
      case "THREE_OF_A_KIND": {
        playMetal({ freq: 820, dur: 0.12 / sp, strength });
        setTimeout(() => playTone({ freq: 980, dur: 0.07 / sp, type: "sine", sweepTo: 1180 }), 55 / sp);
        break;
      }
      case "STRAIGHT": {
        playTone({ freq: 560, dur: 0.11 / sp, type: "triangle", sweepTo: 980 });
        setTimeout(() => playTone({ freq: 980, dur: 0.08 / sp, type: "sine", sweepTo: 1320 }), 80 / sp);
        break;
      }
      case "FLUSH": {
        playNoise({ dur: 0.06 / sp, highpassHz: 1200 });
        playTone({ freq: 740, dur: 0.11 / sp, type: "sine", sweepTo: 860 });
        break;
      }
      case "FULL_HOUSE": {
        playMetal({ freq: 660, dur: 0.14 / sp, strength });
        setTimeout(() => playMetal({ freq: 880, dur: 0.12 / sp, strength: 0.9 * strength }), 70 / sp);
        break;
      }
      case "FOUR_OF_A_KIND":
      case "STRAIGHT_FLUSH": {
        playMetal({ freq: 980, dur: 0.15 / sp, strength: 1.2 * strength });
        setTimeout(() => playTone({ freq: 1180, dur: 0.09 / sp, type: "sine", sweepTo: 1560 }), 70 / sp);
        break;
      }
      case "ROYAL_FLUSH": {
        playMetal({ freq: 1040, dur: 0.18 / sp, strength: 1.35 * strength });
        setTimeout(() => playMetal({ freq: 1320, dur: 0.14 / sp, strength: 1.2 * strength }), 70 / sp);
        setTimeout(() => playTone({ freq: 1760, dur: 0.12 / sp, type: "sine", sweepTo: 2200 }), 130 / sp);
        break;
      }
      default: {
        // Fallback to coin chime
        const strength2 = 0.9 + Math.min(6, combo) * 0.08;
        playMetal({ freq: 880 + Math.min(6, combo) * 60, dur: 0.13, strength: strength2 });
      }
    }
  }
};

