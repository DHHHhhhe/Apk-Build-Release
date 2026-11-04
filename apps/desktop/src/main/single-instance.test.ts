import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance, focusOrCreate, type SingleInstanceHost, type WindowLike } from './single-instance'

/**
 * 单实例锁。
 *
 * 关键不是「有没有调用 requestSingleInstanceLock」，而是**拿不到锁时必须退出** ——
 * 漏掉这一步，第二个进程会接着建窗口、开 SQLite、把第一个进程正在跑的队列项
 * 判成上次残留，后果远不止多出一个窗口。
 */
function createHost(locked: boolean): {
  host: SingleInstanceHost
  quit: ReturnType<typeof vi.fn>
  registered: Map<string, () => void>
} {
  const quit = vi.fn()
  const registered = new Map<string, () => void>()
  const host: SingleInstanceHost = {
    requestSingleInstanceLock: () => locked,
    quit,
    on: (event, listener) => {
      registered.set(event, listener as () => void)
      return host
    }
  }
  return { host, quit, registered }
}

describe('单实例锁', () => {
  it('拿不到锁时退出，并且不注册 second-instance', () => {
    const { host, quit, registered } = createHost(false)

    expect(acquireSingleInstance(host, () => {})).toBe(false)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(registered.has('second-instance')).toBe(false)
  })

  it('拿到锁时继续启动，并把重复启动交给聚焦回调', () => {
    const onSecondInstance = vi.fn()
    const { host, quit, registered } = createHost(true)

    expect(acquireSingleInstance(host, onSecondInstance)).toBe(true)
    expect(quit).not.toHaveBeenCalled()

    const listener = registered.get('second-instance')
    expect(listener).toBeTypeOf('function')
    listener?.()
    // 每次重复启动都要叫一次窗口，不是只在第一次生效
    listener?.()
    expect(onSecondInstance).toHaveBeenCalledTimes(2)
  })
})

/**
 * 重复启动的落点。
 *
 * 两种错法都要挡住：新建出第二个窗口（两个界面共写一份队列），
 * 以及最小化的窗口只 show 不 restore（点了图标还是看不到）。
 */
function fakeWindow(minimized: boolean): WindowLike & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isMinimized: () => minimized,
    restore: () => {
      calls.push('restore')
    },
    show: () => {
      calls.push('show')
    },
    focus: () => {
      calls.push('focus')
    }
  }
}

describe('重复启动的窗口处理', () => {
  it('已有窗口就只唤醒，不新建', () => {
    const win = fakeWindow(false)
    const create = vi.fn()

    focusOrCreate([win], create)

    expect(create).not.toHaveBeenCalled()
    expect(win.calls).toEqual(['show', 'focus'])
  })

  it('最小化的窗口先还原再显示', () => {
    const win = fakeWindow(true)

    focusOrCreate([win], () => {})

    expect(win.calls).toEqual(['restore', 'show', 'focus'])
  })

  it('窗口全关但进程还活着时重新开一个', () => {
    const create = vi.fn()

    focusOrCreate([], create)

    expect(create).toHaveBeenCalledTimes(1)
  })
})