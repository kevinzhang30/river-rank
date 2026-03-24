/**
 * Central sound engine — singleton Web Audio API module.
 *
 * Usage:
 *   import { play, playSynth, unlockAudio, setVolume } from "@/lib/sound";
 *   unlockAudio();          // call on first user gesture
 *   play("/sfx/emotes/mewing.mp3");
 *   playSynth("turn-cue");
 */

// ── Volume persistence ───────────────────────────────────────────────────────

const VOLUME_KEY = "rr:volume";
const DEFAULT_VOLUME = 0.5;

export function getVolume(): number {
  if (typeof localStorage === "undefined") return DEFAULT_VOLUME;
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VOLUME;
}

export function setVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  localStorage.setItem(VOLUME_KEY, String(clamped));
}

// ── AudioContext singleton ───────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let unlocked = false;

function getOrCreateContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  return ctx;
}

/** Call on the first user gesture (click / keydown) to unlock audio. */
export function unlockAudio(): void {
  if (unlocked) return;
  const ac = getOrCreateContext();
  if (ac.state === "suspended") {
    ac.resume().catch(() => {});
  }
  // Play a silent buffer to fully unlock on iOS/Safari
  const buf = ac.createBuffer(1, 1, ac.sampleRate);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
  unlocked = true;
}

// ── Buffer cache (for mp3/audio file playback) ──────────────────────────────

const bufferCache = new Map<string, AudioBuffer>();
const durationCache = new Map<string, number>(); // url → ms

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const ac = getOrCreateContext();
    const decoded = await ac.decodeAudioData(ab);
    bufferCache.set(url, decoded);
    durationCache.set(url, decoded.duration * 1000);
    return decoded;
  } catch {
    return null;
  }
}

/** Eagerly load a sound into the buffer cache. */
export async function preloadSound(url: string): Promise<void> {
  console.log("[sound] preloading:", url);
  const buf = await loadBuffer(url);
  console.log("[sound] preloaded:", url, { success: !!buf, duration: buf ? Math.round(buf.duration * 1000) + "ms" : null });
}

/** Get cached sound duration in ms, or null if not yet loaded. */
export function getSoundDuration(url: string): number | null {
  return durationCache.get(url) ?? null;
}

// ── File-based playback ─────────────────────────────────────────────────────

interface PlayOptions {
  volume?: number; // 0-1 multiplier on top of master volume
}

/** Play a sound file by URL. No-op if muted or audio locked. */
export function play(url: string, opts?: PlayOptions): void {
  const vol = getVolume();
  console.log("[sound] play:", url, { vol, unlocked, cached: bufferCache.has(url) });
  if (vol === 0 || !unlocked) return;

  const cached = bufferCache.get(url);
  if (cached) {
    playBuffer(cached, vol * (opts?.volume ?? 1));
  } else {
    // Lazy load then play (best-effort, slight delay on first play)
    loadBuffer(url).then((buf) => {
      console.log("[sound] lazy loaded:", url, { success: !!buf });
      if (buf) playBuffer(buf, vol * (opts?.volume ?? 1));
    });
  }
}

/** Alias for play. */
export const playUrl = play;

function playBuffer(buffer: AudioBuffer, gain: number): void {
  if (!ctx) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gainNode = ctx.createGain();
  gainNode.gain.value = gain;
  source.connect(gainNode);
  gainNode.connect(ctx.destination);
  source.start();
}

// ── Synthesized SFX ─────────────────────────────────────────────────────────

export const SFX = {
  TURN_CUE: "turn-cue",
  TIMER_TICK: "timer-tick",
  HAND_WIN: "hand-win",
  HAND_LOSE: "hand-lose",
} as const;

type SynthType = (typeof SFX)[keyof typeof SFX];

/** Play a synthesized sound effect. No-op if muted or audio locked. */
export function playSynth(type: SynthType, opts?: PlayOptions): void {
  const vol = getVolume();
  if (vol === 0 || !unlocked || !ctx) return;

  const gain = vol * (opts?.volume ?? 1);

  switch (type) {
    case "turn-cue":
      synthTurnCue(gain);
      break;
    case "timer-tick":
      synthTimerTick(gain);
      break;
    case "hand-win":
      synthHandWin(gain);
      break;
    case "hand-lose":
      synthHandLose(gain);
      break;
  }
}

/**
 * Turn cue: pleasant ding.
 * Sine wave at 880Hz with quick attack and smooth decay (~200ms).
 */
function synthTurnCue(gain: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 880;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain * 0.3, now + 0.01); // quick attack
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);   // smooth decay

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/**
 * Timer tick: short urgent click.
 * Higher sine at 1200Hz, very short (~100ms), slight edge.
 */
function synthTimerTick(gain: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 1200;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain * 0.25, now + 0.005); // snap attack
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);     // quick decay

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

/**
 * Hand win: two-tone rising chime.
 * Quick ascending notes (C5 → E5) to feel rewarding.
 */
function synthHandWin(gain: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523, 659]; // C5, E5

  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = notes[i];

    const g = ctx.createGain();
    const t = now + i * 0.12;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * 0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

/**
 * Hand lose: single descending tone.
 * Short low note to feel understated, not punishing.
 */
function synthHandLose(gain: number): void {
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now);      // A4
  osc.frequency.linearRampToValueAtTime(330, now + 0.2); // ramp down to E4

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain * 0.2, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}
