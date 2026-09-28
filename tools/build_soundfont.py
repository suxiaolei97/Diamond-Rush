#!/usr/bin/env python3
"""Convert a Nokia MobileBAE DLS sound bank into src/assets/soundfont.js.

The DLS dialect used by Nokia's MobileBAE banks differs slightly from the
official spec:
  - region `wsmp` payload: cbSize(u32), unity(u16), fine(i16),
    gain(16.16 fixed, 0.1 dB, negative = quieter), options(u32),
    loopCount(u32), loops[]
  - region `wlnk` payload: phaseGroup(u16), channel(u16), tableIndex(u32=1),
    waveIndex(u32)  -> index into the wvpl wave list
  - `insh`: cRegions, bank (0x80000000 = drum kit), program

Usage:
    python3 tools/build_soundfont.py [--bank "Nokia Sound Font/Charlie Bank.dls"]
                                     [--out src/assets/soundfont.js]
"""
import argparse
import base64
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_BANK = os.path.join(ROOT, 'Nokia Sound Font', 'Charlie Bank.dls')


def chunks(d, off, end):
    p = off
    while p + 8 <= end:
        cid = d[p:p + 4]
        ln = struct.unpack('<I', d[p + 4:p + 8])[0]
        yield p, cid, ln, p + 8, p + 8 + ln
        p += 8 + ln + (ln & 1)


def info_strings(d, off, end):
    out = {}
    for p, cid, ln, b, e in chunks(d, off, end):
        if ln < 300:
            out[cid.decode('latin1')] = d[b:b + ln].rstrip(b'\x00').decode('latin1', 'replace')
    return out


def parse_wsmp(body):
    """Nokia MobileBAE variant of the DLS wsmp chunk."""
    cb = struct.unpack('<I', body[0:4])[0]
    unity = struct.unpack('<H', body[4:6])[0]
    fine = struct.unpack('<h', body[6:8])[0]
    gain_x16 = struct.unpack('<i', body[8:12])[0]   # 16.16 fixed point, 0.1 dB; negative = quieter
    loop_count = struct.unpack('<I', body[16:20])[0]
    loops = []
    o = 20
    while len(loops) < loop_count and o + 16 <= len(body):
        _cbsize, _type, start, length = struct.unpack('<IIII', body[o:o + 16])
        if length > 0:
            loops.append((start, start + length))
        o += 16
    return {'unity': unity, 'fine': fine, 'gain_dBx10': gain_x16 / 65536.0,
            'loops': loops}


class Bank:
    def __init__(self, path):
        self.d = open(path, 'rb').read()
        d = self.d
        self.top = {}
        for p, cid, ln, b, e in chunks(d, 12, len(d)):
            self.top.setdefault(cid, []).append((p, ln, b, e))
        self.info = {}
        self.waves = []
        self.instruments = []
        self.cues = []
        self._parse_info()
        self._parse_waves()
        self._parse_instruments()

    def _parse_info(self):
        d = self.d
        for p, ln, b, e in self.top.get(b'LIST', []):
            if d[b:b + 4] == b'INFO':
                self.info = info_strings(d, b + 4, e)

    def _parse_ptbl(self):
        d = self.d
        if b'ptbl' not in self.top:
            return
        p, ln, b, e = self.top[b'ptbl'][0]
        count = struct.unpack('<I', d[b + 4:b + 8])[0]
        self.cues = list(struct.unpack('<%dI' % count, d[b + 8:b + 8 + 4 * count]))

    def _parse_waves(self):
        d = self.d
        wvpl = None
        for p, ln, b, e in self.top.get(b'LIST', []):
            if d[b:b + 4] == b'wvpl':
                wvpl = (b + 4, e)
        if wvpl is None:
            raise SystemExit('no wvpl chunk')
        for p, cid, ln, b, e in chunks(d, wvpl[0], wvpl[1]):
            if cid != b'LIST' or d[b:b + 4] != b'wave':
                continue
            w = {'name': '', 'fmt': None, 'data': None, 'wsmp': None}
            for q, c2, l2, qb, qe in chunks(d, b + 4, e):
                if c2 == b'fmt ':
                    tag, ch, sr, avg, align, bits = struct.unpack('<HHIIHH', d[qb:qb + 16])
                    w['fmt'] = {'tag': tag, 'ch': ch, 'rate': sr, 'bits': bits}
                elif c2 == b'data':
                    w['data'] = (qb, l2)
                elif c2 == b'wsmp':
                    w['wsmp'] = parse_wsmp(d[qb:qb + l2])
                elif c2 == b'LIST' and d[qb:qb + 4] == b'INFO':
                    inf = info_strings(d, qb + 4, qe)
                    w['name'] = inf.get('INAM', '')
            if w['fmt'] and w['data']:
                self.waves.append(w)
        self._parse_ptbl()

    def _parse_instruments(self):
        d = self.d
        lins = None
        for p, ln, b, e in self.top.get(b'LIST', []):
            if d[b:b + 4] == b'lins':
                lins = (b + 4, e)
        if lins is None:
            raise SystemExit('no lins chunk')
        for p, cid, ln, b, e in chunks(d, lins[0], lins[1]):
            if cid != b'LIST' or d[b:b + 4] != b'ins ':
                continue
            ins = {'insh': None, 'name': '', 'regions': []}
            for q, c2, l2, qb, qe in chunks(d, b + 4, e):
                if c2 == b'insh':
                    ins['insh'] = struct.unpack('<III', d[qb:qb + 12])
                elif c2 == b'LIST' and d[qb:qb + 4] == b'INFO':
                    inf = info_strings(d, qb + 4, qe)
                    ins['name'] = inf.get('INAM', '')
                elif c2 == b'LIST' and d[qb:qb + 4] == b'lrgn':
                    for s, c3, l3, sb, se in chunks(d, qb + 4, qe):
                        if c3 != b'LIST' or d[sb:sb + 4] not in (b'rgn ', b'rgn2'):
                            continue
                        reg = {}
                        for t, c4, l4, tb, te in chunks(d, sb + 4, se):
                            if c4 == b'rgnh':
                                reg['rgnh'] = struct.unpack('<HHHHHHH', d[tb:tb + 14])
                            elif c4 == b'wsmp':
                                reg['wsmp'] = parse_wsmp(d[tb:tb + l4])
                            elif c4 == b'wlnk':
                                body = d[tb:tb + l4]
                                if len(body) >= 12:
                                    reg['waveIndex'] = struct.unpack('<I', body[8:12])[0]
                                elif len(body) >= 8:
                                    reg['waveIndex'] = struct.unpack('<I', body[4:8])[0]
                            elif c4 == b'LIST' and d[tb:tb + 4] == b'INFO':
                                inf = info_strings(d, tb + 4, te)
                                if inf.get('INAM'):
                                    reg['name'] = inf['INAM']
                        ins['regions'].append(reg)
            self.instruments.append(ins)

    def programs(self):
        """Return ({program: instrument index}, drum instrument index)."""
        melodic, drum = {}, None
        for i, ins in enumerate(self.instruments):
            vals = ins['insh']
            if vals is None:
                continue
            bank = vals[1]
            if bank & 0x80000000:
                drum = i
            else:
                melodic[vals[2]] = i
        return melodic, drum

    def wave_pcm(self, index):
        w = self.waves[index]
        if w['fmt']['tag'] != 1:
            raise SystemExit('wave %d: unsupported format tag %d' % (index, w['fmt']['tag']))
        off, length = w['data']
        return self.d[off:off + length]


def build(bank_path, out_path):
    bank = Bank(bank_path)
    fmt_count = {}
    for w in bank.waves:
        key = (w['fmt']['tag'], w['fmt']['ch'], w['fmt']['bits'])
        fmt_count[key] = fmt_count.get(key, 0) + 1
    print('bank: %s' % bank.info.get('INAM', os.path.basename(bank_path)))
    print('waves: %d  formats(tag,ch,bits): %s' % (len(bank.waves), fmt_count))

    melodic, drum = bank.programs()
    print('melodic programs: %d  drum kit: %s' % (len(melodic), drum))

    wave_meta = {'rate': [], 'root': [], 'loop': [], 'data': []}
    for i, w in enumerate(bank.waves):
        ws = w['wsmp'] or {}
        loop = ws.get('loops', [])
        wave_meta['rate'].append(w['fmt']['rate'])
        wave_meta['root'].append(ws.get('unity', 60))
        wave_meta['loop'].append(list(loop[0]) if loop else [0, 0])
        wave_meta['data'].append(base64.b64encode(bank.wave_pcm(i)).decode('ascii'))

    def region_js(reg):
        ws = reg.get('wsmp', {})
        rgnh = reg.get('rgnh', (0, 127, 0, 127, 0, 0, 0))
        wave = reg.get('waveIndex', 0)
        loop = ws.get('loops', [])
        if not loop:
            loop = [wave_meta['loop'][wave]]
        start, end = loop[0]
        gain = 10.0 ** (ws.get('gain_dBx10', 0) / 200.0)   # negative = quieter
        return {
            'k': [rgnh[0], rgnh[1]],
            'v': [rgnh[2], rgnh[3]],
            'root': ws.get('unity', wave_meta['root'][wave]),
            'fine': ws.get('fine', 0),
            'gain': round(gain, 4),
            'wave': wave,
            'loop': [start, max(0, end - start)],
        }

    progs = []
    for p in range(128):
        if p in melodic:
            regs = [region_js(r) for r in bank.instruments[melodic[p]]['regions']]
        else:
            regs = []
        progs.append(regs)
    drum_regs = [region_js(r) for r in bank.instruments[drum]['regions']] if drum is not None else []
    print('regions: melodic %d  drum %d' % (sum(len(r) for r in progs), len(drum_regs)))

    payload = {
        'name': bank.info.get('INAM', ''),
        'credit': bank.info.get('ICOP', ''),
        'waves': wave_meta,
        'progs': progs,
        'drum': drum_regs,
    }
    js = ('var DR_SOUNDFONT=' +
          json.dumps(payload, separators=(',', ':'), ensure_ascii=False) + ';\n' +
          "if(typeof window!=='undefined')window.DR_SOUNDFONT=DR_SOUNDFONT;\n")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print('wrote %s (%d bytes)' % (out_path, len(js)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', default=DEFAULT_BANK)
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'assets', 'soundfont.js'))
    args = ap.parse_args()
    if not os.path.isfile(args.bank):
        raise SystemExit('bank not found: %s' % args.bank)
    build(args.bank, args.out)


if __name__ == '__main__':
    main()
