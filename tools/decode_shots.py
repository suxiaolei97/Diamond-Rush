#!/usr/bin/env python3
"""Decode 'SHOT name base64' lines from jsc output into PNG files."""
import base64, os, struct, sys, zlib

def write_png(path, w, h, rgb):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 6))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

def main():
    src = sys.argv[1]
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for line in open(src, errors='replace'):
        if not line.startswith('SHOT '):
            continue
        parts = line.split()
        name = parts[1]
        data = base64.b64decode(parts[2])
        write_png(os.path.join(outdir, name + '.png'), 240, 320, data)
        n += 1
    print('decoded', n, 'shots ->', outdir)

if __name__ == '__main__':
    main()
