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

`pnpm build` 只更新 `apps/desktop/out/`，**不会**动 `release/` 下的安装包。改动完成后至少核对一次：产物的修改时间要晚于最后一次源码改动。

`out/` 与 `release/` 都不入库，可以随时删了重建：

```powershell
pnpm build            # 重建 out/
pnpm package          # 重建 release/ 下的安装包
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

### 改完怎么验证，验不了时怎么说

最小闭环，改完就跑：

```powershell
pnpm typecheck && pnpm test    # 类型与逻辑
pnpm build                     # 界面改动必做 —— 跑的是产物，不是源码
```

| 改动类型 | 还要加什么 |
| --- | --- |
| 界面（`src/renderer`） | 真渲染看一眼（上一节两种方式任选），别只看测试绿 |
| 主进程行为（`src/main`） | 相关单测；必要时本机跑一次真流程 |
| 打包相关（`electron-builder.yml`、脚本、CI） | `pnpm package` 本机出包，核对产物与 `latest.yml` |
| 只改文档、注释 | 不用构建；但改了本文件或 `OPEN_SOURCE.md`，要回头确认里面的指针还有效 —— **界面入口位置、按钮文案、版本号这三类最容易过时**，本文件里已经出现过两回（更新入口从顶栏搬到左下角、设置里的更新区块被删掉，规则却没跟着改） |

**可以跳过测试的情况**：只改文档、只改注释、只做格式化。其余没有「先跳过后补」这一说。

**验不了的时候**（某个工具在这台机器上用不了、需要真实外部条件等）：**如实说清哪一段没验、为什么没验**，并给出替代证据（离线核对、产物里查字符串、单测覆盖到哪一层）。**不要用单测冒充端到端验证** —— 抽屉那次就是类型、单测、构建全绿，而界面是错的。

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

### 发版前或开新项目前，先读 OPEN_SOURCE.md

仓库根的 `OPEN_SOURCE.md` 是**开源维护规范**：版本号怎么抬、更新日志怎么写、发布流程、自动更新踩过的坑、对外文案的边界、发布前脱敏。

它和 `DESIGN.md` 一样**是对外文件** —— 不写本项目的信息，拿出去就能整份放进新项目。两份的分工：

| 文件 | 管什么 |
| --- | --- |
| `DESIGN.md` | 界面长什么样（令牌、组件规格、配色） |
| `OPEN_SOURCE.md` | 怎么发出去、怎么长期维护（版本、日志、发布、更新、脱敏） |

**以后又踩到「值得记住」的坑，往对应那份补一条。** 那两份的价值全在「踩过的坑」上，不在规则条数；
本文件只写「本仓库怎么做」，通用的「为什么这么做」写进那两份。

### 测试夹具只造需要的结构

单元测试一律在 `mkdtempSync` 出来的临时目录里造夹具，用完删掉。**不要**把真实的 Android 项目路径写进测试，也不要在仓库里放样本工程 —— 真实项目动辄几百 MB，而且会带出业务标识。

需要验证真实 Gradle 行为时，用最小的合成工程（`settings.gradle` + 一个模块的 `build.gradle`）就够，`spawn-gradle`、`gradle-fallback`、`failure` 这几类测试都是这么做的。

### 构建产物目录里不能放数据

`apps/desktop/release/` 与 `out/` 都是产物目录，重建或清理时会被整个删掉，打包发人时也可能被一起带走。

工具自己的数据在 `%APPDATA%\@abr\desktop`（不在产物目录，安全），但**统一输出目录绝不能设在仓库里** —— 否则打出来的 APK 会被一起提交或打进安装包。默认值在「文档/APK批量打包」。

这条**不靠自觉**：保存设置时会向上找 `.git`，落在仓库里直接拒绝并说明原因（`services/settings/lib/output-root-guard.ts`，含「目录还不存在」「盘根」等边界用例）。

### 自动更新：只有安装版有

已接入 `electron-updater`（安装版专用）：

| 位置 | 作用 |
| --- | --- |
| `apps/desktop/electron-builder.yml` 的 `publish` | `owner` / `repo` 会被**原样写进安装包的 `resources/app-update.yml`**，客户端只认它 |
| `apps/desktop/src/main/services/update/updater.ts` | 检查、下载、安装；状态推给界面（`UpdateState`） |
| 渲染层（**只有两处**） | 侧栏左下角：主题三档、自动检查更新开关、版本号（点开更新记录）、检查更新。右下角叠放区：更新提示条 + 两条通知（检查结果、更新完成） |

**地址写错的后果不是「查不到更新」这么简单**：装出去的包会把错地址固化下来，用户端只能重装，改回来也救不了已经装过的那一批。所以 `electron-builder.yml` 里必须填真实值；CI 用 `--config.publish.owner/repo` 覆盖成当前仓库，fork 出去也能正常发版。

三条容易漏的（**通用做法见 `OPEN_SOURCE.md` 第 4 节**，这里只记本仓库的落点）：

1. `latest.yml` 必须跟着上传 —— 工作流的资产清单里已经有它，别删。
2. 关机时不装更新（`session-end` 守卫）：Windows 会在关机途中掐掉安装程序，留下「旧的卸了、新的没装上」的残局。

发版前检查四件事：版本号比线上大、Release 资产齐全（3 个：`setup.exe` + `setup.exe.blockmap` + `latest.yml`）、`latest.yml` 里的 `version` 与新版本一致、**安装包里** `resources/app-update.yml` 的 `owner`/`repo` 是真实仓库。

### 发布说明：只写「这一版改了什么」

`apps/desktop/build/release-notes.md` 是三个面向用户的地方的共同来源：GitHub Release 正文、客户端「更新内容」（经 `latest.yml` 的 `releaseInfo.releaseNotesFile`）、以及 CHANGELOG（由 `pnpm changelog` 追加）。

所以这份文件里**不写外层标题**（`sync-changelog.mjs` 会直接拒绝带壳的文件），按 `### 新增 / ### 修复 / ### 变更 / ### 说明` 分类、每条一句话讲清「改了什么、为什么」：

- **不要**再写安装步骤、运行要求、已知限制 —— 它们不随版本变，家在 `README.md`；每版重复一遍只会把改动内容淹掉（参考库的 Release 正文就是这么做的）
- **不要**写「怎么维护这个文件」这类内部说明，它会出现在 Release 正文与客户端更新面板里
- 条目要写给用户看：用能感知的后果，不要罗列函数名与字段名

### 应用图标：母版只放一份

图标母版是 `apps/desktop/build/icon.png`（1024×1024）。electron-builder 会自己把它转成 16/24/32/48/64/128/256 的多尺寸 `.ico` 嵌进 exe，**不需要手工准备 `.ico`**，所以别在仓库里再放一份 `.ico` 造成两个真相。

| 位置 | 用途 |
| --- | --- |
| `apps/desktop/build/icon.png` | 图标母版（打包用），`electron-builder.yml` 的 `win.icon` 指它 |
| `apps/desktop/src/renderer/src/assets/logo.png` | 界面里用的同一套 logo（顶栏、空状态引导卡） |

换图标时两处一起换，然后 `pnpm build` + `pnpm package`。**换完必须重新打包**才进 exe 与安装包；只 `pnpm build` 的话任务栏还是旧图标。

核对方法：从产物里提取图标看尺寸齐不齐（`PrivateExtractIcons` 能列出 exe 内嵌的所有尺寸），或直接看打包日志有没有 `default Electron icon is used` 这句警告 —— 有警告就是没生效。

### 什么时候该发版：等我说了再发

**改完代码不要自己发版。** 攒着，等我说「发版」「更新」这类话，再把积攒的改动一起发一个版本。

判据从「产物内容会不会变」换成了「**我说了没有**」。

为什么：

- 这个工具是发给别人装的，而桌面应用的**每一次发版，他们那边都会弹一条更新提示**。改动小到只是一个间距的时候也发一版，等于用一条打扰去换一个几乎看不见的变化。
- 更要紧的是**「狼来了」**：更新提示发得太勤，用户会习惯性忽略，等到真正重要的那一版也没人看。
- 攒一批再发，用户一次收到的东西才有意义，发布说明里也才说得清「这版改了几件事」。

**但代码要随时保持可发布。** 攒的是「发布的时机」，不是「发布的质量」—— 改完仍然要
`pnpm typecheck && pnpm test` 过，别把一堆没验证的改动堆到发版那天。

改完代码要做的只有一件事：**提交**（提交和发版是两件事，随时可以提交）。

通用理由、以及「不同分发形态该用什么节奏」的对照表，见 `OPEN_SOURCE.md` 第 0 节。

**我说明要发版时，走这个流程**（照着走，别跳步）：

1. 抬版本号：根 `package.json` 与 `apps/desktop/package.json` **两处一起改**（产物名与数据库文件名都取它）
2. 改 `apps/desktop/build/release-notes.md`（**整份文件就是 Release 正文原文**，不要写「# 发布说明」「### 本版内容」这类外壳），分类用 `### 新增` / `### 修复` / `### 变更` / `### 说明`
3. `cd apps/desktop && pnpm changelog` 把本版并进根 `CHANGELOG.md`（幂等，重复跑无害；**漏跑 CI 会失败**）
4. `pnpm typecheck && pnpm test && pnpm build`；改了打包相关内容再 `pnpm package` 本机核对
5. 提交 → `git tag v<版本>` → 推标签，等 CI

### 版本号抬哪一位

判据是「**用户会不会感觉到这是一次更新**」，不是改了几个文件：修 bug / 调样式 / 加个小功能抬**修订号**，成体系的界面重构或新页面抬**次版本号**，数据结构或配置格式不兼容抬**主版本号**。

**攒批不影响抬哪一位**：几个小改动一起发，仍然是修订号 —— 判据还是「用户会不会感觉到这是一次更新」，不是「攒了几件事」。

完整表格、以及「只加了一个拖动手柄却抬次版本号」这类反例，见 `OPEN_SOURCE.md` 第 1 节。

### CHANGELOG 与发布说明的分工

| 文件 | 谁看 | 什么时候改 |
| --- | --- | --- |
| `CHANGELOG.md`（仓库根） | 界面「更新记录」读它（构建时内联，断网可看）；也是历史的唯一归档 | `pnpm changelog` 自动追加，不用手写 |
| `apps/desktop/build/release-notes.md` | Release 正文 + 客户端「更新内容」 | 每次发版**改写**成当前版本 |

发布说明会被下一版覆盖，**历史只能靠 CHANGELOG 留下** —— 这是发版流程第 3 步不能跳的原因；通用理由见 `OPEN_SOURCE.md` 第 2 节。

### 发完版之后：提醒一声就行，不要替我更新

版本发布完成后（CI 跑完、Release 就绪、资产核对无误），**把结果告诉我即可**，不要在我这台机器上自动触发更新、也不要点安装。

- 本机更新由我自己手动触发：打开应用 → 左下角「检查更新」→「下载 x.y.z」→「重启并安装」。
- 原因：自动装会在我人不在电脑前的时候把正在用的版本换掉，而我可能正对着旧版排查问题。
- 汇报要包含这三样：**版本号**、**Release 资产是否齐全**（3 个：setup.exe + setup.exe.blockmap + latest.yml）、**`latest.yml` 是否可访问**。
- 同一条道理：为了验证而在我这台机器上**安装或卸载**应用，也要先问一句再做。

### 往 TS/JSX 里插代码：不要用双引号 here-string

用 PowerShell 的 `@"..."@`（双引号 here-string）往源码里插 JSX 时，`${...}` 会被当成变量展开、反引号会被当成转义字符 ——
实测插进去的 ``aria-label={` + '`' + `把 ${project.name} 上移` + '`' + `}`` 被吃成语法错误，`ProjectList.tsx` 连坏两次，只能回退重来。

- 插代码一律用**单引号 here-string**（`@'...'@`）：不做任何插值，模板字符串原样保留
- 或者用 write 工具整份重写文件（它不做任何转义处理）
- 真要拼接变量就用字符串加法（`'把 ' + name + ' 上移'`），不要用模板字符串
### 界面组件层：新写的界面走 components/ui，别再手写类名

`apps/desktop/src/renderer/src/components/ui/` 是**照参考实现的 API 做的一层组件**（Button / Badge / Dialog），
但实现走本项目已有的语义类（`btn-*`、`badge`、`.dialog*`），**不引 Tailwind、不引 cva** ——
这个仓库的样式全在 `styles/components/*.css`，再引一套原子类进来会变成两个真相。

| 组件 | 变体映射 | 备注 |
| --- | --- | --- |
| `Button` | `default→btn-primary`、`outline`、`ghost`、`destructive`；`size`: `default/sm/icon` | 透传 `ButtonHTMLAttributes` 与 `ref`（React 19 里 ref 是普通 prop） |
| `Badge` | `default/success/warning/destructive/info/muted` | 透传 `HTMLAttributes<HTMLSpanElement>` |
| `Dialog` | — | Esc、点遮罩关闭、**焦点陷阱**、**关闭后焦点归还**都在这里，面板内容由调用方写 |

**新界面一律用它们**：`<Button variant="ghost">` 而不是 `className="btn-ghost"`。
迁移完成后全项目 `className="btn-*"` 与 `className="badge"` 已清零，别再把它们写回来。

**为什么表单控件（checkbox / switch / select）不迁**：这三类在本项目里已经是原生实现或符合 APG 的写法 ——
复选框与下拉是原生 `<input type="checkbox">` / `<select>`（配 `<label>`），开关是 `<button role="switch" aria-checked>`（按钮天然支持空格键），
主题三档是 `role="radiogroup"` + roving tabindex + 方向键。换成 Radix 那套只会多一层包装，无障碍不会更好。

### 脚本化改代码的三条硬规矩

这一轮迁移里，脚本改坏过两次、失败过多次，教训固定下来：

1. **自带回退**：门禁失败就 `git checkout -- .`。脚本化改写必须能在失败时回到干净状态，否则一次参数类型错误就能把十几个文件停在半改状态。
2. **先在一处验证机制，再跑全量**。`[regex]::Replace($input, $pattern, $replacement, 1)` 的第四个参数是 **RegexOptions 不是替换次数**（传 1 = IgnoreCase，于是全量替换）—— 这个错我犯了两次。
3. **换行与引号**：PowerShell here-string 在 Windows 上产 CRLF，而被工具编辑过的文件是 LF；匹配前要「三种换行都试」。字符串里写 `\"` 不是转义（PowerShell 用反引号），会直接把脚本解析搞崩。
### 探针加载的核对页：每次构建后都要重新生成，并且必须穿透缓存

这条是踩了三轮才查清的：**核对页写的是带哈希的产物路径**（`assets/index-<hash>.js`），
`pnpm build` 之后哈希变了、旧文件没了，但核对页还指着旧哈希 —— 于是页面**渲染为空**（0 个按钮、`#root` 无子元素），
而探针只会报「某某元素不存在」，看起来像代码出了问题。

更隐蔽的是：即使重新生成了核对页，**Chromium 会缓存同名 URL 的旧 HTML**，探针拿到的还是旧页。
实测探针报告里的 `脚本` 是三轮前的哈希，就是这个原因。

所以探针脚本里必须同时做两件事：

```js
await win.webContents.session.clearCache()
await win.loadURL(url + '?theme=dark&t=' + Date.now())   // 时间戳穿透缓存
```

并且在探针输出里**把加载到的脚本名打出来**（`document.querySelectorAll('script')`）——
对不上当前产物就说明拿的是旧页，这时任何「元素不存在」的结论都不成立。

**症状与判据**：探针报「元素不存在」而源码里明明有该元素时，先查这一条，不要急着怀疑代码。

**还有一条：核对页必须用 `http://127.0.0.1:8909/...` 加载，不要用 `file://`。**
核对页里的脚本引用是**绝对路径**（`/apps/desktop/out/renderer/assets/index-xxx.js`）——
`file://` 下它会解析成 `file:///apps/...` 直接 404。而**脚本 404 不会进 `console-message`**，
探针只会看到「`#root` 里 0 个子元素、0 个按钮、控制台无报错」，看起来像应用自己渲染不出来。
实测为此白查了好几轮：mock 注入成功、`window.api` 在、控制台干净，唯独 React 没挂载。
判据：探针里先打 `document.querySelectorAll('script')` 的 `src`，再打 `#root.childElementCount` ——
前者是绝对路径而后者为 0，就是加载方式错了，不是代码错了。

**还有一条：mock 里会改状态的接口必须真的改状态，否则会看到「操作没生效」的假象。**
实测：核对页里拖动排序，`dragover` 期间实时重排正常（✓），但一松手顺序就弹回原样 ——
看着像提交没生效。查下去发现 mock 的 `reorder` 是空实现（`async () => ({ success: true, projects: [] })`），
而真机是 `reorder(ids).then(() => refresh())`，顺序落库后重新拉取，链路本来就是对的。
判据：探针里「操作之后状态回退」时，先看 mock 那个接口是不是空壳 —— 尤其是 reorder / save / set 这类写操作。
### 要验证「构建相关」的改动：用合成 Android 工程，离线跑真 Gradle

不必找真实业务工程，也不必联网。本机已有可复用的缓存（AGP 7.4.2 在
`~/.gradle/caches/modules-2`，Gradle 7.5 / 8.10.2 在 `~/.gradle/wrapper/dists`），
所以一个最小合成工程 **12.8 秒**就能跑出两个变体的真实 APK。实测过整条链：
执行器 → Gradle → `output-metadata.json` 定位 → 按别名复制 → APK 落进 `<输出目录>/<别名>/`。

最小工程只要这几个文件：

| 文件 | 内容要点 |
| --- | --- |
| `settings.gradle` | `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }` + `include ':app'` |
| `build.gradle` | `buildscript { repositories { google(); mavenCentral() }; dependencies { classpath 'com.android.tools.build:gradle:7.4.2' } }` |
| `app/build.gradle` | `apply plugin: 'com.android.application'` + `namespace` + `compileSdk 33` + 两个 flavor（`flavorDimensions 'channel'`） |
| `app/src/main/AndroidManifest.xml` | 一个带 `android:label` 的 `<application />` 即可 |
| `app/src/main/java/.../Main.java` | 空类；有源码才会走 javac/dex |
| `local.properties` | `sdk.dir=` + `$env:ANDROID_HOME`（**反斜杠要换成 `/`**） |

**不需要 wrapper jar**：直接用本机已下载的发行版
`~/.gradle/wrapper/dists/gradle-7.5-bin/*/gradle-7.5/bin/gradle.bat`，
`--offline --no-daemon` 跑。要给执行器用（它要 `locateGradlew` 找到 `gradlew`），
就写一个转发脚本 `gradlew.bat` → `call "<上面那个 gradle.bat>" %*`。

三条不能忘的：

1. **统一输出目录必须先指到临时目录**：`setOutputRoot(临时目录)`。
   默认值是「文档/APK批量打包」，测试里不覆盖就会往真实文档目录写 APK。
2. **写成 `*.real.test.ts`，跑完即删**：它必然含本机路径（Gradle 启动器、`sdk.dir`），
   属于脱敏红线，不能进仓库。日常套件也不该带它 —— 一个 13 秒的用例会把 1.7 秒的套件拖垮。
3. **看清产物布局**：AGP 7.x 是 `build/outputs/apk/<flavor>/<buildType>/`，8.x 才是 `<variant>/`。
   合成工程用 7.4.2 时走的是 `findApkArtifacts` 的 metadata 主路径（不是退化的文件名匹配）。
### 核对时的假阳性：子串命中不等于结构命中

这一轮里我自己的检查脚本报过三次「有问题」，三次都是检查写坏了，不是被检查的东西坏了。最典型的一次：

| 我写的判据 | 为什么错 | 正确的判据 |
| --- | --- | --- |
| 正文里 `match '发布说明|本版内容'` | 干净的正文里会**提到**这几个字 —— 例如「发布说明文件不再带外层标题」这条改动本身 | 看**首行的结构**：是分类标题（`### 新增/修复/变更/说明`）就干净，是文档标题（`# 发布说明`）才是外壳 |
| 首行 `match '^#'` 就算有外壳 | **`### 修复` 也是 `#` 开头**，这个判据对任何 markdown 正文都成立，等于没判 | 同上，按标题层级与文案判，不按字符判 |

同类的另外两次：探针报「元素不存在」（其实是核对页指向了旧产物哈希，见上一节），以及执行器测试报「没有推 running」（其实是造数撞了外键，见下一条）。

**做法一**：检查脚本报出问题时，**先验证检查本身**再报问题。判据要尽量贴着**结构或数量**（首行是什么、有几个、值等于什么），少用「文本里出现过某词」这种判据 —— 后者在中文正文里尤其容易误伤，因为描述一件事的句子必然包含那件事的词。

**做法二（更常用）**：**别信布尔值，把匹配到的内容打出来看。**

这条是被三次事故逼出来的 —— 三次都是检查给了个「没问题」或「有问题」的结论，而真相相反：

| 我的检查 | 它说的 | 真相 |
| --- | --- | --- |
| 正文 `match '发布说明'` | 「有外壳」 | 干净正文里会**提到**这个词（「发布说明文件不再带外层标题」就是一条改动） |
| `run.mjs tsc … --noUnusedLocals` | 「0 条」 | `run.mjs` 把额外参数吞了，开关根本没生效，实际 6 条 |
| `Select-String -SimpleMatch` 查两个字符串 | 「找不到」 | 两处都在，换个写法把匹配打出来就看见了 |

所以：凡是「有/没有」「过/不过」这类判断，**输出里要带上实际内容**（匹配到的行、数到的条数、读到的值）。只看一个布尔值等于什么都没看 —— 它错了你也不知道。核对线上产物、比对文档与代码、量探针结果，都适用这条。

**还有一层：检查要有区分度。** 一次探针报「渲染顺序与规则一致」，
但数据里只有 1 个 running + 1 个 failed —— 旧规则也会排成那样，**这条检查证明不了任何事**。
补一个「入队最晚但状态是 pending」的项之后，新旧规则才会给出不同顺序，检查才有意义。
判据：**先想一下「如果代码是错的，这条检查会不会红」**；不会红，就说明数据没选对，不是代码没问题。

### 造数撞约束时，报错会指向断言而不是造数

执行器那条测试里，「项目不存在时应该先推 running」这个用例一直失败。查到最后：**队列项对项目有外键，给不存在的项目造队列项会直接 `FOREIGN KEY constraint failed`** —— 测试压根没跑到执行器。

更根本的是：`schema.ts` 里项目相关的外键全是 `onDelete: 'cascade'`，**删项目会连队列项一起删掉**，所以「队列项还在、项目没了」这个状态根本构造不出来。执行器里那句 `项目已经被移除了` 是**防御性分支，实践中不可达**。

**判据**：断言莫名其妙不成立时，先怀疑前一行的造数被数据库拒绝了（尤其是带外键的插入），再看断言本身。
### 可以定期跑的几个自查（都是纯文本扫描，不用装工具）

这些是排查时反复用到的，留成命令免得下次重写。**判断类的检查要打印实际内容再看结论**（见上一节）。

**死样式**：CSS 里定义了、源码里一次都没出现的类。

```powershell
# 列出 styles/ 里定义的类名，逐个在源码中找（不带 -SimpleMatch，避免把 | 当字面量）
$defined = @{}
Get-ChildItem src/renderer/src/styles -Recurse -Include *.css | ForEach-Object {
  foreach ($m in [regex]::Matches((Get-Content $_.FullName -Raw), '(?<![\w-])\.([a-zA-Z][\w-]*)')) { $defined[$m.Groups[1].Value] = $true }
}
$src = (Get-ChildItem src -Recurse -Include *.tsx,*.ts | Where-Object { $_.FullName -notmatch '\\styles\\' } | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
$defined.Keys | Where-Object { $src -notmatch "(?<![\w-])$([regex]::Escape($_))(?![\w-])" } | Sort-Object
```

两条坑：`var(--shadow-card)` 里的变量名会被当成类名（判据要带词边界）；`className={` + '`' + `badge badge--${x}` + '`' + `}` 这类**拼接出来的类名扫描器看不见**，删之前要确认前缀也没被拼接过。

**重复实现**：同名函数被定义多次。

```powershell
Get-ChildItem src -Recurse -Include *.ts,*.tsx | Where-Object { $_.FullName -notmatch '\.test\.' } |
  Select-String -Pattern '^\s*(?:export )?(?:async )?function ([A-Za-z_][\w]*)\s*\(' -AllMatches |
  ForEach-Object { $_.Matches[0].Groups[1].Value } | Group-Object | Where-Object { $_.Count -gt 1 }
```

**双语 README 结构**：标题层级、表格行数、代码块数、总行数四项对照。数字对不上就是一边改了另一边没改 —— 实测一次抓出三处（含一段被我改坏的命令）。

**配色对比度**：WCAG 判定**不四舍五入**（4.49 不算过）。半透明底（如徽章的 `color-mix(… 10%, transparent)`）要先和它下面的表面混合再算。当前最紧的三处：浅色次要文字 4.72、浅色 `badge--warning` 4.64、深色 `badge--muted` 4.57 —— 都在 4.5 线上一点，调淡任何一个都会掉出去。

**同一个数字散落在多处**：改一处漏一处是常态（资产数量在 5 个文件里出现过）。改这类数字时用 `Select-String` 把所有出现点一次列出来，逐个改完再复核。
