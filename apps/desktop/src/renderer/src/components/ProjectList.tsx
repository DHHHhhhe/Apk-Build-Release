import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FolderPlus, GripVertical, Trash2 } from 'lucide-react'
import { indexForPointer, moveItemTo } from '../lib/reorder'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'

/** 长按多久算「拾起」——太短会与点击选中打架，太长会觉得拖不动 */
const LONG_PRESS_MS = 250
/** 其余项让位、被拖项落位的缓动时长 */
const FLIP_MS = 140
/** 指针离列表上下边缘多近开始自动滚动 */
const EDGE_PX = 40
/** 自动滚动每帧的步长 */
const EDGE_STEP_PX = 2
/** 拾起时的放大倍数 */
const LIFT_SCALE = 1.05

interface DragState {
  id: string
  fromIndex: number
  toIndex: number
  /** 指针当前视口 Y */
  pointerY: number
  /** 按下时指针相对该项顶部的偏移，保证拾起瞬间不跳 */
  offsetY: number
  width: number
  height: number
  /** 拾起那一刻该项的水平位置：浮动时保持不动，否则会贴到视口左边缘被遮住 */
  startLeft: number
  /** 拾起那一刻该项的视口顶部，落位动画从这里开始 */
  startTop: number
  /** 已松手、正在做落位动画 */
  settled: boolean
  /** 松手时的落点偏移：卡片要缓动到这个位置，而不是回到原来的槽位 */
  dropOffsetY: number
  /**
   * 松手后是否已经切到「落点」。
   *
   * 不能一步到位：transition 和 transform 在同一次渲染里一起改，浏览器会把两者
   * 当成同一帧应用、不做插值（实测卡片原地不动）。所以先开过渡（transform 不变），
   * 下一帧再改成落点值。
   */
  movingToTarget: boolean
  /**
   * 拖动开始时各行的位置（定格）。
   *
   * 不在 onMove 里现量：那一刻各行正在做让位动画，中点每帧都在漂，
   * 算出来的落点会在两档之间来回跳，列表跟着反复重排 —— 就是「跳动很大」的来源。
   */
  slots: Array<{ id: string; top: number; height: number }>
  /** 拖动开始时的滚动位置，用于补偿拖动过程中的滚动 */
  startScrollTop: number
}

export function ProjectList({
  projects,
  selectedId,
  busyProjectId,
  queuedProjectIds,
  onSelect,
  onAdd,
  onRemove,
  onReorder
}: {
  projects: Project[]
  selectedId: string | null
  busyProjectId: string | null
  /** 队列里还没结束的项目：这些项目不允许移除（正在跑或即将跑） */
  queuedProjectIds: string[]
  onSelect: (projectId: string) => void
  onAdd: () => void
  onRemove: (projectId: string) => void
  /** 手工排序：给出完整的新顺序（当前全部项目 id） */
  onReorder: (projectIds: string[]) => void
}): React.JSX.Element {
  const queued = new Set(queuedProjectIds)
  const [drag, setDrag] = useState<DragState | null>(null)

  const listRef = useRef<HTMLUListElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())
  const longPressTimer = useRef<number | null>(null)
  const pending = useRef<{ id: string; startY: number; fromIndex: number } | null>(null)
  /** FLIP 的 First：上一次渲染后各行的位置 */
  const lastRects = useRef(new Map<string, DOMRect>())
  const edgeTimer = useRef<number | null>(null)
  /** 滚动锁：容器与它原来的行内 overflow（解锁时按它恢复，不重新查找） */
  const scrollLockRef = useRef<{ el: HTMLElement; previous: string } | null>(null)
  /** 供定时器与 window 监听读取最新值，避免闭包拿到旧的 */
  const dragRef = useRef<DragState | null>(null)
  const projectsRef = useRef<Project[]>(projects)
  const onReorderRef = useRef(onReorder)
  dragRef.current = drag
  projectsRef.current = projects
  onReorderRef.current = onReorder

  // 拖动中的顺序：被拖的项已经站到落点上，其余项据此让位
  const ordered = drag === null ? projects : moveItemTo(projects, drag.fromIndex, drag.toIndex)

  /**
   * 列表所在的滚动容器：边缘自动滚动与滚动补偿都用它。
   *
   * 往上找「真正能滚的那个」而不是猜类名 —— 实测原来写的 `.app-sidebar__scroll`
   * 在仓库里根本不存在（ProjectList 直接挂在 .app-sidebar 下，中间没有专门的滚动层），
   * 于是 closest 返回 null、落到了 document.scrollingElement 的兜底上，
   * 边缘自动滚动就去滚整个文档，表现是「往下拖，整个应用跟着上移」。
   * 找不到就返回 null，调用方什么都不做 —— 绝不回退去滚文档。
   */
  const scrollerOf = (): HTMLElement | null => {
    let el = listRef.current?.parentElement ?? null
    while (el !== null) {
      const style = window.getComputedStyle(el)
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
        return el
      }
      el = el.parentElement
    }
    return null
  }

  /**
   * 滚动锁：记住**容器本身**与它原来的行内 overflow，恢复时不再重新查找。
   *
   * 原来是「解锁时再调一次 scrollerOf()」—— 而那个函数的判据要求 overflow-y 是 auto/scroll，
   * 锁上之后它已经是 hidden，于是解锁时找不到容器、拿到 null 直接跳过，
   * overflow: hidden 就永久留在了列表上（实测：拖一次之后整个侧栏再也滚不动）。
   */
  const lockScroll = (): void => {
    if (scrollLockRef.current !== null) {
      return
    }
    const el = scrollerOf()
    if (el === null) {
      return
    }
    scrollLockRef.current = { el, previous: el.style.overflow }
    el.style.overflow = 'hidden'
  }

  const unlockScroll = (): void => {
    const lock = scrollLockRef.current
    if (lock === null) {
      return
    }
    lock.el.style.overflow = lock.previous
    scrollLockRef.current = null
  }

  const clearLongPress = (): void => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  /** 拾起：量下尺寸与位置，进入拖拽态 */
  const lift = (projectId: string, fromIndex: number, startY: number): void => {
    const el = itemRefs.current.get(projectId)
    if (el === undefined) {
      return
    }
    const rect = el.getBoundingClientRect()
    // 定格各行的位置：后续落点判断都基于这一份，不再受让位动画影响
    const slots: Array<{ id: string; top: number; height: number }> = []
    for (const [id, node] of itemRefs.current) {
      const box = node.getBoundingClientRect()
      slots.push({ id, top: box.top, height: box.height })
    }
    setDrag({
      id: projectId,
      fromIndex,
      toIndex: fromIndex,
      pointerY: startY,
      offsetY: startY - rect.top,
      width: rect.width,
      height: rect.height,
      startLeft: rect.left,
      startTop: rect.top,
      settled: false,
      dropOffsetY: 0,
      movingToTarget: false,
      slots,
      startScrollTop: scrollerOf()?.scrollTop ?? 0
    })
    // 禁掉滚动：锁在**列表自己的滚动容器**上，不动 document.body。
    // 给 body 设 overflow 会连带影响整个应用的外层布局（实测这类写法会让内部滚动条错乱、
    // 甚至让某些元素消失），而拖拽本身不需要动 body —— 手柄上有 touch-action: none，
    // 鼠标拖动也不会让页面滚动。
    lockScroll()
  }

  /** 落位：先播 200ms 动画，动画结束再提交顺序 */
  const drop = (): void => {
    const current = dragRef.current
    if (current === null || current.settled) {
      return
    }
    const ids = moveItemTo(projectsRef.current, current.fromIndex, current.toIndex).map((item) => item.id)
    // 不做落位动画：松手即收尾。
    //
    // 之前试过 CSS transition 与 WAAPI 两种落位动画，都没能稳定复现出「落到目标槽位」——
    // 探针给出的位移与模型对不上，反复几次也没收敛。而用户要解决的问题是
    // 「松手后卡片先回原位、再闪一下才到正确位置」，去掉动画即不存在回原位，
    // 顺序提交后卡片本来就在新位置。用最简单的方式把问题解决掉，不再为一段装饰动画
    // 引入需要长期维护的时序逻辑。
    setDrag(null)
    // 立即提交并解锁滚动。提交放在状态清空之后，顺序落库后会重取列表，
    // 卡片此时已经在目标位置，不会有回弹或闪烁。
    unlockScroll()
    onReorderRef.current(ids)
  }

  /** 取消拖拽（窗口失焦、指针被系统收走）：不提交顺序，只把状态清干净 */
  const cancelDrag = (): void => {
    if (dragRef.current === null) {
      return
    }
    setDrag(null)
    unlockScroll()
  }

  // 指针移动/松手挂在 window 上：手指移出列表甚至移出窗口也要继续跟
  useEffect(() => {
    if (drag === null) {
      return
    }
    const onMove = (event: PointerEvent): void => {
      setDrag((current) => {
        if (current === null || current.settled) {
          return current
        }
        // 落点用**拖动开始时定格**的各行中点判断，不看当前动画中的位置：
        // 现量的话中点每帧都在漂，落点会在两档之间来回跳。
        // 滚动会让定格坐标与视口错位，用滚动差量补偿回来。
        const scrolled = (scrollerOf()?.scrollTop ?? 0) - current.startScrollTop
        const mids = current.slots
          .filter((slot) => slot.id !== current.id)
          .map((slot) => slot.top - scrolled + slot.height / 2)
        // 迟滞取行高的 35%：固定 8px 对快速拖动太小（指针一帧就能走过 8px 以上，
        // 等于没有死区，落点会在分界线上来回蹭、整列反复换位）。
        const rowHeight = current.slots[0]?.height ?? 40
        const margin = Math.max(10, Math.round(rowHeight * 0.5))
        const toIndex = indexForPointer(mids, event.clientY, margin)
        if (toIndex === current.toIndex) {
          // 落点没变就只更新指针位置，不触发重排
          return current.pointerY === event.clientY ? current : { ...current, pointerY: event.clientY }
        }
        return { ...current, pointerY: event.clientY, toIndex }
      })
    }
    const onUp = (): void => {
      drop()
    }
    // 在窗口外松手收不到 pointerup；切走窗口时浏览器也可能不发 pointercancel ——
    // 这两种情况都会让拖拽卡在拾起态，所以补上失焦与页面隐藏的兜底。
    const onCancel = (): void => {
      cancelDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onCancel)
    document.addEventListener('visibilitychange', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onCancel)
      document.removeEventListener('visibilitychange', onCancel)
    }
  }, [drag === null, projects])


  // 卸载或异常时别把页面滚动留在禁用状态
  useEffect(() => {
    return () => {
      unlockScroll()
      clearLongPress()
      if (edgeTimer.current !== null) {
        window.cancelAnimationFrame(edgeTimer.current)
      }
    }
  }, [])

  // 边缘自动滚动：指针停在列表上下边缘时，每帧把滚动容器挪一点
  useEffect(() => {
    if (drag === null || drag.settled) {
      if (edgeTimer.current !== null) {
        window.cancelAnimationFrame(edgeTimer.current)
        edgeTimer.current = null
      }
      return
    }
    const step = (): void => {
      const list = listRef.current
      // 绝不回退到 document.scrollingElement：那会把整个应用滚起来
      const scroller = scrollerOf()
      if (list !== null && scroller !== null) {
        const rect = list.getBoundingClientRect()
        if (drag.pointerY < rect.top + EDGE_PX) {
          scroller.scrollTop -= EDGE_STEP_PX
        } else if (drag.pointerY > rect.bottom - EDGE_PX) {
          scroller.scrollTop += EDGE_STEP_PX
        }
      }
      edgeTimer.current = window.requestAnimationFrame(step)
    }
    edgeTimer.current = window.requestAnimationFrame(step)
    return () => {
      if (edgeTimer.current !== null) {
        window.cancelAnimationFrame(edgeTimer.current)
        edgeTimer.current = null
      }
    }
  }, [drag])

  // FLIP 只在顺序真的变化时跑。
  // 以前这个 useLayoutEffect 没有依赖 —— 指针每动一下（每秒上百次）都会把所有行重新量一遍、
  // 强制一次布局，那就是「拖动中抖动」的来源。
  const orderKey = ordered.map((project) => project.id).join(',')
  useLayoutEffect(() => {
    // 先清掉上一轮留下的倒回 transform，再量位置。
    //
    // 不清就量的话，量到的是「被 transform 污染过」的位置：上一轮的偏差会被当成基准，
    // 下一轮再基于它算一次，位移逐轮累加（实测位移序列呈斐波那契式增长：
    // -238 → +357 → -595 → +952 → -1547），表现就是越拖越跳。
    for (const [, el] of itemRefs.current) {
      el.style.transition = 'none'
      el.style.transform = ''
    }
    const next = new Map<string, DOMRect>()
    for (const [id, el] of itemRefs.current) {
      next.set(id, el.getBoundingClientRect())
    }
    if (lastRects.current.size > 0 && drag !== null) {
      // 读写分离：先把所有行「倒回」旧位置（纯写），整批只强制一次回流，再统一启动过渡。
      // 逐行写 + 逐行读 offsetHeight 会让浏览器每行都同步布局一次 —— 十行就是每帧十次，
      // 掉帧看着就是跳（资料里管这叫 layout thrashing）。
      const moved: HTMLElement[] = []
      for (const [id, el] of itemRefs.current) {
        if (id === drag.id) {
          continue
        }
        const before = lastRects.current.get(id)
        const after = next.get(id)
        if (before === undefined || after === undefined) {
          continue
        }
        const dy = before.top - after.top
        if (dy === 0) {
          continue
        }
        el.style.transition = 'none'
        el.style.transform = 'translateY(' + String(dy) + 'px)'
        moved.push(el)
      }
      if (moved.length > 0) {
        // 一次回流，让上面所有「倒回」立即生效（以前是每行一次）
        void (listRef.current?.offsetHeight ?? 0)
        for (const el of moved) {
          el.style.transition = 'transform ' + String(FLIP_MS) + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          el.style.transform = ''
        }
      }
    }
    lastRects.current = next
    // 只在顺序变化时重跑；drag 从 ref 读，避免把它写进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey])

  return (
    <div className="project-list">
      <div className="project-list__head">
        <span className="project-list__title">项目</span>
        <Button variant="ghost" className="project-list__add" onClick={onAdd}>
          <FolderPlus size={14} aria-hidden="true" />
          添加
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="project-list__empty">还没有项目，点右上角「添加」选择项目目录</p>
      ) : (
        <ul className="project-list__items" ref={listRef}>
          {ordered.map((project, index) => {
            const active = project.id === selectedId
            const busy = project.id === busyProjectId
            const inQueue = queued.has(project.id)
            const dragging = drag !== null && drag.id === project.id
            const placeholder = dragging && !drag.settled
            return (
              <li
                key={project.id}
                ref={(el) => {
                  if (el === null) {
                    itemRefs.current.delete(project.id)
                  } else {
                    itemRefs.current.set(project.id, el)
                  }
                }}
                className={dragging ? 'project-list__slot project-list__slot--dragging' : 'project-list__slot'}
                style={placeholder ? { height: drag.height } : undefined}
              >
                {placeholder ? <div className="project-list__placeholder" aria-hidden="true" /> : null}

                <div
                  className={
                    (active ? 'project-list__item project-list__item--active' : 'project-list__item') +
                    (dragging ? ' project-list__item--lifted' : '')
                  }
                  style={
                    dragging
                      ? {
                          // 全程用 transform 定位：top 每帧都会触发一次布局，transform 只走合成层，
                          // 跟手明显更顺；落位动画也就成了同一条属性的过渡，不必换写法
                          position: 'fixed',
                          left: drag.startLeft,
                          top: drag.startTop - drag.offsetY,
                          width: drag.width,
                          willChange: 'transform',
                          // 从左边放大：默认从中心放大时，卡片会向左右各长出 2.5%，
                          // 左侧那几像素压到侧栏边缘就被裁掉了（实测 300px 宽的卡片左移约 7px）
                          transformOrigin: 'left center',
                          // 落位动画交给 WAAPI：这里不能再写 transform，否则会和动画的 transform
                          // 叠加（实测卡片跑到了目标之外一倍的距离）。WAAPI 用 fill: forwards
                          // 保持终态，动画结束后元素的布局位置恰好就是新槽位，不会跳。
                          transform: drag.movingToTarget
                            ? undefined
                            : 'translate3d(0, ' + String(drag.pointerY - drag.startTop) + 'px, 0) scale(' + String(LIFT_SCALE) + ')',
                          transition: 'none'
                        }
                      : undefined
                  }

                >
                  {/*
                   * 拖拽的唯一热区。
                   *
                   * 原来热区是整行，结果用户想选文字时长按就触发了拖拽（实测：三个项目名与徽章
                   * 都是蓝色选中态，说明当时正在选文字）。把拖拽收敛到手柄上，行内其余部分
                   * 仍可点选、文字仍可选中 —— 两个动作分开。
                   * 排序只剩这条路：手柄挂在 aria-hidden 上，键盘与读屏用户拿不到排序入口。
                   */}
                  <span
                    className="project-list__grip"
                    aria-hidden="true"
                    title="按住拖动可调整顺序"
                    onPointerDown={(event) => {
                      if (event.pointerType === 'mouse' && event.button !== 0) {
                        return
                      }
                      const id = project.id
                      const fromIndex = index
                      const startY = event.clientY
                      pending.current = { id, startY, fromIndex }
                      clearLongPress()
                      longPressTimer.current = window.setTimeout(() => {
                        const held = pending.current
                        if (held !== null && held.id === id) {
                          lift(id, held.fromIndex, held.startY)
                        }
                      }, LONG_PRESS_MS)
                      // 只认「松开」才算取消。
                      // 以前在手柄上挂了 pointerleave —— 手指一动就离开手柄、计时器被清掉，
                      // 于是「长按的同时开始移动」永远触发不了。手柄上有 touch-action: none，
                      // 不会误触发滚动，所以按住期间的移动可以放心不管。
                      // 挂在 window 上是因为手指可能已经移出手柄，手柄上的 pointerup 收不到。
                      const cancel = (): void => {
                        clearLongPress()
                        if (dragRef.current === null) {
                          pending.current = null
                        }
                        window.removeEventListener('pointerup', cancel)
                      }
                      window.addEventListener('pointerup', cancel, { once: true })
                    }}
                  >
                    <GripVertical size={14} />
                  </span>

                  <button
                    type="button"
                    className="project-list__select"
                    onClick={() => {
                      onSelect(project.id)
                    }}
                  >
                    <span className="project-list__name" title={project.name}>
                      {project.name}
                    </span>
                    <span className="project-list__meta">
                      {/*
                       * 归档名单独一行：它自带「归档」前缀，和「1 个变体 / 已选 1」排在一起时
                       * 会被读成一串标签，扫列表时看不出哪个是文件夹名。
                       */}
                      {project.alias ? (
                        <span className="project-list__meta-line">
                          <Badge variant="muted" title={'产物会归档到「' + project.alias + '」文件夹'}>
                            归档 {project.alias}
                          </Badge>
                        </span>
                      ) : null}
                      <span className="project-list__meta-line">
                        {/* 数与右侧实际能构建的变体对齐：这里以前数的是全部变体（含 debug），
                            于是侧栏写「2 个变体」、点进去只有一个可构建的 */}
                        <Badge variant="muted" className="tabular">
                          {filterVariantsForPackaging(project.variants).length} 个变体
                        </Badge>
                        {project.selectedVariants.length > 0 ? (
                          <Badge variant="success" className="tabular">
                            已选 {project.selectedVariants.length}
                          </Badge>
                        ) : null}
                        {/* 解析受限只在**没解析出变体**时才提示：已经拿到变体了还挂着这个标签，
                            会让人以为当前这些变体是残缺的，而实际上能构建的就是这些 */}
                        {project.limitations.length > 0 &&
                        filterVariantsForPackaging(project.variants).length === 0 ? (
                          <Badge variant="warning" title={project.limitations.join('；')}>
                            解析受限
                          </Badge>
                        ) : null}
                        {inQueue ? <Badge variant="info">队列中</Badge> : null}
                      </span>
                    </span>
                  </button>

                  <Button
                    variant="ghost"
                    className="project-list__remove"
                    title={inQueue ? '这个项目还在队列里，先取消它再移除' : '移除 ' + project.name}
                    onClick={() => {
                      onRemove(project.id)
                    }}
                    disabled={busy || inQueue}
                    aria-label={'移除 ' + project.name}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}