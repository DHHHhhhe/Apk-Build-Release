# 参与贡献

欢迎提 Issue 与 Pull Request。

## 开始开发

```bash
pnpm install     # 首次：装依赖（postinstall 会补 Electron 二进制）
pnpm dev         # 开发模式：Vite 服务 + Electron，改代码热更新
pnpm test        # 单元测试（vitest）
pnpm typecheck   # 类型检查
```

## 提交前请确认

1. `pnpm test` 与 `pnpm typecheck` 都通过。
2. 改了主进程或渲染进程的代码后，跑一次 `pnpm build` 确认生产构建也能过。
3. 不要往仓库里带真实业务信息（见下）。

## 脱敏约定（重要）

这个仓库是公开的，**真实业务标识一律不能进来**：公司名、应用名、包名、项目路径、Windows 用户名都不行。示例统一用中性值：

| 用途 | 中性值 |
| --- | --- |
| 项目目录 | `C:\projects\demo-app` |
| 包名 | `com.demo.sample` |
| flavor | `free` / `demo_flavor` |
| 变体 | `freeDebug` / `demo_flavorRelease` |
| 应用名（中文） | `示例` |
| 用户目录 | `C:\Users\demo` |

同样的要求适用于**提交信息**、**Issue 正文**和测试用例 —— 贴日志时也要先把真实路径换掉。

## 代码风格

- 分层约定、命名规范、IPC 契约写法都在 `.trellis/spec/` 下，动手前先读对应那一份。
- 界面相关改动先读根目录 `DESIGN.md`（视觉令牌与组件规格）。
- 注释解释「为什么」，不重复代码字面意思。

## 提交信息

用 Conventional Commits：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`，描述用中文。
