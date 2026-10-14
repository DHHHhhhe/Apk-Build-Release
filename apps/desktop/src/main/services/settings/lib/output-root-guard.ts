import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * 把路径归一化成「可以直接比较」的形态：绝对化 → 去掉尾部斜杠 → 转小写。
 *
 * 转小写是必需的：Windows 的文件名不区分大小写，`C:\Repo` 与 `c:\repo` 是同一个地方。
 * 而 Node 的 `fs.realpath` 在文档里写明「在不区分大小写的文件系统上不做大小写转换」，
 * 所以不能指望它把大小写统一掉。
 */
export function canonicalize(target: string): string {
  const absolute = resolve(target)
  const trimmed = absolute.replace(/[\\/]+$/, '')
  // 盘根不能削：`C:\` 去掉尾分隔符会变成 `C:`，而 `C:` 在 Windows 上是「C 盘的当前目录」，
  // 与 `C:\` 不是一回事（Node 文档里专门讲过这个 per-drive working directory 行为）
  const normalized = trimmed === '' || /^[a-z]:$/i.test(trimmed) ? absolute : trimmed
  return normalized.toLowerCase()
}

/**
 * child 是否就在 parent 之内（含两者相同）。
 *
 * 用 `path.relative` 判断，而不是字符串前缀比较，也不是 `path.isAbsolute` 兜底 ——
 * Node 文档明确写了 `path.isAbsolute` **不能安全地用于防路径穿越**。
 * `relative` 的结果以 `..` 开头、或者仍是绝对路径，就说明不在里边。
 */
export function isInside(child: string, parent: string): boolean {
  const from = canonicalize(parent)
  const to = canonicalize(child)
  if (from === to) {
    return true
  }
  const rel = relative(from, to)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export type OutputRootCheck = { ok: true } | { ok: false; error: string }

/**
 * 统一输出目录不能落在 Git 仓库里。
 *
 * 为什么值得拦住：打出来的 APK 几十到上百 MB，`git add -A` 会顺手把它们提交进去，
 * 一旦进了历史就删不掉（要重写历史）；仓库里若还有打包流程，产物还会被打进安装包。
 * 光靠文档写一句「不要设在仓库里」是不够的 —— 这条规则以前就只是文档里的一句话。
 */
export function checkOutputRoot(options: { path: string; gitRoot: string | null }): OutputRootCheck {
  if (!options.gitRoot || !isInside(options.path, options.gitRoot)) {
    return { ok: true }
  }

  return {
    ok: false,
    error: `这个目录在 Git 仓库里（${options.gitRoot}）。打出来的 APK 会被一起提交，几十上百 MB 进了历史就删不掉，请换一个仓库外的目录。`
  }
}
