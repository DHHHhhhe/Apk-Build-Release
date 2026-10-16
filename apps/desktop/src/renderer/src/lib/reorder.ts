/**
 * 长按拖拽排序的纯算法部分。
 *
 * 拖拽本身依赖 DOM 与指针事件（在 node 环境里跑不了），所以这里只留两件能单独测的事：
 * ① 把某一项从原位搬到目标下标；② 由指针位置算出该落到第几位。
 */
export function moveItemTo<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) {
    return items
  }
  const clamped = Math.max(0, Math.min(items.length - 1, toIndex))
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (moved === undefined) {
    return items
  }
  next.splice(clamped, 0, moved)
  return next
}

/**
 * 指针落在第几位：给出各项的竖直中点（按当前渲染顺序）与指针 Y。
 *
 * 判据是「指针越过了哪几项的中点」—— 越过第 i 项中点就该排到它后面。
 * 用中点而不是项边界：停在两项的缝隙上时，用边界判会反复跨过、列表来回闪。
 */
export function indexForPointer(midpoints: number[], pointerY: number): number {
  let index = 0
  for (const mid of midpoints) {
    if (pointerY > mid) {
      index += 1
    }
  }
  return index
}