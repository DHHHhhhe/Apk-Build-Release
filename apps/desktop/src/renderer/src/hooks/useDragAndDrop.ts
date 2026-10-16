import { useCallback, useRef, useState } from 'react'

export interface UseDragAndDropResult {
  dragging: boolean
  /** 这次拖进来的文件数：用来提示「一次只能加一个」 */
  fileCount: number
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
}

/**
 * 把项目文件夹拖进窗口直接添加。
 * Electron 32 起 Web File 对象没有 path 属性，真实路径只能由 preload 的 webUtils.getPathForFile 取。
 * 拖拽计数用 ref 记，避免拖过子元素时 dragleave 把高亮闪掉。
 *
 * 拖拽是**全窗口**生效的（挂在根元素上），所以高亮也要全窗口给 ——
 * 以前只有空状态那张引导卡会变，已经有项目时拖进来毫无反应，用户以为不支持。
 */
export function useDragAndDrop(
  onFolder: (path: string, total: number) => void
): UseDragAndDropResult {
  const [dragging, setDragging] = useState(false)
  const [fileCount, setFileCount] = useState(0)
  const depth = useRef(0)

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    // dragover 阶段 files 常常是空的，items 才有数
    setFileCount(event.dataTransfer.items.length || event.dataTransfer.files.length)
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((event: React.DragEvent) => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0 || event.relatedTarget === null) {
      setDragging(false)
      setFileCount(0)
    }
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const total = event.dataTransfer.files.length
      setFileCount(0)

      const file = event.dataTransfer.files[0]
      if (!file) {
        return
      }
      const path = window.api.files.pathFor(file)
      if (path.trim() !== '') {
        onFolder(path, total)
      }
    },
    [onFolder]
  )

  return { dragging, fileCount, onDragOver, onDragLeave, onDrop }
}
