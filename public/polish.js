(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / Math.max(0.0001, b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

  function spring(state, valueKey, velocityKey, target, stiffness, damping, dt) {
    const value = state[valueKey] || 0;
    const velocity = state[velocityKey] || 0;
    const acceleration = (target - value) * stiffness - velocity * damping;
    state[velocityKey] = velocity + acceleration * dt;
    state[valueKey] = value + state[velocityKey] * dt;
    return state[valueKey];
  }

  function whenGameReady(callback) {
    const run = () => {
      if (window.__TAKKAR__) callback(window.__TAKKAR__);
      else requestAnimationFrame(run);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }

  function installAudio(audio) {
    const oldStopCharge = audio.stopCharge?.bind(audio);
    const oldStopEngine = audio.stopEngine?.bind(audio);

    audio.init = function initPolishedAudio() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });

      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.46 : 0;
      this.engineBus = this.ctx.createGain();
      this.fxBus = this.ctx.createGain();
      this.uiBus = this.ctx.createGain();
      this.engineBus.gain.value = 0.72;
      this.fxBus.gain.value = 0.86;
      this.uiBus.gain.value = 0.58;

      const lowShelf = this.ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 115;
      lowShelf.gain.value = 4.5;

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;

      this.engineBus.connect(this.master);
      this.fxBus.connect(this.master);
      this.uiBus.connect(this.master);
      this.master.connect(lowShelf).connect(compressor).connect(this.ctx.destination);

      const length = Math.floor(this.ctx.sampleRate * 3);
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        data[i] = clamp(white * 0.45 + brown * 2.2, -1, 1);
      }
    };

    audio.makeCurve = function makeCurve(amount = 18) {
      const samples = 1024;
      const curve = new Float32Array(samples);
      const k = Math.max(1, amount);
      for (let i = 0; i < samples; i++) {
        const x = i * 2 / (samples - 1) - 1;
        curve[i] = ((3 + k) * x * 18 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    };

    audio.voice = function voice({ freq = 100, endFreq = null, duration = 0.2, type = 'sine', volume = 0.1, delay = 0, attack = 0.008, bus = this.fxBus, filter = null, pan = 0 }) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + Math.min(attack, duration * 0.35));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      let node = osc;
      if (filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass';
        f.frequency.setValueAtTime(filter.freq || 900, t);
        if (filter.endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(20, filter.endFreq), t + duration);
        f.Q.value = filter.q || 0.8;
        node.connect(f); node = f;
      }
      node.connect(gain);
      if (panner) {
        panner.pan.value = clamp(pan, -1, 1);
        gain.connect(panner).connect(bus || this.fxBus);
      } else gain.connect(bus || this.fxBus);
      osc.start(t); osc.stop(t + duration + 0.04);
    };

    audio.noiseHit = function noiseHit({ duration = 0.2, volume = 0.1, delay = 0, type = 'bandpass', freq = 900, endFreq = null, q = 0.8, pan = 0, bus = this.fxBus }) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx || !this.noiseBuffer) return;
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      src.buffer = this.noiseBuffer;
      filter.type = type;
      filter.frequency.setValueAtTime(freq, t);
      if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
      filter.Q.value = q;
      gain.gain.setValueAtTime(Math.max(0.0002, volume), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter).connect(gain);
      if (panner) {
        panner.pan.value = clamp(pan, -1, 1);
        gain.connect(panner).connect(bus || this.fxBus);
      } else gain.connect(bus || this.fxBus);
      src.start(t, Math.random() * 1.5); src.stop(t + duration + 0.03);
    };

    audio.setEnabled = function setEnabledPolished(value) {
      this.enabled = value;
      this.init();
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(value ? 0.46 : 0, this.ctx.currentTime, 0.03);
      if (!value) { this.stopCharge(); this.stopEngine(); }
    };

    audio.startCharge = function startChargePolished() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx || this.chargeNodes) return;
      const t = this.ctx.currentTime;
      const bus = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const drive = this.ctx.createWaveShaper();
      const low = this.ctx.createOscillator();
      const mid = this.ctx.createOscillator();
      const pulse = this.ctx.createOscillator();
      const pulseGain = this.ctx.createGain();
      drive.curve = this.makeCurve(11);
      drive.oversample = '2x';
      filter.type = 'lowpass'; filter.frequency.value = 310; filter.Q.value = 1.2;
      low.type = 'sine'; low.frequency.value = 34;
      mid.type = 'sawtooth'; mid.frequency.value = 68;
      pulse.type = 'sine'; pulse.frequency.value = 7.4;
      pulseGain.gain.value = 0.035;
      pulse.connect(pulseGain).connect(bus.gain);
      low.connect(filter); mid.connect(filter); filter.connect(drive).connect(bus).connect(this.engineBus);
      bus.gain.setValueAtTime(0.0001, t);
      bus.gain.exponentialRampToValueAtTime(0.085, t + 0.22);
      low.start(); mid.start(); pulse.start();
      this.chargeNodes = { low, mid, pulse, pulseGain, filter, bus };
      this.voice({ freq: 78, endFreq: 42, duration: 0.22, type: 'sine', volume: 0.11, bus: this.fxBus, filter: { type: 'lowpass', freq: 260 } });
      this.noiseHit({ duration: 0.12, volume: 0.035, type: 'highpass', freq: 1800 });
    };

    audio.updateCharge = function updateChargePolished(value) {
      const n = this.chargeNodes;
      if (!this.ctx || !n) return;
      const t = this.ctx.currentTime;
      const rpm = 34 + value * 148;
      n.low.frequency.setTargetAtTime(rpm * 0.5, t, 0.035);
      n.mid.frequency.setTargetAtTime(rpm, t, 0.035);
      n.filter.frequency.setTargetAtTime(310 + value * 1500, t, 0.04);
      n.filter.Q.setTargetAtTime(1.1 + value * 2.2, t, 0.04);
      n.pulse.frequency.setTargetAtTime(7.4 + value * 12, t, 0.05);
      n.bus.gain.setTargetAtTime(0.07 + value * 0.08, t, 0.04);
    };

    audio.stopCharge = function stopChargePolished() {
      const n = this.chargeNodes;
      if (!this.ctx || !n) { try { oldStopCharge?.(); } catch {} return; }
      const t = this.ctx.currentTime;
      n.bus.gain.cancelScheduledValues(t);
      n.bus.gain.setTargetAtTime(0.0001, t, 0.025);
      setTimeout(() => {
        for (const key of ['low', 'mid', 'pulse']) { try { n[key].stop(); } catch {} }
      }, 150);
      this.chargeNodes = null;
    };

    audio.startEngine = function startEnginePolished() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx || this.engineNodes) return;
      const t = this.ctx.currentTime;
      const bus = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const body = this.ctx.createBiquadFilter();
      const drive = this.ctx.createWaveShaper();
      const sub = this.ctx.createOscillator();
      const crank = this.ctx.createOscillator();
      const harmonics = this.ctx.createOscillator();
      const rumble = this.ctx.createBufferSource();
      const rumbleFilter = this.ctx.createBiquadFilter();
      const rumbleGain = this.ctx.createGain();

      drive.curve = this.makeCurve(14); drive.oversample = '2x';
      filter.type = 'lowpass'; filter.frequency.value = 720; filter.Q.value = 0.8;
      body.type = 'peaking'; body.frequency.value = 145; body.Q.value = 1.1; body.gain.value = 5;
      sub.type = 'sine'; sub.frequency.value = 29;
      crank.type = 'sawtooth'; crank.frequency.value = 58;
      harmonics.type = 'triangle'; harmonics.frequency.value = 116;
      rumble.buffer = this.noiseBuffer; rumble.loop = true;
      rumbleFilter.type = 'lowpass'; rumbleFilter.frequency.value = 240;
      rumbleGain.gain.value = 0.035;

      sub.connect(filter); crank.connect(filter); harmonics.connect(filter);
      filter.connect(drive).connect(body).connect(bus).connect(this.engineBus);
      rumble.connect(rumbleFilter).connect(rumbleGain).connect(bus);
      bus.gain.setValueAtTime(0.0001, t); bus.gain.exponentialRampToValueAtTime(0.075, t + 0.22);
      sub.start(); crank.start(); harmonics.start(); rumble.start(0, Math.random());
      this.engineNodes = { bus, filter, body, sub, crank, harmonics, rumble, rumbleFilter, rumbleGain };
    };

    audio.updateEngine = function updateEnginePolished(speed, overdrive) {
      const n = this.engineNodes;
      if (!this.ctx || !n) return;
      const t = this.ctx.currentTime;
      const normalized = clamp(speed / 1250, 0, 1);
      const crankHz = 48 + Math.pow(normalized, 0.72) * 170 + (overdrive ? 32 : 0);
      n.sub.frequency.setTargetAtTime(crankHz * 0.5, t, 0.055);
      n.crank.frequency.setTargetAtTime(crankHz, t, 0.055);
      n.harmonics.frequency.setTargetAtTime(crankHz * 2.01, t, 0.055);
      n.filter.frequency.setTargetAtTime(520 + normalized * 1900 + (overdrive ? 550 : 0), t, 0.06);
      n.rumbleFilter.frequency.setTargetAtTime(190 + normalized * 480, t, 0.08);
      n.rumbleGain.gain.setTargetAtTime(0.018 + normalized * 0.045, t, 0.08);
      n.bus.gain.setTargetAtTime(0.055 + normalized * 0.055 + (overdrive ? 0.025 : 0), t, 0.06);
    };

    audio.stopEngine = function stopEnginePolished() {
      const n = this.engineNodes;
      if (!this.ctx || !n) { try { oldStopEngine?.(); } catch {} return; }
      const t = this.ctx.currentTime;
      n.bus.gain.setTargetAtTime(0.0001, t, 0.035);
      setTimeout(() => {
        for (const key of ['sub', 'crank', 'harmonics', 'rumble']) { try { n[key].stop(); } catch {} }
      }, 190);
      this.engineNodes = null;
    };

    audio.clampRelease = function clampReleasePolished() {
      this.voice({ freq: 118, endFreq: 62, duration: 0.11, type: 'triangle', volume: 0.11, filter: { type: 'bandpass', freq: 720, q: 2.8 } });
      this.voice({ freq: 920, endFreq: 390, duration: 0.075, type: 'sine', volume: 0.035, delay: 0.008, pan: -0.2 });
      this.noiseHit({ duration: 0.085, volume: 0.08, type: 'highpass', freq: 1500, endFreq: 4300, pan: 0.18 });
    };

    audio.launch = function launchPolished() {
      this.voice({ freq: 43, endFreq: 24, duration: 0.55, type: 'sine', volume: 0.29, filter: { type: 'lowpass', freq: 190, endFreq: 90, q: 0.7 } });
      this.voice({ freq: 74, endFreq: 225, duration: 0.48, type: 'sawtooth', volume: 0.12, filter: { type: 'lowpass', freq: 370, endFreq: 1250, q: 1.1 } });
      this.noiseHit({ duration: 0.52, volume: 0.2, type: 'bandpass', freq: 260, endFreq: 1800, q: 0.65 });
      this.noiseHit({ duration: 0.18, volume: 0.075, delay: 0.055, type: 'highpass', freq: 2600, pan: 0.3 });
    };

    audio.impact = function impactPolished(severity = 1) {
      const s = clamp(severity, 0.65, 1.65);
      this.voice({ freq: 53 / s, endFreq: 24, duration: 0.42 + s * 0.06, type: 'sine', volume: 0.34, filter: { type: 'lowpass', freq: 185, endFreq: 70, q: 0.75 } });
      this.voice({ freq: 128 + s * 18, endFreq: 72, duration: 0.19, type: 'triangle', volume: 0.12, delay: 0.008, filter: { type: 'bandpass', freq: 430, q: 1.8 }, pan: -0.18 });
      this.voice({ freq: 1180 - s * 110, endFreq: 510, duration: 0.115, type: 'sine', volume: 0.045, delay: 0.012, filter: { type: 'bandpass', freq: 1500, q: 5.5 }, pan: 0.24 });
      this.noiseHit({ duration: 0.23 + s * 0.08, volume: 0.22, type: 'lowpass', freq: 1250, endFreq: 360, q: 0.8 });
      this.noiseHit({ duration: 0.09, volume: 0.075, delay: 0.016, type: 'highpass', freq: 2300, pan: 0.35 });
    };

    audio.survive = function survivePolished() {
      this.voice({ freq: 330, endFreq: 392, duration: 0.14, type: 'sine', volume: 0.055, bus: this.uiBus });
      this.voice({ freq: 495, endFreq: 588, duration: 0.19, type: 'sine', volume: 0.045, delay: 0.06, bus: this.uiBus });
    };

    audio.cashout = function cashoutPolished() {
      [293.66, 369.99, 440, 587.33].forEach((freq, i) => this.voice({ freq, endFreq: freq * 1.01, duration: 0.18 + i * 0.025, type: 'sine', volume: 0.055 - i * 0.004, delay: i * 0.052, bus: this.uiBus, pan: -0.25 + i * 0.16 }));
      this.voice({ freq: 73, endFreq: 52, duration: 0.34, type: 'sine', volume: 0.1, bus: this.fxBus, filter: { type: 'lowpass', freq: 180 } });
    };

    audio.crash = function crashPolished() {
      this.voice({ freq: 46, endFreq: 20, duration: 1.05, type: 'sine', volume: 0.42, filter: { type: 'lowpass', freq: 165, endFreq: 55 } });
      this.voice({ freq: 184, endFreq: 36, duration: 0.72, type: 'sawtooth', volume: 0.16, delay: 0.015, filter: { type: 'lowpass', freq: 830, endFreq: 170, q: 1.2 } });
      this.noiseHit({ duration: 0.95, volume: 0.36, type: 'lowpass', freq: 1450, endFreq: 190, q: 0.72 });
      this.noiseHit({ duration: 0.32, volume: 0.14, delay: 0.035, type: 'highpass', freq: 2100, pan: 0.25 });
      [890, 640, 470].forEach((freq, i) => this.voice({ freq, endFreq: freq * 0.55, duration: 0.22, type: 'sine', volume: 0.035, delay: 0.045 + i * 0.065, filter: { type: 'bandpass', freq, q: 4.2 }, pan: i % 2 ? -0.35 : 0.35 }));
    };

    audio.overdrive = function overdrivePolished() {
      this.voice({ freq: 61, endFreq: 122, duration: 0.62, type: 'sawtooth', volume: 0.13, filter: { type: 'lowpass', freq: 480, endFreq: 1900, q: 1.1 } });
      this.noiseHit({ duration: 0.48, volume: 0.12, type: 'highpass', freq: 1700, endFreq: 4800, q: 0.6 });
      this.voice({ freq: 246.94, endFreq: 493.88, duration: 0.28, type: 'sine', volume: 0.04, delay: 0.11, bus: this.uiBus });
    };
  }

  function buildBackground(game, overdrive = false) {
    const scale = Math.min(1.5, game.dpr || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(game.w * scale));
    canvas.height = Math.max(1, Math.round(game.h * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const sky = ctx.createLinearGradient(0, 0, 0, game.roadY);
    sky.addColorStop(0, overdrive ? '#120401' : '#06090d');
    sky.addColorStop(0.55, overdrive ? '#291006' : '#12171d');
    sky.addColorStop(1, overdrive ? '#090504' : '#06080b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, game.w, game.h);

    const glow = ctx.createRadialGradient(game.w * 0.68, game.h * 0.48, 0, game.w * 0.68, game.h * 0.48, game.w * 0.58);
    glow.addColorStop(0, overdrive ? 'rgba(255,72,0,.20)' : 'rgba(255,114,35,.075)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, game.w, game.roadY);

    ctx.globalAlpha = 0.55;
    for (let x = -40; x < game.w + 140; x += 170) {
      const h = 48 + ((x / 170) & 3) * 17;
      ctx.fillStyle = '#0b1015'; ctx.fillRect(x, game.roadY - h, 118, h);
      ctx.fillStyle = overdrive ? 'rgba(255,90,18,.22)' : 'rgba(255,125,46,.11)';
      for (let yy = game.roadY - h + 13; yy < game.roadY - 8; yy += 18) ctx.fillRect(x + 18, yy, 4, 3);
    }
    ctx.globalAlpha = 1;

    const road = ctx.createLinearGradient(0, game.roadY - 22, 0, game.h + 30);
    road.addColorStop(0, '#30353a'); road.addColorStop(0.18, '#171a1e'); road.addColorStop(1, '#050607');
    ctx.fillStyle = road; ctx.fillRect(0, game.roadY - 20, game.w, game.h - game.roadY + 22);
    ctx.fillStyle = '#4b5157'; ctx.fillRect(0, game.roadY - 20, game.w, 4);
    ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.fillRect(0, game.roadY - 16, game.w, 1);
    return canvas;
  }

  function buildWheelTexture(game) {
    const p = game.__polish;
    const r = game.wheelR;
    const damage = Math.round(game.damage || 0);
    const over = game.overdrive ? 1 : 0;
    const quality = game.quality;
    const key = `${Math.round(r)}:${damage}:${over}:${quality}`;
    if (p.wheelTexture?.key === key) return p.wheelTexture;

    const resolution = quality === 'high' ? 2 : quality === 'balanced' ? 1.55 : 1.15;
    const padding = r * 0.22;
    const size = Math.ceil((r * 2 + padding * 2) * resolution);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.scale(resolution, resolution);
    ctx.translate(r + padding, r + padding);

    const tire = ctx.createRadialGradient(-r * 0.3, -r * 0.34, r * 0.06, 0, 0, r);
    tire.addColorStop(0, '#4a4d50'); tire.addColorStop(0.28, '#232629'); tire.addColorStop(0.65, '#08090a'); tire.addColorStop(0.86, '#020303'); tire.addColorStop(1, '#1b1d1f');
    ctx.fillStyle = tire; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

    const treadCount = quality === 'low' ? 18 : 28;
    ctx.save();
    for (let i = 0; i < treadCount; i++) {
      ctx.rotate(TAU / treadCount);
      if (damage >= 6 && (i === 4 || i === 5 || i === 19)) continue;
      ctx.fillStyle = i % 2 ? '#292c2e' : '#1d1f21';
      game.roundRect(ctx, r * 0.75, -r * 0.057, r * 0.27, r * 0.114, r * 0.032); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.055)'; ctx.fillRect(r * 0.79, -r * 0.042, r * 0.15, 1.2);
    }
    ctx.restore();

    ctx.fillStyle = '#070809'; ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.fill();
    const rim = ctx.createRadialGradient(-r * 0.22, -r * 0.24, r * 0.03, 0, 0, r * 0.65);
    rim.addColorStop(0, '#e1e3e4'); rim.addColorStop(0.16, '#888e93'); rim.addColorStop(0.42, '#252a2e'); rim.addColorStop(0.7, '#777d82'); rim.addColorStop(1, '#15181b');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(0, 0, r * 0.63, 0, TAU); ctx.fill();
    ctx.strokeStyle = over ? '#ff6b13' : '#8a9095'; ctx.lineWidth = Math.max(2, r * 0.026); ctx.beginPath(); ctx.arc(0, 0, r * 0.585, 0, TAU); ctx.stroke();

    ctx.fillStyle = '#171b1f'; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
    for (let i = 0; i < 9; i++) {
      ctx.save(); ctx.rotate(i * TAU / 9);
      const g = ctx.createLinearGradient(r * 0.08, 0, r * 0.53, 0);
      g.addColorStop(0, '#aeb3b7'); g.addColorStop(0.42, '#3e4449'); g.addColorStop(1, '#8a9094');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(r * 0.11, -r * 0.065); ctx.lineTo(r * 0.52, -r * 0.105); ctx.lineTo(r * 0.56, -r * 0.02); ctx.lineTo(r * 0.17, r * 0.055); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#101316'; ctx.beginPath(); ctx.arc(0, 0, r * 0.17, 0, TAU); ctx.fill();
    const hub = ctx.createRadialGradient(-r * 0.04, -r * 0.05, 0, 0, 0, r * 0.14);
    hub.addColorStop(0, '#eceeef'); hub.addColorStop(0.42, '#73797e'); hub.addColorStop(1, '#171a1d');
    ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff5b00'; ctx.lineWidth = Math.max(2, r * 0.021); ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.stroke();

    if (damage > 0) {
      ctx.lineCap = 'round';
      for (let i = 0; i < Math.min(damage + 1, 7); i++) {
        const a = -1.05 + i * 0.43;
        const rr = r * (0.57 + (i % 2) * 0.11);
        ctx.strokeStyle = damage >= 5 ? 'rgba(255,104,25,.88)' : 'rgba(220,226,230,.42)';
        ctx.lineWidth = Math.max(1.2, r * 0.013);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a + 0.12) * rr * 0.86, Math.sin(a + 0.12) * rr * 0.86); ctx.lineTo(Math.cos(a - 0.05) * rr * 0.77, Math.sin(a - 0.05) * rr * 0.77); ctx.stroke();
      }
    }

    p.wheelTexture = { key, canvas, resolution, padding };
    return p.wheelTexture;
  }

  function install(game) {
    if (game.__polishInstalled) return;
    game.__polishInstalled = true;
    game.__polish = {
      time: 0,
      wheelLift: 0,
      wheelLiftV: 0,
      wheelPitch: 0,
      wheelPitchV: 0,
      smoothSpeed: 0,
      shakeEnergy: 0,
      shakeX: 0,
      shakeY: 0,
      fpsEma: 60,
      lowFpsFor: 0,
      highFpsFor: 0,
      backgroundNormal: null,
      backgroundOverdrive: null,
      wheelTexture: null,
      impactStarted: 0,
      impactSeverity: 0,
      contactTravel: 0,
      contactTravelV: 0,
      obstacleReaction: 0,
      obstacleReactionV: 0
    };

    document.body.classList.add('takkar-polished');
    installAudio(game.audio);

    const originalResize = game.resize.bind(game);
    game.resize = function polishedResize() {
      originalResize();
      const maxDpr = this.quality === 'high' ? (this.isDesktop ? 1.5 : 1.32) : this.quality === 'balanced' ? 1.16 : 1;
      const desired = Math.min(window.devicePixelRatio || 1, maxDpr);
      if (Math.abs(desired - this.dpr) > 0.01) {
        this.dpr = desired;
        this.ctx.canvas.width = Math.max(1, Math.round(this.w * desired));
        this.ctx.canvas.height = Math.max(1, Math.round(this.h * desired));
        this.ctx.setTransform(desired, 0, 0, desired, 0, 0);
      }
      this.__polish.backgroundNormal = null;
      this.__polish.backgroundOverdrive = null;
      this.__polish.wheelTexture = null;
      document.body.classList.toggle('quality-low', this.quality === 'low');
      document.body.classList.toggle('quality-balanced', this.quality === 'balanced');
    };

    game.detectQuality = function detectQualityPolished() {
      const cores = navigator.hardwareConcurrency || 4;
      const memory = navigator.deviceMemory || 4;
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const constrained = cores <= 4 || memory <= 3;
      this.quality = constrained ? 'low' : mobile ? 'balanced' : 'high';
    };

    game.spawnObstacle = function spawnPolishedObstacle() {
      const sequence = [
        { name: 'BOLTED STEEL SEAM', type: 'joint', severity: 0.72 },
        { name: 'REINFORCED CURB', type: 'curb', severity: 0.88 },
        { name: 'LOCKING BARRIER', type: 'barrier', severity: 1.02 },
        { name: 'HYDRAULIC PRESS', type: 'ram', severity: 1.17 },
        { name: 'FRACTURED DECK', type: 'gap', severity: 1.3 }
      ];
      const choice = sequence[Math.min(sequence.length - 1, this.impactCount)];
      const gap = this.w * (this.isDesktop ? 0.96 : 0.86) + this.wheelR * Math.min(this.impactCount, 4) * 0.16;
      this.currentObstacle = {
        ...choice,
        x: this.wheelX + gap,
        y: this.roadY,
        hit: false,
        tilt: 0,
        compression: 0,
        impactPulse: 0,
        passed: false,
        approach: 0,
        reaction: 0,
        reactionV: 0
      };
      const threatName = document.getElementById('threatName');
      const nextMultiplier = document.getElementById('nextMultiplier');
      const threat = document.getElementById('nextThreat');
      if (threatName) threatName.textContent = choice.name;
      if (nextMultiplier) nextMultiplier.textContent = `${this.nextMultiplierValue().toFixed(2)}×`;
      threat?.classList.add('visible');
    };

    game.obstacleContactOffset = function polishedContactOffset(obstacle) {
      const r = this.wheelR;
      if (!obstacle) return 0;
      if (obstacle.type === 'joint') return -r * 0.62;
      if (obstacle.type === 'curb') return -r * 0.64;
      if (obstacle.type === 'barrier') return -r * 0.24;
      if (obstacle.type === 'ram') return -r * 0.5;
      return -r * 0.72;
    };

    const originalImpact = game.impactObstacle.bind(game);
    game.impactObstacle = function polishedImpact(now) {
      const obstacle = this.currentObstacle;
      if (!obstacle || obstacle.hit) return;
      const p = this.__polish;
      p.impactStarted = now;
      p.impactSeverity = obstacle.severity;
      p.contactTravel = 0;
      p.contactTravelV = this.speed * 0.035;
      p.shakeEnergy = Math.max(p.shakeEnergy, 0.75 + obstacle.severity * 0.35);
      obstacle.compression = 1;
      originalImpact(now);
      this.freezeUntil = now + (this.reducedMotion ? 72 : 126);
      this.wheelSquash = 0.32 + obstacle.severity * 0.075;
    };

    const originalResolve = game.resolveImpact.bind(game);
    game.resolveImpact = function polishedResolve(now) {
      const obstacle = this.currentObstacle;
      originalResolve(now);
      if (obstacle && obstacle.passed) {
        obstacle.reaction = 0;
        obstacle.reactionV = 4.6 + obstacle.severity * 1.8;
      }
      this.__polish.contactTravelV -= this.wheelR * 0.4;
      this.__polish.shakeEnergy = Math.max(this.__polish.shakeEnergy, 0.42);
    };

    const originalEmitImpact = game.emitImpactParticles.bind(game);
    game.emitImpactParticles = function emitImpactPolished(x, y, scale = 1) {
      const adjusted = this.quality === 'high' ? scale * 0.82 : this.quality === 'balanced' ? scale * 0.62 : scale * 0.42;
      originalEmitImpact(x, y, adjusted);
      const budget = this.quality === 'high' ? 96 : this.quality === 'balanced' ? 62 : 34;
      if (this.particles.length > budget) this.particles.splice(0, this.particles.length - budget);
    };

    const originalUpdateParticles = game.updateParticles.bind(game);
    game.updateParticles = function updateParticlesPolished(dt) {
      originalUpdateParticles(dt);
      const particleBudget = this.quality === 'high' ? 110 : this.quality === 'balanced' ? 72 : 42;
      const debrisBudget = this.quality === 'high' ? 52 : this.quality === 'balanced' ? 34 : 20;
      if (this.particles.length > particleBudget) this.particles.splice(0, this.particles.length - particleBudget);
      if (this.debris.length > debrisBudget) this.debris.splice(0, this.debris.length - debrisBudget);
    };

    const originalUpdate = game.update.bind(game);
    game.update = function polishedUpdate(dt, now) {
      const p = this.__polish;
      p.time += dt;
      if (['running', 'survival'].includes(this.phase)) this.targetSpeed = 760 + Math.min(this.impactCount, 5) * 48;
      if (this.phase === 'overdrive') this.targetSpeed = 1120;
      originalUpdate(Math.min(dt, 1 / 40), now);

      const smoothable = ['launch', 'running', 'survival', 'overdrive', 'cashed'].includes(this.phase);
      if (smoothable) {
        p.smoothSpeed = damp(p.smoothSpeed, this.speed, this.phase === 'launch' ? 7.8 : 4.8, dt);
        this.speed = p.smoothSpeed;
      } else if (this.phase === 'impactFreeze') {
        p.smoothSpeed = damp(p.smoothSpeed, 0, 18, dt);
        this.speed = 0;
      } else {
        p.smoothSpeed = 0;
        this.speed = 0;
      }
      const speedRatio = clamp(this.speed / 1100, 0, 1);
      const roughness = Math.sin(this.distance * 0.018) * 0.55 + Math.sin(this.distance * 0.043 + 1.7) * 0.25 + Math.sin(this.distance * 0.009 + 0.4) * 0.2;
      const targetLift = ['launch', 'running', 'survival', 'overdrive'].includes(this.phase) ? roughness * this.wheelR * 0.012 * speedRatio : 0;
      spring(p, 'wheelLift', 'wheelLiftV', targetLift, 68, 14, dt);
      spring(p, 'wheelPitch', 'wheelPitchV', -p.wheelLiftV * 0.0021, 58, 13, dt);
      spring(p, 'contactTravel', 'contactTravelV', 0, 92, 18, dt);

      if (this.currentObstacle) {
        const o = this.currentObstacle;
        const contact = o.x + this.obstacleContactOffset(o);
        const remaining = contact - (this.wheelX + this.wheelR * 0.965);
        o.approach = damp(o.approach || 0, smoothstep(this.wheelR * 3.2, this.wheelR * 0.15, remaining), 10, dt);
        if (o.passed) {
          o.reactionV = (o.reactionV || 0) - (o.reaction || 0) * 24 * dt;
          o.reactionV *= Math.exp(-7 * dt);
          o.reaction = (o.reaction || 0) + o.reactionV * dt;
        }
      }

      p.shakeEnergy *= Math.exp(-15 * dt);
      if (this.shake > 1) p.shakeEnergy = Math.max(p.shakeEnergy, clamp(this.shake / 24, 0, 1.4));
      const low = Math.sin(p.time * 31.3) + Math.sin(p.time * 19.7 + 1.3) * 0.45;
      const high = Math.sin(p.time * 57.1 + 0.7) * 0.28;
      p.shakeX = (low + high) * p.shakeEnergy * (this.reducedMotion ? 1.2 : 8.5);
      p.shakeY = (Math.sin(p.time * 37.7 + 2.4) + Math.sin(p.time * 23.4) * 0.35) * p.shakeEnergy * (this.reducedMotion ? 0.7 : 4.6);
    };

    game.drawBackground = function drawBackgroundPolished(ctx) {
      const p = this.__polish;
      if (!p.backgroundNormal) p.backgroundNormal = buildBackground(this, false);
      if (!p.backgroundOverdrive) p.backgroundOverdrive = buildBackground(this, true);
      ctx.drawImage(this.overdrive ? p.backgroundOverdrive : p.backgroundNormal, 0, 0, this.w, this.h);

      const pillarOffset = (this.distance * 0.11) % 220;
      ctx.save(); ctx.globalAlpha = 0.82;
      for (let x = -220 - pillarOffset; x < this.w + 220; x += 220) {
        ctx.fillStyle = '#151a20'; ctx.fillRect(x, this.h * 0.17, 21, this.roadY - this.h * 0.17);
        ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(x + 3, this.h * 0.17, 3, this.roadY - this.h * 0.17);
        ctx.strokeStyle = '#10151a'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(x - 14, this.h * 0.17); ctx.lineTo(x + 92, 0); ctx.stroke();
      }
      ctx.restore();

      const lampOffset = (this.distance * 0.19) % 188;
      ctx.save();
      for (let x = -188 - lampOffset; x < this.w + 188; x += 188) {
        ctx.fillStyle = this.overdrive ? 'rgba(255,101,24,.78)' : 'rgba(255,218,177,.56)';
        ctx.shadowColor = this.overdrive ? '#ff4d00' : '#ffc48b';
        ctx.shadowBlur = this.quality === 'high' ? 13 : 7;
        ctx.fillRect(x, this.h * 0.11, 42, 2.5);
      }
      ctx.restore();
    };

    game.drawRoad = function drawRoadPolished(ctx) {
      const y = this.roadY;
      const segment = this.isDesktop ? 164 : 128;
      const offset = this.distance % segment;
      ctx.save();
      for (let x = -segment - offset; x < this.w + segment; x += segment) {
        ctx.fillStyle = 'rgba(255,255,255,.024)'; ctx.fillRect(x, y - 14, 1.5, this.h - y + 40);
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(x + 35, this.h); ctx.stroke();
      }
      const stripeOffset = (this.distance * 1.02) % 156;
      ctx.globalAlpha = this.overdrive ? 0.72 : 0.3;
      for (let x = -156 - stripeOffset; x < this.w + 156; x += 156) {
        ctx.fillStyle = this.overdrive ? '#ff5a00' : '#a94e1a';
        ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x + 52, y + 9); ctx.lineTo(x + 66, y + 15); ctx.lineTo(x + 10, y + 15); ctx.fill();
      }
      ctx.restore();
    };

    game.drawLaunchEngine = function drawLaunchEnginePolished(ctx, time) {
      const r = this.wheelR;
      const desktop = this.isDesktop;
      const charge = this.phase === 'charging' ? this.charge : this.phase === 'launch' ? 1 : 0;
      const retract = this.phase === 'launch' ? 1 - Math.pow(1 - clamp(this.launchT / 0.78, 0, 1), 4) : 0;
      const x = this.wheelX - r * (desktop ? 2.35 : 1.42);
      const y = this.roadY - r * (desktop ? 0.72 : 1.03);
      const scale = desktop ? 1 : 0.66;
      const firingRate = 3.2 + charge * 18;
      const vibration = this.reducedMotion ? 0 : (Math.sin(time * firingRate * 2.7) * 0.65 + Math.sin(time * firingRate * 4.1 + 0.9) * 0.35) * charge * 2.1 + Math.sin(time * 45) * this.clutchKick * 2.6;

      ctx.save();
      ctx.translate(x + vibration - retract * r * 0.17, y);
      ctx.scale(scale, scale);
      ctx.save(); ctx.globalAlpha = 0.58; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(0, r * 0.78, r * 1.55, r * 0.18, 0, 0, TAU); ctx.fill(); ctx.restore();

      const rail = ctx.createLinearGradient(-r * 1.52, 0, r * 1.48, 0);
      rail.addColorStop(0, '#07090b'); rail.addColorStop(0.25, '#353b40'); rail.addColorStop(0.52, '#101316'); rail.addColorStop(0.78, '#41474c'); rail.addColorStop(1, '#07090b');
      ctx.fillStyle = rail; this.roundRect(ctx, -r * 1.5, r * 0.66, r * 2.95, r * 0.22, r * 0.07); ctx.fill();
      ctx.fillStyle = '#6a7075'; ctx.fillRect(-r * 1.28, r * 0.705, r * 2.53, r * 0.026);
      ctx.fillStyle = '#ff5b00'; ctx.fillRect(-r * 1.07, r * 0.77, r * 1.92, r * 0.023);

      const body = ctx.createLinearGradient(-r, -r * 0.7, r * 0.85, r * 0.58);
      body.addColorStop(0, '#080a0c'); body.addColorStop(0.2, '#30363b'); body.addColorStop(0.47, '#14181b'); body.addColorStop(0.76, '#42484d'); body.addColorStop(1, '#080a0c');
      ctx.fillStyle = body; ctx.strokeStyle = '#5b6268'; ctx.lineWidth = 2;
      this.roundRect(ctx, -r * 1.03, -r * 0.68, r * 1.76, r * 1.28, r * 0.14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.055)'; this.roundRect(ctx, -r * 0.93, -r * 0.58, r * 1.45, r * 0.1, r * 0.04); ctx.fill();

      const banks = desktop ? 6 : 4;
      for (let bank = 0; bank < 2; bank++) {
        const bankY = bank ? r * 0.18 : -r * 0.36;
        for (let i = 0; i < banks; i++) {
          const px = -r * 0.84 + i * (r * 1.3 / Math.max(1, banks - 1));
          const phase = time * firingRate * 3.1 + i * 0.9 + bank * 1.65;
          const piston = Math.sin(phase) * r * 0.035 * charge;
          ctx.save(); ctx.translate(px, bankY + piston); ctx.rotate(bank ? -0.12 : 0.12);
          const cyl = ctx.createLinearGradient(0, -r * 0.16, 0, r * 0.16);
          cyl.addColorStop(0, '#777e84'); cyl.addColorStop(0.34, '#282d31'); cyl.addColorStop(1, '#0c0f12');
          ctx.fillStyle = cyl; ctx.strokeStyle = '#7e858a'; ctx.lineWidth = 1.1;
          this.roundRect(ctx, -r * 0.068, -r * 0.17, r * 0.136, r * 0.34, r * 0.032); ctx.fill(); ctx.stroke();
          const hot = smoothstep(0.72, 0.96, charge) * (0.45 + 0.55 * Math.max(0, Math.sin(phase)));
          ctx.fillStyle = hot > 0.06 ? `rgba(255,${90 + hot * 70},20,${0.32 + hot * 0.68})` : '#30363b';
          ctx.shadowColor = '#ff5b00'; ctx.shadowBlur = hot * 11;
          ctx.fillRect(-r * 0.048, -r * 0.146, r * 0.096, r * 0.032); ctx.shadowBlur = 0;
          ctx.restore();
        }
      }

      ctx.fillStyle = '#0b0e11'; ctx.strokeStyle = '#4b5258'; ctx.lineWidth = 2;
      this.roundRect(ctx, -r * 0.78, -r * 0.13, r * 1.22, r * 0.29, r * 0.085); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(255,91,0,${0.3 + charge * 0.7})`; ctx.fillRect(-r * 0.71, -r * 0.085, r * 1.07, r * 0.034);
      ctx.fillStyle = '#c2c6c9'; ctx.font = `900 ${Math.max(8, r * 0.084)}px Inter, sans-serif`; ctx.fillText('TAKKAR V12', -r * 0.65, r * 0.08);

      const flyX = r * 0.81, flyY = r * 0.03, flyR = r * 0.43;
      ctx.save(); ctx.translate(flyX, flyY); ctx.rotate(time * (2.2 + charge * 23));
      const fly = ctx.createRadialGradient(-flyR * 0.25, -flyR * 0.22, 0, 0, 0, flyR);
      fly.addColorStop(0, '#d4d7d9'); fly.addColorStop(0.19, '#646b70'); fly.addColorStop(0.5, '#14181b'); fly.addColorStop(0.78, '#737a80'); fly.addColorStop(1, '#090b0d');
      ctx.fillStyle = fly; ctx.strokeStyle = '#858b90'; ctx.lineWidth = r * 0.035; ctx.beginPath(); ctx.arc(0, 0, flyR, 0, TAU); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.fillStyle = i % 2 ? '#ff5b00' : '#3b4146'; ctx.fillRect(flyR * 0.34, -r * 0.025, flyR * 0.46, r * 0.05); }
      ctx.fillStyle = '#101316'; ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, TAU); ctx.fill(); ctx.restore();

      for (const side of [-1, 1]) {
        const tx = -r * 0.34 + side * r * 0.34, ty = -r * 0.72;
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(side * 0.15);
        const turbo = ctx.createRadialGradient(-r * 0.08, -r * 0.08, 0, 0, 0, r * 0.25);
        turbo.addColorStop(0, '#b0b5b9'); turbo.addColorStop(0.42, '#3d4348'); turbo.addColorStop(1, '#080a0c');
        ctx.fillStyle = turbo; ctx.strokeStyle = '#7c8388'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.rotate(time * (5.5 + charge * 29) * side);
        for (let i = 0; i < 7; i++) { ctx.rotate(TAU / 7); ctx.fillStyle = '#697076'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.17, -r * 0.024); ctx.lineTo(r * 0.09, r * 0.043); ctx.fill(); }
        ctx.restore();
        const turboHot = smoothstep(0.58, 1, charge);
        ctx.fillStyle = turboHot ? `rgba(255,${95 + turboHot * 80},20,${0.45 + turboHot * 0.5})` : '#252a2e';
        ctx.shadowColor = '#ff5b00'; ctx.shadowBlur = turboHot * 14; ctx.beginPath(); ctx.arc(0, 0, r * 0.055, 0, TAU); ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
      }

      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const yy = -r * 0.42 + i * r * 0.22;
        ctx.strokeStyle = i % 2 ? '#5f666c' : '#3b4146'; ctx.lineWidth = r * 0.043;
        ctx.beginPath(); ctx.moveTo(-r * 0.98, yy); ctx.bezierCurveTo(-r * 1.18, yy, -r * 1.1, yy + r * 0.22, -r * 1.31, yy + r * 0.22); ctx.stroke();
        if (charge > 0.64) { ctx.strokeStyle = `rgba(255,${90 + i * 12},16,${0.15 + charge * 0.42})`; ctx.lineWidth = r * 0.011; ctx.stroke(); }
      }

      const clutchX = r * 1.28 - retract * r * 0.52;
      ctx.strokeStyle = '#4e555b'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(flyX + r * 0.18, flyY); ctx.lineTo(clutchX - r * 0.18, r * 0.18); ctx.stroke();
      ctx.strokeStyle = '#ff5b00'; ctx.lineWidth = r * 0.017; ctx.stroke();
      for (const [yy, rr, dir] of [[r * 0.44, r * 0.2, -1], [-r * 0.32, r * 0.17, 1]]) {
        ctx.save(); ctx.translate(clutchX, yy); ctx.rotate(dir * time * (2.5 + charge * 24));
        ctx.fillStyle = '#121519'; ctx.strokeStyle = '#747b81'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = charge > 0.86 ? '#ff8d34' : '#ff5b00'; ctx.lineWidth = r * 0.024; ctx.beginPath(); ctx.arc(0, 0, rr * 0.76, 0, TAU); ctx.stroke();
        for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); ctx.fillStyle = '#3b4146'; ctx.fillRect(rr * 0.22, -2, rr * 0.62, 4); }
        ctx.restore();
      }

      const pressure = clamp(charge, 0, 1);
      for (let i = 0; i < 3; i++) {
        const px = -r * 0.9 + i * r * 0.3;
        ctx.fillStyle = '#111418'; ctx.beginPath(); ctx.arc(px, r * 0.5, r * 0.075, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#71787d'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.save(); ctx.translate(px, r * 0.5); ctx.rotate(-2.35 + pressure * (1.3 + i * 0.18));
        ctx.strokeStyle = pressure > 0.85 ? '#ff5b00' : '#d2d5d7'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.052, 0); ctx.stroke(); ctx.restore();
      }

      if (charge > 0.56 && this.quality !== 'low') {
        const smokeCount = desktop ? 4 : 2;
        for (let i = 0; i < smokeCount; i++) {
          const life = (time * (0.55 + i * 0.08) + i * 0.27) % 1;
          const sx = -r * 1.31 - life * r * 0.48;
          const sy = -r * 0.2 - life * r * 0.58 + Math.sin(time * 2 + i) * r * 0.04;
          ctx.fillStyle = `rgba(140,145,150,${(1 - life) * charge * 0.12})`;
          ctx.beginPath(); ctx.arc(sx, sy, r * (0.06 + life * 0.15), 0, TAU); ctx.fill();
        }
      }

      if (this.launchFlare > 0.03) {
        ctx.globalCompositeOperation = 'lighter';
        const alpha = this.launchFlare;
        const flare = ctx.createRadialGradient(clutchX, r * 0.1, 0, clutchX, r * 0.1, r * 0.78);
        flare.addColorStop(0, `rgba(255,247,216,${alpha * 0.8})`); flare.addColorStop(0.2, `rgba(255,115,18,${alpha * 0.62})`); flare.addColorStop(1, 'rgba(255,70,0,0)');
        ctx.fillStyle = flare; ctx.fillRect(clutchX - r * 0.82, -r * 0.72, r * 1.64, r * 1.45);
      }
      ctx.restore();
    };

    game.drawWheel = function drawWheelPolished(ctx) {
      const p = this.__polish;
      const r = this.wheelR;
      let x = this.wheelX + p.contactTravel;
      let y = this.wheelY + p.wheelLift;
      if (this.phase === 'idle' || this.phase === 'charging') y += Math.sin(p.time * (this.phase === 'charging' ? 5.5 + this.charge * 8 : 1.5)) * (this.phase === 'charging' ? this.charge * 1.2 : 0.7);
      if (this.phase === 'launch') {
        const t = clamp((this.launchT - 0.08) / 0.72, 0, 1);
        const eased = 1 - Math.pow(1 - t, 4);
        x = lerp(this.wheelX - r * 0.5, this.wheelX, eased);
        y -= Math.sin(t * Math.PI) * r * 0.052;
      }
      if (this.wheelBounce > 0.01) y -= Math.sin((1 - this.wheelBounce) * Math.PI) * r * 0.065;

      const texture = buildWheelTexture(this);
      const squash = this.wheelSquash;
      const sx = 1 + squash * 0.2;
      const sy = 1 - squash * 0.25;
      const angle = this.wheelAngle + p.wheelPitch;

      ctx.save(); ctx.globalAlpha = 0.46; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x + r * 0.05, this.roadY - 3, r * (0.72 + squash * 0.18), r * 0.13, 0, 0, TAU); ctx.fill(); ctx.restore();

      const speedRatio = clamp(this.speed / 1000, 0, 1);
      if (speedRatio > 0.55 && !this.reducedMotion) {
        const ghosts = this.quality === 'high' ? 2 : 1;
        for (let i = ghosts; i >= 1; i--) {
          ctx.save(); ctx.globalAlpha = 0.035 * speedRatio * i; ctx.translate(x - i * (10 + speedRatio * 12), y); ctx.rotate(angle - i * 0.12); ctx.scale(sx * (1 + i * 0.012), sy);
          const size = texture.canvas.width / texture.resolution;
          ctx.drawImage(texture.canvas, -size / 2, -size / 2, size, size); ctx.restore();
        }
      }

      ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(sx, sy);
      const size = texture.canvas.width / texture.resolution;
      ctx.drawImage(texture.canvas, -size / 2, -size / 2, size, size);
      if (this.overdrive) {
        ctx.globalCompositeOperation = 'lighter';
        const glow = ctx.createRadialGradient(0, 0, r * 0.62, 0, 0, r * 1.25);
        glow.addColorStop(0, 'rgba(255,80,0,0)'); glow.addColorStop(0.72, 'rgba(255,80,0,.14)'); glow.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 1.25, 0, TAU); ctx.fill();
      }
      ctx.restore();
    };

    game.drawObstacle = function drawObstaclePolished(ctx, o) {
      const r = this.wheelR;
      const reaction = o.reaction || 0;
      const pulse = o.impactPulse || 0;
      const approach = o.approach || 0;
      const baseY = o.y;
      let rotation = 0, shiftX = 0, shiftY = 0;
      if (o.passed) {
        if (o.type === 'barrier') rotation = -Math.min(1.05, reaction * 0.22 + o.tilt * 0.32);
        else if (o.type === 'ram') shiftX = Math.min(r * 0.32, reaction * r * 0.06);
        else if (o.type === 'curb' || o.type === 'gap') shiftY = Math.min(r * 0.12, reaction * r * 0.02);
        else rotation = Math.min(0.25, reaction * 0.04);
      }

      ctx.save(); ctx.translate(o.x + shiftX, baseY + shiftY); ctx.rotate(rotation); ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 10;

      if (o.type === 'joint') {
        ctx.fillStyle = '#111418'; ctx.fillRect(-r * 0.66, -r * 0.11, r * 1.32, r * 0.18);
        const plate = ctx.createLinearGradient(0, -r * 0.14, 0, r * 0.07); plate.addColorStop(0, '#7c8389'); plate.addColorStop(0.28, '#363c42'); plate.addColorStop(1, '#171b1f');
        ctx.fillStyle = plate; this.roundRect(ctx, -r * 0.62, -r * 0.16, r * 1.24, r * 0.2, r * 0.035); ctx.fill(); ctx.strokeStyle = '#8c9297'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = '#050607'; ctx.lineWidth = r * 0.035; ctx.beginPath(); ctx.moveTo(0, -r * 0.155); ctx.lineTo(0, r * 0.04); ctx.stroke();
        for (const x of [-0.45, -0.22, 0.22, 0.45]) { ctx.fillStyle = '#111418'; ctx.beginPath(); ctx.arc(r * x, -r * 0.055, r * 0.045, 0, TAU); ctx.fill(); ctx.fillStyle = '#9ca2a7'; ctx.beginPath(); ctx.arc(r * x - r * 0.01, -r * 0.067, r * 0.016, 0, TAU); ctx.fill(); }
      } else if (o.type === 'curb') {
        const concrete = ctx.createLinearGradient(-r * 0.65, -r * 0.58, r * 0.5, 0); concrete.addColorStop(0, '#85827b'); concrete.addColorStop(0.44, '#4f504e'); concrete.addColorStop(1, '#2a2c2d');
        ctx.fillStyle = concrete; ctx.beginPath(); ctx.moveTo(-r * 0.65, 0); ctx.lineTo(-r * 0.42, -r * 0.42); ctx.quadraticCurveTo(-r * 0.28, -r * 0.58, -r * 0.08, -r * 0.58); ctx.lineTo(r * 0.56, -r * 0.42); ctx.lineTo(r * 0.68, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#97948b'; ctx.lineWidth = 2; ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r * 0.42, -r * 0.42); ctx.lineTo(r * 0.5, -r * 0.33); ctx.stroke();
        ctx.strokeStyle = '#6b3b24'; ctx.lineWidth = r * 0.024; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-r * 0.12 + i * r * 0.22, -r * 0.55); ctx.lineTo(-r * 0.06 + i * r * 0.22, -r * 0.36); ctx.stroke(); }
      } else if (o.type === 'barrier') {
        ctx.fillStyle = '#191d21'; this.roundRect(ctx, -r * 0.21, -r * 1.25, r * 0.42, r * 1.25, r * 0.06); ctx.fill(); ctx.strokeStyle = '#555c62'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#747b80'; ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.17, 0, TAU); ctx.fill(); ctx.fillStyle = '#15181b'; ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.08, 0, TAU); ctx.fill();
        ctx.save(); ctx.translate(0, -r * 0.95); ctx.rotate((o.passed ? -reaction * 0.16 : approach * 0.012));
        const arm = ctx.createLinearGradient(-r * 0.04, 0, r * 1.65, 0); arm.addColorStop(0, '#3c4247'); arm.addColorStop(0.5, '#1b1f23'); arm.addColorStop(1, '#62686d');
        ctx.fillStyle = arm; this.roundRect(ctx, -r * 0.05, -r * 0.12, r * 1.58, r * 0.24, r * 0.045); ctx.fill();
        for (let x = 0.13; x < 1.45; x += 0.3) { ctx.fillStyle = '#ff5b00'; ctx.save(); ctx.translate(r * x, 0); ctx.rotate(-0.55); ctx.fillRect(-r * 0.08, -r * 0.12, r * 0.16, r * 0.24); ctx.restore(); }
        ctx.restore(); ctx.fillStyle = '#0d1013'; this.roundRect(ctx, -r * 0.36, -r * 0.1, r * 0.72, r * 0.12, r * 0.03); ctx.fill();
      } else if (o.type === 'ram') {
        ctx.fillStyle = '#15191d'; this.roundRect(ctx, -r * 0.52, -r * 1.34, r * 1.04, r * 1.34, r * 0.09); ctx.fill(); ctx.strokeStyle = '#51585e'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#2f353a'; ctx.fillRect(-r * 0.35, -r * 1.17, r * 0.7, r * 0.18); ctx.fillStyle = '#111418'; ctx.fillRect(-r * 0.16, -r * 1.02, r * 0.32, r * 0.75);
        const head = ctx.createLinearGradient(-r * 0.46, 0, r * 0.46, 0); head.addColorStop(0, '#24292e'); head.addColorStop(0.45, '#8b9196'); head.addColorStop(1, '#20252a');
        ctx.fillStyle = head; ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.33); ctx.lineTo(r * 0.5, -r * 0.33); ctx.lineTo(r * 0.39, 0); ctx.lineTo(-r * 0.39, 0); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#a0a6aa'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#ff5b00'; ctx.shadowColor = '#ff5b00'; ctx.shadowBlur = 10; ctx.fillRect(-r * 0.25, -r * 0.42, r * 0.5, r * 0.045); ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#030405'; ctx.beginPath(); ctx.moveTo(-r * 0.74, -r * 0.02); ctx.lineTo(-r * 0.4, -r * 0.23); ctx.lineTo(-r * 0.08, -r * 0.16); ctx.lineTo(r * 0.24, -r * 0.24); ctx.lineTo(r * 0.72, -r * 0.02); ctx.lineTo(r * 0.72, r * 0.12); ctx.lineTo(-r * 0.74, r * 0.12); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#6b6e70'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 0.74, -r * 0.02); ctx.lineTo(-r * 0.4, -r * 0.23); ctx.lineTo(-r * 0.08, -r * 0.16); ctx.moveTo(r * 0.24, -r * 0.24); ctx.lineTo(r * 0.72, -r * 0.02); ctx.stroke();
        ctx.strokeStyle = '#ff5b00'; ctx.shadowColor = '#ff5b00'; ctx.shadowBlur = 10; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-r * 0.42, -r * 0.2); ctx.lineTo(-r * 0.1, -r * 0.13); ctx.moveTo(r * 0.23, -r * 0.21); ctx.lineTo(r * 0.66, -r * 0.02); ctx.stroke(); ctx.shadowBlur = 0;
      }

      if (pulse > 0.03) {
        ctx.globalCompositeOperation = 'lighter';
        const cx = this.obstacleContactOffset(o);
        const glow = ctx.createRadialGradient(cx, -r * 0.18, 0, cx, -r * 0.18, r * 0.62);
        glow.addColorStop(0, `rgba(255,247,222,${pulse * 0.6})`); glow.addColorStop(0.18, `rgba(255,91,0,${pulse * 0.42})`); glow.addColorStop(1, 'rgba(255,70,0,0)');
        ctx.fillStyle = glow; ctx.fillRect(cx - r * 0.65, -r * 0.84, r * 1.3, r * 1.22);
      }
      ctx.restore();
    };

    game.drawSpeedEffects = function drawSpeedEffectsPolished(ctx, time) {
      if (this.speed < 500) return;
      const strength = clamp((this.speed - 500) / 650, 0, 1);
      const count = this.reducedMotion ? 3 : this.quality === 'high' ? (this.isDesktop ? 12 : 8) : this.quality === 'balanced' ? 7 : 4;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count; i++) {
        const seed = i * 127.13;
        const y = ((time * (115 + i * 9) + seed) % Math.max(1, this.roadY - this.h * 0.2)) + this.h * 0.14;
        const x = ((time * -(520 + i * 31) + seed * 3.3) % (this.w + 260)) + this.w;
        const length = 42 + strength * (72 + i * 3);
        ctx.strokeStyle = this.overdrive ? `rgba(255,95,28,${0.08 + strength * 0.18})` : `rgba(255,188,123,${0.045 + strength * 0.12})`;
        ctx.lineWidth = this.overdrive ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(x - length, y); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.restore();
    };

    game.draw = function drawPolished(time) {
      const ctx = this.ctx;
      if (!this.w || !this.h) return;
      const p = this.__polish;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(this.w / 2 + p.shakeX, this.h / 2 + p.shakeY);
      ctx.scale(this.cameraZoom, this.cameraZoom);
      ctx.translate(-this.w / 2 + this.cameraX, -this.h / 2);
      this.drawBackground(ctx, time);
      this.drawRoad(ctx, time);
      if (this.phase === 'idle' || this.phase === 'charging' || (this.phase === 'launch' && this.launchT < 0.94)) this.drawLaunchEngine(ctx, time);
      if (this.currentObstacle) this.drawObstacle(ctx, this.currentObstacle);
      this.drawSpeedEffects(ctx, time);
      if (!['crash', 'result'].includes(this.phase) || this.debris.length === 0) this.drawWheel(ctx, time);
      this.drawParticles(ctx);
      this.drawDebris(ctx);
      this.drawForeground(ctx, time);
      ctx.restore();
    };

    game.loop = function loopPolished(now) {
      const dt = clamp((now - this.lastTime) / 1000, 0, 0.034);
      this.lastTime = now;
      this.update(dt, now);
      this.draw(now / 1000);

      const p = this.__polish;
      const fpsNow = dt > 0 ? 1 / dt : 60;
      p.fpsEma = damp(p.fpsEma, fpsNow, 2.4, dt);
      this.fpsFrames++;
      if (now - this.fpsTime > 1000) {
        this.fps = Math.round(p.fpsEma);
        const fpsBadge = document.getElementById('fpsBadge');
        if (fpsBadge) fpsBadge.textContent = `${this.fps} FPS`;
        this.fpsFrames = 0; this.fpsTime = now;
      }

      if (this.qualityChoice === 'auto') {
        if (p.fpsEma < 46) { p.lowFpsFor += dt; p.highFpsFor = 0; }
        else if (p.fpsEma > 57) { p.highFpsFor += dt; p.lowFpsFor = Math.max(0, p.lowFpsFor - dt * 2); }
        else { p.lowFpsFor = Math.max(0, p.lowFpsFor - dt); p.highFpsFor = Math.max(0, p.highFpsFor - dt); }
        if (p.lowFpsFor > 1.8 && this.quality !== 'low') {
          this.quality = this.quality === 'high' ? 'balanced' : 'low'; p.lowFpsFor = 0; this.resize();
        } else if (p.highFpsFor > 8 && this.quality === 'low') {
          this.quality = 'balanced'; p.highFpsFor = 0; this.resize();
        }
      }
      requestAnimationFrame((t) => this.loop(t));
    };

    game.resize();
    console.info('TAKKAR motion, obstacle, audio and performance polish 1.3.0 active');
  }

  whenGameReady(install);
})();
