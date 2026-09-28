#!/usr/bin/env python3
"""Dump Java class file structure (fields/methods/constants) without a JDK."""
import struct, sys

def parse(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'\xca\xfe\xba\xbe', path
    n = struct.unpack('>H', d[8:10])[0]
    raw = [None] * n
    i = 10
    k = 1
    while k < n:
        tag = d[i]
        if tag == 1:
            l = struct.unpack('>H', d[i+1:i+3])[0]
            raw[k] = ('Utf8', d[i+3:i+3+l].decode('utf-8', 'replace')); i += 3 + l
        elif tag == 3: raw[k] = ('Int', struct.unpack('>i', d[i+1:i+5])[0]); i += 5
        elif tag == 4: raw[k] = ('Float', struct.unpack('>f', d[i+1:i+5])[0]); i += 5
        elif tag == 5: raw[k] = ('Long', struct.unpack('>q', d[i+1:i+9])[0]); i += 9; k += 1
        elif tag == 6: raw[k] = ('Double', struct.unpack('>d', d[i+1:i+9])[0]); i += 9; k += 1
        elif tag == 7: raw[k] = ('Class', struct.unpack('>H', d[i+1:i+3])[0]); i += 3
        elif tag == 8: raw[k] = ('String', struct.unpack('>H', d[i+1:i+3])[0]); i += 3
        elif tag in (9, 10, 11): raw[k] = ('Ref', tag) + struct.unpack('>HH', d[i+1:i+5]); i += 5
        elif tag == 12: raw[k] = ('NameType',) + struct.unpack('>HH', d[i+1:i+5]); i += 5
        elif tag == 15: raw[k] = ('MH',); i += 4
        elif tag == 16: raw[k] = ('MethodType',); i += 3
        elif tag == 17: raw[k] = ('Dynamic',); i += 5
        elif tag == 18: raw[k] = ('InvokeDynamic',); i += 5
        else: raise Exception('tag %d at %d' % (tag, i))
        k += 1

    def utf(idx):
        e = raw[idx]
        return e[1] if e and e[0] == 'Utf8' else '?'

    def refstr(idx):
        e = raw[idx]
        if e[0] == 'Class': return utf(e[1])
        if e[0] == 'Ref':
            ci, nti = e[2], e[3]
            nt = raw[nti]
            return '%s.%s:%s' % (utf(raw[ci][1]), utf(nt[1]), utf(nt[2]))
        if e[0] == 'String': return repr(utf(e[1]))
        if e[0] in ('Int', 'Long', 'Float', 'Double'): return str(e[1])
        return str(e)

    access, this_c, super_c = struct.unpack('>HHH', d[i:i+6]); i += 6
    ic = struct.unpack('>H', d[i:i+2])[0]; i += 2 + 2 * ic

    def skip_attrs(i):
        cnt = struct.unpack('>H', d[i:i+2])[0]; i += 2
        attrs = []
        for _ in range(cnt):
            ni, ln = struct.unpack('>HI', d[i:i+6]); i += 6
            attrs.append((utf(ni), d[i:i+ln])); i += ln
        return i, attrs

    fields = []
    fc = struct.unpack('>H', d[i:i+2])[0]; i += 2
    for _ in range(fc):
        af, ni, di = struct.unpack('>HHH', d[i:i+6]); i += 6
        i, attrs = skip_attrs(i)
        fields.append((af, utf(ni), utf(di), attrs))

    methods = []
    mc = struct.unpack('>H', d[i:i+2])[0]; i += 2
    for _ in range(mc):
        af, ni, di = struct.unpack('>HHH', d[i:i+6]); i += 6
        i, attrs = skip_attrs(i)
        methods.append((af, utf(ni), utf(di), attrs))

    return {
        'this': utf(raw[this_c][1]),
        'super': utf(raw[super_c][1]),
        'fields': fields,
        'methods': methods,
        'raw': raw,
        'utf': utf,
        'refstr': refstr,
    }

def dump(path, show_code=False):
    c = parse(path)
    print('class %s extends %s' % (c['this'], c['super']))
    print('-- fields (%d)' % len(c['fields']))
    for af, name, desc, attrs in c['fields']:
        flags = []
        if af & 0x8: flags.append('static')
        if af & 0x10: flags.append('final')
        if af & 0x2: flags.append('private')
        if af & 0x1: flags.append('public')
        print('   %-10s %-9s %s' % (','.join(flags), name, desc))
    print('-- methods (%d)' % len(c['methods']))
    for af, name, desc, attrs in c['methods']:
        flags = []
        if af & 0x8: flags.append('static')
        if af & 0x2: flags.append('private')
        if af & 0x1: flags.append('public')
        print('   %-10s %-9s %s' % (','.join(flags), name, desc))

if __name__ == '__main__':
    for p in sys.argv[1:]:
        print('=' * 30, p)
        dump(p)
