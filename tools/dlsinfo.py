#!/usr/bin/env python3
"""Inspect a DLS (Downloadable Sounds) bank: instruments, programs, regions, waves."""
import struct, sys, os
from collections import Counter

def children(d, off, end):
    p = off
    while p + 8 <= end:
        cid = d[p:p+4]
        ln = struct.unpack('<I', d[p+4:p+8])[0]
        yield p, cid, ln
        p += 8 + ln + (ln & 1)

def parse_info(d, off, end):
    out = {}
    for p, cid, ln in children(d, off, end):
        if ln < 300:
            out[cid.decode('latin1')] = d[p+8:p+8+ln].rstrip(b'\x00').decode('latin1', 'replace')
    return out

def main():
    path = sys.argv[1]
    d = open(path, 'rb').read()
    top = {}
    for p, cid, ln in children(d, 12, len(d)):
        top.setdefault(cid, []).append((p, ln))
    print('====', os.path.basename(path), len(d), 'bytes')
    if b'LIST' in top:
        for p, ln in top[b'LIST']:
            if d[p+8:p+12] == b'INFO':
                print(' INFO:', parse_info(d, p+12, p+8+ln))
    count = struct.unpack('<I', d[top[b'colh'][0][0]+8:top[b'colh'][0][0]+12])[0]
    print(' instruments:', count)
    # pgal: bank, program -> instrument index
    pgal = []
    if b'pgal' in top:
        p, ln = top[b'pgal'][0]
        n = struct.unpack('<I', d[p+8:p+12])[0]
        for i in range(n):
            prog, bank, idx = struct.unpack('<III', d[p+12+i*12:p+24+i*12])
            pgal.append((bank, prog, idx))
        print(' pgal count:', n)
    # lins
    lins = None
    for p, ln in top.get(b'LIST', []):
        if d[p+8:p+12] == b'lins':
            lins = (p, ln)
    instruments = []
    if lins:
        for p, cid, ln in children(d, lins[0]+12, lins[0]+8+lins[1]):
            if cid != b'LIST' or d[p+8:p+12] != b'ins ':
                continue
            ins_off, ins_end = p+12, p+8+ln
            vals = None
            regions = []
            names = []
            for q, c2, l2 in children(d, ins_off, ins_end):
                if c2 == b'insh':
                    vals = struct.unpack('<III', d[q+8:q+8+12])
                elif c2 == b'LIST' and d[q+8:q+12] == b'INFO':
                    info = parse_info(d, q+12, q+8+l2)
                    if info.get('INAM'): names.append(info['INAM'])
                elif c2 == b'LIST' and d[q+8:q+12] == b'lrgn':
                    for r, c3, l3 in children(d, q+12, q+8+l2):
                        if c3 == b'LIST' and d[r+8:r+12] in (b'rgn ', b'rgn2'):
                            reg = {}
                            for s, c4, l4 in children(d, r+12, r+8+l3):
                                if c4 == b'rgnh':
                                    reg['rgnh'] = struct.unpack('<HHHHHHH', d[s+8:s+8+14])
                                elif c4 == b'wsmp':
                                    reg['wsmp'] = d[s+8:s+8+l4]
                                elif c4 == b'wlnk':
                                    reg['wlnk'] = struct.unpack('<HHI', d[s+8:s+8+8])
                                elif c4 == b'LIST' and d[s+8:s+12] == b'INFO':
                                    info = parse_info(d, s+12, s+8+l4)
                                    if info.get('INAM'): reg['name'] = info['INAM']
                            regions.append(reg)
            instruments.append({'insh': vals, 'regions': regions, 'names': names})
    for i, ins in enumerate(instruments):
        vals = ins['insh']
        regions = ins['regions']
        prog = None
        for bank, pr, idx in pgal:
            if idx == i: prog = (bank, pr)
        kr = Counter()
        for r in regions:
            if 'rgnh' in r:
                kl, kh = r['rgnh'][0], r['rgnh'][1]
                kr[(kl, kh)] += 1
        name = ins['names'][0] if ins['names'] else (regions[0].get('name','') if regions else '')
        print('  #%-3d regs=%-3d insh=%s pgal=%s keyRanges=%s "%s"' % (
            i, len(regions), vals, prog, list(kr.items())[:4], name))
        if i > 45:
            print('   ...')
            break

if __name__ == '__main__':
    main()
