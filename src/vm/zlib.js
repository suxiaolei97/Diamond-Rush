/*
 * Minimal DEFLATE/zlib inflater (synchronous) for the JS JVM.
 * Supports concatenated zlib streams (used by the game's PNG resources).
 */
'use strict';

var ZLIB = (function () {

  function InflateError(msg) { this.message = msg; }
  InflateError.prototype = new Error();

  function inflateStream(input, start) {
    var pos = start + 2; // skip zlib header (CMF/FLG)
    var bitBuf = 0, bitCnt = 0;
    var out = [];
    var end = input.length;

    function refill() {
      while (bitCnt < 24 && pos < end) {
        bitBuf |= (input[pos++] & 0xFF) << bitCnt;
        bitCnt += 8;
      }
    }
    function bits(n) {
      if (bitCnt < n) refill();
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function alignByte() { bitBuf = 0; bitCnt = 0; }

    function buildHuffman(lengths) {
      // returns {counts, symbols}
      var maxBits = 0;
      for (var i = 0; i < lengths.length; i++) if (lengths[i] > maxBits) maxBits = lengths[i];
      var counts = new Array(maxBits + 1);
      for (var b = 0; b <= maxBits; b++) counts[b] = 0;
      for (var j = 0; j < lengths.length; j++) counts[lengths[j]]++;
      counts[0] = 0;
      var offs = new Array(maxBits + 2);
      offs[1] = 0;
      for (var l = 1; l <= maxBits; l++) offs[l + 1] = offs[l] + counts[l];
      var symbols = new Array(lengths.length);
      for (var s = 0; s < lengths.length; s++) {
        if (lengths[s] !== 0) symbols[offs[lengths[s]]++] = s;
      }
      return { counts: counts, symbols: symbols, maxBits: maxBits };
    }

    function decodeSym(h) {
      var code = 0, first = 0, index = 0;
      for (var len = 1; len <= h.maxBits; len++) {
        refill();
        code |= bits(1);
        var count = h.counts[len];
        if (code - first < count) return h.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new InflateError('bad huffman code');
    }

    var lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

    var fixedLit = null, fixedDist = null;
    function getFixed() {
      if (!fixedLit) {
        var ll = new Array(288);
        for (var i = 0; i < 144; i++) ll[i] = 8;
        for (; i < 256; i++) ll[i] = 9;
        for (; i < 280; i++) ll[i] = 7;
        for (; i < 288; i++) ll[i] = 8;
        fixedLit = buildHuffman(ll);
        var dl = new Array(30);
        for (var d = 0; d < 30; d++) dl[d] = 5;
        fixedDist = buildHuffman(dl);
      }
    }

    for (;;) {
      var final = bits(1);
      var type = bits(2);
      if (type === 0) {
        alignByte();
        var len = bits(16);
        bits(16);
        for (var s = 0; s < len; s++) out.push(input[pos++]);
      } else if (type === 1 || type === 2) {
        var lit, dist;
        if (type === 1) {
          getFixed();
          lit = fixedLit; dist = fixedDist;
        } else {
          var hlit = bits(5) + 257;
          var hdist = bits(5) + 1;
          var hclen = bits(4) + 4;
          var order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          var clen = new Array(19);
          for (var c = 0; c < 19; c++) clen[c] = 0;
          for (var h = 0; h < hclen; h++) clen[order[h]] = bits(3);
          var codeHuff = buildHuffman(clen);
          var lengths = [];
          while (lengths.length < hlit + hdist) {
            var sym = decodeSym(codeHuff);
            if (sym < 16) lengths.push(sym);
            else if (sym === 16) {
              var rep = 3 + bits(2);
              var prev = lengths[lengths.length - 1];
              while (rep-- > 0) lengths.push(prev);
            } else if (sym === 17) {
              var rep2 = 3 + bits(3);
              while (rep2-- > 0) lengths.push(0);
            } else {
              var rep3 = 11 + bits(7);
              while (rep3-- > 0) lengths.push(0);
            }
          }
          lit = buildHuffman(lengths.slice(0, hlit));
          dist = buildHuffman(lengths.slice(hlit));
        }
        for (;;) {
          var symbol = decodeSym(lit);
          if (symbol === 256) break;
          if (symbol < 256) {
            out.push(symbol);
          } else {
            symbol -= 257;
            var length = lengthBase[symbol] + bits(lengthExtra[symbol]);
            var dsym = decodeSym(dist);
            var distance = distBase[dsym] + bits(distExtra[dsym]);
            var from = out.length - distance;
            for (var k = 0; k < length; k++) out.push(out[from + k]);
          }
        }
      } else {
        throw new InflateError('bad block type');
      }
      if (final) break;
    }
    // skip adler32
    pos += 4;
    return { data: out, consumed: pos - start };
  }

  /** Inflate all concatenated zlib streams in `bytes`, returns byte array. */
  function inflateAll(bytes) {
    var out = [];
    var pos = 0;
    while (pos + 2 <= bytes.length) {
      // check zlib header
      var cmf = bytes[pos], flg = bytes[pos + 1];
      if ((cmf & 0x0F) !== 8 || ((cmf << 8 | flg) % 31) !== 0) {
        if (out.length === 0 && pos === 0) throw new InflateError('bad zlib header');
        break;
      }
      var r = inflateStream(bytes, pos);
      for (var i = 0; i < r.data.length; i++) out.push(r.data[i]);
      if (r.consumed <= 0) break;
      pos += r.consumed;
    }
    var arr = new Uint8Array(out.length);
    for (var j = 0; j < out.length; j++) arr[j] = out[j] & 0xFF;
    return arr;
  }

  return { inflateAll: inflateAll };
})();
