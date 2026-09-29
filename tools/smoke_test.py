#!/usr/bin/env python3
"""Build a jsc smoke-test bundle from index.html with DOM stubs."""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.environ.get('DR_HTML', os.path.join(ROOT, '钻石狂潮.html'))
OUT = '/tmp/dr_browser_test.js'

STUBS = r'''
function makeEl(id) {
  var el = {
    id: id,
    style: {},
    hidden: false,
    _classes: {},
    classList: {
      toggle: function(c, on){ if (on === undefined) on = !this._cls(c); if (on) this._add(c); else this._del(c); },
      add: function(c){ this._add(c); },
      remove: function(c){ this._del(c); },
      contains: function(c){ return !!el._classes[c]; },
      _add: function(c){ el._classes[c] = true; },
      _del: function(c){ delete el._classes[c]; }
    },
    innerHTML: '', textContent: '',
    width: 0, height: 0,
    getAttribute: function(){ return '0'; },
    setAttribute: function(){},
    addEventListener: function(){},
    removeEventListener: function(){},
    appendChild: function(){},
    getContext: function(){
      var noop = function(){};
      return {
        canvas: el,
        fillStyle: '#000',
        imageSmoothingEnabled: false,
        fillRect: noop, drawImage: noop, putImageData: noop, setTransform: noop, clearRect: noop, fillText: noop, measureText: function(t){ return { width: t.length * 12 }; },
        createImageData: function(w,h){ return { data: new Uint8ClampedArray(w*h*4), width: w, height: h }; },
        getImageData: function(x,y,w,h){ return { data: new Uint8ClampedArray(w*h*4), width: w, height: h }; }
      };
    },
    getBoundingClientRect: function(){ return { width: 400, height: 600, left: 0, top: 0 }; },
    focus: function(){},
    click: function(){},
    requestFullscreen: function(){}
  };
  return el;
}
var __els = {};
var document = {
  readyState: 'complete',
  fullscreenElement: null,
  documentElement: makeEl('html'),
  body: makeEl('body'),
  getElementById: function(id){ if (!__els[id]) __els[id] = makeEl(id); return __els[id]; },
  createElement: function(tag){ return makeEl(tag); },
  querySelectorAll: function(sel){ return []; },
  addEventListener: function(){},
  removeEventListener: function(){},
  exitFullscreen: function(){},
  webkitExitFullscreen: function(){}
};
var __TOUCH = (typeof $ENV_TOUCH !== 'undefined') ? $ENV_TOUCH : false;
var window = {
  ontouchstart: __TOUCH ? null : undefined,
  matchMedia: function (q) { return { matches: __TOUCH && q.indexOf('coarse') >= 0 }; },
  innerWidth: 400, innerHeight: 800,
  addEventListener: function(){},
  removeEventListener: function(){},
  localStorage: { getItem: function(k){ return (k === 'dr_orient' && typeof $ENV_ORIENT !== 'undefined' && $ENV_ORIENT) ? $ENV_ORIENT : null; }, setItem: function(){} },
  navigator: { maxTouchPoints: 0, userAgent: 'jsc-test' },
  requestAnimationFrame: function(fn){ return setTimeout(fn, 16); },
  cancelAnimationFrame: function(id){ clearTimeout(id); }
};
if (!__TOUCH) { delete window.ontouchstart; }
if (typeof $ENV_ORIENT !== 'undefined' && $ENV_ORIENT === 'l') { window.innerWidth = 900; window.innerHeight = 500; }
var navigator = window.navigator;
var localStorage = window.localStorage;
var requestAnimationFrame = function(fn){ return setTimeout(fn, 16); };
var cancelAnimationFrame = function(id){ clearTimeout(id); };
var AudioContext = undefined;
var webkitAudioContext = undefined;
var console = { log: function(){}, error: function(){ print('[console.error] ' + Array.prototype.join.call(arguments, ' ')); } };

var __now = 0;
var __timers = [];
var __tid = 1;
var RealDate = Date;
Date = function(){ return new RealDate(__now); };
Date.now = function(){ return __now; };
Date.UTC = RealDate.UTC;
Date.parse = RealDate.parse;
setTimeout = function(fn, ms){ __timers.push({ at: __now + (ms||0), fn: fn }); return __tid++; };
clearTimeout = function(id){ for (var i = 0; i < __timers.length; i++) if (__timers[i].id === id) { __timers.splice(i, 1); return; } };
setInterval = function(fn, ms){ var id = __tid++; (function rep(){ __timers.push({ id: id, at: __now + (ms||0), fn: function(){ fn(); rep(); } }); })(); return id; };
clearInterval = clearTimeout;
function __pump(ms) {
  var target = __now + ms, guard = 0;
  for (;;) {
    var best = -1, at = Infinity;
    for (var i = 0; i < __timers.length; i++) if (__timers[i].at < at) { at = __timers[i].at; best = i; }
    if (best < 0 || at > target) break;
    if (++guard > 1000000) { print('[smoke] guard'); break; }
    var t = __timers.splice(best,1)[0];
    __now = t.at;
    try { t.fn(); } catch(e) { print('[timer err] ' + e + ' :: ' + (e && e.stack)); }
  }
  __now = target;
}
'''

TAIL = r'''
;(function(){
  if (typeof VM === 'undefined') { print('[smoke] VM missing'); return; }
  print('[smoke] VM loaded');
  __pump(8000);
  var st = VM.getClass('i') ? VM.getClass('i').staticFields['b:B'] : -1;
  print('[smoke] state b=' + st + ' halt=' + VM.instances.halt);
  print('[smoke] body classes=' + Object.keys(document.body._classes).join(','));
  var controls = document.getElementById('controls');
  print('[smoke] controls classAttr=' + (controls.className || ''));
  var px = VM.instances.screen.$pixels;
  var nonzero = 0;
  for (var i = 0; i < px.length; i += 97) if (px[i] !== 0 && px[i] !== -16777216) nonzero++;
  print('[smoke] screen non-black samples=' + nonzero);
})();
'''

def main():
    html = open(HTML, encoding='utf-8').read()
    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    print('found', len(scripts), 'inline scripts')
    touch = os.environ.get('SMOKE_TOUCH', '0') == '1'
    orient = os.environ.get('SMOKE_ORIENT', '')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('var $ENV_TOUCH = %s;\n' % ('true' if touch else 'false'))
        f.write('var $ENV_ORIENT = %s;\n' % (repr(orient) if orient else 'null'))
        f.write(STUBS)
        for s in scripts:
            f.write('\n;\n')
            f.write(s.replace('<\\/script>', '</script>'))
        f.write(TAIL)
    print('wrote', OUT)

if __name__ == '__main__':
    main()
