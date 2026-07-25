(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const ui = {
    boot: $('boot'), app: $('app'), bootBar: $('bootBar'), bootText: $('bootText'),
    phase: $('phaseLabel'), multiplier: $('multiplierLabel'), balance: $('balanceLabel'),
    status: $('statusText'), statusDot: $('statusDot'), intro: $('introCopy'), threat: $('nextThreat'),
    threatName: $('threatName'), threatProgress: $('threatProgress'), nextMultiplier: $('nextMultiplier'),
    survival: $('survivalCard'), survivalMultiplier: $('survivalMultiplier'), survivalHint: $('survivalHint'),
    overdrive: $('overdriveCard'), result: $('resultCard'), resultKicker: $('resultKicker'),
    resultTitle: $('resultTitle'), resultValue: $('resultValue'), again: $('againButton'),
    action: $('actionButton'), actionFill: $('actionFill'), actionKicker: $('actionKicker'),
    actionLabel: $('actionLabel'), actionSub: $('actionSub'), betInput: $('betInput'), betMinus: $('betMinus'),
    betPlus: $('betPlus'), quickBets: $('quickBets'), payout: $('payoutLabel'), condition: $('conditionLabel'),
    conditionMeter: $('conditionMeter'), impacts: $('impactCountLabel'), history: $('history'),
    sound: $('soundButton'), soundIcon: $('soundIcon'), settings: $('settingsButton'), brand: $('brandButton'),
    fairness: $('fairnessButton'), user: $('userLabel'), network: $('networkPill'), flash: $('impactFlash'),
    settingsSheet: $('settingsSheet'), infoSheet: $('infoSheet'), fairnessSheet: $('fairnessSheet'),
    backdrop: $('sheetBackdrop'), soundToggle: $('soundToggle'), hapticToggle: $('hapticToggle'),
    motionToggle: $('motionToggle'), quality: $('qualitySelect'), fullscreen: $('fullscreenButton'),
    roundId: $('roundId'), roundCommit: $('roundCommit'), fairnessMode: $('fairnessMode')
  };

  const state = {
    mode: 'ready', balance: 10000, bet: 100, multiplier: 1, impacts: 0, damage: 0,
    charging: false, charge: 0, speed: 0, distance: 0, wheelAngle: 0, wheelY: 0,
    nextAt: 0, threatStart: 0, impactPauseUntil: 0, overdrive: false, sound: true,
    haptics: true, reduced: false, quality: 'auto', particles: [], debris: [], history: [],
    cameraShake: 0, last: performance.now(), roundId: null, commitment: null, audio: null,
    engineOsc: null, engineGain: null, serverToken: null, serverRound: null, serverMode: false,
    obstacle: { name: 'STEEL JOINT', kind: 0 }, resultTimer: 0
  };

  const obstacles = [
    ['STEEL JOINT',0], ['HYDRAULIC RAM',1], ['CONCRETE BREAK',2], ['ROTATING BLOCK',3], ['FIRE GATE',4]
  ];
  const damageNames = ['PRISTINE','SCUFFED','WORN','BENT','CRITICAL','SHREDDING','FINAL IMPACT'];
  const money = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const rand = (a,b) => a + Math.random()*(b-a);

  function haptic(type='light') {
    if (!state.haptics) return;
    try {
      if (type === 'success') tg?.HapticFeedback?.notificationOccurred('success');
      else if (type === 'error') tg?.HapticFeedback?.notificationOccurred('error');
      else tg?.HapticFeedback?.impactOccurred(type);
    } catch {}
  }

  function initAudio() {
    if (state.audio) return;
    try {
      state.audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  }
  function tone(freq=220, duration=.08, gain=.06, type='sine', slide=0) {
    if (!state.sound) return;
    initAudio();
    if (!state.audio) return;
    const now = state.audio.currentTime;
    const o = state.audio.createOscillator();
    const g = state.audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide), now+duration);
    g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(.0001, now+duration);
    o.connect(g).connect(state.audio.destination); o.start(now); o.stop(now+duration);
  }
  function noise(duration=.12, gain=.08) {
    if (!state.sound) return;
    initAudio(); if (!state.audio) return;
    const len = Math.floor(state.audio.sampleRate*duration), buf = state.audio.createBuffer(1,len,state.audio.sampleRate);
    const data = buf.getChannelData(0); for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
    const src=state.audio.createBufferSource(), g=state.audio.createGain(), f=state.audio.createBiquadFilter();
    f.type='lowpass'; f.frequency.value=900; g.gain.value=gain; src.buffer=buf; src.connect(f).connect(g).connect(state.audio.destination); src.start();
  }
  function engineStart() {
    if (!state.sound) return; initAudio(); if(!state.audio||state.engineOsc) return;
    const o=state.audio.createOscillator(), g=state.audio.createGain(), f=state.audio.createBiquadFilter();
    o.type='sawtooth'; o.frequency.value=55; f.type='lowpass'; f.frequency.value=260; g.gain.value=.0001;
    o.connect(f).connect(g).connect(state.audio.destination); o.start();
    state.engineOsc=o; state.engineGain=g;
  }
  function engineUpdate(power) {
    if(!state.engineOsc||!state.audio) return;
    const t=state.audio.currentTime; state.engineOsc.frequency.setTargetAtTime(55+power*110,t,.03); state.engineGain.gain.setTargetAtTime(.015+power*.045,t,.03);
  }
  function engineStop() {
    if(!state.engineOsc||!state.audio) return;
    const o=state.engineOsc,g=state.engineGain,t=state.audio.currentTime;
    g.gain.setTargetAtTime(.0001,t,.05); setTimeout(()=>{try{o.stop()}catch{}},180); state.engineOsc=null;state.engineGain=null;
  }

  async function api(path, options={}) {
    try {
      const headers = { 'content-type':'application/json', ...(options.headers||{}) };
      if (state.serverToken) headers.authorization = `Bearer ${state.serverToken}`;
      const r = await fetch(path,{...options,headers});
      if(!r.ok) throw new Error('api'); return await r.json();
    } catch { return null; }
  }

  async function authenticate() {
    const initData = tg?.initData || '';
    const auth = await api('/api/auth',{method:'POST',body:JSON.stringify({initData})});
    if(auth?.token){state.serverToken=auth.token;state.serverMode=true;state.balance=auth.balance??state.balance;ui.network.querySelector('span').textContent='SECURE ENGINE';}
    else ui.network.querySelector('span').textContent='DEMO ENGINE';
    updateUI();
  }

  function setupTelegram() {
    try {
      tg?.ready(); tg?.expand(); tg?.enableClosingConfirmation?.(); tg?.disableVerticalSwipes?.();
      const user=tg?.initDataUnsafe?.user;
      if(user) ui.user.textContent=(user.first_name||user.username||'PLAYER').toUpperCase();
      const update=()=>document.documentElement.style.setProperty('--tg-height',`${tg?.viewportStableHeight||innerHeight}px`);
      tg?.onEvent?.('viewportChanged',update); update();
    } catch {}
  }

  function resize() {
    const r=canvas.getBoundingClientRect();
    const cap=state.quality==='high'?1.8:state.quality==='low'?1:1.35;
    const dpr=Math.min(devicePixelRatio||1,cap);
    canvas.width=Math.max(1,Math.floor(r.width*dpr)); canvas.height=Math.max(1,Math.floor(r.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0); canvas._w=r.width;canvas._h=r.height;canvas._dpr=dpr;
  }

  function chooseObstacle() {
    const item=obstacles[(state.impacts+Math.floor(Math.random()*obstacles.length))%obstacles.length];
    state.obstacle={name:item[0],kind:item[1]}; ui.threatName.textContent=item[0];
    ui.nextMultiplier.textContent=`${(state.multiplier*(1.08+state.impacts*.018)).toFixed(2)}×`;
  }

  function updateUI() {
    ui.balance.textContent=money(state.balance); ui.multiplier.textContent=`${state.multiplier.toFixed(2)}×`;
    ui.payout.textContent=money(state.bet*state.multiplier); ui.impacts.textContent=state.impacts;
    const idx=clamp(Math.floor(state.damage*6),0,6); ui.condition.textContent=damageNames[idx];
    ui.conditionMeter.style.transform=`scaleX(${clamp(1-state.damage,0,1)})`;
    ui.betInput.value=state.bet;
    if(state.mode==='ready'){
      ui.phase.textContent='READY';ui.status.textContent='LAUNCH SYSTEM READY';ui.intro.style.opacity='1';ui.threat.classList.remove('show');
      ui.action.className='action-button is-launch';ui.actionKicker.textContent='PRESS & HOLD';ui.actionLabel.textContent='HOLD TO LAUNCH';ui.actionSub.textContent='RELEASE WHEN THE ENGINE PEAKS';
    } else if(state.mode==='running'||state.mode==='pause'){
      ui.phase.textContent=state.overdrive?'OVERDRIVE':'LIVE';ui.status.textContent=state.mode==='pause'?'IMPACT SURVIVED':'WHEEL IN MOTION';ui.intro.style.opacity='0';ui.threat.classList.add('show');
      ui.action.className='action-button is-cashout';ui.actionKicker.textContent='SECURE RETURN';ui.actionLabel.textContent=`CASH OUT ${money(state.bet*state.multiplier)}`;ui.actionSub.textContent='BEFORE THE NEXT TAKKAR';
    } else {
      ui.phase.textContent='COMPLETE';ui.status.textContent='ROUND COMPLETE';ui.action.className='action-button is-disabled';
    }
  }

  function setBet(v){if(state.mode!=='ready')return;state.bet=clamp(Math.round(v/10)*10,10,Math.min(10000,state.balance));updateUI();}

  async function startRound() {
    if(state.mode!=='ready'||state.bet>state.balance)return;
    state.balance-=state.bet;state.mode='running';state.multiplier=1;state.impacts=0;state.damage=0;state.speed=420+state.charge*180;state.distance=0;state.overdrive=false;
    state.roundId=crypto.randomUUID?.()||String(Date.now());state.commitment=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
    if(state.serverMode){const r=await api('/api/round/start',{method:'POST',body:JSON.stringify({bet:state.bet})});if(r){state.serverRound=r.roundId;state.roundId=r.roundId;state.commitment=r.commitment;state.balance=r.balance;}}
    ui.roundId.textContent=state.roundId;ui.roundCommit.textContent=state.commitment;ui.fairnessMode.textContent=state.serverMode?'SERVER':'DEMO';
    chooseObstacle(); state.threatStart=performance.now(); state.nextAt=state.threatStart+2300; updateUI();
    tone(80,.25,.1,'sawtooth',260);haptic('heavy');
  }

  function beginCharge(e){if(state.mode!=='ready')return;e.preventDefault();state.charging=true;state.charge=0;initAudio();engineStart();ui.action.setPointerCapture?.(e.pointerId);haptic('light');}
  function releaseCharge(e){if(!state.charging)return;e.preventDefault();state.charging=false;engineStop();startRound();}

  async function resolveImpact() {
    if(state.mode!=='running')return;
    let survived=Math.random()>(.11+state.impacts*.065), response=null;
    if(state.serverMode&&state.serverRound){response=await api(`/api/round/${state.serverRound}/impact`,{method:'POST',body:'{}'});if(response)survived=response.status==='survived';}
    state.cameraShake=state.reduced?4:14; flash(); burst(survived?38:70); noise(.18,.12);tone(58,.22,.12,'square',-20);haptic(survived?'heavy':'error');
    if(!survived){destroyRound(response);return;}
    state.impacts++; state.damage=clamp(state.damage+.11+state.impacts*.018,0,.96);
    state.multiplier=response?.multiplier||+(state.multiplier*(1.08+state.impacts*.022)).toFixed(2);
    state.overdrive=response?.overdrive||(!state.overdrive&&state.impacts>=3&&Math.random()<.18);
    state.mode='pause';state.impactPauseUntil=performance.now()+650;
    ui.survivalMultiplier.textContent=`${state.multiplier.toFixed(2)}×`;ui.survivalHint.textContent=state.overdrive?'OVERDRIVE ARMED — DECIDE NOW':'TAKE IT — OR TRUST THE WHEEL';
    ui.survival.classList.add('show');if(state.overdrive)ui.overdrive.classList.add('show');
    tone(420,.18,.06,'sine',180);updateUI();
  }

  function destroyRound(response) {
    state.mode='destroyed';state.speed=0;state.damage=1;state.multiplier=response?.multiplier||state.multiplier;
    addHistory(`${state.multiplier.toFixed(2)}×`,false);ui.resultKicker.textContent='WHEEL DESTROYED';ui.resultTitle.textContent='TOO LATE';ui.resultValue.textContent=`−${money(state.bet)}`;ui.resultValue.style.color='var(--red)';ui.result.classList.add('show');updateUI();
  }

  async function cashOut() {
    if(!['running','pause'].includes(state.mode))return;
    let payout=Math.round(state.bet*state.multiplier),response=null;
    if(state.serverMode&&state.serverRound){response=await api(`/api/round/${state.serverRound}/cashout`,{method:'POST',body:'{}'});if(!response)return;payout=response.payout;state.balance=response.balance;}
    else state.balance+=payout;
    state.mode='cashed';state.speed*=.3;addHistory(`${state.multiplier.toFixed(2)}×`,true);tone(520,.35,.08,'sine',520);haptic('success');
    ui.resultKicker.textContent='RETURN SECURED';ui.resultTitle.textContent='CASHED OUT';ui.resultValue.textContent=`+${money(payout)}`;ui.resultValue.style.color='var(--green)';ui.result.classList.add('show');updateUI();
  }

  function resetRound(){state.mode='ready';state.multiplier=1;state.impacts=0;state.damage=0;state.charge=0;state.speed=0;state.distance=0;state.overdrive=false;state.serverRound=null;state.particles.length=0;state.debris.length=0;ui.result.classList.remove('show');ui.survival.classList.remove('show');ui.overdrive.classList.remove('show');updateUI();}
  function addHistory(text,win){state.history.unshift({text,win});state.history=state.history.slice(0,7);ui.history.innerHTML=state.history.map(x=>`<span style="color:${x.win?'var(--green)':'var(--red)'}">${x.text}</span>`).join('');}
  function flash(){ui.flash.animate([{opacity:.75},{opacity:0}],{duration:180,easing:'ease-out'});}
  function burst(n){const w=canvas._w||innerWidth,h=canvas._h||innerHeight;for(let i=0;i<n;i++)state.particles.push({x:w*.58,y:h*.68,vx:rand(-260,330),vy:rand(-300,-20),life:rand(.35,.8),age:0,size:rand(1,4),hot:Math.random()>.35});}

  function openSheet(sheet){ui.backdrop.hidden=false;requestAnimationFrame(()=>sheet.classList.add('open'));sheet.setAttribute('aria-hidden','false');}
  function closeSheets(){[ui.settingsSheet,ui.infoSheet,ui.fairnessSheet].forEach(s=>{s.classList.remove('open');s.setAttribute('aria-hidden','true')});ui.backdrop.hidden=true;}

  function draw(dt,now) {
    const w=canvas._w||innerWidth,h=canvas._h||innerHeight;const shake=state.cameraShake>0?(Math.random()-.5)*state.cameraShake:0;state.cameraShake=Math.max(0,state.cameraShake-dt*45);
    ctx.save();ctx.translate(shake,shake*.4);
    const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,state.overdrive?'#231506':'#0b1017');sky.addColorStop(.58,'#12171e');sky.addColorStop(1,'#050608');ctx.fillStyle=sky;ctx.fillRect(-20,-20,w+40,h+40);
    drawFactory(w,h,now);drawRoad(w,h,now);drawRig(w,h,now);drawWheel(w,h,dt,now);drawObstacle(w,h,now);drawParticles(dt);ctx.restore();
  }
  function drawFactory(w,h,now){ctx.globalAlpha=.55;for(let i=0;i<9;i++){const x=((i*180-state.distance*.12)% (w+240))-120;ctx.fillStyle=i%2?'#131a22':'#0e141b';ctx.fillRect(x,h*.08,80,h*.58);ctx.fillStyle='#202933';for(let y=h*.14;y<h*.54;y+=42)ctx.fillRect(x+12,y,12,18)}ctx.globalAlpha=1;ctx.fillStyle='#ff74151c';ctx.fillRect(0,h*.54,w,3);}
  function drawRoad(w,h,now){const y=h*.72;ctx.fillStyle='#171b20';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y-10);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.fill();ctx.strokeStyle='#363d46';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y-10);ctx.stroke();for(let i=0;i<14;i++){const x=((i*120-state.distance*.8)%(w+120))-60;ctx.fillStyle=i%2?'#242a31':'#1d2228';ctx.fillRect(x,y+8,72,8)}if(state.overdrive){ctx.strokeStyle='#ff8a2255';ctx.lineWidth=2;for(let i=0;i<12;i++){const yy=y+20+i*10;ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy-i*4);ctx.stroke()}}}
  function drawRig(w,h,now){if(state.mode!=='ready'&&!state.charging)return;const x=w*.13,y=h*.69;ctx.save();ctx.translate(x,y);ctx.fillStyle='#272d35';ctx.fillRect(-70,-42,105,45);ctx.fillStyle='#444c55';ctx.fillRect(-60,-32,80,22);ctx.fillStyle='#ff7118';ctx.fillRect(-68,-49,46,7);ctx.fillStyle='#0b0d10';ctx.beginPath();ctx.arc(-36,-21,17,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ff8a22';ctx.lineWidth=4;ctx.stroke();if(state.charging){ctx.fillStyle=`rgba(255,120,24,${.2+state.charge*.7})`;ctx.beginPath();ctx.arc(25,-20,15+state.charge*13,0,Math.PI*2);ctx.fill()}ctx.restore();}
  function drawWheel(w,h,dt,now){const running=state.mode!=='ready';const x=running?w*.43:w*.28;const baseY=h*.70;const r=clamp(Math.min(w,h)*.105,42,78);if(state.mode==='running'||state.mode==='pause'){state.distance+=state.speed*dt;state.wheelAngle+=state.speed/r*dt;state.speed+=(state.overdrive?12:4)*dt}else if(state.mode==='cashed')state.speed*=Math.pow(.92,dt*60);if(state.charging){state.charge=clamp(state.charge+dt*.72,0,1);engineUpdate(state.charge);ui.actionFill.style.width=`${state.charge*100}%`}else ui.actionFill.style.width='0%';const wobble=Math.sin(now*.014)*state.damage*r*.12;const squash=state.mode==='pause'?Math.sin((state.impactPauseUntil-now)/650*Math.PI)*.16:0;ctx.save();ctx.translate(x+wobble,baseY);ctx.rotate(state.wheelAngle);ctx.scale(1+squash,1-squash);ctx.fillStyle='#050607';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle=state.damage>.55?'#7c4b2b':'#292d31';ctx.lineWidth=r*.18;ctx.stroke();ctx.strokeStyle='#111417';ctx.lineWidth=4;for(let i=0;i<16;i++){const a=i*Math.PI/8;ctx.beginPath();ctx.arc(0,0,r*.9,a,a+.08);ctx.stroke()}ctx.fillStyle='#59616a';ctx.beginPath();ctx.arc(0,0,r*.56,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#1e2328';ctx.lineWidth=7;ctx.stroke();ctx.fillStyle='#1b2026';ctx.beginPath();ctx.arc(0,0,r*.18,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#a9b0b7';ctx.lineWidth=3;for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.2,Math.sin(a)*r*.2);ctx.lineTo(Math.cos(a)*r*.5,Math.sin(a)*r*.5);ctx.stroke()}if(state.damage>.25){ctx.strokeStyle='#ff7b24';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,r*.72,.2,1.4);ctx.stroke()}ctx.restore();}
  function drawObstacle(w,h,now){if(!['running','pause'].includes(state.mode))return;const total=Math.max(1,state.nextAt-state.threatStart);const p=clamp((now-state.threatStart)/total,0,1);ui.threatProgress.style.width=`${p*100}%`;const x=w*(1.08-p*.42),y=h*.70;ctx.save();ctx.translate(x,y);ctx.fillStyle='#303740';ctx.strokeStyle='#87909a';ctx.lineWidth=3;if(state.obstacle.kind===0){ctx.fillRect(-14,-70,28,70);ctx.fillStyle='#ff7722';ctx.fillRect(-18,-55,36,7)}else if(state.obstacle.kind===1){ctx.fillRect(-18,-110,36,85);ctx.fillStyle='#9ba3aa';ctx.fillRect(-8,-25,16,28)}else if(state.obstacle.kind===2){ctx.beginPath();ctx.moveTo(-35,0);ctx.lineTo(0,-64);ctx.lineTo(38,0);ctx.fill();ctx.stroke()}else if(state.obstacle.kind===3){ctx.rotate(now*.004);ctx.fillRect(-34,-34,68,68);ctx.strokeRect(-34,-34,68,68)}else{ctx.fillRect(-24,-95,48,95);ctx.fillStyle='#ff6d1a';for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(0,-20-i*18,8+i*2,0,Math.PI*2);ctx.fill()}}ctx.restore();}
  function drawParticles(dt){for(let i=state.particles.length-1;i>=0;i--){const p=state.particles[i];p.age+=dt;if(p.age>=p.life){state.particles.splice(i,1);continue}p.vy+=520*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.globalAlpha=1-p.age/p.life;ctx.fillStyle=p.hot?'#ff8a22':'#9a6d49';ctx.fillRect(p.x,p.y,p.size,p.size)}ctx.globalAlpha=1;}

  function loop(now){const dt=Math.min(.033,(now-state.last)/1000||.016);state.last=now;if(state.mode==='running'&&now>=state.nextAt)resolveImpact();if(state.mode==='pause'&&now>=state.impactPauseUntil){state.mode='running';ui.survival.classList.remove('show');ui.overdrive.classList.remove('show');chooseObstacle();state.threatStart=now;state.nextAt=now+Math.max(1150,2200-state.impacts*110);updateUI()}draw(dt,now);requestAnimationFrame(loop);}

  ui.action.addEventListener('pointerdown',e=>{if(state.mode==='ready')beginCharge(e);else if(['running','pause'].includes(state.mode))cashOut()});
  ['pointerup','pointercancel','pointerleave'].forEach(ev=>ui.action.addEventListener(ev,releaseCharge));
  ui.betMinus.addEventListener('click',()=>setBet(state.bet-50));ui.betPlus.addEventListener('click',()=>setBet(state.bet+50));ui.betInput.addEventListener('change',()=>setBet(+ui.betInput.value||100));
  ui.quickBets.addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(!b)return;setBet(+b.dataset.value);[...ui.quickBets.children].forEach(x=>x.classList.toggle('active',x===b))});
  ui.again.addEventListener('click',resetRound);ui.sound.addEventListener('click',()=>{state.sound=!state.sound;ui.soundToggle.checked=state.sound;ui.soundIcon.textContent=state.sound?'SOUND ON':'SOUND OFF';if(!state.sound)engineStop()});
  ui.soundToggle.addEventListener('change',()=>{state.sound=ui.soundToggle.checked;if(!state.sound)engineStop()});ui.hapticToggle.addEventListener('change',()=>state.haptics=ui.hapticToggle.checked);ui.motionToggle.addEventListener('change',()=>state.reduced=ui.motionToggle.checked);ui.quality.addEventListener('change',()=>{state.quality=ui.quality.value;resize()});
  ui.settings.addEventListener('click',()=>openSheet(ui.settingsSheet));ui.brand.addEventListener('click',()=>openSheet(ui.infoSheet));ui.fairness.addEventListener('click',()=>openSheet(ui.fairnessSheet));ui.backdrop.addEventListener('click',closeSheets);document.querySelectorAll('[data-close-sheet]').forEach(b=>b.addEventListener('click',closeSheets));
  ui.fullscreen.addEventListener('click',()=>{try{tg?.requestFullscreen?.()}catch{}closeSheets()});
  addEventListener('resize',resize,{passive:true});addEventListener('orientationchange',()=>setTimeout(resize,120),{passive:true});document.addEventListener('contextmenu',e=>e.preventDefault());

  setupTelegram();resize();updateUI();authenticate();
  let boot=0;const bootTimer=setInterval(()=>{boot+=rand(8,18);ui.bootBar.style.width=`${Math.min(100,boot)}%`;if(boot>45)ui.bootText.textContent='PRESSURE SYSTEM ONLINE';if(boot>=100){clearInterval(bootTimer);setTimeout(()=>{ui.boot.remove();ui.app.hidden=false;resize()},180)}},90);
  requestAnimationFrame(loop);
})();
