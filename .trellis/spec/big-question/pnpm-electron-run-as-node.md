# pnpm 脚本里的 ELECTRON_RUN_AS_NODE 陷阱

## 现象

在 DSH Desktop 环境里跑 `pnpm --filter @abr/desktop dev`，`electron-vite` 正常构建完 main / preload / renderer，也打印了 `starting electron app...`，然后主进程立刻抛：

```
TypeError: Cannot read properties of undefined (reading 'whenReady')
    at Object.<anonymous> (…/out/main/index.js:30:14)
```

`out/main/index.js` 里就是 `let electron = require("electron")` 后跟 `electron.app.whenReady()`。也就是说 `require('electron')` 返回的是**路径字符串**而不是 API 对象 —— 这是 Electron 在 `ELECTRON_RUN_AS_NODE` 模式下（即纯 Node）的行为。

## 根因

本机的 pnpm 自身是以 **DSH Desktop（Electron）的 ELECTRON_RUN_AS_NODE 模式**运行的，于是：

1. pnpm 给脚本进程注入 `ELECTRON_RUN_AS_NODE=1`；
2. 脚本进程里 `process.execPath` 指向 `C:\Program Files\DSH Desktop\DSH Desktop.exe`，而不是真正的 node；
3. 该变量沿着 `electron-vite → spawn(electron)` 继承下去，Electron 一启动就进入 Node 模式，`app` 自然不存在。

实测证据（关键几行）：

```
$ node scripts/run.mjs electron-vite dev
[run] before delete=1
[run] after delete=undefined
[electron-vite config] RUN_AS_NODE=1        # 删了还会回来
[main] electron=44.7.0 runAsNode=1 execPath=…\electron.exe
```

对照实验：

| 启动方式 | 子进程看到的 ELECTRON_RUN_AS_NODE |
| --- | --- |
| pwsh 里直接 `node probe.mjs` | `undefined` |
| 经 `node scripts/run.mjs node probe.mjs` | `undefined`（删除生效） |
| 经 `pnpm --filter … exec node probe.mjs` | `1`（pnpm 注入） |

## 解决

`apps/desktop/scripts/run.mjs` 作为所有 Electron 相关脚本的统一入口，做两件事：

1. 复制一份 env 并 `delete env.ELECTRON_RUN_AS_NODE`，用这份 env 去 spawn；
2. 用**真正的 node**（从 PATH 里排除含 `DSH Desktop` 的目录）直接跑目标包的 bin 入口，绕开 `node_modules/.bin` 的 `.cmd` shim 与 Electron 冒充的 `node`。

```json
"dev": "node scripts/run.mjs electron-vite dev",
"build": "node scripts/run.mjs electron-vite build"
```

修好后的日志：

```
[run] RUN_AS_NODE=undefined node=C:\Program Files\nodejs\node.exe
[electron-vite config] RUN_AS_NODE=undefined
[main] electron=44.7.0 runAsNode=undefined
```

## 顺带的两条

- **`electron` 依赖本身没有 postinstall**（44.7.0 实测），`pnpm install` 之后不会自动下载二进制，表现为 `path.txt` 缺失、启动时报「Electron failed to install correctly」。`apps/desktop/scripts/ensure-electron.mjs` 挂在 postinstall 上补这一步（已安装则秒退）。
- **`electron` 必须在主进程/预加载的 Vite 配置里显式 `external`**。它在 devDependencies 里，`externalizeDepsPlugin()` 不管它，一旦被打进 bundle，运行时会去 `out/main/dist/electron.exe` 找二进制并直接抛错。

## 适用范围

这是**开发环境**的坑，不影响打包产物，也不影响工具本身调用 `gradlew`。如果换到 pnpm 由真实 node 驱动的环境（CI、其他机器），`run.mjs` 里的两个处理都无害，可以直接留着。
