// @ts-check
/**
 * Sounds of the game, synthesised with the Web Audio API (no sound file): the engine, the doors, the stop
 * request bell, and the spoken announcement of the next stop (Web Speech API, the voice of the browser).
 * Browsers start audio only after a key press or a click on the page: `wake()` is called on each of them.
 */
import { engineHarmonics, engineTone } from './sounds.js';

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
    /**
     * @type {{voices: {o: OscillatorNode, ratio: number}[], filter: BiquadFilterNode, level: GainNode,
     * chug: OscillatorNode, chugDepth: GainNode, rumbleLevel: GainNode} | null}
     */
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
    const p = this.p;
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.gain;
    // a compressor softens the peaks when several sounds play together
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    // one second of white noise, for the engine rumble and the air of the doors
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let k = 0; k < data.length; k++) data[k] = Math.random() * 2 - 1;
    // the engine: two slightly detuned voices with the harmonics of a diesel and a sine an octave below,
    // through a low-pass filter, beating at the firing rate of the cylinders
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = p.engineCutoffHz;
    const level = ctx.createGain();
    level.gain.value = 0;
    filter.connect(level).connect(this.master);
    const { real, imag } = engineHarmonics(p.engineHarmonics);
    const wave = ctx.createPeriodicWave(real, imag);
    const voices = [1 - p.engineDetune, 1 + p.engineDetune, 0.5].map((ratio, k) => {
      const o = ctx.createOscillator();
      if (k < 2) o.setPeriodicWave(wave);
      o.frequency.value = p.engineIdleHz * ratio;
      const g = ctx.createGain();
      g.gain.value = k < 2 ? 0.5 : p.engineSubGain;
      o.connect(g).connect(filter);
      o.start();
      return { o, ratio };
    });
    const chug = ctx.createOscillator();
    chug.frequency.value = p.engineIdleHz * p.engineChugRatio;
    const chugDepth = ctx.createGain();
    chugDepth.gain.value = 0;
    chug.connect(chugDepth).connect(level.gain);
    chug.start();
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = p.engineRumbleHz;
    const rumbleLevel = ctx.createGain();
    rumbleLevel.gain.value = 0;
    rumble.connect(rumbleFilter).connect(rumbleLevel).connect(this.master);
    rumble.start();
    this.engine = { voices, filter, level, chug, chugDepth, rumbleLevel };
  }

  /**
   * Engine sound of this frame; silent while the game is paused.
   * @param {number} speed m/s @param {number} throttle 0 to 1 @param {boolean} paused
   */
  setEngine(speed, throttle, paused) {
    if (!this.context || !this.engine) return;
    const e = this.engine;
    const tone = engineTone(speed, throttle, this.p);
    const gain = paused ? 0 : tone.gain;
    const at = this.context.currentTime,
      glide = this.p.engineGlide;
    for (const { o, ratio } of e.voices) o.frequency.setTargetAtTime(tone.frequency * ratio, at, glide);
    e.chug.frequency.setTargetAtTime(tone.frequency * this.p.engineChugRatio, at, glide);
    e.filter.frequency.setTargetAtTime(tone.cutoff, at, glide);
    e.level.gain.setTargetAtTime(gain, at, glide);
    e.chugDepth.gain.setTargetAtTime(gain * this.p.engineChugDepth, at, glide);
    e.rumbleLevel.gain.setTargetAtTime(gain * this.p.engineRumbleGain, at, glide);
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
