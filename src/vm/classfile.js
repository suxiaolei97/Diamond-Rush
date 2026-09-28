/*
 * Minimal Java class file parser (CLDC-era class files, major 45-52).
 * Produces plain JS structures consumed by the interpreter.
 */
'use strict';

var CF = (function () {

  var TAG_UTF8 = 1, TAG_INT = 3, TAG_FLOAT = 4, TAG_LONG = 5, TAG_DOUBLE = 6,
      TAG_CLASS = 7, TAG_STRING = 8, TAG_FIELDREF = 9, TAG_METHODREF = 10,
      TAG_IMETHODREF = 11, TAG_NAMEANDTYPE = 12, TAG_MH = 15, TAG_MT = 16,
      TAG_DYNAMIC = 17, TAG_INVOKEDYNAMIC = 18;

  function Reader(bytes) {
    this.b = bytes;
    this.p = 0;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  Reader.prototype.u1 = function () { return this.b[this.p++]; };
  Reader.prototype.u2 = function () { var v = this.dv.getUint16(this.p); this.p += 2; return v; };
  Reader.prototype.u4 = function () { var v = this.dv.getUint32(this.p); this.p += 4; return v; };
  Reader.prototype.i4 = function () { var v = this.dv.getInt32(this.p); this.p += 4; return v; };
  Reader.prototype.bytes = function (n) { var v = this.b.subarray(this.p, this.p + n); this.p += n; return v; };
  Reader.prototype.skip = function (n) { this.p += n; };

  function decodeUtf8(bytes) {
    // Java modified UTF-8 / standard UTF-8 (no surrogates used by this game)
    var out = '', i = 0, n = bytes.length;
    while (i < n) {
      var c = bytes[i++];
      if (c < 0x80) {
        if (c === 0) { out += '\u0000'; } else { out += String.fromCharCode(c); }
      } else if ((c & 0xE0) === 0xC0) {
        out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
      } else if ((c & 0xF0) === 0xE0) {
        out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
      } else {
        i += 3;
      }
    }
    return out;
  }

  function parse(bytes) {
    var r = new Reader(bytes);
    if (r.u4() !== 0xCAFEBABE) throw new Error('bad magic');
    var minor = r.u2(), major = r.u2();
    var cpCount = r.u2();
    var cp = new Array(cpCount);
    cp[0] = null;
    var i = 1;
    while (i < cpCount) {
      var tag = r.u1();
      switch (tag) {
        case TAG_UTF8: {
          var len = r.u2();
          cp[i] = ['u', decodeUtf8(r.bytes(len))];
          break;
        }
        case TAG_INT: cp[i] = ['i', r.i4()]; break;
        case TAG_FLOAT: cp[i] = ['f', r.dv.getFloat32(r.p)]; r.skip(4); break;
        case TAG_LONG: {
          var v = r.dv.getBigInt64(r.p); r.skip(8);
          cp[i] = ['l', v];
          i++;
          break;
        }
        case TAG_DOUBLE: r.skip(8); i++; break;
        case TAG_CLASS: cp[i] = ['c', r.u2()]; break;
        case TAG_STRING: cp[i] = ['s', r.u2()]; break;
        case TAG_FIELDREF:
        case TAG_METHODREF:
        case TAG_IMETHODREF: cp[i] = ['r', r.u2(), r.u2(), tag]; break;
        case TAG_NAMEANDTYPE: cp[i] = ['n', r.u2(), r.u2()]; break;
        case TAG_MH: r.skip(3); i++; break;
        case TAG_MT: r.skip(2); i++; break;
        case TAG_DYNAMIC: r.skip(4); i++; break;
        case TAG_INVOKEDYNAMIC: r.skip(4); i++; break;
        default: throw new Error('unknown cp tag ' + tag + ' at ' + (r.p - 1));
      }
      i++;
    }

    var access = r.u2();
    var thisClass = r.u2();
    var superClass = r.u2();
    var ifCount = r.u2();
    var interfaces = [];
    for (i = 0; i < ifCount; i++) interfaces.push(className(cp, r.u2()));

    function skipAttributes() {
      var cnt = r.u2();
      var attrs = [];
      for (var k = 0; k < cnt; k++) {
        var ni = r.u2();
        var len = r.u4();
        attrs.push([utf(cp, ni), r.bytes(len)]);
      }
      return attrs;
    }

    var fields = [];
    var fc = r.u2();
    for (i = 0; i < fc; i++) {
      var flags = r.u2();
      var name = utf(cp, r.u2());
      var desc = utf(cp, r.u2());
      var attrs = skipAttributes();
      var constValue = undefined;
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a][0] === 'ConstantValue') {
          var ar = new Reader(attrs[a][1]);
          constValue = resolveConstant(cp, ar.u2());
        }
      }
      fields.push({ name: name, desc: desc, flags: flags, constValue: constValue, cls: null });
    }

    var methods = [];
    var mc = r.u2();
    for (i = 0; i < mc; i++) {
      var mflags = r.u2();
      var mname = utf(cp, r.u2());
      var mdesc = utf(cp, r.u2());
      var mattrs = skipAttributes();
      var code = null, maxStack = 0, maxLocals = 0, exceptions = null;
      for (var a2 = 0; a2 < mattrs.length; a2++) {
        if (mattrs[a2][0] === 'Code') {
          var cr = new Reader(mattrs[a2][1]);
          maxStack = cr.u2();
          maxLocals = cr.u2();
          var codeLen = cr.u4();
          code = cr.bytes(codeLen);
          var exCount = cr.u2();
          exceptions = [];
          for (var e = 0; e < exCount; e++) {
            var eStart = cr.u2(), eEnd = cr.u2(), eHandler = cr.u2(), eTypeIdx = cr.u2();
            exceptions.push({
              start: eStart, end: eEnd, handler: eHandler,
              type: eTypeIdx === 0 ? null : className(cp, eTypeIdx)
            });
          }
          // code attributes (LineNumberTable etc.) skipped
        }
      }
      methods.push({
        name: mname, desc: mdesc, flags: mflags, code: code,
        maxStack: maxStack, maxLocals: maxLocals, exceptions: exceptions, cls: null
      });
    }

    return {
      minor: minor, major: major, access: access,
      name: className(cp, thisClass),
      superName: superClass === 0 ? null : className(cp, superClass),
      interfaces: interfaces, fields: fields, methods: methods, cp: cp
    };
  }

  function utf(cp, idx) {
    var e = cp[idx];
    return e && e[0] === 'u' ? e[1] : null;
  }

  function resolveConstant(cp, idx) {
    var e = cp[idx];
    if (!e) return null;
    switch (e[0]) {
      case 'i': return e[1];
      case 'l': return e[1];
      case 'f': return e[1];
      case 's': return utf(cp, e[1]);
      case 'u': return e[1];
      default: return null;
    }
  }

  function className(cp, idx) {
    var e = cp[idx];
    if (!e) return null;
    if (e[0] === 'c') return utf(cp, e[1]);
    throw new Error('cp entry ' + idx + ' is not a class: ' + (e && e[0]));
  }

  function ref(cp, idx) {
    var e = cp[idx];
    var cls = className(cp, e[1]);
    var nt = cp[e[2]];
    return { cls: cls, name: utf(cp, nt[1]), desc: utf(cp, nt[2]), tag: e[3] };
  }

  return {
    parse: parse,
    utf: utf,
    className: className,
    ref: ref,
    resolveConstant: resolveConstant
  };
})();
