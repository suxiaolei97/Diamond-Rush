# 钻石狂潮 Diamond Rush · HTML5 移植

用纯 JavaScript 实现的 J2ME（CLDC / MIDP）运行时：**直接解释执行原版 JAR 中未经修改的
字节码与资源**，不需要模拟器程序、不需要安装、不需要服务器——单个 HTML 文件双击即玩，
自适应 PC / iOS / Android，带触屏虚拟按键与音频。

## 免责声明

非官方粉丝移植，与 Gameloft 无任何关联。《钻石狂潮 / Diamond Rush》的游戏本体、
美术、音乐、文本等版权归 **Gameloft** 所有；本仓库不包含游戏 JAR 与提取资源。
仓库内的 `钻石狂潮.html` 是使用者自备 JAR 本地构建的产物，仅供个人学习与怀旧，
请勿用于商业用途；如权利人提出要求，将立即移除。

## 直接游玩

- PC：下载 Release 中的 `钻石狂潮.html`（或使用仓库根目录中的同名文件），双击即可。
- 手机：用浏览器打开该 HTML（或部署到任意静态空间）；iOS 可“添加到主屏幕”。
- 首次点击 / 触摸后音频自动解锁。

## 操作

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 移动 | 方向键 | 左侧方向键 |
| 攻击 / 确认 | 空格 或 回车 | 右侧 OK |
| 左 / 右软键 | Q / W（或 F1 / F2） | OK 上方的 L / R |
| 数字键 / 秘籍 | 0–9、E=*、R=# | 右上角 `#` 打开数字键盘 |
| 全屏 / 缩放 / 虚拟按键 | F / — / — | 右上角 ⛶ / ⤢ / 🎮 |
| 数字键盘开关 | Esc | 右上角 `#` |

游戏内秘籍与原版一致：游戏中按 `9` 跳关，`#` 开关跳关。

## 从源码构建（自备 JAR）

构建只需要 Python 3，完全离线：

1. 准备你自己合法取得的 Diamond Rush J2ME JAR，放到项目根目录（默认名 `钻石狂潮.jar`）。
2. 运行：

   ```bash
   ./build.sh                      # 或：DR_JAR=/path/to/game.jar ./build.sh
   ```

3. 得到 `钻石狂潮.html`（自包含单文件，约 1MB）。

构建流程：`tools/build_assets.py` 把 JAR 中的 `.class` 与资源编码为 base64
（`src/assets/*.js`），`tools/build_html.py` 再把引擎与这些数据内联为单个 HTML。

## 特性

- **原版字节码解释执行**：自研 JVM 子集（对象/数组/长整型/异常/虚拟线程/类初始化/接口）。
- **MIDP 2.0 API**：Graphics、Image、Font、Canvas、Display、RecordStore、Media（MIDI）。
- **原版资源**：自研容器与图集、PNG（DEFLATE）、文本表、关卡数据全部按原格式解码。
- **渲染**：与原机一致的 240×320 软件光栅化，整数倍或铺满缩放、HiDPI 适配。
- **音频**：原版 MIDI（音乐 + 音效）由 WebAudio 合成，含鼓组、弯音、通道音量/声像。
- **存档**：原版 RMS 记录持久化到 localStorage。
- **多语言**：使用 JAR 自带的语言表（简体中文 / 繁体中文 / English，右上角切换）。

## 项目结构

```
钻石狂潮.html        单文件成品（含游戏资源，由构建生成）
build.sh             一键构建（校验 JAR → 提取资源 → 生成 HTML）
src/
  vm/                引擎：classfile 解析、JVM 解释器、MIDP、zlib、MIDI、字体
  app/               浏览器外壳：缩放、键盘/触控映射、音频解锁、退出处理
  dev.html           开发页（引用分离脚本）
tools/               构建与逆向分析脚本（python3 / 可选 Java 工具）
```

## 已知差异

- 原机系统字体位于手机固件中无法从 JAR 提取，改用公共领域 5×7 像素字体；
  中文由浏览器系统字体实时光栅化绘制。
- MIDI 音色为 WebAudio 合成：旋律、节奏、鼓点、音效触发与原版一致，音色为近似。原版MIDI音色仅有Nokia设备的MIDI合成器可以实现。
- 退出流程在浏览器中以“游戏已退出”面板呈现。

## 开发 / 逆向工具（可选）

`tools/` 内还包含资源格式分析、反编译对照、逐像素截图对比、无头验证等开发脚本；
其中 Java 相关部分需要自备 JRE / CFR / ECJ / ASM，详见 `THIRD-PARTY.md`。
开发期的 Java 参考平台（用于与真机行为逐像素对比）不在本仓库中发布。

## 发布 Release（可选）

仓库根目录的 `钻石狂潮.html` 就是可玩成品，Release可下载：

```bash
git tag v1.0.0
git push origin main --tags
gh release create v1.0.0 "钻石狂潮.html" \
  --title "钻石狂潮 Diamond Rush · HTML5 移植 v1.0.0" \
  --notes "单文件、双击即玩。游戏素材版权归 Gameloft，仅供个人学习怀旧。"
```

## 许可证

原创代码采用 **MIT** 许可证（见 `LICENSE`）。游戏素材及游戏源文件的所有版权均归 Gameloft，
**不在** MIT 许可范围内（见 `THIRD-PARTY.md`）。
