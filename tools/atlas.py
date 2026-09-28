#!/usr/bin/env python3
"""Parse Diamond Rush .f/.bin resources: container + sprite atlas (class f)."""
import struct, sys, os, zlib

BASE = os.path.join(os.path.dirname(__file__), '..', 'reversed', 'resources')

def container(name):
    """Returns list of (offset, size, data) blocks for a .f style container."""
    d = open(os.path.join(BASE, name), 'rb').read()
    cnt = d[0]
    hdr = d[1:1 + cnt * 8]
    data = d[1 + cnt * 8:]
    out = []
    for i in range(cnt):
        off = struct.unpack('<I', hdr[i*8:i*8+4])[0]
        size = struct.unpack('<I', hdr[i*8+4:i*8+8])[0]
        out.append((off, size, data[off:off+size]))
    return out

class Atlas:
    def __init__(self, b):
        self.b = b
        self.frames = []
        self.animations = []
        self.parse()

    def u8(self, p): return self.b[p]
    def u16(self, p): return self.b[p] | (self.b[p+1] << 8)

    def parse(self):
        b = self.b
        n = 8
        s = self.u16(6)
        if s > 0:
            self.frames = [(b[8+i*2], b[8+i*2+1]) for i in range(s)]
            n = 8 + s * 2
        cnt1 = self.u16(n); n += 2
        self.hotspots = []
        if cnt1 > 0:
            self.hotspots = [tuple(b[n+i*4:n+i*4+4]) for i in range(cnt1)]
            n += cnt1 * 4
        cnt2 = self.u16(n); n += 2
        self.composite = []   # (subcount, base)
        self.extra = b''
        if cnt2 > 0:
            for i in range(cnt2):
                g = b[n]; base = self.u16(n+1)
                self.composite.append((g, base))
                n += 4
            self.extra = b[n:n+cnt2*4]
            n += cnt2 * 4
        cnt3 = self.u16(n); n += 2
        self.anim_records = []
        if cnt3 > 0:
            self.anim_records = [tuple(b[n+i*5:n+i*5+5]) for i in range(cnt3)]
            n += cnt3 * 5
        cnt4 = self.u16(n); n += 2
        self.anim_index = []
        if cnt4 > 0:
            for i in range(cnt4):
                self.anim_index.append((b[n], self.u16(n+1)))
                n += 4
        if s <= 0:
            self.palettes = []
            self.pfmt = 0
            self.pixfmt = 0
            self.pixels = b''
            return
        pf = self.u16(n); n += 2
        pal_count = b[n]; n += 1
        col_count = b[n]; n += 1
        self.palettes = []
        for i in range(pal_count):
            pal = []
            for j in range(col_count):
                if pf == 0x8888:
                    v = struct.unpack('<I', b[n:n+4])[0]; n += 4
                elif pf == 0x4444:
                    v = self.u16(n); n += 2
                elif pf == 0x5515:
                    v = self.u16(n); n += 2
                elif pf == 0x6505:
                    v = self.u16(n); n += 2
                else:
                    raise Exception('unknown palette format %04x' % pf)
                pal.append(v)
            self.palettes.append(pal)
        self.pfmt = pf
        self.pixfmt = self.u16(n); n += 2
        self.frame_offsets = []
        self.pixels = b''
        if s > 0:
            n4 = n
            total = 0
            for i in range(s):
                ln = self.u16(n4); n4 += 2
                self.frame_offsets.append(total)
                n4 += ln
                total += ln
            self.pixels = bytearray(total)
            for i in range(s):
                ln = self.u16(n); n += 2
                self.pixels[self.frame_offsets[i]:self.frame_offsets[i]+ln] = b[n:n+ln]
                n += ln
            self.pixels = bytes(self.pixels)

    def palette_color(self, pi, pal=None):
        pal = self.palettes[0] if pal is None else pal
        v = pal[pi]
        pf = self.pfmt
        if pf == 0x8888:
            return v
        if pf == 0x4444:
            return 0xFF000000 | ((v & 0xF000) << 16) | ((v & 0xF000) << 12) | ((v & 0xF00) << 12) | ((v & 0xF00) << 8) | ((v & 0xF0) << 8) | ((v & 0xF0) << 4) | ((v & 0xF) << 4) | (v & 0xF)
        if pf == 0x5515:
            a = 0xFF000000 if (v & 0x8000) else 0
            return a | ((v & 0x7C00) << 9) | ((v & 0x3E0) << 6) | ((v & 0x1F) << 3)
        if pf == 0x6505:
            a = 0 if v == 63519 else 0xFF000000
            return a | ((v & 0xF800) << 8) | ((v & 0x7E0) << 5) | ((v & 0x1F) << 3)
        return 0

    def decode_frame(self, frame, pal=None):
        w, h = self.frames[frame]
        n = self.frame_offsets[frame]
        d = self.pixels
        cnt = w * h
        out = [0] * cnt
        p = 0
        fmt = self.pixfmt
        if fmt == 10225:
            while p < cnt:
                v = d[n]; n += 1
                if v > 127:
                    v -= 128
                    idx = d[n]; n += 1
                    c = self.palette_color(idx, pal)
                    for _ in range(v):
                        out[p] = c; p += 1
                else:
                    out[p] = self.palette_color(v, pal); p += 1
        elif fmt == 5632:
            while p < cnt:
                v = d[n]; n += 1
                out[p] = self.palette_color(v >> 4 & 0xF, pal); p += 1
                out[p] = self.palette_color(v & 0xF, pal); p += 1
        elif fmt == 1024:
            while p < cnt:
                v = d[n]; n += 1
                out[p] = self.palette_color(v >> 6 & 3, pal); p += 1
                out[p] = self.palette_color(v >> 4 & 3, pal); p += 1
                out[p] = self.palette_color(v >> 2 & 3, pal); p += 1
                out[p] = self.palette_color(v & 3, pal); p += 1
        elif fmt == 512:
            while p < cnt:
                v = d[n]; n += 1
                for sh in range(7, -1, -1):
                    out[p] = self.palette_color(v >> sh & 1, pal); p += 1
        elif fmt == 22018:
            for i in range(cnt):
                out[i] = self.palette_color(d[n + i], pal); p += 1
        elif fmt == 22258:
            while p < cnt:
                v = d[n]; n += 1
                if v > 127:
                    v -= 128
                    for _ in range(v):
                        out[p] = self.palette_color(d[n], pal); n += 1; p += 1
                else:
                    c = self.palette_color(d[n], pal); n += 1
                    for _ in range(v):
                        out[p] = c; p += 1
        else:
            raise Exception('unknown pixel format %d' % fmt)
        return w, h, out

    def draw_frame(self, dst, dw, frame, x, y, flags, pal=None):
        """Composite draw (5-arg f.a). dst: list of ARGB, dw: width."""
        cnt = self.composite[frame][0]
        base = self.composite[frame][1]
        for i in range(cnt):
            hp = (base + i) * 4
            sub = self.hotspots[hp][0]
            ox = self.hotspots[hp][1]
            oy = self.hotspots[hp][2]
            f = self.hotspots[hp][3] & 0xF
            sx = x - ox if (flags & 1) else x + ox
            sy = y - oy if (flags & 2) else y + oy
            if flags & 1:
                sx -= self.frames[sub][0]
            if flags & 2:
                sy -= self.frames[sub][1]
            self.blit_frame(dst, dw, sub, sx, sy, flags ^ f, pal)

    def blit_frame(self, dst, dw, frame, x, y, flags, pal=None):
        w, h, px = self.decode_frame(frame, pal)
        for yy in range(h):
            for xx in range(w):
                sx = w - 1 - xx if (flags & 1) else xx
                sy = h - 1 - yy if (flags & 2) else yy
                c = px[yy * w + xx]
                if (c >> 24) == 0:
                    continue
                dx = x + sx
                dy = y + sy
                if 0 <= dx < dw and 0 <= dy:
                    i = dy * dw + dx
                    if i < len(dst):
                        dst[i] = c

if __name__ == '__main__':
    files = sys.argv[1:] or ['0.f', '1.f', '2.f', 'b0.f', 'b1.f', 'ui.f', 'o.f', 'cm.f', 'gen0.f', 'gen1.f', 'gen2.f', 'gen3.f', 'gen4.f', 'tips.f', 'mmv.f', 'ms.f', 'spl.f', 'demoui.f', 'tipst.f']
    for fn in files:
        try:
            blocks = container(fn)
        except Exception as e:
            print('%-12s container error: %s' % (fn, e))
            continue
        for bi, (off, size, b) in enumerate(blocks):
            try:
                a = Atlas(b)
                fcnt = len(a.frames)
                if fcnt > 0:
                    w0, h0, _ = a.decode_frame(0, a.palettes[0] if a.palettes else None)
                    print('%-12s block%d size=%5d frames=%4d anims=%3d palettes=%d pixfmt=%5d first=%dx%d' % (fn, bi, size, fcnt, len(a.anim_index), len(a.palettes), a.pixfmt, w0, h0))
                else:
                    print('%-12s block%d size=%5d (no frames)' % (fn, bi, size))
            except Exception as e:
                print('%-12s block%d size=%5d PARSE ERROR: %s' % (fn, bi, size, e))
