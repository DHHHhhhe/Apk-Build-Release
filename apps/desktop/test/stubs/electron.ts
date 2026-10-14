// 单测用的 electron 桩：只提供被测代码真正用到的部分
export const app = {
  isPackaged: false,
  getPath: (name: string): string => {
    if (name === 'userData') {
      return process.env.APK_BUILD_USER_DATA ?? process.cwd()
    }
    return process.cwd()
  },
  whenReady: async (): Promise<void> => undefined,
  on: (): void => undefined,
  quit: (): void => undefined
}

export const ipcMain = {
  handle: (): void => undefined
}

export const dialog = {
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: []
  })
}

export const BrowserWindow = {
  getFocusedWindow: (): null => null,
  getAllWindows: (): unknown[] => []
}

export const shell = {
  openExternal: async (): Promise<void> => undefined
}
