# APK批量打包

把多个 Android 项目排成一队、批量打出 APK 的桌面工具。

日常场景：手上有好几个安卓项目要出包，每个项目还得挑变体（flavor × buildType），一个个开 IDE 点 Build 很烦。这个工具让你把项目一次性登记进来、勾好变体、按队列跑完，产物集中落到一个目录里。

**它复用你本机已有的构建环境** —— 你项目本来能跑起来，这里就能跑，不需要额外配 JDK、Android SDK 或 Gradle。

## 主要功能

- **多项目队列**：一次登记多个本地项目，按并发上限排队构建，一条失败不影响后面的
- **变体列表来自项目自身**：静态解析 `settings.gradle` 与各模块 `build.gradle`（毫秒级），解析不可信时再回退跑 Gradle 拿准确结果；不写死 debug / release
- **产物集中收集**：递归读 AGP 生成的 `output-metadata.json`，取 `applicationId` / `versionCode` / `versionName`，按项目分子目录复制到统一输出目录
- **签名状态标注**：用 SDK 里的 `apksigner` 校验产物，未签名时明确标注「不可直接安装」；工具只标注，不代签
- **失败分类**：把 OOM、缺 SDK 组件、JDK 版本不符、超时等分开，每类给一句能动手的建议
- **构建日志**：实时流到界面，支持关键字过滤与只看报错；完整日志落盘，可一键打开
- **取消 / 重试 / 清空**：取消会杀掉整棵 Gradle 进程树，不留孤儿 `java.exe`
- **构建完成系统通知**：跑长构建时可以切走

## 环境要求

| 项 | 要求 |
| --- | --- |
| 操作系统 | **Windows**（当前只在这一个平台验证过，代码里 Linux/macOS 分支没测） |
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| JDK | 本机已装（AGP 8.x 需要 17） |
| Android SDK | 本机已装，且 `ANDROID_HOME` 已设或项目里有 `local.properties` |
| Gradle | 项目自带 wrapper 即可 |

## 快速开始

```bash
pnpm install          # 首次：装依赖（postinstall 会补 Electron 二进制）
pnpm dev              # 开发模式：起 Vite 服务 + Electron
```

开发模式下打开窗口后：

1. 点侧栏「添加」选择项目根目录（含 `settings.gradle` 那一层）；也可以直接把文件夹**拖进窗口**
2. 在项目卡片里勾选要打的变体（支持全选 / 只选 debug / 只选 release）
3. 点右上角「加入队列并构建」；多个项目可以用「全部入队」
4. 队列面板能看到每个变体的状态与耗时，构建记录里能看到产物路径、元数据与签名状态

### 跑生产构建

```bash
pnpm start            # 先 build 再启动（等价于 pnpm preview）
pnpm build            # 只构建，产物在 apps/desktop/out
pnpm package          # 打 Windows 安装包与便携版，产物在 apps/desktop/release
```

## 入口文件在哪

| 你想找的 | 位置 |
| --- | --- |
| Electron 启动入口（构建后） | `apps/desktop/package.json` 的 `main` → `out/main/index.js` |
| 主进程源码入口 | `apps/desktop/src/main/index.ts` |
| 预加载脚本 | `apps/desktop/src/preload/index.ts` |
| 渲染进程入口 | `apps/desktop/src/renderer/index.html` + `src/renderer/src/main.tsx` |
| 打包后的可执行文件 | `apps/desktop/release/<版本>/win-unpacked/apk-batch-build.exe` |

构建产物 `out/` 与打包产物 `release/` 都不进版本库，刚 clone 下来时不存在，需要先 `pnpm build` 或 `pnpm start`。

## 输入、输出与数据位置

| 内容 | 开发模式 | 打包后 |
| --- | --- | --- |
| SQLite 库（项目、队列、构建记录） | `apps/desktop/app-dev.db` | `%APPDATA%\@abr\desktop\app.db` |
| 运行日志 | `%APPDATA%\@abr\desktop\logs\main.log` | 同左 |
| 构建日志（每个变体一份） | `%APPDATA%\@abr\desktop\logs\<runId>.log` | 同左 |
| 统一输出目录（APK 复制到这里） | 「文档/APK批量打包」 | 同左，可在**设置**里改 |
| Gradle 探针脚本 | `%APPDATA%\@abr\desktop\gradle-probe\` | 同左 |

来源与去向都在界面里可见：项目卡显示解析来源（静态 / Gradle）、构建记录显示产物完整路径与日志文件。

## 当前限制与已知问题

- **只支持 Windows**：`gradlew.bat` 的调用与进程树终止是 Windows 专用实现（`taskkill /T /F`），Linux/macOS 分支没实测。
- **只支持本地目录**：不能填 Git 地址或远程路径。
- **不做工具链管理**：不下载 JDK / SDK / Gradle，缺什么要你自己装。
- **不代签 APK**：release 变体通常没有签名配置，打出来是未签名的，工具只标注。
- **并发默认 1**：实测并发 2 可以同时跑两个真实项目（总耗时从 75 秒降到 60 秒左右），但更吃内存，所以默认保守，上限 3。
- **没有自动更新**：当前版本不带更新检查，新版本要手动装。
- **没有代码签名**：安装包未签名，首次运行会有 SmartScreen 提示。
- **日志渲染上限**：单次构建界面最多留 20 万字符、最多渲染 2000 行，超出的部分只在落盘日志里。

## 常见问题

**添加项目后变体是空的？**
项目可能用变量动态生成 flavor，静态解析读不出。点项目卡上的「用 Gradle 解析（较慢）」，它会真跑一遍 Gradle 配置阶段。

**添加项目很快，但变体不全？**
这是设计如此：添加只做静态解析（毫秒级），避免在 Gradle 上干等。需要准确列表时显式点 Gradle 解析。

**构建完找不到 APK？**
产物行会显示落盘路径；如果提示「没定位到该变体的 APK」，说明项目自定义了输出目录，工具按 `output-metadata.json` 找不到它。

**上次跑到一半我强杀了应用，队列里一直转圈？**
不会。工具启动时会把上次残留的运行中记录标成失败并写明原因，不会自动续跑。

## 项目结构

```
apps/desktop/
├── build/icon.png              # 应用图标母版（1024×1024），electron-builder 据此生成多尺寸 ico
├── electron.vite.config.ts     # 主进程 / preload / 渲染进程三段构建配置
├── electron-builder.yml        # Windows 安装包与便携版配置
├── scripts/
│   ├── run.mjs                 # 启动包装器：清掉 ELECTRON_RUN_AS_NODE、用真 node 跑工具
│   └── ensure-electron.mjs     # postinstall：补下 Electron 二进制
└── src/
    ├── main/                   # 主进程：数据库、Gradle 调度、IPC handler
    │   ├── db/                 # better-sqlite3 + drizzle
    │   ├── ipc/                # 每个 domain 一个 handler 文件
    │   ├── lib/                # 跨域公共件（进程启动、事件广播）
    │   └── services/           # env / project / build / queue / settings / notify
    ├── preload/                # contextBridge 暴露的 window.api
    ├── renderer/               # React 界面
    └── shared/                 # 跨层契约：IPC 频道、Zod 类型、常量
```

## 开发约定

- 界面视觉规范看根目录 `DESIGN.md`（令牌值 + 组件规格，与实现无关，可独立分享）
- 分层编码约定与踩坑记录在 `.trellis/`：`spec/` 是各层约定，`spec/big-question/` 是踩过的坑
- 仓库里不写真实业务标识，示例统一用中性值 —— 详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 许可证

[MIT](./LICENSE)
