/**
 * 变体构建记录的展示顺序。
 *
 * 踩过的坑：以前只按 `started_at` 排。同一毫秒建出来的 run 谁在前是不确定的，
 * 于是每次推送快照、列表里的变体顺序都可能变一次（用户看到的就是「顺序跳动」）；
 * 重试只补失败变体时，新建的 run 还会因为时间戳更新而跑到最后。
 *
 * 改成**按用户勾选变体的顺序**排 —— 那个顺序在入队时就写进了队列项，是稳定的，
 * 也与界面上看到的勾选顺序一致。
 */
export function sortRunsByDeclaredOrder<T extends { variant: string; startedAt: number | null }>(
  runs: T[],
  declared: string[]
): T[] {
  const rank = new Map(declared.map((name, index) => [name, index]))
  return [...runs].sort((left, right) => {
    const leftRank = rank.get(left.variant) ?? Number.MAX_SAFE_INTEGER
    const rightRank = rank.get(right.variant) ?? Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    // 不在声明列表里的（例如重试时用了不同的变体集）：退回开始时间，再按名字兜底，保证稳定。
    // startedAt 可能为 null（还没开始跑），排在有时间的后面。
    const leftAt = left.startedAt ?? Number.MAX_SAFE_INTEGER
    const rightAt = right.startedAt ?? Number.MAX_SAFE_INTEGER
    if (leftAt !== rightAt) {
      return leftAt - rightAt
    }
    return left.variant.localeCompare(right.variant)
  })
}