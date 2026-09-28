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
        VM.instances.audio = this.engine;
        if (this.last && this.last.$state === 400) {
          this.engine.play(this.last, this.last.$volume);
        }
      }
    }
  };

  // ---------------- screen ----------------
  var screenCanvas, screenCtx, offCanvas, offCtx, imageData;
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
  }

  function render() {
    if (!VM.instances.screen) return;
    var px = VM.instances.screen.$pixels;
    var data = imageData.data;
    for (var i = 0; i < 240 * 320; i++) {
      var p = px[i];
      var o = i << 2;
      data[o] = (p >> 16) & 0xFF;
      data[o + 1] = (p >> 8) & 0xFF;
      data[o + 2] = p & 0xFF;
      data[o + 3] = 255;
    }
    offCtx.putImageData(imageData, 0, 0);

    var rect = screenCanvas.getBoundingClientRect();
    var vw = rect.width, vh = rect.height;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    var bw = Math.max(1, Math.round(vw * dpr)), bh = Math.max(1, Math.round(vh * dpr));
    if (screenCanvas.width !== bw || screenCanvas.height !== bh) {
      screenCanvas.width = bw;
      screenCanvas.height = bh;
    }
    screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    screenCtx.fillStyle = '#000';
    screenCtx.fillRect(0, 0, vw, vh);
    screenCtx.imageSmoothingEnabled = false;
    var scale = fitMode ? Math.min(vw / 240, vh / 320) : Math.max(1, Math.floor(Math.min(vw / 240, vh / 320)));
    var dw = Math.round(240 * scale), dh = Math.round(320 * scale);
    var dx = Math.round((vw - dw) / 2), dy = Math.round((vh - dh) / 2);
    screenCtx.drawImage(offCanvas, 0, 0, 240, 320, dx, dy, dw, dh);
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
      var code = KEYMAP[e.code];
      if (code !== undefined && !pressed[e.code]) {
        pressed[e.code] = true;
        VM.inputKey(code, true);
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', function (e) {
      var code = KEYMAP[e.code];
      if (code !== undefined && pressed[e.code]) {
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
    for (var i = 0; i < keys.length; i++) {
      (function (el) {
        var code = parseInt(el.getAttribute('data-key'), 10);
        function down(ev) {
          ev.preventDefault();
          deferredAudio.unlock();
          if (el.$active) return;
          el.$active = true;
          el.classList.add('active');
          VM.inputKey(code, true);
        }
        function up(ev) {
          ev.preventDefault();
          if (!el.$active) return;
          el.$active = false;
          el.classList.remove('active');
          VM.inputKey(code, false);
        }
        el.addEventListener('touchstart', down, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
        el.addEventListener('mousedown', down);
        el.addEventListener('mouseup', up);
        el.addEventListener('mouseleave', up);
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
    initScreen();
    initKeyboard();
    initTouchControls();
    updateLayout();
    window.addEventListener('resize', function () { updateLayout(); render(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { updateLayout(); render(); }, 300); });
    document.getElementById('btn-fit').addEventListener('click', toggleFit);
    document.getElementById('btn-full').addEventListener('click', toggleFullscreen);
    document.getElementById('btn-keypad').addEventListener('click', toggleKeypad);
    var btnPad = document.getElementById('btn-pad');
    if (btnPad) btnPad.addEventListener('click', togglePad);
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
    (function loop() {
      if (!running) return;
      render();
      requestAnimationFrame(loop);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
