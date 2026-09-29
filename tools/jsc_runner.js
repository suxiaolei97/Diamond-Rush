/*
 * Headless driver for the Diamond Rush JS JVM, run under JavaScriptCore (jsc).
 * Concatenated after all VM sources and assets by tools/jsc_build.py.
 */
(function () {

  // ---- console shim ----
  var console = {
    log: function () { print('[log] ' + Array.prototype.join.call(arguments, ' ')); },
    error: function () { print('[err] ' + Array.prototype.join.call(arguments, ' ')); }
  };
  if (typeof globalThis !== 'undefined') globalThis.console = console;

  // in-memory localStorage shim (jsc has none); optional preload for reload tests
  var __ls = {};
  try { var __pre = readFile('harness/rms.json'); if (__pre) __ls = JSON.parse(__pre); } catch (e) { }
  var localStorageShim = {
    getItem: function (k) { return __ls[k] === undefined ? null : __ls[k]; },
    setItem: function (k, v) { __ls[k] = String(v); },
    removeItem: function (k) { delete __ls[k]; },
    clear: function () { __ls = {}; }
  };
  if (typeof globalThis !== 'undefined') globalThis.localStorage = localStorageShim;
  else localStorage = localStorageShim;

  // ---- virtual clock & timers ----
  var now = 0;
  var timers = [];
  var timerId = 1;
  var realDate = Date;
  var RealDate = Date;
  function FakeDate() {
    if (arguments.length === 0) return new RealDate(now);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FakeDate.now = function () { return now; };
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  if (typeof globalThis !== 'undefined') globalThis.Date = FakeDate;
  else Date = FakeDate;

  function setTimeout(fn, ms) {
    var id = timerId++;
    timers.push({ id: id, at: now + (ms || 0), fn: fn });
    return id;
  }
  function clearTimeout(id) {
    for (var i = 0; i < timers.length; i++) {
      if (timers[i].id === id) { timers.splice(i, 1); return; }
    }
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.setTimeout = setTimeout;
    globalThis.clearTimeout = clearTimeout;
  }

  var __t0 = RealDate.now();
  function wall() { return ((RealDate.now() - __t0) / 1000).toFixed(1) + 's'; }
  function pump(ms) {
    var target = now + ms;
    var guard = 0;
    for (;;) {
      var best = -1, bestAt = Infinity;
      for (var i = 0; i < timers.length; i++) {
        if (timers[i].at < bestAt) { bestAt = timers[i].at; best = i; }
      }
      if (best < 0 || bestAt > target) break;
      if (++guard > 300000) { print('[warn] pump guard hit'); break; }
      var t = timers[best];
      timers.splice(best, 1);
      now = t.at;
      try { t.fn(); } catch (e) { console.error('timer error', e, e && e.stack); }
    }
    now = target;
  }

  // ---- base64 for framebuffer dump ----
  function base64Bytes(arr) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    var i;
    for (i = 0; i + 2 < arr.length; i += 3) {
      var v = (arr[i] << 16) | (arr[i + 1] << 8) | arr[i + 2];
      out += chars.charAt((v >> 18) & 63) + chars.charAt((v >> 12) & 63) + chars.charAt((v >> 6) & 63) + chars.charAt(v & 63);
    }
    var rem = arr.length - i;
    if (rem === 1) {
      var v1 = arr[i] << 16;
      out += chars.charAt((v1 >> 18) & 63) + chars.charAt((v1 >> 12) & 63) + '==';
    } else if (rem === 2) {
      var v2 = (arr[i] << 16) | (arr[i + 1] << 8);
      out += chars.charAt((v2 >> 18) & 63) + chars.charAt((v2 >> 12) & 63) + chars.charAt((v2 >> 6) & 63) + '=';
    }
    return out;
  }

  var shotIdx = 0;
  function shot(name) {
    var px = VM.instances.screen.$pixels;
    var w = VM.instances.screenW || 240, h = VM.instances.screenH || 320;
    var rgb = new Uint8Array(w * h * 3);
    for (var i = 0; i < w * h; i++) {
      var p = px[i];
      rgb[i * 3] = (p >> 16) & 0xFF;
      rgb[i * 3 + 1] = (p >> 8) & 0xFF;
      rgb[i * 3 + 2] = p & 0xFF;
    }
    print('SHOT ' + (name || ('f' + (shotIdx++))) + ' ' + w + ' ' + h + ' ' + base64Bytes(rgb));
  }

  // ---- load manifest props ----
  function loadManifest(text) {
    var props = {};
    var lines = text.split(/\r?\n/);
    var key = null, cur = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.length && (line.charAt(0) === ' ' || line.charAt(0) === '\t')) { cur += line.replace(/^\s+/, ''); continue; }
      if (key !== null) props[key] = cur;
      var idx = line.indexOf(':');
      if (idx < 0) { key = null; cur = ''; continue; }
      key = line.substring(0, idx).replace(/\s+$/, '');
      cur = line.substring(idx + 1).replace(/^\s+/, '');
    }
    if (key !== null) props[key] = cur;
    return props;
  }

  // ---- orientation variant (portrait original / 320x240 Diamond_CP) ----
  var __orient = 'p';
  try { if (String(readFile('harness/orient.flag')).replace(/\s+/g, '') === 'l') __orient = 'l'; } catch (e) { }
  if (__orient === 'l' && (typeof VM_CLASSES_L === 'undefined' || !VM_CLASSES_L)) __orient = 'p';
  (function () {
    var shared = (typeof VM_RESOURCES !== 'undefined' && VM_RESOURCES) || {};
    var variant = __orient === 'l'
      ? (typeof VM_RESOURCES_L !== 'undefined' ? VM_RESOURCES_L : {})
      : (typeof VM_RESOURCES_P !== 'undefined' ? VM_RESOURCES_P : {});
    var merged = {}, k;
    for (k in shared) merged[k] = shared[k];
    for (k in variant) merged[k] = variant[k];
    if (typeof globalThis !== 'undefined') {
      globalThis.VM_RESOURCES = merged;
      globalThis.VM_CLASSES = (__orient === 'l') ? VM_CLASSES_L : VM_CLASSES_P;
    }
    VM.instances.screenW = __orient === 'l' ? 320 : 240;
    VM.instances.screenH = __orient === 'l' ? 240 : 320;
    print('[orient] ' + __orient + ' ' + VM.instances.screenW + 'x' + VM.instances.screenH);
  })();

  var manifestText = '';
  try { manifestText = readFile('reversed/resources/META-INF/MANIFEST.MF'); } catch (e) { }
  var props = loadManifest(manifestText);
  // extra system properties
  props['microedition.platform'] = 'j2me';
  props['microedition.locale'] = 'en-US';
  try {
    var __loc = String(readFile('harness/locale.flag')).replace(/\s+/g, '');
    if (__loc) props['microedition.locale'] = __loc;
  } catch (e) { }

  // ---- boot ----
  try { if (typeof VM.setTrace === 'function' && readFile('harness/trace.flag') === '1') VM.setTrace(true); } catch (e) { }
  try {
    try { if (String(readFile('harness/sound.flag')).replace(/\s+/g,'') === '1') VM.instances.logSound = true; } catch (e) { }
    try { if (String(readFile('harness/text.flag')).replace(/\s+/g,'') === '1') VM.instances.logText = true; } catch (e) { }
    try { if (String(readFile('harness/fakeaudio.flag')).replace(/\s+/g,'') === '1') {
      VM.instances.audio = {
        play: function (player) {
          var dur = 5;
          try { dur = MIDI.parse(player.$data).duration; } catch (e) { }
          print('[fakeaudio] play len=' + player.$data.length + ' dur=' + dur.toFixed(2));
          var pl = player;
          setTimeout(function () { print('[fakeaudio] end len=' + pl.$data.length); VM.queueMediaEnd(pl); }, (dur + 0.3) * 1000);
        },
        stop: function () { },
        setVolume: function () { }
      };
    } } catch (e) { }
    if (String(readFile('harness/sound.flag')).replace(/\s+/g,'') === '1' && String(readFile('harness/fakeaudio.flag')).replace(/\s+/g,'') === '1') {
      var jcls0 = VM.getClass('j');
      var origPU = jcls0.methods['playerUpdate:(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V'];
      if (origPU) {
        jcls0.methods['playerUpdate:(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V'] = {
          name: 'playerUpdate', desc: '(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V', cls: jcls0, static: false, native: true,
          key: 'playerUpdate',
          fn: function (VMapi, self, args) {
            var ev = args[1];
            print('[pu] event=' + (ev && ev.$str !== undefined ? ev.$str : String(ev)) + ' type=' + typeof ev);
            return VMapi.call(VMapi.current(), origPU, self, args);
          }
        };
      }
      var icls = VM.getClass('i');
      var orig = icls.methods['t:(I)V'];
      icls.methods['t:(I)V'] = {
        name: 't', desc: '(I)V', cls: icls, static: false, native: true,
        key: 't:(I)V',
        fn: function (VMapi, self, args) {
          var th = VMapi.current();
          var playing = false;
          try {
            var jc = VMapi.getClass('j');
            var bm = VMapi.resolveMethod(jc, 'boolean_a', '()Z');
            playing = !!VMapi.call(th, bm, null, []);
          } catch (e) { }
          print('[t] ' + args[0] + ' soundPlaying=' + playing + ' vtime=' + __now);
          return VMapi.call(th, orig, self, args);
        }
      };
    }
    VM.runMain('GloftDIRU', props);
  } catch (e) {
    console.error('boot failed', e, e && e.stack);
  }

  // ---- script ----
  var scriptPath = (typeof arguments !== 'undefined' && arguments[0]) ? arguments[0] : 'harness/jsctest.txt';
  var script = '';
  try { script = readFile(scriptPath); } catch (e) { script = '8000 shot title\n'; }
  var lines = script.split(/\r?\n/);
  var idx2 = 0;
  function step() {
    while (idx2 < lines.length) {
      var line = lines[idx2++].replace(/^\s+|\s+$/g, '');
      if (!line || line.charAt(0) === '#') continue;
      var parts = line.split(/\s+/);
      var delay = parseInt(parts[0], 10) || 0;
      if (delay > 0) { now += delay; pump(0); }
      var cmd = parts[1];
      print('[time] ' + wall() + ' cmd=' + line);
      if (cmd === 'key') VM.inputKey(parseInt(parts[2], 10), true);
      else if (cmd === 'rel') VM.inputKey(parseInt(parts[2], 10), false);
      else if (cmd === 'tap') {
        VM.inputKey(parseInt(parts[2], 10), true);
        pump(120);
        VM.inputKey(parseInt(parts[2], 10), false);
      } else if (cmd === 'shot') shot(parts[2]);
      else if (cmd === 'quitgame') {
        var t3 = VM.instances.uiThread || VM.instances.mainThread;
        var ic3 = VM.getClass('i');
        var bm3 = VM.resolveMethod(ic3, 'b', '()V');
        try { VM.call(t3, bm3, null, []); print('[quit] i.b() called'); } catch (e) { print('[quit] ERR ' + (e && e.obj ? e.obj.$cls.name : e)); }
        pump(4000);
        print('[quit] halt=' + VM.instances.halt);
        var threads = VM.vthreads || [];
        print('[quit] threads=' + threads.map(function (t) { return t.name + ':' + t.state + ':' + t.frames.length; }).join(','));
      }
      else if (cmd === 'synthtest') {
        function FakeParam() { this.value = 0; }
        FakeParam.prototype.setValueAtTime = function () { return this; };
        FakeParam.prototype.linearRampToValueAtTime = function () { return this; };
        FakeParam.prototype.exponentialRampToValueAtTime = function () { return this; };
        FakeParam.prototype.cancelScheduledValues = function () { return this; };
        var nodeCount = { osc: 0, noise: 0, gain: 0, filter: 0, panner: 0 };
        function FakeNode(kind) { this.frequency = new FakeParam(); this.gain = new FakeParam(); this.Q = new FakeParam(); this.pan = new FakeParam(); this.playbackRate = new FakeParam(); this.type = ''; this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; if (kind) nodeCount[kind]++; }
        FakeNode.prototype.connect = function () { };
        FakeNode.prototype.disconnect = function () { };
        FakeNode.prototype.start = function () { };
        FakeNode.prototype.stop = function () { };
        var fakeCtx = {
          sampleRate: 44100, currentTime: 0, destination: new FakeNode(),
          createGain: function () { return new FakeNode('gain'); },
          createOscillator: function () { return new FakeNode('osc'); },
          createBufferSource: function () { return new FakeNode('noise'); },
          createBiquadFilter: function () { return new FakeNode('filter'); },
          createStereoPanner: function () { return new FakeNode('panner'); },
          createBuffer: function (ch, len, rate) { return { duration: len / rate, sampleRate: rate, getChannelData: function () { return new Float32Array(len); } }; }
        };
        var engine = MIDI.createEngine(fakeCtx);
        var raw = VM.base64ToBytes(VM_RESOURCES['snd.f']);
        var cnt = raw[0];
        function u32b(a, o) { return (a[o] & 255) + ((a[o+1] & 255) << 8) + ((a[o+2] & 255) << 16) + ((a[o+3] & 255) * 16777216); }
        for (var b = 0; b < cnt; b++) {
          var off = u32b(raw, 1 + b * 8), len = u32b(raw, 5 + b * 8);
          var bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) bytes[i] = raw[1 + cnt * 8 + off + i] & 0xFF;
          try {
            var c0 = nodeCount.osc, n0 = nodeCount.noise;
            engine.play({ $data: bytes, $volume: 100, $state: 400 }, 100);
            print('[synth] block ' + b + ' ok osc=' + (nodeCount.osc - c0) + ' noise=' + (nodeCount.noise - n0));
          } catch (e) { print('[synth] block ' + b + ' ERR ' + e); }
        }
      }
      else if (cmd === 'audiotest') {
        function FP() { this.value = 0; }
        FP.prototype.setValueAtTime = function () { return this; };
        FP.prototype.linearRampToValueAtTime = function () { return this; };
        FP.prototype.exponentialRampToValueAtTime = function () { return this; };
        FP.prototype.cancelScheduledValues = function () { return this; };
        var astarts = 0, astops = 0;
        function FN() { this.gain = new FP(); this.frequency = new FP(); this.playbackRate = new FP(); this.Q = new FP(); this.pan = new FP(); this.type = ''; this.buffer = null; this.loop = false; this.loopStart = 0; this.loopEnd = 0; }
        FN.prototype.connect = function () { };
        FN.prototype.disconnect = function () { };
        FN.prototype.start = function () { astarts++; };
        FN.prototype.stop = function () { astops++; };
        var actx = {
          sampleRate: 44100, currentTime: 0, destination: new FN(),
          createGain: function () { return new FN(); },
          createOscillator: function () { return new FN(); },
          createBufferSource: function () { return new FN(); },
          createBiquadFilter: function () { return new FN(); },
          createStereoPanner: function () { return new FN(); },
          createBuffer: function (c, l, r) { return { duration: l / r, sampleRate: r, getChannelData: function () { return new Float32Array(l); } }; }
        };
        var aengine = MIDI.createEngine(actx);
        var araw = VM.base64ToBytes(VM_RESOURCES['snd.f']);
        function au32(a, o) { return (a[o] & 255) + ((a[o+1] & 255) << 8) + ((a[o+2] & 255) << 16) + ((a[o+3] & 255) * 16777216); }
        function ablock(b) { var off = au32(araw, 1 + b * 8), len = au32(araw, 5 + b * 8); var bytes = new Uint8Array(len); for (var i = 0; i < len; i++) bytes[i] = araw[1 + araw[0] * 8 + off + i] & 0xFF; return bytes; }
        var aply = { $data: ablock(19), $volume: 100, $state: 400 };
        aengine.play(aply, 100);
        print('[audiotest] play  ' + JSON.stringify(aengine.stats()) + ' start=' + astarts + ' stop=' + astops);
        pump(30000);
        print('[audiotest] end   ' + JSON.stringify(aengine.stats()) + ' start=' + astarts + ' stop=' + astops);
        var stopsAfterEnd = astops;
        aengine.play(aply, 100);
        pump(1000);
        aengine.stop(aply);
        print('[audiotest] stop  ' + JSON.stringify(aengine.stats()) + ' start=' + astarts + ' stop=' + astops + ' stopDeltaOnEnd=' + stopsAfterEnd);
      }
      else if (cmd === 'cptest') {
        var icc = VM.getClass('i');
        var cvc = VM.instances.canvas;
        function fkc(name, desc) { for (var fi = 0; fi < icc.fields.length; fi++) { var fd = icc.fields[fi]; if (!fd.static && fd.name === name && fd.desc === desc) return fd.key; } return null; }
        function setc(name, desc, v) { cvc.$f[fkc(name, desc)] = v; }
        function getc(name, desc) { return cvc.$f[fkc(name, desc)] | 0; }
        var mbc = VM.resolveMethod(icc, 'b', '(II)I');
        var tc = VM.instances.uiThread || VM.instances.mainThread;
        function sOf(st) { try { return VM.call(tc, mbc, cvc, [0, st]); } catch (e) { return 'ERR'; } }
        var w = parseInt(parts[2] || '0', 10), stg = parseInt(parts[3] || '6', 10), bbv = parseInt(parts[4] || '2', 10);
        setc('aA', 'I', w); setc('aB', 'I', stg); setc('bb', 'I', bbv); setc('bs', 'I', 0);
        var svc = icc.staticFields['i:[B'];
        var bankB = svc ? (svc[6] & 0xff) | ((svc[7] & 0xff) << 8) : -1;
        print('[cptest] before w' + w + 's' + stg + '=' + sOf(stg) + ' s' + (stg+1) + '=' + sOf(stg+1) + ' bank=' + bankB + ' bs=' + getc('bs', 'I'));
        icc.staticFields['b:B'] = 35;
        for (var ci = 0; ci < 40; ci++) {
          pump(100);
          if (ci % 4 === 3) print('[cptest] t=' + ((ci+1)*100) + ' state=' + icc.staticFields['b:B'] + ' bs=' + getc('bs', 'I') + ' w' + w + 's' + stg + '=' + sOf(stg) + ' s' + (stg+1) + '=' + sOf(stg+1) + ' bank=' + (svc ? (svc[6] & 0xff) | ((svc[7] & 0xff) << 8) : -1));
          if ((icc.staticFields['b:B'] | 0) !== 35 && ci > 4) break;
        }
        print('[cptest] after w' + w + 's' + stg + '=' + sOf(stg) + ' s' + (stg+1) + '=' + sOf(stg+1) + ' state=' + icc.staticFields['b:B']);
      }
      else if (cmd === 'jtest11') {
        var icj = VM.getClass('i');
        var cvj = VM.instances.canvas;
        function fkj(name, desc) { for (var fi = 0; fi < icj.fields.length; fi++) { var fd = icj.fields[fi]; if (!fd.static && fd.name === name && fd.desc === desc) return fd.key; } return null; }
        function setj(name, desc, v) { cvj.$f[fkj(name, desc)] = v; }
        function getj(name, desc) { return cvj.$f[fkj(name, desc)] | 0; }
        var tj = VM.instances.uiThread || VM.instances.mainThread;
        var mj = VM.resolveMethod(icj, 'j', '(I)V');
        var mb = VM.resolveMethod(icj, 'b', '(II)I');
        function stageOf(st) { try { return VM.call(tj, mb, cvj, [0, st]); } catch (e) { return 'ERR'; } }
        setj('aA', 'I', 0); setj('aB', 'I', 6); setj('bb', 'I', 5);
        var svj = icj.staticFields['i:[B'];
        var bankBefore = svj ? (svj[6] & 0xff) | ((svj[7] & 0xff) << 8) : -1;
        print('[j11] before s6=' + stageOf(6) + ' s7=' + stageOf(7) + ' bb=' + getj('bb', 'I') + ' bank=' + bankBefore);
        for (var k = 0; k < 12; k++) {
          try { VM.call(tj, mj, cvj, [k]); }
          catch (e) { print('[j11] j(' + k + ') EXC ' + (e && e.obj ? (e.obj.$cls ? e.obj.$cls.name : '?') + ':' + e.obj.$msg : e)); }
        }
        var bankAfter = svj ? (svj[6] & 0xff) | ((svj[7] & 0xff) << 8) : -1;
        print('[j11] after s6=' + stageOf(6) + ' s7=' + stageOf(7) + ' aB=' + getj('aB', 'I') + ' bb=' + getj('bb', 'I') + ' bank=' + bankAfter);
      }
      else if (cmd === 'jtest') {
        var canvas = VM.instances.canvas;
        var jo = null;
        if (canvas) {
          for (var kk in canvas.$f) {
            var vv = canvas.$f[kk];
            if (vv && vv.$cls && vv.$cls.name === 'j') jo = vv;
          }
        }
        if (!jo) { print('[jtest] j object not found'); }
        else {
          var jc = VM.getClass('j');
          var t2 = VM.instances.uiThread || VM.instances.mainThread;
          function jcall(name, desc, args) { return VM.call(t2, VM.resolveMethod(jc, name, desc), jo, args || []); }
          function jtry(label, fn) {
            try { print('[jtest] ' + label + ' -> ' + fn()); }
            catch (e) { print('[jtest] ' + label + ' EXC ' + (e && e.obj ? (e.obj.$cls ? e.obj.$cls.name : '?') + ':' + e.obj.$msg + ' trace=' + JSON.stringify(e.trace) : e)); }
          }
          function dumpJ() {
            var jf = VM.getClass('j');
            var out = [];
            for (var q = 0; q < jf.fields.length; q++) {
              var fq = jf.fields[q];
              if (fq.static && fq.desc === 'I') out.push(fq.name + '=' + jf.staticFields[fq.key]);
            }
            return out.join(',');
          }
          var jc2 = VM.getClass('j');
          var st = [];
          for (var fi2 = 0; fi2 < jc2.fields.length; fi2++) {
            var fd2 = jc2.fields[fi2];
            if (fd2.static) st.push(fd2.name + ':' + fd2.desc + '=' + jc2.staticFields[fd2.key]);
          }
          print('[jtest] static fields: ' + st.join(', '));
          var jthreads = VM.vthreads || [];
          for (var ti2 = 0; ti2 < jthreads.length; ti2++) {
            print('[jtest] thread ' + jthreads[ti2].name + ' state=' + jthreads[ti2].state + ' frames=' + jthreads[ti2].frames.length);
          }
          jtry('b(9) during music', function () { return jcall('b', '(I)V', [9]); });
          pump(200);
          pump(25000);
          print('[jtest] after end fields: ' + dumpJ());
          jtry('playing after end', function () { return jcall('boolean_a', '()Z'); });
          jtry('b(9) after music', function () { return jcall('b', '(I)V', [9]); });
          pump(200);
          print('[jtest] after b(9) fields: ' + dumpJ());
        }
      }
      else if (cmd === 'miditest') {
        var raw = VM.base64ToBytes(VM_RESOURCES['snd.f']);
        var cnt = raw[0];
        function u32b(a, o) { return (a[o] & 255) + ((a[o+1] & 255) << 8) + ((a[o+2] & 255) << 16) + ((a[o+3] & 255) * 16777216); }
        for (var b = 0; b < cnt; b++) {
          var off = u32b(raw, 1 + b * 8), len = u32b(raw, 5 + b * 8);
          var bytes = new Uint8Array(len);
          for (var i = 0; i < len; i++) bytes[i] = raw[1 + cnt * 8 + off + i] & 0xFF;
          var res = 'fail';
          try {
            var song = MIDI.parse(bytes);
            var ons = 0;
            for (var k = 0; k < song.events.length; k++) if (song.events[k].type === 'on') ons++;
            res = 'dur=' + song.duration.toFixed(2) + 's events=' + song.events.length + ' notes=' + ons + ' ppq=' + song.ppq;
          } catch (e) { res = 'ERR ' + e; }
          print('[midi] block ' + b + ' len=' + len + ' -> ' + res);
        }
      }
      else if (cmd === 'waitstate') {
        var want = parseInt(parts[2], 10);
        var timeout = parts.length > 3 ? parseInt(parts[3], 10) : 60000;
        var deadline = now + timeout;
        for (;;) {
          var cur = VM.getClass('i').staticFields['b:B'];
          if ((cur & 0xFF) === (want & 0xFF)) break;
          if (now >= deadline) break;
          now += 50; pump(0);
        }
        print('[script] waitstate ' + want + ' -> ' + VM.getClass('i').staticFields['b:B']);
      }
      else if (cmd === 'pngtest') {
        var raw = VM.base64ToBytes(VM_RESOURCES['spl.f']);
        var cnt = raw[0];
        function u32(a, o) { return (a[o] & 255) + ((a[o+1] & 255) << 8) + ((a[o+2] & 255) << 16) + ((a[o+3] & 255) * 16777216); }
        for (var b = 0; b < cnt; b++) {
          var off = u32(raw, 1 + b * 8), len = u32(raw, 5 + b * 8);
          var img = VM.midp.decodePng(raw, 1 + cnt * 8 + off, len);
          print('[pngtest] block ' + b + ' off=' + off + ' len=' + len + ' -> ' + (img ? (img.$w + 'x' + img.$h) : 'null'));
        }
      }
      else if (cmd === 'logrms') { VM.instances.logRms = true; print('[rms] logging on'); }
      else if (cmd === 'rmsdump') { print('RMSDUMP ' + JSON.stringify(__ls)); }
      else if (cmd === 'worlds') {
        var icw = VM.getClass('i');
        var sv = icw.staticFields['i:[B'];
        var vis = icw.staticFields['b:[Z'];
        var ab = null;
        try { ab = VM.getClass('a').staticFields['b:[I']; } catch (e) { }
        print('[worlds] save2=' + (sv ? sv[2] : 'null') + ' vis=' + (vis ? vis.join(',') : 'null') + ' a.b=' + (ab ? ab.join(',') : 'null'));
      }
      else if (cmd === 'setstate') {
        var sv = parseInt(parts[2], 10) | 0;
        VM.getClass('i').staticFields['b:B'] = sv;
        print('[setstate] b=' + VM.getClass('i').staticFields['b:B']);
      }
      else if (cmd === 'ending') {
        var ice = VM.getClass('i');
        var cve = VM.instances.canvas;
        var te = VM.instances.uiThread || VM.instances.mainThread;
        function fke(name, desc) {
          for (var fi = 0; fi < ice.fields.length; fi++) {
            var fd = ice.fields[fi];
            if (!fd.static && fd.name === name && fd.desc === desc) return fd.key;
          }
          return null;
        }
        function sfe(name, desc, v) {
          var k = fke(name, desc);
          if (k === null) { print('[ending] missing field ' + name + desc); return false; }
          cve.$f[k] = v; return true;
        }
        function gfe(name, desc) {
          var k = fke(name, desc);
          return k === null ? null : cve.$f[k];
        }
        if (parts[2] === 'fields') {
          for (var fi2 = 0; fi2 < ice.fields.length; fi2++) {
            var fd2 = ice.fields[fi2];
            if (!fd2.static) print('[ifield] ' + fd2.name + ' ' + fd2.desc);
          }
          for (var fj2 = 0; fj2 < ice.staticFields.length; fj2++) { }
          print('[ending] state=' + ice.staticFields['b:B']);
        } else {
          var rawW = parts[2] ? (parseInt(parts[2], 10) | 0) : 7;
          var mload = VM.resolveMethod(ice, 'b', '(I)V');
          for (var s2 = 4; s2 <= 10; s2++) {
            try { VM.call(te, mload, cve, [s2]); } catch (e2) { print('[ending] load ' + s2 + ' err ' + e2); }
          }
          print('[ending] z=' + gfe('z', 'I') + ' A=' + gfe('A', 'I') + ' G=' + gfe('G', 'I') + ' H=' + gfe('H', 'I'));
          ice.staticFields['b:B'] = 29;
          var me2 = VM.resolveMethod(ice, 'e', '()V');
          try { VM.call(te, me2, cve, []); } catch (e3) { print('[ending] e() err ' + e3); }
          sfe('av', 'Z', 1); sfe('Y', 'I', 0); sfe('Z', 'I', 0);
          if (rawW >= 8) {
            sfe('W', 'I', 7);
            pump(1100);
            pump(200);
          } else {
            sfe('W', 'I', rawW);
            pump(300);
          }
          print('[ending] W=' + gfe('W', 'I') + ' state=' + ice.staticFields['b:B'] + ' av=' + gfe('av', 'Z'));
          shot(parts[3] || ('ending_w' + gfe('W', 'I')));
        }
      }
      else if (cmd === 'loadstage') {
        var icl = VM.getClass('i');
        var cvl = VM.instances.canvas;
        var tl = VM.instances.uiThread || VM.instances.mainThread;
        function fkl(name, desc) {
          for (var fi = 0; fi < icl.fields.length; fi++) {
            var fd = icl.fields[fi];
            if (!fd.static && fd.name === name && fd.desc === desc) return fd.key;
          }
          return null;
        }
        function sfl(name, desc, v) {
          var k = fkl(name, desc);
          if (k === null) { print('[loadstage] missing field ' + name + desc); return false; }
          cvl.$f[k] = v; return true;
        }
        function gfl(name, desc) {
          var k = fkl(name, desc);
          return k === null ? null : cvl.$f[k];
        }
        var lw = parseInt(parts[2], 10) | 0, ls = parseInt(parts[3], 10) | 0;
        sfl('aA', 'I', lw); sfl('aB', 'I', ls); sfl('bs', 'I', 0);
        sfl('D', 'Z', 0); sfl('J', 'Z', 1); sfl('H', 'Z', 1);
        sfl('N', 'Z', 1); sfl('M', 'Z', 1); sfl('L', 'Z', 1);
        icl.staticFields['b:B'] = 5;
        var lw2 = 0;
        while (lw2 < 120000) {
          pump(100); lw2 += 100;
          var lst = icl.staticFields['b:B'] & 0xFF;
          if (lst === 1 || lst === 12 || lst === 27) break;
        }
        print('[loadstage] w=' + lw + ' s=' + ls + ' state=' + (icl.staticFields['b:B'] & 0xFF) +
          ' bs=' + gfl('bs', 'I') + ' aA=' + gfl('aA', 'I') + ' aB=' + gfl('aB', 'I'));
        pump(800);
        if (parts[4] !== 'noshot') shot(parts[4] || ('stage_' + lw + '_' + ls));
      }
      else if (cmd === 'spritelist') {
        var iss = VM.getClass('i');
        var arra = iss.staticFields['a:[Lf;'];
        var cvs3 = VM.instances.canvas;
        var g3 = null;
        for (var fi6 = 0; fi6 < iss.fields.length; fi6++) {
          var fd6 = iss.fields[fi6];
          if (!fd6.static && fd6.name === 'a' && fd6.desc === 'Ljavax/microedition/lcdui/Graphics;') g3 = cvs3.$f[fd6.key];
        }
        var t4 = VM.instances.uiThread || VM.instances.mainThread;
        var px3 = VM.instances.screen.$pixels;
        for (var pi3 = 0; pi3 < px3.length; pi3++) px3[pi3] = 0xFF303030;
        var st0 = parts[2] ? (parseInt(parts[2], 10) | 0) : 0;
        var cnt0 = parts[3] ? (parseInt(parts[3], 10) | 0) : 32;
        var cols = 8, cw = 40, chh = 30;
        var drawn = 0;
        for (var si3 = 0; si3 < cnt0; si3++) {
          var idx3 = st0 + si3;
          var sp3 = arra ? arra[idx3] : null;
          if (!sp3) { print('[sprite] ' + idx3 + ' null'); continue; }
          var cx3 = (si3 % cols) * cw, cy3 = Math.floor(si3 / cols) * chh;
          try {
            var m3 = VM.resolveMethod(sp3.$cls, 'a', '(Ljavax/microedition/lcdui/Graphics;IIIIII)V');
            VP: {
              if (m3) VM.call(t4, m3, sp3, [g3, 0, cx3, cy3, 0, 0, 0]);
              else {
                var m3b = VM.resolveMethod(sp3.$cls, 'a', '(Ljavax/microedition/lcdui/Graphics;IIII)V');
                if (m3b) VM.call(t4, m3b, sp3, [g3, 0, cx3, cy3, 0]);
              }
            }
            drawn++;
          } catch (e4) { print('[sprite] ' + idx3 + ' err ' + e4); }
        }
        print('[sprite] drew ' + drawn + ' cells from ' + st0);
        shot(parts[4] || ('sprites_' + st0));
      }
      else if (cmd === 'stones') {
        var ics4 = VM.getClass('i');
        var gs4 = ics4.staticFields['a:[[I'];
        var os4 = [];
        if (gs4) {
          for (var sx4 = 0; sx4 < gs4.length; sx4++) {
            var rs4 = gs4[sx4]; if (!rs4) continue;
            for (var sy4 = 0; sy4 < rs4.length; sy4++) {
              var vs4 = rs4[sy4] | 0;
              if ((vs4 & 0x1C0) !== 0 && vs4 > 0) os4.push(sx4 + ',' + sy4 + '=0x' + (vs4 >>> 0).toString(16));
            }
          }
        }
        print('[stones] ' + os4.join(' '));
      }
      else if (cmd === 'entities') {
        var ice3 = VM.getClass('i');
        var ge = ice3.staticFields[parts[2] || 'b:[[I'];
        var oe = [];
        if (ge) {
          for (var ex = 0; ex < ge.length; ex++) {
            var re = ge[ex]; if (!re) continue;
            for (var ey = 0; ey < re.length; ey++) {
              var ve = re[ey] | 0;
              if (ve !== -1 && ve !== -2 && ve !== 0) oe.push(ex + ',' + ey + '=' + ve);
            }
          }
        }
        print('[entities] ' + oe.join(' '));
      }
      else if (cmd === 'cells') {
        var iccl = VM.getClass('i');
        var ga = iccl.staticFields['a:[[I'], gb2 = iccl.staticFields['b:[[I'];
        for (var ci = 2; ci + 1 < parts.length; ci += 2) {
          var cx = parseInt(parts[ci], 10) | 0, cy = parseInt(parts[ci + 1], 10) | 0;
          var va = ga && ga[cx] ? (ga[cx][cy] | 0) : '?';
          var vb = gb2 && gb2[cx] ? (gb2[cx][cy] | 0) : '?';
          print('[cells] ' + cx + ',' + cy + ' A=' + va + ' B=' + vb);
        }
      }
      else if (cmd === 'setint') {
        var icsi = VM.getClass('i');
        var cvsi = VM.instances.canvas;
        var kk = null;
        for (var fi7 = 0; fi7 < icsi.fields.length; fi7++) {
          var fd7 = icsi.fields[fi7];
          if (!fd7.static && fd7.name === parts[2] && fd7.desc === 'I') { kk = fd7.key; break; }
        }
        if (kk === null) print('[setint] missing ' + parts[2]);
        else { cvsi.$f[kk] = parseInt(parts[3], 10) | 0; print('[setint] ' + parts[2] + '=' + cvsi.$f[kk]); }
      }
      else if (cmd === 'mark') {
        var icmk = VM.getClass('i');
        var gmk = icmk.staticFields['a:[[I'];
        var gmk2 = icmk.staticFields['b:[[I'];
        globalThis.__markA = null; globalThis.__markB = null;
        if (gmk) { globalThis.__markA = []; for (var mi = 0; mi < gmk.length; mi++) globalThis.__markA.push(gmk[mi] ? gmk[mi].slice() : null); }
        if (gmk2) { globalThis.__markB = []; for (var mi2 = 0; mi2 < gmk2.length; mi2++) globalThis.__markB.push(gmk2[mi2] ? gmk2[mi2].slice() : null); }
        print('[mark] gridA=' + (gmk ? gmk.length : 'null') + ' gridB=' + (gmk2 ? gmk2.length : 'null'));
      }
      else if (cmd === 'diff') {
        var icdf = VM.getClass('i');
        function diffGrid(g, mk, tag) {
          if (!g || !mk) { print('[diff] ' + tag + ' none'); return; }
          for (var dx = 0; dx < g.length; dx++) {
            var rA = g[dx], rB = mk[dx]; if (!rA || !rB) continue;
            for (var dy = 0; dy < rA.length; dy++) {
              if ((rA[dy] | 0) !== (rB[dy] | 0)) print('[diff] ' + tag + ' ' + dx + ',' + dy + ' ' + (rB[dy] | 0) + ' -> ' + (rA[dy] | 0));
            }
          }
        }
        diffGrid(icdf.staticFields['a:[[I'], globalThis.__markA, 'A');
        diffGrid(icdf.staticFields['b:[[I'], globalThis.__markB, 'B');
        print('[diff] done');
      }
      else if (cmd === 'rocks') {
        var icr = VM.getClass('i');
        var names2 = parts[2] ? [parts[2]] : ['a:[[I', 'b:[[I'];
        for (var ni2 = 0; ni2 < names2.length; ni2++) {
          var gr = icr.staticFields[names2[ni2]];
          var outr = [];
          if (gr) {
            for (var rx = 0; rx < gr.length; rx++) {
              var rr = gr[rx]; if (!rr) continue;
              for (var ry = 0; ry < rr.length; ry++) {
                var vv2 = rr[ry] | 0;
                var nib = (vv2 >>> 28) & 0xF;
                if (nib > 0) outr.push(rx + ',' + ry + ':n' + nib + '/t' + (vv2 & 255) + '/h' + ((vv2 >> 8) & 0xFFF));
              }
            }
          }
          print('[rocks] ' + names2[ni2] + ' ' + outr.join(' '));
        }
      }
      else if (cmd === 'watch') {
        var icw2 = VM.getClass('i');
        var gw = icw2.staticFields[parts[3] || 'a:[[I'];
        var secs = parts[2] ? (parseInt(parts[2], 10) | 0) : 5;
        if (!gw) { print('[watch] no grid'); }
        else {
          var snap = [];
          for (var wy = 0; wy < gw.length; wy++) {
            snap.push(gw[wy] ? gw[wy].slice() : null);
          }
          for (var wstep = 0; wstep < secs * 4; wstep++) {
            pump(250);
            for (var wy2 = 0; wy2 < gw.length; wy2++) {
              var r1 = snap[wy2], r2 = gw[wy2];
              if (!r2) continue;
              if (!r1) { snap[wy2] = r2.slice(); continue; }
              for (var wx = 0; wx < r2.length; wx++) {
                if ((r1[wx] | 0) !== (r2[wx] | 0)) {
                  print('[watch] t=' + ((wstep + 1) * 250) + ' cell ' + wx + ',' + wy2 + ' ' +
                    (r1[wx] | 0) + ' -> ' + (r2[wx] | 0));
                }
              }
              snap[wy2] = r2.slice();
            }
          }
          print('[watch] done');
        }
      }
      else if (cmd === 'dumpints') {
        var icd = VM.getClass('i');
        var cvd = VM.instances.canvas;
        var outs = [];
        for (var fi4 = 0; fi4 < icd.fields.length; fi4++) {
          var fd4 = icd.fields[fi4];
          if (fd4.static) continue;
          if (fd4.desc === 'I' || fd4.desc === 'B' || fd4.desc === 'S') {
            var val = cvd.$f[fd4.key];
            if (typeof val === 'number' && val !== 0) outs.push(fd4.name + '=' + (val | 0));
          }
        }
        print('[ints] ' + outs.join(' '));
      }
      else if (cmd === 'traceon') {
        VM.instances.traceText = true;
        print('[trace] on');
      }
      else if (cmd === 'hookstr') {
        var icG2 = VM.getClass('javax/microedition/lcdui/Graphics');
        var origS = icG2.methods['drawString:(Ljava/lang/String;III)V'];
        if (origS) {
          icG2.methods['drawString:(Ljava/lang/String;III)V'] = {
            name: 'drawString', desc: '(Ljava/lang/String;III)V', cls: icG2, static: false, native: true, key: 'drawString:(Ljava/lang/String;III)V:X',
            fn: function (VMapi, self, args) {
              var s2 = args[0] && args[0].$str;
              if (s2 === 'New game') {
                var th5 = VMapi.current();
                var fr5 = '';
                for (var fz = th5.frames.length - 1; fz >= 0 && fz > th5.frames.length - 8; fz--) {
                  var fr6 = th5.frames[fz];
                  fr5 += fr6.cls.name + '.' + fr6.m.name + '@' + fr6.pc + ' < ';
                }
                print('[hookstr] ' + fr5);
              }
              return VMapi.call(VMapi.current(), origS, self, args);
            }
          };
          print('[hookstr] installed');
        } else print('[hookstr] not found');
      }
      else if (cmd === 'hookdraw') {
        var icG = VM.getClass('javax/microedition/lcdui/Graphics');
        function wrapDraw(name2, desc2, dxIdx, dyIdx, wIdx, hIdx) {
          var orig = icG.methods[name2 + ':' + desc2];
          if (!orig) { print('[hookdraw] no ' + name2); return; }
          icG.methods[name2 + ':' + desc2] = {
            name: name2, desc: desc2, cls: icG, static: false, native: true, key: name2 + ':' + desc2 + ':X',
            fn: function (VMapi, self, args) {
              var dx = args[dxIdx] | 0, dy = args[dyIdx] | 0;
              if (dy >= 170 && dy <= 232 && dx >= 90 && dx <= 300) {
                print('[draw] ' + name2 + ' img=' + (args[0] && args[0].$w !== undefined ? args[0].$w + 'x' + args[0].$h : '?') +
                  ' at ' + dx + ',' + dy + (wIdx !== null ? ' size=' + (args[wIdx] | 0) + 'x' + (args[hIdx] | 0) : ''));
              }
              return VMapi.call(VMapi.current(), orig, self, args);
            }
          };
        }
        wrapDraw('drawImage', '(Ljavax/microedition/lcdui/Image;III)V', 1, 2, null, null);
        wrapDraw('drawRegion', '(Ljavax/microedition/lcdui/Image;IIIIIIII)V', 6, 7, 3, 4);
        print('[hookdraw] installed');
      }
      else if (cmd === 'hookk') {
        var ick2 = VM.getClass('i');
        var origK = ick2.methods['k:(II)V'];
        if (origK) {
          ick2.methods['k:(II)V'] = {
            name: 'k', desc: '(II)V', cls: ick2, static: false, native: true, key: 'k:(II)VX',
            fn: function (VMapi, self, args) {
              var th2 = VMapi.current();
              var fr2 = th2.frames[th2.frames.length - 1];
              print('[k] ' + args[0] + ',' + args[1] + ' from ' + (fr2 ? fr2.cls.name + '.' + fr2.m.name + '@' + fr2.pc : '?'));
              return VMapi.call(th2, origK, self, args);
            }
          };
          print('[hookk] installed');
        } else print('[hookk] method not found');
      }
      else if (cmd === 'hookam') {
        var icka = VM.getClass('i');
        var origAm = icka.methods['am:()V'];
        if (origAm) {
          icka.methods['am:()V'] = {
            name: 'am', desc: '()V', cls: icka, static: false, native: true, key: 'am:()VX',
            fn: function (VMapi, self, args) {
              var th4 = VMapi.current();
              var bE = null, bF = null;
              for (var fi8 = 0; fi8 < icka.fields.length; fi8++) {
                var fd8 = icka.fields[fi8];
                if (!fd8.static && fd8.name === 'bE' && fd8.desc === 'I') bE = self.$f[fd8.key] | 0;
                if (!fd8.static && fd8.name === 'bF' && fd8.desc === 'I') bF = self.$f[fd8.key] | 0;
              }
              print('[am] cell ' + bE + ',' + bF);
              return VMapi.call(th4, origAm, self, args);
            }
          };
          print('[hookam] installed');
        } else print('[hookam] method not found');
      }
      else if (cmd === 'hookm') {
        var ick3 = VM.getClass('i');
        var origM = ick3.methods['m:(II)V'];
        if (origM) {
          ick3.methods['m:(II)V'] = {
            name: 'm', desc: '(II)V', cls: ick3, static: false, native: true, key: 'm:(II)VX',
            fn: function (VMapi, self, args) {
              var th3 = VMapi.current();
              var fr3 = th3.frames[th3.frames.length - 1];
              print('[m] ' + args[0] + ',' + args[1] + ' from ' + (fr3 ? fr3.cls.name + '.' + fr3.m.name + '@' + fr3.pc : '?'));
              return VMapi.call(th3, origM, self, args);
            }
          };
          print('[hookm] installed');
        } else print('[hookm] method not found');
      }
      else if (cmd === 'imglist') {
        var icim = VM.getClass('i');
        var arrim = icim.staticFields[parts[2] || 'b:[[Ljavax/microedition/lcdui/Image;'];
        var px2 = VM.instances.screen.$pixels;
        var sw2 = VM.instances.screenW, sh2 = VM.instances.screenH;
        for (var pj = 0; pj < px2.length; pj++) px2[pj] = 0xFF202020;
        if (!arrim) { print('[imglist] no array'); }
        else {
        var drawn2 = 0, icell = 0;
        for (var r2 = 0; r2 < arrim.length; r2++) {
          var row2 = arrim[r2]; if (!row2) continue;
          for (var c2 = 0; c2 < row2.length; c2++) {
            var im = row2[c2]; if (!im) continue;
            var iw = im.$w | 0, ih = im.$h | 0, ip = im.$pixels;
            if (!ip) continue;
            var ox = (icell % 4) * 80, oy = Math.floor(icell / 4) * 60;
              for (var yy2 = 0; yy2 < ih; yy2++) {
                var ty2 = oy + yy2; if (ty2 < 0 || ty2 >= sh2) continue;
                for (var xx2 = 0; xx2 < iw; xx2++) {
                  var tx2 = ox + xx2; if (tx2 < 0 || tx2 >= sw2) continue;
                  var v2 = ip[yy2 * iw + xx2] >>> 0;
                  if ((v2 >>> 24) === 0) continue;
                  px2[ty2 * sw2 + tx2] = v2;
                }
              }
              print('[imglist] ' + r2 + ',' + c2 + ' ' + iw + 'x' + ih);
              icell++; drawn2++;
            }
          }
          print('[imglist] drew ' + drawn2);
        }
        shot(parts[3] || 'imglist');
      }
      else if (cmd === 'drawtext') {
        var icdt = VM.getClass('i');
        var cvdt = VM.instances.canvas;
        var gdt = null;
        for (var fi9 = 0; fi9 < icdt.fields.length; fi9++) {
          var fd9 = icdt.fields[fi9];
          if (!fd9.static && fd9.name === 'a' && fd9.desc === 'Ljavax/microedition/lcdui/Graphics;') gdt = cvdt.$f[fd9.key];
        }
        var tdt = VM.instances.uiThread || VM.instances.mainThread;
        var pxd = VM.instances.screen.$pixels;
        for (var pd = 0; pd < pxd.length; pd++) pxd[pd] = 0xFF202020;
        var gm = VM.resolveMethod(VM.getClass('javax/microedition/lcdui/Graphics'), 'drawString', '(Ljava/lang/String;III)V');
        var dx = parseInt(parts[2], 10) | 0, dy = parseInt(parts[3], 10) | 0;
        var txt = parts.slice(4).join(' ');
        var strCls = VM.getClass('java/lang/String');
        var strObj = VM.newObj(strCls);
        strObj.$str = txt;
        VM.call(tdt, gm, gdt, [strObj, dx, dy, 0]);
        print('[drawtext] "' + txt + '" at ' + dx + ',' + dy);
        shot('drawtext_' + dx + '_' + dy);
      }
      else if (cmd === 'lang') {
        var icl2 = VM.getClass('i');
        var sa = icl2.staticFields['a:[Ljava/lang/String;'];
        if (!sa) print('[lang] no string array');
        else {
          for (var li2 = 0; li2 < sa.length; li2++) {
            var sv2 = sa[li2];
            var txt = sv2 && sv2.$str !== undefined ? sv2.$str : String(sv2);
            print('[lang] ' + li2 + ' ' + txt.replace(/\n/g, '\\n'));
          }
        }
      }
      else if (cmd === 'pos') {
        var icp = VM.getClass('i');
        var cvp = VM.instances.canvas;
        function fkpn(name, desc) {
          for (var fi = 0; fi < icp.fields.length; fi++) {
            var fd = icp.fields[fi];
            if (!fd.static && fd.name === name && fd.desc === desc) return fd.key;
          }
          return null;
        }
        var kx = fkpn('h', 'I'), ky = fkpn('i', 'I');
        print('[pos] h=' + (kx ? (cvp.$f[kx] | 0) : '?') + ' i=' + (ky ? (cvp.$f[ky] | 0) : '?') +
          ' bx=' + (fkpn('bx', 'I') ? (cvp.$f[fkpn('bx', 'I')] | 0) : '?') +
          ' by=' + (fkpn('by', 'I') ? (cvp.$f[fkpn('by', 'I')] | 0) : '?') +
          ' bG=' + (fkpn('bG', 'I') ? (cvp.$f[fkpn('bG', 'I')] | 0) : '?') +
          ' bH=' + (fkpn('bH', 'I') ? (cvp.$f[fkpn('bH', 'I')] | 0) : '?'));
      }
      else if (cmd === 'setcell') {
        var icsc = VM.getClass('i');
        var gsc = icsc.staticFields['a:[[I'];
        var sx = parseInt(parts[2], 10) | 0, sy = parseInt(parts[3], 10) | 0, sv = parseInt(parts[4], 10) | 0;
        if (gsc && gsc[sx]) {
          var old = gsc[sx][sy] | 0;
          gsc[sx][sy] = sv | 0;
          print('[setcell] ' + sx + ',' + sy + ' ' + old + ' -> ' + sv);
        } else print('[setcell] bad cell');
      }
      else if (cmd === 'getcell') {
        var icgc = VM.getClass('i');
        var ggc = icgc.staticFields['a:[[I'];
        var qx = parseInt(parts[2], 10) | 0, qy = parseInt(parts[3], 10) | 0;
        print('[getcell] ' + qx + ',' + qy + ' = ' + (ggc && ggc[qx] ? (ggc[qx][qy] | 0) : '?'));
      }
      else if (cmd === 'setpos') {
        var icsp = VM.getClass('i');
        var cvsp = VM.instances.canvas;
        function fksp(name, desc) {
          for (var fi = 0; fi < icsp.fields.length; fi++) {
            var fd = icsp.fields[fi];
            if (!fd.static && fd.name === name && fd.desc === desc) return fd.key;
          }
          return null;
        }
        var kh = fksp('h', 'I'), ki = fksp('i', 'I');
        if (kh !== null) cvsp.$f[kh] = parseInt(parts[2], 10) | 0;
        if (ki !== null) cvsp.$f[ki] = parseInt(parts[3], 10) | 0;
        print('[setpos] h=' + (kh ? cvsp.$f[kh] : '?') + ' i=' + (ki ? cvsp.$f[ki] : '?'));
        pump(400);
        shot(parts[4] || 'setpos');
      }
      else if (cmd === 'grid') {
        var icg = VM.getClass('i');
        var gm = icg.staticFields['a:[[I'];
        if (!gm) { print('[grid] no grid'); }
        else {
          var hist = {}, pos = {};
          for (var gy = 0; gy < gm.length; gy++) {
            var row = gm[gy]; if (!row) continue;
            for (var gx = 0; gx < row.length; gx++) {
              var v = row[gx] | 0;
              if (v === -1) continue;
              var t = v & 255;
              hist[t] = (hist[t] || 0) + 1;
              if (!pos[t]) pos[t] = [];
              if (pos[t].length < 40) pos[t].push(gy + ',' + gx + ':' + (v >> 8));
            }
          }
          var keys = Object.keys(hist).sort(function (a, b) { return hist[b] - hist[a]; });
          var out = [];
          for (var ki = 0; ki < keys.length; ki++) out.push(keys[ki] + 'x' + hist[keys[ki]]);
          print('[grid] ' + gm.length + 'x' + (gm[0] ? gm[0].length : 0) + ' types: ' + out.join(' '));
          for (var ki2 = 0; ki2 < keys.length; ki2++) {
            if (hist[keys[ki2]] <= 40) print('[grid] type ' + keys[ki2] + ' pos: ' + pos[keys[ki2]].join(' '));
          }
        }
      }
      else if (cmd === 'gridb') {
        var icb = VM.getClass('i');
        var bm = icb.staticFields['a:[[B'];
        if (!bm) { print('[gridb] none'); }
        else {
          for (var by3 = 0; by3 < bm.length; by3++) {
            var rw = bm[by3]; var s5 = '';
            for (var bx3 = 0; bx3 < rw.length; bx3++) {
              var vv = rw[bx3] & 255;
              if (vv === 255) s5 += ' .';
              else s5 += (vv < 16 ? ' ' : '') + vv.toString(16);
            }
            print('[gridb] ' + (by3 < 10 ? ' ' : '') + by3 + ' ' + s5);
          }
        }
      }
      else if (cmd === 'maprows') {
        var icm = VM.getClass('i');
        var gm2 = icm.staticFields['a:[[I'];
        if (gm2) {
          var width = gm2.length, height = gm2[0] ? gm2[0].length : 0;
          for (var yy = 0; yy < height; yy++) {
            var s3 = '';
            for (var xx = 0; xx < width; xx++) {
              var v2 = gm2[xx][yy] | 0;
              if (v2 === -1) { s3 += '.'; continue; }
              var t2 = v2 & 255;
              if (t2 === 4) s3 += 'R';
              else if (t2 === 5) s3 += 'E';
              else if (t2 === 44) s3 += 'S';
              else if (t2 === 35) s3 += 'T';
              else if (t2 === 0) s3 += 'P';
              else if (t2 === 33) s3 += 'B';
              else if (t2 === 105) s3 += 'X';
              else if (t2 === 108 || t2 === 117 || t2 === 118 || t2 === 119 || t2 === 120) s3 += '#';
              else if (t2 >= 10 && t2 <= 99) s3 += 'o';
              else s3 += '+';
            }
            print('[map] ' + (yy < 10 ? ' ' : '') + yy + ' ' + s3);
          }
        }
      }
      else if (cmd === 'objs') {
        var ico = VM.getClass('i');
        var arr = ico.staticFields['a:[Lc;'];
        var ccls = VM.getClass('c');
        print('[objs] array=' + (arr ? arr.length : 'null'));
        if (arr) {
          for (var oi = 0; oi < arr.length; oi++) {
            var o = arr[oi];
            if (!o) { print('[obj] ' + oi + ' null'); continue; }
            var parts2 = [];
            for (var fi3 = 0; fi3 < ccls.fields.length; fi3++) {
              var fd3 = ccls.fields[fi3];
              if (fd3.static) continue;
              if (fd3.desc === 'I' || fd3.desc === 'B' || fd3.desc === 'Z' || fd3.desc === 'S') {
                parts2.push(fd3.name + '=' + (o.$f[fd3.key] | 0));
              }
            }
            print('[obj] ' + oi + ' ' + parts2.join(' '));
          }
        }
      }
      else if (cmd === 'progress') {
        var ic2 = VM.getClass('i');
        var m2 = VM.resolveMethod(ic2, 'a', '(II)B');
        var t2 = VM.instances.uiThread || VM.instances.mainThread;
        var res = [];
        for (var w2 = 0; w2 < 3; w2++) {
          var row = [];
          for (var s2 = 0; s2 < 12; s2++) {
            try { row.push(VM.call(t2, m2, null, [w2, s2]) | 0); } catch (e) { row.push(-1); }
          }
          res.push(w2 + ':' + row.join(''));
        }
        print('[progress] ' + res.join(' '));
      }
      else if (cmd === 'stepexit') {
        var icx = VM.getClass('i');
        var cvx = VM.instances.canvas;
        var tm = icx.staticFields['a:[[I'];
        function fkx(name, desc) { for (var fi = 0; fi < icx.fields.length; fi++) { var fd = icx.fields[fi]; if (!fd.static && fd.name === name && fd.desc === desc) return fd.key; } return null; }
        function gx(name, desc) { return cvx.$f[fkx(name, desc)] | 0; }
        var px = gx('h', 'I'), py = gx('i', 'I');
        var ttype = parseInt(parts[2] || '5', 10);
        print('[stepexit] player at ' + px + ',' + py + ' rows=' + (tm ? tm.length : 'null'));
        if (tm && tm[py] && tm[py][px + 1] !== undefined) {
          print('[stepexit] old tile right = ' + (tm[py][px + 1] & 255));
          tm[py][px + 1] = (tm[py][px + 1] & -256) | ttype;
          print('[stepexit] set tile right = ' + ttype);
        }
        VM.inputKey(-4, true);
        for (var si = 0; si < 12; si++) {
          pump(150);
          var savex = icx.staticFields['i:[B'];
          var bankx = savex ? (savex[6] & 0xff) | ((savex[7] & 0xff) << 8) : -1;
          print('[stepexit] t=' + ((si + 1) * 150) + ' state=' + icx.staticFields['b:B'] + ' x=' + gx('x', 'Z') + ' at=' + gx('at', 'Z') + ' h=' + gx('h', 'I') + ' bb=' + gx('bb', 'I') + ' bank=' + bankx);
        }
        VM.inputKey(-4, false);
      }
      else if (cmd === 'lootcheck') {
        var icc = VM.getClass('i');
        var cvc = VM.instances.canvas;
        function fkc(name, desc) { for (var fi = 0; fi < icc.fields.length; fi++) { var fd = icc.fields[fi]; if (!fd.static && fd.name === name && fd.desc === desc) return fd.key; } return null; }
        var save = icc.staticFields['i:[B'];
        var bank = save ? (save[6] & 0xff) | ((save[7] & 0xff) << 8) : -1;
        var stage = -1;
        try {
          var tt = VM.instances.uiThread || VM.instances.mainThread;
          var mt = VM.resolveMethod(icc, 'b', '(II)I');
          stage = VM.call(tt, mt, cvc, [0, cvc.$f[fkc('aB', 'I')] | 0]);
        } catch (e) { stage = 'ERR'; }
        print('[lootcheck] aA=' + (cvc.$f[fkc('aA', 'I')] | 0) + ' aB=' + (cvc.$f[fkc('aB', 'I')] | 0) + ' bank=' + bank + ' stage=' + stage);
      }
      else if (cmd === 'loottrace') {
        var ict = VM.getClass('i');
        var cv = VM.instances.canvas;
        if (!cv) { print('[loot] no canvas'); }
        else {
          function fkt(name, desc) {
            for (var fi = 0; fi < ict.fields.length; fi++) {
              var fd = ict.fields[fi];
              if (!fd.static && fd.name === name && fd.desc === desc) return fd.key;
            }
            return null;
          }
          function setF(name, desc, val) { var k = fkt(name, desc); if (k) cv.$f[k] = val; else print('[loot] missing field ' + name + desc); }
          function getF(name, desc) { var k = fkt(name, desc); return k ? (cv.$f[k] | 0) : -1; }
          function stat() {
            var save = ict.staticFields['i:[B'];
            var bank = save ? (save[6] & 0xff) | ((save[7] & 0xff) << 8) : -1;
            var stage = -1;
            try {
              var tt = VM.instances.uiThread || VM.instances.mainThread;
              var mt = VM.resolveMethod(ict, 'b', '(II)I');
              var mtc = VM.resolveMethod(ict, 'c', '(II)I');
              var stg = getF('aB', 'I');
              stage = VM.call(tt, mt, cv, [0, stg]) + '/' + VM.call(tt, mtc, cv, [0, stg]) +
                ' s6=' + VM.call(tt, mt, cv, [0, 6]) + ' s7=' + VM.call(tt, mt, cv, [0, 7]);
            } catch (e) { stage = 'ERR'; }
            return 'state=' + ict.staticFields['b:B'] + ' bs=' + getF('bs', 'I') + ' bb=' + getF('bb', 'I') + ' bank=' + bank + ' stage=' + stage;
          }
          var lmode = parts[2] || 'secret';
          if (parts[3] !== undefined) setF('aA', 'I', parseInt(parts[3], 10) | 0);
          if (parts[4] !== undefined) setF('aB', 'I', parseInt(parts[4], 10) | 0);
          setF('at', 'Z', lmode === 'secret' ? 1 : 0);
          setF('bb', 'I', 2);
          print('[loot] ' + lmode + ' before ' + stat());
          for (var li = 0; li < 30; li++) {
            setF('x', 'Z', 1);
            setF('h', 'I', -10);
            pump(100);
            if (li % 5 === 4) print('[loot] ' + lmode + ' t=' + ((li + 1) * 100) + ' ' + stat());
          }
          print('[loot] ' + lmode + ' after ' + stat());
        }
      }
      else if (cmd === 'maxstage') {
        var ic = VM.getClass('i');
        var t = VM.instances.uiThread || VM.instances.mainThread;
        var names = ['b', 'd', 'e'];
        var parts = [];
        for (var ni = 0; ni < names.length; ni++) {
          var m = VM.resolveMethod(ic, names[ni], '(I)I');
          var row = [];
          for (var ww = 0; ww < 3; ww++) {
            try { row.push(VM.call(t, m, null, [ww])); } catch (e) { row.push('ERR'); }
          }
          parts.push(names[ni] + '=' + row.join(','));
        }
        print('[maxstage] ' + parts.join(' '));
      }
      else if (cmd === 'rms') {
        var ks = [];
        for (var kk in __ls) { var vv = String(__ls[kk]); ks.push(kk + '=' + (vv.length > 60 ? vv.slice(0, 60) + '...' : vv)); }
        print('[rms] ' + (ks.length ? ks.join(' ') : '(empty)'));
      }
      else if (cmd === 'log') {
        var ic = VM.getClass('i');
        var sb = '[state] b=' + ic.staticFields['b:B'] + ' halted=' + VM.instances.halt;
        print(sb);
        var ic2 = VM.getClass('i');
        for (var fj = 0; fj < ic2.fields.length; fj++) {
          var fd = ic2.fields[fj];
          if (fd.static && fd.desc === 'Ljavax/microedition/lcdui/Image;') {
            print('  imgfield ' + fd.name + ' = ' + (ic2.staticFields[fd.key] ? 'set' : 'null'));
          }
        }
        var vt = VM.vthreads || [];
        for (var vi = 0; vi < vt.length; vi++) {
          var th = vt[vi];
          var top = th.frames.length ? (th.frames[th.frames.length - 1].cls.name + '.' + th.frames[th.frames.length - 1].m.name + '@' + th.frames[th.frames.length - 1].pc) : '-';
          print('  thread ' + th.name + ' state=' + th.state + ' frames=' + th.frames.length + ' top=' + top);
        }
      }
      else if (cmd === 'quit') return;
      pump(0);
    }
  }
  step();
  pump(100);
  shot('final');
  print('DONE wall=' + wall());
})();
