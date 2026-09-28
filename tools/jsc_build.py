#!/usr/bin/env python3
"""Concatenate all JS sources + assets + runner into /tmp/dr_test.js for jsc."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('DR_TEST_JS', '/tmp/dr_test.js')

ASSETS = [
    'src/assets/classes.p.js',
    'src/assets/resources.js',
    'src/assets/resources.p.js',
]
OPTIONAL_ASSETS = [
    'src/assets/classes.l.js',
    'src/assets/resources.l.js',
    'src/assets/soundfont.js',
]
FILES = [
    'src/vm/fontdata.js',
    'src/vm/classfile.js',
    'src/vm/zlib.js',
    'src/vm/soundfont.js',
    'src/vm/midi.js',
    'src/vm/vm.js',
    'src/vm/natives_core.js',
    'src/vm/natives_midp.js',
    'tools/jsc_runner.js',
]

def main():
    order = list(ASSETS)
    order += [f for f in OPTIONAL_ASSETS if os.path.isfile(os.path.join(ROOT, f))]
    order += FILES
    with open(OUT, 'w') as out:
        for f in order:
            with open(os.path.join(ROOT, f)) as inp:
                out.write('// ===== ' + f + ' =====\n')
                out.write(inp.read())
                out.write('\n;\n')
    print('wrote', OUT)

if __name__ == '__main__':
    main()
