import { useCallback, useRef, useState } from 'react'

export interface UseDragAndDropResult {
  dragging: boolean
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
}

/**
 * 把项目文件夹拖进窗口直接添加。
 * Electron 32 起 Web File 对象没有 path 属性，真实路径只能由 preload 的 webUtils.getPathForFile 取。
 * 拖拽计数用 ref 记，避免拖过子元素时 dragleave 把高亮闪掉。
 */
export function useDragAndDrop(onFolder: (path: string) => void): UseDragAndDropResult {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }, [])

  const onDragLeave = useCallback((event: React.DragEvent) => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0 || event.relatedTarget === null) {
      setDragging(false)
    }
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setDragging(false)

      const file = event.dataTransfer.files[0]
      if (!file) {
        return
      }
      const path = window.api.files.pathFor(file)
      if (path.trim() !== '') {
        onFolder(path)
      }
    },
    [onFolder]
  )

  return { dragging, onDragOver, onDragLeave, onDrop }
}
