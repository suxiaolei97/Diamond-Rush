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

  // in-memory localStorage shim (jsc has none)
  var __ls = {};
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
