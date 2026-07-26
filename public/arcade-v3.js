(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / Math.max(1e-6, b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOutCubic = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  const OBSTACLES = [
    { id: 'tires', name: 'TIRE STACK', risk: 'LOW', material: 'rubber', resistance: 620, damage: 12, reward: 70, width: 1.18, contact: -.54 },
    { id: 'crates', name: 'CARGO CRATES', risk: 'LOW', material: 'wood', resistance: 730, damage: 15, reward: 105, width: 1.34, contact: -.66 },
    { id: 'cart', name: 'STREET CART', risk: 'MEDIUM', material: 'metal', resistance: 845, damage: 18, reward: 150, width: 1.55, contact: -.72 },
    { id: 'bricks', name: 'BRICK WALL', risk: 'MEDIUM', material: 'stone', resistance: 970, damage: 23, reward: 220, width: 1.42, contact: -.68 },
    { id: 'gate', name: 'STEEL GATE', risk: 'HIGH', material: 'metal', resistance: 1110, damage: 28, reward: 320, width: 1.52, contact: -.75 },
    { id: 'tank', name: 'WATER TANK', risk: 'HIGH', material: 'water', resistance: 1240, damage: 33, reward: 450, width: 1.42, contact: -.68 },
    { id: 'truck', name: 'DELIVERY TRUCK', risk: 'BOSS', material: 'metal', resistance: 1420, damage: 42, reward: 700, width: 2.15, contact: -.98 }
  ];

  class AudioRig {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.engineBus = null;
      this.fxBus = null;
      this.engineGain = null;
      this.engineOsc = null;
      this.enginePulse = null;
      this.engineNoise = null;
      this.engineFilter = null;
      this.noiseBuffer = null;
      this.enabled = true;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? .52 : 0;
      this.engineBus = this.ctx.createGain();
      this.fxBus = this.ctx.createGain();
      this.engineBus.gain.value = .72;
      this.fxBus.gain.value = .9;

      const shelf = this.ctx.createBiquadFilter();
      shelf.type = 'lowshelf'; shelf.frequency.value = 105; shelf.gain.value = 5;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -17; comp.knee.value = 18; comp.ratio.value = 5.5;
      comp.attack.value = .003; comp.release.value = .22;
      this.engineBus.connect(this.master);
      this.fxBus.connect(this.master);
      this.master.connect(shelf).connect(comp).connect(this.ctx.destination);

      const len = Math.floor(this.ctx.sampleRate * 3);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + .018 * white) / 1.018;
        data[i] = clamp(white * .35 + brown * 2.25, -1, 1);
      }
    }

    setEnabled(v) {
      this.enabled = v;
      this.init();
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(v ? .52 : 0, this.ctx.currentTime, .025);
      if (!v) this.stopEngine();
    }

    voice({ freq = 100, end = null, dur = .2, type = 'sine', gain = .1, delay = 0, filter = null, pan = 0, bus = null }) {
      if (!this.enabled) return;
      this.init(); if (!this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), t + Math.min(.012, dur * .2));
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      let node = osc;
      if (filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass'; f.frequency.value = filter.freq || 900; f.Q.value = filter.q || .8;
        node.connect(f); node = f;
      }
      node.connect(g);
      const target = bus || this.fxBus || this.master;
      if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(target); }
      else g.connect(target);
      osc.start(t); osc.stop(t + dur + .04);
    }

    burst({ dur = .2, gain = .1, freq = 900, type = 'lowpass', delay = 0, pan = 0 }) {
      if (!this.enabled) return;
      this.init(); if (!this.ctx || !this.noiseBuffer) return;
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      src.buffer = this.noiseBuffer;
      f.type = type; f.frequency.value = freq; f.Q.value = .75;
      g.gain.setValueAtTime(Math.max(.0002, gain), t);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      src.connect(f).connect(g);
      if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(this.fxBus || this.master); }
      else g.connect(this.fxBus || this.master);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + .03);
    }

    startEngine() {
      if (!this.enabled) return;
      this.init(); if (!this.ctx || this.engineOsc) return;
      const t = this.ctx.currentTime;
      this.engineOsc = this.ctx.createOscillator();
      this.enginePulse = this.ctx.createOscillator();
      this.engineNoise = this.ctx.createBufferSource();
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineGain = this.ctx.createGain();
      const pulseGain = this.ctx.createGain();
      const noiseGain = this.ctx.createGain();
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = AudioRig.curve(16); shaper.oversample = '2x';
      this.engineOsc.type = 'sawtooth'; this.enginePulse.type = 'square';
      this.engineOsc.frequency.value = 46; this.enginePulse.frequency.value = 23;
      this.engineNoise.buffer = this.noiseBuffer; this.engineNoise.loop = true;
      this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 430; this.engineFilter.Q.value = 1.1;
      this.engineGain.gain.value = .0001; pulseGain.gain.value = .18; noiseGain.gain.value = .08;
      this.engineOsc.connect(this.engineFilter);
      this.enginePulse.connect(pulseGain).connect(this.engineFilter);
      this.engineNoise.connect(noiseGain).connect(this.engineFilter);
      this.engineFilter.connect(shaper).connect(this.engineGain).connect(this.engineBus || this.master);
      this.engineGain.gain.exponentialRampToValueAtTime(.08, t + .18);
      this.engineOsc.start(t); this.enginePulse.start(t); this.engineNoise.start(t, Math.random());
    }

    updateEngine(power, speed = 0) {
      if (!this.ctx || !this.engineOsc) return;
      const t = this.ctx.currentTime;
      const rpm = 42 + power * 130 + speed * .055;
      this.engineOsc.frequency.setTargetAtTime(rpm, t, .035);
      this.enginePulse.frequency.setTargetAtTime(rpm * .5, t, .04);
      this.engineFilter.frequency.setTargetAtTime(320 + power * 1180 + speed * .32, t, .05);
      this.engineGain.gain.setTargetAtTime(.045 + power * .055, t, .06);
    }

    stopEngine() {
      if (!this.ctx || !this.engineOsc) return;
      const a = this.engineOsc, b = this.enginePulse, n = this.engineNoise;
      this.engineGain.gain.setTargetAtTime(.0001, this.ctx.currentTime, .05);
      setTimeout(() => { try { a.stop(); b.stop(); n.stop(); } catch {} }, 220);
      this.engineOsc = null; this.enginePulse = null; this.engineNoise = null; this.engineGain = null;
    }

    launch(perfect) {
      this.voice({ freq: 190, end: 74, dur: .12, type: 'square', gain: .08, filter: { type: 'bandpass', freq: 850 }, pan: -.25 });
      this.voice({ freq: 58, end: 29, dur: .45, type: 'sine', gain: .28 });
      this.burst({ dur: .38, gain: .22, freq: 620 });
      this.voice({ freq: perfect ? 520 : 360, end: perfect ? 980 : 590, dur: .22, type: 'triangle', gain: perfect ? .09 : .055, delay: .09, pan: .2 });
    }

    impact(material, intensity = 1) {
      const p = clamp(intensity, .65, 1.5);
      this.voice({ freq: 56, end: 24, dur: .35, type: 'sine', gain: .27 * p });
      this.burst({ dur: .25, gain: .23 * p, freq: material === 'rubber' ? 430 : 820, type: 'lowpass' });
      if (material === 'metal') {
        this.voice({ freq: 240, end: 95, dur: .28, type: 'triangle', gain: .12 * p, delay: .01, pan: .3 });
        this.voice({ freq: 680, end: 330, dur: .18, type: 'sine', gain: .055 * p, delay: .02, pan: -.2 });
        this.burst({ dur: .12, gain: .08 * p, freq: 2600, type: 'highpass' });
      } else if (material === 'wood') {
        this.burst({ dur: .18, gain: .16 * p, freq: 1450, type: 'bandpass' });
        this.voice({ freq: 170, end: 80, dur: .13, type: 'square', gain: .06 * p });
      } else if (material === 'stone') {
        this.burst({ dur: .42, gain: .2 * p, freq: 980, type: 'lowpass' });
        this.burst({ dur: .1, gain: .09 * p, freq: 3200, type: 'highpass', delay: .03 });
      } else if (material === 'water') {
        this.burst({ dur: .58, gain: .19 * p, freq: 1600, type: 'bandpass' });
        this.voice({ freq: 220, end: 70, dur: .26, type: 'triangle', gain: .07 * p });
      } else {
        this.voice({ freq: 112, end: 72, dur: .22, type: 'sine', gain: .12 * p });
      }
    }

    perfect() {
      [620, 820, 1120].forEach((f, i) => this.voice({ freq: f, end: f * 1.05, dur: .1, type: 'sine', gain: .055, delay: i * .045 }));
    }

    bank() {
      [392, 523, 659, 784].forEach((f, i) => this.voice({ freq: f, end: f * 1.03, dur: .16, type: 'sine', gain: .07, delay: i * .05 }));
    }

    fail() {
      this.burst({ dur: .85, gain: .38, freq: 520 });
      this.voice({ freq: 88, end: 22, dur: 1, type: 'sawtooth', gain: .32 });
      this.voice({ freq: 260, end: 48, dur: .34, type: 'square', gain: .1, delay: .03 });
    }

    static curve(amount = 18) {
      const n = 1024, arr = new Float32Array(n), k = amount;
      for (let i = 0; i < n; i++) {
        const x = i * 2 / (n - 1) - 1;
        arr[i] = ((3 + k) * x * 18 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
      }
      return arr;
    }
  }

  class TakkarArcade {
    constructor() {
      this.canvas = $('game');
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.sound = new AudioRig();
      this.tg = window.Telegram?.WebApp || null;
      this.phase = 'ready';
      this.charge = 0; this.chargeDir = 1; this.isHolding = false;
      this.launchT = 0; this.recoverT = 0; this.choiceDuration = 1.35; this.choiceRemaining = 0;
      this.speed = 0; this.targetSpeed = 0; this.distance = 0; this.wheelAngle = 0; this.wheelOmega = 0; this.slip = 0;
      this.wheelY = 0; this.wheelVy = 0; this.wheelPitch = 0; this.wheelSquash = 0; this.wheelSquashV = 0;
      this.cameraX = 0; this.cameraZoom = 1; this.cameraZoomTarget = 1; this.cameraKickX = 0; this.cameraKickY = 0; this.cameraKickVx = 0; this.cameraKickVy = 0;
      this.score = 0; this.combo = 0; this.health = 100; this.impactIndex = 0; this.launchPower = 1;
      this.coins = Number(localStorage.getItem('takkar.coins') || 0);
      this.best = Number(localStorage.getItem('takkar.best') || 0);
      this.engineLevel = Number(localStorage.getItem('takkar.engine') || 1);
      this.tireLevel = Number(localStorage.getItem('takkar.tire') || 1);
      this.obstacle = null; this.obstacleDelay = 0; this.pendingFail = false; this.lastAward = 0;
      this.particles = []; this.fragments = []; this.smoke = [];
      this.flash = 0; this.contactFlash = 0; this.contactX = 0; this.contactY = 0;
      this.fixed = 1 / 120; this.accumulator = 0; this.last = performance.now();
      this.quality = 'high'; this.fpsEma = 60; this.lowFps = 0; this.highFps = 0; this.dpr = 1;
      this.cache = new Map(); this.appActive = true;
      this.bind(); this.resize(); this.syncHud(true); this.showStart();
      this.tg?.ready?.(); this.tg?.expand?.();
      requestAnimationFrame((t) => this.loop(t));
    }

    bind() {
      const action = $('action');
      const press = (e) => {
        e?.preventDefault(); this.sound.init();
        if (this.phase === 'ready') {
          this.phase = 'charging'; this.isHolding = true; this.charge = 0; this.chargeDir = 1;
          this.sound.startEngine(); $('hero').classList.add('hidden'); this.haptic('soft'); this.syncHud(true);
        } else if (['run', 'approach', 'recover', 'choice'].includes(this.phase)) {
          this.bankRun();
        } else if (this.phase === 'result') {
          this.reset();
        }
      };
      const release = (e) => {
        e?.preventDefault();
        if (this.phase === 'charging' && this.isHolding) { this.isHolding = false; this.launch(); }
      };
      action.addEventListener('pointerdown', (e) => { try { action.setPointerCapture(e.pointerId); } catch {} press(e); });
      action.addEventListener('pointerup', release);
      action.addEventListener('pointercancel', release);
      action.addEventListener('lostpointercapture', release);
      window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) press(e); if (e.key.toLowerCase() === 'b') this.bankRun(); });
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') release(e); });
      $('sound').addEventListener('click', () => { this.sound.setEnabled(!this.sound.enabled); $('sound').textContent = this.sound.enabled ? 'SOUND ON' : 'SOUND OFF'; });
      $('garage').addEventListener('click', () => this.openGarage());
      $('garageClose').addEventListener('click', () => $('garageSheet').classList.remove('open'));
      $('upgradeEngine').addEventListener('click', () => this.upgrade('engine'));
      $('upgradeTire').addEventListener('click', () => this.upgrade('tire'));
      $('share').addEventListener('click', async () => {
        const text = `I scored ${this.score.toLocaleString()} in TAKKAR. Ek aur takkar?`;
        try { if (navigator.share) await navigator.share({ title: 'TAKKAR', text, url: location.href }); else await navigator.clipboard?.writeText(`${text} ${location.href}`); } catch {}
      });
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => {
        this.appActive = !document.hidden;
        if (!this.appActive) { this.sound.stopEngine(); this.isHolding = false; }
        else if (['run', 'approach', 'recover', 'choice'].includes(this.phase)) this.sound.startEngine();
        this.last = performance.now();
      });
    }

    haptic(type) { try { this.tg?.HapticFeedback?.impactOccurred(type); } catch {} }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.w = r.width; this.h = r.height; this.mobile = this.w < 760;
      const maxDpr = this.quality === 'high' ? (this.mobile ? 1.28 : 1.52) : this.quality === 'balanced' ? 1.12 : 1;
      this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
      this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.roadY = this.h * (this.mobile ? .73 : .75);
      this.wheelR = clamp(Math.min(this.h * (this.mobile ? .22 : .21), this.w * (this.mobile ? .19 : .088)), 58, 126);
      this.wheelX = this.w * (this.mobile ? .31 : .37);
      this.wheelBaseY = this.roadY - this.wheelR * .985;
      if (!this.wheelY) this.wheelY = this.wheelBaseY;
      this.cache.clear();
    }

    showStart() {
      $('actionKicker').textContent = 'PRESS & HOLD';
      $('actionLabel').textContent = 'CHARGE THE ENGINE';
      $('actionSub').textContent = 'RELEASE IN THE ORANGE ZONE';
      $('chargeGrade').textContent = 'BUILD';
    }

    launch() {
      const perfect = this.charge >= .78 && this.charge <= .93;
      const good = this.charge >= .65 && this.charge <= .98;
      this.launchPower = .78 + this.charge * .42 + (perfect ? .16 : good ? .06 : 0) + (this.engineLevel - 1) * .045;
      this.phase = 'release'; this.launchT = 0; this.speed = 0;
      this.targetSpeed = 760 + this.launchPower * 235 + (this.engineLevel - 1) * 28;
      this.wheelOmega = (7 + this.charge * 20) / Math.max(.55, this.wheelR / 100);
      this.slip = .95; this.health = 100 + (this.tireLevel - 1) * 8;
      this.score = 0; this.combo = 0; this.distance = 0; this.impactIndex = 0; this.obstacle = null; this.obstacleDelay = .58;
      this.pendingFail = false; this.cameraZoomTarget = 1.025;
      this.sound.launch(perfect); if (perfect) this.sound.perfect(); this.haptic('heavy');
      $('perfect').classList.toggle('show', perfect);
      setTimeout(() => $('perfect').classList.remove('show'), 820);
      this.syncHud(true);
    }

    spawnObstacle() {
      const base = OBSTACLES[Math.min(OBSTACLES.length - 1, this.impactIndex)];
      const extra = Math.max(0, this.impactIndex - OBSTACLES.length + 1);
      this.obstacle = {
        ...base,
        resistance: base.resistance * (1 + extra * .075),
        x: this.w + this.wheelR * 1.8,
        y: this.roadY,
        hit: false, approach: 0, reaction: 0, reactionTime: 0,
        vx: 0, vy: 0, rotation: 0, angularV: 0,
        bend: 0, crush: 0, alpha: 1
      };
      $('nextName').textContent = base.name;
      $('riskLabel').textContent = base.risk;
      $('nextCard').classList.add('show');
    }

    contactOffset(o) { return this.wheelR * (o?.contact ?? -.65); }

    bankRun() {
      if (!['run', 'approach', 'recover', 'choice'].includes(this.phase)) return;
      const earned = Math.max(1, Math.round(this.score / 18));
      this.coins += earned; this.best = Math.max(this.best, this.score);
      localStorage.setItem('takkar.coins', String(this.coins));
      localStorage.setItem('takkar.best', String(this.best));
      this.sound.bank(); this.finish(false, earned);
    }

    failRun() {
      this.best = Math.max(this.best, this.score); localStorage.setItem('takkar.best', String(this.best));
      this.sound.fail(); this.haptic('heavy'); this.finish(true, 0);
    }

    finish(failed, earned) {
      this.phase = 'result'; this.targetSpeed = 0; this.sound.stopEngine();
      $('nextCard').classList.remove('show'); $('choice').classList.remove('show');
      $('result').classList.add('show');
      $('resultKicker').textContent = failed ? 'WHEEL DESTROYED' : 'RUN BANKED';
      $('resultTitle').textContent = failed ? 'TOO MUCH TAKKAR' : `${this.score.toLocaleString()} SCORE`;
      $('resultSub').textContent = failed ? `Best ${this.best.toLocaleString()} · Upgrade and hit again` : `+${earned} coins · Best ${this.best.toLocaleString()}`;
      $('actionKicker').textContent = 'ONE MORE RUN'; $('actionLabel').textContent = 'PLAY AGAIN'; $('actionSub').textContent = 'EK AUR TAKKAR?';
      this.syncHud(true);
    }

    reset() {
      this.phase = 'ready'; this.charge = 0; this.speed = 0; this.targetSpeed = 0; this.distance = 0;
      this.wheelOmega = 0; this.wheelAngle = 0; this.wheelY = this.wheelBaseY; this.wheelVy = 0;
      this.score = 0; this.combo = 0; this.health = 100; this.impactIndex = 0; this.obstacle = null;
      this.particles.length = 0; this.fragments.length = 0; this.smoke.length = 0;
      this.cameraZoom = 1; this.cameraZoomTarget = 1; this.cameraKickX = this.cameraKickY = 0;
      $('result').classList.remove('show'); $('choice').classList.remove('show'); $('hero').classList.remove('hidden'); $('nextCard').classList.remove('show');
      this.showStart(); this.syncHud(true);
    }

    cost(type) { const level = type === 'engine' ? this.engineLevel : this.tireLevel; return Math.round(120 * Math.pow(1.65, level - 1)); }

    openGarage() {
      $('garageCoins').textContent = this.coins.toLocaleString();
      $('engineLevel').textContent = `LV.${this.engineLevel}`; $('tireLevel').textContent = `LV.${this.tireLevel}`;
      $('engineCost').textContent = this.cost('engine').toLocaleString(); $('tireCost').textContent = this.cost('tire').toLocaleString();
      $('garageSheet').classList.add('open');
    }

    upgrade(type) {
      const cost = this.cost(type);
      if (this.coins < cost) { this.haptic('rigid'); return; }
      this.coins -= cost;
      if (type === 'engine') this.engineLevel++; else this.tireLevel++;
      localStorage.setItem('takkar.coins', String(this.coins));
      localStorage.setItem(`takkar.${type}`, String(type === 'engine' ? this.engineLevel : this.tireLevel));
      this.sound.bank(); this.openGarage(); this.syncHud(true);
    }

    impact() {
      const o = this.obstacle;
      if (!o || o.hit) return;
      o.hit = true;
      const healthFactor = .78 + clamp(this.health / 100, .2, 1.25) * .22;
      const force = this.speed * (.83 + this.launchPower * .17) * (1 + (this.engineLevel - 1) * .035) * healthFactor;
      const ratio = force / o.resistance;
      const success = ratio >= .73;
      const tireProtection = 1 - Math.min(.42, (this.tireLevel - 1) * .045);
      const damage = success ? clamp(o.damage / Math.max(.7, ratio) * tireProtection, 6, 34) : clamp((o.damage * 1.8 + 24) * tireProtection, 38, 95);
      this.health = Math.max(0, this.health - damage);
      this.pendingFail = !success || this.health <= 0;
      this.phase = 'impact'; this.recoverT = 0;
      this.contactX = this.wheelX + this.wheelR * .91; this.contactY = this.roadY - this.wheelR * .22;
      this.flash = .65; this.contactFlash = 1;
      this.wheelSquashV += .9 + o.damage * .015;
      this.wheelVy -= this.wheelR * (success ? 1.65 : 2.8);
      this.wheelPitch += success ? -.055 : -.12;
      const incoming = this.speed;
      this.speed *= success ? clamp(.74 - o.damage * .004, .56, .7) : .18;
      this.targetSpeed = success ? 720 + Math.min(this.impactIndex, 7) * 45 + (this.engineLevel - 1) * 25 : 0;
      this.cameraKickVx -= this.wheelR * (success ? 3.1 : 5.8);
      this.cameraKickVy += this.wheelR * (success ? 1.4 : 3.2);
      this.cameraZoomTarget = success ? 1.055 : 1.09;
      o.reaction = success ? 1 : .35; o.reactionTime = 0;
      o.vx = incoming * (success ? .34 : .08); o.vy = success ? -this.wheelR * (1.2 + o.damage * .02) : -this.wheelR * .35;
      o.angularV = success ? (o.id === 'truck' ? .25 : 1.7 + o.damage * .025) : .15;
      this.emitImpact(o, success ? 1 : 1.35);
      this.sound.impact(o.material, success ? 1 : 1.35); this.haptic(success ? 'rigid' : 'heavy');
      if (success) {
        this.combo++;
        this.lastAward = Math.round(o.reward * (1 + Math.max(0, this.combo - 1) * .2));
        this.score += this.lastAward;
        $('impactMaterial').textContent = `${o.name} DESTROYED`;
        $('impactScore').textContent = `+${this.lastAward.toLocaleString()}`;
        $('impactCallout').classList.add('show');
        setTimeout(() => $('impactCallout').classList.remove('show'), 760);
      }
      this.syncHud(true);
    }

    beginChoice() {
      if (this.pendingFail) { this.failRun(); return; }
      this.phase = 'choice'; this.choiceRemaining = this.choiceDuration;
      $('choice').classList.add('show');
      $('actionKicker').textContent = 'SAFE NOW'; $('actionLabel').textContent = 'BANK SCORE'; $('actionSub').textContent = 'OR WAIT FOR ONE MORE TAKKAR';
      this.syncHud(true);
    }

    continueRun() {
      this.impactIndex++; this.phase = 'run'; this.obstacle = null; this.obstacleDelay = .58;
      this.cameraZoomTarget = 1; $('choice').classList.remove('show'); $('nextCard').classList.remove('show');
      $('actionKicker').textContent = 'CURRENT RUN'; $('actionLabel').textContent = 'BANK SCORE'; $('actionSub').textContent = 'OR TRUST THE WHEEL';
      this.syncHud(true);
    }

    emitImpact(o, scale) {
      const particleCount = this.quality === 'high' ? 46 : this.quality === 'balanced' ? 30 : 18;
      const fragmentCount = this.quality === 'high' ? 16 : this.quality === 'balanced' ? 10 : 6;
      for (let i = 0; i < particleCount; i++) {
        const spark = o.material === 'metal' && i < particleCount * .46;
        const water = o.material === 'water' && i < particleCount * .72;
        this.particles.push({
          type: water ? 'water' : spark ? 'spark' : 'dust',
          x: this.contactX + rand(-8, 8), y: this.contactY + rand(-12, 12),
          vx: rand(-250, 560) * scale, vy: rand(-530, -35) * scale,
          life: rand(.28, water ? 1.1 : .82), max: 1, size: spark ? rand(1, 3) : water ? rand(2, 6) : rand(3, 8),
          gravity: spark ? 850 : water ? 640 : 570,
          color: water ? '#75dcff' : spark ? '#ffd27a' : o.material === 'wood' ? '#a96636' : o.material === 'stone' ? '#9d7658' : '#696e72'
        });
      }
      for (let i = 0; i < fragmentCount; i++) {
        this.fragments.push({
          source: o.id, material: o.material,
          x: o.x + rand(-this.wheelR * .35, this.wheelR * .35), y: o.y - rand(this.wheelR * .15, this.wheelR * 1.05),
          vx: rand(100, 520) * scale, vy: rand(-540, -90) * scale,
          life: rand(.9, 1.9), rot: rand(0, TAU), vr: rand(-9, 9), size: rand(6, 18)
        });
      }
    }

    emitSmoke(x, y, amount = 1) {
      const count = this.quality === 'low' ? 1 : Math.ceil(2 * amount);
      for (let i = 0; i < count; i++) this.smoke.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-70, -20), vy: rand(-55, -10), life: rand(.45, .9), max: 1, size: rand(8, 18) });
    }

    update(dt) {
      if (!this.appActive) return;
      this.flash *= Math.exp(-18 * dt); this.contactFlash *= Math.exp(-15 * dt);
      this.cameraZoom = damp(this.cameraZoom, this.cameraZoomTarget, 7, dt);
      this.cameraKickVx += (-this.cameraKickX * 65 - this.cameraKickVx * 15) * dt;
      this.cameraKickVy += (-this.cameraKickY * 65 - this.cameraKickVy * 15) * dt;
      this.cameraKickX += this.cameraKickVx * dt; this.cameraKickY += this.cameraKickVy * dt;
      this.wheelSquashV += (-this.wheelSquash * 100 - this.wheelSquashV * 18) * dt;
      this.wheelSquash += this.wheelSquashV * dt;
      this.wheelPitch = damp(this.wheelPitch, 0, 9, dt);

      if (this.phase === 'charging') {
        this.charge += dt * .72 * this.chargeDir;
        if (this.charge >= 1) { this.charge = 1; this.chargeDir = -1; }
        if (this.charge <= .32 && this.chargeDir < 0) { this.charge = .32; this.chargeDir = 1; }
        this.wheelOmega = damp(this.wheelOmega, 7 + this.charge * 23, 7, dt);
        this.wheelAngle += this.wheelOmega * dt;
        this.sound.updateEngine(this.charge, 0);
        if (this.charge > .6) this.emitSmoke(this.wheelX - this.wheelR * .25, this.roadY - 5, this.charge);
        const perfect = this.charge >= .78 && this.charge <= .93;
        $('chargeGrade').textContent = perfect ? 'PERFECT' : this.charge > .64 ? 'GOOD' : 'BUILD';
        $('actionKicker').textContent = perfect ? 'PERFECT ZONE' : 'BUILDING POWER';
        $('actionLabel').textContent = perfect ? 'RELEASE NOW' : 'KEEP HOLDING';
        $('actionSub').textContent = `${Math.round(this.charge * 100)}% ENGINE POWER`;
      }

      if (this.phase === 'release') {
        this.launchT += dt;
        const clutch = smoothstep(.06, .2, this.launchT);
        const drive = smoothstep(.14, .88, this.launchT);
        const target = this.targetSpeed * drive;
        this.speed = damp(this.speed, target, 9, dt);
        this.slip = damp(this.slip, Math.max(0, 1 - drive * 1.25), 6, dt);
        const rollingOmega = this.speed / Math.max(24, this.wheelR);
        this.wheelOmega = damp(this.wheelOmega, rollingOmega * (1 + this.slip * .45), clutch ? 8 : 3, dt);
        this.distance += this.speed * dt; this.wheelAngle += this.wheelOmega * dt;
        this.sound.updateEngine(1, this.speed);
        if (this.slip > .15) this.emitSmoke(this.wheelX - this.wheelR * .45, this.roadY - 4, this.slip * 1.5);
        if (this.launchT >= 1.02) { this.phase = 'run'; this.cameraZoomTarget = 1; this.obstacleDelay = .38; this.syncHud(true); }
      }

      const moving = ['run', 'approach', 'recover', 'choice'].includes(this.phase);
      if (moving) {
        this.speed = damp(this.speed, this.targetSpeed, this.phase === 'recover' ? 2.2 : 3.2, dt);
        this.distance += this.speed * dt;
        const rollingOmega = this.speed / Math.max(24, this.wheelR);
        this.wheelOmega = damp(this.wheelOmega, rollingOmega, 10, dt);
        this.wheelAngle += this.wheelOmega * dt;
        this.sound.updateEngine(clamp(this.speed / 1050, .25, 1), this.speed);
        const road = Math.sin(this.distance * .012) * .22 + Math.sin(this.distance * .027 + 1.2) * .1;
        const targetY = this.wheelBaseY + road * this.wheelR * .018;
        const spring = (targetY - this.wheelY) * 105 - this.wheelVy * 18;
        this.wheelVy += spring * dt; this.wheelY += this.wheelVy * dt;
      }

      if (this.phase === 'run' || this.phase === 'approach') {
        if (!this.obstacle) {
          this.obstacleDelay -= dt;
          if (this.obstacleDelay <= 0) this.spawnObstacle();
        }
        if (this.obstacle && !this.obstacle.hit) {
          this.obstacle.x -= this.speed * dt;
          const contact = this.obstacle.x + this.contactOffset(this.obstacle);
          const wheelFront = this.wheelX + this.wheelR * .91;
          const remaining = contact - wheelFront;
          this.obstacle.approach = clamp(1 - remaining / Math.max(this.w * .72, 1), 0, 1);
          $('nextProgress').style.width = `${this.obstacle.approach * 100}%`;
          if (remaining < this.wheelR * 2.8 && this.phase !== 'approach') this.phase = 'approach';
          this.cameraZoomTarget = remaining < this.wheelR * 3 ? 1.035 : 1;
          this.cameraX = damp(this.cameraX, remaining < this.wheelR * 3 ? -this.wheelR * .08 : 0, 5, dt);
          if (remaining <= 0) {
            this.obstacle.x = wheelFront - this.contactOffset(this.obstacle);
            this.impact();
          }
        }
      }

      if (this.phase === 'impact') {
        this.recoverT += dt;
        if (this.recoverT < .055) return;
        if (this.pendingFail) {
          if (this.recoverT > .68) this.failRun();
        } else if (this.recoverT > .16) {
          this.phase = 'recover'; this.recoverT = 0; this.cameraZoomTarget = 1.018;
        }
      } else if (this.phase === 'recover') {
        this.recoverT += dt;
        if (this.recoverT > .42) this.beginChoice();
      } else if (this.phase === 'choice') {
        this.choiceRemaining -= dt;
        $('choiceTimer').style.width = `${clamp(this.choiceRemaining / this.choiceDuration, 0, 1) * 100}%`;
        if (this.choiceRemaining <= 0) this.continueRun();
      }

      if (this.obstacle?.hit) {
        const o = this.obstacle; o.reactionTime += dt;
        if (o.id === 'gate') o.bend = Math.min(1, o.bend + dt * 2.6);
        if (o.id === 'truck') o.crush = Math.min(.34, o.crush + dt * .28);
        o.x += o.vx * dt; o.y += o.vy * dt; o.vy += 760 * dt; o.vx *= Math.exp(-2.4 * dt);
        o.rotation += o.angularV * dt; o.angularV *= Math.exp(-1.8 * dt);
      }

      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gravity * dt; p.vx *= Math.exp(-.35 * dt); }
      this.particles = this.particles.filter((p) => p.life > 0).slice(-(this.quality === 'high' ? 100 : this.quality === 'balanced' ? 66 : 38));
      for (const f of this.fragments) {
        f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 760 * dt; f.rot += f.vr * dt;
        if (f.y > this.roadY + 15) { f.y = this.roadY + 15; f.vy *= -.28; f.vx *= .72; f.vr *= .7; }
      }
      this.fragments = this.fragments.filter((f) => f.life > 0).slice(-(this.quality === 'high' ? 55 : this.quality === 'balanced' ? 34 : 20));
      for (const s of this.smoke) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= Math.exp(-1.1 * dt); s.size += dt * 18; }
      this.smoke = this.smoke.filter((s) => s.life > 0).slice(-(this.quality === 'high' ? 45 : 25));

      this.syncHud();
    }

    syncHud(force = false) {
      $('score').textContent = Math.round(this.score).toLocaleString();
      $('coins').textContent = Math.round(this.coins).toLocaleString();
      $('best').textContent = Math.round(this.best).toLocaleString();
      $('combo').textContent = `×${Math.max(1, this.combo)}`;
      $('health').textContent = `${Math.round(clamp(this.health, 0, 140))}%`;
      $('healthFill').style.width = `${clamp(this.health / (100 + (this.tireLevel - 1) * 8), 0, 1) * 100}%`;
      $('chargeFill').style.width = `${this.charge * 100}%`; $('chargeNeedle').style.left = `${this.charge * 100}%`;
      $('qualityBadge').textContent = this.quality.toUpperCase();
      if (force && this.phase === 'release') {
        $('actionKicker').textContent = 'WHEEL RELEASED'; $('actionLabel').textContent = this.launchPower > 1.18 ? 'FULL POWER' : 'IMPACT RUN'; $('actionSub').textContent = 'TAP TO BANK AFTER THE HIT';
      }
    }

    loop(now) {
      const frameDt = clamp((now - this.last) / 1000, 0, .05); this.last = now;
      this.fpsEma = damp(this.fpsEma, frameDt > 0 ? 1 / frameDt : 60, 2.2, frameDt);
      if (this.fpsEma < 45) { this.lowFps += frameDt; this.highFps = 0; }
      else if (this.fpsEma > 57) { this.highFps += frameDt; this.lowFps = Math.max(0, this.lowFps - frameDt * 2); }
      else { this.lowFps = Math.max(0, this.lowFps - frameDt); this.highFps = 0; }
      if (this.lowFps > 1.7 && this.quality !== 'low') { this.quality = this.quality === 'high' ? 'balanced' : 'low'; this.lowFps = 0; this.resize(); }
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixed && steps < 6) { this.update(this.fixed); this.accumulator -= this.fixed; steps++; }
      this.draw(now / 1000);
      requestAnimationFrame((t) => this.loop(t));
    }

    draw(time) {
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);
      c.save();
      c.translate(this.w / 2 + this.cameraKickX, this.h / 2 + this.cameraKickY);
      c.scale(this.cameraZoom, this.cameraZoom);
      c.translate(-this.w / 2 + this.cameraX, -this.h / 2);
      this.drawWorld(c, time);
      if (['ready', 'charging', 'release'].includes(this.phase)) this.drawEngine(c, time);
      if (this.obstacle) this.drawObstacle(c, this.obstacle, time);
      this.drawSmoke(c);
      this.drawWheel(c, time);
      this.drawParticles(c);
      c.restore();
      if (this.contactFlash > .02) {
        const g = c.createRadialGradient(this.contactX, this.contactY, 0, this.contactX, this.contactY, this.wheelR * 1.15);
        g.addColorStop(0, `rgba(255,248,218,${this.contactFlash * .68})`); g.addColorStop(.18, `rgba(255,111,28,${this.contactFlash * .42})`); g.addColorStop(1, 'rgba(255,90,20,0)');
        c.fillStyle = g; c.fillRect(this.contactX - this.wheelR * 1.2, this.contactY - this.wheelR * 1.2, this.wheelR * 2.4, this.wheelR * 2.4);
      }
      if (this.flash > .02) { c.fillStyle = `rgba(255,239,202,${this.flash * .18})`; c.fillRect(0, 0, this.w, this.h); }
    }

    drawWorld(c, time) {
      const sky = c.createLinearGradient(0, 0, 0, this.roadY);
      sky.addColorStop(0, '#79d5ff'); sky.addColorStop(.5, '#f8d27b'); sky.addColorStop(1, '#ff985d');
      c.fillStyle = sky; c.fillRect(-100, -100, this.w + 200, this.h + 200);
      const sunX = this.w * .78, sunY = this.h * .18;
      const glow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, this.w * .28);
      glow.addColorStop(0, 'rgba(255,248,198,.72)'); glow.addColorStop(1, 'rgba(255,213,103,0)');
      c.fillStyle = glow; c.fillRect(0, 0, this.w, this.roadY);

      const far = (this.distance * .028) % 280;
      c.globalAlpha = .5;
      for (let x = -280 - far; x < this.w + 280; x += 280) {
        c.fillStyle = '#d65f55'; c.fillRect(x, this.roadY - 118, 172, 118);
        c.fillStyle = '#f0aa70'; c.fillRect(x + 14, this.roadY - 98, 144, 98);
        c.fillStyle = '#fff1c4'; for (let i = 0; i < 4; i++) c.fillRect(x + 24 + i * 30, this.roadY - 73, 17, 24);
        c.fillStyle = '#407f94'; for (let i = 0; i < 4; i += 2) c.fillRect(x + 24 + i * 30, this.roadY - 73, 17, 24);
        c.fillStyle = '#6c3030'; c.fillRect(x + 72, this.roadY - 45, 34, 45);
      }
      c.globalAlpha = 1;

      const palms = (this.distance * .065) % 225;
      for (let x = -225 - palms; x < this.w + 225; x += 225) {
        c.strokeStyle = '#5d3b21'; c.lineWidth = 8; c.beginPath(); c.moveTo(x + 85, this.roadY); c.quadraticCurveTo(x + 73, this.roadY - 78, x + 98, this.roadY - 138); c.stroke();
        for (let i = 0; i < 6; i++) { c.save(); c.translate(x + 98, this.roadY - 138); c.rotate(-1.2 + i * .48); c.fillStyle = '#327b47'; c.beginPath(); c.ellipse(25, 0, 34, 9, 0, 0, TAU); c.fill(); c.restore(); }
      }

      const poles = (this.distance * .12) % 190;
      c.globalAlpha = .7;
      for (let x = -190 - poles; x < this.w + 190; x += 190) {
        c.fillStyle = '#39444d'; c.fillRect(x + 20, this.roadY - 88, 5, 88);
        c.fillStyle = '#f5d08a'; c.shadowColor = '#ffd382'; c.shadowBlur = this.quality === 'high' ? 13 : 7; c.fillRect(x + 8, this.roadY - 91, 29, 4); c.shadowBlur = 0;
      }
      c.globalAlpha = 1;

      c.fillStyle = '#626c75'; c.fillRect(-100, this.roadY - 13, this.w + 200, this.h - this.roadY + 113);
      c.fillStyle = '#343c44'; c.fillRect(-100, this.roadY, this.w + 200, this.h - this.roadY + 100);
      c.fillStyle = '#f1c552'; c.fillRect(-100, this.roadY + 14, this.w + 200, 6);
      const stripe = (this.distance * 1.04) % 180;
      for (let x = -180 - stripe; x < this.w + 180; x += 180) { c.fillStyle = 'rgba(255,255,255,.54)'; c.fillRect(x, this.roadY + 62, 92, 8); }

      const speedRatio = clamp(this.speed / 1050, 0, 1);
      if (speedRatio > .4 && this.quality !== 'low') {
        c.save(); c.globalAlpha = .1 * speedRatio;
        for (let i = 0; i < (this.mobile ? 5 : 8); i++) {
          const y = this.h * (.2 + i * .07) + Math.sin(time * 2 + i) * 6;
          const x = ((time * -(340 + i * 37) + i * 173) % (this.w + 220)) + this.w;
          c.strokeStyle = '#fff2ce'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 65 - i * 5, y); c.lineTo(x, y); c.stroke();
        }
        c.restore();
      }
    }

    drawEngine(c, time) {
      const r = this.wheelR;
      const charge = this.phase === 'charging' ? this.charge : this.phase === 'release' ? 1 : 0;
      const retract = this.phase === 'release' ? easeInOutCubic(clamp((this.launchT - .08) / .76, 0, 1)) : 0;
      const x = this.wheelX - r * (this.mobile ? 1.7 : 1.9) - retract * r * .36;
      const y = this.roadY - r * .58;
      const vib = charge * (Math.sin(time * 49) * 1.2 + Math.sin(time * 79) * .5);
      c.save(); c.translate(x + vib, y);
      c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(0, r * .72, r * 1.32, r * .16, 0, 0, TAU); c.fill();
      const body = c.createLinearGradient(-r, -r * .55, r * .85, r * .55);
      body.addColorStop(0, '#101418'); body.addColorStop(.35, '#414950'); body.addColorStop(.62, '#171c21'); body.addColorStop(1, '#626970');
      c.fillStyle = body; this.roundRect(c, -r * 1.02, -r * .58, r * 1.62, r * 1.13, r * .15); c.fill();
      c.strokeStyle = '#777f86'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#ff6b18'; this.roundRect(c, -r * .78, -r * .19, r * .93, r * .25, r * .055); c.fill();
      c.fillStyle = '#fff'; c.font = `1000 ${Math.max(9, r * .115)}px system-ui`; c.fillText('TAKKAR DRIVE', -r * .7, -r * .015);

      const flyX = r * .68, flyY = .02 * r;
      c.save(); c.translate(flyX, flyY); c.rotate(time * (4 + charge * 28));
      c.fillStyle = '#1a2025'; c.strokeStyle = '#90979d'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r * .38, 0, TAU); c.fill(); c.stroke();
      for (let i = 0; i < 7; i++) { c.rotate(TAU / 7); c.fillStyle = i % 2 ? '#ff6b18' : '#555d64'; c.fillRect(r * .1, -r * .028, r * .27, r * .056); }
      c.restore();

      for (let i = 0; i < 5; i++) {
        const px = -r * .82 + i * r * .23;
        const piston = Math.sin(time * (15 + charge * 45) + i * 1.25) * r * .035 * charge;
        c.fillStyle = '#343b41'; this.roundRect(c, px, -r * .63 + piston, r * .14, r * .31, r * .035); c.fill();
        c.fillStyle = charge > .76 ? '#ff8b31' : '#747c83'; c.fillRect(px + r * .022, -r * .59 + piston, r * .096, r * .04);
      }

      const rollerX = r * 1.24 - retract * r * .72;
      c.strokeStyle = '#2b3238'; c.lineWidth = r * .09; c.beginPath(); c.moveTo(r * .88, -r * .22); c.lineTo(rollerX, -r * .22); c.stroke();
      c.strokeStyle = '#ff6b18'; c.lineWidth = r * .02; c.stroke();
      for (const yy of [-.32, .32]) {
        c.save(); c.translate(rollerX, r * yy); c.rotate(time * (6 + charge * 35));
        c.fillStyle = '#171c20'; c.strokeStyle = '#7d858c'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * .2, 0, TAU); c.fill(); c.stroke();
        c.strokeStyle = '#ff6b18'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r * .14, 0, TAU); c.stroke();
        c.restore();
      }
      if (charge > .68) {
        c.globalAlpha = (charge - .68) * 2.4;
        c.fillStyle = '#ff7420'; c.shadowColor = '#ff5b00'; c.shadowBlur = 16;
        c.beginPath(); c.moveTo(-r * 1.02, r * .17); c.lineTo(-r * (1.24 + rand(0, .18)), r * (.08 + rand(-.08, .08))); c.lineTo(-r * 1.02, r * .29); c.fill(); c.shadowBlur = 0; c.globalAlpha = 1;
      }
      c.restore();
    }

    drawWheel(c, time) {
      const r = this.wheelR;
      let x = this.wheelX, y = this.wheelY;
      if (this.phase === 'ready') y += Math.sin(time * 1.7) * 1.1;
      if (this.phase === 'charging') { x += Math.sin(time * 58) * this.charge * .8; y += Math.sin(time * 31) * this.charge * .55; }
      if (this.phase === 'release') {
        const p = easeOutCubic(clamp((this.launchT - .08) / .7, 0, 1));
        x = lerp(this.wheelX - r * .28, this.wheelX, p);
        y -= Math.sin(clamp((this.launchT - .12) / .66, 0, 1) * Math.PI) * r * .045;
      }
      const squash = clamp(this.wheelSquash, -.12, .42);
      const sx = 1 + squash * .23, sy = 1 - squash * .28;
      const wobble = this.health < 52 && this.speed > 100 ? Math.sin(this.wheelAngle * .58) * (1 - this.health / 52) * .045 : 0;
      const speedRatio = clamp(this.speed / 1050, 0, 1);
      c.save(); c.globalAlpha = .36; c.fillStyle = '#000'; c.beginPath(); c.ellipse(x + r * .04, this.roadY - 2, r * (.75 + squash * .18), r * .12, 0, 0, TAU); c.fill(); c.restore();
      if (speedRatio > .58 && this.quality !== 'low') {
        const ghosts = this.quality === 'high' ? 2 : 1;
        for (let i = ghosts; i >= 1; i--) { c.save(); c.globalAlpha = .025 * i * speedRatio; c.translate(x - i * (10 + speedRatio * 12), y); c.rotate(this.wheelAngle - i * .14 + wobble); c.scale(sx, sy); this.drawWheelCore(c, r, true); c.restore(); }
      }
      c.save(); c.translate(x, y); c.rotate(this.wheelAngle + this.wheelPitch + wobble); c.scale(sx, sy); this.drawWheelCore(c, r, false); c.restore();
    }

    drawWheelCore(c, r, ghost) {
      const tire = c.createRadialGradient(-r * .28, -r * .32, r * .08, 0, 0, r);
      tire.addColorStop(0, '#4a4e51'); tire.addColorStop(.3, '#191c1e'); tire.addColorStop(.73, '#030405'); tire.addColorStop(1, '#222527');
      c.fillStyle = tire; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.save();
      const treads = this.quality === 'low' ? 16 : 24;
      for (let i = 0; i < treads; i++) {
        c.rotate(TAU / treads); c.fillStyle = i % 2 ? '#292c2e' : '#1d2022'; this.roundRect(c, r * .76, -r * .06, r * .25, r * .12, r * .03); c.fill();
      }
      c.restore();
      c.fillStyle = '#090b0c'; c.beginPath(); c.arc(0, 0, r * .68, 0, TAU); c.fill();
      const rim = c.createRadialGradient(-r * .18, -r * .2, 0, 0, 0, r * .62);
      rim.addColorStop(0, '#d4d7d9'); rim.addColorStop(.22, '#656c72'); rim.addColorStop(.48, '#1c2024'); rim.addColorStop(.75, '#858b90'); rim.addColorStop(1, '#181b1f');
      c.fillStyle = rim; c.beginPath(); c.arc(0, 0, r * .61, 0, TAU); c.fill();
      c.strokeStyle = '#ff6b18'; c.lineWidth = Math.max(2, r * .025); c.beginPath(); c.arc(0, 0, r * .57, 0, TAU); c.stroke();
      c.fillStyle = '#252a2f'; c.beginPath(); c.arc(0, 0, r * .38, 0, TAU); c.fill();
      const spokes = 8;
      for (let i = 0; i < spokes; i++) {
        c.save(); c.rotate(i * TAU / spokes);
        const g = c.createLinearGradient(r * .08, 0, r * .54, 0); g.addColorStop(0, '#a7acb0'); g.addColorStop(.45, '#383e43'); g.addColorStop(1, '#858b90');
        c.fillStyle = g; c.beginPath(); c.moveTo(r * .1, -r * .07); c.lineTo(r * .52, -r * .11); c.lineTo(r * .55, -r * .02); c.lineTo(r * .16, r * .06); c.closePath(); c.fill(); c.restore();
      }
      c.fillStyle = '#101316'; c.beginPath(); c.arc(0, 0, r * .16, 0, TAU); c.fill();
      const hub = c.createRadialGradient(-r * .04, -r * .05, 0, 0, 0, r * .12); hub.addColorStop(0, '#e1e3e4'); hub.addColorStop(.42, '#6d7378'); hub.addColorStop(1, '#1c2023');
      c.fillStyle = hub; c.beginPath(); c.arc(0, 0, r * .12, 0, TAU); c.fill();
      if (!ghost && this.health < 75) {
        c.strokeStyle = this.health < 35 ? '#ff7430' : 'rgba(220,225,228,.52)'; c.lineWidth = Math.max(1, r * .014); c.lineCap = 'round';
        const count = Math.ceil((75 - this.health) / 10);
        for (let i = 0; i < count; i++) { const a = -.8 + i * .42; c.beginPath(); c.moveTo(Math.cos(a) * r * .77, Math.sin(a) * r * .77); c.lineTo(Math.cos(a + .12) * r * .64, Math.sin(a + .12) * r * .64); c.lineTo(Math.cos(a - .04) * r * .57, Math.sin(a - .04) * r * .57); c.stroke(); }
      }
    }

    drawObstacle(c, o) {
      const r = this.wheelR;
      c.save(); c.translate(o.x, o.y); c.rotate(o.rotation); c.globalAlpha = o.alpha;
      c.shadowColor = 'rgba(0,0,0,.34)'; c.shadowBlur = 14; c.shadowOffsetY = 9;
      if (o.id === 'tires') {
        for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
          const ox = (col - .5) * r * .58 + row * r * .08, oy = -r * (.42 + row * .55);
          c.fillStyle = '#171a1c'; c.beginPath(); c.ellipse(ox, oy, r * .36, r * .28, -.12, 0, TAU); c.fill();
          c.strokeStyle = '#34383b'; c.lineWidth = r * .08; c.stroke(); c.fillStyle = '#090a0b'; c.beginPath(); c.ellipse(ox, oy, r * .13, r * .1, -.12, 0, TAU); c.fill();
        }
      } else if (o.id === 'crates') {
        for (let i = 0; i < 3; i++) {
          const ox = (i % 2) * r * .62 - r * .54 + (i === 2 ? r * .31 : 0), oy = i === 2 ? -r * 1.05 : -r * .52;
          const wood = c.createLinearGradient(ox, oy - r * .45, ox + r * .58, oy); wood.addColorStop(0, '#c48243'); wood.addColorStop(1, '#75411f');
          c.fillStyle = wood; c.fillRect(ox, oy - r * .45, r * .58, r * .45); c.strokeStyle = '#4d2b18'; c.lineWidth = 2; c.strokeRect(ox, oy - r * .45, r * .58, r * .45);
          c.beginPath(); c.moveTo(ox, oy - r * .45); c.lineTo(ox + r * .58, oy); c.moveTo(ox + r * .58, oy - r * .45); c.lineTo(ox, oy); c.stroke();
        }
      } else if (o.id === 'cart') {
        c.fillStyle = '#d34837'; this.roundRect(c, -r * .74, -r * .78, r * 1.28, r * .56, r * .08); c.fill();
        c.fillStyle = '#f0b33c'; c.fillRect(-r * .63, -r * .68, r * 1.05, r * .09);
        c.fillStyle = '#2b3339'; c.fillRect(r * .42, -r * 1.05, r * .08, r * .83); c.fillRect(r * .42, -r * 1.05, r * .62, r * .07);
        for (const x of [-.47, .33]) { c.fillStyle = '#181b1e'; c.beginPath(); c.arc(r * x, -r * .12, r * .17, 0, TAU); c.fill(); c.fillStyle = '#8a9196'; c.beginPath(); c.arc(r * x, -r * .12, r * .07, 0, TAU); c.fill(); }
        for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#65a950' : '#df9234'; c.beginPath(); c.arc(-r * .54 + (i % 3) * r * .28, -r * .82 - Math.floor(i / 3) * r * .18, r * .11, 0, TAU); c.fill(); }
      } else if (o.id === 'bricks') {
        for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
          const bw = r * .36, bh = r * .25, ox = -r * .72 + col * bw + (row % 2 ? -bw * .5 : 0), oy = -bh * (row + 1);
          c.fillStyle = row % 2 ? '#a84f32' : '#bd6040'; c.fillRect(ox, oy, bw - 2, bh - 2); c.strokeStyle = 'rgba(255,210,170,.22)'; c.strokeRect(ox, oy, bw - 2, bh - 2);
        }
      } else if (o.id === 'gate') {
        c.save(); c.transform(1 - o.bend * .12, 0, -o.bend * .3, 1, 0, 0);
        c.fillStyle = '#30373d'; c.fillRect(-r * .72, -r * 1.52, r * .18, r * 1.52); c.fillRect(r * .55, -r * 1.52, r * .18, r * 1.52);
        c.strokeStyle = '#9aa1a6'; c.lineWidth = r * .055;
        for (let x = -.48; x <= .48; x += .24) { c.beginPath(); c.moveTo(r * x, -r * 1.42); c.lineTo(r * x, -r * .12); c.stroke(); }
        c.strokeStyle = '#ff7c24'; c.lineWidth = r * .09; c.beginPath(); c.moveTo(-r * .52, -r * .92); c.lineTo(r * .52, -r * .48); c.moveTo(-r * .52, -r * .48); c.lineTo(r * .52, -r * .92); c.stroke(); c.restore();
      } else if (o.id === 'tank') {
        const tank = c.createLinearGradient(-r * .65, 0, r * .65, 0); tank.addColorStop(0, '#1d7186'); tank.addColorStop(.42, '#72d7e8'); tank.addColorStop(.72, '#28899e'); tank.addColorStop(1, '#14576a');
        c.fillStyle = tank; c.beginPath(); c.ellipse(0, -r * .93, r * .64, r * .2, 0, Math.PI, 0); c.fillRect(-r * .64, -r * .93, r * 1.28, r * .92); c.beginPath(); c.ellipse(0, -r * .01, r * .64, r * .2, 0, 0, Math.PI); c.fill();
        c.strokeStyle = '#b6edf4'; c.lineWidth = 2; c.strokeRect(-r * .64, -r * .93, r * 1.28, r * .92); c.fillStyle = '#effcff'; c.font = `900 ${r * .16}px system-ui`; c.fillText('WATER', -r * .33, -r * .42);
      } else {
        c.save(); c.scale(1 - o.crush, 1 + o.crush * .18);
        c.fillStyle = '#f1a12d'; this.roundRect(c, -r * 1.15, -r * .92, r * 1.68, r * .78, r * .08); c.fill();
        c.fillStyle = '#d66b23'; this.roundRect(c, r * .34, -r * 1.2, r * .7, r * 1.06, r * .08); c.fill();
        c.fillStyle = '#cde8f2'; c.fillRect(r * .48, -r * 1.04, r * .42, r * .33); c.fillStyle = '#293239'; c.fillRect(-r * .96, -r * .72, r * 1.25, r * .08);
        for (const x of [-.72, .58]) { c.fillStyle = '#171a1d'; c.beginPath(); c.arc(r * x, -r * .1, r * .22, 0, TAU); c.fill(); c.fillStyle = '#8e959a'; c.beginPath(); c.arc(r * x, -r * .1, r * .09, 0, TAU); c.fill(); }
        c.fillStyle = '#fff4d7'; c.font = `1000 ${r * .15}px system-ui`; c.fillText('TAKKAR EXPRESS', -r * .78, -r * .41); c.restore();
      }
      c.restore();
    }

    drawSmoke(c) {
      c.save();
      for (const s of this.smoke) { const a = clamp(s.life / s.max, 0, 1); c.globalAlpha = a * .18; c.fillStyle = '#e7e7e2'; c.beginPath(); c.arc(s.x, s.y, s.size, 0, TAU); c.fill(); }
      c.restore();
    }

    drawParticles(c) {
      c.save();
      for (const p of this.particles) {
        const a = clamp(p.life / p.max, 0, 1); c.globalAlpha = a;
        if (p.type === 'spark') { c.strokeStyle = p.color; c.shadowColor = '#ff6b18'; c.shadowBlur = 7; c.lineWidth = p.size; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * .018, p.y - p.vy * .018); c.stroke(); }
        else { c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (p.type === 'water' ? .75 : 1), 0, TAU); c.fill(); }
      }
      c.shadowBlur = 0; c.globalAlpha = 1;
      for (const f of this.fragments) {
        c.save(); c.translate(f.x, f.y); c.rotate(f.rot); c.globalAlpha = clamp(f.life / 1.4, 0, 1);
        if (f.source === 'tires') { c.strokeStyle = '#202326'; c.lineWidth = Math.max(3, f.size * .35); c.beginPath(); c.arc(0, 0, f.size * .45, 0, TAU); c.stroke(); }
        else if (f.source === 'bricks') { c.fillStyle = '#a95436'; c.fillRect(-f.size * .55, -f.size * .3, f.size * 1.1, f.size * .6); }
        else if (f.source === 'tank') { c.fillStyle = '#61cfe3'; c.beginPath(); c.moveTo(-f.size * .4, -f.size * .45); c.lineTo(f.size * .55, -f.size * .18); c.lineTo(f.size * .2, f.size * .5); c.closePath(); c.fill(); }
        else if (f.material === 'wood') { c.fillStyle = '#955a2d'; c.fillRect(-f.size * .6, -f.size * .16, f.size * 1.2, f.size * .32); }
        else { c.fillStyle = '#737a80'; c.beginPath(); c.moveTo(-f.size * .55, -f.size * .3); c.lineTo(f.size * .55, -f.size * .18); c.lineTo(f.size * .3, f.size * .4); c.lineTo(-f.size * .42, f.size * .24); c.closePath(); c.fill(); }
        c.restore();
      }
      c.restore();
    }

    roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  }

  window.addEventListener('DOMContentLoaded', () => { window.__TAKKAR__ = new TakkarArcade(); });
})();
