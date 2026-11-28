// @ts-check
/**
 * Sounds of the game with the Web Audio API: the engine and the doors from recordings of a MAN SG 220 city
 * bus (Work With Sounds, Wikimedia Commons, CC BY 4.0, see assets/audio/CREDITS.md), the warning beeps and
 * the stop request bell synthesised, and the spoken announcement of the next stop (Web Speech API, the voice
 * of the browser). Browsers start audio only after a key press or a click on the page: `wake()` is called on
 * each of them.
 */
import { engineTone } from './sounds.js';

/** @typedef {import('../settings/settings.js').Settings['audio']} AudioSettings */

const ENGINE_URL = 'assets/audio/bus-engine.ogg',
  DOORS_URL = 'assets/audio/bus-doors.ogg';

export class SoundPlayer {
  /**
   * @param {AudioSettings} params @param {number} gain master gain (0 mutes everything)
   * @param {{announce: boolean, language: string}} speech spoken announcements, and their language
   */
  constructor(params, gain, speech) {
    this.p = params;
    this.gain = gain;
    this.speech = speech;
    /** @type {AudioContext | null} */
    this.context = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {{source: AudioBufferSourceNode, filter: BiquadFilterNode, level: GainNode} | null} */
    this.engine = null;
    /** @type {AudioBuffer | null} */
    this.doorRecording = null;
  }

  /** Start the audio after a gesture of the player (once), or resume it after a pause of the browser. */
  wake() {
    if (this.gain <= 0) return;
    if (!this.context) void this.start();
    else if (this.context.state === 'suspended') void this.context.resume();
  }

  async start() {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.gain;
    // a compressor softens the peaks when several sounds play together
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    const [engine, doors] = await Promise.all([ENGINE_URL, DOORS_URL].map((url) => load(ctx, url)));
    this.doorRecording = doors;
    // the engine: the idling part of the recording in a loop, its rate and filter following the drive
    const source = ctx.createBufferSource();
    source.buffer = engine;
    source.loop = true;
    source.loopStart = this.p.engineLoopStart;
    source.loopEnd = this.p.engineLoopEnd;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.p.engineCutoffHz;
    const level = ctx.createGain();
    level.gain.value = 0;
    source.connect(filter).connect(level).connect(this.master);
    source.start(0, this.p.engineLoopStart);
    this.engine = { source, filter, level };
  }

  /**
   * Engine sound of this frame; silent while the game is paused.
   * @param {number} speed m/s @param {number} throttle 0 to 1 @param {boolean} paused
   */
  setEngine(speed, throttle, paused) {
    if (!this.context || !this.engine) return;
    const tone = engineTone(speed, throttle, this.p);
    const at = this.context.currentTime,
      glide = this.p.engineGlide;
    this.engine.source.playbackRate.setTargetAtTime(tone.rate, at, glide);
    this.engine.filter.frequency.setTargetAtTime(tone.cutoff, at, glide);
    this.engine.level.gain.setTargetAtTime(paused ? 0 : tone.gain, at, glide);
  }

  /** @param {'open' | 'close'} kind */
  doors(kind) {
    if (!this.context || !this.master || !this.doorRecording) return;
    const ctx = this.context,
      p = this.p,
      at = ctx.currentTime;
    if (kind === 'close')
      for (let k = 0; k < 3; k++) this.tone(p.doorBeepHz, at + k * 0.3, 0.15, p.doorBeepGain);
    // the air of the doors, after the beeps when they close
    const [from, to] = kind === 'open' ? [p.doorOpenFrom, p.doorOpenTo] : [p.doorCloseFrom, p.doorCloseTo];
    const air = ctx.createBufferSource();
    air.buffer = this.doorRecording;
    const level = ctx.createGain();
    level.gain.value = p.doorGain;
    air.connect(level).connect(this.master);
    air.start(kind === 'close' ? at + 0.9 : at, from, to - from);
  }

  /**
   * Tick of the turn signal relay (#119).
   * @param {number} frequency Hz @param {number} gain
   */
  tick(frequency, gain) {
    if (!this.context) return;
    this.tone(frequency, this.context.currentTime, 0.03, gain);
  }

  /** The stop request bell: two notes, the second a fifth higher. */
  bell() {
    if (!this.context) return;
    const at = this.context.currentTime;
    this.tone(this.p.bellHz, at, 0.6, this.p.bellGain);
    this.tone(this.p.bellHz * 1.5, at + 0.25, 0.8, this.p.bellGain);
  }

  /**
   * A short sine note that fades out.
   * @param {number} frequency Hz @param {number} at s (audio clock) @param {number} length s @param {number} gain
   */
  tone(frequency, at, length, gain) {
    if (!this.context || !this.master) return;
    const o = this.context.createOscillator();
    o.frequency.value = frequency;
    const level = this.context.createGain();
    level.gain.setValueAtTime(gain, at);
    level.gain.exponentialRampToValueAtTime(0.001, at + length);
    o.connect(level).connect(this.master);
    o.start(at);
    o.stop(at + length);
  }

  /**
   * Say a sentence with the voice of the browser, when announcements are on and the sound is not muted.
   * @param {string} text
   */
  say(text) {
    if (!this.speech.announce || this.gain <= 0 || !('speechSynthesis' in window)) return;
    const line = new SpeechSynthesisUtterance(text);
    line.lang = this.speech.language;
    line.rate = this.p.announceRate;
    line.volume = Math.min(1, this.gain / this.p.volumeHigh);
    speechSynthesis.cancel();
    speechSynthesis.speak(line);
  }
}

/**
 * A recording, decoded.
 * @param {AudioContext} ctx @param {string} url
 */
async function load(ctx, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}
