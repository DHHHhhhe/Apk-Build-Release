import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backgroundForDark } from './theme'

/**
 * 窗口底色。
 *
 * Chromium 在首帧之前画的就是它，所以深色下给白色会闪一下白。
 * 值必须与 `styles/tokens.css` 里 `:root` 与 `.dark` 的 `--background` 一致 ——
 * 代码注释里写了「改了令牌就要同步这里」，这里就用令牌文件把它钉住，
 * 免得哪天只改了 CSS，首帧又开始闪。
 */
const tokensPath = join(__dirname, '..', 'renderer', 'src', 'styles', 'tokens.css')

function tokenBackground(selector: string): string | null {
  const css = readFileSync(tokensPath, 'utf8')
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)
  if (!block || !block[1]) {
    return null
  }
  const match = /--background:\s*([^;]+);/.exec(block[1])
  return match && match[1] ? match[1].trim().toLowerCase() : null
}

describe('窗口底色', () => {
  it('深色给深底、浅色给浅底', () => {
    expect(backgroundForDark(true)).not.toBe(backgroundForDark(false))
    expect(backgroundForDark(true)).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('与 tokens.css 的 --background 一致（令牌改了这里没改，首帧就会闪）', () => {
    expect(backgroundForDark(false).toLowerCase()).toBe(tokenBackground(':root'))
    expect(backgroundForDark(true).toLowerCase()).toBe(tokenBackground('\\.dark'))
  })
})