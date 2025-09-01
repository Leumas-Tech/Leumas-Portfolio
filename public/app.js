// ---------------------------
// DOM references
// ---------------------------
const view = document.getElementById('view');
const tabs = [...document.querySelectorAll('.tab')];

// ---------------------------
// Audio (separated) + Analysis globals
// ---------------------------
let audioInitialized = false;

let _audioCtx = null;
let _analyser = null;
let _srcNodeViz = null;

const _mediaSourceMap = new WeakMap(); // HTMLMediaElement -> MediaElementSourceNode
const POS_KEY_PREFIX = 'leumas_audio_pos::';

// Playlist engine state
const LAST_TRACK_KEY = 'leumas_audio_last_track';
let _playlist = [];
let _loopMode = 'playlist'; // 'playlist' | 'track' | false
let _autoplay = true;
let _remember = true;
let _volume = 0.35;
let _trackIndex = 0;
let _cutTimer = null;

// Flag set after splash click (gesture)
let _userGestureHappened = false;

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

// Sample overall music energy (0..1) + capture bins for Chladni modes
const Spectrum = {
  lastBins: new Uint8Array(0),
  level: 0,
};





// ---------------------------
// Entrance Animations (styles + helpers)
// ---------------------------
function ensureAnimStyles(){
  if (document.getElementById('leumas-anim-styles')) return;
  const css = `
  /* base */
  .will-anim { will-change: transform, opacity; }

  /* slide/fade ins */
  @keyframes fadeUp { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:none; } }
  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes slideIn { from { opacity:0; transform: translateY(24px) scale(.98); } to { opacity:1; transform:none; } }
  @keyframes cardPop { from { opacity:0; transform: translateY(14px) scale(.985); } to { opacity:1; transform:none; } }

  /* applied classes */
  .anim-fadeUp   { animation: fadeUp .48s cubic-bezier(.22,.61,.36,1) both; }
  .anim-fadeIn   { animation: fadeIn .42s ease-out both; }
  .anim-slideIn  { animation: slideIn .55s cubic-bezier(.22,.61,.36,1) both; }
  .anim-cardPop  { animation: cardPop .6s cubic-bezier(.2,.7,.3,1) both; }

  /* tiny stagger helpers */
  [data-stagger] > * { opacity:0; transform: translateY(10px); }
  [data-stagger].in > * { opacity:1; transform:none; transition: transform .45s cubic-bezier(.22,.61,.36,1), opacity .35s ease-out; }
  [data-stagger].in > * { transition-delay: var(--stagger, 0ms); }

  /* caret for typewriter */
  .tw-caret::after{
    content:''; display:inline-block; width:.6ch; height:1em; vertical-align:-0.15em; 
    background: currentColor; margin-left:.1ch; opacity:.8; animation: twBlink 1s step-end infinite;
  }
  @keyframes twBlink { 50% { opacity:0; } }
  `;
  const style = document.createElement('style');
  style.id = 'leumas-anim-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
ensureAnimStyles();

/* ---- text animation helpers (typewriter + decrypt) ---- */
function typewriterIn(el, speed = 12, keepCaret = false){
  if (!el || el._twRunning) return;
  const txt = el.textContent;
  el.textContent = '';
  el.classList.add('tw-caret');
  el._twRunning = true;

  let i = 0;
  const tick = () => {
    // write in chunks for speed
    const chunk = 3 + Math.floor(18 / Math.max(1,speed));
    i = Math.min(txt.length, i + chunk);
    el.textContent = txt.slice(0, i);
    if (i < txt.length) requestAnimationFrame(tick);
    else {
      el._twRunning = false;
      if (!keepCaret) el.classList.remove('tw-caret');
    }
  };
  tick();
}

function decryptIn(el, duration = 380){
  if (!el || el._decRunning) return;
  const glyphs = '█▓▒░#%@&$§*+<>/\\=~-|_';
  const src = el.textContent;
  const N = src.length;
  const start = performance.now();
  el._decRunning = true;

  const step = (t) => {
    const p = Math.min(1, (t - start) / duration);
    const reveal = Math.floor(N * p);
    let out = '';
    for (let i=0;i<N;i++){
      out += (i < reveal) ? src[i] : glyphs[(i*7 + Math.floor(t/16)) % glyphs.length];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(step);
    else { el.textContent = src; el._decRunning = false; }
  };
  requestAnimationFrame(step);
}

/* ---- container initializer: mark and animate common elements ---- */
function initViewAnimations(container){
  if (!container) return;
  const root = container instanceof Element ? container : document;

  // Text: titles & leads → fast decrypt or typewriter
  root.querySelectorAll('.h, .section-title').forEach((el, idx) => {
    el.classList.add('will-anim');
    // decrypt for headings, slight delay by index
    setTimeout(()=> decryptIn(el, 420), 60 * idx);
  });
  root.querySelectorAll('.lead').forEach((el, idx) => {
    el.classList.add('will-anim');
    setTimeout(()=> typewriterIn(el, 14), 90 * idx);
  });

  // Cards / timeline rows
  const cardLike = root.querySelectorAll('.card, .trow, .skills-card, .post, .tile');
  cardLike.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(14px)';
    el.classList.add('will-anim');
  });

  // Stagger groups: grids, timelines, galleries
  root.querySelectorAll('.timeline, .grid.two, .gallery').forEach(group => {
    group.setAttribute('data-stagger','');
  });

  // IO to reveal on enter
  const io = new IntersectionObserver((ents) => {
    ents.forEach((e, i) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      // choose a motion class based on element type
      if (el.matches('.card, .skills-card')) el.classList.add('anim-cardPop');
      else if (el.matches('.trow, .post')) el.classList.add('anim-slideIn');
      else el.classList.add('anim-fadeUp');

      el.style.opacity = '';
      el.style.transform = '';
      io.unobserve(el);
    });
  }, { threshold: 0.16 });

  cardLike.forEach(el => io.observe(el));

  // Stagger in children once group appears
  const ioGroup = new IntersectionObserver((ents) => {
    ents.forEach((e)=>{
      if (!e.isIntersecting) return;
      const group = e.target;
      const kids = [...group.children];
      kids.forEach((kid, i) => {
        kid.style.setProperty('--stagger', `${i*60}ms`);
      });
      group.classList.add('in');
      ioGroup.unobserve(group);
    });
  }, { threshold: 0.2 });
  root.querySelectorAll('[data-stagger]').forEach(g => ioGroup.observe(g));
}




// ===== Music sampling =====
function sampleMusicLevel(){
  if (!_analyser) return 0;
  const bins = new Uint8Array(_analyser.frequencyBinCount);
  _analyser.getByteFrequencyData(bins);
  const len = bins.length;
  const lowEnd  = Math.max(4, Math.floor(len * 0.04));
  const midEnd  = Math.max(12, Math.floor(len * 0.18));
  let lowSum = 0, midSum = 0;
  for (let i = 0; i < lowEnd; i++) lowSum += bins[i];
  for (let i = lowEnd; i < midEnd; i++) midSum += bins[i];
  const lowAvg = lowSum / lowEnd;
  const midAvg = midSum / (midEnd - lowEnd);
  const base = (lowAvg * 0.65 + midAvg * 0.35) / 255;
  const transient = Math.max(0, (lowAvg - 140) / 115);
  const level = Math.min(1, Math.pow(base, 0.9) + transient * 0.35);
  Spectrum.lastBins = bins;
  Spectrum.level = level;
  return level;
}

// ---------------------------
// Audio elements and setup (audible + analysis separated)
// ---------------------------
function ensureAudioElements() {
  let bgm = document.getElementById('bgm');
  if (!bgm) {
    bgm = document.createElement('audio');
    bgm.id = 'bgm';
    bgm.preload = 'auto';
    bgm.crossOrigin = 'anonymous';
    bgm.setAttribute('playsinline', 'playsinline');
    document.body.appendChild(bgm);
  }
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

function ensureBgmAudible(){
  try {
    const { bgm } = ensureAudioElements();
    if (!_audioCtx) return;
    let node;
    if (_mediaSourceMap.has(bgm)) node = _mediaSourceMap.get(bgm);
    else {
      node = _audioCtx.createMediaElementSource(bgm);
      _mediaSourceMap.set(bgm, node);
    }
    // bgm must go BOTH to analyser (for visuals) and to destination (to hear it)
    connectGraph(bgm, node, { toAnalyser:true, toDestination:true });
  } catch(_) {}
}


// ===== Audio analysis init =====
function initAudioAnalysis(elViz){
  if (!elViz) return;

  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = new Ctx();
  }

// Switch analysis source to audible element and ensure it's audible
let srcNode;
if (_mediaSourceMap.has(bgm)) srcNode = _mediaSourceMap.get(bgm);
else {
  srcNode = _audioCtx.createMediaElementSource(bgm);
  _mediaSourceMap.set(bgm, srcNode);
}

// Rebuild analyser (keep same settings)
if (_analyser) { try { _analyser.disconnect(); } catch(_) {} }
_analyser = _audioCtx.createAnalyser();
_analyser.fftSize = 2048;
_analyser.smoothingTimeConstant = 0.65;
_analyser.minDecibels = -100;
_analyser.maxDecibels = -10;

// bgm → analyser AND → destination (so you hear it)
connectGraph(bgm, srcNode, { toAnalyser:true, toDestination:true });

_srcNodeViz = srcNode;
_analysisEl = bgm;

// kick playback if needed
bgm.play().catch(()=>{});

}


// ---------------------------
// Playlist engine
// ---------------------------
function clearCutTimer() {
  if (_cutTimer) { clearTimeout(_cutTimer); _cutTimer = null; }
}
function currentTrack() { return _playlist[_trackIndex] || null; }
function persistTrackIndex() { try { if (_remember) localStorage.setItem(LAST_TRACK_KEY, String(_trackIndex)); } catch(_) {} }

function loadTrackInto(el, track, {applyStart=true} = {}) {
  if (!el || !track) return;
  if (el.src !== track.src) el.src = track.src;

  // Restore prior position
  if (_remember) {
    try {
      const savedPos = parseFloat(localStorage.getItem(POS_KEY_PREFIX + track.src) || '0');
      if (applyStart && Number.isFinite(savedPos) && savedPos > 0) {
        el.currentTime = savedPos;
      }
    } catch(_) {}
  }
  // Optional explicit startAt overrides
  if (applyStart && Number.isFinite(track.startAt) && track.startAt > 0) {
    try { el.currentTime = track.startAt; } catch(_) {}
  }
}

function armDurationCut(bgm, viz, track) {
  clearCutTimer();
  if (!track || !Number.isFinite(track.durationSec) || track.durationSec <= 0) return;
  const schedule = () => {
    clearCutTimer();
    const t0 = Math.max(bgm.currentTime || 0, 0);
    const remainMs = Math.max(0, (track.durationSec - (t0 - (track.startAt||0))) * 1000);
    _cutTimer = setTimeout(() => nextTrack('duration-cut'), remainMs);
  };
  if (Number.isFinite(bgm.duration)) schedule();
  else bgm.addEventListener('loadedmetadata', schedule, { once: true });
}

function wirePositionPersistence(bgm, track) {
  if (!bgm || !track || !_remember) return;
  const key = POS_KEY_PREFIX + track.src;

  let timer = null;
  const save = () => { try { localStorage.setItem(key, String(bgm.currentTime || 0)); } catch(_) {} };

  const onPlay = () => { timer = setInterval(save, 3000); };
  const onPause = () => { if (timer) { clearInterval(timer); timer = null; } };
  const onUnload = () => save();

  if (!bgm._posHandlersWired) {
    bgm.addEventListener('play', onPlay);
    bgm.addEventListener('pause', onPause);
    window.addEventListener('beforeunload', onUnload);
    bgm._posHandlersWired = true;
  }
}

function syncVizToBgm(bgm, viz) {
  const resync = () => {
    try {
      const drift = Math.abs((viz.currentTime || 0) - (bgm.currentTime || 0));
      if (drift > 0.5) viz.currentTime = bgm.currentTime;
    } catch(_) {}
  };
  viz.addEventListener('canplay', () => { try { viz.currentTime = bgm.currentTime || 0; } catch(_) {} });
  bgm.addEventListener('timeupdate', resync);
  const id = setInterval(resync, 4000);
  if (bgm._syncIntervalId) clearInterval(bgm._syncIntervalId);
  bgm._syncIntervalId = id;
}

function loadCurrentTrack({applyStart=true} = {}) {
  const { bgm, viz } = ensureAudioElements();
  const tr = currentTrack();
  if (!tr) return;

  loadTrackInto(bgm, tr, {applyStart});
  loadTrackInto(viz, tr, {applyStart});

  initAudioAnalysis(viz);
  ensureBgmAudible();

if (!bgm.muted) bgm.play().catch(()=>{});
if (viz.paused) viz.play().catch(()=>{});

  bgm.loop = (_loopMode === 'track');
  bgm.volume = _volume;
  viz.loop = (_loopMode === 'track');
  viz.volume = 0;

  armDurationCut(bgm, viz, tr);
  wirePositionPersistence(bgm, tr);
}

function playCurrent() {
  const { bgm, viz } = ensureAudioElements();
  bgm.play().catch(()=>{});
  viz.play().catch(()=>{});
}

function nextTrack(reason='next') {
  clearCutTimer();
  const cur = currentTrack();
  try {
    const { bgm } = ensureAudioElements();
    if (_remember && cur) {
      localStorage.setItem(POS_KEY_PREFIX + cur.src, String(bgm.currentTime || 0));
    }
  } catch(_) {}

  if (_trackIndex < _playlist.length - 1) _trackIndex++;
  else {
    if (_loopMode === 'playlist') _trackIndex = 0;
    else { const { bgm, viz } = ensureAudioElements(); bgm.pause(); viz.pause(); return; }
  }
  persistTrackIndex();
  loadCurrentTrack({applyStart:true});
  playCurrent();
}

function prevTrack() {
  clearCutTimer();
  if (_trackIndex > 0) _trackIndex--;
  else _trackIndex = (_loopMode === 'playlist') ? Math.max(0, _playlist.length - 1) : 0;
  persistTrackIndex();
  loadCurrentTrack({applyStart:true});
  playCurrent();
}

// ---------------------------
// Playlist-aware setupAudio
// ---------------------------
function setupAudio(config) {
  const btn = document.getElementById('audioToggle') || (() => {
    // Fallback: create a minimal toggle if not present
    const b = document.createElement('button');
    b.id = 'audioToggle';
    b.className = 'audio-toggle';
    b.textContent = '🎙️';
    b.style.position = 'fixed';
    b.style.right = '14px';
    b.style.bottom = '14px';
    b.style.zIndex = '50';
    document.body.appendChild(b);
    return b;
  })();
  const { bgm, viz } = ensureAudioElements();
  if (!config) return;

  // Normalize config → playlist
  if (Array.isArray(config.playlist) && config.playlist.length) {
    _playlist = config.playlist.map(t => ({
      src: t.src,
      title: t.title || '',
      startAt: Number.isFinite(t.startAt) ? t.startAt : 0,
      durationSec: Number.isFinite(t.durationSec) ? t.durationSec : undefined
    })).filter(t => !!t.src);
  } else if (config.src) {
    _playlist = [{ src: config.src, title: '', startAt: 0 }];
  } else {
    return;
  }

  _loopMode = (config.loop === 'track' || config.loop === 'playlist') ? config.loop : (config.loop ? 'track' : false);
  _volume = (typeof config.volume === 'number' && config.volume > 0.01) ? config.volume : 0.35;
  _autoplay = (config.autoplay !== false);
  _remember = (config.remember !== false);

  // pick initial track index
  if (_remember) {
    const savedIdx = parseInt(localStorage.getItem(LAST_TRACK_KEY) || '0', 10);
    if (Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < _playlist.length) _trackIndex = savedIdx;
    else _trackIndex = 0;
  } else _trackIndex = 0;

  // Wire mute toggle button
const persistedMute = localStorage.getItem('leumas_audio_muted');
const initiallyMuted = (persistedMute === null) ? false : (persistedMute === 'true');
bgm.muted = initiallyMuted;

  btn.hidden = false;
  btn.setAttribute('aria-pressed', String(initiallyMuted));
  btn.textContent = initiallyMuted ? '🔇' : '🎙️';

  if (!btn._wired) {
    btn.onclick = () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      const nowMuted = !pressed;
      btn.setAttribute('aria-pressed', String(nowMuted));
      btn.textContent = nowMuted ? '🔇' : '🎙️';
      localStorage.setItem('leumas_audio_muted', String(nowMuted));
      bgm.muted = nowMuted;
      if (!nowMuted && bgm.paused) bgm.play().catch(()=>{});
      if (viz.paused) viz.play().catch(()=>{});
    };
    btn._wired = true;
  }

  // When a track ends naturally
  bgm.onended = () => {
    if (_loopMode === 'track') {
      loadCurrentTrack({applyStart:true});
      playCurrent();
    } else {
      nextTrack('ended');
    }
  };

  // Load and (if already clicked splash) autoplay
  loadCurrentTrack({applyStart:true});
  syncVizToBgm(bgm, viz);

  if (_userGestureHappened && _autoplay) {
    bgm.play().catch(()=>{});
    viz.play().catch(()=>{});
  }

  // Optional global controls
  window.LeumasAudio = {
    next: () => nextTrack('api'),
    prev: () => prevTrack(),
    get index() { return _trackIndex; },
    get track() { return currentTrack(); },
    setVolume(v) { _volume = Math.max(0, Math.min(1, v)); const { bgm } = ensureAudioElements(); bgm.volume = _volume; },
    setLoop(mode) { _loopMode = (mode==='track'||mode==='playlist') ? mode : false; const { bgm, viz } = ensureAudioElements(); bgm.loop = (mode==='track'); viz.loop = (mode==='track'); }
  };
}

// ---------------------------
// Splash Overlay (Click-to-Start)
// ---------------------------
function createSplashOverlay() {
  // Styles
  const css = `
  #splashOverlay {
    position: fixed; inset: 0; z-index: 9999; overflow: hidden;
    display: grid; place-items: center; background: radial-gradient(1200px 800px at 50% 40%, #0b1530 0%, #050912 50%, #02050a 100%);
    color: #e8f4ff; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  }
  #splashOverlay.fade-out { opacity: 0; transition: opacity .6s ease; pointer-events: none; }
  #splashSky, #splashNebula {
    position: absolute; inset: 0; width: 100%; height: 100%; display:block;
  }
  #splashNebula { mix-blend-mode: screen; opacity: .65; }
  .splash-center {
    position: relative; z-index: 2; text-align: center; padding: 24px 18px; max-width: 900px;
  }
  .splash-logo {
    width: 220px; height: auto; opacity: .95; filter: drop-shadow(0 6px 30px rgba(120,210,255,.25));
    transform: translateZ(0);
  }
  .splash-title {
    margin: 18px 0 8px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    background: linear-gradient(90deg, #9fd2ff, #d4e9ff 40%, #9fd2ff 80%); -webkit-background-clip: text; background-clip: text; color: transparent;
    text-shadow: 0 0 20px rgba(140,200,255,.18), 0 0 40px rgba(140,200,255,.12);
    font-size: clamp(24px, 5vw, 40px);
  }
  .splash-tag {
    color: #9bb7d8; margin-bottom: 18px; font-size: clamp(14px, 2.6vw, 16px);
  }
  .splash-cta {
    display: inline-flex; gap: 10px; align-items: center; justify-content: center;
    padding: 12px 18px; border-radius: 999px; border: 1px solid rgba(150,210,255,.35);
    background: linear-gradient(180deg, rgba(20,40,80,.65), rgba(8,16,32,.65));
    box-shadow: 0 10px 40px rgba(80,160,255,.25), inset 0 1px 0 rgba(255,255,255,.08);
    color: #e8f4ff; font-weight: 700; letter-spacing:.02em; cursor: pointer; user-select:none; -webkit-user-select:none;
    transform: translateZ(0);
  }
  .splash-cta:hover { box-shadow: 0 12px 48px rgba(80,160,255,.33), inset 0 1px 0 rgba(255,255,255,.12); transform: translateY(-1px); }
  .splash-cta:active { transform: translateY(0); }
  .pulse {
    width: 9px; height: 9px; border-radius: 999px; background: #9fd2ff; position: relative;
  }
  .pulse::after {
    content:''; position:absolute; inset:-8px; border-radius:999px; border:2px solid rgba(160,210,255,.55); animation: pulse 1.6s infinite ease-out;
  }
  @keyframes pulse {
    0% { transform: scale(.6); opacity: .9; }
    100% { transform: scale(1.6); opacity: 0; }
  }
  .splash-foot {
    margin-top: 12px; font-size: 12px; color: #7aa7d7; opacity:.9;
  }`;
  const style = document.createElement('style');
  style.id = 'splashStyles';
  style.textContent = css;
  document.head.appendChild(style);

  // Structure
  const overlay = document.createElement('div');
  overlay.id = 'splashOverlay';
  overlay.innerHTML = `
    <canvas id="splashSky" aria-hidden="true"></canvas>
    <canvas id="splashNebula" aria-hidden="true"></canvas>
    <div class="splash-center">
      <img class="splash-logo" src="https://res.cloudinary.com/dx25lltre/image/upload/v1707175639/Leumas/Leumas_Tech_Logo_900_x_300_io3gk6.png" alt="Leumas Tech logo" />
      <div class="splash-title">Leumas Technologies</div>
      <div class="splash-tag">Dream • Build • Deploy — Crafted Systems & Adaptive Intelligence</div>
      <button id="splashStart" class="splash-cta" aria-label="Click to get started">
        <span class="pulse" aria-hidden="true"></span>
        Click to get started
      </button>
      <div class="splash-foot">Tip: audio starts after you click</div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Starfield + nebula anim (independent of main)
  const sky = overlay.querySelector('#splashSky');
  const neb = overlay.querySelector('#splashNebula');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W=0, H=0, t=0;

  function resize() {
    W = sky.width = Math.floor(window.innerWidth * DPR);
    H = sky.height = Math.floor(window.innerHeight * DPR);
    sky.style.width = window.innerWidth + 'px';
    sky.style.height = window.innerHeight + 'px';

    neb.width = W; neb.height = H;
    neb.style.width = window.innerWidth + 'px';
    neb.style.height = window.innerHeight + 'px';

    spawnStars();
  }
  const layers = [
    { depth:.35, color:[210,235,255], stars:[], count:0 },
    { depth:.75, color:[180,215,255], stars:[], count:0 },
    { depth:1.2, color:[150,195,255], stars:[], count:0 },
  ];
  function spawnStars(){
    const base = (W*H)/(9000*DPR);
    layers[0].count = Math.floor(base*.85);
    layers[1].count = Math.floor(base*1.0);
    layers[2].count = Math.floor(base*1.25);
    layers.forEach(L=>{
      L.stars = Array.from({length:L.count}, ()=>({
        x: Math.random()*W, y: Math.random()*H,
        s: (Math.random()*1.4 + 0.3)*DPR*(0.7+L.depth*0.5),
        a: 0.4 + Math.random()*0.6,
        tw: Math.random()*0.015 + 0.003,
      }));
    });
  }
  function frame(){
    t++;
    const ctx = sky.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    // nebula glow
    const nx = neb.getContext('2d');
    nx.setTransform(1,0,0,1,0,0);
    nx.clearRect(0,0,W,H);
    const g1 = nx.createRadialGradient(W*0.35,H*0.4, 0, W*0.35,H*0.4, Math.max(W,H)*0.6);
    g1.addColorStop(0, 'rgba(90,140,255,0.18)');
    g1.addColorStop(1, 'rgba(90,140,255,0)');
    nx.fillStyle = g1; nx.fillRect(0,0,W,H);
    const g2 = nx.createRadialGradient(W*0.7,H*0.65, 0, W*0.7,H*0.65, Math.max(W,H)*0.55);
    g2.addColorStop(0, 'rgba(160,220,255,0.14)');
    g2.addColorStop(1, 'rgba(160,220,255,0)');
    nx.fillStyle = g2; nx.fillRect(0,0,W,H);

    layers.forEach(L=>{
      const [r,g,b] = L.color;
      L.stars.forEach(s=>{
        s.a += (Math.random()-0.5)*s.tw;
        s.a = Math.max(0.15, Math.min(1, s.a));
        ctx.globalAlpha = s.a;
        ctx.fillStyle = `rgba(${r},${g},${b},1)`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.s, 0, Math.PI*2); ctx.fill();

        ctx.globalAlpha = s.a * 0.25;
        ctx.fillStyle = `rgba(${Math.max(120,r-20)},${Math.min(230,g+10)},255,1)`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.s*(2.5 + Math.sin((t+s.x*.01)*.03)*.4), 0, Math.PI*2); ctx.fill();
      });
    });

    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  resize(); frame();

  // Unlock + route on click
  overlay.querySelector('#splashStart').addEventListener('click', async () => {
    _userGestureHappened = true;

    // Initialize / resume AudioContext right now (gesture)
    if (!_audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) _audioCtx = new Ctx();
    } else if (_audioCtx.state === 'suspended') {
      try { await _audioCtx.resume(); } catch {}
    }

    // Route into resume portal (this triggers fetch → renderAside → setupAudio)
    go('resume');

    // Fade out and remove
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      const s = document.getElementById('splashStyles');
      if (s) s.remove();
    }, 620);
  });
}

// ---------------------------
// Starfield + visuals (main background)
// ---------------------------
function initStars() {
  const canvas = document.getElementById('stars');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W=0, H=0, DPR=Math.min(2, window.devicePixelRatio||1);
  let cx=0, cy=0, t=0;

  const Beat2 = {
    avg:0, dev:0, last:0, cooldown:140, kAvg:0.02, kDev:0.04, sens:1.22,
    step(v){ this.avg+=(v-this.avg)*this.kAvg; const d=Math.abs(v-this.avg); this.dev+=(d-this.dev)*this.kDev;
      const now=performance.now(); const th=this.avg+this.dev*this.sens; const hit=v>th && (now-this.last>this.cooldown); if(hit) this.last=now; return hit; }
  };

  const layers = [
    { depth:.3,  stars:[], count:0, color:[205,230,255] },
    { depth:.7,  stars:[], count:0, color:[175,210,255] },
    { depth:1.1, stars:[], count:0, color:[150,190,255] }
  ];
  const ripples = [];

  class Ripple2 {
    constructor(r0, power){ this.r=r0; this.a=0.18+power*0.22; this.w=12+power*30; this.g=4+power*42; this.fade=0.985; }
    step(){ this.r+=this.g; this.a*=this.fade; return this.a>0.01; }
    draw(){
      const g = ctx.createRadialGradient(cx, cy, this.r, cx, cy, this.r + this.w);
      g.addColorStop(0, `rgba(140,190,255,${this.a})`);
      g.addColorStop(1, `rgba(140,190,255,0)`);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, this.r + this.w, 0, Math.PI*2);
      ctx.arc(cx, cy, this.r, 0, Math.PI*2, true); ctx.fill();
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
        return { angle, dist, r, a: 0.35 + Math.random()*0.65, tw: Math.random()*0.02 + 0.006, seed: (i%97)*0.017 };
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

  let burst = 0;

  function frame(){
    t++;
    const L = sampleMusicLevel();
    const beat = Beat2.step(L);
    if (L > 0.48) burst = Math.min(1, burst + 0.12); else burst *= 0.94;
    if (beat) ripples.push(new Ripple2(80 + Math.random()*40, Math.min(1, L*1.4)));

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    const shake = L>0.1 ? (L*5*DPR) : 0;
    const offX = (Math.sin(t*0.07)+Math.sin(t*0.013+1.2))*shake*0.5;
    const offY = (Math.cos(t*0.05)+Math.sin(t*0.017-0.6))*shake*0.5;

    const coreR = (52 + L*110)*DPR;
    const core = ctx.createRadialGradient(cx+offX, cy+offY, 0, cx+offX, cy+offY, coreR*1.75);
    core.addColorStop(0,'rgba(0,0,0,1)');
    core.addColorStop(0.55,'rgba(0,0,0,0.96)');
    core.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0,0,W,H);

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

    for (let i=ripples.length-1; i>=0; i--){
      ripples[i].draw();
      if (!ripples[i].step()) ripples.splice(i,1);
    }

    layers.forEach(Lr=>{
      const [cr,cg,cb] = Lr.color;
      const swirl = (0.00035 + L*0.004) * (0.6 + Lr.depth*0.9);
      const pull  = 0.9995 + L*0.0015;

      const dup = burst>0.25 ? 1 + Math.floor(burst*2) : 1;

      for (const s of Lr.stars){
        const wobble = Math.sin(t*0.03 + s.seed*10) * 0.002 * (1 + L*3);
        s.angle += swirl + wobble;
        s.dist  *= pull;
        if (s.dist < coreR*0.9) {
          s.dist = Math.random()*Math.min(W,H)*0.55 + coreR*1.2;
          s.angle = Math.random()*Math.PI*2;
          s.a = 0.35 + Math.random()*0.65;
        }
        const x = cx + offX + Math.cos(s.angle)*s.dist;
        const y = cy + offY + Math.sin(s.angle)*s.dist;
        const sizeBoost = 1 + L*0.6 + burst*0.8;
        const rad = s.r * (0.7 + Lr.depth*0.6) * sizeBoost;
        s.a += (Math.random()-0.5) * s.tw * (1 + L*3);
        s.a = Math.max(0.18, Math.min(1, s.a));
        for (let d=0; d<dup; d++){
          const jx = d===0 ? 0 : (Math.random()-0.5) * DPR*(1 + L*2);
          const jy = d===0 ? 0 : (Math.random()-0.5) * DPR*(1 + L*2);
          ctx.globalAlpha = s.a;
          ctx.fillStyle = `rgba(${cr},${cg},${cb},1)`;
          ctx.beginPath(); ctx.arc(x+jx, y-jy, rad, 0, Math.PI*2); ctx.fill();
          ctx.globalAlpha = s.a * (0.22 + L*0.38) * (0.6 + Lr.depth*0.7);
          ctx.fillStyle = `rgba(${Math.max(120,cr-20)},${Math.min(230,cg+10)},255,1)`;
          ctx.beginPath(); ctx.arc(x+jx, y-jy, rad*(2.1 + L*2.4), 0, Math.PI*2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    });

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


// ===== REPLACE your initAudioAnalysis(...) with THIS =====
let _analysisEl = null;
let _silentFrames = 0;

function initAudioAnalysis(elViz){
  if (!elViz) return;

  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = new Ctx();
  }

  // Reuse/create source node for chosen element
  let srcNode;
  if (_mediaSourceMap.has(elViz)) {
    srcNode = _mediaSourceMap.get(elViz);
  } else {
    srcNode = _audioCtx.createMediaElementSource(elViz);
    _mediaSourceMap.set(elViz, srcNode);
  }

  // (Re)create analyser
  if (_analyser) { try { _analyser.disconnect(); } catch(_) {} }
  _analyser = _audioCtx.createAnalyser();
  _analyser.fftSize = 2048;
  _analyser.smoothingTimeConstant = 0.65;
  _analyser.minDecibels = -100;
  _analyser.maxDecibels = -10;

  // Connect: viz → analyser (NOT to destination, it's muted)
  connectGraph(elViz, srcNode, { toAnalyser:true, toDestination:false });

  _srcNodeViz = srcNode;
  _analysisEl = elViz;
}


// Helper: ensure analyser is getting non-zero data; if not, swap to bgm
function ensureAnalyserSignal() {
  if (!_analyser) return null;
  const bins = new Uint8Array(_analyser.frequencyBinCount);
  _analyser.getByteFrequencyData(bins);

  let maxv = 0, sum = 0;
  for (let i = 0; i < bins.length; i++) { const v = bins[i]; if (v > maxv) maxv = v; sum += v; }

  if (maxv < 1) {
    _silentFrames++;
    if (_silentFrames > 24) { // ~0.4s @ 60fps
      const { bgm } = ensureAudioElements();
      if (bgm && _analysisEl !== bgm) {
        // Switch analysis source to audible element
        let srcNode;
        if (_mediaSourceMap.has(bgm)) srcNode = _mediaSourceMap.get(bgm);
        else {
          srcNode = _audioCtx.createMediaElementSource(bgm);
          _mediaSourceMap.set(bgm, srcNode);
        }
        try {
          if (_analyser) { try { _analyser.disconnect(); } catch(_) {} }
          _analyser = _audioCtx.createAnalyser();
          _analyser.fftSize = 2048;
          _analyser.smoothingTimeConstant = 0.65;
          _analyser.minDecibels = -100;
          _analyser.maxDecibels = -10;
          srcNode.connect(_analyser);
          _srcNodeViz = srcNode;
          _analysisEl = bgm;
        } catch(_) {}
      }
      _silentFrames = 0;
    }
  } else {
    _silentFrames = 0;
  }
  return bins;
}

// Track which MediaElementSources are connected to destination
// Route helpers
const _destConnected = new WeakSet();

function connectGraph(el, srcNode, { toAnalyser=true, toDestination=false }) {
  try {
    if (toAnalyser && _analyser) srcNode.connect(_analyser);
    if (toDestination && !_destConnected.has(srcNode)) {
      srcNode.connect(_audioCtx.destination);
      _destConnected.add(srcNode);
    }
  } catch(_) {}
}



function initChladniBackground() {
  const STAR_ID = 'stars';
  const CHLADNI_ID = 'chladniBG';
  if (document.getElementById(CHLADNI_ID)) return;

  const style = document.createElement('style');
  style.textContent = `
    #${STAR_ID}{ position:fixed; inset:0; z-index:1; }
    #${CHLADNI_ID}{ position:fixed; inset:0; z-index:0; pointer-events:none; opacity:.18;
      mix-blend-mode:screen; filter:saturate(1.08) hue-rotate(6deg); }
    @supports not (mix-blend-mode: screen){ #${CHLADNI_ID}{ opacity:.12; } }
    @media (prefers-reduced-motion: reduce){ #${CHLADNI_ID}{ display:none; } }
  `;
  document.head.appendChild(style);

  const cv = document.createElement('canvas');
  cv.id = CHLADNI_ID;
  const stars = document.getElementById(STAR_ID);
  if (stars && stars.parentNode) stars.parentNode.insertBefore(cv, stars);
  else document.body.prepend(cv);

  const ctx = cv.getContext('2d', { alpha:true, desynchronized:true });
  let W=0, H=0, DPR=Math.min(2, window.devicePixelRatio||1);
  function resize(){ DPR=Math.min(2,window.devicePixelRatio||1);
    W=cv.width=Math.floor(innerWidth*DPR); H=cv.height=Math.floor(innerHeight*DPR);
    cv.style.width=innerWidth+'px'; cv.style.height=innerHeight+'px'; }
  addEventListener('resize', resize, { passive:true }); resize();

  const GRID=6, BASE_THRESH=0.055, FADE=0.085;
  const BLUR1=()=>Math.max(1, GRID*0.75), BLUR2=()=>Math.max(1.4, GRID);
  const off=document.createElement('canvas'), octx=off.getContext('2d');
  const { bgm } = (typeof ensureAudioElements==='function') ? ensureAudioElements() : { bgm:null };

  // smoothing for parameters
  const smooth = (prev, next, k=0.25)=> prev==null ? next : prev + (next-prev)*k;
  let prevA=null, prevB=null, prevC=null, prevD=null, prevPhaseMul=null, prevThresh=null;

  function bandWeightedCenter(bins, lo, hi){
    const L = bins.length;
    const ia = Math.max(0, Math.floor(L*lo));
    const ib = Math.min(L-1, Math.floor(L*hi));
    let wsum = 0, isum = 0;
    for (let i=ia;i<=ib;i++){ const v=bins[i]; wsum += v; isum += v * i; }
    const idx = wsum > 0 ? (isum / wsum) : (ia + ib) * 0.5;
    return idx / (L-1); // 0..1
  }

  function modesFromSpectrum() {
    // keep analyser alive & detect silence (swap to bgm if needed)
    const bins = ensureAnalyserSignal();
    if (!bins) return { a:3, b:4, c:5, d:2, phaseMul:1.0, thresh:BASE_THRESH };

    // level
    let sum=0; for (let i=0;i<bins.length;i++) sum+=bins[i];
    const lvl = sum / (bins.length * 255);
    Spectrum.level = lvl;
    Spectrum.lastBins = bins;

    // 4 semi-log bands → weighted centers
    const cA = bandWeightedCenter(bins, 0.01, 0.06); // sub/low
    const cB = bandWeightedCenter(bins, 0.06, 0.16); // low-mid
    const cC = bandWeightedCenter(bins, 0.16, 0.32); // high-mid
    const cD = bandWeightedCenter(bins, 0.32, 0.60); // treble

    // map centers to 1..10 (like your sliders)
    const mapMode = c => Math.max(1, Math.min(10, Math.round(1 + c * 9)));

    let a = mapMode(cA), b = mapMode(cB), c = mapMode(cC), d = mapMode(cD);

    // light smoothing so modes glide with music
    a = prevA = smooth(prevA, a, 0.35);
    b = prevB = smooth(prevB, b, 0.35);
    c = prevC = smooth(prevC, c, 0.35);
    d = prevD = smooth(prevD, d, 0.35);

    // dynamics
    const phaseMul = prevPhaseMul = smooth(prevPhaseMul, 0.9 + lvl*1.3, 0.25);
    const thresh   = prevThresh   = Math.max(0.028, smooth(prevThresh, BASE_THRESH - lvl*0.02, 0.3));

    return { a, b, c, d, phaseMul, thresh };
  }

  function chladni(nx, ny, t, A){
    return (
      Math.sin(A.a * Math.PI * nx + t) * Math.sin(A.b * Math.PI * ny + t) +
      Math.sin(A.c * Math.PI * nx - t) * Math.sin(A.d * Math.PI * ny - t)
    );
  }

  function frame(){
    const P = modesFromSpectrum();
    const tSong = (bgm && Number.isFinite(bgm.currentTime)) ? bgm.currentTime : performance.now()/1000;
    const phase = tSong * (P.phaseMul || 1);

    // fade trail (embed in universe)
    ctx.globalCompositeOperation='source-over';
    ctx.fillStyle=`rgba(0,0,0,${FADE})`;
    ctx.fillRect(0,0,W,H);

    // draw at low-res then upscale with glow
    off.width = Math.ceil(W/GRID); off.height = Math.ceil(H/GRID);
    const img = octx.getImageData(0,0,off.width,off.height);
    const data = img.data;

    const t = P.thresh || BASE_THRESH;
    const lv = Math.min(1, (Spectrum.level||0) * 1.5 + 0.25);

    let p=0;
    for (let y=0;y<off.height;y++){
      const ny = y/off.height;
      for (let x=0;x<off.width;x++){
        const nx = x/off.width;
        const z = chladni(nx, ny, phase, P);
        if (Math.abs(z) < t){
          data[p]   = Math.floor(170 + 40*lv);
          data[p+1] = Math.floor(210 + 20*lv);
          data[p+2] = 255;
          data[p+3] = Math.floor(150 + 80*lv);
        } else {
          data[p+3] = 0;
        }
        p += 4;
      }
    }
    octx.putImageData(img, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.filter = `blur(${BLUR1()}px)`;
    ctx.drawImage(off, 0, 0, W, H);
    ctx.filter = `blur(${BLUR2()}px)`;
    ctx.drawImage(off, 0, 0, W, H);
    ctx.restore();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}



// ---------------------------
// Aside renderer (with audio button state) + calls setupAudio
// ---------------------------
function renderAside(profile, resumeData) {
  if (!profile) return;

  // Supports {audio:{src}} or {audio:{playlist:[...]}}
  if (profile.audio) {
    setupAudio(profile.audio);
  }

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

  const ctaHire = document.getElementById('ctaHire');
  if (ctaHire) {
    if (profile.hireUrl) { ctaHire.hidden = false; ctaHire.href = profile.hireUrl; }
    else { ctaHire.hidden = true; }
  }

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
    <div class="card" data-docid="about#headline">
      <h2 class="h">${about.headline}</h2>
      ${about.paragraphs.map(p => `<p class="lead">${p}</p>`).join('')}
      <div class="sp-16"></div>
      <h3 class="section-title">What I'm Doing</h3>
      <div class="grid two doing">
        ${about.doing.map((d, i) => `
          <div class="item card" data-docid="about#doing#${i}">
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
    initViewAnimations(view); // ← add

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
            <span class="skill-badge${keyCls}" role="listitem" tabindex="0" data-docid="skill#${idx}">
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
          ${resume.education.map((e, i) => `
            <div class="trow" data-docid="edu#${i}">
              <div class="t-when">${e.period}</div>
              <div class="t-what">${[e.school, e.degree].filter(Boolean).join(' — ') || e.school}</div>
              ${e.detail ? `<div class="t-desc">${e.detail}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">Experience</h3>
        <div class="timeline">
          ${resume.experience.map((x, i) => `
            <div class="trow" data-docid="exp#${i}">
              <div class="t-when">${x.period}</div>
              <div class="t-what">${[x.role, x.company].filter(Boolean).join(' — ')}</div>
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
    initViewAnimations(view); // ← add

}

function renderPortfolio(categories, items) {
  const filtersHTML = categories
    .map((c, i) => `<button class="filter${c==='All'?' active':''}" data-cat="${c}" aria-pressed="${c==='All'?'true':'false'}" ${i===0?'data-initial':''}>${c}</button>`)
    .join('');

  view.innerHTML = `
    <div class="card">
      <div class="filters" role="tablist" aria-label="Portfolio categories">
        ${filtersHTML}
      </div>
      <div class="gallery" id="gallery">
        ${items.map((i,idx)=>tile(i, idx)).join('')}
      </div>
    </div>
  `;
  initViewAnimations(view); // ← add

  const gal = document.getElementById('gallery');
  attachTileFX(gal);

  const filterBtns = [...document.querySelectorAll('.filter')];
  let activeIndex = filterBtns.findIndex(b => b.classList.contains('active'));
  filterBtns.forEach((b, idx) => {
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        activeIndex = (idx + (e.key === 'ArrowRight' ? 1 : -1) + filterBtns.length) % filterBtns.length;
        filterBtns[activeIndex].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        b.click();
      }
    });
  });

  document.querySelectorAll('.filter').forEach(b => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.filter').forEach(x => {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');

      const cat = b.dataset.cat;
      gal.innerHTML = skeletonTiles(6);

      try {
        const res = await fetch(`/api/portfolio?cat=${encodeURIComponent(cat)}`);
        const data = await res.json();
        gal.classList.add('fade-out');
        setTimeout(() => {
          gal.innerHTML = (data.items || []).map((i,idx)=>tile(i, idx)).join('') || emptyState();
          gal.classList.remove('fade-out');
          attachTileFX(gal);
          window.LeumasSearch && window.LeumasSearch.ingest('portfolio', data).catch(()=>{});
        }, 180);
      } catch (e) {
        gal.innerHTML = errorState();
      }
    });
  });

  function tile(i, idx) {
    const href = i.link || '#';
    const target = i.link ? '_blank' : '_self';
    const cat = i.cat || i.category || 'Project';
    const desc = i.desc || i.description || '';
    const badge = `<span class="badge">${cat}</span>`;
    const safeTitle = (i.title || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const slug = (i.id ? String(i.id) : (i.title||'') ).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || idx;
    const docid = `portfolio#${slug}`;
    return `
      <a class="tile" href="${href}" target="${target}" rel="noopener" aria-label="${safeTitle}" data-docid="${docid}">
        <figure class="tile-inner">
          <img src="${i.thumb}" alt="${safeTitle}" loading="lazy" decoding="async">
          <figcaption class="cap">
            <span class="cap-title">${safeTitle}</span>
            ${badge}
            ${desc ? `<span class="cap-desc">${desc}</span>` : ``}
          </figcaption>
        </figure>
      </a>`;
  }

  function skeletonTiles(n=6){
    return Array.from({length:n}).map(() => `
      <div class="tile sk">
        <div class="sk-img"></div>
        <div class="sk-line"></div>
        <div class="sk-line w60"></div>
      </div>
    `).join('');
  }

  function emptyState(){
    return `
      <div class="empty-state">
        <div class="empty-ring"></div>
        <p>No projects in this category—try another filter.</p>
      </div>
    `;
  }

  function errorState(){
    return `
      <div class="empty-state">
        <div class="empty-ring err"></div>
        <p>Couldn’t load projects. Please try again.</p>
      </div>
    `;
  }

  function attachTileFX(root){
    const tiles = root.querySelectorAll('.tile');
    const io = new IntersectionObserver((ents) => {
      ents.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, {threshold: 0.12});
    tiles.forEach(t => io.observe(t));

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    tiles.forEach(t => {
      t.addEventListener('pointermove', (e) => {
        const r = t.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        const rx = ((cy / r.height) - 0.5) * -4;
        const ry = ((cx / r.width) - 0.5) * 6;
        t.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
      });
      t.addEventListener('pointerleave', () => { t.style.transform = ''; });
    });
  }
}

function renderBlog(posts) {
  view.innerHTML = `
    <div class="grid two">
      ${posts.map((p, idx) => `
        <article class="post" data-docid="blog#${(p.id || (p.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')) || idx}">
          <h3 class="what">${p.title}</h3>
          <div class="meta">${new Date(p.date).toLocaleDateString()}</div>
          <p class="muted">${p.excerpt}</p>
          <a class="links" href="${p.url}" target="_blank" rel="noopener">Read →</a>
        </article>
      `).join('')}
    </div>
  `;
    initViewAnimations(view); // ← add

}

function renderContact(contact = {}) {
  const defaultAddr = "7106 W Grand Ave, Chicago, IL 60707";
  const addr = (contact.location && String(contact.location).trim()) || defaultAddr;
  const q = encodeURIComponent(addr);
  const mapsEmbed = `https://www.google.com/maps?q=${q}&output=embed`;
  const mapsLink  = `https://www.google.com/maps/search/?api=1&query=${q}`;

  view.innerHTML = `
    <section class="contact-wrap">
      <div class="contact-card">
        <header class="contact-head">
          <h2 class="h">Let’s build something great</h2>
          <p class="muted">Tell us what you have in mind—we’ll get back fast.</p>
        </header>

        <div class="contact-grid">
          <form id="cform" class="form card-pane" novalidate>
            <input type="text" name="company" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
            <label class="label">Your name
              <input class="input" name="name" placeholder="Jane Doe" required>
            </label>
            <label class="label">Your email
              <input class="input" name="email" type="email" placeholder="you@domain.com" required>
            </label>
            <label class="label">Message
              <textarea class="textarea" name="message" rows="6" placeholder="What are we building?" required></textarea>
            </label>

            <div class="row">
              <button class="btn" type="submit">
                <span class="btn-label">Send message</span>
                <span class="btn-spinner" aria-hidden="true"></span>
              </button>
              <span class="form-note" id="formNote" role="status" aria-live="polite"></span>
            </div>
          </form>

          <aside class="details card-pane">
            <div class="detail-row" data-docid="contact#email">
              <div class="detail-k">Email</div>
              <div class="detail-v">
                ${contact.email ? `<a href="mailto:${contact.email}">${contact.email}</a>` : "—"}
              </div>
            </div>
            <div class="detail-row" data-docid="contact#phone">
              <div class="detail-k">Phone</div>
              <div class="detail-v">
                ${contact.phone ? `<a href="tel:${contact.phone}">${contact.phone}</a>` : "—"}
              </div>
            </div>
            <div class="detail-row" data-docid="contact#location">
              <div class="detail-k">Location</div>
              <div class="detail-v">
                <a href="${mapsLink}" target="_blank" rel="noopener">${addr}</a>
              </div>
            </div>

            <div class="map-wrap">
              <iframe
                class="map"
                src="${mapsEmbed}"
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                aria-label="Map showing ${addr}">
              </iframe>
              <a class="map-cta" href="${mapsLink}" target="_blank" rel="noopener">Open in Google Maps</a>
              <details class="map-alt">
                <summary>Can’t see the map?</summary>
                <a href="https://www.openstreetmap.org/search?query=${q}" target="_blank" rel="noopener">
                  View on OpenStreetMap
                </a>
              </details>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `;
  initViewAnimations(view); // ← add

  const note = document.getElementById('formNote');
  const form = document.getElementById('cform');
  const btn = form?.querySelector('.btn');
  const btnLabel = form?.querySelector('.btn-label');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.querySelector('input[name="company"]').value) return;
    if (!form.checkValidity()) { note.textContent = "Please fill out all fields correctly."; return; }
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    form.classList.add('is-loading');
    btn?.setAttribute('disabled', 'true');
    if (btnLabel) btnLabel.textContent = "Sending…";

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const out = await res.json();
      if (out.ok) { note.textContent = "Thanks — message sent!"; form.reset(); }
      else { note.textContent = "Error: " + (out.error || "Something went wrong."); }
    } catch {
      note.textContent = "Network error while sending.";
    } finally {
      form.classList.remove('is-loading');
      btn?.removeAttribute('disabled');
      if (btnLabel) btnLabel.textContent = "Send message";
    }
  });
}

// Called by search.js on result click
window.navigateToSearchHit = function(hit){
  if (!hit) return;
  const { tab, id } = hit;
  go(tab).then(()=>{
    setTimeout(()=>{
      try {
        const target = id ? document.querySelector(`[data-docid="${CSS.escape(id)}"]`) : null;
        if (target){
          target.scrollIntoView({ behavior:'smooth', block:'center' });
          target.classList.add('search-jump');
          setTimeout(()=>target.classList.remove('search-jump'), 1600);
        }
      } catch(_) {}
    }, 120);
  });
};

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

// Create splash immediately (captures gesture), then route
createSplashOverlay();

// Initial route (preload something behind splash)
const initial = (location.hash.replace('#/', '') || 'about');
go(initial);

// Init backgrounds (Chladni beneath stars), then search
initChladniBackground(); // ← audio-locked Chladni background (behind)
initStars();
window.LeumasSearch && window.LeumasSearch.attachUI && window.LeumasSearch.attachUI();

// ===== Optional: Next/Prev buttons if present =====
const btnNext = document.getElementById('audioNext');
const btnPrev = document.getElementById('audioPrev');
btnNext && (btnNext.onclick = () => window.LeumasAudio?.next());
btnPrev && (btnPrev.onclick = () => window.LeumasAudio?.prev());
