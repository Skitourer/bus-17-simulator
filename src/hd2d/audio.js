// @ts-check
/**
 * Sounds of the game, synthesised with the Web Audio API (no sound file): the engine, the doors, the stop
 * request bell, and the spoken announcement of the next stop (Web Speech API, the voice of the browser).
 * Browsers start audio only after a key press or a click on the page: `wake()` is called on each of them.
 */
import { engineTone } from './sounds.js';

/** @typedef {import('../settings/settings.js').Settings['audio']} AudioSettings */

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
    /** @type {{osc: OscillatorNode[], filter: BiquadFilterNode, level: GainNode} | null} */
    this.engine = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {AudioBuffer | null} */
    this.noise = null;
  }

  /** Start the audio after a gesture of the player (once), or resume it after a pause of the browser. */
  wake() {
    if (this.gain <= 0) return;
    if (!this.context) this.start();
    else if (this.context.state === 'suspended') void this.context.resume();
  }

  start() {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.gain;
    this.master.connect(ctx.destination);
    // the engine: a sawtooth and a square an octave below, through a low-pass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.p.engineCutoffHz;
    const level = ctx.createGain();
    level.gain.value = 0;
    filter.connect(level).connect(this.master);
    const osc = /** @type {OscillatorType[]} */ (['sawtooth', 'square']).map((type, k) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = this.p.engineIdleHz / (k + 1);
      o.connect(filter);
      o.start();
      return o;
    });
    this.engine = { osc, filter, level };
    // one second of white noise, for the air of the doors
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
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
    this.engine.osc.forEach((o, k) => o.frequency.setTargetAtTime(tone.frequency / (k + 1), at, glide));
    this.engine.filter.frequency.setTargetAtTime(tone.cutoff, at, glide);
    this.engine.level.gain.setTargetAtTime(paused ? 0 : tone.gain, at, glide);
  }

  /** @param {'open' | 'close'} kind */
  doors(kind) {
    if (!this.context || !this.master || !this.noise) return;
    const ctx = this.context,
      at = ctx.currentTime;
    if (kind === 'close')
      for (let k = 0; k < 3; k++) this.tone(this.p.doorBeepHz, at + k * 0.3, 0.15, this.p.doorBeepGain);
    // the hiss of the air, after the beeps when the doors close
    const start = kind === 'close' ? at + 0.9 : at;
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = this.p.doorHissHz;
    const level = ctx.createGain();
    level.gain.setValueAtTime(this.p.doorHissGain, start);
    level.gain.exponentialRampToValueAtTime(0.001, start + this.p.doorHissTime);
    air.connect(band).connect(level).connect(this.master);
    air.start(start);
    air.stop(start + this.p.doorHissTime);
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
