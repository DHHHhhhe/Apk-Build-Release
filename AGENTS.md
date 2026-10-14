<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 本项目约定

> `.trellis/` **只留本地、不进仓库**（`.gitignore` 已排除）：它是开发过程记录，开源仓库只需要交付代码与文档。所以上面的 Trellis 说明只对本机的开发会话有效，clone 仓库的人看不到 `.trellis/`。
> 随仓库分发的是 `.agents/skills/` 与 `.dsh/skills/` —— 那是跨平台的技能层，与开发过程记录不是一回事。

### 改完逻辑必须重新构建产物

`package.json` 的 `main` 指向 `out/main/index.js`，也就是说**跑的是构建产物，不是源码**：

| 你改了 | 必须做 | 不做会怎样 |
| --- | --- | --- |
| 主进程或渲染进程代码 | `pnpm build`（或直接 `pnpm start`，它会先构建） | 跑起来的还是上一版 |
| 影响打包内容的代码 | `pnpm package` 重新出包 | `apps/desktop/release/` 里还是旧产物 |

`pnpm build` 只更新 `apps/desktop/out/`，**不会**动 `release/` 下的安装包与便携版。改动完成后至少核对一次：产物的修改时间要晚于最后一次源码改动。

`out/` 与 `release/` 都不入库，可以随时删了重建：

```powershell
pnpm build            # 重建 out/
pnpm package          # 重建 release/ 下的安装包与便携版
```

### 脚本必须走 scripts/run.mjs

本机的 pnpm 由 DSH Desktop（Electron）以 `ELECTRON_RUN_AS_NODE=1` 的身份驱动，直接跑 `electron-vite` 会让 Electron 退化成纯 Node、`electron.app` 为 undefined。

所以 `package.json` 里的 `dev` / `build` / `preview` / `package` 都是 `node scripts/run.mjs <工具>` 的形式。**新增或修改脚本时要保持这个包装**，否则会出现「窗口起不来、报 whenReady undefined」这类看着像依赖问题的错。

同理，用 `pnpm exec <bin>` 启动带参数的 CLI 也可能踩坑（pnpm 会把 cli.js 路径当参数传进去，报 `Unknown argument: ...cli.js`），需要带参数时走 `node scripts/run.mjs <bin> <参数>`。

### 临时文件放 .trellis/，不要放仓库根

`.trellis/` 已被忽略，临时文件（提交信息、草稿、探针页）放那里最省事。

**根目录下的临时文件会被 `git add -A` 顺手带进提交** —— 这个坑已经踩过两次（`.release-notes.tmp`、`.commit-msg.txt`）。写临时文件前先想一下它会不会被当成仓库内容，或者干脆放到 `.trellis/` 里。

同理，`git add -A` 之前先看一眼 `git status`，别闭着眼睛提交。

### 学到的界面教训：改完界面要用真渲染看一眼

类型检查、单测、构建全绿也不代表界面是对的。已经栽过两次，都是只有截图才看得出来的问题：

- 「构建中心」那一版：**主操作区排在首屏之外**，要往下滚一屏才看得到
- 「抽屉」那一版：抽屉样式**没被导入**（edit 失败后没重试），结果是抽屉在挤窄主列而不是盖住它

两种验证方式，按可用来选：

| 方式 | 怎么用 | 适用 |
| --- | --- | --- |
| 浏览器面板 | mock 掉 `window.api`、加载 `out/renderer` 的真实产物，在浏览器里开核对页 | 有浏览器工具时首选 |
| **Electron 无头探针** | 见下 | 浏览器面板不可用时（实测连续几轮都不可用） |

无头探针的做法：写一个临时脚本，用 Electron 自己开一个 `show: false` 的 `BrowserWindow` 加载那个核对页，`executeJavaScript` 量几何（`getBoundingClientRect`、`elementFromPoint` 判断有没有被盖住），再 `capturePage()` 存 PNG。跑法走仓库的包装：

```powershell
cd apps/desktop
node scripts/run.mjs electron ../../.trellis/.render-check/probe.cjs
```

`run.mjs` 会清掉 `ELECTRON_RUN_AS_NODE` 并用真 node 启动 Electron，所以 `require('electron')` 拿到的是真模块、`app` 可用。它和真机跑的是同一个 Chromium，量出来的数值可信。

**判定"没被盖住"要用 `elementFromPoint`，不要只看坐标**：元素位置对不代表点得到（上面就出现过位置没问题、但被覆盖层截走点击的情况）。

### 提交前脱敏：真实业务标识一律用中性值

这个仓库是公开的，**公司名、应用名、包名、项目路径、Windows 用户名都不能进仓库**。它们会同时落在六个地方：

| 落点 | 为什么容易漏 |
| --- | --- |
| 代码与注释 | 写示例、写「实测」注释时顺手用了手头的真实项目 |
| 测试夹具 | 拿真实项目的包名/变体名当测试数据 |
| 提交信息 | `git log` 公开可查 |
| Issue / PR / Release 正文 | 存在平台上，不随本地改动而变 |
| `.trellis/tasks/` 任务文档 | 写 PRD、设计、验收记录时贴了真实路径 |
| `.trellis/workspace/` 会话日志 | 记「实测 XX 项目成功」时带上了真实名字 |

示例统一用中性值：

| 用途 | 中性值 |
| --- | --- |
| 项目目录 | `C:\projects\sample-a` |
| 包名 | `com.demo.sample` |
| flavor | `free` / `demo_flavor` |
| 变体 | `freeDebug` / `demo_flavorRelease` |
| 应用名（中文） | `示例` |
| 用户目录 | `C:\Users\demo` |

**真实项目的验证只跑一次、不留痕**：需要拿本机真项目验证时，写成临时测试（`*.real.test.ts`）跑完即删，不要把路径与包名留在仓库里。

已经不干净的补救：改写文件内容后，还要检查 `git log` 与平台上的 Release / Issue 正文（历史里的需要 `git filter-repo` 重写）。

### DESIGN.md 是对外文件，要能独立分享

它里面**不写本项目的信息** —— 不提工具名、不写业务术语、不引用仓库路径。第 11 节那份 CSS 是给别人的落地凭据，拿出去就该能整段粘进任何项目。

- YAML 部分是**规范性令牌**（要精确取用时读它）；正文部分是**理由与用法**（解释为什么这样、什么情况可以偏离）。
- 本项目的令牌真身在 `apps/desktop/src/renderer/src/styles/tokens.css`。改了那份就同步改规范，**两边不一致时以代码为准**。
- 这层「规范 ↔ 代码」的对应关系只写在本文件，不写进 `DESIGN.md`。

要加新页面或新工具时先读 `DESIGN.md`，不要重新发明配色与圆角。

### 测试夹具只造需要的结构

单元测试一律在 `mkdtempSync` 出来的临时目录里造夹具，用完删掉。**不要**把真实的 Android 项目路径写进测试，也不要在仓库里放样本工程 —— 真实项目动辄几百 MB，而且会带出业务标识。

需要验证真实 Gradle 行为时，用最小的合成工程（`settings.gradle` + 一个模块的 `build.gradle`）就够，`spawn-gradle`、`gradle-fallback`、`failure` 这几类测试都是这么做的。

### 构建产物目录里不能放数据

`apps/desktop/release/` 与 `out/` 都是产物目录，重建或清理时会被整个删掉，打包发人时也可能被一起带走。

工具自己的数据在 `%APPDATA%\@abr\desktop`（不在产物目录，安全），但**统一输出目录绝不能设在仓库里** —— 否则打出来的 APK 会被一起提交或打进安装包。默认值在「文档/APK批量打包」，改设置时留意这一点。

### 自动更新：安装版有，便携版没有

已接入 `electron-updater`（安装版专用）：

| 位置 | 作用 |
| --- | --- |
| `apps/desktop/electron-builder.yml` 的 `publish` | `owner` / `repo` 会被**原样写进安装包的 `resources/app-update.yml`**，客户端只认它 |
| `apps/desktop/src/main/services/update/updater.ts` | 检查、下载、安装；状态推给界面（`UpdateState`） |
| 渲染层 | 顶栏「有新版本」提示 + 设置里的「版本与更新」区块 |

**地址写错的后果不是「查不到更新」这么简单**：装出去的包会把错地址固化下来，用户端只能重装，改回来也救不了已经装过的那一批。所以 `electron-builder.yml` 里必须填真实值；CI 用 `--config.publish.owner/repo` 覆盖成当前仓库，fork 出去也能正常发版。

三条容易漏的：

1. **`latest.yml` 必须上传**到 Release —— 客户端靠它判断有没有新版本、以及包的哈希与大小。工作流的资产清单里已经有它，别删。
2. **便携版没有自动更新**（`PORTABLE_EXECUTABLE_DIR` 存在即便携版）：它每次启动自解压到临时目录，装更新只会多出一份副本。
3. **关机时不装更新**（`session-end` 守卫）：Windows 会在关机途中掐掉安装程序，留下「旧的卸了、新的没装上」的残局。

发版前检查四件事：版本号比线上大、Release 资产齐全（exe ×3 + `latest.yml`）、`latest.yml` 里的 `version` 与新版本一致、`app-update.yml` 里的 `owner`/`repo` 是真实仓库。

### 发布说明文件只写用户要看的内容

`apps/desktop/build/release-notes.md` 同时是两个面向用户的地方的来源：GitHub Release 的正文，以及客户端「更新内容」那一块（经 `releaseInfo.releaseNotesFile` 写进 `latest.yml`）。

所以**这份文件里只写用户要看的内容** —— 「怎么维护这个文件」这类内部说明写在这里，写进那个文件会被用户看到。

### 应用图标：母版只放一份

图标母版是 `apps/desktop/build/icon.png`（1024×1024）。electron-builder 会自己把它转成 16/24/32/48/64/128/256 的多尺寸 `.ico` 嵌进 exe，**不需要手工准备 `.ico`**，所以别在仓库里再放一份 `.ico` 造成两个真相。

| 位置 | 用途 |
| --- | --- |
| `apps/desktop/build/icon.png` | 图标母版（打包用），`electron-builder.yml` 的 `win.icon` 指它 |
| `apps/desktop/src/renderer/src/assets/logo.png` | 界面里用的同一套 logo（顶栏、空状态引导卡） |

换图标时两处一起换，然后 `pnpm build` + `pnpm package`。**换完必须重新打包**才进 exe 与安装包；只 `pnpm build` 的话任务栏还是旧图标。

核对方法：从产物里提取图标看尺寸齐不齐（`PrivateExtractIcons` 能列出 exe 内嵌的所有尺寸），或直接看打包日志有没有 `default Electron icon is used` 这句警告 —— 有警告就是没生效。

### 什么时候该发版

改了**渲染层页面**或**主进程业务逻辑**，做完直接走发版流程，不用等人单独交代。判据是「产物内容会不会变」：

| 要发版 | 不发版 |
| --- | --- |
| 界面文案、布局、交互（`src/renderer`） | 只动了文档（README、AGENTS.md）、代码注释、`.trellis/` 记录 |
| 打包、更新检查、队列调度等实际行为（`src/main`） | 只跑了检查、没有落盘任何改动 |
| 会影响产物内容的依赖或构建配置 | 只改了 CI 工作流本身 |

**发版流程**（照着走，别跳步）：

1. 抬版本号：根 `package.json` 与 `apps/desktop/package.json` **两处一起改**（产物名与数据库文件名都取它）
2. 改 `apps/desktop/build/release-notes.md` 的「本版内容」，分类用 `#### 新增` / `#### 修复` / `#### 变更` / `#### 说明`
3. `cd apps/desktop && pnpm changelog` 把本版并进根 `CHANGELOG.md`（幂等，重复跑无害；**漏跑 CI 会失败**）
4. `pnpm typecheck && pnpm test && pnpm build`；改了打包相关内容再 `pnpm package` 本机核对
5. 提交 → `git tag v<版本>` → 推标签，等 CI

### 版本号抬哪一位

| 改动 | 抬哪一位 | 例子 |
| --- | --- | --- |
| 修 bug、调样式、加一个小功能 | 修订号 | 0.3.0 → 0.3.1 |
| 成体系的界面重构、新页面、会改变使用方式的改动 | 次版本号 | 0.3.0 → 0.4.0 |
| 不兼容的改动（数据库结构、配置格式） | 主版本号 | 1.x → 2.x |

判据是「用户会不会感觉到这是一次更新」，不是「改了几个文件」。只改文档、注释、`.trellis/` 记录不用出包。

### 更新记录与发布说明是两个文件，别搞混

| 文件 | 谁看 | 什么时候改 |
| --- | --- | --- |
| `CHANGELOG.md`（仓库根） | **用户**：界面「更新记录」读它（构建时内联进包，断网也能看）；也是历史的唯一归档 | 由 `pnpm changelog` 从发布说明**自动追加**，不用手写 |
| `apps/desktop/build/release-notes.md` | **用户**：GitHub Release 正文 + 客户端「更新内容」（经 `latest.yml`） | 每次发版**改写**成当前版本，只留本版 |

所以：**发布说明会被改写，历史只能靠 CHANGELOG 留下** —— 这也是第 3 步不能跳的原因。

### 发完版之后：提醒一声就行，不要替我更新

版本发布完成后（CI 跑完、Release 就绪、资产核对无误），**把结果告诉我即可**，不要在我这台机器上自动触发更新、也不要点安装。

- 本机更新由我自己手动触发：打开应用 → 设置 → 「版本与更新」→ 下载 → 重启并安装。
- 原因：自动装会在我人不在电脑前的时候把正在用的版本换掉，而我可能正对着旧版排查问题。
- 汇报要包含这三样：**版本号**、**Release 资产是否齐全**（exe ×3 + `latest.yml`）、**`latest.yml` 是否可访问**。
- 同一条道理：为了验证而在我这台机器上**安装或卸载**应用，也要先问一句再做。
