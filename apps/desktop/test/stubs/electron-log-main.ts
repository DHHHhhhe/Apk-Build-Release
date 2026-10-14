// 单测用的 electron-log 桩：只保留被测代码用到的接口
const noop = (): void => undefined

const scoped = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  scope: (): typeof scoped => scoped
}

const log = {
  ...scoped,
  initialize: noop,
  transports: {
    file: { format: '' },
    console: { format: '' }
  }
}

export default log
