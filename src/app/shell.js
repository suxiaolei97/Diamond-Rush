/*
 * Diamond Rush -- browser shell: responsive scaling, keyboard + touch controls,
 * audio unlock and VM boot. Works from file:// (no modules, no fetch).
 */
'use strict';

(function () {

  function parseManifest() {
    var props = {};
    try {
      var bytes = VM.base64ToBytes(VM_RESOURCES['META-INF/MANIFEST.MF']);
      var text = '';
      for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      var lines = text.split(/\r?\n/);
      var key = null, cur = '';
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.length && (line.charAt(0) === ' ' || line.charAt(0) === '\t')) { cur += line.replace(/^\s+/, ''); continue; }
        if (key !== null) props[key] = cur;
        var idx = line.indexOf(':');
        if (idx < 0) { key = null; cur = ''; continue; }
        key = line.substring(0, idx).replace(/\s+$/, '');
        cur = line.substring(idx + 1).replace(/^\s+/, '');
      }
      if (key !== null) props[key] = cur;
    } catch (e) { }
    props['microedition.platform'] = 'j2me';
    props['microedition.locale'] = currentLocale();
    return props;
  }

  var LOCALES = ['zh-CN', 'zh-TW', 'en-US'];
  var LOCALE_LABELS = { 'zh-CN': '简', 'zh-TW': '繁', 'en-US': 'EN' };
  function currentLocale() {
    var v = null;
    try { v = localStorage.getItem('dr_locale'); } catch (e) { }
    if (!v || LOCALES.indexOf(v) < 0) v = 'zh-CN';
    return v;
  }
  function cycleLocale() {
    var cur = currentLocale();
    var next = LOCALES[(LOCALES.indexOf(cur) + 1) % LOCALES.length];
    try { localStorage.setItem('dr_locale', next); } catch (e) { }
    location.reload();
  }

  // ---------------- audio ----------------
  var tonePref = true;
  try { tonePref = localStorage.getItem('dr_tone') !== '0'; } catch (e) { }

  function updateToneButton(on) {
    var b = document.getElementById('btn-tone');
    if (!b) return;
    b.hidden = false;
    b.textContent = on ? 'SF' : 'SYN';
    b.title = on ? '音色：诺基亚原机采样（点击切到内置合成器）' : '音色：内置合成器（点击切到诺基亚原机采样）';
  }

  function applyTone(engine) {
    if (!engine || !engine.hasTone) return;
    updateToneButton(engine.setTone(tonePref));
  }

  function toggleTone() {
    tonePref = !tonePref;
    try { localStorage.setItem('dr_tone', tonePref ? '1' : '0'); } catch (e) { }
    applyTone(deferredAudio.engine);
  }

  var deferredAudio = {
    last: null,
    engine: null,
    play: function (player, vol) { this.last = player; },
    stop: function (player) { if (this.last === player) this.last = null; },
    setVolume: function () { },
    unlock: function () {
      if (this.engine) return;
      this.engine = MIDI.unlockAudio();
      if (this.engine) {
        applyTone(this.engine);
        VM.instances.audio = this.engine;
        if (this.last && this.last.$state === 400) {
          this.engine.play(this.last, this.last.$volume);
        }
      }
    }
  };

  // ---------------- orientation / asset variants ----------------
  // The portrait original and the 320x240 Diamond_CP builds are shipped
  // side by side. The mode cycles auto -> landscape -> portrait -> auto:
  // "auto" follows the window aspect and reloads on rotation/resize.
  function hasLandscape() {
    return typeof VM_CLASSES_L !== 'undefined' && !!VM_CLASSES_L;
  }

  function orientPref() {
    try { return localStorage.getItem('dr_orient'); } catch (e) { return null; }
  }

  function setOrientPref(v) {
    try {
      if (v) localStorage.setItem('dr_orient', v);
      else localStorage.removeItem('dr_orient');
    } catch (e) { }
  }

  function autoOrient() {
    var wide = (typeof window !== 'undefined') && window.innerWidth > window.innerHeight;
    return (wide && hasLandscape()) ? 'l' : 'p';
  }

  function currentOrient() {
    var p = orientPref();
    if (p === 'l' && hasLandscape()) return 'l';
    if (p === 'p') return 'p';
    return autoOrient();
  }

  function setGlobal(name, value) {
    if (typeof globalThis !== 'undefined') globalThis[name] = value;
    else if (typeof window !== 'undefined') window[name] = value;
  }

  function applyVariant(orient) {
    var shared = (typeof VM_RESOURCES !== 'undefined' && VM_RESOURCES) || {};
    var variant = orient === 'l'
      ? (typeof VM_RESOURCES_L !== 'undefined' ? VM_RESOURCES_L : null)
      : (typeof VM_RESOURCES_P !== 'undefined' ? VM_RESOURCES_P : null);
    if (!variant) return false;
    var merged = {};
    for (var k in shared) merged[k] = shared[k];
    for (k in variant) merged[k] = variant[k];
    setGlobal('VM_RESOURCES', merged);
    if (orient === 'l' && hasLandscape()) setGlobal('VM_CLASSES', VM_CLASSES_L);
    else if (typeof VM_CLASSES_P !== 'undefined') setGlobal('VM_CLASSES', VM_CLASSES_P);
    VM.instances.screenW = orient === 'l' ? 320 : 240;
    VM.instances.screenH = orient === 'l' ? 240 : 320;
    return true;
  }

  var activeOrient = 'p';

  function cycleOrient() {
    if (!hasLandscape()) return;
    var p = orientPref();
    // auto -> landscape -> portrait -> auto
    var next = (p === null || p === 'auto') ? 'l' : (p === 'l' ? 'p' : 'auto');
    setOrientPref(next === 'auto' ? null : next);
    location.reload();
  }

  var orientSwitchTimer = null;
  function maybeAutoSwitch() {
    if (orientPref() === 'l' || orientPref() === 'p') return;
    if (orientSwitchTimer !== null) clearTimeout(orientSwitchTimer);
    orientSwitchTimer = setTimeout(function () {
      orientSwitchTimer = null;
      if (autoOrient() !== activeOrient) location.reload();
    }, 400);
  }

  // ---------------- screen ----------------
  var screenCanvas, screenCtx, offCanvas, offCtx, imageData, blit32;
  var viewW = 0, viewH = 0, viewDpr = 1;
  var perfEnabled = false;
  try { perfEnabled = typeof location !== 'undefined' && /[?&]perf=1(&|$)/.test(location.search); } catch (e) { }
  var perfEl = null, perfFrames = 0, perfRenderMs = 0, perfLast = 0;
  var fitPref = null;
  try { fitPref = (typeof localStorage !== 'undefined') ? localStorage.getItem('dr_fit') : null; } catch (e) { }
  var fitMode = (fitPref === null) ? detectTouch() : (fitPref === '1');

  function initScreen() {
    screenCanvas = document.getElementById('screen');
    screenCtx = screenCanvas.getContext('2d');
    offCanvas = document.createElement('canvas');
    offCanvas.width = 240;
    offCanvas.height = 320;
    offCtx = offCanvas.getContext('2d');
    imageData = offCtx.createImageData(240, 320);
    blit32 = new Uint32Array(imageData.data.buffer);
    updateViewport();
    screenCtx.imageSmoothingEnabled = false;
  }

  function updateViewport() {
    if (!screenCanvas) return;
    var rect = screenCanvas.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    viewDpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  }

  function initPerf() {
    if (!perfEnabled || perfEl) return;
    perfEl = document.createElement('div');
    perfEl.style.cssText = 'position:fixed;left:6px;top:6px;z-index:60;background:rgba(0,0,0,.75);color:#7CFC00;font:11px/1.3 monospace;padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(perfEl);
    perfLast = Date.now();
    setInterval(function () {
      var now = Date.now();
      var fps = perfFrames * 1000 / Math.max(1, now - perfLast);
      perfEl.textContent = 'fps ' + fps.toFixed(0) +
        '\ntick ' + (VM.perf ? VM.perf.tickMs.toFixed(1) : '-') + 'ms' +
        '\nrender ' + perfRenderMs.toFixed(1) + 'ms';
      perfFrames = 0;
      perfRenderMs = 0;
      perfLast = now;
    }, 1000);
  }

  function render() {
    if (!VM.instances.screen) return;
    var t0 = perfEnabled ? Date.now() : 0;
    var sw = VM.instances.screenW || 240, sh = VM.instances.screenH || 320;
    var resized = offCanvas.width !== sw || offCanvas.height !== sh;
    if (resized) {
      offCanvas.width = sw;
      offCanvas.height = sh;
      imageData = offCtx.createImageData(sw, sh);
      blit32 = new Uint32Array(imageData.data.buffer);
    }
    if (!resized && !VM.instances.screenDirty) {
      if (perfEnabled) { perfFrames++; perfRenderMs += Date.now() - t0; }
      return;
    }
    var px = VM.instances.screen.$pixels;
    var n = sw * sh;
    for (var i = 0; i < n; i++) {
      var p = px[i];
      blit32[i] = 0xFF000000 | ((p & 0xFF) << 16) | (p & 0xFF00) | ((p >>> 16) & 0xFF);
    }
    offCtx.putImageData(imageData, 0, 0);

    if (viewW === 0) updateViewport();
    var vw = viewW, vh = viewH;
    var dpr = viewDpr;
    var bw = Math.max(1, Math.round(vw * dpr)), bh = Math.max(1, Math.round(vh * dpr));
    if (screenCanvas.width !== bw || screenCanvas.height !== bh) {
      screenCanvas.width = bw;
      screenCanvas.height = bh;
      screenCtx.imageSmoothingEnabled = false;
    }
    screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    screenCtx.fillStyle = '#000';
    screenCtx.fillRect(0, 0, vw, vh);
    var scale = fitMode ? Math.min(vw / sw, vh / sh) : Math.max(1, Math.floor(Math.min(vw / sw, vh / sh)));
    var dw = Math.round(sw * scale), dh = Math.round(sh * scale);
    var dx = Math.round((vw - dw) / 2), dy = Math.round((vh - dh) / 2);
    screenCtx.drawImage(offCanvas, 0, 0, sw, sh, dx, dy, dw, dh);
    VM.instances.screenDirty = false;
    if (perfEnabled) { perfFrames++; perfRenderMs += Date.now() - t0; }
  }

  // ---------------- input ----------------
  function detectTouch() {
    if (typeof window === 'undefined') return false;
    if ('ontouchstart' in window) return true;
    if (navigator && navigator.maxTouchPoints > 0) return true;
    if (navigator && navigator.msMaxTouchPoints > 0) return true;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (window.orientation !== undefined) return true;
    if (navigator && /Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(navigator.userAgent || '')) return true;
    if (navigator && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
    return false;
  }
  var isTouchDevice = detectTouch();
  var padPref = null;
  try { padPref = localStorage.getItem('dr_pad'); } catch (e) { }
  // Touch devices always default to showing the pad (a stale preference can never
  // hide it there); the pad toggle only persists on non-touch devices.
  var showPad = isTouchDevice || padPref === '1';
  var pressed = {};

  function press(code, down) {
    if (down && touchDevice) { }
    VM.inputKey(code, down);
  }

  var KEYMAP = {
    ArrowUp: -1, ArrowDown: -2, ArrowLeft: -3, ArrowRight: -4,
    Space: -5, Enter: -5, NumpadEnter: -5, Numpad5: -5,
    KeyQ: -6, F1: -6, KeyW: -7, F2: -7,
    Digit0: 48, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52,
    Digit5: 53, Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57,
    Numpad0: 48, Numpad1: 49, Numpad2: 50, Numpad3: 51, Numpad4: 52,
    Numpad6: 54, Numpad7: 55, Numpad8: 56, Numpad9: 57,
    KeyE: 42, NumpadMultiply: 42,
    KeyR: 35, NumpadDivide: 35
  };

  // Shift+3 / Shift+8 produce '#' and '*' which have their own J2ME key codes.
  function keyCodeFor(e) {
    if (e.key && e.key.length === 1) {
      var ch = e.key;
      if (ch >= '0' && ch <= '9') return 48 + (ch.charCodeAt(0) - 48);
      if (ch === '#') return 35;
      if (ch === '*') return 42;
    }
    return KEYMAP[e.code];
  }

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Escape') {
        toggleKeypad();
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyF') {
        toggleFullscreen();
        e.preventDefault();
        return;
      }
      var code = keyCodeFor(e);
      if (code !== undefined && !pressed[e.code]) {
        pressed[e.code] = code;
        VM.inputKey(code, true);
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', function (e) {
      var code = pressed[e.code];
      if (code !== undefined) {
        pressed[e.code] = false;
        VM.inputKey(code, false);
        e.preventDefault();
      }
    });
    document.addEventListener('keydown', function () { deferredAudio.unlock(); }, { once: true });
    document.addEventListener('mousedown', function () { deferredAudio.unlock(); }, { once: true });
  }

  function initTouchControls() {
    var keys = document.querySelectorAll('[data-key]');
    var usePointer = (typeof window !== 'undefined') && ('PointerEvent' in window);
    for (var i = 0; i < keys.length; i++) {
      (function (el) {
        var code = parseInt(el.getAttribute('data-key'), 10);
        function down(ev) {
          if (ev.cancelable) ev.preventDefault();
          deferredAudio.unlock();
          if (el.$active) return;
          el.$active = true;
          el.classList.add('active');
          VM.inputKey(code, true);
        }
        function up(ev) {
          if (ev.cancelable) ev.preventDefault();
          if (!el.$active) return;
          el.$active = false;
          el.classList.remove('active');
          VM.inputKey(code, false);
        }
        if (usePointer) {
          el.addEventListener('pointerdown', function (ev) {
            try { el.setPointerCapture(ev.pointerId); } catch (e) { }
            down(ev);
          });
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
          el.addEventListener('lostpointercapture', up);
        } else {
          el.addEventListener('touchstart', down, { passive: false });
          el.addEventListener('touchend', up, { passive: false });
          el.addEventListener('touchcancel', up, { passive: false });
          el.addEventListener('mousedown', down);
          el.addEventListener('mouseup', up);
          el.addEventListener('mouseleave', up);
        }
      })(keys[i]);
    }
    // ignore long-press context menus
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function toggleKeypad() {
    var kp = document.getElementById('numpad');
    if (!kp) return;
    kp.hidden = !kp.hidden;
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  function toggleFit() {
    fitMode = !fitMode;
    try { localStorage.setItem('dr_fit', fitMode ? '1' : '0'); } catch (e) { }
    if (VM.instances) VM.instances.screenDirty = true;
    render();
  }

  function updateLayout() {
    document.body.classList.toggle('touch', showPad);
    var landscape = window.innerWidth > window.innerHeight;
    document.body.classList.toggle('landscape', landscape);
  }

  function togglePad() {
    showPad = !showPad;
    if (!isTouchDevice) {
      try { localStorage.setItem('dr_pad', showPad ? '1' : '0'); } catch (e) { }
    }
    updateLayout();
  }

  // ---------------- exit handling ----------------
  var running = true;

  function onDestroyed() {
    if (!running) return;
    running = false;
    try { if (deferredAudio.engine) deferredAudio.engine.stop(); } catch (e) { }
    deferredAudio.engine = null;
    deferredAudio.last = null;
    try { VM.instances.audio = null; } catch (e) { }
    var ov = document.getElementById('exit-overlay');
    if (ov) ov.hidden = false;
    // try to really close the page (works when the tab was opened by script)
    setTimeout(function () {
      try { window.close(); } catch (e) { }
    }, 300);
  }

  function boot() {
    activeOrient = currentOrient();
    applyVariant(activeOrient);
    initScreen();
    initPerf();
    initKeyboard();
    initTouchControls();
    updateLayout();
    window.addEventListener('resize', function () {
      updateLayout(); updateViewport();
      if (VM.instances) VM.instances.screenDirty = true;
      render(); maybeAutoSwitch();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        updateLayout(); updateViewport();
        if (VM.instances) VM.instances.screenDirty = true;
        render(); maybeAutoSwitch();
      }, 300);
    });
    document.getElementById('btn-fit').addEventListener('click', toggleFit);
    document.getElementById('btn-full').addEventListener('click', toggleFullscreen);
    document.getElementById('btn-keypad').addEventListener('click', toggleKeypad);
    var btnPad = document.getElementById('btn-pad');
    if (btnPad) btnPad.addEventListener('click', togglePad);
    var btnTone = document.getElementById('btn-tone');
    if (btnTone) {
      btnTone.addEventListener('click', toggleTone);
      if (typeof window !== 'undefined' && !window.DR_SOUNDFONT) btnTone.hidden = true;
    }
    var btnOrient = document.getElementById('btn-orient');
    if (btnOrient && hasLandscape()) {
      var op = orientPref();
      btnOrient.hidden = false;
      btnOrient.textContent = op === 'l' ? '横' : (op === 'p' ? '纵' : '自');
      btnOrient.title = '横竖屏：自动 / 强制横屏 / 强制竖屏（点击切换）';
      btnOrient.addEventListener('click', cycleOrient);
    }
    var btnRestart = document.getElementById('btn-restart');
    if (btnRestart) btnRestart.addEventListener('click', function () { location.reload(); });
    var btnClose = document.getElementById('btn-close');
    if (btnClose) btnClose.addEventListener('click', function () { try { window.close(); } catch (e) { } });
    var btnLang = document.getElementById('btn-lang');
    if (btnLang) {
      btnLang.textContent = LOCALE_LABELS[currentLocale()] || '文';
      btnLang.addEventListener('click', cycleLocale);
    }
    document.addEventListener('touchstart', function () { deferredAudio.unlock(); }, { once: true });

    VM.instances.onDestroyed = onDestroyed;

    var loading = document.getElementById('loading');
    try {
      VM.instances.audio = deferredAudio;
      VM.runMain('GloftDIRU', parseManifest());
      if (loading) loading.style.display = 'none';
    } catch (e) {
      if (loading) loading.textContent = '启动失败: ' + e;
      if (typeof console !== 'undefined') console.error(e);
      return;
    }
    // Decode the Nokia sample bank off the first touch: PCM conversion needs no
    // AudioContext, so only buffer creation is left for the unlock callback.
    if (typeof SoundFont !== 'undefined' && typeof SoundFont.prepare === 'function') {
      var sfData = (typeof window !== 'undefined' && window.DR_SOUNDFONT) ||
                   (typeof DR_SOUNDFONT !== 'undefined' ? DR_SOUNDFONT : null);
      if (sfData) {
        setTimeout(function () {
          try { setGlobal('DR_SOUNDFONT_PREPARED', SoundFont.prepare(sfData)); } catch (e) { }
        }, 0);
      }
    }
    (function loop() {
      if (!running) return;
      render();
      requestAnimationFrame(loop);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
