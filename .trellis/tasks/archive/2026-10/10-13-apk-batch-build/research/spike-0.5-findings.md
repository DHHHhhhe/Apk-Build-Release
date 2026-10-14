# 阶段 0.5 spike 实测结论

样本：`C:\projects\sample-b`（`C:\projects\sample-a` 同源，未重复跑）。
环境：JDK 17（Android Studio JBR）、`ANDROID_HOME=C:\Users\demo\AppData\Local\Android\Sdk`、Gradle wrapper 7.5（本机已缓存 `gradle-7.5-bin`）、AGP 7.4.2、Kotlin 1.9.0。

## 1. 变体打印 —— 成立

命令：

```bash
gradlew --init-script .trellis/tasks/10-13-apk-batch-build/research/tool-variant-probe.init.gradle :app:help --console=plain
```

实测输出（完整日志见 `spike-demo-variants.log`）：

```
TOOL_VARIANT_HOOK::app:registered
TOOL_VARIANT::app:sampleBDebug
TOOL_VARIANT::app:sampleBRelease
TOOL_VARIANT_END
BUILD SUCCESSFUL in 11s
```

结论与推论：

- init script 方案可行，且**不需要引用 AGP 类**（`p.extensions.findByName('androidComponents')` + 鸭子类型调用就够），AGP 7.4.2 上直接跑通。
- 配置阶段耗时 11 秒（热缓存、依赖已就绪）—— 这是「回退跑 Gradle」在真实项目上的量级，可以作为静态解析优先的正当理由。
- 只有应用了 `com.android.application` 的模块产出变体（本项目 8 个模块里只有 `:app`），与「按插件类型挑 application 模块」的设计一致。
- 项目文件零改动：`app/build.gradle`(14:41)、`settings.gradle`(4/20)、`ProjectBuildConfig.kt`(10/12) 的 mtime 都早于本次运行（17:24）。`git status` 里的 4 个改动是样本项目原有的未提交改动，不是本次产生的。

## 2. 静态解析 vs 真实结果 —— 列表能对上，元数据对不上

| 项 | 静态解析可得 | 真实值（Gradle / 产物） |
| --- | --- | --- |
| 变体名 | `sample_b` 是 `productFlavors` 里的块名，能直接读到；buildTypes 是 `debug` / `release` → 能拼出 `sampleBDebug` / `sampleBRelease` | `sampleBDebug` / `sampleBRelease`（一致） |
| applicationId | 只能读到 `defaultConfig` 的 `com.fdapp.mylove` | `com.demo.sampleb`（由 flavor 用 `ProjectBuildConfig.applicationId` 覆盖） |
| versionName / versionCode | 只能读到 `defaultConfig` | 同样可能被 flavor 覆盖 |
| 产物文件名 | 读不到 | `示例B_V1.0.0_debug包_20261012_1025.apk`（项目自定义，含中文与时间戳） |

推论：**变体列表可以静态解析，但元数据必须以构建后的 `output-metadata.json` 为准**（design.md §5.5 成立）。同时说明 `source` 标注要区分「列表来源」，而元数据来源永远是产物。

样本项目作者自己在 `app/build.gradle` 里留了注释：「变体名称由 Android 插件提供，例如 Sample_bDebug、FreeRelease 或无 flavor 时的 Release，不在这里写死」—— 与本工具不硬编码变体的设计一致。

## 3. 产物路径布局 —— 不能按固定路径拼

实测目录（AGP 7.4.2）：

```
app/build/outputs/apk/sample_b/debug/output-metadata.json
app/build/outputs/apk/sample_b/debug/示例B_V1.0.0_debug包_20261012_1025.apk
app/build/outputs/apk/androidTest/sample_b/debug/output-metadata.json
```

即 **AGP 7.x 是 `outputs/apk/<flavor>/<buildType>/`，不是 `<variant>/`**（AGP 8.x 起才改成 `<variant>/`）。所以收集产物必须**递归查找 `output-metadata.json`**，不能按 `<variant>` 拼路径。还要过滤掉 `androidTest` 这类测试产物目录。

`output-metadata.json` 内容（实测）：

```json
{
  "version": 3,
  "artifactType": { "type": "APK", "kind": "Directory" },
  "applicationId": "com.demo.sampleb",
  "variantName": "sampleBDebug",
  "elements": [
    { "type": "SINGLE", "filters": [], "attributes": [],
      "versionCode": 150, "versionName": "1.5.0",
      "outputFile": "示例B_V1.0.0_debug包_20261012_1025.apk" }
  ],
  "elementType": "File"
}
```

字段齐全可用；`elements` 是数组，将来遇到 split（AAB/多 ABI）会多元素，取 `elements[]` 而不是取单值。

## 4. 同名覆盖风险 —— 真实存在

样本项目的产物名由 `currentTimeStamp()` 生成，格式 `yyyyMMdd_HHmm`，**只到分钟**。同一个变体在同一分钟内构建两次就会产出同名文件 —— 这正是 D7「保留原始文件名」必须配冲突规则（按项目分子目录 + 不静默覆盖）的原因。

## 5. 未做项（挪到后续阶段）

- **取消行为**（残留 `java.exe` / daemon 是否继续跑 / 半成品产物）：本阶段不做手搓测试，改到阶段 3 用工具自己的 `spawn` + `cancel` 实现来验，避免测的不是最终代码。
- **`assemble` 真实产物收集**：需要一次完整构建（样本项目 debug 包约 113 MB，构建耗时以分钟计），放到阶段 3 验收时做。
