// Tiny synth blips for UI feedback — no audio files, just an oscillator + gain envelope.
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, volume: number, type: OscillatorType = "sine") {
  const audio = getCtx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

export const sound = {
  hover: () => tone(880, 0.03, 0.02, "sine"),
  select: () => tone(560, 0.09, 0.05, "triangle"),
  toggle: (on: boolean) => tone(on ? 660 : 330, 0.07, 0.04, "square"),
  close: () => tone(220, 0.08, 0.04, "sine"),
};
