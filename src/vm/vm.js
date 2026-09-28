/*
 * Diamond Rush -- JavaScript JVM (CLDC subset) + MIDP runtime.
 *
 * Runs the original, unmodified game bytecode from the JAR. No external
 * dependencies; designed to work from file:// (classic scripts only).
 */
'use strict';

var VM = (function () {

  // ------------------------------------------------------------------
  // constants / helpers
  // ------------------------------------------------------------------
  var T_INT = 3, T_LONG = 4, T_BYTE = 0, T_CHAR = 1, T_SHORT = 2, T_BOOL = 6;

  function toI(x) { return x | 0; }
  function toL(x) { return BigInt.asIntN(64, typeof x === 'bigint' ? x : BigInt(x | 0)); }
  function big(x) { return typeof x === 'bigint' ? x : BigInt(x | 0); }

  function base64ToBytes(b64) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var lookup = {};
    for (var i = 0; i < chars.length; i++) lookup[chars.charAt(i)] = i;
    var len = b64.length;
    while (len > 0 && b64.charAt(len - 1) === '=') len--;
    var out = new Uint8Array((len * 3) >> 2);
    var oi = 0, buffer = 0, bits = 0;
    for (var j = 0; j < len; j++) {
      buffer = (buffer << 6) | lookup[b64.charAt(j)];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[oi++] = (buffer >> bits) & 0xFF;
      }
    }
    return out;
  }

  function bytesToBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    var i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += chars.charAt((v >> 18) & 63) + chars.charAt((v >> 12) & 63) + chars.charAt((v >> 6) & 63) + chars.charAt(v & 63);
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var v1 = bytes[i] << 16;
      out += chars.charAt((v1 >> 18) & 63) + chars.charAt((v1 >> 12) & 63) + '==';
    } else if (rem === 2) {
      var v2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += chars.charAt((v2 >> 18) & 63) + chars.charAt((v2 >> 12) & 63) + chars.charAt((v2 >> 6) & 63) + '=';
    }
    return out;
  }

  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function utf8Decode(bytes, off, len) {
    var s = '';
    var end = off + len;
    var i = off;
    while (i < end) {
      var c = bytes[i++];
      if (c < 0x80) { s += String.fromCharCode(c); }
      else if ((c & 0xE0) === 0xC0) { s += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 63)); }
      else if ((c & 0xF0) === 0xE0) {
        s += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
      } else {
        i += 3;
      }
    }
    return s;
  }

  // ------------------------------------------------------------------
  // signals
  // ------------------------------------------------------------------
  function JThrowable(obj) { this.obj = obj; }
  function SleepSignal(ms) { this.ms = ms; }
  function WaitSignal(obj) { this.obj = obj; }
  function HaltSignal() { }

  // ------------------------------------------------------------------
  // classes
  // ------------------------------------------------------------------
  var classes = Object.create(null);
  var classObjects = Object.create(null);
  var arrayIdCounter = 0;
  var methodCache = Object.create(null);

  function Cls(name) {
    this.name = name;
    this.superName = null;
    this.superCls = null;
    this.ifaces = [];
    this.ifaceCls = [];
    this.fields = [];
    this.staticFields = Object.create(null);
    this.methods = Object.create(null);
    this.initState = 0;
    this.isInterface = false;
    this.nativeOnly = false;
  }
  Cls.prototype.toString = function () { return 'class ' + this.name; };

  function getClass(name) {
    var c = classes[name];
    if (c) return c;
    if (typeof VM_CLASSES !== 'undefined' && VM_CLASSES[name]) {
      c = parseGameClass(name);
      classes[name] = c;
      return c;
    }
    c = new Cls(name);
    c.superName = 'java/lang/Object';
    classes[name] = c;
    return c;
  }

  function linkClass(c) {
    if (c.superName && !c.superCls) c.superCls = getClass(c.superName);
    if (c.ifaces.length && !c.ifaceCls.length) {
      for (var i = 0; i < c.ifaces.length; i++) c.ifaceCls.push(getClass(c.ifaces[i]));
    }
  }

  function makeClass(name, superName) {
    var c = new Cls(name);
    c.superName = superName;
    classes[name] = c;
    return c;
  }

  function parseGameClass(name) {
    var bytes = base64ToBytes(VM_CLASSES[name]);
    var p = CF.parse(bytes);
    var c = new Cls(name);
    c.superName = p.superName;
    c.ifaces = p.interfaces;
    c.isInterface = (p.access & 0x0200) !== 0;
    c.bytes = bytes;
    c.cp = p.cp;
    for (var i = 0; i < p.fields.length; i++) {
      var f = p.fields[i];
      var fi = {
        name: f.name, desc: f.desc, cls: c,
        static: (f.flags & 0x0008) !== 0,
        constValue: f.constValue,
        key: f.name + ':' + f.desc
      };
      c.fields.push(fi);
      if (fi.static) {
        c.staticFields[fi.key] = f.constValue !== undefined ? f.constValue : defaultVal(f.desc);
      }
    }
    for (var j = 0; j < p.methods.length; j++) {
      var m = p.methods[j];
      var mi = {
        name: m.name, desc: m.desc, cls: c,
        static: (m.flags & 0x0008) !== 0,
        sync: (m.flags & 0x0020) !== 0,
        native: false,
        code: m.code,
        maxStack: m.maxStack, maxLocals: m.maxLocals,
        exceptions: m.exceptions,
        key: m.name + ':' + m.desc
      };
      if (mi.code) mi.codeView = new DataView(mi.code.buffer, mi.code.byteOffset, mi.code.byteLength);
      c.methods[mi.key] = mi;
    }
    return c;
  }

  function makeJavaString(s) {
    var o = newObj(getClass('java/lang/String'));
    o.$str = s;
    return o;
  }

  function ldcValue(cp, idx) {
    var e = cp[idx];
    if (e && e[0] === 's') {
      if (e[3] === undefined) e[3] = makeJavaString(CF.utf(cp, e[1]));
      return e[3];
    }
    var v = CF.resolveConstant(cp, idx);
    if (typeof v === 'string') return makeJavaString(v);
    if (typeof v === 'number') return v | 0;
    return v;
  }

  function defaultVal(desc) {
    switch (desc.charAt(0)) {
      case 'Z': case 'B': case 'C': case 'S': case 'I': return 0;
      case 'J': return 0n;
      case 'F': case 'D': return 0;
      default: return null;
    }
  }

  function findField(cls, name, desc) {
    for (var c = cls; c; c = c.superCls) {
      for (var i = 0; i < c.fields.length; i++) {
        var f = c.fields[i];
        if (f.name === name && f.desc === desc) return f;
      }
    }
    return null;
  }

  function findFieldAnyDesc(cls, name) {
    for (var c = cls; c; c = c.superCls) {
      for (var i = 0; i < c.fields.length; i++) {
        var f = c.fields[i];
        if (f.name === name) return f;
      }
    }
    return null;
  }

  function resolveMethod(cls, name, desc) {
    linkClass(cls);
    var cacheKey = cls.name + '|' + name + '|' + desc;
    var hit = methodCache[cacheKey];
    if (hit !== undefined) return hit;
    var res = null;
    for (var c = cls; c; c = c.superCls) {
      var m = c.methods[name + ':' + desc];
      if (m) { res = m; break; }
    }
    if (!res) {
      for (var k = 0; k < cls.ifaceCls.length && !res; k++) {
        res = resolveMethod(cls.ifaceCls[k], name, desc);
      }
    }
    methodCache[cacheKey] = res;
    return res;
  }

  function isAssignable(cls, targetName) {
    if (targetName === 'java/lang/Object') return true;
    for (var c = cls; c; c = c.superCls) {
      linkClass(c);
      if (c.name === targetName) return true;
      for (var i = 0; i < c.ifaceCls.length; i++) {
        if (isAssignable(c.ifaceCls[i], targetName)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------
  // objects / arrays
  // ------------------------------------------------------------------
  function newObj(cls) {
    if (typeof cls === 'string') cls = getClass(cls);
    return { $cls: cls, $f: Object.create(null) };
  }

  function newArray(typeName, lengths, dim) {
    var len = lengths[dim];
    var a = new Array(len);
    if (dim === lengths.length - 1) {
      for (var i = 0; i < len; i++) a[i] = 0;
    } else {
      for (var j = 0; j < len; j++) a[j] = newArray(typeName, lengths, dim + 1);
    }
    a.$atype = typeName;
    a.$id = ++arrayIdCounter;
    return a;
  }

  function arrayLoad(a, idx, kind) {
    if (a === null || a === undefined) throwNP();
    idx = idx | 0;
    if (idx < 0 || idx >= a.length) throwAIOOBE(idx);
    var v = a[idx];
    switch (kind) {
      case T_BYTE: return (v << 24) >> 24;
      case T_CHAR: return v & 0xFFFF;
      case T_SHORT: return (v << 16) >> 16;
      default: return v;
    }
  }

  function arrayStore(a, idx, v, kind) {
    if (a === null || a === undefined) throwNP();
    idx = idx | 0;
    if (idx < 0 || idx >= a.length) throwAIOOBE(idx);
    switch (kind) {
      case T_BYTE: a[idx] = (v << 24) >> 24; break;
      case T_CHAR: a[idx] = v & 0xFFFF; break;
      case T_SHORT: a[idx] = (v << 16) >> 16; break;
      default: a[idx] = v;
    }
  }

  // ------------------------------------------------------------------
  // exceptions
  // ------------------------------------------------------------------
  function throwNP() { throw new JThrowable(makeException('java/lang/NullPointerException', '')); }
  function throwAIOOBE(idx) { throw new JThrowable(makeException('java/lang/ArrayIndexOutOfBoundsException', String(idx))); }
  function throwCCE() { throw new JThrowable(makeException('java/lang/ClassCastException', '')); }

  function makeException(name, msg) {
    var o = newObj(getClass(name));
    o.$msg = msg === undefined ? '' : msg;
    return o;
  }

  function throwJava(name, msg) { throw new JThrowable(makeException(name, msg)); }

  // ------------------------------------------------------------------
  // threads
  // ------------------------------------------------------------------
  var threads = [];
  var currentThread = null;
  var schedulerTimer = null;

  var vm = {
    classes: classes,
    mainThread: null,
    uiThread: null,
    gameThread: null,
    screen: null,
    screenGfx: null,
    canvas: null,
    display: null,
    midlet: null,
    props: {},
    pendingInput: [],
    halt: false,
    log: function (s) { if (typeof console !== 'undefined') console.log(s); }
  };

  function JavaThread(target) {
    this.name = 'Thread-' + threads.length;
    this.frames = [];
    this.state = 'new';
    this.wakeAt = 0;
    this.waitingOn = null;
    this.lockCount = 0;
    this.javaObj = null;
    this.retval = null;
    this.target = target || null;
  }

  function current() { return currentThread; }

  function pushFrame(t, m, receiver, args) {
    var lc = new Array(Math.max(m.maxLocals || 8, 16));
    var li = 0;
    var i;
    if (!m.static) lc[li++] = receiver;
    var desc = m.desc;
    var ai = 0;
    for (i = 1; i < desc.length && desc.charAt(i) !== ')'; i++) {
      var c = desc.charAt(i);
      if (c === '[') {
        while (desc.charAt(i) === '[') i++;
        if (desc.charAt(i) === 'L') { while (desc.charAt(i) !== ';') i++; }
        lc[li++] = args[ai++];
      } else if (c === 'L') {
        while (desc.charAt(i) !== ';') i++;
        lc[li++] = args[ai++];
      } else if (c === 'J' || c === 'D') {
        lc[li] = args[ai++];
        li += 2;
      } else {
        lc[li++] = args[ai++];
      }
    }
    var fr = { m: m, cls: m.cls, locals: lc, S: new Array((m.maxStack || 8) + 4), sp: 0, pc: 0, opPc: 0 };
    t.frames.push(fr);
    return fr;
  }

  function argCount(desc) {
    var i = 1, n = 0;
    while (desc.charAt(i) !== ')') {
      var c = desc.charAt(i);
      if (c === '[') {
        n++; i++;
        while (desc.charAt(i) === '[') i++;
        if (desc.charAt(i) === 'L') { while (desc.charAt(i) !== ';') i++; }
        i++;
        continue;
      }
      if (c === 'L') { while (desc.charAt(i) !== ';') i++; i++; n++; continue; }
      i++; n++;
    }
    return n;
  }

  function call(t, m, receiver, args) {
    if (!m) throwJava('java/lang/NoSuchMethodError', '?');
    if (m.native) return m.fn(api, receiver, args);
    var depth = t.frames.length;
    pushFrame(t, m, receiver, args);
    runNested(t, depth);
    return t.retval;
  }

  function callVirtual(t, obj, name, desc, args) {
    var m = resolveMethod(obj.$cls, name, desc);
    if (!m) throwJava('java/lang/NoSuchMethodError', obj.$cls.name + '.' + name + desc);
    return call(t, m, obj, args);
  }

  function runNested(t, depth) {
    while (t.frames.length > depth) {
      runThread(t, 2000000, depth);
    }
  }

  function initClass(t, cls) {
    if (!cls || cls.initState === 2) return;
    if (cls.initState === 1) return;
    if (cls.nativeOnly) { cls.initState = 2; return; }
    cls.initState = 1;
    var m = cls.methods['<clinit>:()V'];
    if (m && !m.native) {
      var depth = t.frames.length;
      pushFrame(t, m, null, []);
      runNested(t, depth);
    }
    cls.initState = 2;
  }

  function startJavaThread(t) {
    t.state = 'runnable';
    threads.push(t);
    schedule();
  }

  function startJavaThreadWithEntry(t, entry) {
    var m = resolveMethod(entry.obj.$cls, entry.name, entry.desc);
    if (!m) { vm.log('[vm] no entry method ' + entry.name); return; }
    pushFrame(t, m, entry.obj, []);
    t.state = 'runnable';
    threads.push(t);
    schedule();
  }

  function schedule() {
    if (schedulerTimer !== null) return;
    if (typeof setTimeout === 'undefined') return;
    schedulerTimer = setTimeout(tick, 0);
  }

  function tick() {
    schedulerTimer = null;
    if (vm.halt) return;
    var now = Date.now();
    var nextWake = Infinity;
    var anyRunnable = false;

    deliverInput();

    for (var i = 0; i < threads.length; i++) {
      var t = threads[i];
      if (t.state === 'sleeping') {
        if (t.wakeAt <= now) t.state = 'runnable';
        else if (t.wakeAt < nextWake) nextWake = t.wakeAt;
      }
      if (t.state === 'runnable') {
        anyRunnable = true;
        currentThread = t;
        try {
          runThread(t, 200000);
        } catch (e) {
          if (e instanceof SleepSignal) {
            t.state = 'sleeping';
            t.wakeAt = Date.now() + Math.max(0, e.ms);
            if (t.wakeAt < nextWake) nextWake = t.wakeAt;
          } else if (e instanceof WaitSignal) {
            t.state = 'waiting';
            t.waitingOn = e.obj;
            if (!e.obj.$waiters) e.obj.$waiters = [];
            e.obj.$waiters.push(t);
          } else if (e instanceof HaltSignal) {
            t.state = 'dead';
          } else {
            handleTop(e);
            t.state = 'dead';
          }
        }
        currentThread = null;
      }
    }

    processMediaEnd();

    for (var d = threads.length - 1; d >= 0; d--) {
      if (threads[d].state === 'dead') threads.splice(d, 1);
    }

    if (vm.halt) return;
    if (threads.length === 0) return;

    if (anyRunnable) schedule();
    else if (nextWake < Infinity) {
      schedulerTimer = setTimeout(tick, Math.max(0, nextWake - Date.now()));
    }
  }

  function deliverInput() {
    if (!vm.pendingInput.length || !vm.canvas) return;
    var t = vm.uiThread;
    if (!t || !t.frames.length) {
      t = null;
      for (var ti = 0; ti < threads.length; ti++) {
        if (threads[ti].frames.length && threads[ti].frames[0].cls.name === 'i') { t = threads[ti]; break; }
      }
    }
    if (!t || !t.frames.length) return;
    var inp = vm.pendingInput;
    vm.pendingInput = [];
    var prev = currentThread;
    currentThread = t;
    for (var q = 0; q < inp.length; q++) {
      try {
        if (vm.logSound) vm.log('[key] ' + (inp[q][1] ? 'down ' : 'up   ') + inp[q][0]);
        var m = resolveMethod(vm.canvas.$cls, inp[q][1] ? 'keyPressed' : 'keyReleased', '(I)V');
        call(t, m, vm.canvas, [inp[q][0] | 0]);
      } catch (e) {
        if (e instanceof SleepSignal || e instanceof WaitSignal) { vm.pendingInput.push(inp[q]); continue; }
        handleTop(e);
      }
    }
    currentThread = prev;
  }

  var mediaEndQueue = [];

  function processMediaEnd() {
    if (!mediaEndQueue.length) return;
    var t = vm.uiThread || vm.gameThread;
    if (!t || !t.frames.length) return;
    var q = mediaEndQueue;
    mediaEndQueue = [];
    var prev = currentThread;
    currentThread = t;
    for (var i = 0; i < q.length; i++) {
      try {
        var player = q[i];
        if (vm.logSound) vm.log('[media] endOfMedia len=' + (player.$data ? player.$data.length : -1) + ' listeners=' + (player.$listeners ? player.$listeners.length : 0));
        var ls = player.$listeners || [];
        for (var k = 0; k < ls.length; k++) {
          var m = resolveMethod(ls[k].$cls, 'playerUpdate', '(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V');
          if (m) call(t, m, ls[k], [player, makeJavaString('endOfMedia'), null]);
        }
      } catch (e) { handleTop(e); }
    }
    currentThread = prev;
  }

  function queueMediaEnd(player) { mediaEndQueue.push(player); schedule(); }

  function handleTop(e) {
    if (e instanceof JThrowable) {
      var t = currentThread;
      if (e.logged) return;
      vm.log('[java] uncaught ' + clsNameOf(e.obj) + ': ' + (e.obj && e.obj.$msg !== undefined ? e.obj.$msg : ''));
      if (t) {
        while (t.frames.length) {
          var fr = t.frames[t.frames.length - 1];
          vm.log('    at ' + fr.cls.name + '.' + fr.m.name + fr.m.desc + ' pc=' + fr.opPc);
          t.frames.pop();
        }
      }
    } else if (e instanceof HaltSignal) {
      vm.halt = true;
    } else {
      if (typeof console !== 'undefined' && console.error) console.error('[vm]', e, e && e.stack);
    }
  }

  function clsNameOf(o) {
    if (!o) return 'null';
    if (typeof o === 'string') return 'java/lang/String';
    if (o.$cls) return o.$cls.name;
    return typeof o;
  }

  function findHandler(fr, pc, excCls) {
    var ex = fr.m.exceptions;
    if (!ex) return -1;
    for (var i = 0; i < ex.length; i++) {
      var e = ex[i];
      if (pc >= e.start && pc < e.end) {
        if (e.type === null || isAssignable(excCls, e.type)) return e.handler;
      }
    }
    return -1;
  }

  var traceOps = false;
  function runThread(t, budget, stopDepth) {
    var frames = t.frames;
    if (frames.length === 0) { t.state = 'dead'; return; }
    var fr, locals, S, sp, pc, code, cv, cp;
    var loaded = false;

    function loadTop() {
      fr = frames[frames.length - 1];
      locals = fr.locals;
      S = fr.S;
      sp = fr.sp;
      pc = fr.pc;
      code = fr.m.code;
      cv = fr.m.codeView;
      cp = fr.m.cls.cp;
      loaded = true;
    }

    function saveFrame() { fr.sp = sp; fr.pc = pc; }

    outer:
    while (frames.length > 0) {
      loadTop();
      try {
        for (;;) {
          if (budget-- <= 0) { saveFrame(); return; }
          fr.opPc = pc;
          if (pc < 0 || pc >= code.length) {
            vm.log('[vm] PC OUT OF RANGE ' + fr.cls.name + '.' + fr.m.name + fr.m.desc + ' pc=' + pc + ' len=' + code.length);
            if (t.lastOps) vm.log('[vm] trace: ' + t.lastOps.join(' '));
            throw new Error('pc out of range');
          }
          var op = code[pc++];
          var __dbgSp = sp;
          var __dbgPc = fr.opPc;
          if (traceOps && fr.cls.name === 'i' && fr.m.name === '<init>') {
            vm.log('[ops] ' + __dbgPc + ' ' + __dbgSp + ' ' + op);
          }
          if (traceOps) {
            if (!t.lastOps) t.lastOps = [];
            t.lastOps.push(fr.cls.name + '.' + fr.m.name + '@' + fr.opPc);
            if (t.lastOps.length > 24) t.lastOps.shift();
          }
          switch (op) {
            case 0x00: break;
            case 0x01: S[sp++] = null; break;
            case 0x02: S[sp++] = -1; break;
            case 0x03: S[sp++] = 0; break;
            case 0x04: S[sp++] = 1; break;
            case 0x05: S[sp++] = 2; break;
            case 0x06: S[sp++] = 3; break;
            case 0x07: S[sp++] = 4; break;
            case 0x08: S[sp++] = 5; break;
            case 0x09: S[sp++] = 0n; break;
            case 0x0a: S[sp++] = 1n; break;
            case 0x0b: case 0x0e: S[sp++] = 0; break;
            case 0x0c: case 0x0f: S[sp++] = 1; break;
            case 0x0d: S[sp++] = 2; break;
            case 0x10: S[sp++] = (code[pc] << 24) >> 24; pc++; break;
            case 0x11: S[sp++] = ((code[pc] << 8) | code[pc + 1]) << 16 >> 16; pc += 2; break;
            case 0x12: S[sp++] = ldcValue(cp, code[pc]); pc++; break;
            case 0x13: S[sp++] = ldcValue(cp, (code[pc] << 8) | code[pc + 1]); pc += 2; break;
            case 0x14: S[sp++] = CF.resolveConstant(cp, (code[pc] << 8) | code[pc + 1]); pc += 2; break;
            case 0x15: case 0x16: case 0x17: case 0x18: case 0x19: S[sp++] = locals[code[pc]]; pc++; break;
            case 0x1a: S[sp++] = locals[0]; break;
            case 0x1b: S[sp++] = locals[1]; break;
            case 0x1c: S[sp++] = locals[2]; break;
            case 0x1d: S[sp++] = locals[3]; break;
            case 0x1e: S[sp++] = locals[0]; break;
            case 0x1f: S[sp++] = locals[1]; break;
            case 0x20: S[sp++] = locals[2]; break;
            case 0x21: S[sp++] = locals[3]; break;
            case 0x22: S[sp++] = locals[0]; break;
            case 0x23: S[sp++] = locals[1]; break;
            case 0x24: S[sp++] = locals[2]; break;
            case 0x25: S[sp++] = locals[3]; break;
            case 0x26: S[sp++] = locals[0]; break;
            case 0x27: S[sp++] = locals[1]; break;
            case 0x28: S[sp++] = locals[2]; break;
            case 0x29: S[sp++] = locals[3]; break;
            case 0x2a: S[sp++] = locals[0]; break;
            case 0x2b: S[sp++] = locals[1]; break;
            case 0x2c: S[sp++] = locals[2]; break;
            case 0x2d: S[sp++] = locals[3]; break;
            case 0x2e: { var ii = S[--sp] | 0, ia = S[--sp]; S[sp++] = arrayLoad(ia, ii, T_INT); break; }
            case 0x2f: { var li = S[--sp] | 0, la = S[--sp]; S[sp++] = arrayLoad(la, li, T_LONG); break; }
            case 0x30: { var fi = S[--sp] | 0, fa = S[--sp]; S[sp++] = arrayLoad(fa, fi, T_INT); break; }
            case 0x31: { var di = S[--sp] | 0, da = S[--sp]; S[sp++] = arrayLoad(da, di, T_INT); break; }
            case 0x32: { var ai = S[--sp] | 0, aa = S[--sp]; if (aa === null) throwNP(); if (ai < 0 || ai >= aa.length) throwAIOOBE(ai); S[sp++] = aa[ai]; break; }
            case 0x33: { var bi = S[--sp] | 0, ba = S[--sp]; S[sp++] = arrayLoad(ba, bi, T_BYTE); break; }
            case 0x34: { var ci = S[--sp] | 0, ca = S[--sp]; S[sp++] = arrayLoad(ca, ci, T_CHAR); break; }
            case 0x35: { var si = S[--sp] | 0, sa = S[--sp]; S[sp++] = arrayLoad(sa, si, T_SHORT); break; }
            case 0x36: locals[code[pc]] = S[--sp] | 0; pc++; break;
            case 0x37: locals[code[pc]] = S[--sp]; pc++; break;
            case 0x38: locals[code[pc]] = S[--sp]; pc++; break;
            case 0x39: locals[code[pc]] = S[--sp]; pc++; break;
            case 0x3a: locals[code[pc]] = S[--sp]; pc++; break;
            case 0x3b: locals[0] = S[--sp] | 0; break;
            case 0x3c: locals[1] = S[--sp] | 0; break;
            case 0x3d: locals[2] = S[--sp] | 0; break;
            case 0x3e: locals[3] = S[--sp] | 0; break;
            case 0x3f: locals[0] = S[--sp]; break;
            case 0x40: locals[1] = S[--sp]; break;
            case 0x41: locals[2] = S[--sp]; break;
            case 0x42: locals[3] = S[--sp]; break;
            case 0x43: locals[0] = S[--sp]; break;
            case 0x44: locals[1] = S[--sp]; break;
            case 0x45: locals[2] = S[--sp]; break;
            case 0x46: locals[3] = S[--sp]; break;
            case 0x47: locals[0] = S[--sp]; break;
            case 0x48: locals[1] = S[--sp]; break;
            case 0x49: locals[2] = S[--sp]; break;
            case 0x4a: locals[3] = S[--sp]; break;
            case 0x4b: locals[0] = S[--sp]; break;
            case 0x4c: locals[1] = S[--sp]; break;
            case 0x4d: locals[2] = S[--sp]; break;
            case 0x4e: locals[3] = S[--sp]; break;
            case 0x4f: { var iv = S[--sp] | 0, ii2 = S[--sp] | 0, ia2 = S[--sp]; arrayStore(ia2, ii2, iv, T_INT); break; }
            case 0x50: { var lv = S[--sp], li2 = S[--sp] | 0, la2 = S[--sp]; arrayStore(la2, li2, lv, T_LONG); break; }
            case 0x51: { var fv = S[--sp], fi2 = S[--sp] | 0, fa2 = S[--sp]; arrayStore(fa2, fi2, fv, T_INT); break; }
            case 0x52: { var dv = S[--sp], di2 = S[--sp] | 0, da2 = S[--sp]; arrayStore(da2, di2, dv, T_INT); break; }
            case 0x53: { var av = S[--sp], ai2 = S[--sp] | 0, aa2 = S[--sp]; if (aa2 === null) throwNP(); if (ai2 < 0 || ai2 >= aa2.length) throwAIOOBE(ai2); aa2[ai2] = av; break; }
            case 0x54: { var bv = S[--sp] | 0, bi2 = S[--sp] | 0, ba2 = S[--sp]; arrayStore(ba2, bi2, bv, T_BYTE); break; }
            case 0x55: { var cvs = S[--sp] | 0, ci2 = S[--sp] | 0, ca2 = S[--sp]; arrayStore(ca2, ci2, cvs, T_CHAR); break; }
            case 0x56: { var sv = S[--sp] | 0, si2 = S[--sp] | 0, sa2 = S[--sp]; arrayStore(sa2, si2, sv, T_SHORT); break; }
            case 0x57: sp--; break;
            case 0x58: sp -= (typeof S[sp - 1] === 'bigint') ? 1 : 2; break;
            case 0x59: S[sp] = S[sp - 1]; sp++; break;
            case 0x5a: { var v1 = S[sp - 1], v2 = S[sp - 2]; S[sp - 2] = v1; S[sp - 1] = v2; S[sp] = v1; sp++; break; }
            case 0x5b: { var vv1 = S[sp - 1], vv2 = S[sp - 2], vv3 = S[sp - 3]; S[sp - 3] = vv1; S[sp - 2] = vv3; S[sp - 1] = vv2; S[sp] = vv1; sp++; break; }
            case 0x5c:
              if (typeof S[sp - 1] === 'bigint') { S[sp] = S[sp - 1]; sp++; }
              else { var x2 = S[sp - 2], x1 = S[sp - 1]; S[sp] = x2; S[sp + 1] = x1; sp += 2; }
              break;
            case 0x5d:
              if (typeof S[sp - 1] === 'bigint') { var y1 = S[sp - 1], y2 = S[sp - 2]; S[sp - 2] = y1; S[sp - 1] = y2; S[sp] = y1; sp++; }
              else { var z3 = S[sp - 3], z2 = S[sp - 2], z1 = S[sp - 1]; S[sp - 3] = z2; S[sp - 2] = z1; S[sp - 1] = z3; S[sp] = z2; S[sp + 1] = z1; sp += 2; }
              break;
            case 0x5e:
              if (typeof S[sp - 1] === 'bigint') { var u1 = S[sp - 1], u2 = S[sp - 2], u3 = S[sp - 3]; S[sp - 3] = u1; S[sp - 2] = u3; S[sp - 1] = u2; S[sp] = u1; sp++; }
              else { var t4 = S[sp - 4], t3 = S[sp - 3], t2 = S[sp - 2], t1 = S[sp - 1]; S[sp - 4] = t3; S[sp - 3] = t4; S[sp - 2] = t1; S[sp - 1] = t2; S[sp] = t3; S[sp + 1] = t4; sp += 2; }
              break;
            case 0x5f: { var s1 = S[sp - 1], s2 = S[sp - 2]; S[sp - 2] = s1; S[sp - 1] = s2; break; }
            case 0x60: { var q2 = S[--sp], q1 = S[--sp]; S[sp++] = (q1 + q2) | 0; break; }
            case 0x61: { var q2l = S[--sp], q1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(q1l) + big(q2l)); break; }
            case 0x64: { var m2 = S[--sp], m1 = S[--sp]; S[sp++] = (m1 - m2) | 0; break; }
            case 0x65: { var m2l = S[--sp], m1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(m1l) - big(m2l)); break; }
            case 0x68: { var n2 = S[--sp], n1 = S[--sp]; S[sp++] = Math.imul(n1, n2); break; }
            case 0x69: { var n2l = S[--sp], n1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(n1l) * big(n2l)); break; }
            case 0x6c: { var d2 = S[--sp] | 0, d1 = S[--sp] | 0; if (d2 === 0) throwJava('java/lang/ArithmeticException', '/ by zero'); S[sp++] = (d1 / d2) | 0; break; }
            case 0x70: { var r2 = S[--sp] | 0, r1 = S[--sp] | 0; if (r2 === 0) throwJava('java/lang/ArithmeticException', '/ by zero'); S[sp++] = (r1 % r2) | 0; break; }
            case 0x74: S[sp - 1] = (-S[sp - 1]) | 0; break;
            case 0x75: S[sp - 1] = BigInt.asIntN(64, -big(S[sp - 1])); break;
            case 0x78: { var sh2 = S[--sp] & 31, sh1 = S[--sp] | 0; S[sp++] = (sh1 << sh2) | 0; break; }
            case 0x79: { var lsh = BigInt(S[--sp] & 63), lv2 = S[--sp]; S[sp++] = BigInt.asIntN(64, big(lv2) << lsh); break; }
            case 0x7a: { var as2 = S[--sp] & 31, as1 = S[--sp] | 0; S[sp++] = (as1 >> as2) | 0; break; }
            case 0x7b: { var lshr = BigInt(S[--sp] & 63), lv3 = S[--sp]; S[sp++] = BigInt.asIntN(64, big(lv3) >> lshr); break; }
            case 0x7c: { var us2 = S[--sp] & 31, us1 = S[--sp] | 0; S[sp++] = (us1 >>> us2) | 0; break; }
            case 0x7d: { var lushr = BigInt(S[--sp] & 63), lv4 = BigInt.asUintN(64, big(S[--sp])); S[sp++] = BigInt.asIntN(64, lv4 >> lushr); break; }
            case 0x7e: { var an2 = S[--sp] | 0, an1 = S[--sp] | 0; S[sp++] = (an1 & an2); break; }
            case 0x7f: { var an2l = S[--sp], an1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(an1l) & big(an2l)); break; }
            case 0x80: { var or2 = S[--sp] | 0, or1 = S[--sp] | 0; S[sp++] = (or1 | or2); break; }
            case 0x81: { var or2l = S[--sp], or1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(or1l) | big(or2l)); break; }
            case 0x82: { var xo2 = S[--sp] | 0, xo1 = S[--sp] | 0; S[sp++] = (xo1 ^ xo2); break; }
            case 0x83: { var xo2l = S[--sp], xo1l = S[--sp]; S[sp++] = BigInt.asIntN(64, big(xo1l) ^ big(xo2l)); break; }
            case 0x84: { var i84 = code[pc]; locals[i84] = (locals[i84] + ((code[pc + 1] << 24) >> 24)) | 0; pc += 2; break; }
            case 0x85: S[sp - 1] = BigInt(S[sp - 1] | 0); break;
            case 0x86: S[sp - 1] = +(S[sp - 1] | 0); break;
            case 0x87: S[sp - 1] = +(S[sp - 1] | 0); break;
            case 0x88: S[sp - 1] = Number(BigInt.asIntN(32, big(S[sp - 1]))); break;
            case 0x8b: S[sp - 1] = Number(BigInt.asIntN(32, big(S[sp - 1]))); break;
            case 0x8e: S[sp - 1] = Number(BigInt.asIntN(32, big(S[sp - 1]))); break;
            case 0x91: S[sp - 1] = (S[sp - 1] << 24) >> 24; break;
            case 0x92: S[sp - 1] = S[sp - 1] & 0xFFFF; break;
            case 0x93: S[sp - 1] = (S[sp - 1] << 16) >> 16; break;
            case 0x94: { var lc2 = big(S[--sp]), lc1 = big(S[--sp]); S[sp++] = lc1 > lc2 ? 1 : (lc1 < lc2 ? -1 : 0); break; }
            case 0x99: if ((S[--sp] | 0) === 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9a: if ((S[--sp] | 0) !== 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9b: if ((S[--sp] | 0) < 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9c: if ((S[--sp] | 0) >= 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9d: if ((S[--sp] | 0) > 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9e: if ((S[--sp] | 0) <= 0) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break;
            case 0x9f: { var j2 = S[--sp] | 0, j1 = S[--sp] | 0; if (j1 === j2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa0: { var k2 = S[--sp] | 0, k1 = S[--sp] | 0; if (k1 !== k2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa1: { var p2 = S[--sp] | 0, p1 = S[--sp] | 0; if (p1 < p2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa2: { var g2 = S[--sp] | 0, g1 = S[--sp] | 0; if (g1 >= g2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa3: { var t2b = S[--sp] | 0, t1b = S[--sp] | 0; if (t1b > t2b) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa4: { var u2b = S[--sp] | 0, u1b = S[--sp] | 0; if (u1b <= u2b) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa5: { var ac2 = S[--sp], ac1 = S[--sp]; if (ac1 === ac2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa6: { var ane2 = S[--sp], ane1 = S[--sp]; if (ane1 !== ane2) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xa7: pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); break;
            case 0xaa: {
              var pad = (4 - (pc % 4)) % 4;
              pc += pad;
              var def = cv.getInt32(pc); pc += 4;
              var lo = cv.getInt32(pc); pc += 4;
              var hi = cv.getInt32(pc); pc += 4;
              var key = S[--sp] | 0;
              if (key < lo || key > hi) pc = fr.opPc + def;
              else pc = fr.opPc + cv.getInt32(pc + (key - lo) * 4);
              break;
            }
            case 0xab: {
              var pad2 = (4 - (pc % 4)) % 4;
              pc += pad2;
              var def2 = cv.getInt32(pc); pc += 4;
              var np = cv.getInt32(pc); pc += 4;
              var kkey = S[--sp] | 0;
              var found = def2;
              for (var li3 = 0; li3 < np; li3++) {
                if (cv.getInt32(pc + li3 * 8) === kkey) { found = cv.getInt32(pc + li3 * 8 + 4); break; }
              }
              pc = fr.opPc + found;
              break;
            }
            case 0xac: { var rv = S[--sp] | 0; saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { t.retval = rv; return; } var tp = frames[frames.length - 1]; tp.S[tp.sp++] = rv; loadTop(); break; }
            case 0xad: { var rvl = S[--sp]; saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { t.retval = rvl; return; } var tpl = frames[frames.length - 1]; tpl.S[tpl.sp++] = rvl; loadTop(); break; }
            case 0xae: { var rvf = S[--sp]; saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { t.retval = rvf; return; } var tpf = frames[frames.length - 1]; tpf.S[tpf.sp++] = rvf; loadTop(); break; }
            case 0xaf: { var rvd = S[--sp]; saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { t.retval = rvd; return; } var tpd = frames[frames.length - 1]; tpd.S[tpd.sp++] = rvd; loadTop(); break; }
            case 0xb0: { var rva = S[--sp]; saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { t.retval = rva; return; } var tpa = frames[frames.length - 1]; tpa.S[tpa.sp++] = rva; loadTop(); break; }
            case 0xb1: { saveFrame(); frames.pop(); if (frames.length === 0 || (stopDepth !== undefined && frames.length <= stopDepth)) { return; } loadTop(); break; }
            case 0xb2: {
              var frf = resolveFieldRef(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              saveFrame();
              initClass(t, frf.cls);
              var val = frf.cls.staticFields[frf.key];
              if (val === undefined) val = defaultVal(frf.desc);
              S[sp++] = val;
              break;
            }
            case 0xb3: {
              var frf2 = resolveFieldRef(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              saveFrame();
              initClass(t, frf2.cls);
              frf2.cls.staticFields[frf2.key] = coerceField(S[--sp], frf2.desc);
              break;
            }
            case 0xb4: {
              var frf3 = resolveFieldRef(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var obj3 = S[--sp];
              if (obj3 === null || obj3 === undefined) throwNP();
              var v3 = obj3.$f[frf3.key];
              if (v3 === undefined) v3 = defaultVal(frf3.desc);
              S[sp++] = v3;
              break;
            }
            case 0xb5: {
              var frf4 = resolveFieldRef(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var pv = S[--sp], po = S[--sp];
              if (po === null || po === undefined) throwNP();
              po.$f[frf4.key] = coerceField(pv, frf4.desc);
              break;
            }
            case 0xb6: case 0xb7: case 0xb9: {
              var mr = CF.ref(cp, (code[pc] << 8) | code[pc + 1]);
              pc += (op === 0xb9) ? 4 : 2;
              var nargs = argCount(mr.desc);
              var recv, mm;
              if (op === 0xb7) {
                recv = S[sp - nargs - 1];
                mm = resolveMethod(getClass(mr.cls), mr.name, mr.desc);
                if (!mm) throwJava('java/lang/NoSuchMethodError', mr.cls + '.' + mr.name + mr.desc);
              } else {
                recv = S[sp - nargs - 1];
                if (recv === null || recv === undefined) throwNP();
                var dcls = recv.$cls || getClass('java/lang/String');
                mm = resolveMethod(dcls, mr.name, mr.desc);
                if (!mm) throwJava('java/lang/NoSuchMethodError', dcls.name + '.' + mr.name + mr.desc);
              }
              var argStart = sp - nargs;
              var argArr = S.slice(argStart, sp);
              sp = argStart - 1;
              if (mm.native) {
                saveFrame();
                var res = mm.fn(api, recv, argArr);
                if (mr.desc.charAt(mr.desc.length - 1) !== 'V') S[sp++] = res;
              } else {
                saveFrame();
                pushFrame(t, mm, recv, argArr);
                loadTop();
              }
              break;
            }
            case 0xb8: {
              var mr3 = CF.ref(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var mc3 = getClass(mr3.cls);
              saveFrame();
              initClass(t, mc3);
              var mm3 = resolveMethod(mc3, mr3.name, mr3.desc);
              if (!mm3) throwJava('java/lang/NoSuchMethodError', mr3.cls + '.' + mr3.name + mr3.desc);
              var n3 = argCount(mr3.desc);
              var args3 = sp - n3;
              var argArr3 = S.slice(args3, sp);
              sp = args3;
              if (mm3.native) {
                saveFrame();
                var res3 = mm3.fn(api, null, argArr3);
                if (mr3.desc.charAt(mr3.desc.length - 1) !== 'V') S[sp++] = res3;
              } else {
                saveFrame();
                pushFrame(t, mm3, null, argArr3);
                loadTop();
              }
              break;
            }
            case 0xbb: {
              var nc = getClass(CF.className(cp, (code[pc] << 8) | code[pc + 1])); pc += 2;
              S[sp++] = newObj(nc);
              saveFrame();
              initClass(t, nc);
              break;
            }
            case 0xbc: {
              var at = code[pc] & 0xFF; pc++;
              var lenArr = S[--sp] | 0;
              var ta = new Array(lenArr);
              ta.$id = ++arrayIdCounter;
              for (var ai3 = 0; ai3 < lenArr; ai3++) ta[ai3] = 0;
              ta.$atype = at;
              S[sp++] = ta;
              break;
            }
            case 0xbd: {
              CF.className(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var lenA = S[--sp] | 0;
              var aa3 = new Array(lenA);
              aa3.$id = ++arrayIdCounter;
              for (var ai4 = 0; ai4 < lenA; ai4++) aa3[ai4] = null;
              S[sp++] = aa3;
              break;
            }
            case 0xbe: { var arr6 = S[--sp]; if (arr6 === null || arr6 === undefined) throwNP(); S[sp++] = arr6.length; break; }
            case 0xbf: throw new JThrowable(S[--sp]);
            case 0xc0: {
              var cc = CF.className(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var objc = S[sp - 1];
              if (objc !== null && objc !== undefined) {
                if (typeof objc === 'string') {
                  if (cc !== 'java/lang/String' && cc !== 'java/lang/Object') throwCCE();
                } else if (objc instanceof Array) {
                  if (cc.charAt(0) !== '[' && cc !== 'java/lang/Object') throwCCE();
                } else if (!isAssignable(objc.$cls, cc)) throwCCE();
              }
              break;
            }
            case 0xc1: {
              var ci5 = CF.className(cp, (code[pc] << 8) | code[pc + 1]); pc += 2;
              var obji = S[--sp];
              var ok = false;
              if (obji !== null && obji !== undefined) {
                if (typeof obji === 'string') ok = (ci5 === 'java/lang/String' || ci5 === 'java/lang/Object');
                else if (obji instanceof Array) ok = (ci5.charAt(0) === '[' || ci5 === 'java/lang/Object');
                else ok = isAssignable(obji.$cls, ci5);
              }
              S[sp++] = ok ? 1 : 0;
              break;
            }
            case 0xc2: S[--sp]; break;
            case 0xc3: S[--sp]; break;
            case 0xc5: {
              var cn3 = CF.className(cp, (code[pc] << 8) | code[pc + 1]);
              var dims = code[pc + 2] & 0xFF;
              pc += 3;
              var lengths = [];
              for (var dd = 0; dd < dims; dd++) lengths[dims - dd - 1] = S[--sp] | 0;
              S[sp++] = newArray(cn3, lengths, 0);
              break;
            }
            case 0xc6: { var nn = S[--sp]; if (nn === null) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            case 0xc7: { var nn2 = S[--sp]; if (nn2 !== null) pc = fr.opPc + ((code[pc] << 8 | code[pc + 1]) << 16 >> 16); else pc += 2; break; }
            default:
              throw new Error('unimplemented opcode 0x' + op.toString(16) + ' in ' + fr.cls.name + '.' + fr.m.name + fr.m.desc + ' at ' + fr.opPc);
          }
        }
      } catch (e) {
        if (e instanceof JThrowable) {
          var handled = false;
          var excCls = (e.obj && e.obj.$cls) ? e.obj.$cls : getClass('java/lang/Throwable');
          if (!e.logged) {
            e.logged = true;
            e.trace = [];
            for (var ti = 0; ti < frames.length; ti++) {
              var tf = frames[ti];
              e.trace.push(tf.cls.name + '.' + tf.m.name + tf.m.desc + ' pc=' + tf.opPc);
            }
            vm.log('[java] throw ' + clsNameOf(e.obj) + (e.obj && e.obj.$msg ? ': ' + e.obj.$msg : ''));
            for (var tj = 0; tj < e.trace.length; tj++) vm.log('    at ' + e.trace[tj]);
          }
          while (frames.length > 0) {
            var hf = frames[frames.length - 1];
            var hp = findHandler(hf, hf.opPc, excCls);
            if (traceOps) vm.log('[vm] unwind: ' + clsNameOf(e.obj) + ' in ' + hf.cls.name + '.' + hf.m.name + ' opPc=' + hf.opPc + ' -> handler ' + hp);
            if (hp >= 0) {
              if (traceOps) vm.log('[vm] caught ' + clsNameOf(e.obj) + ' in ' + hf.cls.name + '.' + hf.m.name + '@' + hf.opPc + ' -> ' + hp);
              hf.S.length = 0;
              hf.sp = 0;
              hf.S[hf.sp++] = e.obj;
              hf.pc = hp;
              handled = true;
              break;
            }
            frames.pop();
          }
          if (!handled) throw e;
          continue outer;
        }
        if (e instanceof SleepSignal || e instanceof WaitSignal || e instanceof HaltSignal) throw e;
        if (typeof console !== 'undefined' && console.error) {
          console.error('[vm] error in ' + fr.cls.name + '.' + fr.m.name + fr.m.desc + ' at ' + fr.opPc + ' :: ' + (e && e.stack ? e.stack : e));
        }
        throw e;
      }
    }
  }

  function resolveFieldRef(cp, idx) {
    var e = cp[idx];
    if (e[4]) return e[4];
    var clsName = CF.utf(cp, cp[e[1]][1]);
    var nt = cp[e[2]];
    var name = CF.utf(cp, nt[1]);
    var desc = CF.utf(cp, nt[2]);
    var cls = getClass(clsName);
    var f = findField(cls, name, desc);
    if (!f) f = findFieldAnyDesc(cls, name);
    var info = { cls: cls, name: name, desc: desc, key: name + ':' + desc, field: f };
    e[4] = info;
    return info;
  }

  function coerceCP(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return v | 0;
    return v;
  }

  function coerceField(v, desc) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      switch (desc.charAt(0)) {
        case 'B': return (v << 24) >> 24;
        case 'S': return (v << 16) >> 16;
        case 'C': return v & 0xFFFF;
        case 'Z': return v ? 1 : 0;
        default: return v | 0;
      }
    }
    return v;
  }

  // ------------------------------------------------------------------
  // native class construction helpers
  // ------------------------------------------------------------------
  function defineNativeClass(name, superName, isInterface) {
    var c = makeClass(name, superName);
    c.isInterface = !!isInterface;
    c.nativeOnly = true;
    c.initState = 2;
    return c;
  }

  function addStaticField(cls, name, desc, value) {
    var fi = { name: name, desc: desc, cls: cls, static: true, key: name + ':' + desc };
    cls.fields.push(fi);
    cls.staticFields[fi.key] = value !== undefined ? value : defaultVal(desc);
    return fi;
  }

  function addInstanceField(cls, name, desc) {
    var fi = { name: name, desc: desc, cls: cls, static: false, key: name + ':' + desc };
    cls.fields.push(fi);
    return fi;
  }

  function addNative(cls, name, desc, fn, isStatic) {
    var m = {
      name: name, desc: desc, cls: cls, static: !!isStatic, native: true, fn: fn,
      key: name + ':' + desc
    };
    cls.methods[m.key] = m;
    return m;
  }

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  var nativeInstallers = [];

  function bootVM() {
    for (var i = 0; i < nativeInstallers.length; i++) nativeInstallers[i](api);
    vm.booted = true;
  }

  function runMain(midletClass, props) {
    vm.props = props || {};
    bootVM();
    var mainT = new JavaThread();
    mainT.name = 'main';
    vm.mainThread = mainT;
    threads.push(mainT);
    mainT.state = 'runnable';
    currentThread = mainT;
    var mc = getClass(midletClass);
    try {
      var obj = newObj(mc);
      vm.midlet = obj;
      var ctor = resolveMethod(mc, '<init>', '()V');
      call(mainT, ctor, obj, []);
      var start = resolveMethod(mc, 'startApp', '()V');
      call(mainT, start, obj, []);
    } catch (e) {
      handleTop(e);
    }
    currentThread = null;
    schedule();
  }

  function inputKey(code, down) {
    vm.pendingInput.push([code, down]);
    schedule();
  }

  var api = {
    boot: bootVM,
    runMain: runMain,
    getClass: getClass,
    makeClass: makeClass,
    defineNativeClass: defineNativeClass,
    addNative: addNative,
    addStaticField: addStaticField,
    addInstanceField: addInstanceField,
    newObj: newObj,
    newArray: newArray,
    makeException: makeException,
    throwJava: throwJava,
    call: call,
    callVirtual: callVirtual,
    startJavaThread: startJavaThread,
    startJavaThreadWithEntry: startJavaThreadWithEntry,
    inputKey: inputKey,
    initClass: initClass,
    resolveMethod: resolveMethod,
    isAssignable: isAssignable,
    current: current,
    JThrowable: JThrowable,
    SleepSignal: SleepSignal,
    WaitSignal: WaitSignal,
    HaltSignal: HaltSignal,
    newThread: function () { return new JavaThread(); },
    instances: vm,
    get vthreads() { return threads; },
    base64ToBytes: base64ToBytes,
    bytesToBase64: bytesToBase64,
    utf8Encode: utf8Encode,
    utf8Decode: utf8Decode,
    schedule: schedule,
    queueMediaEnd: queueMediaEnd,
    shutdown: function (reason) {
      vm.halt = true;
      if (schedulerTimer !== null && typeof clearTimeout !== 'undefined') { clearTimeout(schedulerTimer); schedulerTimer = null; }
      for (var i = 0; i < threads.length; i++) threads[i].state = 'dead';
      threads.length = 0;
      if (vm.onDestroyed) { try { vm.onDestroyed(reason || 'exit'); } catch (e) { } }
    },
    setTrace: function (v) { traceOps = !!v; },
    toL: toL,
    setNativeInstaller: function (fn) { nativeInstallers.push(fn); },
    get classes() { return classes; }
  };

  return api;
})();
