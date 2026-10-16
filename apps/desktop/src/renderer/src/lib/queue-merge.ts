import type { QueueItem } from '@shared/types/queue'

/**
 * 变更响应与事件推送合并。
 *
 * 踩过的坑：入队/取消这类操作返回的是**服务端那一刻的全量列表**，它是异步回来的。
 * 如果 `queue:state` 事件先到（比如某项已经变成 running），随后响应后到，
 * 无条件 `setItems(result.items)` 就会把新状态按回 pending —— 而且再也不会自己恢复，
 * 直到用户再点一次操作触发新的全量拉取。症状就是「队列显示排队中、详情显示构建中，
 * 取消任意一项才对齐」。
 *
 * 所以：**请求发出之后**收到过事件的项，以事件为准，响应里的那份不要覆盖它。
 *
 * @param previous  界面当前持有的列表
 * @param incoming  变更响应里的全量列表
 * @param staleIds  在本次请求期间被事件更新过的项 id（这些项保留 previous 里的版本）
 */
export function mergeQueueItems(
  previous: QueueItem[],
  incoming: QueueItem[],
  staleIds: ReadonlySet<string>
): QueueItem[] {
  if (staleIds.size === 0) {
    return incoming
  }

  const previousById = new Map(previous.map((item) => [item.id, item]))
  const merged = incoming.map((item) => previousById.get(item.id) ?? item)

  // 响应里没有、但事件刚刚推过来的项也要留着（例如刚入队就被推了状态）
  const incomingIds = new Set(incoming.map((item) => item.id))
  for (const item of previous) {
    if (staleIds.has(item.id) && !incomingIds.has(item.id)) {
      merged.push(item)
    }
  }

  return merged.sort((left, right) => right.enqueuedAt - left.enqueuedAt)
}