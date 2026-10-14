# Windows 上启动 gradlew.bat 的引号写法

## 现象

从 Node 里启动项目的 Gradle Wrapper，第一次写成了：

```ts
spawn('cmd.exe', ['/d', '/s', '/c', `"${gradlewPath}" --init-script "${probePath}" help`], { cwd })
```

结果 `exit=1`，stderr 是（GBK 控制台里是乱码，解码后）：

```
'"C:\projects\sample-a\gradlew.bat"' 不是内部或外部命令，也不是可运行的程序或批处理文件。
```

Node 在拼命令行时把内层引号转义成了 `\"`，而 `cmd.exe` 不认 `\"` 这种转义，于是它把带引号的整串当成命令名去找，自然找不到。

## 实测对比

项目：真实 Android 项目（`gradlew.bat`），探针脚本故意放在带空格的目录 `...\Temp\abr probe space\` 下。

| 写法 | 结果 |
| --- | --- |
| `cmd.exe /d /s /c "<gradlew>" --init-script "<probe>" help`（Node 自动转义） | ❌ `\"` 转义导致 cmd 认不出命令 |
| `cmd.exe /d /s /c <gradlew> --init-script <probe> help`（逐参数、verbatim） | ❌ 路径带空格时失败 |
| **`cmd.exe /d /s /c ""<gradlew>" --init-script "<probe>" help"` + `windowsVerbatimArguments: true`** | ✅ exit=0，正常拿到变体 |
| `spawn(gradlew, args, { shell: true })` | ✅ 也能跑通，但会触发 Node 的 DEP0190（args + shell 不做转义），引号行为依赖 Node 版本 |

## 结论

Windows 上统一用这一种：

```ts
spawn(
  'cmd.exe',
  ['/d', '/s', '/c', `""${gradlewPath}" --init-script "${probePath}" help --console=plain"`],
  { cwd: projectPath, env: { ...process.env }, windowsHide: true, windowsVerbatimArguments: true }
)
```

三个要点：

1. **外层再包一对引号**：`cmd /c ""program" args"` —— cmd 会剥掉最外层那一对，内层引号留给程序参数；
2. **必须 `windowsVerbatimArguments: true`**，否则 Node 会把引号转义成 `\"`，前面的努力全白费；
3. 非 Windows 平台直接 `spawn(gradlewPath, args)`，不要套 `cmd.exe`。

## 顺带一条

`gradlew.bat` 在 Windows 上会派生 `cmd.exe → java.exe`，要中止构建必须杀**进程树**（`taskkill /PID <pid> /T /F`），只杀第一层会留下孤儿 `java.exe`。这一点在取消构建的实现里同样适用。
