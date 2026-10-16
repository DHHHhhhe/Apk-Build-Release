/**
 * 最后一次交互是键盘还是指针。
 *
 * 只有一个用途：抽屉打开时要不要把焦点搬进去。
 *
 * 鼠标点开抽屉时抢焦点是打断 —— 用户往往要接着点下一个项目，焦点被搬到「关闭」按钮上
 * 之后，键盘操作要从抽屉重新走回来。而键盘（Tab/Enter）打开抽屉时**必须**搬焦点，
 * 否则用户按 Tab 会从原处继续走，焦点落在抽屉背后的元素上，看着像抽屉没生效。
 *
 * 所以按「最后用的是哪种输入」决定，而不是一律搬或一律不搬。
 */
export type InputMode = 'keyboard' | 'pointer'

let mode: InputMode = 'pointer'

/** 装一次监听；App 在挂载时调用，返回卸载函数 */
export function trackInputMode(): () => void {
  const handleKeyDown = (): void => {
    mode = 'keyboard'
  }
  const handlePointerDown = (): void => {
    mode = 'pointer'
  }
  document.addEventListener('keydown', handleKeyDown, true)
  document.addEventListener('pointerdown', handlePointerDown, true)
  return () => {
    document.removeEventListener('keydown', handleKeyDown, true)
    document.removeEventListener('pointerdown', handlePointerDown, true)
  }
}

export function lastInputWasKeyboard(): boolean {
  return mode === 'keyboard'
}

/** 只给测试用：把模式复位到初始值，避免用例之间互相影响 */
export function resetInputMode(): void {
  mode = 'pointer'
}
