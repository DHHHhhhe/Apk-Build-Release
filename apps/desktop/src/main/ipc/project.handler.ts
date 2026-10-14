import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { addProject } from '../services/project/procedures/add'
import { listProjects } from '../services/project/procedures/list'
import { pickProjectDirectory } from '../services/project/procedures/pick-directory'
import { refreshProjectVariants } from '../services/project/procedures/refresh-variants'
import { removeProject } from '../services/project/procedures/remove'
import { setProjectVariants } from '../services/project/procedures/set-variants'

export function setupProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT.LIST, () => listProjects())
  ipcMain.handle(IPC_CHANNELS.PROJECT.ADD, (_event, input: unknown) => addProject(input))
  ipcMain.handle(IPC_CHANNELS.PROJECT.REMOVE, (_event, input: unknown) => removeProject(input))
  ipcMain.handle(IPC_CHANNELS.PROJECT.REFRESH_VARIANTS, (_event, input: unknown) =>
    refreshProjectVariants(input)
  )
  ipcMain.handle(IPC_CHANNELS.PROJECT.SET_VARIANTS, (_event, input: unknown) =>
    setProjectVariants(input)
  )
  ipcMain.handle(IPC_CHANNELS.PROJECT.PICK_DIRECTORY, () => pickProjectDirectory())
}
