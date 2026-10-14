# Journal - dhhheee (Part 1)

> AI development session journal
> Started: 2026-10-13

---



## Session 1: 安卓批量打包工具：阶段 0-5 实现与真实项目验证
<!-- trellis-session: v=2 fp=28e679597fa25a44 -->

**Date**: 2026-10-13
**Task**: 安卓批量打包工具：阶段 0-5 实现与真实项目验证

### Summary

从零实现 Electron 桌面工具：项目登记、两级变体解析、单项目构建、队列调度、签名校验；83 个单测全过，并在两个真实 Android 项目上验证构建/取消/并发/失败隔离

### Main Changes

- 搭建 pnpm monorepo + Electron 44 + electron-vite + React 19 + Tailwind 4 + better-sqlite3 的桌面骨架，解决 pnpm 注入 ELECTRON_RUN_AS_NODE 导致 Electron 退化为 Node 的问题
- 实现项目登记与两级变体解析：静态解析 settings/build.gradle 优先（两个真实项目合计 12ms），不可信时回退 Gradle init-script 探针
- 实现单项目构建：assemble<变体> 任务、日志落盘与流式推送、递归收集 output-metadata.json 产物、失败分类（oom/缺SDK/JDK版本/超时/gradle）
- 实现队列调度：并发上限（默认 1，最高 3）、取消杀进程树、单条重试、清空、启动时收尾残留项
- 实现签名校验（apksigner）与未签名标注、设置对话框（输出目录/日志清理）、侧栏宽度拖动持久化
- 把 Windows 启动 .bat 的引号处理抽成 planSpawn 供 Gradle 与 apksigner 共用，并记入 .trellis/spec/big-question

### Git Commits

(No commits - planning session)

### Testing

- [OK] pnpm test：83 个用例全过（变体解析 11、探针输出 8、项目持久化 7、环境自检 10、产物定位 7、失败分类 10、签名 12、任务名 4、调度 8、侧栏宽度 6）
- [OK] 真实项目：sampleADebug 构建成功（218 秒，110MB APK，元数据 applicationId com.demo.samplea / 1.4.6 / 146）
- [OK] 真实取消：状态置 canceled、日志停增、gradlew --status 守护进程全 IDLE（无需 gradlew --stop）
- [OK] 真实并发：两项目并发上限 2，peakRunning=2、双双成功、59.8 秒（串行需 75 秒以上）
- [OK] 真实失败隔离：前一项 missing-sdk 失败并给出可操作提示，同队列后一项照常成功
- [OK] 真实签名检测：apksigner 选中 build-tools 37.0.0，debug APK 判定已签名并读出证书 DN
- [OK] pnpm typecheck 通过；electron-vite 三端生产构建通过

### Status

[OK] **Completed**

### Next Steps

- 仓库根未初始化 git，代码与文档均未提交；需要时先 git init 并按各阶段的提交建议分批提交
- 未做端到端验证的两条：未签名 release 包的真实标注、侧栏拖拽手势（分支与逻辑均有单测）
- 打包分发（electron-builder + asarUnpack better-sqlite3）仍在 prd 的 Deferred 里，需用户批准后开工


## Session 2: 显示每个变体的构建时间
<!-- trellis-session: v=2 fp=6378b1c049acbd1d -->

**Date**: 2026-10-14
**Task**: 显示每个变体的构建时间

### Summary

构建记录与队列面板显示每个变体自己的构建耗时与完成时刻，运行中逐秒更新；抽出共用格式化与计时

### Main Changes

- 新增 renderer/src/lib/duration.ts：耗时与时刻格式化，两个面板共用一份（原来各写一份）
- 新增 renderer/src/hooks/useNow.ts：仅在构建进行中挂 1 秒定时器，让已用时间逐秒跳
- 构建记录改为显示「完成 HH:mm:ss · 耗时 Xm Ys」，运行中显示「已用 Xs」
- 队列项 DTO 由计数改为带 runs 明细，队列面板逐变体显示状态与耗时

### Git Commits

(No commits - planning session)

### Testing

- [OK] 真实构建 sampleADebug：构建中 durationMs 为 null，完成后 30118ms，显示为 完成 00:20:10 · 耗时 30s
- [OK] pnpm test 91 个用例全过（新增 duration 8 例）；typecheck 与生产构建通过

### Status

[OK] **Completed**

### Next Steps

- 界面渲染效果未人工确认（无法驱动 GUI），走的是落库→DTO→格式化链的验证


## Session 3: 按产品评审清单推进 25 条易用性改进
<!-- trellis-session: v=2 fp=fde3a837ed8eba43 -->

**Date**: 2026-10-14
**Task**: 按产品评审清单推进 25 条易用性改进

### Summary

P0 五条、P1 九条、补充两条、P2 九条全部落地：失败原因上浮、添加不再等 Gradle、日志可控、批量入队、入队防重、产物命名一致、拖拽添加、构建通知、环境卡归位

### Main Changes

- P0：队列失败原因与日志入口上浮、无项目引导卡、添加只静态解析、日志跟随修正
- P1：全部入队、禁用原因、移除确认、入队防重、构建中快照标注、未开始变体、取消中状态、产物时间戳命名
- 补充：拖拽文件夹添加（webUtils.getPathForFile）、构建结束系统通知
- P2：打开产物目录、环境卡跟随项目并阻断、徽章语义、变体快捷选择、全部取消、分页、日志过滤、路径去重、提示分色

### Git Commits

(No commits - planning session)

### Testing

- [OK] 添加耗时从最长 5 分钟降到 7ms（构造 wrapper 卡 30 秒的项目验证）
- [OK] 重复入队被拦；产物名与磁盘文件一致；队列明细带 failureKind/logPath；路径大小写与尾分隔符去重
- [OK] pnpm test 97 个用例全过；typecheck、生产构建、dev 启动均通过

### Status

[OK] **Completed**

### Next Steps

- 界面排版与交互手感需要人工确认（本环境无法驱动 GUI）；拖拽与系统通知未人工触发
