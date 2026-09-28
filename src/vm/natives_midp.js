/*
 * J2ME MIDP natives (LCDUI, RMS, Media) for the Diamond Rush JS JVM.
 * Includes a software rasterizer so rendering matches the original exactly.
 */
'use strict';

(function () {

  function install(VM) {
    var core = VM.core;
    var str = core.str;
    var newString = core.newString;
    var reg = core.reg;
    var classes = core.classes;

    function N(cls, name, desc, fn, isStatic) { return VM.addNative(cls, name, desc, fn, isStatic); }
    function SF(cls, name, desc, v) { return VM.addStaticField(cls, name, desc, v); }
    function AIF(cls, name, desc) { return VM.addInstanceField(cls, name, desc); }
    function jbool(b) { return b ? 1 : 0; }

    // ---------------- font ----------------
    var FONT5X7_BYTES = null;
    function fontBytes() {
      if (!FONT5X7_BYTES && typeof FONT_5X7 !== 'undefined') FONT5X7_BYTES = VM.base64ToBytes(FONT_5X7);
      return FONT5X7_BYTES;
    }

    var Font_ = reg('javax/microedition/lcdui/Font', 'java/lang/Object');
    var fontCache = {};
    var _measureCtx = null;
    function measureCtx() {
      if (_measureCtx) return _measureCtx;
      if (typeof document === 'undefined') return null;
      var cv = document.createElement('canvas');
      cv.width = 96; cv.height = 48;
      _measureCtx = cv.getContext('2d');
      return _measureCtx;
    }
    function makeFont(size) {
      var small = (size === 8);
      var o = VM.newObj(Font_);
      o.$size = size;
      o.$height = small ? 11 : 13;
      o.$ascent = small ? 10 : 12;
      o.$cellW = 6;
      o.$glyphW = 5;
      o.$glyphH = 7;
      o.$fontSpec = small ? '10px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
                          : '12px "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
      o.$cjk = {};
      o.$widths = {};
      o.$data = fontBytes();
      return o;
    }
    function charW(font, code) {
      if (code >= 32 && code <= 126) return font.$cellW;
      var cached = font.$widths[code];
      if (cached) return cached;
      var ctx = measureCtx();
      if (!ctx) return font.$height;
      ctx.font = font.$fontSpec;
      var m = ctx.measureText(String.fromCharCode(code));
      var w = Math.ceil(m.width);
      if (w <= 0) w = font.$height;
      font.$widths[code] = w;
      return w;
    }
    function stringW(font, s) {
      var total = 0;
      for (var i = 0; i < s.length; i++) total += charW(font, s.charCodeAt(i));
      return total;
    }
    function cjkBitmap(font, code) {
      var cached = font.$cjk[code];
      if (cached) return cached;
      var ctx = measureCtx();
      if (!ctx) return null;
      var w = charW(font, code), h = font.$height;
      var cv = ctx.canvas;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.font = font.$fontSpec;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff';
      ctx.fillText(String.fromCharCode(code), 0, font.$ascent - 1);
      var img = ctx.getImageData(0, 0, w, h);
      var d = img.data;
      var pts = [];
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (d[(y * w + x) * 4 + 3] > 90) pts.push(x, y);
        }
      }
      var res = { w: w, pts: pts };
      font.$cjk[code] = res;
      return res;
    }
    N(Font_, 'getFont', '(III)Ljavax/microedition/lcdui/Font;', function (VM, self, a) {
      var size = a[2] | 0;
      var key = size === 8 ? 's' : 'm';
      if (!fontCache[key]) fontCache[key] = makeFont(key === 's' ? 8 : 0);
      return fontCache[key];
    }, true);
    N(Font_, 'getHeight', '()I', function (VM, self, a) { return self.$height; });
    N(Font_, 'getBaselinePosition', '()I', function (VM, self, a) { return self.$ascent; });
    N(Font_, 'charWidth', '(C)I', function (VM, self, a) { return charW(self, a[0] & 0xFFFF); });
    N(Font_, 'stringWidth', '(Ljava/lang/String;)I', function (VM, self, a) {
      var s = str(a[0]);
      return s === null ? 0 : stringW(self, s);
    });
    N(Font_, 'charsWidth', '([CII)I', function (VM, self, a) { var t = 0; for (var i = 0; i < (a[2] | 0); i++) t += charW(self, a[0][(a[1] | 0) + i]); return t; });

    function drawGlyphs(g, font, s, x, baseline, color) {
      var data = font.$data;
      var pen = x;
      var asciiTop = baseline - font.$glyphH;
      for (var i = 0; i < s.length; i++) {
        var code = s.charCodeAt(i);
        if (code === 10 || code === 13) continue;
        if (code >= 32 && code <= 126) {
          if (data) {
            var base = (code - 32) * 5;
            for (var gx = 0; gx < 5; gx++) {
              var col = data[base + gx] || 0;
              if (col === 0) continue;
              for (var gy = 0; gy < 7; gy++) {
                if ((col >> gy) & 1) gPlot(g, pen + gx, asciiTop + gy, color);
              }
            }
          }
          pen += font.$cellW;
        } else {
          var bmp = cjkBitmap(font, code);
          if (bmp) {
            var top = baseline - (font.$ascent - 1);
            for (var k = 0; k < bmp.pts.length; k += 2) {
              gPlot(g, pen + bmp.pts[k], top + bmp.pts[k + 1], color);
            }
            pen += bmp.w;
          } else {
            pen += charW(font, code);
          }
        }
      }
    }

    // ---------------- Image ----------------
    var Image_ = reg('javax/microedition/lcdui/Image', 'java/lang/Object');
    function makeImage(w, h) {
      var o = VM.newObj(Image_);
      o.$w = w;
      o.$h = h;
      o.$pixels = new Int32Array(w * h);
      o.$pixels.fill(0xFFFFFFFF);
      return o;
    }
    function makeImageEmpty(w, h) {
      var o = VM.newObj(Image_);
      o.$w = w;
      o.$h = h;
      o.$pixels = new Int32Array(w * h);
      return o;
    }
    N(Image_, 'getWidth', '()I', function (VM, self, a) { return self.$w; });
    N(Image_, 'getHeight', '()I', function (VM, self, a) { return self.$h; });
    N(Image_, 'createImage', '(II)Ljavax/microedition/lcdui/Image;', function (VM, self, a) {
      return makeImage(a[0] | 0, a[1] | 0);
    }, true);
    N(Image_, 'createImage', '([BII)Ljavax/microedition/lcdui/Image;', function (VM, self, a) {
      try {
        return decodePng(a[0], a[1] | 0, a[2] | 0);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('[png] ' + e + ' :: ' + (e && e.stack));
        return null;
      }
    }, true);
    N(Image_, 'createRGBImage', '([IIIZ)Ljavax/microedition/lcdui/Image;', function (VM, self, a) {
      var rgb = a[0], w = a[1] | 0, h = a[2] | 0, alpha = a[3];
      var o = makeImageEmpty(w, h);
      var px = o.$pixels;
      for (var i = 0; i < w * h; i++) {
        var p = rgb[i] | 0;
        if (!alpha) p = (p | 0xFF000000) | 0;
        px[i] = p;
      }
      return o;
    }, true);
    N(Image_, 'getGraphics', '()Ljavax/microedition/lcdui/Graphics;', function (VM, self, a) {
      return newGfx(self);
    });

    // ---------------- Graphics ----------------
    var Graphics_ = reg('javax/microedition/lcdui/Graphics', 'java/lang/Object');
    function newGfx(image) {
      var g = VM.newObj(Graphics_);
      g.$img = image;
      g.$buf = image.$pixels;
      g.$w = image.$w;
      g.$h = image.$h;
      g.$clipX = 0; g.$clipY = 0; g.$clipW = image.$w; g.$clipH = image.$h;
      g.$tx = 0; g.$ty = 0;
      g.$color = 0xFF000000 | 0;
      g.$font = makeFont(0);
      return g;
    }

    function gPlot(g, x, y, argb) {
      if (x < g.$clipX || y < g.$clipY || x >= g.$clipX + g.$clipW || y >= g.$clipY + g.$clipH) return;
      if (x < 0 || y < 0 || x >= g.$w || y >= g.$h) return;
      var idx = y * g.$w + x;
      var a = (argb >>> 24) & 0xFF;
      if (a === 0) return;
      var buf = g.$buf;
      if (a === 255) { buf[idx] = argb | 0xFF000000; return; }
      var dst = buf[idx];
      var r = ((((argb >> 16) & 0xFF) * a + ((dst >> 16) & 0xFF) * (255 - a)) / 255) | 0;
      var gg = ((((argb >> 8) & 0xFF) * a + ((dst >> 8) & 0xFF) * (255 - a)) / 255) | 0;
      var b = (((argb & 0xFF) * a + (dst & 0xFF) * (255 - a)) / 255) | 0;
      buf[idx] = (0xFF000000 | (r << 16) | (gg << 8) | b) | 0;
    }

    function gFillRect(g, x, y, w, h) {
      x += g.$tx; y += g.$ty;
      var x1 = Math.max(Math.max(x, g.$clipX), 0), y1 = Math.max(Math.max(y, g.$clipY), 0);
      var x2 = Math.min(Math.min(x + w, g.$clipX + g.$clipW), g.$w);
      var y2 = Math.min(Math.min(y + h, g.$clipY + g.$clipH), g.$h);
      var buf = g.$buf, col = g.$color;
      for (var yy = y1; yy < y2; yy++) {
        var row = yy * g.$w;
        for (var xx = x1; xx < x2; xx++) buf[row + xx] = col;
      }
    }

    function gBlit(g, img, sx, sy, sw, sh, dx, dy, transform) {
      var src = img.$pixels;
      var iw = img.$w;
      for (var v = 0; v < sh; v++) {
        for (var u = 0; u < sw; u++) {
          var x, y;
          switch (transform) {
            case 5: x = sh - 1 - v; y = u; break;
            case 6: x = v; y = sw - 1 - u; break;
            case 7: x = sh - 1 - v; y = sw - 1 - u; break;
            case 4: x = v; y = u; break;
            case 2: x = sw - 1 - u; y = v; break;
            case 1: x = u; y = sh - 1 - v; break;
            case 3: x = sw - 1 - u; y = sh - 1 - v; break;
            default: x = u; y = v;
          }
          var p = src[(sy + v) * iw + (sx + u)];
          var a = (p >>> 24) & 0xFF;
          if (a === 0) continue;
          var wx = dx + x + g.$tx, wy = dy + y + g.$ty;
          if (wx < g.$clipX || wy < g.$clipY || wx >= g.$clipX + g.$clipW || wy >= g.$clipY + g.$clipH) continue;
          if (wx < 0 || wy < 0 || wx >= g.$w || wy >= g.$h) continue;
          var idx = wy * g.$w + wx;
          var buf = g.$buf;
          if (a === 255) { buf[idx] = p | 0xFF000000; continue; }
          var dst = buf[idx];
          var r = ((((p >> 16) & 0xFF) * a + ((dst >> 16) & 0xFF) * (255 - a)) / 255) | 0;
          var gg = ((((p >> 8) & 0xFF) * a + ((dst >> 8) & 0xFF) * (255 - a)) / 255) | 0;
          var b = (((p & 0xFF) * a + (dst & 0xFF) * (255 - a)) / 255) | 0;
          buf[idx] = (0xFF000000 | (r << 16) | (gg << 8) | b) | 0;
        }
      }
    }

    function drawStringImpl(g, font, s, x, y, anchor, color) {
      var w = stringW(font, s);
      var bx = x + g.$tx, baseline = y + g.$ty;
      if ((anchor & 1) !== 0) bx -= (w / 2) | 0;
      else if ((anchor & 8) !== 0) bx -= w;
      if ((anchor & 32) !== 0) baseline = baseline - font.$height + font.$ascent;
      else if ((anchor & 2) !== 0) baseline = baseline - ((font.$height / 2) | 0) + font.$ascent;
      else if ((anchor & 64) !== 0) baseline = baseline;
      else baseline = baseline + font.$ascent;
      drawGlyphs(g, font, s, bx, baseline, color);
    }

    N(Graphics_, 'setColor', '(I)V', function (VM, self, a) { self.$color = (0xFF000000 | (a[0] & 0xFFFFFF)) | 0; });
    N(Graphics_, 'setColor', '(III)V', function (VM, self, a) {
      self.$color = (0xFF000000 | ((a[0] & 0xFF) << 16) | ((a[1] & 0xFF) << 8) | (a[2] & 0xFF)) | 0;
    });
    N(Graphics_, 'getColor', '()I', function (VM, self, a) { return self.$color & 0xFFFFFF; });
    N(Graphics_, 'getDisplayColor', '(I)I', function (VM, self, a) { return a[0]; });
    N(Graphics_, 'setFont', '(Ljavax/microedition/lcdui/Font;)V', function (VM, self, a) { self.$font = a[0]; });
    N(Graphics_, 'getFont', '()Ljavax/microedition/lcdui/Font;', function (VM, self, a) { return self.$font; });
    N(Graphics_, 'translate', '(II)V', function (VM, self, a) { self.$tx += a[0] | 0; self.$ty += a[1] | 0; });
    N(Graphics_, 'getTranslateX', '()I', function (VM, self, a) { return self.$tx; });
    N(Graphics_, 'getTranslateY', '()I', function (VM, self, a) { return self.$ty; });
    N(Graphics_, 'setClip', '(IIII)V', function (VM, self, a) {
      self.$clipX = (a[0] | 0) + self.$tx;
      self.$clipY = (a[1] | 0) + self.$ty;
      self.$clipW = a[2] | 0;
      self.$clipH = a[3] | 0;
    });
    N(Graphics_, 'clipRect', '(IIII)V', function (VM, self, a) {
      var nx = (a[0] | 0) + self.$tx, ny = (a[1] | 0) + self.$ty;
      var x1 = Math.max(self.$clipX, nx), y1 = Math.max(self.$clipY, ny);
      var x2 = Math.min(self.$clipX + self.$clipW, nx + (a[2] | 0));
      var y2 = Math.min(self.$clipY + self.$clipH, ny + (a[3] | 0));
      self.$clipX = x1; self.$clipY = y1;
      self.$clipW = Math.max(0, x2 - x1); self.$clipH = Math.max(0, y2 - y1);
    });
    N(Graphics_, 'getClipX', '()I', function (VM, self, a) { return self.$clipX - self.$tx; });
    N(Graphics_, 'getClipY', '()I', function (VM, self, a) { return self.$clipY - self.$ty; });
    N(Graphics_, 'getClipWidth', '()I', function (VM, self, a) { return self.$clipW; });
    N(Graphics_, 'getClipHeight', '()I', function (VM, self, a) { return self.$clipH; });
    N(Graphics_, 'fillRect', '(IIII)V', function (VM, self, a) { gFillRect(self, a[0] | 0, a[1] | 0, a[2] | 0, a[3] | 0); });
    N(Graphics_, 'drawRect', '(IIII)V', function (VM, self, a) {
      var x = a[0] | 0, y = a[1] | 0, w = a[2] | 0, h = a[3] | 0;
      gFillRect(self, x, y, w, 1);
      gFillRect(self, x, y + h - 1, w, 1);
      gFillRect(self, x, y, 1, h);
      gFillRect(self, x + w - 1, y, 1, h);
    });
    N(Graphics_, 'drawLine', '(IIII)V', function (VM, self, a) {
      var x1 = (a[0] | 0) + self.$tx, y1 = (a[1] | 0) + self.$ty;
      var x2 = (a[2] | 0) + self.$tx, y2 = (a[3] | 0) + self.$ty;
      var dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
      var sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
      var err = dx - dy;
      for (;;) {
        gPlot(self, x1, y1, self.$color);
        if (x1 === x2 && y1 === y2) break;
        var e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x1 += sx; }
        if (e2 < dx) { err += dx; y1 += sy; }
      }
    });
    N(Graphics_, 'fillRoundRect', '(IIIIII)V', function (VM, self, a) {
      var x = a[0] | 0, y = a[1] | 0, w = a[2] | 0, h = a[3] | 0;
      var aw = a[4] | 0, ah = a[5] | 0;
      var r = (Math.min(aw, ah) / 2) | 0;
      gFillRect(self, x + r, y, w - 2 * r, h);
      gFillRect(self, x, y + r, r, h - 2 * r);
      gFillRect(self, x + w - r, y + r, r, h - 2 * r);
      for (var i = 0; i < r; i++) {
        for (var j = 0; j < r; j++) {
          if ((r - i - 1) * (r - i - 1) + (r - j - 1) * (r - j - 1) <= (r - 1) * (r - 1) + 2) {
            gPlot(self, x + self.$tx + i, y + self.$ty + j, self.$color);
            gPlot(self, x + self.$tx + w - 1 - i, y + self.$ty + j, self.$color);
            gPlot(self, x + self.$tx + i, y + self.$ty + h - 1 - j, self.$color);
            gPlot(self, x + self.$tx + w - 1 - i, y + self.$ty + h - 1 - j, self.$color);
          }
        }
      }
    });
    N(Graphics_, 'drawRoundRect', '(IIIIII)V', function (VM, self, a) {
      var x = a[0] | 0, y = a[1] | 0, w = a[2] | 0, h = a[3] | 0;
      gFillRect(self, x + 2, y, w - 4, 1);
      gFillRect(self, x + 2, y + h - 1, w - 4, 1);
      gFillRect(self, x, y + 2, 1, h - 4);
      gFillRect(self, x + w - 1, y + 2, 1, h - 4);
      gPlot(self, x + self.$tx + 1, y + self.$ty + 1, self.$color);
      gPlot(self, x + self.$tx + w - 2, y + self.$ty + 1, self.$color);
      gPlot(self, x + self.$tx + 1, y + self.$ty + h - 2, self.$color);
      gPlot(self, x + self.$tx + w - 2, y + self.$ty + h - 2, self.$color);
    });
    N(Graphics_, 'fillArc', '(IIIIII)V', function (VM, self, a) {
      var x = a[0] | 0, y = a[1] | 0, w = a[2] | 0, h = a[3] | 0;
      gFillRect(self, x, y, w, h);
    });
    N(Graphics_, 'drawArc', '(IIIIII)V', function (VM, self, a) { });
    N(Graphics_, 'drawImage', '(Ljavax/microedition/lcdui/Image;III)V', function (VM, self, a) {
      var img = a[0];
      if (!img) VM.throwJava('java/lang/NullPointerException', 'image');
      var x = a[1] | 0, y = a[2] | 0, anchor = a[3] | 0;
      var w = img.$w, h = img.$h;
      var dx = x, dy = y;
      if ((anchor & 1) !== 0) dx -= (w / 2) | 0;
      else if ((anchor & 8) !== 0) dx -= w;
      if ((anchor & 2) !== 0) dy -= (h / 2) | 0;
      else if ((anchor & 32) !== 0) dy -= h;
      gBlit(self, img, 0, 0, w, h, dx, dy, 0);
    });
    N(Graphics_, 'drawRegion', '(Ljavax/microedition/lcdui/Image;IIIIIIII)V', function (VM, self, a) {
      var img = a[0];
      if (!img) VM.throwJava('java/lang/NullPointerException', 'image');
      var sx = a[1] | 0, sy = a[2] | 0, sw = a[3] | 0, sh = a[4] | 0;
      var transform = a[5] | 0, dx = a[6] | 0, dy = a[7] | 0, anchor = a[8] | 0;
      var rot = (transform === 5 || transform === 6 || transform === 7 || transform === 4);
      var dw = rot ? sh : sw, dh = rot ? sw : sh;
      var ax = dx, ay = dy;
      if ((anchor & 1) !== 0) ax -= (dw / 2) | 0;
      else if ((anchor & 8) !== 0) ax -= dw;
      if ((anchor & 2) !== 0) ay -= (dh / 2) | 0;
      else if ((anchor & 32) !== 0) ay -= dh;
      gBlit(self, img, sx, sy, sw, sh, ax, ay, transform);
    });
    N(Graphics_, 'drawString', '(Ljava/lang/String;III)V', function (VM, self, a) {
      if (VM.instances.logText) VM.instances.log('[text] "' + str(a[0]) + '" x=' + (a[1] | 0) + ' y=' + (a[2] | 0) + ' anchor=' + (a[3] | 0) + ' color=' + (self.$color & 0xFFFFFF).toString(16) + ' fontH=' + self.$font.$height);
      drawStringImpl(self, self.$font, str(a[0]), a[1] | 0, a[2] | 0, a[3] | 0, self.$color);
    });
    N(Graphics_, 'drawChar', '(CIII)V', function (VM, self, a) {
      drawStringImpl(self, self.$font, String.fromCharCode(a[0] & 0xFFFF), a[1] | 0, a[2] | 0, a[3] | 0, self.$color);
    });
    N(Graphics_, 'drawSubstring', '(Ljava/lang/String;IIII)V', function (VM, self, a) {
      var s = str(a[0]).substring(a[1] | 0, (a[1] | 0) + (a[2] | 0));
      drawStringImpl(self, self.$font, s, a[3] | 0, a[4] | 0, 0, self.$color);
    });
    N(Graphics_, 'drawRGB', '([IIIIIIIZ)V', function (VM, self, a) { });
    N(Graphics_, 'getStrokeStyle', '()I', function (VM, self, a) { return 0; });
    N(Graphics_, 'setStrokeStyle', '(I)V', function (VM, self, a) { });

    // ---------------- PNG ----------------
    function paeth(a, b, c) {
      var p = a + b - c;
      var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      if (pb <= pc) return b;
      return c;
    }

    function decodePng(bytes, off, len) {
      if (!((bytes[off] & 0xFF) === 0x89 && (bytes[off + 1] & 0xFF) === 0x50 && (bytes[off + 2] & 0xFF) === 0x4E && (bytes[off + 3] & 0xFF) === 0x47)) return null;
      var w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
      var palette = null, trns = null;
      var idat = [];
      var p = off + 8;
      var end = off + len;
      function readU32(q) {
        return ((bytes[q] & 0xFF) * 0x1000000) + ((bytes[q + 1] & 0xFF) << 16) + ((bytes[q + 2] & 0xFF) << 8) + (bytes[q + 3] & 0xFF);
      }
      while (p + 8 <= end) {
        var clen = readU32(p) >>> 0;
        var type = String.fromCharCode(bytes[p + 4] & 0xFF, bytes[p + 5] & 0xFF, bytes[p + 6] & 0xFF, bytes[p + 7] & 0xFF);
        if (type === 'IHDR') {
          w = readU32(p + 8); h = readU32(p + 12);
          bitDepth = bytes[p + 16] & 0xFF; colorType = bytes[p + 17] & 0xFF; interlace = bytes[p + 20] & 0xFF;
        } else if (type === 'PLTE') {
          var n = (clen / 3) | 0;
          palette = new Array(n);
          for (var i = 0; i < n; i++) {
            palette[i] = (0xFF000000 | ((bytes[p + 8 + i * 3] & 0xFF) << 16) | ((bytes[p + 8 + i * 3 + 1] & 0xFF) << 8) | (bytes[p + 8 + i * 3 + 2] & 0xFF)) | 0;
          }
        } else if (type === 'tRNS') {
          trns = new Array(clen);
          for (var t = 0; t < clen; t++) trns[t] = bytes[p + 8 + t] & 0xFF;
        } else if (type === 'IDAT') {
          for (var d = 0; d < clen; d++) idat.push(bytes[p + 8 + d] & 0xFF);
        } else if (type === 'IEND') {
          break;
        }
        p = p + 12 + clen;
      }
      var raw = ZLIB.inflateAll(new Uint8Array(idat));
      var channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
      var bpp = Math.max(1, (channels * bitDepth / 8) | 0);
      var stride = ((w * channels * bitDepth + 7) >> 3);
      var img = new Uint8Array(h * stride);
      var imgOff = 0;
      for (var y = 0; y < h; y++) {
        var ft = raw[y * (stride + 1)];
        var src = y * (stride + 1) + 1;
        var dst = y * stride;
        var up = dst - stride;
        for (var x = 0; x < stride; x++) {
          var a = x >= bpp ? img[dst + x - bpp] : 0;
          var b = y > 0 ? img[up + x] : 0;
          var c = (x >= bpp && y > 0) ? img[up + x - bpp] : 0;
          var v = raw[src + x];
          switch (ft) {
            case 1: v = (v + a) & 0xFF; break;
            case 2: v = (v + b) & 0xFF; break;
            case 3: v = (v + ((a + b) >> 1)) & 0xFF; break;
            case 4: v = (v + paeth(a, b, c)) & 0xFF; break;
          }
          img[dst + x] = v;
        }
      }
      var out = makeImageEmpty(w, h);
      var px = out.$pixels;
      for (y = 0; y < h; y++) {
        var rowStart = y * stride;
        for (x = 0; x < w; x++) {
          var idx = y * w + x;
          if (bitDepth === 8) {
            var o8 = rowStart + x * channels;
            if (colorType === 0) {
              var g0 = img[o8];
              px[idx] = (0xFF000000 | (g0 << 16) | (g0 << 8) | g0) | 0;
            } else if (colorType === 2) {
              px[idx] = (0xFF000000 | (img[o8] << 16) | (img[o8 + 1] << 8) | img[o8 + 2]) | 0;
            } else if (colorType === 3) {
              var pi = img[o8];
              var cc = palette[pi];
              var al = (trns && pi < trns.length) ? trns[pi] : 255;
              px[idx] = ((al << 24) | (cc & 0xFFFFFF)) | 0;
            } else if (colorType === 4) {
              var g4 = img[o8];
              var a4 = img[o8 + 1];
              px[idx] = ((a4 << 24) | (g4 << 16) | (g4 << 8) | g4) | 0;
            } else {
              px[idx] = ((img[o8 + 3] << 24) | (img[o8] << 16) | (img[o8 + 1] << 8) | img[o8 + 2]) | 0;
            }
          } else if (bitDepth < 8 && colorType === 3) {
            var perByte = 8 / bitDepth;
            var byteIdx = rowStart + ((x / perByte) | 0);
            var shift = 8 - bitDepth * ((x % perByte) + 1);
            var pidx = (img[byteIdx] >> shift) & ((1 << bitDepth) - 1);
            var c2 = palette[pidx];
            var al2 = (trns && pidx < trns.length) ? trns[pidx] : 255;
            px[idx] = ((al2 << 24) | (c2 & 0xFFFFFF)) | 0;
          } else {
            px[idx] = 0xFF000000 | 0;
          }
        }
      }
      return out;
    }

    // ---------------- Displayable / Canvas / Display ----------------
    var Displayable_ = reg('javax/microedition/lcdui/Displayable', 'java/lang/Object');
    N(Displayable_, 'getWidth', '()I', function (VM, self, a) { return VM.instances.screenW; });
    N(Displayable_, 'getHeight', '()I', function (VM, self, a) { return VM.instances.screenH; });
    N(Displayable_, 'isShown', '()Z', function (VM, self, a) { return 1; });

    var Canvas_ = reg('javax/microedition/lcdui/Canvas', 'javax/microedition/lcdui/Displayable');
    N(Canvas_, '<init>', '()V', function (VM, self, a) { });
    N(Canvas_, 'repaint', '()V', function (VM, self, a) {
      VM.instances.repaintDirty = true;
      if (VM.current()) VM.instances.uiThread = VM.current();
      if (VM.instances.inPaint) return;
      var t = VM.current() || VM.instances.uiThread;
      if (!t) return;
      VM.instances.repaintDirty = false;
      var m = VM.resolveMethod(self.$cls, 'paint', '(Ljavax/microedition/lcdui/Graphics;)V');
      if (m) {
        VM.instances.inPaint = true;
        try { VM.call(t, m, self, [VM.instances.screenGfx]); }
        finally { VM.instances.inPaint = false; }
      }
      VM.instances.screenDirty = true;
    });
    N(Canvas_, 'repaint', '(IIII)V', function (VM, self, a) {
      VM.instances.repaintDirty = true;
      if (VM.instances.inPaint) return;
      var t = VM.current() || VM.instances.uiThread;
      if (!t) return;
      VM.instances.repaintDirty = false;
      var m = VM.resolveMethod(self.$cls, 'paint', '(Ljavax/microedition/lcdui/Graphics;)V');
      if (m) {
        VM.instances.inPaint = true;
        try { VM.call(t, m, self, [VM.instances.screenGfx]); }
        finally { VM.instances.inPaint = false; }
      }
      VM.instances.screenDirty = true;
    });
    N(Canvas_, 'serviceRepaints', '()V', function (VM, self, a) { });
    N(Canvas_, 'setFullScreenMode', '(Z)V', function (VM, self, a) { });
    N(Canvas_, 'isDoubleBuffered', '()Z', function (VM, self, a) { return 1; });
    N(Canvas_, 'hasPointerEvents', '()Z', function (VM, self, a) { return 0; });
    N(Canvas_, 'hasPointerMotionEvents', '()Z', function (VM, self, a) { return 0; });
    N(Canvas_, 'hasRepeatEvents', '()Z', function (VM, self, a) { return 1; });
    N(Canvas_, 'showNotify', '()V', function (VM, self, a) { });
    N(Canvas_, 'hideNotify', '()V', function (VM, self, a) { });
    N(Canvas_, 'getGameAction', '(I)I', function (VM, self, a) {
      switch (a[0] | 0) {
        case 50: return 1;
        case 56: return 6;
        case 52: return 2;
        case 54: return 5;
        case 53: return 8;
      }
      return 0;
    });
    N(Canvas_, 'getKeyCode', '(I)I', function (VM, self, a) { return 0; });
    N(Canvas_, 'getKeyName', '(I)Ljava/lang/String;', function (VM, self, a) { return newString(''); });
    N(Canvas_, 'keyPressed', '(I)V', function (VM, self, a) { });
    N(Canvas_, 'keyReleased', '(I)V', function (VM, self, a) { });
    N(Canvas_, 'keyRepeated', '(I)V', function (VM, self, a) { });
    N(Canvas_, 'pointerPressed', '(II)V', function (VM, self, a) { });
    N(Canvas_, 'pointerReleased', '(II)V', function (VM, self, a) { });
    N(Canvas_, 'pointerDragged', '(II)V', function (VM, self, a) { });

    var Display_ = reg('javax/microedition/lcdui/Display', 'java/lang/Object');
    var displayObj = VM.newObj(Display_);
    N(Display_, 'getDisplay', '(Ljavax/microedition/midlet/MIDlet;)Ljavax/microedition/lcdui/Display;', function (VM, self, a) {
      return displayObj;
    }, true);
    N(Display_, 'setCurrent', '(Ljavax/microedition/lcdui/Displayable;)V', function (VM, self, a) {
      var d = a[0];
      VM.instances.display = self;
      if (d && d.$cls && VM.isAssignable(d.$cls, 'javax/microedition/lcdui/Canvas')) {
        VM.instances.canvas = d;
        var t = VM.current();
        if (t) VM.instances.uiThread = t;
        var sn = VM.resolveMethod(d.$cls, 'showNotify', '()V');
        if (sn) VM.call(t || VM.instances.mainThread, sn, d, []);
      }
    });
    N(Display_, 'getCurrent', '()Ljavax/microedition/lcdui/Displayable;', function (VM, self, a) { return VM.instances.canvas; });
    N(Display_, 'vibrate', '(I)Z', function (VM, self, a) { return 0; });
    N(Display_, 'flashBacklight', '(I)Z', function (VM, self, a) { return 1; });
    N(Display_, 'isColor', '()Z', function (VM, self, a) { return 1; });
    N(Display_, 'numColors', '()I', function (VM, self, a) { return 16777216; });
    N(Display_, 'numAlphaLevels', '()I', function (VM, self, a) { return 256; });
    N(Display_, 'callSerially', '(Ljava/lang/Runnable;)V', function (VM, self, a) { });
    N(Display_, 'setCurrentItem', '(Ljavax/microedition/lcdui/Item;)V', function (VM, self, a) { });

    // ---------------- MIDlet ----------------
    var MIDlet_ = reg('javax/microedition/midlet/MIDlet', 'java/lang/Object');
    N(MIDlet_, '<init>', '()V', function (VM, self, a) { });
    N(MIDlet_, 'getAppProperty', '(Ljava/lang/String;)Ljava/lang/String;', function (VM, self, a) {
      var v = VM.instances.props[str(a[0])];
      return v === undefined ? null : newString(v);
    });
    N(MIDlet_, 'notifyDestroyed', '()V', function (VM, self, a) { VM.shutdown('destroyed'); });
    N(MIDlet_, 'notifyPaused', '()V', function (VM, self, a) { });
    N(MIDlet_, 'platformRequest', '(Ljava/lang/String;)Z', function (VM, self, a) { return 0; });
    N(MIDlet_, 'getAppProperty', '(Ljava/lang/String;)Ljava/lang/String;', function (VM, self, a) {
      var v = VM.instances.props[str(a[0])];
      return v === undefined ? null : newString(v);
    });

    reg('javax/microedition/lcdui/Item', 'java/lang/Object');
    reg('javax/microedition/lcdui/Command', 'java/lang/Object');

    // ---------------- RMS ----------------
    var RecordStore_ = reg('javax/microedition/rms/RecordStore', 'java/lang/Object');
    AIF(RecordStore_, '$name', 'Ljava/lang/String;');
    function rmsKey(name) { return 'dr_rms_' + name; }
    function rmsLoad(name) {
      var recs = [];
      try {
        if (typeof localStorage !== 'undefined') {
          var s = localStorage.getItem(rmsKey(name));
          if (s) {
            var arr = JSON.parse(s);
            for (var i = 0; i < arr.length; i++) {
              var b = VM.base64ToBytes(arr[i]);
              var copy = new Array(b.length);
              for (var j = 0; j < b.length; j++) copy[j] = (b[j] << 24) >> 24;
              copy.$atype = 8;
              recs.push(copy);
            }
          }
        }
      } catch (e) { }
      return recs;
    }
    function rmsSave(name, recs) {
      try {
        if (typeof localStorage !== 'undefined') {
          var arr = [];
          for (var i = 0; i < recs.length; i++) arr.push(VM.bytesToBase64(new Uint8Array(recs[i])));
          localStorage.setItem(rmsKey(name), JSON.stringify(arr));
        }
      } catch (e) { }
    }
    N(RecordStore_, 'openRecordStore', '(Ljava/lang/String;Z)Ljavax/microedition/rms/RecordStore;', function (VM, self, a) {
      var name = str(a[0]);
      var create = a[1];
      var exists = false;
      try { exists = typeof localStorage !== 'undefined' && localStorage.getItem(rmsKey(name)) !== null; } catch (e) { }
      if (!exists && !create) throw new VM.JThrowable(VM.makeException('java/lang/Exception', 'RecordStore not found: ' + name));
      var o = VM.newObj(RecordStore_);
      o.$name = name;
      o.$records = exists ? rmsLoad(name) : [];
      return o;
    }, true);
    N(RecordStore_, 'addRecord', '([BII)I', function (VM, self, a) {
      var data = a[0], off = a[1] | 0, len = a[2] | 0;
      if (VM.instances.logRms) print('[rs] addRecord ' + str(self.$name) + ' data=' + (data ? 'arr[' + data.length + ']' : String(data)) + ' off=' + off + ' len=' + len);
      var rec = new Array(len);
      for (var i = 0; i < len; i++) rec[i] = (data[off + i] << 24) >> 24;
      rec.$atype = 8;
      self.$records.push(rec);
      rmsSave(str(self.$name), self.$records);
      return self.$records.length;
    });
    N(RecordStore_, 'getRecord', '(I)[B', function (VM, self, a) {
      var rec = self.$records[(a[0] | 0) - 1];
      if (rec === undefined) throw new VM.JThrowable(VM.makeException('java/lang/Exception', 'RecordStore.getRecord ' + a[0]));
      var out = rec.slice();
      out.$atype = 8;
      return out;
    });
    N(RecordStore_, 'setRecord', '(I[BII)V', function (VM, self, a) {
      var id = a[0] | 0, data = a[1], off = a[2] | 0, len = a[3] | 0;
      if (self.$records[id - 1] === undefined) self.$records[id - 1] = [];
      var rec = new Array(len);
      for (var i = 0; i < len; i++) rec[i] = (data[off + i] << 24) >> 24;
      rec.$atype = 8;
      self.$records[id - 1] = rec;
      rmsSave(str(self.$name), self.$records);
    });
    N(RecordStore_, 'getNumRecords', '()I', function (VM, self, a) { return self.$records.length; });
    N(RecordStore_, 'closeRecordStore', '()V', function (VM, self, a) {
      if (self.$closed) throw new VM.JThrowable(VM.makeException('java/lang/Exception', 'RecordStore already closed: ' + str(self.$name)));
      self.$closed = true;
      if (VM.instances.logRms) print('[rs] close ' + str(self.$name) + ' records=' + self.$records.length);
      rmsSave(str(self.$name), self.$records);
    });
    N(RecordStore_, 'getRecordSize', '(I)I', function (VM, self, a) {
      var rec = self.$records[(a[0] | 0) - 1];
      if (rec === undefined) throw new VM.JThrowable(VM.makeException('java/lang/Exception', 'RecordStore.getRecordSize'));
      return rec.length;
    });
    N(RecordStore_, 'deleteRecord', '(I)V', function (VM, self, a) { self.$records[(a[0] | 0) - 1] = []; rmsSave(str(self.$name), self.$records); });

    // ---------------- Media ----------------
    reg('javax/microedition/media/Control', 'java/lang/Object', true);
    var Controllable_ = reg('javax/microedition/media/Controllable', 'java/lang/Object', true);
    var Player_ = reg('javax/microedition/media/Player', 'java/lang/Object', true);
    var PlayerListener_ = reg('javax/microedition/media/PlayerListener', 'java/lang/Object', true);
    N(PlayerListener_, 'playerUpdate', '(Ljavax/microedition/media/Player;Ljava/lang/String;Ljava/lang/Object;)V', function (VM, self, a) { });
    var VolumeControl_ = reg('javax/microedition/media/control/VolumeControl', 'java/lang/Object', true);
    reg('javax/microedition/media/TimeBase', 'java/lang/Object', true);
    var Manager_ = reg('javax/microedition/media/Manager', 'java/lang/Object');
    SF(Manager_, 'TIME_UNKNOWN', 'J', VM.toL(-1));

    N(Manager_, 'createPlayer', '(Ljava/io/InputStream;Ljava/lang/String;)Ljavax/microedition/media/Player;', function (VM, self, a) {
      var stream = a[0];
      var src = stream.$data || [];
      var data = new Uint8Array(src.length);
      for (var di = 0; di < src.length; di++) data[di] = src[di] & 0xFF;
      var p = VM.newObj(Player_);
      p.$data = data;
      p.$listeners = [];
      p.$state = 100;
      p.$volume = 100;
      var vc = VM.newObj(VolumeControl_);
      vc.$player = p;
      p.$control = vc;
      return p;
    }, true);
    N(Player_, 'realize', '()V', function (VM, self, a) { self.$state = 200; });
    N(Player_, 'prefetch', '()V', function (VM, self, a) { self.$state = 300; });
    N(Player_, 'start', '()V', function (VM, self, a) {
      self.$state = 400;
      if (VM.instances.logSound) VM.instances.log('[sound] start len=' + (self.$data ? self.$data.length : -1));
      if (VM.instances.audio && VM.instances.audio.play) {
        try { VM.instances.audio.play(self, self.$volume); } catch (e) { }
      }
    });
    N(Player_, 'stop', '()V', function (VM, self, a) { self.$state = 300; if (VM.instances.audio && VM.instances.audio.stop) VM.instances.audio.stop(self); });
    N(Player_, 'deallocate', '()V', function (VM, self, a) { self.$state = 200; if (VM.instances.audio && VM.instances.audio.stop) VM.instances.audio.stop(self); });
    N(Player_, 'close', '()V', function (VM, self, a) { self.$state = 0; if (VM.instances.audio && VM.instances.audio.stop) VM.instances.audio.stop(self); });
    N(Player_, 'setLoopCount', '(I)V', function (VM, self, a) { self.$loops = a[0] | 0; });
    N(Player_, 'getState', '()I', function (VM, self, a) { return self.$state; });
    N(Player_, 'getMediaTime', '()J', function (VM, self, a) { return 0n; });
    N(Player_, 'setMediaTime', '(J)J', function (VM, self, a) { return 0n; });
    N(Player_, 'getDuration', '()J', function (VM, self, a) { return 1000n; });
    N(Player_, 'getContentType', '()Ljava/lang/String;', function (VM, self, a) { return newString('audio/midi'); });
    N(Player_, 'addPlayerListener', '(Ljavax/microedition/media/PlayerListener;)V', function (VM, self, a) {
      if (a[0]) self.$listeners.push(a[0]);
    });
    N(Player_, 'removePlayerListener', '(Ljavax/microedition/media/PlayerListener;)V', function (VM, self, a) {
      var i = self.$listeners.indexOf(a[0]);
      if (i >= 0) self.$listeners.splice(i, 1);
    });
    N(Player_, 'getControl', '(Ljava/lang/String;)Ljavax/microedition/media/Control;', function (VM, self, a) {
      if (str(a[0]) === 'VolumeControl') return self.$control;
      return null;
    });
    N(Player_, 'getControls', '()[Ljavax/microedition/media/Control;', function (VM, self, a) {
      var arr = [self.$control];
      arr.$atype = '[Ljavax/microedition/media/Control;';
      return arr;
    });
    N(Player_, 'setTimeBase', '(Ljavax/microedition/media/TimeBase;)V', function (VM, self, a) { });
    N(Player_, 'getTimeBase', '()Ljavax/microedition/media/TimeBase;', function (VM, self, a) { return null; });
    N(VolumeControl_, 'setLevel', '(I)I', function (VM, self, a) {
      self.$player.$volume = a[0] | 0;
      if (VM.instances.audio && VM.instances.audio.setVolume) VM.instances.audio.setVolume(self.$player, a[0] | 0);
      return a[0] | 0;
    });
    N(VolumeControl_, 'getLevel', '()I', function (VM, self, a) { return self.$player.$volume; });
    N(VolumeControl_, 'setMute', '(Z)V', function (VM, self, a) { });
    N(VolumeControl_, 'isMuted', '()Z', function (VM, self, a) { return 0; });
    N(VolumeControl_, 'getControl', '(Ljava/lang/String;)Ljavax/microedition/media/Control;', function (VM, self, a) { return null; });

    reg('javax/microedition/media/MediaException', 'java/lang/Exception');

    // ---------------- screen ----------------
    VM.instances.screenW = VM.instances.screenW || 240;
    VM.instances.screenH = VM.instances.screenH || 320;
    VM.instances.screen = makeImage(VM.instances.screenW, VM.instances.screenH);
    VM.instances.screenGfx = newGfx(VM.instances.screen);
    VM.instances.screen.$pixels.fill(0xFF000000);
    VM.instances.screenDirty = true;

    VM.midp = {
      makeImage: makeImage,
      newGfx: newGfx,
      drawStringImpl: drawStringImpl,
      makeFont: makeFont,
      decodePng: decodePng
    };
  }

  VM.setNativeInstaller(install);
})();
