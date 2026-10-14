# 实施计划：安卓项目批量打包工具

> 配套 [prd.md](./prd.md)（需求与验收）与 [design.md](./design.md)（技术设计）。按阶段推进，每阶段可独立验收。

## 阶段 0：脚手架与约定

1. 建 Electron + Vite + React 18 + TypeScript(strict) 工程，依赖用 pnpm 管理（`.trellis/spec/shared/pnpm-electron-setup.md`）：monorepo 布局 `apps/desktop/src/{main,renderer,preload}`、`.npmrc` 开 `shamefully-hoist`、根脚本用 `--filter`。
2. 主进程 Vite 配置把 `better-sqlite3` 设为 `external`，并配 `postinstall` 重建（`@electron/rebuild` 或 `electron-builder install-app-deps`）—— 这步漏了的表现是开发期正常、打包后启动即崩。
3. 落 `apps/desktop/src/shared/constants/channels.ts`、`apps/desktop/src/shared/types/`（Zod）、`apps/desktop/src/preload/index.ts` 的 contextBridge 骨架。
4. 落 `apps/desktop/src/main/db/{client.ts,schema.ts}`，建 4 张表（design.md §4），时间戳统一 `timestamp_ms`。
5. 界面底座按 design.md §11 落地：`styles/tokens.css` 逐字复制 DESIGN.md 第 11 节的 `:root` / `.dark`（深色不接线，D11）；入口 CSS 加 Tailwind v4 `@theme inline` 映射；`styles/base.css` 写不带 `@layer` 的 `.shadow-card` / `.shadow-float` 与 `.tabular`；引入 `@fontsource-variable/geist` 自托管字体与 `lucide-react` 图标；落 `.card-shell` / `.card-core` 双层卡片类。
6. 落布局骨架：顶栏 48px、侧栏 272px 可拖动（200–420px，`localStorage['sidebar-width']`）、最小窗口 1024×680、不用 `100vh`。
7. 配 `pnpm dev` / `pnpm typecheck` / `pnpm lint` / `pnpm build` 四个脚本。

**验收**：`pnpm typecheck` 通过；`pnpm dev` 能起窗口并显示空项目列表；目测画布与卡片不同温、卡片是双层、拖动侧栏后重开窗口宽度保持。

### 执行结果（已完成）

已落盘：`.npmrc`、`pnpm-workspace.yaml`、根 `package.json`、`apps/desktop/{package.json,electron.vite.config.ts,tsconfig*.json,scripts/{run,ensure-electron}.mjs}`、`src/main/index.ts`、`src/preload/index.ts`、`src/shared/constants/channels.ts`、`src/renderer/{index.html,src/main.tsx,src/App.tsx}`、`src/renderer/src/styles/{index,tokens,base}.css` + `layout/shell.css` + `components/button.css`。

验收结果：

| 项 | 结果 |
| --- | --- |
| `pnpm install` | 通过（pnpm 11.8.0） |
| `pnpm typecheck` | 通过（tsconfig.node + tsconfig.web 双配置，无报错） |
| `pnpm build` | 通过（main 1.11 kB / preload 0.70 kB / renderer 578 kB + 11.7 kB CSS） |
| `pnpm dev` | 通过，窗口标题「APK批量打包」，日志见 `research/dev-run-success.log` |
| 令牌与双层卡片 | `styles/tokens.css` 逐字复制 DESIGN.md 第 11 节；`.card-shell` / `.card-core` 按 28px − 6px 内圆角 |

版本选择（本机实测可装的最新版，非 spec 模板里的示例版本）：

| 依赖 | 采用 | 说明 |
| --- | --- | --- |
| electron | 44.7.0 | 最新稳定 |
| electron-vite / vite | 5.0.0 / 8.3.4 | 与 electron 44 配套 |
| react / react-dom | 19.3.0 | spec 写的是「React 18+」，19 在范围内 |
| tailwindcss / @tailwindcss/vite | 4.3.3 | 与 DESIGN.md 第 11 节的 v4 `@theme inline` 方案一致 |
| typescript | ^5.9.0 | 刻意不用 7.0.2：TS 7 刚出，周边类型包与工具链未跟上 |
| better-sqlite3 / drizzle-orm / zod | 13.0.3 / 0.45.4 / 4.6.7 | better-sqlite3 13 自带 NAPI 预编译产物，**不需要 electron-rebuild** |
| pnpm | `packageManager` 写 11.8.0（本机版本） | spec 模板写 8.15.0，照抄会让 corepack 去下 pnpm 8 |

过程中踩到并已解决的三个坑（细节见 `.trellis/spec/big-question/pnpm-electron-run-as-node.md`）：

1. **pnpm 注入 `ELECTRON_RUN_AS_NODE=1`**：本机 pnpm 由 DSH Desktop（Electron）以 Node 模式驱动，变量会继承给 electron-vite 再继承给 Electron，导致 Electron 退化成纯 Node、`electron.app` 为 undefined。解法是 `scripts/run.mjs` 统一清变量并用真 node 跑工具入口。
2. **electron 44 没有 postinstall**：`pnpm install` 不会下载二进制。`scripts/ensure-electron.mjs` 挂在 postinstall 上补。
3. **`electron` 必须显式 external**：它在 devDependencies 里，`externalizeDepsPlugin()` 不管它，被打进 bundle 后会去 `out/main/dist/electron.exe` 找二进制。

与 spec 的两处有意偏离：native module 重建不需要（better-sqlite3 走 NAPI 预编译）；侧栏宽度持久化用 DESIGN.md 指定的 `localStorage['sidebar-width']`，不用 electron-store。

## 阶段 0.5：技术假设 spike（写业务代码之前）

本机 `<工作目录>` 下深度 3 没找到现成 Android 项目。样本改用用户提供的两个项目：`C:\projects\sample-b`、`C:\projects\sample-a`（同源：8 模块、Gradle 7.5、`flavorDimensions = ["sample_b"]`、flavor 的 applicationId 走 `ProjectBuildConfig` 与 `variant.productFlavors[0].properties` 动态逻辑）。本机已具备：JDK 17（Android Studio JBR）、`ANDROID_HOME` 已设、`gradle-7.5-bin` 已在 wrapper 缓存（跑 Gradle 不需要下载发行版）。

1. **变体打印**：写 `tool-variant-probe.init.gradle`（不直接引用 AGP 类，改用 `p.extensions.findByName('androidComponents')` 鸭子类型调用，避免 init 阶段类加载失败），跑 `gradlew --init-script <probe> :app:help --console=plain`，确认 stdout 有 `TOOL_VARIANT:` 行且用户项目零改动（`git status` 干净）。
2. **静态解析对照**：对同一项目跑静态解析，与 Gradle 回退结果比对，确认静态解析会漏哪些变体（预期：`ProjectBuildConfig` 驱动的 flavor 名与动态 applicationId）。
3. **取消行为**：构建中途取消，观察 ① 有无残留 `java.exe`；② daemon 是否继续跑该构建；③ `build/outputs` 是否留半成品。据此决定退路（`gradlew --stop` 还是按 daemon PID 杀树）。
4. **产物元数据**：确认该项目的 AGP 版本下 `output-metadata.json` 存在且字段可用。

**验收**：四条结论写回 design.md §9，把「待实测」换成实测结果；任何一条不成立则按 §9 的退路改设计，而不是带病开工。

### 执行结果（已完成 1、2、4；3 挪到阶段 3）

实测记录见 [research/spike-0.5-findings.md](./research/spike-0.5-findings.md)，脚本 [research/tool-variant-probe.init.gradle](./research/tool-variant-probe.init.gradle)，原始日志 `research/spike-demo-variants.log`。

| 项 | 结果 |
| --- | --- |
| 1 变体打印 | ✅ 11 秒返回，输出 `TOOL_VARIANT::app:sampleBDebug` / `sampleBRelease`；项目文件零改动；init script 无需引用 AGP 类 |
| 2 静态解析对照 | ✅ 变体名能静态拼出；applicationId 等元数据被 flavor 覆盖，必须以产物为准 |
| 3 取消行为 | ⏳ 挪到阶段 3，用工具自己的 spawn + cancel 实现验 |
| 4 产物元数据 | ✅ AGP 7.4.2 下字段齐全；布局是 `outputs/apk/<flavor>/<buildType>/`，必须递归查找并过滤 androidTest |

样本项目 AGP 7.4.2 / Gradle 7.5 / Kotlin 1.9.0，`:app` 是唯一的 application 模块。

## 阶段 1：环境自检

1. `services/env/lib/probe.ts`：查 `JAVA_HOME`、`ANDROID_HOME` / `ANDROID_SDK_ROOT`、项目 `local.properties` 的 `sdk.dir`、项目 `gradlew`（`gradlew.bat` / `gradlew`）是否存在且可执行。
2. 判定顺序：项目 `local.properties` > 环境变量 > 都不存在则报缺。
3. UI：环境自检卡片，缺什么直说什么（不把原始 Gradle 报错甩给用户）。

**验收**：故意改名 `ANDROID_HOME` 后重启，卡片给出「缺 Android SDK」而不是崩溃。

### 执行结果（已完成）

实现落在：`shared/constants/channels.ts`（改为 spec 的嵌套 `IPC_CHANNELS`）、`shared/types/{env,api}.ts`（Zod 契约 + `AppApi` 接口）、`main/services/logger.ts`（electron-log + `scope()`）、`main/services/env/{lib/probe.ts,procedures/probe.ts}`、`main/ipc/{env.handler.ts,index.ts}`、`preload/index.ts`、`renderer/src/{env.d.ts,hooks/useEnvProbe.ts,components/EnvCard.tsx,App.tsx}`、样式 `components/{input,env-card}.css`。

判定顺序按 AGP 的 `SdkLocator` 实现（不是凭经验）：

| 项 | 顺序 | 证据 |
| --- | --- | --- |
| Android SDK | 项目 `local.properties` 的 `sdk.dir`（相对路径按项目根解析）→ `ANDROID_HOME` → `ANDROID_SDK_ROOT`；两个环境变量指向不同目录时给警告（AGP 会直接报错） | [SdkLocator.kt](https://android.googlesource.com/platform/tools/base/+/refs/heads/mirror-goog-studio-main/build-system/gradle-core/src/main/java/com/android/build/gradle/internal/SdkLocator.kt) |
| JDK | 项目 `gradle.properties` 的 `org.gradle.java.home` → `JAVA_HOME`；跑 `java -version` 拿真实版本，低于 17 给 warn（AGP 8.x 起要求 17） | 同上 + [Android build 中的 Java 版本](https://developer.android.com/build/jdks) |
| Gradle Wrapper | 项目根 `gradlew.bat` / `gradlew`，并从 `gradle-wrapper.properties` 的 `distributionUrl` 解析 Gradle 版本 | 阶段 0.5 实测 |

验证结果：

| 项 | 结果 |
| --- | --- |
| 单测 | 10 个用例全过（`probe.test.ts`）：properties 转义、注释忽略、wrapper 版本解析、sdk.dir 优先级、环境变量冲突警告、SDK 缺失、gradlew 缺失、JAVA_HOME 无效、无项目目录不崩 |
| 真实项目探测 | `C:\projects\sample-b` → SDK `ok`（来源 local.properties 的 sdk.dir）、JDK `ok`（17.0.11）、Wrapper `ok`（Gradle 7.5），无警告 |
| 端到端 | `pnpm dev` 起窗口后主进程日志：`环境自检完成 { projectPath: null, states: 'androidSdk=ok,java=ok,gradlew=warn' }`（gradlew=warn 是因为还没选项目，符合预期） |
| `pnpm typecheck` | 通过 |

遗留：`pnpm lint` 仍是占位脚本（`node -e console.log`），ESLint 未接入；终端里 electron-log 的中文输出在 GBK 控制台会花屏，落盘日志（`%APPDATA%\@abr\desktop\logs\main.log`）正常。

## 阶段 2：项目登记 + 变体解析（两级）

1. 目录选择与登记（`projects` 落库，`path` 唯一）。
2. 静态解析 `lib/parse-gradle.ts`：`settings.gradle[.kts]` 取模块 → 各模块 `build.gradle[.kts]` 判插件（`com.android.application` / `com.android.library`）→ 抓 `productFlavors` 与 `buildTypes` → 组合变体名（无 flavor 时只有 `debug` / `release`）。
3. 缓存：按相关文件 mtime 组合判断是否需要重解析；结果写 `project_variants`，带 `source`。
4. 回退 `lib/gradle-fallback.ts`：生成 `tool-variant-probe.init.gradle` 到 `userData`（不写用户项目），跑 `gradlew --init-script <probe> :app:help --console=plain`，解析 `TOOL_VARIANT:` 行。
5. UI：变体多选（勾选集合存 `projects.selected_variants`）+「刷新变体」入口；`source=static` 的结果提示可能缺项。

**验收**：拿 3 类项目各测一次 —— 无 flavor 项目、多 flavor 项目、Kotlin DSL + `buildSrc` 项目；第三类必须能靠回退拿到完整列表。

### 执行结果（已完成）

实现落在：`db/{schema.ts,client.ts}`（4 张表 + 幂等建表）、`services/project/{types.ts,procedures/*,lib/*}`、`main/ipc/project.handler.ts`、`main/lib/gradle-paths.ts`、`shared/types/{project.ts,api.ts}`、`renderer/src/{hooks/useProjects.ts,components/{ProjectList,ProjectDetail}.tsx}`、样式 `components/project.css`。

与计划的两处调整：

- 变体契约放进了 `shared/types/project.ts`（跨 IPC 的类型不能两处各写一份），`services/project/types.ts` 只做转出，保留 spec 要求的模块入口。
- 建表用幂等 `CREATE TABLE IF NOT EXISTS` 而不是 drizzle-kit 迁移：第一期没有需要保留的迁移历史，等有真实数据要升级时再切（`schema.ts` 已经是单一事实来源）。

验证结果：

| 项 | 结果 |
| --- | --- |
| 单测 | 36 个用例全过：静态解析 11（Groovy/Kotlin 写法、flavor×buildType、缺 buildTypes 假定、动态 flavor 判不可信、无 application 模块、无 settings）、兜底输出解析 8（TOOL_VARIANT 行、flavor 推导、脚本报错、失败片段提取）、项目持久化 7（添加/重复添加/非法路径/无效变体剔除/刷新/移除）、环境自检 10 |
| 真实项目静态解析 | `C:\projects\sample-b` → `sampleBDebug` / `sampleBRelease`；`C:\projects\sample-a` → `sampleADebug` / `sampleARelease`；各读 9 个文件，两个项目合计 12ms（对照：跑 Gradle 要 2–11 秒） |
| 真实项目 Gradle 兜底 | 用产品自己的 `probeVariantsViaGradle` 跑 `sample-a`：exit=0、`appModules=[":app"]`、变体 `sampleADebug`/`sampleARelease`，**与静态解析结果完全一致**（`matched: true`） |
| `pnpm test` / `pnpm typecheck` | 均通过 |

过程中踩到并已解决的一个坑（细节见 `.trellis/spec/big-question/windows-spawn-bat-quoting.md`）：从 Node 启动 `gradlew.bat` 时，Node 会把内层引号转义成 `\"`，`cmd.exe` 不认，直接报「不是内部或外部命令」。实测三种写法后确定为 `cmd.exe /d /s /c ""<gradlew>" --init-script "<probe>" help"` + `windowsVerbatimArguments: true`，并且验证过带空格的探针路径也能跑通。

**未做**：`path` 唯一性靠数据库约束 + 代码预检，没有并发写入场景（单窗口应用）；UI 只支持通过系统目录选择框添加项目，没做「粘贴路径」输入。

## 阶段 3：单项目构建（先不做队列）

1. `lib/spawn-gradle.ts`：`cmd.exe /d /s /c "<项目>\gradlew.bat" :<module>:assemble<Variant> --console=plain`，stdout/stderr 流式写入 `userData/logs/<runId>.log` 并推 `build:log` 事件。
2. `build_runs` 落库：变体、状态、`exit_code`、`log_path`。
3. `lib/artifacts.ts`：遍历 `*/build/outputs/apk/**`，优先读 `output-metadata.json`，取 `applicationId` / `variantName` / `versionCode` / `versionName` / `outputFile`；无该文件时按文件名退化。
4. 复制到统一输出目录（按项目分子目录，保留原名）。
5. 失败分类 `failure_kind`：OOM（含 `OutOfMemoryError` / `Java heap space`）、缺 SDK platform、缺 `gradlew`、环境错误、其他；每类给一句可读原因 + 原始报错片段。

**验收**：单项目多变体顺序构建，每个变体在界面上有一条结果记录（路径 + 元数据 + 日志）；人为触发一次 OOM 与一次缺 SDK，两类都能被正确分类。

### 执行结果（已完成）

实现落在：`services/build/{types.ts,lib/*,procedures/*}`、`main/ipc/build.handler.ts`、`main/lib/broadcast.ts`、`shared/types/build.ts`、`renderer/src/{hooks/useBuild.ts,components/BuildPanel.tsx}`、样式 `components/build.css`；另外把 Windows 启动 Gradle 的引号逻辑抽到 `main/lib/gradle-paths.ts` 的 `planGradleSpawn()`，变体探针与构建共用一份。

与计划的调整：

- 直接构建也会建一条 `queue_items`（一个项目一条，变体在项内顺序执行），阶段 4 的调度器复用同一条执行路径，不需要改 `build_runs` 的外键。
- 新增 `settings` 表放统一输出目录（默认「文档/APK批量打包」），并给 `build_runs` 加了 `failure_hint` 列；`ensureSchema()` 增加了 `PRAGMA table_info` 补列逻辑，已有库也能升级。
- 主按钮放在顶栏（「构建选中变体」），构建面板只放记录与日志 —— 符合 DESIGN.md「每屏只有一个主按钮」。

验证结果：

| 项 | 结果 |
| --- | --- |
| 真实构建（产品代码全链路） | `C:\projects\sample-a` 的 `sampleADebug`：exit=0、耗时 218 秒、产物 `示例A_V1.0.0_debug包_20261013_1845.apk`（110 MB）复制到统一输出目录并按项目分子目录存放 |
| 产物元数据 | 从 `output-metadata.json` 读到 applicationId `com.demo.samplea`、versionName `1.4.6`、versionCode `146` —— 注意 applicationId 与 `defaultConfig` 里的值不同，印证了「元数据只能取产物」这条设计 |
| 单测 | 56 个用例全过（新增产物定位 7、失败分类 9、任务名与路径 4） |
| `pnpm typecheck` | 通过 |

真实构建第一次跑就抓到一个 bug：`updateBuildRun(runId, {})` 让 Drizzle 抛 `No values to set`（空 patch 不允许）。已改为「只读场景走 `getBuildRun`」，并在 `updateBuildRun` 里对空 patch 做了保护。

**未做**：构建中的取消（阶段 4）、apksigner 签名校验（阶段 5，现在只在文件名带 unsigned 时判定为未签名）、统一输出目录的设置界面（阶段 5）。

## 阶段 4：队列调度

1. `lib/scheduler.ts`：信号量控制并发上限（默认 1，可调 2–3）；一条队列项内按 `selected_variants` 顺序执行（D6）。
2. 状态机（design.md §5.3）：`pending → running → success | failed | canceled`。
3. `lib/cancel.ts`：中断 → 宽限期 → `taskkill /PID <pid> /T /F`（Unix `SIGKILL` 进程组）。
4. 单条重试（`attempt` 递增）、清空（`finished` / `all` 两种范围）。
5. 启动时把残留的 `running` 记录标为 `failed`（原因：工具异常退出）。

**验收**：3 个项目入队，并发上限 1 与 2 各跑一次；构建中途取消一条，确认进程树被杀干净（无残留 `java.exe`）；失败项重试后状态正确。

### 执行结果（已完成）

实现落在：`services/queue/{types.ts,lib/*,procedures/*}`、`main/ipc/queue.handler.ts`、`shared/types/queue.ts`、`renderer/src/{hooks/useQueue.ts,components/QueuePanel.tsx}`、样式 `components/queue.css`。

与计划的调整：

- **执行路径只留一条**：删掉阶段 3 的 `build/procedures/start.ts`，执行逻辑搬进 `queue/lib/executor.ts`。直接构建现在也是「入队一条 → 调度器取走」，不再有两套代码。
- `queue_items` 增加 `variants`（入队时冻结）与 `note` 列；重试沿用冻结的那份变体，不受之后改选影响。
- 新增 `before-quit` 钩子：退出时 `killAllRunning()` 收掉在跑的构建，避免留下孤儿 java。
- 取消的粒度是「杀客户端进程树 + 标记」，不额外跑 `gradlew --stop`（守护进程留着复用是预期行为）。

验证结果：

| 项 | 结果 |
| --- | --- |
| 调度单测（假执行器） | 8 个用例全过：并发 1 时一次只跑一条、调到 2 后两条同时跑、上限夹在 1..3、取消排队项、已结束项不能取消但可重试、在队列里的不能重试、清空 finished/all、异常退出收尾 |
| 真实取消 | 真实项目上于配置阶段发取消：`queue_items` 与 `build_runs` 都置 `canceled`（note「用户取消」），日志大小取消后 14 秒内不再增长，`gradlew --status` 显示守护进程全为 `IDLE`（无 BUSY） |
| 真实并发 | 两个真实项目、并发上限 2：`peakRunning=2`（两项启动时间差 19ms），双双 success，产出 `示例A_V1.0.0_debug包_*.apk` 与 `示例B_V1.0.0_debug包_*.apk`，总耗时 59.8 秒（串行需 ~75 秒以上） |
| 单测合计 | 64 个用例全过 |
| `pnpm typecheck` | 通过 |

这轮把 design.md §9 里最后两条「未验证假设」都验掉了：取消能真正停住构建（守护进程 IDLE、日志停增），并发 2 在真实项目上确实并行且都成功。

**未做**：3 并发未实测（默认上限仍是 1，用户可显式调高）；取消后 `build/` 里可能留下的半成品产物没有自动清理（属 Gradle 的正常行为，下次构建会覆盖）。

## 阶段 5：收尾

1. 签名检测：`apksigner verify --print-certs`，结果写 `build_runs.signed`；未装 build-tools 时标「未验证」。
2. 未签名标注：release 产物未签名时在结果卡片上明确写「未签名，不可直接安装」（D10）。
3. 历史列表（游标分页）+ 日志查看/清理入口。
4. 界面规范自检（对照 DESIGN.md 与 design.md §11）：画布与卡片不同温；卡片双层且内圆角 = 28px − 6px；每屏只有一个实心按钮；无第四档字号或字重；版本号/计数/耗时加 `tabular-nums`；焦点环键盘可见；`prefers-reduced-motion` 生效；无 emoji 图标；图标按钮有 `aria-label`；队列状态变化有 `role="status"` 播报。
5. 按 `.trellis/spec/guides/pre-implementation-checklist.md` 做一次自检。

**验收**：跑通 prd.md 的全部验收标准（含界面规范自检与侧栏宽度保持两条）。

### 执行结果（已完成）

实现落在：`services/build/lib/signing.ts`、`services/settings/{types.ts,procedures/*}`、`main/ipc/settings.handler.ts`、`shared/types/settings.ts`、`shared/constants/queue.ts`、`renderer/src/{hooks/useSidebarWidth.ts,components/SettingsDialog.tsx}`、样式 `components/{badge,dialog}.css`。

与计划的调整：

- 签名检测用 `apksigner verify --print-certs`，**找不到 apksigner 时返回「未验证」而不是判失败**（`signed = null`），界面显示「签名未验证」；只有明确 `DOES NOT VERIFY` 才标「未签名，不可直接安装」。
- 统一输出目录与日志清理放进设置对话框（顶栏齿轮按钮），并发上限仍在队列面板（它跟队列是一件事）。
- `.badge` 从 `env-card.css` 挪到独立的 `components/badge.css`：它已经是跨组件基础件，放在环境卡片里名不副实。
- 并发上限收进 `shared/constants/queue.ts`：之前渲染进程把 1/2/3 硬编码在选项里，主进程另有一份 `MAX_CONCURRENCY`，按 pre-implementation checklist 第 1 条（跨层常量）合并成一份。

验证结果：

| 项 | 结果 |
| --- | --- |
| 真实签名检测 | 真实 debug APK（110 MB）→ `signed: true`、`已签名：OU=sample-a, CN=sample-a`；apksigner 正确选中 build-tools 里最高的 `37.0.0` |
| 真实失败隔离 | 合成项目（sdk.dir 指向存在但无 platforms 的空目录）+ 真实项目同队列：前一项 `failed` / `missing-sdk` / 报错片段「缺少所需的 Android SDK 组件或未接受许可…」，后一项照常 `success` 并产出 APK |
| 单测 | 83 个用例全过（新增签名 12、侧栏宽度 6、失败分类补 1） |
| 界面规范自检 | 字号只有 12/14/16；字重 500/600（400 为正文默认）；卡片外壳 `--radius-xl` 28px、内芯 `calc(28px - 6px)` = 22px；`.tabular` 用在 19 处数字展示；`:focus-visible` 焦点环与 `prefers-reduced-motion` 都在 base.css；无 emoji；徽章一律 10% 浅底同色字；顶栏只有一个实心按钮；本轮补上队列状态变化的 `role="status"` 播报 |
| `pnpm typecheck` | 通过 |

过程中两个发现：

1. `apksigner --print-certs` 的证书标签随版本变：老版是 `Signer #1 certificate DN:`，37.0.0 是 `V2 Signer: certificate DN:`。第一版正则只认前者，在真实 APK 上跑出来只有「已签名」没有 DN，才暴露出来。
2. `local.properties` 的 `sdk.dir` 指向**不存在**的路径时，AGP 会回退到 `ANDROID_HOME`（合成项目因此构建成功了）；要造「缺 SDK」的失败必须让它指向存在但为空目录。这条对排查用户环境问题有用。

**未做**：release 未签名分支只有单测（假 apksigner）覆盖，没有真跑一次未签名 release 包；侧栏拖动只有 hook 单测，界面拖拽没手工验过（本环境无法驱动 GUI）。

## 验证命令

| 目的 | 命令 |
| --- | --- |
| 依赖安装 | `pnpm install` |
| 类型检查 | `pnpm typecheck` |
| 静态检查 | `pnpm lint` |
| 单元测试 | `pnpm test` |
| 手动跑工具 | `pnpm dev` |
| 变体回退实测（脱离 UI） | `gradlew --init-script <userData>/tool-variant-probe.init.gradle :app:help --console=plain` |
| 签名检测实测 | `<SDK>/build-tools/<ver>/apksigner verify --print-certs <apk>` |
| 界面令牌核对 | 打开 DevTools 检查 `:root` 上 `--background` / `--card` / `--radius` / `--shadow-card` 是否与 DESIGN.md 第 11 节一致 |

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `src/main/services/build/lib/spawn-gradle.ts` | 进程树管理与编码问题（Windows 中文路径） | 改动前先跑通阶段 3 验收，保留可用的旧实现分支 |
| `src/main/services/project/lib/parse-gradle.ts` | 正则解析 Kotlin DSL 容易过度匹配 | 解析失败一律回退 Gradle，不允许静默返回空列表 |
| `src/main/services/queue/lib/scheduler.ts` | 并发状态错乱、重复调度 | 状态迁移集中在单文件、单一入口，改动后重跑阶段 4 验收 |
| `src/main/db/schema.ts` | 表结构变更影响历史数据 | 第一期无历史数据；有数据后按 `guides/db-schema-change-guide.md` 走 |
| `src/renderer/src/styles/tokens.css` | 令牌被就地改值，界面偏离 DESIGN.md 且无人察觉 | 该文件视为 DESIGN.md 第 11 节的副本，改动只允许整段重新复制；核对命令见上表 |

## `task.py start` 前必须确认

- [ ] 用户已明确批准本实施计划（D1–D11 + 三份产物）
- [ ] PRD「Deferred」里手填变体名兜底是否采纳已表态
- [ ] 阶段 0.5 spike 有可测的 Android 项目样本（本机或用户指定），三条假设的结论已回写 design.md §9

## 追加改动（任务归档后）

用户提出「构建完成需要显示该变体构建时间」。核对后发现原实现有三处缺口：只显示耗时没有完成时刻、运行中的耗时不会跳（没有定时器，只在日志到达时顺带重渲染）、队列面板看不到单个变体的耗时（`formatDuration` 还在两个组件里各写了一份）。

改动：

- 新增 `renderer/src/lib/duration.ts`：`formatDurationMs`（`8s` / `3m38s` / `1h02m03s`，分钟秒补零，位数不跳）、`formatClock`、`formatDateTime`、`elapsedMs`，两个面板共用一份。
- 新增 `renderer/src/hooks/useNow.ts`：只有在有东西跑着时才挂 1 秒定时器，让「已用」逐秒往上走。
- 构建记录每条改为「完成 `HH:mm:ss` · 耗时 `Xm Ys`」，跑着的显示「已用 `Xs`」；hover 给完整开始时间。
- 队列项改为逐变体一行（变体名 + 状态 + 自己的耗时），超过 8 个只列前 8 个；`queue_items` 的 DTO 由「只有计数」改成带 `runs: [{ variant, state, startedAt, durationMs }]`，计数由界面从数组派生，不再两处各存一份。

验证：

| 项 | 结果 |
| --- | --- |
| 真实构建 | 跑一次 `sampleADebug`：构建中 `durationMs: null`（界面用 `startedAt` 现算），完成后 `durationMs: 30118`，显示为 `sampleADebug · 完成 00:20:10 · 耗时 30s` |
| 单测 | 91 个用例全过（新增 `duration.test.ts` 8 例：秒/分钟/小时档、补零、非法值占位、时钟回拨不为负） |
| `pnpm typecheck` / 生产构建 | 均通过 |

未验：界面上的实际渲染效果没法在本环境里用眼睛确认（无法驱动 GUI），验证走的是「数据落库 → DTO → 格式化函数」这条链加上 dev 启动无报错。

## 易用性改进（产品经理评审后，25 条全量推进）

用户让产品经理审了一遍交互与逻辑，产出 25 条清单（P0 五条 / P1 九条 / 我补两条 / P2 九条），按顺序全部落地。

**P0**

| 编号 | 改动 |
| --- | --- |
| P0-1 | `QueueRunDetail` 带上 `failureKind` / `failureHint` / `apkName` / `apkPath` / `logPath`；队列项行内直接显示「变体 失败：原因」，并给「查看日志」跳到该项目的构建记录 |
| P0-2 | 新增 `GuideCard`：没有任何项目时只显示引导卡（添加目录 → 勾变体 → 入队），不再摆空队列面板和用不上的环境卡 |
| P0-3 | `add` 只做静态解析（`allowGradleFallback: false`），Gradle 兜底改成显式按钮「用 Gradle 解析（较慢）」；`withFailureHint` 从 refresh 提到 `resolve-variants.ts` 共用，添加路径不再丢 Gradle 报错 |
| P0-4 | 日志跟随改成「贴底 40px 内才跟随」，往上翻就停并浮出「有新日志 ↓」按钮 |
| P0-5 | 日志按 runId 全量收集（不再按当前项目过滤），run 行加「日志文件」按钮直接打开 |

**P1**

| 编号 | 改动 |
| --- | --- |
| P1-1 | 顶栏加「全部入队（N）」，一次把已勾选变体的项目全推进去 |
| P1-2 | release 变体旁标「通常未签名」，不用等构建完才知道 |
| P1-3 | 主按钮禁用时在顶栏给出一行原因（先加项目 / 先勾变体 / 已在队列 / 环境有问题 / 正在处理上一个操作） |
| P1-4 | 新增 `ConfirmDialog`：移除项目前说明「将删除 N 条队列与构建记录」；队列里未结束的项目禁止移除 |
| P1-5 | 主进程 `enqueueProjects` 检查同项目是否已有 pending/running 项，重复入队直接回报原因 |
| P1-6 | 构建中在项目卡标注「本队列项使用入队时的 N 个变体（…），现在改选不影响它」 |
| P1-7 | 队列项按 `variants` 全量渲染，没轮到的显示「未开始」，不再只列已开始的 |
| P1-8 | 点取消后本地立即标记「取消中…」并禁用按钮，进程退出后再转「已取消」 |
| P1-9 | 产物重名改用时间戳后缀（`xxx_20261014-005130.apk`），并把**实际落盘名**存进 `apk_name`，界面显示的名字与磁盘一致 |

**我补的两条**

- 拖拽文件夹进窗口直接添加项目：Electron 32 起 `File.path` 已移除，路径由 preload 的 `webUtils.getPathForFile` 取（`window.api.files.pathFor`）。
- 构建结束发系统通知：一次构建实测 3 分钟以上，用户切走后需要信号。Windows 未打包应用可能不显示 toast，所以失败只记日志不抛；`main/index.ts` 设了 `setAppUserModelId`。

**P2**

打开产物目录按钮（图标从装饰变按钮）、环境卡跟随选中项目并去掉那个误导的路径输入框（缺 SDK/JDK 时禁用主按钮并说明）、静态解析徽章改中性色（只有真缺项才用警告色）、变体快捷选择（全选 / 清空 / 只选 debug / 只选 release）、全部取消 + 清空全部 + 「构建中 X · 排队 Y」拆开、构建记录「加载更早的」分页、日志关键字过滤 + 只看报错 + 错误行高亮、项目路径规范化后去重（Windows 大小写不敏感）、成功但带提示的 run 用警告色而不是错误色（按钮文案改「重新构建」）。

验证：

| 项 | 结果 |
| --- | --- |
| 添加不再等 Gradle（P0-3） | 构造一个静态解析不可信、且 `gradlew.bat` 会卡 30 秒的项目：添加耗时 **7ms**，limitations 里写明「这次没有跑 Gradle 兜底，变体列表可能不完整；可以点「刷新变体」强制解析」 |
| 重复入队被拦（P1-5） | 同一项目第二次入队返回失败并给出「已经在队列里」 |
| 产物名与磁盘一致（P1-9） | 真实构建后 `apkName` = `示例A_V1.0.0_debug包_20261014_0051.apk`，与输出目录里列出的文件完全相同 |
| 队列明细字段（P0-1） | run 明细带出 `failureKind` / `failureHint` / `logPath` |
| 路径去重（P2-8） | 末尾多一个分隔符、Windows 下大小写不同，都被判为同一个项目 |
| 全部取消 | 正在跑的发取消请求、排队的直接置取消，两条一起处理 |
| 单测 | 97 个用例全过（新增入队校验 3、全部取消 1、路径去重 1、产物命名 1） |
| `pnpm typecheck` / 生产构建 / dev 启动 | 均通过，无报错 |

未验：所有界面改动只做了「数据链路 + 启动无报错」级别的验证，排版与交互手感需要人看一眼；拖拽添加与系统通知也没法在本环境里人工触发。
