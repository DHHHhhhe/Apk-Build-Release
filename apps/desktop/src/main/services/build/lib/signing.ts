import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { planSpawn } from '../../../lib/gradle-paths'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('build:signing')

export interface SignatureCheck {
  /** true = 已签名；false = 验证不通过（未签名或签名无效）；null = 没验证（缺 apksigner） */
  signed: boolean | null
  /** 给用户看的一句话 */
  detail: string | null
}

/**
 * 在 SDK 的 build-tools 里找 apksigner，取版本号最大的那个。
 * 目录名形如 34.0.0 / 36.0.0-rc1，按数字段比较，避免字符串排序把 9.0.0 排到 34.0.0 后面。
 */
export function findApksigner(sdkDir: string): string | null {
  const buildToolsDir = join(sdkDir, 'build-tools')
  if (!existsSync(buildToolsDir)) {
    return null
  }

  let versions: string[]
  try {
    versions = readdirSync(buildToolsDir)
  } catch {
    return null
  }

  const candidates = versions
    .filter((version) => {
      const dir = join(buildToolsDir, version)
      return existsSync(join(dir, 'apksigner.bat')) || existsSync(join(dir, 'apksigner'))
    })
    .sort(compareVersionsDesc)

  const latest = candidates[0]
  if (!latest) {
    return null
  }

  const dir = join(buildToolsDir, latest)
  const batch = join(dir, 'apksigner.bat')
  return existsSync(batch) ? batch : join(dir, 'apksigner')
}

export function compareVersionsDesc(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const a = Number.isFinite(leftParts[index]) ? (leftParts[index] ?? 0) : 0
    const b = Number.isFinite(rightParts[index]) ? (rightParts[index] ?? 0) : 0
    if (a !== b) {
      return b - a
    }
  }
  return 0
}

/**
 * 证书 DN 的标签在不同 build-tools 版本里不一样：
 *   旧版：`Signer #1 certificate DN: CN=...`
 *   37.0.0：`V2 Signer: certificate DN: OU=..., CN=...`
 * 所以两种都认，认不出来就只说「已签名」。
 */
export function describeSigner(output: string): string {
  const match = /Signer(?:\s*#\d+)?:?\s*certificate DN:\s*(.+)/i.exec(output)
  const dn = match?.[1]?.trim()
  if (!dn) {
    return '已签名'
  }
  return `已签名：${dn.slice(0, 80)}`
}

export interface VerifyOptions {
  apkPath: string
  /** 项目目录，用于解析该项目的 SDK 位置 */
  sdkDir: string | null
  timeoutMs?: number
}

/**
 * 用 apksigner 验证签名。
 * 退出码 0 = 验证通过，1 = DOES NOT VERIFY（未签名或签名无效）；找不到 apksigner 时返回 null 表示「未验证」。
 */
export function verifyApkSignature(options: VerifyOptions): Promise<SignatureCheck> {
  const apksigner = options.sdkDir ? findApksigner(options.sdkDir) : null
  if (!apksigner) {
    return Promise.resolve({
      signed: null,
      detail: '没找到 apksigner（SDK 的 build-tools 里没有），签名状态未验证'
    })
  }

  const timeoutMs = options.timeoutMs ?? 60_000

  return new Promise<SignatureCheck>((resolve) => {
    const plan = planSpawn(apksigner, ['verify', '--print-certs', options.apkPath], dirname(options.apkPath))
    const child = spawn(plan.command, plan.args, plan.options)

    let output = ''
    let settled = false

    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })

    const finish = (check: SignatureCheck): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(check)
    }

    child.on('error', (error) => {
      logger.warn('apksigner 执行失败', { error: error.message })
      finish({ signed: null, detail: `apksigner 执行失败：${error.message}` })
    })

    child.on('close', (code) => {
      if (code === 0) {
        finish({ signed: true, detail: describeSigner(output) })
        return
      }
      if (/DOES NOT VERIFY/i.test(output)) {
        finish({ signed: false, detail: '未签名或签名无效，不能直接安装' })
        return
      }
      finish({ signed: null, detail: `apksigner 返回 ${String(code)}，签名状态未确认` })
    })
  })
}
