# 第三方组件与版权说明

本项目原创代码采用 MIT 许可证（见 `LICENSE`）。以下为相关的第三方内容：

## 随仓库分发
- **5×7 像素字体**（`src/vm/fontdata.js`）：取自 Adafruit-GFX-Library 的
  `glcdfont.c`（公共领域 / BSD 授权），仅用于文字渲染。

## 游戏素材（不在 MIT 许可范围内）
- 《钻石狂潮 / Diamond Rush》的字节码、图形、关卡、音乐、文本等全部素材
  版权归 **Gameloft** 所有。为避免二次分发，本仓库不包含游戏 JAR 与提取
  资源；`钻石狂潮.html` 是为了在浏览器中运行本引擎而由使用者自备的 JAR
  在本机构建的产物，仅供个人学习与怀旧使用，请勿用于商业用途。
  仓库内嵌入了竖屏原版与官方 320×240 横屏版两套字节码/资源（同样来自
  使用者自备的 JAR），版权与使用限制与上述相同。
- **诺基亚 MobileBAE DLS 音色库**（Charlie / Lloyd / Tongbao Bank 等）的
  版权归 **Nokia** 所有。本仓库不分发音色库文件，也不包含由它生成的
  `src/assets/soundfont.js`（已加入 `.gitignore`）；使用者如自行提供，
  仅在本地构建中内联，请同样仅限个人用途。仓库内已构建的
  `钻石狂潮.html` 与 Release 附件即为内联该音色的构建产物，仅用于
  个人学习怀旧，请勿再分发或商用；如权利人提出要求，将立即移除。

## 开发期工具（不随仓库分发）
以下工具仅用于逆向分析与验证，使用者自行按许可证下载：

| 工具 | 用途 | 许可证 |
| --- | --- | --- |
| CFR (benf) | Java 反编译 | MIT |
| Eclipse ECJ | 无 JDK 环境编译 Java 参考平台 | EPL-2.0 |
| OW2 ASM | 字节码分析 | BSD-3-Clause |
| Eclipse Temurin JRE / Azul Zulu JRE | 运行反编译与参考平台 | GPLv2 + Classpath Exception |

## 参考说明
MIDP `Graphics.drawString` 锚点等行为语义参考了 FreeJ2ME 的公开实现
（GPLv3）进行验证，本项目未复制其代码。
