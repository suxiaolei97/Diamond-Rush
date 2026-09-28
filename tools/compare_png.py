#!/usr/bin/env python3
"""Compare two PNG files (RGB/RGBA, non-interlaced) pixel by pixel."""
import struct, sys, zlib


def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    p = 8
    w = h = ct = bd = None
    idat = b''
    while p + 8 <= len(d):
        ln = struct.unpack('>I', d[p:p+4])[0]
        typ = d[p+4:p+8]
        data = d[p+8:p+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
        p += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 4: 2, 6: 4, 3: 1}[ct]
    bpp = ch * bd // 8
    stride = w * ch * bd // 8
    out = bytearray(h * stride)
    pos = 0
    for y in range(h):
        ft = raw[pos]; pos += 1
        row = bytearray(raw[pos:pos+stride]); pos += stride
        prev = out[(y-1)*stride:y*stride] if y else bytearray(stride)
        for x in range(stride):
            a = row[x-bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x-bpp] if x >= bpp else 0
            if ft == 1: row[x] = (row[x] + a) & 0xFF
            elif ft == 2: row[x] = (row[x] + b) & 0xFF
            elif ft == 3: row[x] = (row[x] + ((a+b) >> 1)) & 0xFF
            elif ft == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 0xFF
        out[y*stride:(y+1)*stride] = row
    # convert to RGB list
    px = []
    if ct in (2, 6):
        for y in range(h):
            for x in range(w):
                o = y*stride + x*ch
                px.append((out[o], out[o+1], out[o+2]))
    elif ct in (0, 4):
        for y in range(h):
            for x in range(w):
                o = y*stride + x*ch
                g = out[o]
                px.append((g, g, g))
    else:
        raise Exception('palette png unsupported')
    return w, h, px


def main():
    a = read_png(sys.argv[1])
    b = read_png(sys.argv[2])
    if a[0] != b[0] or a[1] != b[1]:
        print('size mismatch', a[:2], b[:2])
        return
    w, h = a[0], a[1]
    diff = 0
    big = 0
    minx, miny, maxx, maxy = w, h, -1, -1
    for i in range(w*h):
        pa, pb = a[2][i], b[2][i]
        if pa != pb:
            diff += 1
            if abs(pa[0]-pb[0]) + abs(pa[1]-pb[1]) + abs(pa[2]-pb[2]) > 90:
                big += 1
                x, y = i % w, i // w
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
    print('pixels=%d differing=%d (%.2f%%) big-diff=%d (%.2f%%)' % (
        w*h, diff, 100.0*diff/(w*h), big, 100.0*big/(w*h)))
    if big:
        print('big-diff bbox: x %d..%d, y %d..%d' % (minx, maxx, miny, maxy))
    # dump a difference image for big diffs
    if len(sys.argv) > 3 and big:
        out = bytearray()
        for y in range(h):
            out.append(0)
            for x in range(w):
                i = y*w + x
                pa, pb = a[2][i], b[2][i]
                d = abs(pa[0]-pb[0]) + abs(pa[1]-pb[1]) + abs(pa[2]-pb[2])
                if d > 90:
                    out += bytes((255, 0, 0))
                else:
                    out += bytes((pa[0]//3, pa[1]//3, pa[2]//3))
        def chunk(tag, data):
            return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data) & 0xFFFFFFFF)
        png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(out))) + chunk(b'IEND', b'')
        open(sys.argv[3], 'wb').write(png)
        print('diff image ->', sys.argv[3])


if __name__ == '__main__':
    main()
