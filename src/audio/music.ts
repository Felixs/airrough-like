import { createRandom } from '../sim/random';

/**
 * Background music: three lo-fi 8-bit loops of about a minute, synthesised live with Web Audio (no audio files).
 * Each song is a chord progression, a tempo and a seed; the seed writes its melody, so a song sounds the same every
 * time. Square-wave lead, pulse chords, triangle bass and noise drums, swung and softened through a low-pass filter,
 * with a little vinyl crackle.
 */
export interface Song {
  readonly id: string;
  readonly title: string;
  readonly bpm: number;
  /** One chord per bar, as MIDI note numbers (lowest first); the progression repeats to fill the bars. */
  readonly chords: readonly (readonly number[])[];
  readonly bars: number;
  readonly seed: number;
  /** Share of an eighth note the off-beats are pushed late (swing). */
  readonly swing: number;
}

export const SONGS: readonly Song[] = [
  // A minor: Am7 – Fmaj7 – Cmaj7 – G6, 16 bars at 72 BPM ≈ 53 s
  { id: 'tower-night', title: 'Tower at Night', bpm: 72, bars: 16, seed: 11, swing: 0.16, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 64]] },
  // D major: Dmaj7 – Bm7 – Gmaj7 – A7, 20 bars at 84 BPM ≈ 57 s
  { id: 'gate-lounge', title: 'Gate Lounge', bpm: 84, bars: 20, seed: 23, swing: 0.12, chords: [[50, 54, 57, 61], [47, 50, 54, 57], [55, 59, 62, 66], [57, 61, 64, 67]] },
  // E minor: Em9 – Cmaj7 – Am7 – B7, 16 bars at 66 BPM ≈ 58 s
  { id: 'red-eye', title: 'Red-eye', bpm: 66, bars: 16, seed: 37, swing: 0.2, chords: [[52, 55, 59, 66], [48, 52, 55, 59], [45, 48, 52, 55], [47, 51, 54, 57]] },
];

export type MusicChoice = 'off' | 'random' | string;

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The melody of a song: for each sixteenth step of a 4-bar phrase, a MIDI note or null (rest). */
function writeMelody(song: Song): (number | null)[][] {
  const rng = createRandom(song.seed);
  const phrases: (number | null)[][] = [];
  // two phrases (A and B) per chord cycle; the second half of the song plays them an octave up in places
  for (let p = 0; p < 2; p++) {
    const steps: (number | null)[] = [];
    for (let bar = 0; bar < 4; bar++) {
      const chord = song.chords[bar % song.chords.length]!;
      const tones = [...chord.map((n) => n + 12), chord[0]! + 24];
      for (let s = 0; s < 16; s++) {
        const onBeat = s % 4 === 0;
        const play = onBeat ? rng.next() < 0.7 : s % 2 === 0 ? rng.next() < 0.35 : rng.next() < 0.08;
        steps.push(play ? tones[Math.floor(rng.next() * tones.length)]! : null);
      }
    }
    phrases.push(steps);
  }
  return phrases;
}

interface Voice { readonly type: OscillatorType; readonly gain: number }
const LEAD: Voice = { type: 'square', gain: 0.07 };
const PAD: Voice = { type: 'square', gain: 0.018 };
const BASS: Voice = { type: 'triangle', gain: 0.22 };

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | undefined;
  private song: Song | null = null;
  private melody: (number | null)[][] = [];
  private step = 0;
  private nextTime = 0;
  private choice: MusicChoice = 'off';
  private volume = 0.5;
  private last: string | null = null;

  /** Call from a click or key press: browsers only start audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.choice !== 'off') void this.ctx.resume();
      return;
    }
    if (this.choice === 'off' || typeof AudioContext === 'undefined') return;
    this.ctx = new AudioContext();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    filter.Q.value = 0.5;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.gainFor(this.volume);
    this.master.connect(filter).connect(this.ctx.destination);
    const length = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.startCrackle();
    this.start();
  }

  /** "off", "random" or a song id. */
  setChoice(choice: MusicChoice): void {
    const changed = choice !== this.choice;
    this.choice = choice;
    if (!this.ctx) {
      this.unlock(); // picking a song is a user gesture: start now
      return;
    }
    if (choice === 'off') {
      this.stop();
      void this.ctx.suspend();
      return;
    }
    void this.ctx.resume();
    if (changed || !this.song) this.start();
  }

  /** 0…1. */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.gainFor(this.volume), this.ctx.currentTime, 0.05);
  }

  /** The song playing now, if any. */
  get playing(): Song | null {
    return this.song;
  }

  /** Pauses while the tab is hidden (unless the Day keeps running), and resumes. */
  setHidden(hidden: boolean): void {
    if (!this.ctx || this.choice === 'off') return;
    void (hidden ? this.ctx.suspend() : this.ctx.resume());
  }

  private gainFor(v: number) {
    return v * v * 0.6;
  }

  private start(): void {
    this.stop();
    const pick = this.choice === 'random'
      ? (() => {
          const others = SONGS.filter((s) => s.id !== this.last);
          return others[Math.floor(Math.random() * others.length)]!;
        })()
      : SONGS.find((s) => s.id === this.choice) ?? SONGS[0]!;
    this.song = pick;
    this.last = pick.id;
    this.melody = writeMelody(pick);
    this.step = 0;
    this.nextTime = this.ctx!.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.song = null;
  }

  /** Schedules every sixteenth note due in the next 0.2 s. */
  private schedule(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song) return;
    const sixteenth = 60 / song.bpm / 4;
    const total = song.bars * 16;
    while (this.nextTime < ctx.currentTime + 0.2) {
      if (this.step >= total) {
        // end of the loop: the same song again, or the next random one
        if (this.choice === 'random') {
          this.start();
          return;
        }
        this.step = 0;
      }
      const swingDelay = this.step % 4 === 2 ? song.swing * sixteenth * 2 : 0;
      this.playStep(song, this.step, this.nextTime + swingDelay, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private playStep(song: Song, step: number, t: number, sixteenth: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = song.chords[bar % song.chords.length]!;
    const intro = bar < 2; // the first two bars: chords and drums only
    const outro = bar >= song.bars - 1;
    // chords: a soft pulse pad held through the bar
    if (s === 0) for (const n of chord) this.tone(PAD, freq(n), t, sixteenth * 15, 0.25);
    // bass: root on 1, fifth on the "and" of 2, root on 3
    if (s === 0 || s === 8) this.tone(BASS, freq(chord[0]! - 12), t, sixteenth * 3.5, 0.01);
    if (s === 6) this.tone(BASS, freq(chord[0]! - 5), t, sixteenth * 1.5, 0.01);
    // drums: kick on 1 and 3 (and a pickup), snare on 2 and 4, closed hat on eighths
    if (s === 0 || s === 8 || (s === 11 && bar % 2 === 1)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 0) this.hat(t, s % 4 === 0 ? 0.03 : 0.018);
    if (intro || outro) return;
    const phrase = this.melody[Math.floor(bar / 4) % 2]!;
    const note = phrase[(bar % 4) * 16 + s];
    if (note !== null && note !== undefined) {
      const up = bar >= song.bars / 2 && bar % 4 === 3 ? 12 : 0;
      this.tone(LEAD, freq(note + up), t, sixteenth * 1.6, 0.005);
    }
  }

  private tone(voice: Voice, hz: number, t: number, length: number, attack: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = voice.type;
    osc.frequency.value = hz;
    osc.detune.value = (Math.random() - 0.5) * 8; // a slightly worn tape
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(voice.gain, t + attack);
    g.gain.setTargetAtTime(0, t + length * 0.7, length * 0.2);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + length + 0.3);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private burst(t: number, length: number, gain: number, type: BiquadFilterType, hz: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + length + 0.05);
  }

  private snare(t: number): void {
    this.burst(t, 0.18, 0.12, 'bandpass', 1800);
  }

  private hat(t: number, gain: number): void {
    this.burst(t, 0.04, gain, 'highpass', 7000);
  }

  /** Quiet vinyl crackle under everything. */
  private startCrackle(): void {
    const ctx = this.ctx!;
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.004;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.connect(g).connect(this.master!);
    src.start();
  }
}
