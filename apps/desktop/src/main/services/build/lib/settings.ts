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

export const SHOW_VARIANT_PROGRESS_KEY = 'ui.showVariantProgress'

/**
 * 队列面板是否显示变体构建进度条。默认开 —— 这是功能本身，
 * 只有明确关过的人才不显示（与 autoCheckUpdate 同一套「没写过按默认值」的判定）。
 */
export function getShowVariantProgress(): boolean {
  const row = db.select().from(settings).where(eq(settings.key, SHOW_VARIANT_PROGRESS_KEY)).get()
  return row?.value !== 'false'
}

export function setShowVariantProgress(enabled: boolean): void {
  upsertSetting(SHOW_VARIANT_PROGRESS_KEY, String(enabled))
}

export const LAST_RUN_VERSION_KEY = 'app.lastRunVersion'

/** 上次运行的版本号；从没写过就返回 null（首次安装，或从还不认识这个字段的旧版升上来） */
export function getLastRunVersion(): string | null {
  const row = db.select().from(settings).where(eq(settings.key, LAST_RUN_VERSION_KEY)).get()
  const value = row?.value.trim()
  return value ? value : null
}

export function setLastRunVersion(version: string): void {
  upsertSetting(LAST_RUN_VERSION_KEY, version)
}

/** 库里有没有任何一条设置 —— 用来区分「首次安装」与「从旧版升上来」 */
export function hasStoredSettings(): boolean {
  return db.select().from(settings).limit(1).all().length > 0
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
