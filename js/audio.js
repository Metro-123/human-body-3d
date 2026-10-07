const BPM = 72;
const BREATH_PER_MIN = 14;
const BEAT_PERIOD = 60 / BPM;          // 0.833 s
const BREATH_PERIOD = 60 / BREATH_PER_MIN; // 4.29 s

function makeImpulse(ctx, seconds = 2.2, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export function createBodyAudio() {
  let ctx = null;
  let master = null;
  let bus = null;
  let noiseSrc = null;
  let noiseGain = null;
  let beatTimer = null;
  let breathTimer = null;
  let nextBeat = 0;
  let nextBreath = 0;

  let wantOn = true;
  let startedAt = 0; // performance.now() aligned with audio start
  let enabledState = false;

  function ensureCtx() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('WebAudio unavailable', e);
      return false;
    }

    master = ctx.createGain();
    master.gain.value = 0.5;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;

    // reverb ambience
    const convo = ctx.createConvolver();
    convo.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    const dry = ctx.createGain();
    dry.gain.value = 0.85;

    master.connect(dry).connect(comp);
    master.connect(wet).connect(convo).connect(comp);
    comp.connect(ctx.destination);

    // continuous breathing noise source
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * (1 - 0.35 * t);
    }
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;
    noiseSrc.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.9;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noiseSrc.connect(bp).connect(noiseGain).connect(master);
    noiseSrc.start();
    return true;
  }

  function playThump(time, freq, peak, dur) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function playClick(time, peak) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    src.connect(lp).connect(g).connect(master);
    src.start(time);
  }

  function scheduleBeatCycle(t) {
    playThump(t, 52, 0.9, 0.14);             // "lub"
    playClick(t, 0.12);
    playThump(t + 0.30, 42, 0.62, 0.11);     // "dub"
    playClick(t + 0.30, 0.08);
  }

  function scheduleBreathCycle(t) {
    if (!noiseGain) return;
    const curve = new Float32Array(20);
    const dur = BREATH_PERIOD;
    for (let i = 0; i < 20; i++) {
      const k = i / 19;
      // inhale 0..0.42, exhale 0.42..0.92, pause tail
      let amp = 0;
      if (k < 0.42) amp = k / 0.42;                       // rise
      else if (k < 0.92) amp = 1 - (k - 0.42) / 0.5;      // fall
      else amp = Math.max(0, 1 - (k - 0.92) / 0.08) * 0.15;
      curve[i] = 0.05 + amp * 0.085;
    }
    noiseGain.gain.setValueCurveAtTime(curve, t, dur);
    // low air rumble following the same cycle
    playThump(t, 48, 0.05, dur * 0.55);
  }

  function startLoops(nowCtxTime) {
    nextBeat = nowCtxTime + 0.08;
    nextBreath = nowCtxTime + 0.08;
    if (beatTimer) clearInterval(beatTimer);
    if (breathTimer) clearInterval(breathTimer);

    beatTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      while (nextBeat < ctx.currentTime + 0.3) {
        scheduleBeatCycle(nextBeat);
        nextBeat += BEAT_PERIOD;
      }
    }, 70);

    breathTimer = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      while (nextBreath < ctx.currentTime + 0.4) {
        scheduleBreathCycle(nextBreath);
        nextBreath += BREATH_PERIOD;
      }
    }, 90);
  }

  function start() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    startedAt = performance.now();
    enabledState = true;
    startLoops(ctx.currentTime);
  }

  function stop() {
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    if (breathTimer) { clearInterval(breathTimer); breathTimer = null; }
    if (ctx && ctx.state === 'running') ctx.suspend();
    enabledState = false;
  }

  // call on first user gesture
  function unlock() {
    if (wantOn) start();
  }

  function setEnabled(on) {
    wantOn = on;
    if (on) start();
    else stop();
  }

  function isEnabled() { return enabledState; }

  // 0..1 phase for visual sync (drives even when muted, using startedAt)
  function phase(kind, now) {
    const base = startedAt || now;
    const t = (now - base) / 1000;
    if (kind === 'beat') {
      return (t % BEAT_PERIOD) / BEAT_PERIOD;
    }
    return (t % BREATH_PERIOD) / BREATH_PERIOD;
  }

  return { setEnabled, unlock, isEnabled, phase, BEAT_PERIOD, BREATH_PERIOD };
}