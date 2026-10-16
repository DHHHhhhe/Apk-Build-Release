import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { ensureSchema } from './db/client'
import { setupIpcHandlers } from './ipc'
import { killAllRunning } from './services/queue/lib/cancel'
import { countPending, countRunning } from './services/queue/lib/items'
import { pauseQueue, recoverStale, tick } from './services/queue/lib/scheduler'
import { initUpdater } from './services/update/updater'
import { logger } from './services/logger'
import { currentBackgroundColor, initTheme } from './theme'

/** 用户已经确认过「关闭并中断」，再关就别拦了 */
let quitConfirmed = false

// 渲染进程只做界面，所有 IO 与进程操作留在主进程（design.md §2）
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    // 跟随主题的窗口底色：Chromium 在首帧之前画的就是它，深色下给白色会闪一下
    backgroundColor: currentBackgroundColor(),
    // 打包后任务栏图标取自 exe 内嵌的图标（electron-builder 从 build/icon.png 生成）；
    // 开发期 exe 是 Electron 自己的，得显式指一份，否则任务栏显示 Electron 默认图标
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  /*
   * 构建中关窗先问一句。
   *
   * 关窗即退出，而退出会把正在跑的构建掐掉（before-quit → killAllRunning），
   * 已经跑掉的那几分钟就白费了 —— 而且不会自动续跑。所以只要队列里还有项没结束，
   * 就用系统对话框说清会中断几项，让用户自己决定。
   *
   * 用同步对话框：close 事件里必须当场决定要不要 preventDefault。
   */
  win.on('close', (event) => {
    if (quitConfirmed) {
      return
    }
    const running = countRunning()
    const pending = countPending()
    if (running + pending === 0) {
      return
    }
    event.preventDefault()
    const parts: string[] = []
    if (running > 0) {
      parts.push(`${running} 个正在构建`)
    }
    if (pending > 0) {
      parts.push(`${pending} 个还在排队`)
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['继续构建', '关闭并中断'],
      defaultId: 0,
      cancelId: 0,
      title: '还有构建没结束',
      message: `队列里还有 ${parts.join('、')}，关闭会中断它们。`,
      detail: '被中断的构建会记成失败，下次打开不会自动续跑。'
    })
    if (choice === 1) {
      quitConfirmed = true
      app.quit()
    }
  })

  // 外链走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Windows 上系统通知需要 AppUserModelID 才能显示（打包后由安装包设置，开发期显式给一个）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.abr.desktop')
}

void app.whenReady().then(() => {
  ensureSchema()

  // 上次被强杀时留下的 running 项不可能再有人管，收尾成 failed 而不是一直转圈。
  // pending 项保留：它们还能跑，但不自动开跑 —— 一开应用就自己占满 CPU 不是用户要的，
  // 由界面上的「继续上次队列」交给用户决定。
  const recovered = recoverStale()
  if (recovered > 0) {
    logger.warn('已收尾上次残留的队列项', { count: recovered })
  }
  const leftover = countPending()
  if (leftover > 0) {
    pauseQueue()
    logger.info('有上次没跑的队列项，队列先停在暂停态', { pending: leftover })
  }

  setupIpcHandlers()
  // 主题要在建窗口之前定下来：窗口底色与渲染层的 prefers-color-scheme 都取决于它，
  // 晚一步就会先闪一帧浅色
  initTheme()
  // 更新检查延迟到启动之后，别和建窗口、读配置抢主线程
  initUpdater()
  logger.info('主进程就绪')
  createWindow()
  tick()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 退出时把还在跑的构建收掉，避免留下孤儿 java 进程
app.on('before-quit', () => {
  killAllRunning()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
