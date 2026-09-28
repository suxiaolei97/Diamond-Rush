/*
 * Nokia MobileBAE sound-bank sampler for the Diamond Rush JS JVM.
 *
 * Renders MIDI voices from the original Nokia "Charlie Bank" DLS samples
 * embedded by tools/build_soundfont.py (window.DR_SOUNDFONT). When that
 * asset is absent, midi.js falls back to its built-in oscillator synth.
 *
 * Region records (from the bank):
 *   k: [keyLo, keyHi], v: [velLo, velHi], root: unity note,
 *   fine: cents, gain: linear gain, wave: sample index,
 *   loop: [start, length] in sample frames.
 */
'use strict';

var SoundFont = (function () {

  // ------------------------------------------------------------------
  // base64 -> PCM
  // ------------------------------------------------------------------
  var B64 = null;
  function base64Table() {
    if (B64) return B64;
    B64 = new Int16Array(256);
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (var i = 0; i < 256; i++) B64[i] = -1;
    for (i = 0; i < chars.length; i++) B64[chars.charCodeAt(i)] = i;
    return B64;
  }

  function decodePCM(b64, bytes) {
    var table = base64Table();
    var n = b64.length;
    var out = new Uint8Array(bytes);
    var o = 0, acc = 0, bits = 0;
    for (var i = 0; i < n; i++) {
      var v = table[b64.charCodeAt(i) & 0xFF];
      if (v < 0) continue;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 0xFF;
      }
    }
    return out;
  }

  function toFloat(buf, byteLength) {
    var count = byteLength >> 1;
    var data = new Int16Array(buf.buffer, buf.byteOffset, count);
    var out = new Float32Array(count);
    for (var i = 0; i < count; i++) out[i] = data[i] / 32768;
    return out;
  }

  // ------------------------------------------------------------------
  // Envelope / loop policy per GM family
  // ------------------------------------------------------------------
  function envFor(prog) {
    var fam = prog >> 3;
    switch (fam) {
      case 0: return { loop: true, a: 0.002, d: 2.5, s: 0.07, r: 0.35 };  // piano
      case 1: return { loop: false, a: 0.002, d: 0, s: 1, r: 0.25 };      // chromatic percussion
      case 2: return { loop: true, a: 0.01, d: 0, s: 1, r: 0.12 };        // organ
      case 3: return { loop: true, a: 0.004, d: 1.2, s: 0.14, r: 0.2 };   // guitar
      case 4: return { loop: true, a: 0.004, d: 1.6, s: 0.18, r: 0.25 };  // bass
      case 5: return { loop: true, a: 0.05, d: 0, s: 1, r: 0.3 };         // strings
      case 6: return { loop: true, a: 0.03, d: 0, s: 1, r: 0.25 };        // ensemble / choir
      case 7: return { loop: true, a: 0.02, d: 0, s: 1, r: 0.15 };        // brass
      case 8: return { loop: true, a: 0.02, d: 0, s: 1, r: 0.15 };        // reed
      case 9: return { loop: true, a: 0.02, d: 0, s: 1, r: 0.12 };        // pipe
      case 10: return { loop: true, a: 0.01, d: 0, s: 1, r: 0.12 };       // synth lead
      case 11: return { loop: true, a: 0.25, d: 0, s: 1, r: 0.5 };        // synth pad
      case 12: return { loop: true, a: 0.2, d: 0, s: 0.75, r: 0.4 };      // synth fx
      case 13: return { loop: true, a: 0.004, d: 1.0, s: 0.12, r: 0.2 };  // ethnic
      case 14: return { loop: false, a: 0.001, d: 0, s: 1, r: 0.12 };     // percussive
      default: return { loop: false, a: 0.001, d: 0, s: 1, r: 0.1 };      // sfx
    }
  }

  var DRUM_ENV = { loop: false, a: 0.0015, d: 0, s: 1, r: 0.05 };

  // ------------------------------------------------------------------
  // Bank
  // ------------------------------------------------------------------
  function create(ctx, data) {
    var waves = [];
    for (var i = 0; i < data.waves.data.length; i++) {
      var b64 = data.waves.data[i];
      var pad = 0;
      if (b64.charAt(b64.length - 1) === '=') pad++;
      if (b64.charAt(b64.length - 2) === '=') pad++;
      var bytes = (b64.length >> 2) * 3 - pad;
      var raw = decodePCM(b64, bytes);
      var pcm = toFloat(raw, bytes);
      var rate = data.waves.rate[i];
      var buf = ctx.createBuffer(1, pcm.length, rate);
      var ch = buf.getChannelData(0);
      if (ch.set) { ch.set(pcm); } else { for (var j = 0; j < pcm.length; j++) ch[j] = pcm[j]; }
      waves.push(buf);
    }

    function usable(region) {
      if (!region || region.wave < 0 || region.wave >= waves.length) return null;
      return region;
    }

    function bestRegion(list, note, vel, wantVel) {
      var best = null, bestSpan = 1e9;
      for (var i = 0; i < (list ? list.length : 0); i++) {
        var r = list[i];
        if (note < r.k[0] || note > r.k[1]) continue;
        if (wantVel && (vel < r.v[0] || vel > r.v[1])) continue;
        var span = (r.k[1] - r.k[0]) * 1000 + (r.v[1] - r.v[0]);
        if (span < bestSpan) { bestSpan = span; best = r; }
      }
      return best;
    }

    function regionFor(prog, note, vel) {
      var list = (prog >= 0 && prog < 128) ? data.progs[prog] : null;
      if (!list || !list.length) return null;
      var r = bestRegion(list, note, vel, true) || bestRegion(list, note, vel, false);
      return usable(r);
    }

    function drumFor(note, vel) {
      var r = bestRegion(data.drum, note, vel, true) || bestRegion(data.drum, note, vel, false);
      return usable(r);
    }

    function startVoice(dest, params) {
      var isDrum = !!params.isDrum;
      var region = isDrum ? drumFor(params.note, params.vel)
                          : regionFor(params.prog, params.note, params.vel);
      if (!region) return null;
      var env = isDrum ? DRUM_ENV : envFor(params.prog);
      var at = params.at;
      if (at < ctx.currentTime + 0.003) at = ctx.currentTime + 0.003;

      var ratio = Math.pow(2, (params.note - region.root) / 12 + region.fine / 1200);
      ratio = Math.max(0.05, Math.min(8, ratio));
      var baseRate = ratio * (params.bend || 1);

      var gain = ctx.createGain();
      var tail = gain;
      if (ctx.createStereoPanner) {
        var panner = ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, params.pan || 0));
        gain.connect(panner);
        panner.connect(dest);
        tail = panner;
      } else {
        gain.connect(dest);
      }

      var amp = Math.pow(params.vel / 127, 1.25) * 0.55 * params.chanVol * params.volScale * region.gain;
      amp = Math.max(0.0002, Math.min(1.4, amp));
      var g = gain.gain;
      g.setValueAtTime(0.0001, at);
      g.linearRampToValueAtTime(amp, at + env.a);
      var sus = amp;
      if (env.d > 0 && env.s < 1) {
        sus = Math.max(0.0002, amp * env.s);
        g.exponentialRampToValueAtTime(sus, at + env.a + env.d);
      }

      var src = ctx.createBufferSource();
      src.buffer = waves[region.wave];
      src.playbackRate.value = baseRate;
      var loopLen = region.loop ? region.loop[1] : 0;
      var loopStart = region.loop ? region.loop[0] : 0;
      var waveRate = waves[region.wave].sampleRate || ctx.sampleRate;
      var bufDur = src.buffer.duration || 1e9;
      var loopStartS = loopStart / waveRate;
      var loopEndS = (loopStart + loopLen) / waveRate;
      if (env.loop && loopLen > 0 && loopStartS < bufDur && loopEndS <= bufDur + 1e-6) {
        src.loop = true;
        src.loopStart = loopStartS;
        src.loopEnd = Math.min(loopEndS, bufDur);
      }
      src.connect(gain);
      src.start(at);
      if (!src.loop) {
        try { src.stop(at + bufDur / ratio + 0.1); } catch (e) { }
      }

      return {
        kind: 'sf', src: src, gain: gain, tail: tail, ch: params.ch,
        baseRate: ratio, ratio: params.bend || 1, sus: sus, rel: env.r
      };
    }

    function release(voice, at) {
      var g = voice.gain.gain;
      try {
        if (g.cancelAndHoldAtTime) {
          g.cancelAndHoldAtTime(at);
        } else {
          var cur = Math.max(0.0002, g.value || 0.0002);
          g.cancelScheduledValues(at);
          g.setValueAtTime(cur, at);
        }
        g.exponentialRampToValueAtTime(0.0002, at + voice.rel);
      } catch (e) { }
      try { voice.src.stop(at + voice.rel + 0.05); } catch (e) { }
    }

    function bend(voice, ratio, at) {
      if (ratio === voice.ratio) return;
      var next = voice.baseRate * ratio;
      try {
        var p = voice.src.playbackRate;
        if (p.cancelScheduledValues) p.cancelScheduledValues(at);
        p.setValueAtTime(voice.baseRate * voice.ratio, at);
        p.linearRampToValueAtTime(next, at + 0.03);
      } catch (e) { }
      voice.ratio = ratio;
    }

    return {
      name: data.name || 'soundfont',
      waves: waves,
      regionFor: regionFor,
      drumFor: drumFor,
      startVoice: startVoice,
      release: release,
      bend: bend
    };
  }

  return { create: create };
})();
