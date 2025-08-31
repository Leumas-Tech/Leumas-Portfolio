// public/app.js

// ---------------------------
// DOM references
// ---------------------------
const view = document.getElementById('view');
const tabs = [...document.querySelectorAll('.tab')];

// ---------------------------
// Audio (separated) + Analysis globals
// ---------------------------
let audioInitialized = false;
let audioConfig = null;

let _audioCtx = null;
let _analyser = null;
let _srcNodeViz = null;

const _mediaSourceMap = new WeakMap(); // HTMLMediaElement -> MediaElementSourceNode
const POS_KEY_PREFIX = 'leumas_audio_pos::';

// ---------------------------
// Music-reactive helpers
// ---------------------------

// Beat detector (adaptive threshold with cooldown)
const Beat = {
  avg: 0,  // running average
  dev: 0,  // running deviation
  kAvg: 0.015,   // average smoothing
  kDev: 0.03,    // deviation smoothing
  lastBeat: 0,
  cooldown: 160, // ms min between beats
  sensitivity: 1.18, // threshold multiplier

  step(level) {
    this.avg += (level - this.avg) * this.kAvg;
    const diff = Math.abs(level - this.avg);
    this.dev += (diff - this.dev) * this.kDev;

    const now = performance.now();
    const th = this.avg + this.dev * this.sensitivity;
    const isBeat = (level > th) && (now - this.lastBeat > this.cooldown);

    if (isBeat) this.lastBeat = now;
    return isBeat;
  }
};

// Expanding ripple rings (spawned on beats)
class Ripple {
  constructor(cx, cy, baseRadius, level) {
    this.cx = cx; this.cy = cy;
    this.r = baseRadius;
    this.w = 12 + level * 34;        // ring thickness
    this.alpha = 0.16 + level * 0.24;
    this.growth = 3 + level * 42;    // px/frame
    this.decay = 0.985;              // alpha decay per frame
    this.halo = 0.55 + level * 0.45; // outer glow factor
  }
  step() {
    this.r += this.growth;
    this.alpha *= this.decay;
    return this.alpha > 0.01;
  }
  draw(ctx) {
    const a = Math.max(0, Math.min(1, this.alpha));
    const grad = ctx.createRadialGradient(this.cx, this.cy, this.r, this.cx, this.cy, this.r + this.w);
    grad.addColorStop(0, `rgba(140,190,255,${a})`);
    grad.addColorStop(1, `rgba(140,190,255,0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.r + this.w, 0, Math.PI * 2);
    ctx.arc(this.cx, this.cy, this.r, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // halo
    const haloA = a * this.halo * 0.35;
    if (haloA > 0.01) {
      const halo = ctx.createRadialGradient(this.cx, this.cy, this.r * 0.8, this.cx, this.cy, this.r * 1.6);
      halo.addColorStop(0, `rgba(90,160,255,${haloA})`);
      halo.addColorStop(1, `rgba(90,160,255,0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// Sample overall music energy (0..1) + capture bins for Chladni modes
const Spectrum = {
  lastBins: new Uint8Array(0),
  level: 0,
  // indices for lows/mids/highs (adaptive later)
  iLow: 8,
  iMid: 24,
  iHi: 48
};

// ===== REPLACE your sampleMusicLevel() with THIS =====
function sampleMusicLevel(){
  if (!_analyser) return 0;

  const bins = new Uint8Array(_analyser.frequencyBinCount);
  _analyser.getByteFrequencyData(bins);

  // Focus on lows/mids (bass drives impact; mids add texture)
  const len = bins.length;
  const lowEnd  = Math.max(4, Math.floor(len * 0.04));  // ~40Hz–200Hz
  const midEnd  = Math.max(12, Math.floor(len * 0.18)); // ~200Hz–1.5kHz

  let lowSum = 0, midSum = 0;
  for (let i = 0; i < lowEnd; i++) lowSum += bins[i];
  for (let i = lowEnd; i < midEnd; i++) midSum += bins[i];

  const lowAvg = lowSum / lowEnd;      // 0..255
  const midAvg = midSum / (midEnd - lowEnd);

  // Weighted energy + transient accent
  const base = (lowAvg * 0.65 + midAvg * 0.35) / 255;   // 0..1
  const transient = Math.max(0, (lowAvg - 140) / 115);   // spikes on kicks
  const level = Math.min(1, Math.pow(base, 0.9) + transient * 0.35);

  // expose lastBins if you need elsewhere
  Spectrum.lastBins = bins;
  Spectrum.level = level;
  return level;
}


// ---------------------------
// Audio elements and setup (separate audible + analysis)
// ---------------------------
function ensureAudioElements() {
  // Audible audio element (native playback)
  let bgm = document.getElementById('bgm');
  if (!bgm) {
    bgm = document.createElement('audio');
    bgm.id = 'bgm';
    bgm.preload = 'auto';
    bgm.crossOrigin = 'anonymous';
    document.body.appendChild(bgm);
  }

  // Hidden analysis element (muted, routed into WebAudio)
  let viz = document.getElementById('bgmViz');
  if (!viz) {
    viz = document.createElement('audio');
    viz.id = 'bgmViz';
    viz.preload = 'auto';
    viz.crossOrigin = 'anonymous';
    viz.muted = true;
    viz.setAttribute('playsinline', 'playsinline');
    viz.style.display = 'none';
    document.body.appendChild(viz);
  }
  return { bgm, viz };
}

function setupAudio(config) {
  const btn = document.getElementById('audioToggle');
  const { bgm, viz } = ensureAudioElements();
  if (!btn || !config || !config.src) return;

  // Config with safe defaults
  audioConfig = {
    src: config.src,
    loop: config.loop !== false,
    volume: typeof config.volume === 'number' ? config.volume : 0.35,
    autoplay: config.autoplay !== false,
    remember: config.remember !== false
  };
  if (audioConfig.volume < 0.05) audioConfig.volume = 0.35;

  // Set sources only if changed (prevents duplicate loads)
  if (bgm.src !== audioConfig.src) bgm.src = audioConfig.src;
  if (viz.src !== audioConfig.src) viz.src = audioConfig.src;

  // Playback props
  bgm.loop = !!audioConfig.loop;
  bgm.volume = audioConfig.volume;
  viz.loop = !!audioConfig.loop;
  viz.volume = 0;   // analysis element is silent

  // Restore mute pref (default audible unless explicitly saved)
  const persistedMute = localStorage.getItem('leumas_audio_muted');
  const initiallyMuted = (persistedMute === null) ? false : (persistedMute === 'true');
  bgm.muted = initiallyMuted;

  // Mic UI
  btn.hidden = false;
  btn.setAttribute('aria-pressed', String(initiallyMuted));
  btn.textContent = initiallyMuted ? '🔇' : '🎙️';

  // Restore position (per-src) on metadata
  if (audioConfig.remember && !bgm._posWired) {
    const posKey = POS_KEY_PREFIX + audioConfig.src;
    const saved = parseFloat(localStorage.getItem(posKey) || '0');
    const onMeta = () => {
      try {
        if (bgm.duration && saved > 0 && saved < bgm.duration - 1) {
          bgm.currentTime = saved;
          viz.currentTime = saved;
        }
      } catch(_) {}
      bgm.removeEventListener('loadedmetadata', onMeta);
    };
    bgm.addEventListener('loadedmetadata', onMeta);

    // persist while playing
    let _posTimer = null;
    bgm.addEventListener('play', () => {
      clearInterval(_posTimer);
      _posTimer = setInterval(() => {
        try {
          if (!bgm.paused && !bgm.seeking && bgm.currentTime > 0) {
            localStorage.setItem(posKey, String(bgm.currentTime));
          }
        } catch(_) {}
      }, 3000);
    });
    bgm.addEventListener('pause', () => clearInterval(_posTimer));
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem(posKey, String(bgm.currentTime || 0)); } catch(_) {}
    });
    bgm._posWired = true;
  }

  // Simple sync from audible -> analysis (keep drift low)
  if (!bgm._syncWired) {
    const resync = () => {
      try {
        if (!Number.isFinite(bgm.currentTime) || !Number.isFinite(viz.currentTime)) return;
        const drift = Math.abs((viz.currentTime || 0) - (bgm.currentTime || 0));
        if (drift > 0.5) viz.currentTime = bgm.currentTime;  // snap if drifted
      } catch(_) {}
    };
    viz.addEventListener('canplay', () => { try { viz.currentTime = bgm.currentTime || 0; } catch(_) {} });
    bgm.addEventListener('timeupdate', () => resync());
    setInterval(resync, 4000);
    bgm._syncWired = true;
  }

  // Initialize Audio Analysis from viz element (muted)
  initAudioAnalysis(viz);

  // Autoplay attempts
  const kick = () => { if (!bgm.muted && bgm.paused) bgm.play().catch(()=>{}); viz.play().catch(()=>{}); };
  if (audioConfig.autoplay) {
    kick();
    bgm.addEventListener('canplaythrough', kick, { once: true });
    viz.addEventListener('canplaythrough', () => viz.play().catch(()=>{}), { once: true });
  }

  // Mic toggle controls only the audible element
  if (!btn._wired) {
    btn.onclick = () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true'; // pressed==muted
      const nowMuted = !pressed;
      btn.setAttribute('aria-pressed', String(nowMuted));
      btn.textContent = nowMuted ? '🔇' : '🎙️';
      localStorage.setItem('leumas_audio_muted', String(nowMuted));
      bgm.muted = nowMuted;
      if (!nowMuted && bgm.paused) bgm.play().catch(()=>{});
      if (viz.paused) viz.play().catch(()=>{}); // keep analyser running
    };
    btn._wired = true;
  }

  // First gesture unlock
  if (!audioInitialized) {
    const unlock = () => {
      if (!_audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) { _audioCtx = new Ctx(); }
      } else if (_audioCtx.state === 'suspended') {
        _audioCtx.resume().catch(()=>{});
      }
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      if (!pressed && bgm.paused) bgm.play().catch(()=>{});
      if (viz.paused) viz.play().catch(()=>{});
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    audioInitialized = true;
  }
}

// ===== REPLACE your initAudioAnalysis(...) with THIS =====
function initAudioAnalysis(elViz){
  if (!elViz) return;

  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = new Ctx();
  }

  if (_mediaSourceMap.has(elViz)) {
    _srcNodeViz = _mediaSourceMap.get(elViz);
  } else {
    _srcNodeViz = _audioCtx.createMediaElementSource(elViz);
    _mediaSourceMap.set(elViz, _srcNodeViz);
  }

  // Wider FFT + lower smoothing = snappier response
  if (_analyser) { try { _analyser.disconnect(); } catch(_) {} }
  _analyser = _audioCtx.createAnalyser();
  _analyser.fftSize = 1024;                 // 512 bins
  _analyser.smoothingTimeConstant = 0.6;    // less averaging, more punch

  try { _srcNodeViz.connect(_analyser); } catch(_) {}
}


// ---------------------------
// Starfield + Black Hole + Chladni Pattern (music reactive)
// ---------------------------
// ===== REPLACE your initStars() with THIS =====
function initStars() {
  const canvas = document.getElementById('stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W=0, H=0, DPR=Math.min(2, window.devicePixelRatio||1);
  let cx=0, cy=0, t=0;

  // simple beat detector
  const Beat = {
    avg: 0, dev: 0, last: 0, cooldown: 140, kAvg: 0.02, kDev: 0.04, sens: 1.22,
    step(v){
      this.avg += (v - this.avg) * this.kAvg;
      const d = Math.abs(v - this.avg);
      this.dev += (d - this.dev) * this.kDev;
      const now = performance.now();
      const th = this.avg + this.dev * this.sens;
      const hit = v > th && (now - this.last > this.cooldown);
      if (hit) this.last = now;
      return hit;
    }
  };

  // parallax layers
  const layers = [
    { depth:.3,  stars:[], count:0, color:[205,230,255] },
    { depth:.7,  stars:[], count:0, color:[175,210,255] },
    { depth:1.1, stars:[], count:0, color:[150,190,255] }
  ];

  // shockwave rings on beats
  const ripples = [];

  class Ripple {
    constructor(r0, power){
      this.r = r0;
      this.a = 0.18 + power*0.22;
      this.w = 12 + power*30;
      this.g = 4 + power*42;
      this.fade = 0.985;
    }
    step(){
      this.r += this.g;
      this.a *= this.fade;
      return this.a > 0.01;
    }
    draw(){
      const g = ctx.createRadialGradient(cx, cy, this.r, cx, cy, this.r + this.w);
      g.addColorStop(0, `rgba(140,190,255,${this.a})`);
      g.addColorStop(1, `rgba(140,190,255,0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, this.r + this.w, 0, Math.PI*2);
      ctx.arc(cx, cy, this.r, 0, Math.PI*2, true);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function spawnStars() {
    const baseCount = (W*H)/(9000*DPR);
    layers[0].count = Math.floor(baseCount*0.85);
    layers[1].count = Math.floor(baseCount*1.00);
    layers[2].count = Math.floor(baseCount*1.25);
    layers.forEach(Lr=>{
      Lr.stars = Array.from({length:Lr.count}, (_,i)=>{
        const angle = Math.random()*Math.PI*2;
        const dist  = Math.random()*Math.min(W,H)*0.55 + 40*DPR;
        const r     = (Math.random()*1.2+0.25)*DPR*(0.6 + Lr.depth*0.6);
        return {
          angle, dist, r,
          a: 0.35 + Math.random()*0.65,
          tw: Math.random()*0.02 + 0.006,
          seed: (i%97)*0.017
        };
      });
    });
  }

  function resize(){
    W = canvas.width  = Math.floor(window.innerWidth * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width  = window.innerWidth+'px';
    canvas.style.height = window.innerHeight+'px';
    cx = W*0.5; cy = H*0.5;
    spawnStars();
  }

  window.addEventListener('resize', resize);
  resize();

  let burst = 0; // loudness burst timer

  function frame(){
    t++;

    // real-time audio energy + beat
    const L = sampleMusicLevel();           // 0..1
    const beat = Beat.step(L);
    if (L > 0.48) burst = Math.min(1, burst + 0.12); else burst *= 0.94;

    if (beat) ripples.push(new Ripple(80 + Math.random()*40, Math.min(1, L*1.4)));

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    // micro camera shake (no scene scaling)
    const shake = L>0.1 ? (L*5*DPR) : 0;
    const offX = (Math.sin(t*0.07)+Math.sin(t*0.013+1.2))*shake*0.5;
    const offY = (Math.cos(t*0.05)+Math.sin(t*0.017-0.6))*shake*0.5;

    // event horizon (fixed position; radius breathes with bass)
    const coreR = (52 + L*110)*DPR;
    const core = ctx.createRadialGradient(cx+offX, cy+offY, 0, cx+offX, cy+offY, coreR*1.75);
    core.addColorStop(0,'rgba(0,0,0,1)');
    core.addColorStop(0.55,'rgba(0,0,0,0.96)');
    core.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0,0,W,H);

    // accretion disk glow (no global scene scale)
    const diskR = coreR*(3.5 + L*1.7);
    const disk  = ctx.createRadialGradient(cx+offX, cy+offY, coreR*1.06, cx+offX, cy+offY, diskR);
    const diskA = 0.15 + L*0.45;
    disk.addColorStop(0,   `rgba(140,200,255,${diskA*0.75})`);
    disk.addColorStop(0.4, `rgba(95,160,255,${diskA*0.55})`);
    disk.addColorStop(1,   `rgba(0,0,0,0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = disk;
    ctx.fillRect(0,0,W,H);
    ctx.globalCompositeOperation = 'source-over';

    // draw ripples
    for (let i=ripples.length-1; i>=0; i--){
      ripples[i].draw();
      if (!ripples[i].step()) ripples.splice(i,1);
    }

    // stars (now truly driven by audio)
    layers.forEach(Lr=>{
      const [cr,cg,cb] = Lr.color;
      const swirl = (0.00035 + L*0.004) * (0.6 + Lr.depth*0.9); // rotate faster on music
      const pull  = 0.9995 + L*0.0015;                          // spiral inward on music

      // density “dup” draws on bursts (feels fuller when loud)
      const dup = burst>0.25 ? 1 + Math.floor(burst*2) : 1;

      for (const s of Lr.stars){
        // more wobble with music
        const wobble = Math.sin(t*0.03 + s.seed*10) * 0.002 * (1 + L*3);

        s.angle += swirl + wobble;
        s.dist  *= pull;

        // respawn past horizon
        if (s.dist < coreR*0.9) {
          s.dist = Math.random()*Math.min(W,H)*0.55 + coreR*1.2;
          s.angle = Math.random()*Math.PI*2;
          s.a = 0.35 + Math.random()*0.65;
        }

        // position (no scene scaling)
        const x = cx + offX + Math.cos(s.angle)*s.dist;
        const y = cy + offY + Math.sin(s.angle)*s.dist;

        // audio-driven size/brightness
        const sizeBoost = 1 + L*0.6 + burst*0.8;
        const rad = s.r * (0.7 + Lr.depth*0.6) * sizeBoost;

        // twinkle with music
        s.a += (Math.random()-0.5) * s.tw * (1 + L*3);
        s.a = Math.max(0.18, Math.min(1, s.a));

        for (let d=0; d<dup; d++){
          const jx = d===0 ? 0 : (Math.random()-0.5) * DPR*(1 + L*2);
          const jy = d===0 ? 0 : (Math.random()-0.5) * DPR*(1 + L*2);

          // star core
          ctx.globalAlpha = s.a;
          ctx.fillStyle = `rgba(${cr},${cg},${cb},1)`;
          ctx.beginPath();
          ctx.arc(x+jx, y-jy, rad, 0, Math.PI*2);
          ctx.fill();

          // glow
          ctx.globalAlpha = s.a * (0.22 + L*0.38) * (0.6 + Lr.depth*0.7);
          ctx.fillStyle = `rgba(${Math.max(120,cr-20)},${Math.min(230,cg+10)},255,1)`;
          ctx.beginPath();
          ctx.arc(x+jx, y-jy, rad*(2.1 + L*2.4), 0, Math.PI*2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    });

    // subtle scanline + radial streaks (feel of depth, react to energy)
    if (L>0.02){
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(120,190,255,${0.03 + L*0.08})`;
      const yScan = (H*(0.5 + 0.45 * Math.sin(t/(1200 - 700*L))));
      ctx.fillRect(0, yScan - (4 + 10*L)*DPR, W, (8 + 20*L)*DPR);

      const spokes = 8 + Math.floor(L*10);
      const len    = (60 + L*280)*DPR;
      const thick  = (1.2 + L*2.6)*DPR;
      ctx.lineWidth = thick;
      ctx.strokeStyle = `rgba(150,210,255,${0.05 + L*0.12})`;
      ctx.beginPath();
      for (let i=0;i<spokes;i++){
        const ang = (i/spokes)*Math.PI*2 + t*0.002;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang)*len, cy + Math.sin(ang)*len);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }

    requestAnimationFrame(frame);
  }

  frame();
}


// ---------------------------
// Aside renderer (with audio button state)
// ---------------------------
function renderAside(profile, resumeData) {
  if (!profile) return;

  // Audio (separate paths setup)
  if (profile.audio && profile.audio.src) {
    setupAudio(profile.audio);
  }

  // Identity
  const avatar = document.getElementById('avatar');
  const nameEl = document.getElementById('name');
  const roleEl = document.getElementById('role');
  const emailEl = document.getElementById('email');
  const phoneEl = document.getElementById('phone');
  const locEl   = document.getElementById('location');
  const linksEl = document.getElementById('links');

  if (avatar) avatar.src = profile.avatar || '';
  if (nameEl) nameEl.textContent = profile.name || '';
  if (roleEl) roleEl.textContent = profile.role || '';
  if (emailEl) {
    emailEl.textContent = profile.contact?.email || '';
    emailEl.href = profile.contact?.email ? `mailto:${profile.contact.email}` : '#';
  }
  if (phoneEl) {
    phoneEl.textContent = profile.contact?.phone || '';
    phoneEl.href = profile.contact?.phone ? `tel:${profile.contact.phone}` : '#';
  }
  if (locEl) locEl.textContent = profile.contact?.location || '';

  // Badge
  const badge = document.getElementById('availabilityBadge');
  if (badge) {
    if (profile.available === false || profile.available === undefined) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.textContent =
        typeof profile.available === 'string' ? profile.available : 'Available';
    }
  }

  // Hire CTA
  const ctaHire = document.getElementById('ctaHire');
  if (ctaHire) {
    if (profile.hireUrl) { ctaHire.hidden = false; ctaHire.href = profile.hireUrl; }
    else { ctaHire.hidden = true; }
  }

  // Social icons (emoji)
  if (linksEl) {
    linksEl.innerHTML = '';
    (profile.links || []).forEach(l => {
      const a = document.createElement('a');
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'a-link';
      const label = (l.label || l.url || '').toLowerCase();
      let icon = '🔗';
      if (label.includes('github')) icon = '🐙';
      else if (label.includes('linkedin')) icon = '💼';
      else if (label.includes('twitter') || label.includes('x.com')) icon = '🐦';
      else if (label.includes('website') || label.includes('portfolio')) icon = '🌐';
      a.textContent = icon;
      a.title = l.label || l.url;
      linksEl.appendChild(a);
    });
  }

  // Quick facts
  const qf = document.getElementById('quickFacts');
  const factFocus = document.getElementById('factFocus');
  const factLocation = document.getElementById('factLocation');
  const factEmail = document.getElementById('factEmail');

  const skills = (resumeData && resumeData.skills) || [];
  const focus = (Array.isArray(skills) ? skills : []).slice(0, 3)
    .map(s => typeof s === 'string' ? s : s.name).join(' · ');

  if (qf) {
    if (focus || profile.contact) {
      qf.hidden = false;
      if (factFocus && focus) factFocus.textContent = focus;
      if (factLocation && profile.contact?.location) factLocation.textContent = profile.contact.location;
      if (factEmail && profile.contact?.email) factEmail.textContent = profile.contact.email;
    } else qf.hidden = true;
  }

  // Ensure mic icon reflects persisted mute
  const btn = document.getElementById('audioToggle');
  if (btn) {
    const persistedMute = localStorage.getItem('leumas_audio_muted');
    const isMuted = (persistedMute === null) ? false : (persistedMute === 'true');
    btn.setAttribute('aria-pressed', String(isMuted));
    btn.textContent = isMuted ? '🔇' : '🎙️';
    const bgm = document.getElementById('bgm');
    if (bgm) bgm.muted = isMuted;
  }
}

// ---------------------------
// Renderers for tabs
// ---------------------------
function renderAbout({ about }) {
  view.innerHTML = `
    <div class="card">
      <h2 class="h">${about.headline}</h2>
      ${about.paragraphs.map(p => `<p class="lead">${p}</p>`).join('')}
      <div class="sp-16"></div>
      <h3 class="section-title">What I'm Doing</h3>
      <div class="grid two doing">
        ${about.doing.map(d => `
          <div class="item card">
            <div class="icon">${d.icon}</div>
            <div>
              <div class="title">${d.title}</div>
              <div class="desc">${d.desc}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderResume(resume) {
  function renderSkills(skills) {
    if (!skills || !skills.length) return '';
    const items = skills.map(s => (typeof s === 'string' ? { name: s } : s));
    return `
      <div class="skills-cloud">
        ${items.map((s, idx) => {
          const keyCls = idx < 3 ? ' key' : '';
          return `
            <span class="skill-badge${keyCls}" role="listitem" tabindex="0">
              <span class="skill-dot" aria-hidden="true"></span>
              <span>${s.name}</span>
            </span>
          `;
        }).join('')}
      </div>
    `;
  }

  view.innerHTML = `
    <div class="resume-wrap">
      <div class="card">
        <h3 class="section-title">Education</h3>
        <div class="timeline">
          ${resume.education.map(e => `
            <div class="trow">
              <div class="t-when">${e.period}</div>
              <div class="t-what">${e.school}</div>
              ${e.detail ? `<div class="t-desc">${e.detail}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">Experience</h3>
        <div class="timeline">
          ${resume.experience.map(x => `
            <div class="trow">
              <div class="t-when">${x.period}</div>
              <div class="t-what">${x.role} — ${x.company}</div>
              ${x.detail ? `<div class="t-desc">${x.detail}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="sp-16"></div>
    <div class="card skills-card">
      <h3 class="section-title">Skills</h3>
      ${renderSkills(resume.skills)}
    </div>
  `;
}

function renderPortfolio(categories, items) {
  view.innerHTML = `
    <div class="card">
      <div class="filters">
        ${categories.map(c => `<button class="filter${c==='All'?' active':''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
      <div class="gallery" id="gallery">
        ${items.map(tile).join('')}
      </div>
    </div>
  `;

  document.querySelectorAll('.filter').forEach(b => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const cat = b.dataset.cat;
      const data = await (await fetch(`/api/portfolio?cat=${encodeURIComponent(cat)}`)).json();
      const gal = document.getElementById('gallery');
      if (gal) gal.innerHTML = data.items.map(tile).join('');
    });
  });

  function tile(i) {
    const href = i.link || '#';
    const target = i.link ? '_blank' : '_self';
    return `
      <a class="tile" href="${href}" target="${target}" rel="noopener">
        <img src="${i.thumb}" alt="${i.title}">
        <div class="cap">${i.title}</div>
      </a>`;
  }
}

function renderBlog(posts) {
  view.innerHTML = `
    <div class="grid two">
      ${posts.map(p => `
        <article class="post">
          <h3 class="what">${p.title}</h3>
          <div class="meta">${new Date(p.date).toLocaleDateString()}</div>
          <p class="muted">${p.excerpt}</p>
          <a class="links" href="${p.url}" target="_blank" rel="noopener">Read →</a>
        </article>
      `).join('')}
    </div>
  `;
}

function renderContact(contact) {
  view.innerHTML = `
    <div class="card">
      <h2 class="h">Contact</h2>
      <p class="muted">Let's build something great.</p>
      <div class="sp-16"></div>
      <form id="cform" class="form">
        <input class="input" name="name" placeholder="Your name" required>
        <input class="input" name="email" type="email" placeholder="Your email" required>
        <textarea class="textarea" name="message" rows="5" placeholder="Your message" required></textarea>
        <button class="btn" type="submit">Send</button>
      </form>
      <div class="sp-16"></div>
      <div class="lead">
        <strong>Email:</strong> <a href="mailto:${contact.email}">${contact.email}</a><br>
        <strong>Phone:</strong> <a href="tel:${contact.phone}">${contact.phone}</a><br>
        <strong>Location:</strong> ${contact.location}
      </div>
    </div>
  `;
  const form = document.getElementById('cform');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const out = await res.json();
        alert(out.ok ? 'Thanks — message sent!' : ('Error: ' + out.error));
        if (out.ok) e.target.reset();
      } catch (err) {
        alert('Error sending message.');
      }
    });
  }
}

// ---------------------------
// Router for tabs
// ---------------------------
async function go(tab) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  window.history.replaceState({}, '', `#/${tab}`);

  if (tab === 'about') {
    const data = await (await fetch('/api/about')).json();
    renderAside(data.profile);
    renderAbout(data);
  } else if (tab === 'resume') {
    const data = await (await fetch('/api/resume')).json();
    renderAside(data.profile, data.resume);
    renderResume(data.resume);
  } else if (tab === 'portfolio') {
    const data = await (await fetch('/api/portfolio')).json();
    renderAside(data.profile);
    renderPortfolio(data.categories, data.items);
  } else if (tab === 'blog') {
    const data = await (await fetch('/api/blog')).json();
    renderAside(data.profile);
    renderBlog(data.posts);
  } else if (tab === 'contact') {
    const data = await (await fetch('/api/contact')).json();
    renderAside(data.profile);
    renderContact(data.contact);
  }
}

// Wire tabs
tabs.forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));

// Initial route
const initial = (location.hash.replace('#/', '') || 'about');
go(initial);

// Init cosmic, music-reactive background
initStars();
