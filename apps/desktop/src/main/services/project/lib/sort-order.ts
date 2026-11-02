/**
 * 新项目的排序位：永远排在最后。
 *
 * 不能沿用「不写排序位、靠创建时间兜底」：`listProjects` 是 `ORDER BY sort_order ASC`，
 * 而 SQLite 把 NULL 排在最前 —— 于是新加的项目会插到列表最上面，用户找不到刚加的那个。
 *
 * 只要给一个「比现有所有排序位都大」的数字，新项目就一定落在末尾，两种历史数据都对：
 * ① 老库（全是 NULL）：NULL < 0，新项目拿 0 也在它们之后；
 * ② 已经手工排过（0..n-1）：拿 n，排在最后一项之后。
 */
export function nextSortOrder(existing: Array<number | null>): number {
  let max: number | null = null
  for (const value of existing) {
    if (value === null) {
      continue
    }
    if (max === null || value > max) {
      max = value
    }
  }
  // 全都没排过 → 0（NULL 在 SQLite 的 ASC 里排最前，所以 0 就在它们之后）
  return max === null ? 0 : max + 1
}
