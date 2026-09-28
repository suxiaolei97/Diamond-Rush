/*
 * Core java.* natives for the Diamond Rush JS JVM.
 */
'use strict';

(function () {

  function install(VM) {
    // ---------------- helpers ----------------
    var classes = {};
    function reg(name, superName, isIface) {
      var c = VM.defineNativeClass(name, superName, isIface);
      classes[name] = c;
      return c;
    }
    function N(cls, name, desc, fn, isStatic) { return VM.addNative(cls, name, desc, fn, isStatic); }
    function SF(cls, name, desc, v) { return VM.addStaticField(cls, name, desc, v); }

    function str(obj) {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'string') return obj;
      if (obj.$str !== undefined) return obj.$str;
      if (obj.$chars !== undefined) return obj.$chars.join('');
      return String(obj);
    }
    function newString(s) {
      var o = VM.newObj(classes['java/lang/String']);
      o.$str = s;
      return o;
    }
    function intObj(v) {
      var o = VM.newObj(classes['java/lang/Integer']);
      o.$value = v | 0;
      return o;
    }
    function jbool(b) { return b ? 1 : 0; }
    function jeq(a, b) {
      if (a === b) return true;
      if (a && b && a.$str !== undefined && b.$str !== undefined) return a.$str === b.$str;
      if (a && b && a.$value !== undefined && b.$value !== undefined && a.$cls === classes['java/lang/Integer']) return a.$value === b.$value;
      return false;
    }
    function keyOf(k) {
      if (k === null || k === undefined) return 'null';
      if (typeof k === 'string') return 's:' + k;
      if (k.$str !== undefined) return 's:' + k.$str;
      if (k.$value !== undefined) return 'n:' + k.$value;
      if (!k.$hashid) k.$hashid = '#' + (++keyOf.counter);
      return k.$hashid;
    }
    keyOf.counter = 0;

    // ---------------- Object ----------------
    var Object_ = reg('java/lang/Object', null);
    N(Object_, '<init>', '()V', function (VM, self, a) { });
    N(Object_, 'getClass', '()Ljava/lang/Class;', function (VM, self, a) {
      if (self === null || self === undefined) { VM.throwJava('java/lang/NullPointerException', ''); }
      if (typeof self === 'string') return classObject('java/lang/String');
      if (self instanceof Array) return classObject('java/lang/Object');
      return classObject(self.$cls.name);
    });
    N(Object_, 'hashCode', '()I', function (VM, self, a) {
      if (self === null || self === undefined) VM.throwJava('java/lang/NullPointerException', '');
      if (self.$str !== undefined) { var h = 0, s = self.$str; for (var i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }
      if (!self.$hashid) self.$hashid = '#' + (++keyOf.counter);
      var n = 0, id = self.$hashid;
      for (var j = 0; j < id.length; j++) n = (Math.imul(31, n) + id.charCodeAt(j)) | 0;
      return n;
    });
    N(Object_, 'equals', '(Ljava/lang/Object;)Z', function (VM, self, a) { return jbool(self === a[0]); });
    N(Object_, 'toString', '()Ljava/lang/String;', function (VM, self, a) {
      if (self && self.$str !== undefined) return self;
      return newString((self && self.$cls ? self.$cls.name : 'null') + '@' + (self && self.$hashid ? self.$hashid : ''));
    });
    N(Object_, 'notify', '()V', function (VM, self, a) {
      if (self.$waiters && self.$waiters.length) {
        var t = self.$waiters.shift();
        t.state = 'runnable';
        t.waitingOn = null;
        VM.schedule();
      }
    });
    N(Object_, 'notifyAll', '()V', function (VM, self, a) {
      if (self.$waiters) {
        while (self.$waiters.length) {
          var t = self.$waiters.shift();
          t.state = 'runnable';
          t.waitingOn = null;
        }
        VM.schedule();
      }
    });
    N(Object_, 'wait', '()V', function (VM, self, a) {
      throw new VM.WaitSignal(self);
    });
    N(Object_, 'wait', '(J)V', function (VM, self, a) {
      throw new VM.WaitSignal(self);
    });

    // ---------------- String ----------------
    var String_ = reg('java/lang/String', 'java/lang/Object');
    N(String_, '<init>', '()V', function (VM, self, a) { self.$str = ''; });
    N(String_, '<init>', '([BIILjava/lang/String;)V', function (VM, self, a) {
      var bytes = a[0], off = a[1] | 0, len = a[2] | 0;
      var s = '';
      for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i] & 0xFF);
      self.$str = s;
    });
    N(String_, 'length', '()I', function (VM, self, a) { return str(self).length; });
    N(String_, 'charAt', '(I)C', function (VM, self, a) {
      var s = str(self), i = a[0] | 0;
      if (i < 0 || i >= s.length) VM.throwJava('java/lang/StringIndexOutOfBoundsException', String(i));
      return s.charCodeAt(i);
    });
    N(String_, 'indexOf', '(I)I', function (VM, self, a) { return str(self).indexOf(String.fromCharCode(a[0] | 0)); });
    N(String_, 'indexOf', '(II)I', function (VM, self, a) { return str(self).indexOf(String.fromCharCode(a[0] | 0), a[1] | 0); });
    N(String_, 'indexOf', '(Ljava/lang/String;)I', function (VM, self, a) { return str(self).indexOf(str(a[0])); });
    N(String_, 'substring', '(I)Ljava/lang/String;', function (VM, self, a) { return newString(str(self).substring(a[0] | 0)); });
    N(String_, 'substring', '(II)Ljava/lang/String;', function (VM, self, a) { return newString(str(self).substring(a[0] | 0, a[1] | 0)); });
    N(String_, 'equals', '(Ljava/lang/Object;)Z', function (VM, self, a) {
      var o = a[0];
      var os = null;
      if (o === null || o === undefined) return 0;
      if (typeof o === 'string') os = o;
      else if (o.$str !== undefined) os = o.$str;
      return jbool(os !== null && os === str(self));
    });
    N(String_, 'trim', '()Ljava/lang/String;', function (VM, self, a) { return newString(str(self).trim()); });
    N(String_, 'toLowerCase', '()Ljava/lang/String;', function (VM, self, a) { return newString(str(self).toLowerCase()); });
    N(String_, 'toUpperCase', '()Ljava/lang/String;', function (VM, self, a) { return newString(str(self).toUpperCase()); });
    N(String_, 'startsWith', '(Ljava/lang/String;)Z', function (VM, self, a) { return jbool(str(self).indexOf(str(a[0])) === 0); });
    N(String_, 'endsWith', '(Ljava/lang/String;)Z', function (VM, self, a) {
      var s = str(self), p = str(a[0]);
      return jbool(s.length >= p.length && s.substring(s.length - p.length) === p);
    });
    N(String_, 'concat', '(Ljava/lang/String;)Ljava/lang/String;', function (VM, self, a) { return newString(str(self) + str(a[0])); });
    N(String_, 'getBytes', '()[B', function (VM, self, a) {
      var s = str(self);
      var out = new Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = (s.charCodeAt(i) << 24) >> 24;
      out.$atype = 8;
      return out;
    });
    N(String_, 'valueOf', '(I)Ljava/lang/String;', function (VM, self, a) { return newString(String(a[0] | 0)); }, true);
    N(String_, 'valueOf', '(J)Ljava/lang/String;', function (VM, self, a) { return newString(String(a[0])); }, true);
    N(String_, 'valueOf', '(C)Ljava/lang/String;', function (VM, self, a) { return newString(String.fromCharCode(a[0])); }, true);
    N(String_, 'valueOf', '(Ljava/lang/Object;)Ljava/lang/String;', function (VM, self, a) {
      var o = a[0];
      if (o === null) return newString('null');
      return newString(str(o));
    }, true);
    N(String_, 'valueOf', '(Z)Ljava/lang/String;', function (VM, self, a) { return newString(a[0] ? 'true' : 'false'); }, true);

    // ---------------- StringBuffer ----------------
    var StringBuffer_ = reg('java/lang/StringBuffer', 'java/lang/Object');
    function sbStr(self) { return self.$chars.join(''); }
    N(StringBuffer_, '<init>', '()V', function (VM, self, a) { self.$chars = []; });
    N(StringBuffer_, '<init>', '(Ljava/lang/String;)V', function (VM, self, a) { self.$chars = str(a[0]).split(''); });
    N(StringBuffer_, 'length', '()I', function (VM, self, a) { return sbStr(self).length; });
    N(StringBuffer_, 'charAt', '(I)C', function (VM, self, a) { return sbStr(self).charCodeAt(a[0] | 0); });
    N(StringBuffer_, 'setCharAt', '(IC)V', function (VM, self, a) {
      var i = a[0] | 0;
      self.$chars[i] = String.fromCharCode(a[1] & 0xFFFF);
    });
    N(StringBuffer_, 'append', '(Ljava/lang/String;)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var s = str(a[0]);
      if (s) self.$chars.push.apply(self.$chars, s.split(''));
      return self;
    });
    N(StringBuffer_, 'append', '(Ljava/lang/Object;)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var s = a[0] === null ? 'null' : str(a[0]);
      if (s) self.$chars.push.apply(self.$chars, s.split(''));
      return self;
    });
    N(StringBuffer_, 'append', '(I)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var s = String(a[0] | 0);
      self.$chars.push.apply(self.$chars, s.split(''));
      return self;
    });
    N(StringBuffer_, 'append', '(J)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var s = String(a[0]);
      self.$chars.push.apply(self.$chars, s.split(''));
      return self;
    });
    N(StringBuffer_, 'append', '(C)Ljava/lang/StringBuffer;', function (VM, self, a) {
      self.$chars.push(String.fromCharCode(a[0] & 0xFFFF));
      return self;
    });
    N(StringBuffer_, 'append', '(Z)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var s = a[0] ? 'true' : 'false';
      self.$chars.push.apply(self.$chars, s.split(''));
      return self;
    });
    N(StringBuffer_, 'delete', '(II)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var start = a[0] | 0, end = a[1] | 0;
      self.$chars.splice(start, end - start);
      return self;
    });
    N(StringBuffer_, 'insert', '(ILjava/lang/String;)Ljava/lang/StringBuffer;', function (VM, self, a) {
      var pos = a[0] | 0, s = str(a[1]);
      self.$chars.splice.apply(self.$chars, [pos, 0].concat(s.split('')));
      return self;
    });
    N(StringBuffer_, 'toString', '()Ljava/lang/String;', function (VM, self, a) { return newString(sbStr(self)); });
    N(StringBuffer_, 'setLength', '(I)V', function (VM, self, a) {
      self.$chars.length = a[0] | 0;
      for (var i = 0; i < self.$chars.length; i++) if (self.$chars[i] === undefined) self.$chars[i] = '\u0000';
    });

    // ---------------- Integer ----------------
    var Integer_ = reg('java/lang/Integer', 'java/lang/Object');
    N(Integer_, '<init>', '(I)V', function (VM, self, a) { self.$value = a[0] | 0; });
    N(Integer_, 'intValue', '()I', function (VM, self, a) { return self.$value | 0; });
    N(Integer_, 'byteValue', '()B', function (VM, self, a) { return (self.$value << 24) >> 24; });
    N(Integer_, 'parseInt', '(Ljava/lang/String;)I', function (VM, self, a) { return parseInt(str(a[0]), 10) | 0; }, true);
    N(Integer_, 'toString', '(I)Ljava/lang/String;', function (VM, self, a) { return newString(String(a[0] | 0)); }, true);
    N(Integer_, 'valueOf', '(I)Ljava/lang/Integer;', function (VM, self, a) { return intObj(a[0]); }, true);

    function parseInt(s, radix) {
      s = s.trim();
      var neg = false, i = 0;
      if (s.charAt(0) === '-') { neg = true; i = 1; } else if (s.charAt(0) === '+') i = 1;
      var v = 0;
      for (; i < s.length; i++) {
        var c = s.charCodeAt(i);
        var d = c >= 48 && c <= 57 ? c - 48 : (c >= 97 ? c - 87 : (c >= 65 ? c - 55 : -1));
        if (d < 0 || d >= radix) break;
        v = v * radix + d;
      }
      return neg ? -v : v;
    }

    // ---------------- Math ----------------
    var Math_ = reg('java/lang/Math', 'java/lang/Object');
    N(Math_, 'abs', '(I)I', function (VM, self, a) { return Math.abs(a[0] | 0) | 0; }, true);
    N(Math_, 'abs', '(J)J', function (VM, self, a) { var v = VM.toL(a[0]); return v < 0n ? -v : v; }, true);
    N(Math_, 'min', '(II)I', function (VM, self, a) { return Math.min(a[0] | 0, a[1] | 0); }, true);
    N(Math_, 'max', '(II)I', function (VM, self, a) { return Math.max(a[0] | 0, a[1] | 0); }, true);

    // ---------------- Throwable hierarchy ----------------
    var Throwable_ = reg('java/lang/Throwable', 'java/lang/Object');
    N(Throwable_, '<init>', '()V', function (VM, self, a) { });
    N(Throwable_, '<init>', '(Ljava/lang/String;)V', function (VM, self, a) { self.$msg = str(a[0]); });
    N(Throwable_, 'getMessage', '()Ljava/lang/String;', function (VM, self, a) { return newString(self.$msg || ''); });
    N(Throwable_, 'printStackTrace', '()V', function (VM, self, a) {
      if (typeof console !== 'undefined') console.log('[java] ' + (self.$cls ? self.$cls.name : 'Throwable') + (self.$msg ? ': ' + self.$msg : ''));
    });
    N(Throwable_, 'toString', '()Ljava/lang/String;', function (VM, self, a) { return newString(self.$cls.name + (self.$msg ? ': ' + self.$msg : '')); });
    var Exception_ = reg('java/lang/Exception', 'java/lang/Throwable');
    N(Exception_, '<init>', '()V', function (VM, self, a) { });
    N(Exception_, '<init>', '(Ljava/lang/String;)V', function (VM, self, a) { self.$msg = str(a[0]); });
    reg('java/lang/RuntimeException', 'java/lang/Exception');
    reg('java/lang/NullPointerException', 'java/lang/RuntimeException');
    reg('java/lang/ArrayIndexOutOfBoundsException', 'java/lang/RuntimeException');
    reg('java/lang/StringIndexOutOfBoundsException', 'java/lang/RuntimeException');
    reg('java/lang/ClassCastException', 'java/lang/RuntimeException');
    reg('java/lang/ArithmeticException', 'java/lang/RuntimeException');
    reg('java/lang/IllegalStateException', 'java/lang/RuntimeException');
    reg('java/lang/IllegalArgumentException', 'java/lang/RuntimeException');
    reg('java/lang/NoSuchMethodError', 'java/lang/Error');
    reg('java/lang/Error', 'java/lang/Throwable');
    reg('java/lang/InterruptedException', 'java/lang/Exception');
    reg('java/io/IOException', 'java/lang/Exception');
    reg('java/lang/OutOfMemoryError', 'java/lang/Error');
    var cls = VM.getClass('java/lang/Throwable');

    // ---------------- System ----------------
    var System_ = reg('java/lang/System', 'java/lang/Object');
    var PrintStream_ = reg('java/io/PrintStream', 'java/lang/Object');
    var outObj = VM.newObj(PrintStream_);
    SF(System_, 'out', 'Ljava/io/PrintStream;', outObj);
    N(PrintStream_, 'println', '(Ljava/lang/String;)V', function (VM, self, a) { if (typeof console !== 'undefined') console.log(str(a[0])); });
    N(PrintStream_, 'println', '(Ljava/lang/Object;)V', function (VM, self, a) { if (typeof console !== 'undefined') console.log(a[0] === null ? 'null' : str(a[0])); });
    N(PrintStream_, 'println', '(Z)V', function (VM, self, a) { if (typeof console !== 'undefined') console.log(a[0] ? 'true' : 'false'); });
    N(PrintStream_, 'println', '(I)V', function (VM, self, a) { if (typeof console !== 'undefined') console.log(String(a[0] | 0)); });
    N(PrintStream_, 'print', '(Ljava/lang/String;)V', function (VM, self, a) { if (typeof console !== 'undefined') console.log(str(a[0])); });
    N(System_, 'currentTimeMillis', '()J', function (VM, self, a) { return BigInt(Date.now()); }, true);
    N(System_, 'gc', '()V', function (VM, self, a) { }, true);
    N(System_, 'exit', '(I)V', function (VM, self, a) { VM.shutdown('system-exit'); throw new VM.HaltSignal(); }, true);
    N(System_, 'getProperty', '(Ljava/lang/String;)Ljava/lang/String;', function (VM, self, a) {
      var k = str(a[0]);
      var v = VM.instances.props[k];
      if (v === undefined) {
        if (k === 'microedition.platform') v = 'j2me';
        else if (k === 'microedition.locale') v = 'en-US';
        else if (k === 'microedition.profiles') v = 'MIDP-2.0';
        else if (k === 'microedition.configuration') v = 'CLDC-1.1';
        else if (k === 'microedition.encoding') v = 'ISO-8859-1';
        else v = null;
      }
      return v === null ? null : newString(v);
    }, true);
    N(System_, 'arraycopy', '(Ljava/lang/Object;ILjava/lang/Object;II)V', function (VM, self, a) {
      var src = a[0], srcPos = a[1] | 0, dst = a[2], dstPos = a[3] | 0, len = a[4] | 0;
      if (src === null || dst === null) VM.throwJava('java/lang/NullPointerException', '');
      if (srcPos < 0 || dstPos < 0 || len < 0 || srcPos + len > src.length || dstPos + len > dst.length) {
        VM.throwJava('java/lang/ArrayIndexOutOfBoundsException', '');
      }
      if (src === dst && dstPos > srcPos) {
        for (var i = len - 1; i >= 0; i--) dst[dstPos + i] = src[srcPos + i];
      } else {
        for (var j = 0; j < len; j++) dst[dstPos + j] = src[srcPos + j];
      }
    }, true);

    // ---------------- Class ----------------
    var Class_ = reg('java/lang/Class', 'java/lang/Object');
    function classObject(name) {
      if (!classObjects[name]) {
        var o = VM.newObj(Class_);
        o.$cname = name;
        classObjects[name] = o;
      }
      return classObjects[name];
    }
    var classObjects = {};
    N(Class_, 'getName', '()Ljava/lang/String;', function (VM, self, a) { return newString(self.$cname); });
    N(Class_, 'getResourceAsStream', '(Ljava/lang/String;)Ljava/io/InputStream;', function (VM, self, a) {
      var name = str(a[0]);
      if (name.charAt(0) === '/') name = name.substring(1);
      if (typeof VM_RESOURCES !== 'undefined' && VM_RESOURCES[name]) {
        return makeByteStream(VM.base64ToBytes(VM_RESOURCES[name]));
      }
      return null;
    });
    N(Class_, 'isInstance', '(Ljava/lang/Object;)Z', function (VM, self, a) { return jbool(false); });

    // ---------------- Thread ----------------
    var Thread_ = reg('java/lang/Thread', 'java/lang/Object');
    VM.addInstanceField(Thread_, '$target', 'Ljava/lang/Object;');
    N(Thread_, '<init>', '()V', function (VM, self, a) { self.$alive = false; });
    N(Thread_, '<init>', '(Ljava/lang/Runnable;)V', function (VM, self, a) { self.$target = a[0]; self.$alive = false; });
    N(Thread_, 'setPriority', '(I)V', function (VM, self, a) { });
    N(Thread_, 'start', '()V', function (VM, self, a) {
      var t = VM.newThread();
      t.javaObj = self;
      self.$alive = true;
      var target = self;
      var entry;
      // if a subclass overrides run(), run that; otherwise run the Runnable target
      var overridden = self.$cls.name !== 'java/lang/Thread' && VM.resolveMethod(self.$cls, 'run', '()V');
      if (overridden) {
        entry = { obj: self, name: 'run', desc: '()V' };
      } else {
        entry = { obj: self.$target, name: 'run', desc: '()V' };
      }
      t.runEntry = entry;
      VM.startJavaThreadWithEntry(t, entry);
    });
    N(Thread_, 'sleep', '(J)V', function (VM, self, a) {
      throw new VM.SleepSignal(Number(VM.toL(a[0])));
    }, true);
    N(Thread_, 'yield', '()V', function (VM, self, a) { throw new VM.SleepSignal(0); }, true);
    N(Thread_, 'currentThread', '()Ljava/lang/Thread;', function (VM, self, a) {
      var t = VM.current();
      if (t && t.javaObj) return t.javaObj;
      return null;
    }, true);

    // ---------------- java.io streams ----------------
    var InputStream_ = reg('java/io/InputStream', 'java/lang/Object');
    N(InputStream_, '<init>', '()V', function (VM, self, a) { });
    N(InputStream_, 'read', '()I', function (VM, self, a) {
      if (self.$pos >= self.$data.length) return -1;
      return self.$data[self.$pos++] & 0xFF;
    });
    N(InputStream_, 'read', '([B)I', function (VM, self, a) {
      var buf = a[0];
      if (self.$pos >= self.$data.length) return -1;
      var n = Math.min(buf.length, self.$data.length - self.$pos);
      for (var i = 0; i < n; i++) buf[i] = (self.$data[self.$pos + i] << 24) >> 24;
      self.$pos += n;
      return n;
    });
    N(InputStream_, 'read', '([BII)I', function (VM, self, a) {
      var buf = a[0], off = a[1] | 0, len = a[2] | 0;
      if (self.$pos >= self.$data.length) return -1;
      var n = Math.min(len, self.$data.length - self.$pos);
      for (var i = 0; i < n; i++) buf[off + i] = (self.$data[self.$pos + i] << 24) >> 24;
      self.$pos += n;
      return n;
    });
    N(InputStream_, 'skip', '(J)J', function (VM, self, a) {
      var n = Number(VM.toL(a[0]));
      var start = self.$pos;
      self.$pos = Math.min(self.$data.length, self.$pos + n);
      return BigInt(self.$pos - start);
    });
    N(InputStream_, 'available', '()I', function (VM, self, a) { return self.$data.length - self.$pos; });
    N(InputStream_, 'close', '()V', function (VM, self, a) { });
    N(InputStream_, 'mark', '(I)V', function (VM, self, a) { self.$mark = self.$pos; });
    N(InputStream_, 'reset', '()V', function (VM, self, a) { if (self.$mark !== undefined) self.$pos = self.$mark; });
    N(InputStream_, 'markSupported', '()Z', function (VM, self, a) { return 1; });

    function makeByteStream(bytes) {
      var o = VM.newObj(InputStream_);
      o.$data = bytes;
      o.$pos = 0;
      return o;
    }

    var ByteArrayInputStream_ = reg('java/io/ByteArrayInputStream', 'java/io/InputStream');
    N(ByteArrayInputStream_, '<init>', '([B)V', function (VM, self, a) {
      self.$data = a[0];
      self.$pos = 0;
    });

    var DataInputStream_ = reg('java/io/DataInputStream', 'java/io/InputStream');
    N(DataInputStream_, '<init>', '(Ljava/io/InputStream;)V', function (VM, self, a) {
      var inObj = a[0];
      self.$in = inObj;
      // delegate storage to embedded stream
      Object.defineProperty(self, '$data', { get: function () { return inObj.$data; }, configurable: true });
      Object.defineProperty(self, '$pos', {
        get: function () { return inObj.$pos; },
        set: function (v) { inObj.$pos = v; },
        configurable: true
      });
      Object.defineProperty(self, '$mark', {
        get: function () { return inObj.$mark; },
        set: function (v) { inObj.$mark = v; },
        configurable: true
      });
    });
    N(DataInputStream_, 'readUnsignedShort', '()I', function (VM, self, a) {
      var d = self.$data, p = self.$pos;
      var v = ((d[p] & 0xFF) << 8) | (d[p + 1] & 0xFF);
      self.$pos = p + 2;
      return v;
    });
    N(DataInputStream_, 'readUTF', '()Ljava/lang/String;', function (VM, self, a) {
      var d = self.$data, p = self.$pos;
      var len = ((d[p] & 0xFF) << 8) | (d[p + 1] & 0xFF);
      p += 2;
      var s = '';
      var end = p + len;
      while (p < end) {
        var c = d[p++] & 0xFF;
        if (c < 0x80) s += String.fromCharCode(c);
        else if ((c & 0xE0) === 0xC0) s += String.fromCharCode(((c & 0x1F) << 6) | (d[p++] & 63));
        else s += String.fromCharCode(((c & 0x0F) << 12) | ((d[p++] & 63) << 6) | (d[p++] & 63));
      }
      self.$pos = end;
      return newString(s);
    });
    N(DataInputStream_, 'skipBytes', '(I)I', function (VM, self, a) {
      var n = a[0] | 0;
      var start = self.$pos;
      self.$pos = Math.min(self.$data.length, self.$pos + n);
      return self.$pos - start;
    });

    // ---------------- java.util ----------------
    var Vector_ = reg('java/util/Vector', 'java/lang/Object');
    N(Vector_, '<init>', '()V', function (VM, self, a) { self.$items = []; });
    N(Vector_, 'addElement', '(Ljava/lang/Object;)V', function (VM, self, a) { self.$items.push(a[0]); });
    N(Vector_, 'elementAt', '(I)Ljava/lang/Object;', function (VM, self, a) { return self.$items[a[0] | 0]; });
    N(Vector_, 'size', '()I', function (VM, self, a) { return self.$items.length; });
    N(Vector_, 'removeAllElements', '()V', function (VM, self, a) { self.$items = []; });
    N(Vector_, 'elements', '()Ljava/util/Enumeration;', function (VM, self, a) {
      var e = VM.newObj(Enumeration_);
      e.$items = self.$items;
      e.$idx = 0;
      return e;
    });

    var Enumeration_ = reg('java/util/Enumeration', 'java/lang/Object', true);
    N(Enumeration_, 'hasMoreElements', '()Z', function (VM, self, a) { return jbool(self.$idx < self.$items.length); });
    N(Enumeration_, 'nextElement', '()Ljava/lang/Object;', function (VM, self, a) {
      if (self.$idx >= self.$items.length) VM.throwJava('java/lang/IllegalStateException', '');
      return self.$items[self.$idx++];
    });

    var Hashtable_ = reg('java/util/Hashtable', 'java/lang/Object');
    N(Hashtable_, '<init>', '()V', function (VM, self, a) { self.$map = new Map(); self.$keys = []; });
    N(Hashtable_, 'put', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', function (VM, self, a) {
      var k = keyOf(a[0]);
      var prev = self.$map.get(k);
      if (prev === undefined) self.$keys.push([a[0], k]);
      self.$map.set(k, a[1]);
      return prev === undefined ? null : prev;
    });
    N(Hashtable_, 'get', '(Ljava/lang/Object;)Ljava/lang/Object;', function (VM, self, a) {
      var v = self.$map.get(keyOf(a[0]));
      return v === undefined ? null : v;
    });
    N(Hashtable_, 'remove', '(Ljava/lang/Object;)Ljava/lang/Object;', function (VM, self, a) {
      var k = keyOf(a[0]);
      var v = self.$map.get(k);
      self.$map.delete(k);
      return v === undefined ? null : v;
    });
    N(Hashtable_, 'size', '()I', function (VM, self, a) { return self.$map.size; });
    N(Hashtable_, 'containsKey', '(Ljava/lang/Object;)Z', function (VM, self, a) { return jbool(self.$map.has(keyOf(a[0]))); });
    N(Hashtable_, 'keys', '()Ljava/util/Enumeration;', function (VM, self, a) {
      var e = VM.newObj(Enumeration_);
      e.$items = self.$keys.map(function (kv) { return kv[0]; });
      e.$idx = 0;
      return e;
    });

    var Random_ = reg('java/util/Random', 'java/lang/Object');
    var MULT = 0x5DEECE66Dn, ADD = 0xBn, MASK = (1n << 48n) - 1n;
    N(Random_, '<init>', '()V', function (VM, self, a) { self.$seed = (BigInt(Date.now()) ^ 0x5DEECE66Dn) & MASK; });
    N(Random_, '<init>', '(J)V', function (VM, self, a) { self.$seed = (VM.toL(a[0]) ^ 0x5DEECE66Dn) & MASK; });
    N(Random_, 'next', '(I)I', function (VM, self, a) {
      var bits = a[0] | 0;
      self.$seed = (self.$seed * MULT + ADD) & MASK;
      var r = self.$seed >> BigInt(48 - bits);
      return Number(BigInt.asIntN(32, r));
    });
    N(Random_, 'nextInt', '()I', function (VM, self, a) {
      self.$seed = (self.$seed * MULT + ADD) & MASK;
      return Number(BigInt.asIntN(32, self.$seed >> 16n));
    });
    N(Random_, 'nextInt', '(I)I', function (VM, self, a) {
      var n = a[0] | 0;
      if (n <= 0) VM.throwJava('java/lang/IllegalArgumentException', '');
      if ((n & -n) === n) {
        self.$seed = (self.$seed * MULT + ADD) & MASK;
        return Number(BigInt.asIntN(32, self.$seed >> 16n) * BigInt(n) >> 31n);
      }
      var bits, val;
      do {
        self.$seed = (self.$seed * MULT + ADD) & MASK;
        bits = Number(BigInt.asIntN(32, self.$seed >> 16n));
        val = bits % n;
      } while ((bits - val + (n - 1)) < 0);
      return val;
    });
    N(Random_, 'setSeed', '(J)V', function (VM, self, a) { self.$seed = (VM.toL(a[0]) ^ 0x5DEECE66Dn) & MASK; });

    // expose helpers for other native files
    VM.core = {
      str: str,
      newString: newString,
      intObj: intObj,
      jeq: jeq,
      keyOf: keyOf,
      makeByteStream: makeByteStream,
      classObject: classObject,
      reg: reg,
      classes: classes
    };

    // register String in the class table (needed before first use)
    VM.getClass('java/lang/Throwable');
  }

  VM.setNativeInstaller(install);
})();
