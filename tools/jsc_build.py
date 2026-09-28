#!/usr/bin/env python3
"""Concatenate all JS sources + assets + runner into /tmp/dr_test.js for jsc."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('DR_TEST_JS', '/tmp/dr_test.js')

FILES = [
    'src/assets/classes.js',
    'src/assets/resources.js',
    'src/vm/fontdata.js',
    'src/vm/classfile.js',
    'src/vm/zlib.js',
    'src/vm/midi.js',
    'src/vm/vm.js',
    'src/vm/natives_core.js',
    'src/vm/natives_midp.js',
    'tools/jsc_runner.js',
]

def main():
    with open(OUT, 'w') as out:
        for f in FILES:
            with open(os.path.join(ROOT, f)) as inp:
                out.write('// ===== ' + f + ' =====\n')
                out.write(inp.read())
                out.write('\n;\n')
    print('wrote', OUT)

if __name__ == '__main__':
    main()
