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
  const easeOutBack = (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const TAU = Math.PI * 2;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

  class Sound {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.engine = null;
      this.enabled = true;
      this.noise = null;
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
      this.master.gain.value = this.enabled ? 0.68 : 0;
      const bass = this.ctx.createBiquadFilter();
      bass.type = 'lowshelf'; bass.frequency.value = 120; bass.gain.value = 5;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.knee.value = 18; comp.ratio.value = 5.5;
      comp.attack.value = 0.003; comp.release.value = 0.18;
      this.master.connect(bass).connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        brown = (brown + 0.02 * w) / 1.02;
        data[i] = clamp(w * 0.42 + brown * 2.4, -1, 1);
      }
    }
    setEnabled(v) {
      this.enabled = v;
      this.init();
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(v ? 0.68 : 0, this.ctx.currentTime, 0.025);
      if (!v) this.stopEngine();
    }
    voice({ freq = 100, end = freq, dur = .2, type = 'sine', gain = .1, delay = 0, filter = null, pan = 0 }) {
      if (!this.enabled) return;
      this.init(); if (!this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, gain), t + Math.min(.012, dur * .2));
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      let node = osc;
      if (filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = filter.type || 'lowpass';
        f.frequency.value = filter.freq || 900;
        f.Q.value = filter.q || .7;
        node.connect(f); node = f;
      }
      node.connect(g);
      if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(this.master); }
      else g.connect(this.master);
      osc.start(t); osc.stop(t + dur + .04);
    }
    burst({ dur = .2, gain = .12, freq = 900, type = 'lowpass', delay = 0, pan = 0 }) {
      if (!this.enabled) return;
      this.init(); if (!this.ctx || !this.noise) return;
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      src.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = .7;
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      src.connect(f).connect(g);
      if (p) { p.pan.value = pan; g.connect(p).connect(this.master); }
      else g.connect(this.master);
      src.start(t, Math.random()); src.stop(t + dur + .02);
    }
    startEngine() {
      if (!this.enabled) return;
      this.init(); if (!this.ctx || this.engine) return;
      const bus = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const distortion = this.ctx.createWaveShaper();
      filter.type = 'lowpass'; filter.frequency.value = 520;
      distortion.curve = Sound.curve(24); distortion.oversample = '2x';
      const a = this.ctx.createOscillator();
      const b = this.ctx.createOscillator();
      const c = this.ctx.createOscillator();
      a.type = 'sawtooth'; b.type = 'triangle'; c.type = 'square';
      a.frequency.value = 42; b.frequency.value = 63; c.frequency.value = 21;
      bus.gain.value = .0001;
      a.connect(filter); b.connect(filter); c.connect(filter);
      filter.connect(distortion).connect(bus).connect(this.master);
      a.start(); b.start(); c.start();
      bus.gain.exponentialRampToValueAtTime(.085, this.ctx.currentTime + .15);
      this.engine = { a, b, c, bus, filter };
    }
    updateEngine(power, speed = 0) {
      if (!this.engine || !this.ctx) return;
      const t = this.ctx.currentTime;
      const base = 42 + power * 145 + speed * .035;
      this.engine.a.frequency.setTargetAtTime(base, t, .025);
      this.engine.b.frequency.setTargetAtTime(base * 1.48, t, .03);
      this.engine.c.frequency.setTargetAtTime(base * .5, t, .035);
      this.engine.filter.frequency.setTargetAtTime(420 + power * 1250 + speed * .3, t, .045);
      this.engine.bus.gain.setTargetAtTime(.04 + power * .085, t, .035);
    }
    stopEngine() {
      if (!this.engine || !this.ctx) return;
      const e = this.engine;
      e.bus.gain.setTargetAtTime(.0001, this.ctx.currentTime, .04);
      setTimeout(() => { try { e.a.stop(); e.b.stop(); e.c.stop(); } catch {} }, 170);
      this.engine = null;
    }
    launch(perfect) {
      this.burst({ dur: .32, gain: .22, freq: 650 });
      this.voice({ freq: 46, end: 120, dur: .42, type: 'sawtooth', gain: .2 });
      this.voice({ freq: 29, end: 24, dur: .25, gain: .28 });
      this.voice({ freq: perfect ? 680 : 410, end: perfect ? 1100 : 620, dur: .16, gain: .07, type: 'triangle', delay: .06 });
    }
    impact(material, strength) {
      const low = material === 'metal' ? 62 : material === 'wood' ? 78 : 48;
      const high = material === 'metal' ? 1800 : material === 'glass' ? 2600 : 900;
      this.voice({ freq: low, end: 28, dur: .34, gain: .28 * strength, type: 'sine' });
      this.burst({ dur: .18 + strength * .06, gain: .22 * strength, freq: high, type: material === 'metal' ? 'bandpass' : 'lowpass' });
      if (material === 'metal') {
        this.voice({ freq: 410, end: 96, dur: .22, gain: .1, type: 'square', delay: .015, pan: -.25 });
        this.voice({ freq: 620, end: 180, dur: .18, gain: .07, type: 'triangle', delay: .035, pan: .3 });
      }
      if (material === 'glass') this.burst({ dur: .38, gain: .11, freq: 3100, type: 'highpass', delay: .02 });
    }
    coin() {
      [660, 880, 1180].forEach((f, i) => this.voice({ freq: f, end: f * 1.04, dur: .09, gain: .055, type: 'sine', delay: i * .045 }));
    }
    fail() {
      this.burst({ dur: .75, gain: .34, freq: 520 });
      this.voice({ freq: 96, end: 24, dur: .9, type: 'sawtooth', gain: .32 });
    }
    static curve(amount = 20) {
      const n = 1024, arr = new Float32Array(n), k = amount;
      for (let i = 0; i < n; i++) {
        const x = i * 2 / (n - 1) - 1;
        arr[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
      }
      return arr;
    }
  }

  const OBSTACLES = [
    { id: 'tires', name: 'TIRE STACK', material: 'rubber', hp: 42, reward: 45, scale: .88 },
    { id: 'crates', name: 'CARGO CRATES', material: 'wood', hp: 55, reward: 70, scale: .95 },
    { id: 'cart', name: 'STREET CART', material: 'metal', hp: 69, reward: 95, scale: 1.02 },
    { id: 'bricks', name: 'BRICK WALL', material: 'stone', hp: 86, reward: 130, scale: 1.05 },
    { id: 'gate', name: 'STEEL GATE', material: 'metal', hp: 108, reward: 175, scale: 1.08 },
    { id: 'tank', name: 'WATER TANK', material: 'glass', hp: 132, reward: 230, scale: 1.12 },
    { id: 'truck', name: 'DELIVERY TRUCK', material: 'metal', hp: 162, reward: 320, scale: 1.25 }
  ];

  class Game {
    constructor() {
      this.canvas = $('game');
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.sound = new Sound();
      this.tg = window.Telegram?.WebApp || null;
      this.phase = 'ready';
      this.charge = 0;
      this.chargeDir = 1;
      this.holdStarted = 0;
      this.speed = 0;
      this.targetSpeed = 0;
      this.distance = 0;
      this.score = 0;
      this.combo = 0;
      this.health = 100;
      this.coins = Number(localStorage.getItem('takkar.coins') || 0);
      this.best = Number(localStorage.getItem('takkar.best') || 0);
      this.engineLevel = Number(localStorage.getItem('takkar.engine') || 1);
      this.tireLevel = Number(localStorage.getItem('takkar.tire') || 1);
      this.impactIndex = 0;
      this.obstacle = null;
      this.particles = [];
      this.fragments = [];
      this.roadOffset = 0;
      this.wheelAngle = 0;
      this.wheelY = 0;
      this.wheelVy = 0;
      this.wheelSquash = 0;
      this.cameraX = 0;
      this.cameraZoom = 1;
      this.shake = 0;
      this.flash = 0;
      this.freeze = 0;
      this.waitUntil = 0;
      this.pendingFail = false;
      this.banked = false;
      this.accumulator = 0;
      this.last = performance.now();
      this.fixed = 1 / 120;
      this.quality = 'high';
      this.fpsEma = 60;
      this.lowFps = 0;
      this.isHolding = false;
      this.currentTheme = 0;
      this.cache = new Map();
      this.bind();
      this.resize();
      this.updateHud();
      this.showStart();
      requestAnimationFrame((t) => this.loop(t));
      this.tg?.ready?.(); this.tg?.expand?.();
    }

    bind() {
      const action = $('action');
      const startHold = (e) => {
        e?.preventDefault(); this.sound.init();
        if (this.phase === 'ready') {
          this.phase = 'charging'; this.isHolding = true; this.holdStarted = performance.now();
          this.charge = 0; this.chargeDir = 1; this.sound.startEngine();
          $('hero').classList.add('hidden');
          this.haptic('soft'); this.updateHud();
        } else if (['running', 'decision'].includes(this.phase)) {
          this.bankRun();
        } else if (this.phase === 'result') {
          this.reset();
        }
      };
      const endHold = (e) => {
        e?.preventDefault();
        if (this.phase === 'charging' && this.isHolding) {
          this.isHolding = false; this.launch();
        }
      };
      action.addEventListener('pointerdown', (e) => { try { action.setPointerCapture(e.pointerId); } catch {} startHold(e); });
      action.addEventListener('pointerup', endHold);
      action.addEventListener('pointercancel', endHold);
      action.addEventListener('lostpointercapture', endHold);
      window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) startHold(e); if (e.key.toLowerCase() === 'b') this.bankRun(); });
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') endHold(e); });
      $('sound').addEventListener('click', () => {
        this.sound.setEnabled(!this.sound.enabled);
        $('sound').textContent = this.sound.enabled ? 'SOUND ON' : 'SOUND OFF';
      });
      $('garage').addEventListener('click', () => this.openGarage());
      $('garageClose').addEventListener('click', () => $('garageSheet').classList.remove('open'));
      $('upgradeEngine').addEventListener('click', () => this.upgrade('engine'));
      $('upgradeTire').addEventListener('click', () => this.upgrade('tire'));
      $('share').addEventListener('click', async () => {
        const payload = { title: 'TAKKAR', text: `I scored ${this.score.toLocaleString()} in TAKKAR. Can you survive one more hit?`, url: location.href };
        try {
          if (navigator.share) await navigator.share(payload);
          else { await navigator.clipboard?.writeText(`${payload.text} ${payload.url}`); this.haptic('soft'); }
        } catch {}
      });
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.sound.stopEngine(); this.isHolding = false; }
        this.last = performance.now();
      });
    }

    haptic(type) {
      try { this.tg?.HapticFeedback?.impactOccurred(type); } catch {}
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.w = r.width; this.h = r.height;
      const mobile = this.w < 720;
      const maxDpr = this.quality === 'high' ? (mobile ? 1.25 : 1.5) : this.quality === 'balanced' ? 1.1 : 1;
      this.dpr = Math.min(devicePixelRatio || 1, maxDpr);
      this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.roadY = this.h * (mobile ? .72 : .74);
      this.wheelR = clamp(Math.min(this.h * .205, this.w * (mobile ? .19 : .09)), 58, 128);
      this.wheelX = this.w * (mobile ? .32 : .37);
      this.wheelBaseY = this.roadY - this.wheelR;
      this.wheelY = this.wheelY || this.wheelBaseY;
      this.cache.clear();
    }

    showStart() {
      $('heroTitle').innerHTML = 'SURVIVE<br><em>ONE MORE HIT.</em>';
      $('heroSub').textContent = 'Hold. Release in the orange zone. Break everything.';
      $('actionKicker').textContent = 'PRESS & HOLD';
      $('actionLabel').textContent = 'CHARGE THE ENGINE';
      $('actionSub').textContent = 'RELEASE IN THE PERFECT ZONE';
    }

    launch() {
      const perfect = this.charge >= .78 && this.charge <= .94;
      const power = .72 + this.charge * .48 + (perfect ? .15 : 0) + (this.engineLevel - 1) * .045;
      this.phase = 'launch';
      this.speed = 0;
      this.targetSpeed = 780 * power;
      this.launchPower = power;
      this.perfect = perfect;
      this.health = 100 + (this.tireLevel - 1) * 8;
      this.score = 0; this.combo = 0; this.distance = 0; this.impactIndex = 0;
      this.obstacle = null; this.waitUntil = .65; this.banked = false;
      this.sound.launch(perfect); this.haptic('heavy');
      $('perfect').classList.toggle('show', perfect);
      setTimeout(() => $('perfect').classList.remove('show'), 750);
      this.updateHud();
    }

    spawnObstacle() {
      const base = OBSTACLES[Math.min(OBSTACLES.length - 1, this.impactIndex)];
      const repeatBoost = Math.max(0, this.impactIndex - OBSTACLES.length + 1) * .1;
      this.obstacle = {
        ...base,
        hp: base.hp * (1 + repeatBoost),
        x: this.w + this.wheelR * 1.8,
        y: this.roadY,
        hit: false,
        break: 0,
        rotation: 0,
        vx: 0,
        vy: 0,
        approach: 0
      };
      $('nextName').textContent = base.name;
      $('nextCard').classList.add('show');
    }

    bankRun() {
      if (!['running', 'decision'].includes(this.phase)) return;
      this.banked = true;
      const earned = Math.max(1, Math.round(this.score / 20));
      this.coins += earned;
      this.best = Math.max(this.best, this.score);
      localStorage.setItem('takkar.coins', String(this.coins));
      localStorage.setItem('takkar.best', String(this.best));
      this.sound.coin();
      this.finish(false, earned);
    }

    failRun() {
      this.sound.fail(); this.haptic('heavy');
      this.best = Math.max(this.best, this.score);
      localStorage.setItem('takkar.best', String(this.best));
      this.finish(true, 0);
    }

    finish(failed, earned) {
      this.phase = 'result'; this.targetSpeed = 0; this.sound.stopEngine();
      $('nextCard').classList.remove('show');
      $('decision').classList.remove('show');
      $('result').classList.add('show');
      $('resultKicker').textContent = failed ? 'WHEEL DESTROYED' : 'RUN BANKED';
      $('resultTitle').textContent = failed ? 'TOO MUCH TAKKAR' : `${this.score.toLocaleString()} SCORE`;
      $('resultSub').textContent = failed ? `Best ${this.best.toLocaleString()} · Upgrade and hit again` : `+${earned} coins · Best ${this.best.toLocaleString()}`;
      $('actionKicker').textContent = 'ONE MORE RUN';
      $('actionLabel').textContent = 'PLAY AGAIN';
      $('actionSub').textContent = 'EK AUR TAKKAR?';
      this.updateHud();
    }

    reset() {
      this.phase = 'ready'; this.charge = 0; this.speed = 0; this.targetSpeed = 0;
      this.distance = 0; this.score = 0; this.combo = 0; this.health = 100;
      this.obstacle = null; this.particles.length = 0; this.fragments.length = 0;
      $('result').classList.remove('show'); $('decision').classList.remove('show');
      $('hero').classList.remove('hidden'); this.showStart(); this.updateHud();
    }

    openGarage() {
      $('garageCoins').textContent = this.coins.toLocaleString();
      $('engineLevel').textContent = `LV.${this.engineLevel}`;
      $('tireLevel').textContent = `LV.${this.tireLevel}`;
      $('engineCost').textContent = this.cost('engine').toLocaleString();
      $('tireCost').textContent = this.cost('tire').toLocaleString();
      $('garageSheet').classList.add('open');
    }

    cost(type) {
      const level = type === 'engine' ? this.engineLevel : this.tireLevel;
      return Math.round(120 * Math.pow(1.65, level - 1));
    }

    upgrade(type) {
      const cost = this.cost(type);
      if (this.coins < cost) { this.haptic('rigid'); return; }
      this.coins -= cost;
      if (type === 'engine') this.engineLevel++;
      else this.tireLevel++;
      localStorage.setItem('takkar.coins', String(this.coins));
      localStorage.setItem(`takkar.${type}`, String(type === 'engine' ? this.engineLevel : this.tireLevel));
      this.sound.coin(); this.openGarage(); this.updateHud();
    }

    impact() {
      const o = this.obstacle;
      if (!o || o.hit) return;
      o.hit = true;
      const kinetic = this.speed * this.launchPower * (1 + this.combo * .035);
      const threshold = o.hp * 8.4;
      const ratio = kinetic / threshold;
      const success = ratio > .82 || (ratio > .67 && Math.random() < .58);
      const damage = success ? clamp((o.hp / Math.max(kinetic, 1)) * 38, 7, 28) : clamp(42 + o.hp * .12, 45, 95);
      this.health -= damage;
      this.pendingFail = !success || this.health <= 0;
      this.freeze = .085;
      this.shake = 1;
      this.flash = .78;
      this.wheelSquash = .34;
      this.speed *= success ? .72 : .25;
      o.break = success ? 1 : .34;
      o.vx = success ? this.speed * .48 : this.speed * .15;
      o.vy = success ? -this.wheelR * 1.8 : -this.wheelR * .45;
      this.emitImpact(o, success ? 1 : 1.5);
      this.sound.impact(o.material, success ? 1 : 1.35);
      this.haptic(success ? 'rigid' : 'heavy');
      if (success) {
        this.combo++;
        const add = Math.round(o.reward * (1 + this.combo * .18));
        this.score += add;
        this.waitUntil = .72;
        $('decisionScore').textContent = this.score.toLocaleString();
        $('decision').classList.add('show');
        $('actionKicker').textContent = 'SAFE NOW';
        $('actionLabel').textContent = 'BANK SCORE';
        $('actionSub').textContent = 'OR WAIT FOR ONE MORE TAKKAR';
      }
      this.updateHud();
    }

    continueAfterImpact() {
      if (this.pendingFail) { this.failRun(); return; }
      this.impactIndex++;
      this.phase = 'running';
      this.targetSpeed = 720 + Math.min(this.impactIndex, 7) * 48 + (this.engineLevel - 1) * 28;
      this.obstacle = null;
      $('decision').classList.remove('show');
      $('nextCard').classList.remove('show');
      $('actionKicker').textContent = 'CURRENT RUN';
      $('actionLabel').textContent = 'BANK SCORE';
      $('actionSub').textContent = 'OR TRUST THE WHEEL';
      this.waitUntil = .52;
    }

    emitImpact(o, scale) {
      const max = this.quality === 'high' ? 58 : this.quality === 'balanced' ? 36 : 22;
      const contactX = this.wheelX + this.wheelR * .84;
      const contactY = this.roadY - this.wheelR * .22;
      for (let i = 0; i < max; i++) {
        const spark = o.material === 'metal' && i < max * .5;
        this.particles.push({
          x: contactX + rand(-8, 8), y: contactY + rand(-10, 10),
          vx: rand(-240, 540) * scale, vy: rand(-520, -45) * scale,
          life: rand(.28, .85), max: 1, size: spark ? rand(1, 3) : rand(3, 8),
          color: spark ? '#ffd178' : o.material === 'wood' ? '#a96734' : o.material === 'glass' ? '#7eeaff' : '#827665',
          gravity: spark ? 840 : 590, line: spark
        });
      }
      const pieces = this.quality === 'low' ? 7 : 13;
      for (let i = 0; i < pieces; i++) {
        this.fragments.push({
          type: o.id, x: o.x + rand(-25, 25), y: o.y - rand(10, this.wheelR),
          vx: rand(120, 520), vy: rand(-520, -80), life: rand(.9, 1.8),
          rot: rand(0, TAU), vr: rand(-9, 9), size: rand(6, 18), color: o.material
        });
      }
    }

    update(dt) {
      if (this.freeze > 0) {
        this.freeze -= dt;
        if (this.freeze <= 0) this.phase = 'decision';
        return;
      }

      this.shake *= Math.exp(-16 * dt);
      this.flash *= Math.exp(-19 * dt);
      this.wheelSquash *= Math.exp(-15 * dt);

      if (this.phase === 'charging') {
        this.charge += dt * .78 * this.chargeDir;
        if (this.charge >= 1) { this.charge = 1; this.chargeDir = -1; }
        if (this.charge <= .36 && this.chargeDir < 0) { this.charge = .36; this.chargeDir = 1; }
        this.sound.updateEngine(this.charge, 0);
        $('chargeFill').style.width = `${this.charge * 100}%`;
        $('chargeNeedle').style.left = `${this.charge * 100}%`;
        $('actionKicker').textContent = this.charge >= .78 && this.charge <= .94 ? 'PERFECT ZONE' : 'BUILDING POWER';
        $('actionLabel').textContent = this.charge >= .78 && this.charge <= .94 ? 'RELEASE NOW' : 'KEEP HOLDING';
        $('actionSub').textContent = `${Math.round(this.charge * 100)}% ENGINE POWER`;
      }

      if (this.phase === 'launch') {
        this.speed = damp(this.speed, this.targetSpeed, 5.8, dt);
        this.waitUntil -= dt;
        if (this.waitUntil <= 0) { this.phase = 'running'; this.sound.updateEngine(1, this.speed); this.spawnObstacle(); }
      }

      if (['launch', 'running', 'decision'].includes(this.phase)) {
        this.speed = damp(this.speed, this.targetSpeed, this.phase === 'launch' ? 5.2 : 2.5, dt);
        this.distance += this.speed * dt;
        this.roadOffset = (this.roadOffset + this.speed * dt) % 180;
        this.wheelAngle += (this.speed / Math.max(30, this.wheelR)) * dt;
        this.sound.updateEngine(clamp(this.speed / 1000, .2, 1), this.speed);
        const roadWave = Math.sin(this.distance * .021) * .9 + Math.sin(this.distance * .047 + 1.4) * .35;
        const targetY = this.wheelBaseY + roadWave * this.wheelR * .018 * clamp(this.speed / 800, 0, 1);
        const spring = (targetY - this.wheelY) * 72 - this.wheelVy * 14;
        this.wheelVy += spring * dt;
        this.wheelY += this.wheelVy * dt;
      }

      if (this.phase === 'running') {
        if (!this.obstacle) {
          this.waitUntil -= dt;
          if (this.waitUntil <= 0) this.spawnObstacle();
        }
        if (this.obstacle && !this.obstacle.hit) {
          this.obstacle.x -= this.speed * dt;
          const contact = this.obstacle.x - this.wheelR * .58;
          const wheelFront = this.wheelX + this.wheelR * .91;
          const remaining = contact - wheelFront;
          this.obstacle.approach = 1 - clamp(remaining / (this.w * .72), 0, 1);
          $('nextProgress').style.width = `${this.obstacle.approach * 100}%`;
          this.cameraZoom = damp(this.cameraZoom, remaining < this.wheelR * 2.7 ? 1.035 : 1, 5, dt);
          if (remaining <= 0) this.impact();
        }
      }

      if (this.phase === 'decision') {
        this.waitUntil -= dt;
        if (this.waitUntil <= 0) this.continueAfterImpact();
      }

      if (this.obstacle?.hit) {
        this.obstacle.x += this.obstacle.vx * dt;
        this.obstacle.y += this.obstacle.vy * dt;
        this.obstacle.vy += 760 * dt;
        this.obstacle.vx *= Math.exp(-2.6 * dt);
        this.obstacle.rotation += dt * 2.7;
      }

      for (const p of this.particles) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gravity * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0).slice(-90);
      for (const f of this.fragments) {
        f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 760 * dt; f.rot += f.vr * dt;
        if (f.y > this.roadY + 18) { f.y = this.roadY + 18; f.vy *= -.28; f.vx *= .75; }
      }
      this.fragments = this.fragments.filter((f) => f.life > 0).slice(-45);
    }

    loop(now) {
      const frameDt = clamp((now - this.last) / 1000, 0, .05);
      this.last = now;
      this.fpsEma = damp(this.fpsEma, frameDt > 0 ? 1 / frameDt : 60, 2.4, frameDt);
      if (this.fpsEma < 44) this.lowFps += frameDt; else this.lowFps = Math.max(0, this.lowFps - frameDt * 1.5);
      if (this.lowFps > 1.5 && this.quality !== 'low') {
        this.quality = this.quality === 'high' ? 'balanced' : 'low'; this.lowFps = 0; this.resize();
      }
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixed && steps < 5) {
        this.update(this.fixed); this.accumulator -= this.fixed; steps++;
      }
      this.draw(now / 1000);
      requestAnimationFrame((t) => this.loop(t));
    }

    draw(time) {
      const c = this.ctx;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);
      const sx = Math.sin(time * 31.7) * this.shake * 7 + Math.sin(time * 57.3) * this.shake * 2.5;
      const sy = Math.sin(time * 37.2 + 1.3) * this.shake * 4;
      c.save();
      c.translate(this.w / 2 + sx, this.h / 2 + sy);
      c.scale(this.cameraZoom, this.cameraZoom);
      c.translate(-this.w / 2 + this.cameraX, -this.h / 2);
      this.drawWorld(c, time);
      if (this.phase === 'ready' || this.phase === 'charging' || this.phase === 'launch') this.drawEngine(c, time);
      if (this.obstacle) this.drawObstacle(c, this.obstacle);
      this.drawWheel(c, time);
      this.drawParticles(c);
      c.restore();
      if (this.flash > .02) {
        c.fillStyle = `rgba(255,244,207,${this.flash * .34})`; c.fillRect(0, 0, this.w, this.h);
      }
    }

    drawWorld(c, time) {
      const sky = c.createLinearGradient(0, 0, 0, this.roadY);
      sky.addColorStop(0, '#82d8ff'); sky.addColorStop(.5, '#f7cf79'); sky.addColorStop(1, '#ff9156');
      c.fillStyle = sky; c.fillRect(-100, -100, this.w + 200, this.h + 200);
      const sunX = this.w * .78, sunY = this.h * .2;
      const glow = c.createRadialGradient(sunX, sunY, 0, sunX, sunY, this.w * .28);
      glow.addColorStop(0, 'rgba(255,245,194,.75)'); glow.addColorStop(1, 'rgba(255,212,99,0)');
      c.fillStyle = glow; c.fillRect(0, 0, this.w, this.roadY);

      const far = (this.distance * .035) % 240;
      c.globalAlpha = .55;
      for (let x = -240 - far; x < this.w + 240; x += 240) {
        c.fillStyle = '#d96356'; c.fillRect(x, this.roadY - 112, 150, 112);
        c.fillStyle = '#f1a96b'; c.fillRect(x + 14, this.roadY - 94, 122, 94);
        for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#2f6f86' : '#fff3c4'; c.fillRect(x + 24 + i * 26, this.roadY - 72, 14, 22); }
        c.fillStyle = '#5f2a2d'; c.fillRect(x + 64, this.roadY - 42, 30, 42);
      }
      c.globalAlpha = 1;
      const palms = (this.distance * .075) % 210;
      for (let x = -210 - palms; x < this.w + 210; x += 210) {
        c.strokeStyle = '#5b3a20'; c.lineWidth = 8; c.beginPath(); c.moveTo(x + 80, this.roadY); c.quadraticCurveTo(x + 70, this.roadY - 75, x + 94, this.roadY - 132); c.stroke();
        for (let i = 0; i < 6; i++) { c.save(); c.translate(x + 94, this.roadY - 132); c.rotate(-1.2 + i * .48); c.fillStyle = '#317a45'; c.beginPath(); c.ellipse(25, 0, 33, 9, 0, 0, TAU); c.fill(); c.restore(); }
      }
      c.fillStyle = '#5f6770'; c.fillRect(-100, this.roadY - 12, this.w + 200, this.h - this.roadY + 112);
      c.fillStyle = '#343b42'; c.fillRect(-100, this.roadY, this.w + 200, this.h - this.roadY + 100);
      c.fillStyle = '#f1c24e'; c.fillRect(-100, this.roadY + 13, this.w + 200, 6);
      const stripe = this.roadOffset % 170;
      for (let x = -170 - stripe; x < this.w + 170; x += 170) {
        c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(x, this.roadY + 62, 88, 8);
      }
      const dust = clamp(this.speed / 900, 0, 1);
      if (dust > .25) {
        c.globalAlpha = .12 * dust;
        for (let i = 0; i < 6; i++) { c.fillStyle = '#f3cf95'; c.beginPath(); c.arc(this.wheelX - this.wheelR - i * 35 - ((time * 70) % 35), this.roadY - 3 + Math.sin(i) * 6, 20 + i * 4, 0, TAU); c.fill(); }
        c.globalAlpha = 1;
      }
    }

    drawEngine(c, time) {
      const r = this.wheelR;
      const x = this.wheelX - r * 1.75;
      const y = this.roadY - r * .55;
      const power = this.phase === 'charging' ? this.charge : this.phase === 'launch' ? 1 : 0;
      const retract = this.phase === 'launch' ? clamp((this.speed / Math.max(this.targetSpeed, 1)), 0, 1) : 0;
      const vib = power * (Math.sin(time * 51) * 1.8 + Math.sin(time * 83) * .7);
      c.save(); c.translate(x - retract * r * .35 + vib, y);
      c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(0, r * .7, r * 1.25, r * .16, 0, 0, TAU); c.fill();
      c.fillStyle = '#22282d'; this.roundRect(c, -r * .95, -r * .52, r * 1.45, r * 1.05, r * .15); c.fill();
      const body = c.createLinearGradient(-r, -r*.5, r*.7, r*.5);
      body.addColorStop(0, '#161a1e'); body.addColorStop(.48, '#5d646b'); body.addColorStop(1, '#111419');
      c.fillStyle = body; this.roundRect(c, -r * .84, -r * .42, r * 1.22, r * .82, r * .12); c.fill();
      c.fillStyle = '#ff6b18'; this.roundRect(c, -r * .65, -r * .2, r * .82, r * .24, r * .06); c.fill();
      c.fillStyle = '#fff'; c.font = `900 ${Math.max(10, r*.13)}px system-ui`; c.fillText('TAKKAR', -r * .58, -r * .03);
      c.save(); c.translate(r * .53, 0); c.rotate(time * (3 + power * 28));
      c.fillStyle = '#2a3035'; c.strokeStyle = '#9ba2a8'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, r * .36, 0, TAU); c.fill(); c.stroke();
      for (let i = 0; i < 6; i++) { c.rotate(TAU / 6); c.fillStyle = i % 2 ? '#ff6b18' : '#555d64'; c.fillRect(r * .1, -r * .025, r * .25, r * .05); }
      c.restore();
      for (let i = 0; i < 4; i++) {
        const px = -r * .68 + i * r * .24;
        const piston = Math.sin(time * (12 + power * 42) + i * 1.7) * r * .045 * power;
        c.fillStyle = '#343b41'; this.roundRect(c, px, -r * .54 + piston, r * .15, r * .32, r * .04); c.fill();
        c.fillStyle = power > .78 ? '#ff8a2f' : '#687078'; c.fillRect(px + r * .025, -r * .5 + piston, r * .1, r * .04);
      }
      c.strokeStyle = '#2d3339'; c.lineWidth = r * .09; c.beginPath(); c.moveTo(r * .78, -r * .2); c.lineTo(r * 1.25 - retract * r * .6, -r * .2); c.stroke();
      c.strokeStyle = '#ff6b18'; c.lineWidth = r * .022; c.stroke();
      for (const yy of [-.34, .32]) {
        c.save(); c.translate(r * 1.25 - retract * r * .6, r * yy); c.rotate(time * (6 + power * 34));
        c.fillStyle = '#191d21'; c.strokeStyle = '#a6adb3'; c.lineWidth = 2; c.beginPath(); c.arc(0,0,r*.17,0,TAU); c.fill(); c.stroke();
        c.restore();
      }
      if (power > .6) {
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = (power - .6) * .7;
        c.fillStyle = '#ff7a20'; c.beginPath(); c.ellipse(-r * .98, r * .18, r * .42 * power, r * .12, 0, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawWheel(c) {
      const r = this.wheelR;
      const squash = this.wheelSquash;
      const sx = 1 + squash * .2, sy = 1 - squash * .25;
      const x = this.wheelX, y = this.wheelY;
      c.save(); c.globalAlpha = .28; c.fillStyle = '#000'; c.beginPath(); c.ellipse(x, this.roadY + 3, r * .78, r * .15, 0, 0, TAU); c.fill(); c.restore();
      c.save(); c.translate(x, y); c.rotate(this.wheelAngle); c.scale(sx, sy);
      const tire = c.createRadialGradient(-r*.28,-r*.3,r*.08,0,0,r);
      tire.addColorStop(0,'#52585b'); tire.addColorStop(.28,'#1c2023'); tire.addColorStop(.68,'#050607'); tire.addColorStop(1,'#25292c');
      c.fillStyle=tire; c.beginPath(); c.arc(0,0,r,0,TAU); c.fill();
      const tread = this.quality === 'low' ? 14 : 22;
      for(let i=0;i<tread;i++){
        c.save(); c.rotate(i*TAU/tread); c.fillStyle=i%2?'#34383b':'#202326'; this.roundRect(c,r*.77,-r*.06,r*.25,r*.12,r*.03); c.fill(); c.restore();
      }
      c.fillStyle='#0d0f11'; c.beginPath(); c.arc(0,0,r*.67,0,TAU); c.fill();
      const rim=c.createRadialGradient(-r*.2,-r*.2,0,0,0,r*.62); rim.addColorStop(0,'#f1f2f2'); rim.addColorStop(.22,'#737b81'); rim.addColorStop(.55,'#1a1e22'); rim.addColorStop(1,'#8b9297');
      c.fillStyle=rim; c.beginPath(); c.arc(0,0,r*.61,0,TAU); c.fill();
      c.strokeStyle='#ff6b18'; c.lineWidth=Math.max(4,r*.045); c.beginPath(); c.arc(0,0,r*.49,0,TAU); c.stroke();
      for(let i=0;i<8;i++){
        c.save(); c.rotate(i*TAU/8); const g=c.createLinearGradient(r*.1,0,r*.55,0); g.addColorStop(0,'#f3f4f4'); g.addColorStop(.5,'#60686e'); g.addColorStop(1,'#252a2f'); c.fillStyle=g;
        c.beginPath(); c.moveTo(r*.1,-r*.06); c.lineTo(r*.52,-r*.13); c.lineTo(r*.57,-r*.02); c.lineTo(r*.16,r*.055); c.closePath(); c.fill(); c.restore();
      }
      c.fillStyle='#1d2226'; c.beginPath(); c.arc(0,0,r*.18,0,TAU); c.fill();
      c.fillStyle='#ff6b18'; c.beginPath(); c.arc(0,0,r*.09,0,TAU); c.fill();
      c.restore();
      if (this.health < 55) {
        c.strokeStyle=`rgba(255,92,22,${.3 + (55-this.health)/90})`; c.lineWidth=3; c.beginPath(); c.arc(x,y,r*1.03,-.6,.2); c.stroke();
      }
    }

    drawObstacle(c, o) {
      const r = this.wheelR * o.scale;
      c.save(); c.translate(o.x, o.y); c.rotate(o.rotation);
      c.shadowColor='rgba(0,0,0,.28)'; c.shadowBlur=14; c.shadowOffsetY=10;
      if (o.id === 'tires') {
        for (let row=0;row<3;row++) for(let col=0;col<2;col++){
          const xx=(col-.5)*r*.62 + (row%2?r*.13:0), yy=-r*.3-row*r*.48;
          c.fillStyle='#16191b'; c.beginPath(); c.arc(xx,yy,r*.28,0,TAU); c.fill(); c.fillStyle='#444a4e'; c.beginPath(); c.arc(xx,yy,r*.12,0,TAU); c.fill();
        }
      } else if (o.id === 'crates') {
        for (let row=0;row<2;row++) for(let col=0;col<2;col++){
          const xx=(col-.5)*r*.72, yy=-r*.35-row*r*.7; c.fillStyle='#b66f32'; c.fillRect(xx-r*.34,yy-r*.34,r*.68,r*.68); c.strokeStyle='#713c19'; c.lineWidth=4; c.strokeRect(xx-r*.34,yy-r*.34,r*.68,r*.68); c.beginPath(); c.moveTo(xx-r*.3,yy-r*.3); c.lineTo(xx+r*.3,yy+r*.3); c.moveTo(xx+r*.3,yy-r*.3); c.lineTo(xx-r*.3,yy+r*.3); c.stroke();
        }
      } else if (o.id === 'cart') {
        c.fillStyle='#d5362f'; this.roundRect(c,-r*.7,-r*.78,r*1.35,r*.62,r*.09); c.fill();
        c.fillStyle='#f2c35a'; c.fillRect(-r*.62,-r*.7,r*1.18,r*.12);
        c.fillStyle='#3c444a'; c.fillRect(-r*.82,-r*.2,r*1.62,r*.12);
        for(const x of [-.5,.48]){c.fillStyle='#15181a'; c.beginPath(); c.arc(r*x,0,r*.2,0,TAU); c.fill(); c.fillStyle='#889097'; c.beginPath(); c.arc(r*x,0,r*.08,0,TAU); c.fill();}
      } else if (o.id === 'bricks') {
        for(let row=0;row<4;row++) for(let col=0;col<4;col++){
          const bw=r*.43,bh=r*.28,xx=(col-1.5)*bw+(row%2?bw*.5:0),yy=-bh*.55-row*bh;
          c.fillStyle=row%2?'#a54831':'#bf5838'; c.fillRect(xx-bw*.48,yy-bh*.46,bw*.96,bh*.92); c.strokeStyle='#e19b72'; c.lineWidth=1.5; c.strokeRect(xx-bw*.48,yy-bh*.46,bw*.96,bh*.92);
        }
      } else if (o.id === 'gate') {
        c.fillStyle='#333a40'; c.fillRect(-r*.78,-r*1.35,r*.16,r*1.35); c.fillRect(r*.62,-r*1.35,r*.16,r*1.35);
        c.strokeStyle='#778087'; c.lineWidth=r*.08; for(let x=-.55;x<=.55;x+=.22){c.beginPath();c.moveTo(r*x,-r*1.24);c.lineTo(r*x,0);c.stroke();}
        c.strokeStyle='#ff6b18'; c.lineWidth=r*.06; c.beginPath(); c.moveTo(-r*.6,-r*.98); c.lineTo(r*.6,-r*.28); c.moveTo(-r*.6,-r*.28); c.lineTo(r*.6,-r*.98); c.stroke();
      } else if (o.id === 'tank') {
        const tank=c.createLinearGradient(-r*.5,0,r*.5,0); tank.addColorStop(0,'#2d95aa'); tank.addColorStop(.5,'#93ebef'); tank.addColorStop(1,'#246e82');
        c.fillStyle=tank; c.beginPath(); c.ellipse(0,-r*.72,r*.62,r*.85,0,0,TAU); c.fill(); c.fillStyle='rgba(255,255,255,.4)'; c.beginPath(); c.ellipse(-r*.2,-r*.92,r*.12,r*.5,-.15,0,TAU); c.fill();
        c.fillStyle='#363d42'; c.fillRect(-r*.12,-r*1.7,r*.24,r*.18); c.fillRect(-r*.48,-r*.08,r*.12,r*.12); c.fillRect(r*.36,-r*.08,r*.12,r*.12);
      } else {
        c.fillStyle='#e84d32'; this.roundRect(c,-r*.95,-r*1.08,r*1.55,r*.9,r*.14); c.fill();
        c.fillStyle='#f5b14f'; this.roundRect(c,-r*.62,-r*.92,r*.58,r*.38,r*.05); c.fill();
        c.fillStyle='#2d4b58'; c.fillRect(-r*.56,-r*.86,r*.46,r*.26);
        c.fillStyle='#f2f2e9'; c.fillRect(r*.02,-r*.9,r*.48,r*.35);
        for(const x of [-.62,.38]){c.fillStyle='#151719'; c.beginPath(); c.arc(r*x,-r*.12,r*.24,0,TAU); c.fill(); c.fillStyle='#737b80'; c.beginPath(); c.arc(r*x,-r*.12,r*.1,0,TAU); c.fill();}
      }
      c.restore();
    }

    drawParticles(c) {
      for (const p of this.particles) {
        const a = clamp(p.life / p.max, 0, 1); c.globalAlpha = a;
        if (p.line) { c.strokeStyle=p.color; c.lineWidth=p.size; c.beginPath(); c.moveTo(p.x,p.y); c.lineTo(p.x-p.vx*.018,p.y-p.vy*.018); c.stroke(); }
        else { c.fillStyle=p.color; c.beginPath(); c.arc(p.x,p.y,p.size,0,TAU); c.fill(); }
      }
      for (const f of this.fragments) {
        c.save(); c.globalAlpha=clamp(f.life,0,1); c.translate(f.x,f.y); c.rotate(f.rot);
        c.fillStyle=f.color==='metal'?'#69737a':f.color==='wood'?'#a15e2c':f.color==='glass'?'#6adbe4':'#814d38';
        c.fillRect(-f.size*.5,-f.size*.3,f.size,f.size*.6); c.restore();
      }
      c.globalAlpha=1;
    }

    roundRect(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

    updateHud() {
      $('score').textContent = this.score.toLocaleString();
      $('best').textContent = this.best.toLocaleString();
      $('coins').textContent = this.coins.toLocaleString();
      $('combo').textContent = `x${Math.max(1, this.combo)}`;
      $('healthFill').style.width = `${clamp(this.health, 0, 100)}%`;
      $('health').textContent = `${Math.max(0, Math.round(this.health))}%`;
      if (this.phase === 'ready') $('chargeFill').style.width = '0%';
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    window.__TAKKAR_ARCADE__ = new Game();
  });
})();
