let enabled = false;
let audio = /** @type {HTMLAudioElement|null} */ (null);
let volume = 0.22;
let trackIndex = 1;
const TRACK_PREFIX = "/audio/track-";
const TRACK_SUFFIX = ".mp3";

function trackUrlForIndex(i) {
  const idx = Math.max(1, Math.floor(i || 1));
  return `${TRACK_PREFIX}${idx}${TRACK_SUFFIX}`;
}

function ensureAudioEl() {
  if (audio) return audio;
  audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = volume;
  audio.src = trackUrlForIndex(trackIndex);
  return audio;
}

async function applyPlayback() {
  const a = ensureAudioEl();
  if (!enabled) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      // ignored
    }
    return;
  }
  try {
    await a.play();
  } catch {
    // Autoplay restrictions or missing file; ignore.
  }
}

export const music = {
  setEnabled(v) {
    enabled = !!v;
    void applyPlayback();
  },

  isEnabled() {
    return enabled;
  },

  setVolume(v) {
    const n = Number(v);
    volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.22;
    const a = ensureAudioEl();
    a.volume = volume;
  },

  getVolume() {
    return volume;
  },

  /**
   * Set the music track URL (served from /public).
   * Example: "/audio/track-1.mp3"
   * @param {string} url
   */
  setTrack(url) {
    const next = String(url || "");
    const a = ensureAudioEl();
    a.src = next;
    if (enabled) void applyPlayback();
  },

  getTrackIndex() {
    return trackIndex;
  },

  getTrackLabel() {
    return `Track ${trackIndex}`;
  },

  /**
   * Cycles through `/public/audio/track-N.mp3`.
   * If a track is missing, it will auto-skip until it finds one (up to a small cap).
   */
  async nextTrack() {
    const a = ensureAudioEl();
    const start = Math.max(1, trackIndex + 1);
    const MAX_TRIES = 20;
    for (let k = 0; k < MAX_TRIES; k++) {
      const candidate = start + k;
      const url = trackUrlForIndex(candidate);
      // Try loading metadata to detect 404/missing files.
      const ok = await new Promise((resolve) => {
        const test = new Audio();
        test.preload = "metadata";
        test.src = url;
        const done = (v) => resolve(v);
        test.addEventListener("loadedmetadata", () => done(true), { once: true });
        test.addEventListener("error", () => done(false), { once: true });
      });
      if (!ok) continue;
      trackIndex = candidate;
      a.src = url;
      if (enabled) await applyPlayback();
      return trackIndex;
    }
    // Fallback to track 1.
    trackIndex = 1;
    a.src = trackUrlForIndex(1);
    if (enabled) await applyPlayback();
    return trackIndex;
  },

  /**
   * Align internal track index to a specific track number.
   * @param {number} i
   */
  setTrackIndex(i) {
    trackIndex = Math.max(1, Math.floor(i || 1));
    const a = ensureAudioEl();
    a.src = trackUrlForIndex(trackIndex);
    if (enabled) void applyPlayback();
  },

  /**
   * Call after a user gesture to satisfy autoplay policies.
   */
  async unlock() {
    if (!enabled) return;
    await applyPlayback();
  },

  stop() {
    enabled = false;
    void applyPlayback();
  }
};

