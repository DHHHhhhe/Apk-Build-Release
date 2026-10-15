<img src="apps/desktop/build/icon.png" alt="" width="76">

# APK Batch Build

[![license](https://img.shields.io/github/license/DHHHhhhe/Apk-Build-Release)](LICENSE)
![platform](https://img.shields.io/badge/platform-Windows-0078d4)
[![release](https://img.shields.io/github/v/release/DHHHhhhe/Apk-Build-Release)](https://github.com/DHHHhhhe/Apk-Build-Release/releases)

[中文](README.md) ｜ **English**

Queue up multiple Android projects, pick the variants you want, and build them all in one go with the APKs collected into a single folder.

If you ship several Android apps, each with its own flavours and build types, opening an IDE and clicking Build over and over gets old fast.

**It reuses the build environment you already have.** If your project builds on your machine today, it builds here — no extra JDK, Android SDK, or Gradle setup.

![Main window](docs/images/main.png)

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [The window](#the-window)
- [Variants: release only by default](#variants-release-only-by-default)
- [Where data lives](#where-data-lives)
- [Requirements and limitations](#requirements-and-limitations)
- [FAQ](#faq)
- [Building from source](#building-from-source)
- [Releasing a new version](#releasing-a-new-version)
- [License](#license)

## What it does

| Capability | Details |
| --- | --- |
| Batch builds across projects | Register several local projects, build them through a queue with a concurrency limit; one failure does not stop the rest |
| Cross-project selection | The Build Center lists every project's buildable variants in one place — tick what you want and queue it in one go; projects already queued are skipped with a note |
| Variant list comes from the project | Parses `settings.gradle` and each module's `build.gradle` statically (milliseconds), falling back to a real Gradle run when the static result is unreliable. Nothing is hard-coded to debug/release |
| One place for the output | Reads the `output-metadata.json` AGP writes to pick up `applicationId` / `versionCode` / `versionName`, then copies each APK into a per-project subfolder |
| Summary of results | A single panel answering "what did this batch produce": projects, variants, passes and failures, total build time, total artifact size, and each APK's path and signature status |
| Signature status, not signing | Verifies artifacts with `apksigner` from your SDK and flags unsigned output as "cannot be installed directly". It reports, it never re-signs |
| Failures you can act on | Separates out-of-memory, missing SDK components, wrong JDK, timeouts and so on, each with a concrete suggestion |
| Live build log | Streams to the window, filterable to errors only, and the full log is written to disk with one-click open |
| Cancel / retry / clear | Cancelling kills the entire Gradle process tree, leaving no orphan `java.exe` |
| Desktop notification | Useful when a long build finishes while you are doing something else |
| Auto-update (installer) | Checks GitHub Releases shortly after launch; a **New version** prompt appears in the bottom-right when one is found, with release notes, download and restart-to-install. Manual checks report back through the same corner. The entry point is the version row at the bottom-left of the sidebar |

## Getting started

**Step 1: download and install**

Grab a build from [Releases](https://github.com/DHHHhhhe/Apk-Build-Release/releases) — either form works:

| Package | Best for | Notes |
| --- | --- | --- |
| `apk-batch-build-<version>-setup.exe` | Regular use | Installer, you choose the install path; adds Start Menu and desktop shortcuts |


> The app updates itself from then on (there is a check shortly after launch). An auto-updated release still triggers SmartScreen once — that is the cost of shipping unsigned, not a damaged file.

> The first launch triggers a Windows SmartScreen warning (no code-signing certificate, publisher shows as "Unknown publisher"). Click **More info** → **Run anyway**; the file is not damaged.

**Step 2: add a project**

Click **Add** in the sidebar and pick the project root — the folder containing `settings.gradle`. You can also drag a folder onto the window.

Adding only reads configuration files, so it finishes in milliseconds and never runs Gradle.

**Step 3: pick variants**

Tick them in **Build Center · To build**. It lists the buildable variants of *every* project at once, so there is no need to open each project; per-project select-all, clear and select-one-build-type are there too.

The tool builds **release** variants only; those are the variants the list shows.

**Step 4: queue it**

Click **Build checked (N)** — the button inside the panel and the one in the top bar are the same action. Projects already in the queue are skipped and the count is reported next to the button.

When the run finishes, switch to **Build Center · Built** to see what the batch produced, then use **Open output folder** or **Copy paths**.

## The window

The sidebar lists your projects. The main column holds **global** content only: the build center and the queue. To see one project's variant list, environment check or build history, click it in the sidebar and a drawer opens on the right.

![Main window](docs/images/main.png)

The Build Center has two views: **To build** (cross-project selection and the build action) and **Built** (a summary of this batch's artifacts).

![Results summary](docs/images/summary.png)

| Section | Purpose |
| --- | --- |
| Build Center · To build | Cross-project selection table: buildable variants grouped by project, with a running "selected X / buildable Y" count; a project with no variants gets a reason plus a "Resolve with Gradle" entry point |
| Build Center · Built | Results summary: metric row plus artifacts grouped by project (file name, size, signature status, finish time) |
| Queue | One entry per project, expanded per variant, with each variant's status and duration; supports cancel, retry and clear |
| Project drawer | Opened by clicking a project in the sidebar: variant selection, where the variant list came from and any parsing limitations, environment check, and that project's build history. It is non-modal — the main column stays usable while it is open — and `Esc` closes it |

The environment check and build history live in the drawer because both are fetched per project (one probe, one query). Putting them in the global area would mean probing every project the moment the window opens.

## Variants: release only

The tool builds `release` variants only. If a project has no `release` variant at all, every variant is listed — otherwise you would face an empty list.

The list and the queue use the **same rule**, so a variant you cannot see is never built behind your back.

## Where data lives

| Item | Location |
| --- | --- |
| Output folder (APKs are copied here) | `Documents\APK批量打包`, changeable in **Settings** |
| SQLite database (projects, queue, build history) | Installed app: `%APPDATA%\@abr\desktop\app.db`; dev mode: `apps/desktop/app-dev.db` |
| Application log | `%APPDATA%\@abr\desktop\logs\main.log` |
| Per-variant build log | `%APPDATA%\@abr\desktop\logs\<runId>.log` |
| Gradle probe script | `%APPDATA%\@abr\desktop\gradle-probe\` |

Data lives outside the install directory, so uninstalling does not delete it.

**Does it touch your project?** It reads Gradle configuration, runs `gradlew`, and copies artifacts out — nothing else. The probe script is written to the app data directory and only passed in for a build via `--init-script`, never dropped into your project.

## Requirements and limitations

### Input

| Item | Requirement |
| --- | --- |
| OS | **Windows** (the only platform tested so far) |
| Local environment | JDK (17 for AGP 8.x), Android SDK (`ANDROID_HOME` set, or `local.properties` in the project); Gradle comes from the project's own wrapper |
| Project | A **local directory** — no Git URLs or remote paths |
| Network | The tool itself never goes online and uploads nothing; whether a build needs the network depends on your project's dependencies |

### Other

- **It does not re-sign APKs.** Release variants usually have no signing config, so the output is unsigned and simply labelled as such.
- **It does not manage toolchains.** It will not download a JDK, SDK, or Gradle. This is deliberate: reusing the environment your project already builds with is more reliable than the tool installing its own.
- **Concurrency defaults to 1.** Two real projects in parallel brought a 75-second run down to about 60 seconds, but it costs more memory; 3 is the ceiling.
- **Log rendering limit.** The window keeps at most 200,000 characters and renders 2,000 lines; anything beyond that is only in the file on disk.
- **No auto-update.** This version does not check for updates; installing a new version means replacing the old one.
- **No executables in this repository.** Installers live in [Releases](https://github.com/DHHHhhhe/Apk-Build-Release/releases).

## FAQ

**Why is the variant list empty after adding a project?**
The project may generate flavours dynamically, which static parsing cannot follow. Click **Resolve with Gradle (slower)** on the project card; it runs the real configuration phase.

**Adding was instant, but the variant list looks incomplete.**
That is by design: adding only parses configuration so you never wait on Gradle. Ask for the accurate list explicitly with the Gradle resolver.

**The build succeeded but I cannot find the APK.**
The artifact row shows the path it was written to. If it says no APK was located for the variant, the project overrides its output directory and no `output-metadata.json` exists where the tool looks.

**I force-quit the app mid-build; is the queue stuck?**
No. On startup, leftover running records are marked as failed with a reason. Nothing resumes automatically.

**I moved to another machine — the project paths differ.**
Projects are registered by path, so add them again on the new machine. App data in `%APPDATA%\@abr\desktop` can be copied over.

## Building from source

Build it yourself if you want to modify it or try an untested platform:

```bash
pnpm install          # first run: installs dependencies (postinstall fetches the Electron binary)
pnpm dev              # development: Vite server + Electron with hot reload
pnpm start            # build then launch (same as pnpm preview)
pnpm test             # unit and integration tests
pnpm typecheck        # type check
pnpm package          # build the Windows installer into apps/desktop/release
```

Requires Node.js ≥ 20 and pnpm ≥ 9.

| What you are looking for | Where |
| --- | --- |
| Electron entry point (built) | `apps/desktop/package.json`'s `main` → `out/main/index.js` |
| Main process source | `apps/desktop/src/main/index.ts` |
| Renderer | `apps/desktop/src/renderer/index.html` + `src/renderer/src/main.tsx` |
| Packaging config | `apps/desktop/electron-builder.yml` |
| Icon master | `apps/desktop/build/icon.png` (electron-builder generates the multi-size ico) |
| UI visual spec | [DESIGN.md](DESIGN.md) |

```
apps/desktop/src/
├── main/       # main process: database, Gradle orchestration, IPC handlers
├── preload/    # the window.api exposed via contextBridge
├── renderer/   # React UI
└── shared/     # cross-layer contracts: IPC channels, Zod types, constants
```

> `out/` and `release/` are not committed, so a fresh clone has neither — run `pnpm build` or `pnpm start` first.
> After changing code, rebuild: the app runs the output in `out/`, not your source.

## Releasing a new version

```powershell
# 1. bump the version in both root package.json and apps/desktop/package.json
# 2. update apps/desktop/build/release-notes.md (it becomes the Release body)
# 3. commit, then tag
git tag v<version>
git push origin main --tags
```

Pushing the tag runs the release workflow, which type-checks, tests, builds, packages, and publishes
the installer to Releases.

**Manual release (bypassing CI)**: the output is 3 files, and none may be missing — without `latest.yml` clients cannot find updates (anyone on an older build would have to reinstall), and that is invisible on the release page.

```powershell
pnpm package
gh release create v<version> `
  apps/desktop/release/<version>/apk-batch-build-<version>-setup.exe `
  apps/desktop/release/<version>/apk-batch-build-<version>-setup.exe.blockmap `
  apps/desktop/release/<version>/latest.yml `
  --title "v<version>" --notes "..."
```

The test for whether a version bump is warranted is "would a user notice this as an update", not how many files changed. Code that affects the built artifact means a bump and a fresh package; documentation alone does not.

## License

[MIT](LICENSE)
