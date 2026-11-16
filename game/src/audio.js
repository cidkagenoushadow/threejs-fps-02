// Synthesized sound, no audio files. A tiny WebAudio kit: gunfire, hits, an explosion,
// plant and defuse beeps, and round stingers. Created lazily on the first user gesture so
// the browser allows it.
export function createAudio() {
  let context = null;
  let master = null;

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.22;
    master.connect(context.destination);
    return true;
  }

  function noiseBurst(duration, filterFrequency, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFrequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  function tone(frequency, duration, gainValue, type = 'sine') {
    if (!ensure()) return;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      if (kind === 'rifle') {
        noiseBurst(0.09, 2400, 0.9);
        tone(160, 0.08, 0.5, 'square');
      } else if (kind === 'smg') {
        noiseBurst(0.06, 3200, 0.6);
        tone(220, 0.05, 0.35, 'square');
      } else {
        noiseBurst(0.12, 1600, 0.8);
        tone(120, 0.1, 0.5, 'square');
      }
    },
    dryFire() {
      tone(900, 0.03, 0.15, 'square');
    },
    hit(kill) {
      tone(kill ? 1400 : 1050, 0.05, 0.3, 'sine');
    },
    reload() {
      tone(500, 0.05, 0.25, 'square');
      setTimeout(() => tone(700, 0.05, 0.25, 'square'), 350);
    },
    explosion() {
      noiseBurst(0.9, 320, 1.4);
      tone(55, 0.7, 0.9, 'sine');
    },
    beep(high) {
      tone(high ? 1320 : 880, 0.09, 0.35, 'sine');
    },
    plant() {
      tone(990, 0.12, 0.3, 'sine');
      setTimeout(() => tone(1320, 0.12, 0.3, 'sine'), 140);
    },
    round(win) {
      tone(win ? 523 : 392, 0.16, 0.3, 'triangle');
      setTimeout(() => tone(win ? 784 : 311, 0.22, 0.3, 'triangle'), 170);
    },
  };
}
