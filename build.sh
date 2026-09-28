#!/usr/bin/env bash
#
# Reproducible build of the single-file HTML5 app.
#
# 1. Put your own legally obtained Diamond Rush J2ME JAR in the project root
#    (default name: 钻石狂潮.jar), or point DR_JAR at it.
# 2. Run:  ./build.sh
# 3. Output: 钻石狂潮.html  (double-click to play, no server needed)
#
set -euo pipefail
cd "$(dirname "$0")"

JAR="${DR_JAR:-钻石狂潮.jar}"
OUT="${DR_OUT:-钻石狂潮.html}"

if [ ! -f "$JAR" ]; then
  echo "游戏 JAR 未找到：$JAR" >&2
  echo "请把合法取得的 Diamond Rush J2ME JAR 放到项目根目录，或使用：" >&2
  echo "  DR_JAR=/path/to/game.jar ./build.sh" >&2
  exit 1
fi

command -v python3 >/dev/null || { echo "需要 Python 3" >&2; exit 1; }

echo "[1/3] 提取类与资源 ..."
python3 tools/build_assets.py --jar "$JAR"

BANK="${DR_BANK:-Nokia Sound Font/Charlie Bank.dls}"
if [ -f "$BANK" ]; then
  echo "[2/3] 生成诺基亚音色库资源 ..."
  python3 tools/build_soundfont.py --bank "$BANK"
else
  echo "[2/3] 未找到诺基亚 DLS 音色库（$BANK），使用内置合成器音色。"
  rm -f src/assets/soundfont.js
fi

echo "[3/3] 生成单文件 HTML ..."
python3 tools/build_html.py --out "$OUT"

echo
echo "构建完成：$OUT"
echo "电脑双击即可游玩；手机可部署到任意静态空间（无需服务器逻辑）。"
