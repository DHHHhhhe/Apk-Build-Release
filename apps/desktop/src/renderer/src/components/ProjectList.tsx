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
const FLIP_MS = 200
/** 指针离列表上下边缘多近开始自动滚动 */
const EDGE_PX = 40
/** 自动滚动每帧的步长 */
const EDGE_STEP_PX = 8
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
  /** 拾起那一刻该项的视口顶部，落位动画从这里开始 */
  startTop: number
  /** 已松手、正在做落位动画 */
  settled: boolean
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
  /** 供定时器与 window 监听读取最新值，避免闭包拿到旧的 */
  const dragRef = useRef<DragState | null>(null)
  const projectsRef = useRef<Project[]>(projects)
  const onReorderRef = useRef(onReorder)
  dragRef.current = drag
  projectsRef.current = projects
  onReorderRef.current = onReorder

  // 拖动中的顺序：被拖的项已经站到落点上，其余项据此让位
  const ordered = drag === null ? projects : moveItemTo(projects, drag.fromIndex, drag.toIndex)

  /** 列表所在的滚动容器：边缘自动滚动与滚动补偿都用它 */
  const scrollerOf = (): HTMLElement | null => {
    const found = listRef.current?.closest('.app-sidebar__scroll')
    return found instanceof HTMLElement ? found : null
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
      startTop: rect.top,
      settled: false,
      slots,
      startScrollTop: scrollerOf()?.scrollTop ?? 0
    })
    // 进拖拽态后禁掉页面滚动，否则手指一动整页跟着跑
    document.body.style.overflow = 'hidden'
  }

  /** 落位：先播 200ms 动画，动画结束再提交顺序 */
  const drop = (): void => {
    const current = dragRef.current
    if (current === null || current.settled) {
      return
    }
    const ids = moveItemTo(projectsRef.current, current.fromIndex, current.toIndex).map((item) => item.id)
    setDrag({ ...current, settled: true })
    // 定时器直接开在这里，不放进 useEffect：
    // 那个 effect 的依赖里有 projects 与 onReorder，二者每次渲染都换新身份，
    // 于是每次渲染都会把定时器清掉重建，200ms 永远走不完 —— 拖拽会卡在拾起态出不来。
    window.setTimeout(() => {
      setDrag(null)
      document.body.style.overflow = ''
      onReorderRef.current(ids)
    }, FLIP_MS)
  }

  /** 取消拖拽（窗口失焦、指针被系统收走）：不提交顺序，只把状态清干净 */
  const cancelDrag = (): void => {
    if (dragRef.current === null) {
      return
    }
    setDrag(null)
    document.body.style.overflow = ''
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
        const toIndex = indexForPointer(mids, event.clientY)
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
      document.body.style.overflow = ''
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
      const scroller = list?.closest('.app-sidebar__scroll') ?? document.scrollingElement
      if (list !== null && scroller !== null && scroller !== undefined) {
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

  // FLIP：顺序变化后，其余项先从旧位置「倒回」再缓动到新位置，看着是让位而不是跳
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    for (const [id, el] of itemRefs.current) {
      next.set(id, el.getBoundingClientRect())
    }
    if (lastRects.current.size > 0 && drag !== null) {
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
        window.requestAnimationFrame(() => {
          el.style.transition = 'transform ' + String(FLIP_MS) + 'ms ease'
          el.style.transform = ''
        })
      }
    }
    lastRects.current = next
  })

  /** 把某个项目往前/往后挪一位，然后整份顺序交出去 */
  const move = (projectId: string, delta: -1 | 1): void => {
    const ids = projects.map((project) => project.id)
    const at = ids.indexOf(projectId)
    const current = ids[at]
    const swapped = ids[at + delta]
    if (at < 0 || current === undefined || swapped === undefined) {
      return
    }
    ids[at] = swapped
    ids[at + delta] = current
    onReorder(ids)
  }

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
                          left: 0,
                          top: drag.startTop - drag.offsetY,
                          width: drag.width,
                          willChange: 'transform',
                          transform: drag.settled
                            ? 'translate3d(0, 0, 0) scale(1)'
                            : 'translate3d(0, ' + String(drag.pointerY - drag.startTop) + 'px, 0) scale(' + String(LIFT_SCALE) + ')',
                          transition: drag.settled ? 'transform ' + String(FLIP_MS) + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
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
                   * 对读屏用户是装饰：键盘走下面那对 ↑↓ 按钮（WCAG 2.5.7）。
                   */}
                  <span
                    className="project-list__grip"
                    aria-hidden="true"
                    title="按住拖动可调整顺序"
                    onPointerDown={(event) => {
                      if (event.pointerType === 'mouse' && event.button !== 0) {
                        return
                      }
                      pending.current = { id: project.id, startY: event.clientY, fromIndex: index }
                      clearLongPress()
                      longPressTimer.current = window.setTimeout(() => {
                        const held = pending.current
                        if (held !== null && held.id === project.id) {
                          lift(project.id, held.fromIndex, held.startY)
                        }
                      }, LONG_PRESS_MS)
                    }}
                    onPointerUp={() => {
                      clearLongPress()
                      pending.current = null
                    }}
                    onPointerLeave={() => {
                      if (drag === null) {
                        clearLongPress()
                        pending.current = null
                      }
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
                      {/* 数与右侧实际能构建的变体对齐：这里以前数的是全部变体（含 debug），
                          于是侧栏写「2 个变体」、点进去只有一个可构建的 */}
                      <Badge variant="muted" className="tabular">
                        {filterVariantsForPackaging(project.variants).length} 个变体
                      </Badge>
                      {/* 别名决定产物落到哪个文件夹：以前只有进抽屉才看得到 */}
                      {project.alias ? (
                        <Badge variant="muted" title={'产物会归档到「' + project.alias + '」文件夹'}>
                          归档 {project.alias}
                        </Badge>
                      ) : null}
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
                  </button>

                  {/*
                   * 手工排序的两个按钮：拖拽对键盘与读屏用户等于不存在，
                   * 有一对能点的按钮才算两种输入方式都能用（WCAG 2.5.7）。
                   */}
                  <span className="project-list__order">
                    <Button
                      variant="ghost"
                      className="project-list__order-btn"
                      aria-label={'把 ' + project.name + ' 上移'}
                      disabled={index === 0}
                      onClick={() => {
                        move(project.id, -1)
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      className="project-list__order-btn"
                      aria-label={'把 ' + project.name + ' 下移'}
                      disabled={index === projects.length - 1}
                      onClick={() => {
                        move(project.id, 1)
                      }}
                    >
                      ↓
                    </Button>
                  </span>

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