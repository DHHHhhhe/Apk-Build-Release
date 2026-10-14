import log from 'electron-log/main'

// 结构化日志 + 模块级 scope（.trellis/spec/backend/logging.md）
log.initialize()
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}'
log.transports.console.format = '[{level}] {text}'

export const logger = log
