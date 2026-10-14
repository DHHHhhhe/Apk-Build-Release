// 项目域的契约定义放在 shared 里（跨 IPC 边界的类型不能在两处各写一份），
// 这里只做转出，保持 spec 要求的 services/{domain}/types.ts 入口。
export * from '@shared/types/project'
