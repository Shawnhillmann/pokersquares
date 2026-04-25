let enabled = false;
let audio = /** @type {HTMLAudioElement|null} */ (null);
let trackUrl = "/audio/music.mp3";

function ensureAudioEl() {
  if (audio) return audio;
  audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0.22;
  audio.src = trackUrl;
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

  /**
   * Set the music track URL (served from /public).
   * Example: "/audio/music.mp3"
   * @param {string} url
   */
  setTrack(url) {
    trackUrl = String(url || "");
    const a = ensureAudioEl();
    a.src = trackUrl;
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

