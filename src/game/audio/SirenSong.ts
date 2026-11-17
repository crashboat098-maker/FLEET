/**
 * An original, procedurally generated siren song using the Web Audio API:
 * a slow minor-pentatonic melody on a soft sine voice with vibrato, over a
 * low, breathing drone. No audio files; volume follows distance.
 */

const SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic (+ octave), semitones
const ROOT = 440 * Math.pow(2, -2 / 12); // G4

export class SirenSong {
    private master: GainNode | null = null;
    private drone: OscillatorNode | null = null;
    private droneLfo: OscillatorNode | null = null;
    private timer: number | null = null;
    private step = 0;

    constructor(private readonly ctx: AudioContext | null) {}

    get playing(): boolean {
        return this.master !== null;
    }

    start(): void {
        const ctx = this.ctx;
        if (!ctx || this.master) return;
        if (ctx.state === 'suspended') void ctx.resume();
        const master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
        this.master = master;

        // Low drone with a slow tremolo, like wind over a reef.
        const drone = ctx.createOscillator();
        drone.type = 'sine';
        drone.frequency.value = ROOT / 4;
        const droneGain = ctx.createGain();
        droneGain.gain.value = 0.25;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.3;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.15;
        lfo.connect(lfoGain).connect(droneGain.gain);
        drone.connect(droneGain).connect(master);
        drone.start();
        lfo.start();
        this.drone = drone;
        this.droneLfo = lfo;

        this.step = 0;
        const note = () => this.playNote();
        note();
        this.timer = window.setInterval(note, 620);
    }

    /** One sung note: sine voice with vibrato and a soft swell. */
    private playNote(): void {
        const ctx = this.ctx;
        if (!ctx || !this.master) return;
        // A wandering phrase that keeps returning toward the root.
        const phrase = [4, 3, 5, 4, 2, 3, 1, 0, 2, 4, 6, 5, 3, 2];
        const semis = SCALE[phrase[this.step % phrase.length]];
        this.step++;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = ROOT * Math.pow(2, semis / 12);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = 6;
        vib.connect(vibGain).connect(osc.frequency);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.5, t + 0.18);
        env.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        osc.connect(env).connect(this.master);
        osc.start(t);
        vib.start(t);
        osc.stop(t + 1.15);
        vib.stop(t + 1.15);
    }

    /** 0..1 — louder as the ship nears the singer. */
    setVolume(v: number): void {
        if (!this.ctx || !this.master) return;
        this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.12, this.ctx.currentTime, 0.2);
    }

    stop(): void {
        const ctx = this.ctx;
        if (!ctx || !this.master) return;
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        const master = this.master;
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        const drone = this.drone;
        const lfo = this.droneLfo;
        window.setTimeout(() => {
            drone?.stop();
            lfo?.stop();
            master.disconnect();
        }, 1500);
        this.master = null;
        this.drone = null;
        this.droneLfo = null;
    }
}
