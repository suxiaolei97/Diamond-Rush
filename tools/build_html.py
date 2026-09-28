#!/usr/bin/env python3
"""Build the single-file deliverable with all JS and generated assets inlined.

Usage:
    python3 tools/build_html.py [--dev src/dev.html] [--out 钻石狂潮.html]

Run tools/build_assets.py first (requires your own game JAR).
"""
import argparse
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dev', default=os.path.join(ROOT, 'src', 'dev.html'))
    ap.add_argument('--out', default=os.path.join(ROOT, '钻石狂潮.html'))
    args = ap.parse_args()

    html = open(args.dev, encoding='utf-8').read()

    missing = []

    def repl(m):
        src = m.group(1)
        path = os.path.join(ROOT, 'src', src)
        if not os.path.isfile(path):
            missing.append(path)
            return ''
        code = open(path, encoding='utf-8').read()
        code = code.replace('</script>', '<\\/script>')
        return '<script>\n' + code + '\n</script>'

    html = re.sub(r'<script src="([^"]+)"></script>', repl, html)
    if missing:
        raise SystemExit('missing generated files (run tools/build_assets.py first):\n  ' + '\n  '.join(missing))
    html = html.replace('<title>钻石狂潮 Diamond Rush</title>',
                        '<title>钻石狂潮 Diamond Rush</title>\n'
                        '<!-- 单文件版：内置 J2ME 字节码解释器与 MIDP 运行时；游戏素材 © Gameloft，仅供个人学习怀旧 -->')

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote %s (%d bytes)' % (args.out, len(html)))


if __name__ == '__main__':
    main()
