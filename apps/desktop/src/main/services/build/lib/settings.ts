import { app } from 'electron'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { settings } from '../../../db/schema'

export const OUTPUT_ROOT_KEY = 'output.root'

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
