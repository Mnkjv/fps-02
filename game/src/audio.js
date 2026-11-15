// Synthesised sound: the game ships no audio files, so every effect is built
// from oscillators and shaped noise in WebAudio. Gunshots differ per weapon
// (a pistol cracks, the DMR booms), the hit marker is a short tick the player
// learns to read, and the planted charge beeps faster as its timer runs down.
// All playback is best-effort: with no user gesture yet, or no AudioContext,
// every function is a silent no-op.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function noiseBuffer(seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A burst of filtered noise: the body of every gunshot and the explosion.
function burst({ at = 0, dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass' }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

// A short oscillator blip: UI clicks, beeps, the hit marker tick.
function blip({ at = 0, dur = 0.06, freq = 880, gain = 0.2, type = 'square', slide = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur);
}

export const sfx = {
  shot(weaponId) {
    if (weaponId === 'longbow') {
      burst({ dur: 0.32, freq: 900, gain: 0.9 });
      blip({ dur: 0.18, freq: 140, gain: 0.5, type: 'sawtooth', slide: -90 });
    } else if (weaponId === 'p9') {
      burst({ dur: 0.09, freq: 2600, gain: 0.5 });
    } else if (weaponId === 'kestrel') {
      burst({ dur: 0.08, freq: 2200, gain: 0.45 });
    } else {
      burst({ dur: 0.14, freq: 1700, gain: 0.65 });
      blip({ dur: 0.08, freq: 220, gain: 0.25, type: 'triangle', slide: -120 });
    }
  },
  dryFire() { blip({ dur: 0.04, freq: 1400, gain: 0.12 }); },
  reload() { blip({ dur: 0.05, freq: 500, gain: 0.15 }); blip({ at: 0.16, dur: 0.05, freq: 760, gain: 0.15 }); },
  hit() { blip({ dur: 0.045, freq: 1560, gain: 0.22, type: 'sine' }); },
  kill() { blip({ dur: 0.09, freq: 1180, gain: 0.25, type: 'sine' }); blip({ at: 0.07, dur: 0.12, freq: 1760, gain: 0.2, type: 'sine' }); },
  hurt() { burst({ dur: 0.1, freq: 500, gain: 0.35 }); },
  buy() { blip({ dur: 0.05, freq: 980, gain: 0.18 }); blip({ at: 0.06, dur: 0.07, freq: 1320, gain: 0.18 }); },
  denied() { blip({ dur: 0.09, freq: 220, gain: 0.2, type: 'sawtooth' }); },
  plantBeep(rate = 1) { blip({ dur: 0.05, freq: 1040, gain: 0.16, type: 'sine' }); if (rate > 1.5) blip({ at: 0.09, dur: 0.05, freq: 1040, gain: 0.12, type: 'sine' }); },
  defuseDone() { blip({ dur: 0.08, freq: 880, gain: 0.2 }); blip({ at: 0.09, dur: 0.14, freq: 1240, gain: 0.2 }); },
  explosion() {
    burst({ dur: 1.1, freq: 220, gain: 1.0 });
    blip({ dur: 0.7, freq: 70, gain: 0.7, type: 'sine', slide: -40 });
  },
  roundWin() { [523, 659, 784].forEach((f, i) => blip({ at: i * 0.09, dur: 0.16, freq: f, gain: 0.2, type: 'triangle' })); },
  roundLose() { [392, 330, 262].forEach((f, i) => blip({ at: i * 0.1, dur: 0.18, freq: f, gain: 0.2, type: 'triangle' })); },
  roundStart() { blip({ dur: 0.07, freq: 740, gain: 0.2 }); blip({ at: 0.1, dur: 0.1, freq: 1108, gain: 0.2 }); },
};
