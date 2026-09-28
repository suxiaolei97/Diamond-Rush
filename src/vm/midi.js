/*
 * MIDI file parser + WebAudio synthesizer for the Diamond Rush JS JVM.
 *
 * Renders the game's original MIDI resources (music tracks + sound effects)
 * with clean per-instrument voices, a drum kit, dynamic pitch bend and
 * channel volume/pan. No vibrato/detune artifice: the original data has none
 * (only two effect tracks use pitch bend, which is rendered as a real glide).
 */
'use strict';

var MIDI = (function () {

  // ------------------------------------------------------------------
  // MIDI parsing
  // ------------------------------------------------------------------
  function parse(bytes) {
    var pos = 0;
    function u16() { var v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; }
    function u32() {
      var v = ((bytes[pos] & 0xFF) * 0x1000000) + ((bytes[pos + 1] & 0xFF) << 16) + ((bytes[pos + 2] & 0xFF) << 8) + (bytes[pos + 3] & 0xFF);
      pos += 4; return v;
    }
    function vlq() {
      var v = 0, b;
      do { b = bytes[pos++] & 0xFF; v = (v << 7) | (b & 0x7F); } while (b & 0x80);
      return v;
    }
    if (String.fromCharCode(bytes[0] & 0xFF, bytes[1] & 0xFF, bytes[2] & 0xFF, bytes[3] & 0xFF) !== 'MThd') throw new Error('not midi');
    pos = 4;
    var hlen = u32();
    var format = u16();
    var ntrks = u16();
    var division = u16();
    pos = 8 + hlen;
    var events = [];
    for (var t = 0; t < ntrks && pos + 8 <= bytes.length; t++) {
      var id = String.fromCharCode(bytes[pos] & 0xFF, bytes[pos + 1] & 0xFF, bytes[pos + 2] & 0xFF, bytes[pos + 3] & 0xFF);
      if (id !== 'MTrk') break;
      pos += 4;
      var tlen = u32();
      var end = pos + tlen;
      var tick = 0;
      var running = 0;
      while (pos < end) {
        tick += vlq();
        var status = bytes[pos] & 0xFF;
        if (status < 0x80) {
          status = running;
        } else {
          pos++;
          if (status < 0xF0) running = status;
        }
        if (status === 0xFF) {
          var type = bytes[pos++] & 0xFF;
          var len = vlq();
          if (type === 0x51 && len === 3) {
            var v = ((bytes[pos] & 0xFF) << 16) | ((bytes[pos + 1] & 0xFF) << 8) | (bytes[pos + 2] & 0xFF);
            events.push({ tick: tick, type: 'tempo', value: v });
          }
          pos += len;
        } else if (status === 0xF0 || status === 0xF7) {
          var slen = vlq();
          pos += slen;
        } else {
          var cmd = status & 0xF0;
          var ch = status & 0x0F;
          if (cmd === 0x90 || cmd === 0x80) {
            var n = bytes[pos++] & 0xFF;
            var vel = bytes[pos++] & 0xFF;
            events.push({ tick: tick, type: (cmd === 0x80 || vel === 0) ? 'off' : 'on', ch: ch, note: n, vel: vel });
          } else if (cmd === 0xB0) {
            var ccn = bytes[pos++] & 0xFF;
            var ccv = bytes[pos++] & 0xFF;
            if (ccn === 7) events.push({ tick: tick, type: 'vol', ch: ch, value: ccv });
            else if (ccn === 10) events.push({ tick: tick, type: 'pan', ch: ch, value: ccv });
          } else if (cmd === 0xE0) {
            var lo = bytes[pos++] & 0xFF;
            var hi = bytes[pos++] & 0xFF;
            events.push({ tick: tick, type: 'bend', ch: ch, value: ((hi << 7) | lo) - 8192 });
          } else if (cmd === 0xA0) {
            pos += 2;
          } else if (cmd === 0xC0) {
            var p = bytes[pos++] & 0xFF;
            events.push({ tick: tick, type: 'prog', ch: ch, value: p });
          } else if (cmd === 0xD0) {
            pos++;
          } else {
            pos += 2;
          }
        }
      }
      pos = end;
    }
    events.sort(function (a, b) { return a.tick - b.tick; });
    var tempo = 500000;
    var ppq = division || 480;
    var time = 0;
    var lastTick = 0;
    for (var k = 0; k < events.length; k++) {
      var e = events[k];
      time += (e.tick - lastTick) * (tempo / ppq) / 1000000;
      lastTick = e.tick;
      e.time = time;
      if (e.type === 'tempo') tempo = e.value;
    }
    return { ppq: ppq, events: events, duration: time + 0.1 };
  }

  // ------------------------------------------------------------------
  // Melodic instrument recipes
  //  partials: [waveform, multiplier, gain]
  //  a: attack, d: decay to sustain, s: sustain, r: release,
  //  noise: attack noise amount, drop: initial pitch drop fraction,
  //  ndur: noise burst duration, tf: noise filter frequency
  // ------------------------------------------------------------------
  function voiceSpec(prog) {
    var fam = Math.floor(prog / 8);
    switch (fam) {
      case 0: // piano
        return { partials: [['triangle', 1, 0.9], ['sine', 2, 0.22], ['sine', 3, 0.07]], a: 0.004, d: 0.8, s: 0.12, r: 0.25, noise: 0.03, ndur: 0.03, tf: 3000 };
      case 1: // chromatic percussion
        if (prog === 12) return { partials: [['sine', 1, 1], ['sine', 4, 0.22]], a: 0.002, d: 0.32, s: 0.0, r: 0.1, noise: 0.01, ndur: 0.02, tf: 4000 };
        if (prog === 14) return { partials: [['sine', 1, 1], ['sine', 2.76, 0.32]], a: 0.002, d: 1.2, s: 0.0, r: 0.4, noise: 0 };
        if (prog === 11) return { partials: [['sine', 1, 1], ['sine', 4, 0.18]], a: 0.002, d: 1.0, s: 0.0, r: 0.35, noise: 0 };
        return { partials: [['sine', 1, 1], ['sine', 2.8, 0.28], ['sine', 4.2, 0.1]], a: 0.002, d: 0.45, s: 0.0, r: 0.15, noise: 0.01, ndur: 0.02, tf: 5000 };
      case 2: // organ / accordion
        if (prog === 23) return { partials: [['sawtooth', 1, 0.6], ['square', 0.5, 0.2], ['sine', 2, 0.15]], a: 0.02, d: 0.15, s: 0.75, r: 0.1, noise: 0 };
        return { partials: [['sine', 1, 1], ['sine', 2, 0.4], ['sine', 3, 0.18], ['sine', 4, 0.08]], a: 0.01, d: 0.1, s: 0.85, r: 0.08, noise: 0 };
      case 3: // guitar / bass
        if (prog <= 39) return { partials: [['triangle', 1, 1], ['sine', 2, 0.25]], a: 0.003, d: 0.5, s: 0.08, r: 0.15, noise: 0.03, ndur: 0.02, tf: 1800 };
        return { partials: [['triangle', 1, 0.9], ['sawtooth', 2, 0.15]], a: 0.003, d: 0.45, s: 0.05, r: 0.15, noise: 0.05, ndur: 0.02, tf: 2500 };
      case 4: // strings / ensemble / harp / timpani
        if (prog === 47) return { partials: [['sine', 1, 1], ['sine', 1.5, 0.3]], a: 0.002, d: 0.85, s: 0.0, r: 0.3, noise: 0.06, ndur: 0.03, tf: 900 };
        if (prog === 46) return { partials: [['triangle', 1, 0.95], ['sine', 2, 0.25]], a: 0.002, d: 0.6, s: 0.04, r: 0.25, noise: 0.02, ndur: 0.02, tf: 3000 };
        if (prog === 45) return { partials: [['triangle', 1, 0.9], ['sine', 2, 0.3]], a: 0.002, d: 0.2, s: 0.0, r: 0.08, noise: 0.05, ndur: 0.02, tf: 2500 };
        return { partials: [['sawtooth', 1, 0.5], ['sine', 1, 0.4], ['sine', 2, 0.12]], a: 0.07, d: 0.25, s: 0.7, r: 0.2, noise: 0.02, ndur: 0.04, tf: 2500 };
      case 5: // reed / voice / brass
        if (prog < 56) return { partials: [['sawtooth', 1, 0.45], ['sine', 1, 0.45], ['sine', 2, 0.12]], a: 0.08, d: 0.25, s: 0.65, r: 0.25, noise: 0.02, ndur: 0.05, tf: 2000 };
        return { partials: [['sawtooth', 1, 0.5], ['square', 1, 0.2], ['sine', 2, 0.15]], a: 0.02, d: 0.18, s: 0.6, r: 0.12, noise: 0.03, ndur: 0.03, tf: 2500 };
      case 6: // pipe / flute / synth lead
        if (prog < 80) return { partials: [['sine', 1, 1], ['sine', 2, 0.12]], a: 0.03, d: 0.12, s: 0.7, r: 0.1, noise: 0.05, ndur: 0.06, tf: 3500 };
        return { partials: [['square', 1, 0.5], ['sawtooth', 1, 0.35], ['sine', 2, 0.1]], a: 0.01, d: 0.18, s: 0.6, r: 0.1, noise: 0 };
      case 7: // synth pad
        return { partials: [['sawtooth', 1, 0.45], ['sine', 1, 0.4], ['sine', 2, 0.1]], a: 0.3, d: 0.35, s: 0.6, r: 0.4, noise: 0 };
      case 8: // FX
        return { partials: [['sawtooth', 1, 0.45], ['square', 0.5, 0.25], ['sine', 3, 0.1]], a: 0.01, d: 0.4, s: 0.15, r: 0.3, noise: 0.12, ndur: 0.08, tf: 2000 };
      case 9: // ethnic
        return { partials: [['triangle', 1, 0.85], ['sine', 2, 0.2]], a: 0.003, d: 0.45, s: 0.06, r: 0.18, noise: 0.04, ndur: 0.02, tf: 2500 };
      case 10: // percussive (taiko / melodic tom / synth drum / reverse cymbal)
        if (prog === 119) return { partials: [['triangle', 1, 0.35]], a: 0.002, d: 0.02, s: 0, r: 0.05, noise: 1.0, ndur: 0.9, tf: 4000, swell: true };
        if (prog >= 120) return { partials: [['square', 1, 0.15]], a: 0.001, d: 0.05, s: 0, r: 0.04, noise: 0.9, ndur: 0.05, tf: 3000 };
        // taiko / tom / synth drum: solid impact thud
        return { partials: [['sine', 1, 1], ['sine', 1.9, 0.22]], a: 0.001, d: 0.28, s: 0, r: 0.09, drop: 0.22, noise: 0.5, ndur: 0.05, tf: 1200 };
      default:
        return { partials: [['triangle', 1, 0.8], ['sine', 2, 0.18]], a: 0.004, d: 0.35, s: 0.15, r: 0.12, noise: 0 };
    }
  }

  function drumSpec(note) {
    if (note <= 36) return { kind: 'kick', f: note <= 35 ? 55 : 65, drop: 0.45, dur: 0.16, noise: 0.25 };
    if (note <= 40) return { kind: 'snare', f: 185, dur: 0.16, noise: 0.8 };
    if (note === 39) return { kind: 'clap', f: 250, dur: 0.15, noise: 0.9 };
    if (note === 42 || note === 44) return { kind: 'hat', dur: 0.05, noise: 0.7, hp: 8000 };
    if (note === 46) return { kind: 'hat', dur: 0.22, noise: 0.6, hp: 7000 };
    if (note === 49 || note === 57 || note === 55) return { kind: 'crash', dur: 0.9, noise: 0.8, hp: 6000 };
    if (note === 51 || note === 59) return { kind: 'ride', dur: 0.7, noise: 0.45, hp: 7000 };
    if (note >= 41 && note <= 50) return { kind: 'tom', f: 170 - (note - 41) * 5, drop: 0.22, dur: 0.22, noise: 0.3 };
    if (note === 54) return { kind: 'tamb', dur: 0.09, noise: 0.6, hp: 8000 };
    if (note === 56) return { kind: 'cowbell', f: 520, dur: 0.14, noise: 0.1 };
    if (note >= 60 && note <= 66) return { kind: 'tom', f: 150 - (note - 60) * 6, drop: 0.22, dur: 0.2, noise: 0.25 };
    if (note >= 67 && note <= 81) return { kind: 'tom', f: 110 - (note - 67) * 2, drop: 0.22, dur: 0.22, noise: 0.25 };
    return { kind: 'tom', f: 100, drop: 0.2, dur: 0.22, noise: 0.25 };
  }

  function makeNoiseBuffer(ctx, seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------------
  // Engine
  // ------------------------------------------------------------------
  function createEngine(ctx) {
    var master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    var active = null;
    var endTimer = null;
    var scheduleTimer = null;
    var liveNodes = [];
    var mediaEnds = 0;

    // Nokia MobileBAE sample bank (optional; embedded by build_soundfont.py).
    // DR_SOUNDFONT_PREPARED carries PCM decoded off the first touch; attaching
    // it only creates AudioBuffers.
    var sfData = (typeof window !== 'undefined' && window.DR_SOUNDFONT) ||
                 (typeof DR_SOUNDFONT !== 'undefined' ? DR_SOUNDFONT : null);
    var prepared = (typeof window !== 'undefined' && window.DR_SOUNDFONT_PREPARED) ||
                   (typeof DR_SOUNDFONT_PREPARED !== 'undefined' ? DR_SOUNDFONT_PREPARED : null);
    var sf = null;
    if (sfData && typeof SoundFont !== 'undefined') {
      try {
        if (prepared) sf = SoundFont.attach(ctx, prepared);
        else sf = SoundFont.create(ctx, sfData);
      } catch (e) { sf = null; }
    }
    var toneEnabled = !!sf;
    var lastPlayer = null;
    var lastVolume = 100;
    var noiseBuf = null;
    function getNoiseBuffer() {
      if (!noiseBuf) noiseBuf = makeNoiseBuffer(ctx, 1.2);
      return noiseBuf;
    }

    function killNodes() {
      for (var i = 0; i < liveNodes.length; i++) {
        try { liveNodes[i].stop(0); } catch (e) { }
        try { liveNodes[i].disconnect(); } catch (e) { }
      }
      liveNodes = [];
    }

    function stopActive() {
      if (endTimer !== null) { clearTimeout(endTimer); endTimer = null; }
      if (scheduleTimer !== null) { clearTimeout(scheduleTimer); scheduleTimer = null; }
      killNodes();
      active = null;
    }

    function play(player, volume) {
      stopActive();
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) { } }
      lastPlayer = player;
      if (volume !== undefined) lastVolume = volume;
      var data = player.$data;
      if (!data || data.length < 14) return;
      var song;
      try { song = parse(data); } catch (e) { return; }
      var t0 = ctx.currentTime + 0.03;
      var nodes = [];
      function track() {
        for (var ti = 0; ti < arguments.length; ti++) {
          nodes.push(arguments[ti]);
          liveNodes.push(arguments[ti]);
        }
      }
      var volScale = Math.max(0, Math.min(1, (volume === undefined ? 100 : volume) / 100));

      var chanProg = new Array(16);
      var chanVol = new Array(16);
      var chanPan = new Array(16);
      var chanBend = new Array(16);
      for (var c = 0; c < 16; c++) { chanProg[c] = 0; chanVol[c] = 100; chanPan[c] = 64; chanBend[c] = 0; }
      var sounding = {};
      var bendRatio = new Array(16);
      for (c = 0; c < 16; c++) bendRatio[c] = 1;

      function ratioFor(value) {
        return Math.pow(2, (value / 8192) * 2 / 12);
      }

      function startVoice(ch, note, vel, at) {
        if (ch === 9) {
          if (sf && toneEnabled) {
            var dv = sf.startVoice(master, {
              isDrum: true, ch: ch, note: note, vel: vel, at: at,
              chanVol: Math.pow(chanVol[ch] / 127, 1.2),
              pan: (chanPan[ch] - 64) / 64, bend: bendRatio[ch], volScale: volScale
            });
            if (dv) {
              var dk = ch + ':' + note;
              if (sounding[dk]) releaseVoice(dk, at);
              sounding[dk] = dv;
              track(dv.src, dv.gain);
              return;
            }
          }
          startDrum(note, vel, at);
          return;
        }
        if (sf && toneEnabled) {
          var sv = sf.startVoice(master, {
            isDrum: false, ch: ch, note: note, vel: vel, at: at,
            prog: chanProg[ch], chanVol: Math.pow(chanVol[ch] / 127, 1.3),
            pan: (chanPan[ch] - 64) / 64, bend: bendRatio[ch], volScale: volScale
          });
          if (sv) {
            var sk = ch + ':' + note;
            if (sounding[sk]) releaseVoice(sk, at);
            sounding[sk] = sv;
            track(sv.src, sv.gain);
            return;
          }
        }
        var spec = voiceSpec(chanProg[ch]);
        var baseF = 440 * Math.pow(2, (note - 69) / 12);
        var ratio = bendRatio[ch];
        var amp = (vel / 127) * 0.22 * Math.pow(chanVol[ch] / 127, 1.3) * volScale;
        if (amp <= 0) return;
        var g = ctx.createGain();
        if (ctx.createStereoPanner) {
          var panner = ctx.createStereoPanner();
          panner.pan.value = (chanPan[ch] - 64) / 64;
          g.connect(panner);
          panner.connect(master);
        } else {
          g.connect(master);
        }
        var stopAt = at + spec.a + spec.d + 6;
        var oscs = [];
        for (var p = 0; p < spec.partials.length; p++) {
          var part = spec.partials[p];
          var osc = ctx.createOscillator();
          osc.type = part[0];
          var f = baseF * part[1] * ratio;
          if (spec.drop) {
            osc.frequency.setValueAtTime(f * (1 + spec.drop), at);
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, f), at + 0.07);
          } else {
            osc.frequency.setValueAtTime(f, at);
          }
          var pg = ctx.createGain();
          pg.gain.value = part[2];
          osc.connect(pg);
          pg.connect(g);
          osc.start(at);
          osc.stop(stopAt);
          track(osc);
          oscs.push({ osc: osc, mult: part[1], baseF: baseF });
        }
        if (spec.noise > 0) {
          var ns = ctx.createBufferSource();
          ns.buffer = getNoiseBuffer();
          var nf = ctx.createBiquadFilter();
          nf.type = 'lowpass';
          nf.frequency.value = spec.tf || 2500;
          var ng = ctx.createGain();
          if (spec.swell) {
            ng.gain.setValueAtTime(0.0005, at);
            ng.gain.exponentialRampToValueAtTime(Math.max(0.001, amp * 1.4), at + (spec.ndur || 0.1));
          } else {
            ng.gain.setValueAtTime(amp * spec.noise * 2.0, at);
            ng.gain.exponentialRampToValueAtTime(0.0005, at + (spec.ndur || 0.05));
          }
          ns.connect(nf); nf.connect(ng); ng.connect(master);
          ns.start(at);
          ns.stop(at + (spec.swell ? (spec.ndur || 0.1) + 0.05 : (spec.ndur || 0.05) + 0.02));
          track(ns);
        }
        var sus = Math.max(0.0001, amp * spec.s);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(amp, at + spec.a);
        g.gain.exponentialRampToValueAtTime(sus, at + spec.a + spec.d);
        var key = ch + ':' + note;
        if (sounding[key]) releaseVoice(key, at);
        sounding[key] = { gain: g, oscs: oscs, release: spec.r, sus: sus, ratio: ratio, ch: ch, baseF: baseF };
      }

      function releaseVoice(key, at) {
        var v = sounding[key];
        if (!v) return;
        delete sounding[key];
        if (v.kind === 'sf') { sf.release(v, at); return; }
        var end = at + v.release;
        try {
          v.gain.gain.cancelScheduledValues(at);
          v.gain.gain.setValueAtTime(v.sus, at);
          v.gain.gain.exponentialRampToValueAtTime(0.0001, end);
        } catch (e) { }
        for (var i = 0; i < v.oscs.length; i++) {
          try { v.oscs[i].osc.stop(end + 0.02); } catch (e) { }
        }
      }

      function updateBend(ch, value, at) {
        var nr = ratioFor(value);
        if (nr === bendRatio[ch]) return;
        for (var key in sounding) {
          var v = sounding[key];
          if (v.ch !== ch) continue;
          if (v.kind === 'sf') { sf.bend(v, nr, at); continue; }
          for (var i = 0; i < v.oscs.length; i++) {
            var o = v.oscs[i];
            var cur = o.baseF * o.mult * v.ratio;
            var next = o.baseF * o.mult * nr;
            try {
              o.osc.frequency.cancelScheduledValues(at);
              o.osc.frequency.setValueAtTime(cur, at);
              o.osc.frequency.linearRampToValueAtTime(next, at + 0.03);
            } catch (e) { }
          }
          v.ratio = nr;
        }
        bendRatio[ch] = nr;
      }

      function startDrum(note, vel, at) {
        var d = drumSpec(note);
        var amp = (vel / 127) * 0.5 * volScale;
        if (amp <= 0) return;
        if (d.kind === 'kick' || d.kind === 'tom') {
          var osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(d.f * (1 + d.drop), at);
          osc.frequency.exponentialRampToValueAtTime(Math.max(25, d.f), at + d.dur * 0.7);
          var g = ctx.createGain();
          g.gain.setValueAtTime(amp, at);
          g.gain.exponentialRampToValueAtTime(0.0001, at + d.dur);
          osc.connect(g); g.connect(master);
          osc.start(at); osc.stop(at + d.dur + 0.02);
          track(osc);
        }
        if (d.noise) {
          var ns = ctx.createBufferSource();
          ns.buffer = getNoiseBuffer();
          var f = ctx.createBiquadFilter();
          if (d.hp) { f.type = 'highpass'; f.frequency.value = d.hp; }
          else if (d.kind === 'snare' || d.kind === 'clap') { f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.7; }
          else { f.type = 'lowpass'; f.frequency.value = 1100; }
          var ng = ctx.createGain();
          ng.gain.setValueAtTime(amp * d.noise, at);
          ng.gain.exponentialRampToValueAtTime(0.0001, at + d.dur);
          ns.connect(f); f.connect(ng); ng.connect(master);
          ns.start(at);
          ns.stop(at + d.dur + 0.02);
          track(ns);
        }
        if (d.kind === 'cowbell') {
          var cb = ctx.createOscillator();
          cb.type = 'square';
          cb.frequency.value = d.f;
          var cg = ctx.createGain();
          cg.gain.setValueAtTime(amp * 0.4, at);
          cg.gain.exponentialRampToValueAtTime(0.0001, at + d.dur);
          cb.connect(cg); cg.connect(master);
          cb.start(at); cb.stop(at + d.dur + 0.02);
          track(cb);
        }
      }

      var eventIdx = 0;
      var scheduleAhead = 1.2;
      var events = song.events;

      function scheduleChunk() {
        scheduleTimer = null;
        if (!active || active.nodes !== nodes) return;
        var horizon = (ctx.currentTime + scheduleAhead) - t0;
        while (eventIdx < events.length && events[eventIdx].time <= horizon) {
          var e = events[eventIdx++];
          var at = t0 + e.time;
          if (e.type === 'on') startVoice(e.ch, e.note, e.vel, at);
          else if (e.type === 'off') releaseVoice(e.ch + ':' + e.note, at);
          else if (e.type === 'prog') chanProg[e.ch] = e.value;
          else if (e.type === 'vol') chanVol[e.ch] = e.value;
          else if (e.type === 'pan') chanPan[e.ch] = e.value;
          else if (e.type === 'bend') updateBend(e.ch, e.value, at);
        }
        if (eventIdx < events.length) {
          scheduleTimer = setTimeout(scheduleChunk, 200);
        }
      }

      active = { nodes: nodes, player: player };
      scheduleChunk();
      var endMs = (song.duration + 0.4) * 1000;
      endTimer = setTimeout(function () {
        endTimer = null;
        if (active && active.nodes === nodes) {
          killNodes();
          active = null;
          mediaEnds++;
          if (typeof VM !== 'undefined' && VM.queueMediaEnd) VM.queueMediaEnd(player);
        }
      }, endMs);
    }

    function stop(player) {
      if (active && active.player === player) stopActive();
    }

    function setVolume(player, level) {
      master.gain.value = Math.max(0, Math.min(1, level / 100)) * 0.6;
    }

    // A/B switch between the embedded Nokia sample bank and the built-in synth.
    function setTone(enabled) {
      toneEnabled = !!sf && !!enabled;
      if (lastPlayer && lastPlayer.$state === 400) play(lastPlayer, lastVolume);
      return toneEnabled;
    }

    function stats() {
      return {
        tone: toneEnabled, hasTone: !!sf, active: !!active,
        live: liveNodes.length, ends: mediaEnds, state: ctx.state || '?'
      };
    }

    return {
      play: play, stop: stop, setVolume: setVolume, context: ctx,
      setTone: setTone, hasTone: !!sf, stats: stats
    };
  }

  function unlockAudio() {
    if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return null;
    var AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    var ctx = new AC();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { } }
    return createEngine(ctx);
  }

  return { parse: parse, createEngine: createEngine, unlockAudio: unlockAudio };
})();
