/**
 * 拖动过程中的「预览顺序」。
 *
 * 以前只在 onDrop 时提交新顺序，拖动过程中列表纹丝不动 —— 看不出会插到哪儿。
 * 这里把「把 draggedId 插到 overId 的位置」这一步单独抽出来，
 * 让 onDragOver 期间就能实时重排（提交仍然只在 drop 时发生）。
 */
export function previewReorder<T extends { id: string }>(
  items: T[],
  draggedId: string | null,
  overId: string | null
): T[] {
  if (draggedId === null || overId === null || draggedId === overId) {
    return items
  }
  const dragged = items.find((item) => item.id === draggedId)
  if (dragged === undefined) {
    return items
  }
  const rest = items.filter((item) => item.id !== draggedId)
  const at = rest.findIndex((item) => item.id === overId)
  if (at < 0) {
    return items
  }
  return [...rest.slice(0, at), dragged, ...rest.slice(at)]
}