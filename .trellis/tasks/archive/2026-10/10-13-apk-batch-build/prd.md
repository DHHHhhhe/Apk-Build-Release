# 安卓项目批量打包工具（变体选择 + 队列）

## Goal

做一个桌面工具：用户一次登记多个本地 Android 项目，为每个项目指定要构建的变体，按队列批量执行打包，最后集中拿到 APK 产物与每个项目的构建结果。

用户价值：把「逐个 cd 进项目 → 敲 gradlew → 翻 `build/outputs` 找 apk」变成「一次登记、批量出包、产物集中可查」。

## Background

### 仓库现状（已确认事实）

| 事实 | 证据 |
| --- | --- |
| 仓库是空工程：无 `package.json`、无源码、不是 git 仓库（`git status` 报 not a git repository） | 根目录只有 `.trellis/`、`.agents/`、`.dsh/`、`AGENTS.md`、`.gitattributes` |
| `.trellis/spec/` 是 `trellis init` 生成的模板规范，不代表本项目已有实现 | `.trellis/spec/README.md:1-5` |
| 模板假设技术栈：前端 React 18 + TypeScript + TanStack Query + Tailwind；主进程 Electron + better-sqlite3 + TypeScript；构建 Vite + electron-builder；IPC 走 contextBridge | `.trellis/spec/README.md:74-79` |
| 任务系统可用；本任务目录 `.trellis/tasks/10-13-apk-batch-build` | `task.py list` 输出 |
| 未配置 `codex.dispatch_mode`；任务目录内未生成 `implement.jsonl` / `check.jsonl` | `.trellis/config.yaml:129-130`、任务目录内容 |

### 同类先例（已核实）

[raminturne/apk-exporter](https://github.com/raminturne/apk-exporter) —— Electron + Windows 桌面端，README 已逐页核实：

| 它已经做到 | 数值 / 做法 |
| --- | --- |
| 内置离线工具链 | JDK 17 + Android SDK（platforms 33–36、build-tools 34–36）+ 各主版本最新 Gradle（7.6.x / 8.14.x / 9.6.x）+ 预置依赖缓存，安装包约 1.4 GB，构建期不再下载 Gradle |
| 不改动用户项目 | 读项目自带 wrapper pin 或 AGP 版本，直接跑匹配的 Gradle 发行版，从不注入 wrapper 文件 |
| 多模块收集产物 | 收集所有 `*/build/outputs/apk` |
| 失败可读 | 常见 Gradle 失败（仓库被墙、缺 SDK platform、JDK 不匹配、OOM）给提示，不裸抛 exit code |

它没有的三件事，正是本工具的范围：**变体枚举（它只给 Debug / Release 两个固定选项）**、**多项目队列**、**集中产物管理**。另外 [bonnguyenitc/app-builder](https://github.com/bonnguyenitc/app-builder) 有「多项目 + 实时队列 + 并行 + 流式日志 + 取消」的壳，但面向 React Native，同样没有变体枚举；Android Studio 侧的 [variant-helper-plugin](https://github.com/PandoraMedia/variant-helper-plugin) 只解决「选中哪个变体」，不管批量。

### 工具链版本维度（已核实）

不同项目确实需要不同版本的组件，维度可枚举：

| 维度 | 由谁决定 | 证据 |
| --- | --- | --- |
| `platforms;android-XX` | 项目 `compileSdk` | AGP 9.3 最高支持 API 37；AGP 8.7 最高支持 API 35 |
| `build-tools;XX.Y.Z` | AGP 默认版本，或项目 `buildToolsVersion` 覆盖 | AGP 9.3 默认 36.0.0；AGP 8.7 默认 34.0.0 |
| Gradle 发行版 | 项目 `gradle-wrapper.properties` 的 `distributionUrl`，且不得低于 AGP 要求 | AGP 9.4 需 Gradle ≥ 9.6.0；AGP 9.0 需 ≥ 9.1.0；AGP 8.7 需 ≥ 8.9；AGP 8.0 需 ≥ 8.0 |
| JDK | AGP 决定 | AGP 8.x 起要求 JDK 17 |
| NDK / CMake | 仅含 native 代码的项目 | AGP 9.3 默认 NDK 28.2.13676358 |
| Maven 依赖（AGP 自身、Kotlin、AndroidX、三方库） | 项目依赖声明 | 不在 SDK 里，来自 maven.google.com / Maven Central / 镜像 |

三条结论：内置工具链内置的是一个**版本集合**且追不上项目，必须划边界；在线时 Gradle 自己能补装缺失 SDK 包（`android.builder.sdkDownload`，默认开，前提是许可已接受）；离线打包的真正瓶颈是 Maven 依赖缓存而不是 SDK。

### 界面规范（用户提供，规范性文档）

用户指定根目录 [DESIGN.md](<../../../../DESIGN.md>)（「中性单色桌面界面规范」v1.0）为界面参考文档，自包含：YAML 令牌（浅色/深色两套）+ 12 节正文 + 第 11 节可直接整段粘贴的完整 CSS（含 Tailwind v4 的 `@theme inline` 映射）。

关键不可协商项（摘要，细节以 DESIGN.md 为准）：

| 类别 | 要求 |
| --- | --- |
| 配色 | 画布 `#f2f2f4` 与卡片 `#ffffff` 必须不同温；主按钮墨色不是彩色；彩色只给语义状态；状态一律「10% 浅底 + 同色深字」 |
| 字阶 | 只有三档字号（12 / 14 / 16px）与三档字重（400 / 500 / 600）；字体栈必须显式带中文回退；版本号、计数、时间戳一律 `tabular-nums` |
| 尺寸 | 间距只用 4 的倍数；圆角基准 20px（`--radius`）；嵌套容器内圆角 = 外圆角 − 内边距 |
| 阴影 | 只有 `--shadow-card` 与 `--shadow-float` 两级；不使用 Tailwind `shadow-*` 工具类，阴影写成不带 `@layer` 的普通类；浮层描边用 `border` 而不是 `ring-1` |
| 卡片 | 双层结构（外壳 28px 圆角 + 6px 内边距 + 内芯 22px 圆角 + 顶部内高光），不允许退回单层加边框 |
| 布局 | 侧栏 272px 且可拖动（200–420px，值持久化）、顶栏 48px、最小窗口 1024×680、不用 `100vh`、内容列吸收剩余宽度 |
| 交互 | 每个可点元素四态齐全，焦点环用 `:focus-visible` 且必须有；动效只做状态反馈（150 / 200ms）并实现 `prefers-reduced-motion` |
| 底线 | 正文对比度 ≥ 4.5:1、焦点环 ≥ 3:1、图标按钮有 `aria-label`、状态通知用 `role="status"` + `aria-live="polite"`、不用 emoji 当图标、每屏只有一个主按钮 |

与仓库既有规范的冲突与解决（用户文档优先）：

| 冲突点 | `.trellis/spec/frontend/css-design.md` | `DESIGN.md` | 采用 |
| --- | --- | --- | --- |
| 令牌定义 | HSL `--color-*` 三元组 + Tailwind v3 `tailwind.config.js` 映射 | hex / oklch 语义令牌 + Tailwind v4 `@theme inline` | **DESIGN.md** |
| 圆角基准 | `--radius-sm/md/lg` = 0.25 / 0.5 / 0.75rem | 基准 20px，sm 6px / md 10px / lg 20px / xl 28px | **DESIGN.md** |
| 字体栈 | `system-ui, -apple-system, sans-serif` | `Geist Variable` + 显式中文回退 | **DESIGN.md** |
| 阴影 | `--shadow-sm/md/lg` 三级 | `--shadow-card` / `--shadow-float` 两级 | **DESIGN.md** |
| 文件组织 | `styles/` 分层（tokens / base / components / layout / pages）+ BEM + `index.css` 固定导入顺序 | 不管代码组织 | **沿用 spec** |

结论：**DESIGN.md 管视觉令牌与组件规格，`css-design.md` 管代码组织与命名**，两者不重叠的部分各自生效。

## 已定决策

| 编号 | 决策 | 来源 |
| --- | --- | --- |
| D1 | 形态为桌面客户端，并且自带构建环境（用户机器不需要预装 JDK / Android SDK / Gradle） | 用户答复 |
| D2 | 第一期**不做**工具链管理（不内置、不下载），直接复用本机已装环境；理由：待打包的项目在本机已经跑过，说明该机已具备所需环境。工具链管理留到后续期 | 用户答复（环境粒度） |
| D3 | 「默认变体」与「自定义变体」不是两种配置模式，而是**项目自身结构**的两种形态：项目只配了默认 flavor 时，变体就是 build type（debug / release）；项目定义了多个 product flavor 时，变体是 flavor × buildType 的组合，需要用户指定。工具必须同时覆盖两类项目，不得硬编码 debug / release | 用户答复（变体语义） |
| D4 | 变体列表来源：静态解析优先 + 按文件 mtime 缓存，解析不确定或用户显式刷新时才回退跑一次 Gradle（`--init-script` 注入，不改动用户项目），结果回写缓存 | 用户答复（变体来源） |
| D5 | 队列支持**可配置并发上限**（默认 1，用户可调到 2–3），不是严格串行 | 用户答复（队列策略） |
| D6 | 队列项粒度 = **一个项目一条队列项**，该项目选中的多个变体在项内顺序执行（同一项目的两个 Gradle 构建会争同一个 `build/` 目录与守护进程） | 用户答复（队列项粒度） |
| D7 | 产物交付：构建完成后**复制到统一输出目录**，**保留 APK 原始文件名**（不重命名） | 用户答复（产物交付） |
| D8 | 队列操作能力：取消当前项（杀进程树，不是只杀第一层）、失败/已完成项单条重试、一键清空队列 | 用户答复（队列操作） |
| D9 | 第一期项目输入**只支持本地目录**，不做 Git 克隆层（无凭据、工作区、清理逻辑） | 用户答复（输入形态） |
| D10 | release 产物未签名时**只做标注**，工具不提供签名能力，不做 keystore 管理 | 用户答复（签名处理） |
| D11 | 界面遵循根目录 DESIGN.md；**第一期只做浅色主题**，`.dark` 令牌照抄进 `tokens.css` 但不接线（不做切换、不跟随系统） | 用户答复（深色主题） |
| D12 | **不做手填变体名兜底**：变体解析（静态 → Gradle 回退）都失败时只给错误提示与「重试解析」，不给手填入口，避免填错变体名到构建失败才发现 | 用户答复（开工确认，否决了拟采纳方案） |

D2 的连带影响：环境探测从「可选优化」升为第一期核心能力（见 R7）；环境不一致导致的失败会回到用户头上，靠「环境自检 + 可读失败原因」兜；工具链相关能力移出第一期（见 Out of Scope）。

## Requirements

- **R1 项目登记**：添加项目后可列表查看、编辑、删除；同一项目重复添加有明确行为（按 `path` 去重）。
- **R2 变体发现**：列出项目真实可构建的变体 —— 无 product flavor 的项目给 build type（debug / release），有 product flavor 的项目给 flavor × buildType 的组合，两种形态同一套逻辑处理（D3）。
- **R3 变体选择**：无 flavor 项目在 debug / release 中选；多 flavor 项目从解析出的组合列表中多选，数量不限，选中集合随项目保存。
- **R4 队列执行**：多个项目排队执行，并发上限可配置（默认 1，可调 2–3）；每个条目有等待 / 运行中 / 成功 / 失败 / 已取消状态；支持取消、单条重试、清空（D8）。
- **R5 过程可见**：构建中可看实时日志与当前阶段；失败时给出可定位的 Gradle 报错片段。
- **R6 产物收集**：构建完成后定位每个变体的 APK 及其元数据（路径、variantName、applicationId、versionCode、versionName），一个变体一条结果记录；复制到统一输出目录并保留原始文件名（D7）；未签名时显式标注（D10）。
- **R7 环境自检**（核心能力）：构建前探测 `JAVA_HOME`、`ANDROID_HOME` / `ANDROID_SDK_ROOT`、项目 `local.properties` 的 `sdk.dir`、项目 `gradlew` 是否存在可执行，缺什么就直说什么。
- **R8 失败隔离**：单个项目失败不影响队列其余条目，可单独重试。
- **R9 界面规范**：渲染进程的视觉与交互遵循 [DESIGN.md](<../../../../DESIGN.md>)（中性单色桌面界面规范 v1.0）—— 令牌直接取用不重新发明、卡片双层结构、每屏一个主按钮、三档字号字重、间距 4 的倍数、内圆角按公式算、阴影两级且不用 Tailwind `shadow-*`、焦点环与 `prefers-reduced-motion` 必须有；代码组织与命名仍按 `.trellis/spec/frontend/css-design.md`。偏离需写明理由。

## Technical Notes

| 项 | 方案 | 说明 |
| --- | --- | --- |
| 变体枚举 | 两级：**静态解析优先**（读 `settings.gradle[.kts]` 与各模块 `build.gradle[.kts]`，按文件 mtime 缓存）→ 不确定时**回退跑 Gradle**（`--init-script` 注入 `androidComponents.onVariants` 打印变体，不改动项目；或 `:app:tasks --all` 解析 `assemble*`） | Gradle 没有官方 CLI 直出变体列表。先例 [androkit](https://docs.rs/androkit/latest/androkit/project/index.html) 同样做法，并记录静态解析的已知限制：flavor 的 `applicationId` 覆盖/后缀不生效、`buildSrc` 等动态逻辑需回退。跑 Gradle 的代价：配置阶段每次都执行，冷项目还要下发行版与依赖（[Gradle 性能文档](https://docs.gradle.org/current/userguide/performance.html)） |
| 产物元数据 | `build/outputs/apk/<variant>/output-metadata.json` | AGP 生成的机器可读清单，含 applicationId / variantName / versionCode / outputFile；只在构建后存在 |
| 应用模块定位 | 读 `settings.gradle(.kts)` 与各模块 `build.gradle(.kts)`，判断是否应用 `com.android.application` | 多模块项目要区分 application 与 library 模块，避免对 library 执行 assemble |
| 签名检测 | `apksigner verify --print-certs <apk>`（[apksigner 文档](https://developer.android.com/tools/apksigner)） | 未装 build-tools 时退化为文件名含 `-unsigned` 的判断，并标「未验证」 |
| Gradle 输出可解析性 | `--console=plain`（[Gradle CLI 文档](https://docs.gradle.org/current/userguide/command_line_interface.html)） | 关闭富输出，日志与阶段解析才稳定 |
| 界面令牌落地 | 把 DESIGN.md 第 11 节的 `:root` / `.dark` 整段放进 `styles/tokens.css`，再按 Tailwind v4 `@theme inline` 映射（[Tailwind 主题变量](https://tailwindcss.com/docs/theme)、[`@theme inline` 讨论](https://github.com/tailwindlabs/tailwindcss/discussions/17826)） | `inline` 才能让工具类引用变量本身，跟随 `.dark` 切换；不用 `@theme` 否则构建期把值固化 |
| Geist 字体 | 自托管，不依赖 CDN：`@fontsource-variable/geist`（npm v5.3.0，已核实存在） | Electron 离线环境不能走 Google Fonts；字体栈仍按 DESIGN.md 显式带中文回退 |
| 图标 | `lucide-react`（tree-shakable，内联 SVG） | DESIGN.md 要求一套 SVG 图标、不用 emoji |
| 工程结构 | pnpm monorepo + `apps/desktop/src/{main,renderer,preload}`（`.trellis/spec/shared/pnpm-electron-setup.md`） | 主进程 native module `better-sqlite3` 必须在 Vite 里 external 并针对 Electron 重建，否则打包后启动即崩 |
| 阶段 0.5 测试样本（用户提供） | `C:\projects\sample-b`、`C:\projects\sample-a` | 两者同源：8 个模块、Gradle 7.5、`flavorDimensions = ["sample_b"]`、app 模块用 `com.android.application`；flavor 的 applicationId 走 `ProjectBuildConfig` 与 `variant.productFlavors[0].properties` 动态逻辑 —— 正好是静态解析会失手的样本。本机环境：JDK 17（Android Studio JBR）、`ANDROID_HOME` 已设、`gradle-7.5-bin` 已在 wrapper 缓存里（跑 Gradle 不需要下载发行版） |
| 工具链版本匹配（第二期） | 项目 `distributionUrl` / AGP 版本 → 需要哪个 Gradle 与 JDK | 第一期不做，供后续期使用 |
| SDK 许可（第二期） | 预先 `sdkmanager --licenses`，或随包携带已接受的 `licenses/` 目录 | 第一期不做；Gradle 自动补装缺失 SDK 包的前提是许可已接受 |

## Acceptance Criteria

> 逐条对应实测证据（阶段 5 收尾时核对）。「部分」表示分支覆盖到位但没有端到端真跑。

- [x] 一次登记 ≥2 个项目，为不同项目选不同变体，队列跑完后每个项目都能给出对应 APK 的路径
      —— 实测 `sample-a`（sampleADebug）+ `demo`（sampleBDebug）并发 2 同跑，各自产出 `示例A_V1.0.0_debug包_*.apk` 与 `示例B_V1.0.0_debug包_*.apk`
- [x] 变体列表来自项目自身解析结果，不是硬编码 debug / release；无 flavor 与多 flavor 两类项目都覆盖
      —— 两个真实项目静态解析出 `sampleADebug/Release`、`sampleBDebug/Release`，Gradle 探针结果与之一致；无 flavor 项目（合成项目）解析出 `Debug/Release`
- [x] 单个项目构建失败时队列继续执行，失败条目给出可定位的 Gradle 报错片段
      —— 实测：失败项 `failure_kind=missing-sdk` + 「缺少所需的 Android SDK 组件或未接受许可…」，同队列下一项照常 `success` 并产出 APK
- [x] 产物元数据（variantName / applicationId / versionCode / versionName）在界面上可查
      —— 从 `output-metadata.json` 读到 `com.demo.samplea` / `1.4.6` / `146`，界面构建记录里逐条展示
- [部分] release 产物未签名时，结果卡片明确标注「未签名」，不把它当作正常成功交付
      —— 未签名分支由单测（假 apksigner 返回 `DOES NOT VERIFY`）覆盖，界面文案为「未签名，不可直接安装」；真实 APK 上验证的是**已签名**分支（`已签名：OU=sample-a, CN=sample-a`），没有真跑未签名 release 包
- [x] 并发上限调到 2 时，两个项目的构建确实并行；构建中途取消后没有残留的 `java.exe` 进程
      —— 并发实测 `peakRunning=2`（两项启动时间差 19ms）；取消实测 `gradlew --status` 守护进程全 `IDLE`、日志停止增长（守护进程留着复用属预期，不算残留）
- [x] 界面按 DESIGN.md 自检通过：画布与卡片不同温、卡片双层（外壳 + 内芯）、每屏一个主按钮、无第四档字号或字重、版本号与计数为 `tabular-nums`、焦点环键盘可见、`prefers-reduced-motion` 生效、无 emoji 图标
      —— 逐项核对：`#f2f2f4` vs `#ffffff`；28px 外壳 + 22px 内芯；顶栏唯一实心按钮；字号仅 12/14/16、字重仅 500/600；`.tabular` 用于 19 处数字；`:focus-visible` 与 `prefers-reduced-motion` 均在 base.css；图标全用 lucide
- [部分] 侧栏宽度可拖动（200–420px）且重新打开窗口后保持
      —— 拖动条与 `localStorage['sidebar-width']` 已实现，夹紧与读回有单测；界面拖拽动作本身没手工验（本环境无法驱动 GUI）

## Out of Scope

- 工具链管理：内置或自动下载 JDK / Android SDK / Gradle 发行版、版本匹配、依赖缓存预置（D2 后移出第一期）
- 签名与 keystore 管理、多渠道重签名（D10）
- Git 仓库地址输入、克隆与凭据管理（D9）
- 上传发布到应用商店或自建分发
- 分布式多机并行构建、CI 流水线集成
- 混淆与包体积优化策略配置
- 深色主题切换与跟随系统（D11：令牌照抄但第一期不接线）
- 手填变体名兜底（D12：解析失败只报错 + 重试）

## Risks

| 来源 | 风险 | 缓解 |
| --- | --- | --- |
| D2 复用本机环境 | 环境不一致导致的构建失败回到用户头上，问题难复现 | 环境自检（R7）先说清缺什么；失败原因给可读片段 |
| D4 静态解析优先 | 变体列表可能缺项（`buildSrc` 动态生成、Kotlin DSL 里的变量） | 不确定即回退跑 Gradle；提供手动刷新；结果带 `source` 标注 |
| D5 可配置并发 | 并发 2–3 个 Gradle 同时构建抢内存，容易 OOM，日志交错 | 默认并发 1；上限可调；OOM 识别成独立失败原因并提示 `-Xmx`；每个条目独立日志缓冲 |
| D7 统一目录 + 保留原名 | 不同项目（甚至同项目不同变体，若项目自定义了 `outputFileName` / `archivesBaseName`）可能产出同名 APK，直接复制会互相覆盖 | 统一目录内按项目分子目录；不允许静默覆盖 |
| D10 只标注不签名 | 用户可能把 unsigned 包当成品去安装 | 结果卡片显式标注；不标成「构建失败」但也不标成可直接安装 |
| 取消的干净程度 | 客户端进程被杀后 daemon 可能仍在跑该构建、`build/` 里可能留半成品 | 列为待实测假设（见 design.md §9），实测后定退路 |

## Deferred（待批准）

- **第二期**：工具链内置/按需下载、版本匹配、依赖缓存预置、签名能力、Git 仓库输入、深色主题接线。

## 规划状态

- 用户已批准本规划（含 D1–D12），`task.py start` 已执行，进入实施阶段。

## 关联文档

- 技术设计（架构、数据模型、流程、取舍、未验证假设）：[design.md](./design.md)
- 实施计划（阶段拆分、验证命令、回滚点）：[implement.md](./implement.md)
