import { app } from 'electron'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { settings } from '../../../db/schema'
import { themeChoiceSchema } from '../../settings/types'
import type { ThemeChoice } from '../../settings/types'

export const OUTPUT_ROOT_KEY = 'output.root'
export const THEME_KEY = 'theme'

/** 主题档位：没设过、或者存量的值非法（被改坏、旧版本写的）都退回「跟随系统」 */
export function getThemeChoice(): ThemeChoice {
  const row = db.select().from(settings).where(eq(settings.key, THEME_KEY)).get()
  const parsed = themeChoiceSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : 'system'
}

export function setThemeChoice(choice: ThemeChoice): void {
  upsertSetting(THEME_KEY, choice)
}

export const AUTO_CHECK_UPDATE_KEY = 'update.autoCheck'

/** 启动后是否自动查更新。默认开 —— 装了新版却一直不知道，比偶尔多查一次更麻烦 */
export function getAutoCheckUpdate(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, AUTO_CHECK_UPDATE_KEY)).get()
  return row?.value !== 'false'
}

export function setAutoCheckUpdate(enabled: boolean): void {
  upsertSetting(AUTO_CHECK_UPDATE_KEY, String(enabled))
}

/** 统一输出目录：用户没设过就用「文档/APK批量打包」 */
export function getOutputRoot(): string {
  const row = db.select().from(settings).where(eq(settings.key, OUTPUT_ROOT_KEY)).get()
  if (row && row.value.trim() !== '') {
    return row.value
  }
  return defaultOutputRoot()
}

export function setOutputRoot(dir: string): void {
  const trimmed = dir.trim()
  if (trimmed === '') {
    return
  }
  upsertSetting(OUTPUT_ROOT_KEY, trimmed)
}

export function getSettingNumber(key: string, fallback: number): number {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  const parsed = row ? Number.parseInt(row.value, 10) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export function setSettingNumber(key: string, value: number): void {
  upsertSetting(key, String(value))
}

function upsertSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run()
}

function defaultOutputRoot(): string {
  return join(app.getPath('documents'), 'APK批量打包')
}
