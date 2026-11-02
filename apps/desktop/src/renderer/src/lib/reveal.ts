/**
 * 把「刚加进来的那一项」滚进可视区所需的 scrollTop。
 *
 * 为什么不直接 scrollIntoView：它会连带滚动所有可滚祖先（侧栏、外层布局），
 * 而这个列表只有一个自己的滚动容器，滚别的层等于把整个界面推歪。
 * 这里只算一个数字，由调用方写到那一个容器上。
 *
 * 已经完整可见时返回原来的 scrollTop（不做任何位移，避免「加一项整列跳一下」）。
 */
export function scrollTopToReveal(input: {
  /** 目标项相对视口的上下边 */
  itemTop: number
  itemBottom: number
  /** 滚动容器（可视框）相对视口的上下边 */
  boxTop: number
  boxBottom: number
  scrollTop: number
  /** 容器的最大可滚距离（scrollHeight - clientHeight），用来夹住结果 */
  maxScrollTop: number
  /** 贴边留白：不留的话刚滚到位的那一项会紧贴容器边缘 */
  padding?: number
}): number {
  const padding = Math.max(0, input.padding ?? 0)
  const clamp = (value: number): number => Math.max(0, Math.min(input.maxScrollTop, value))

  if (input.itemTop < input.boxTop + padding) {
    return clamp(input.scrollTop - (input.boxTop + padding - input.itemTop))
  }
  if (input.itemBottom > input.boxBottom - padding) {
    return clamp(input.scrollTop + (input.itemBottom - (input.boxBottom - padding)))
  }
  return clamp(input.scrollTop)
}
