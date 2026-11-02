/**
 * 长按拖拽排序的纯算法部分。
 *
 * 拖拽本身依赖 DOM 与指针事件（在 node 环境里跑不了），所以这里只留能单独测的部分：
 * ① 把某一项从原位搬到目标下标；② 由指针位置算出该落到第几位；
 * ③ 换位死区该取多大；④ 指针贴到可视区边缘时每帧滚多少。
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
export function indexForPointer(midpoints: number[], pointerY: number, margin = 0): number {
  let index = 0
  for (const mid of midpoints) {
    if (pointerY > mid + margin) {
      index += 1
    }
  }
  return index
}

/**
 * 换位死区：指针越过相邻项中点后再多走这么远，位次才翻。
 *
 * 原来取行高的 50%：90px 的行要拖 132px 才换一位（比一整行还远），
 * 表现就是「拖了半天没反应、一松手跳两格」。死区只需要吸收手指抖动，
 * 取行高的 10% 并夹在 4~10px：90px 的行约 9px，换位行程回到一整行以内。
 */
export function dragMargin(rowHeight: number): number {
  return Math.min(10, Math.max(4, Math.round(rowHeight * 0.1)))
}

/**
 * 指针落在滚动容器边缘区时，每帧该滚多少（负值向上，0 表示不滚）。
 *
 * 按「深入边缘区的比例」线性加速：刚进边缘区几乎不动，贴到边上才全速 ——
 * 固定步长要么慢到拖不动，要么一碰边就窜出去。
 */
export function edgeScrollStep(
  pointerY: number,
  box: { top: number; bottom: number },
  edgePx: number,
  maxStep: number
): number {
  if (edgePx <= 0 || maxStep <= 0) {
    return 0
  }
  if (pointerY < box.top + edgePx) {
    const depth = Math.min(1, (box.top + edgePx - pointerY) / edgePx)
    return -Math.max(1, Math.ceil(maxStep * depth))
  }
  if (pointerY > box.bottom - edgePx) {
    const depth = Math.min(1, (pointerY - (box.bottom - edgePx)) / edgePx)
    return Math.max(1, Math.ceil(maxStep * depth))
  }
  return 0
}
