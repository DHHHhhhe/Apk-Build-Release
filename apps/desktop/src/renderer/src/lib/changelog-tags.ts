import { ArrowLeftRight, Info, Sparkles, TrendingUp, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * 「更新记录」里每种分类的标记。
 *
 * 颜色只用语义色（见 DESIGN.md：状态色一律浅底 + 同色深字），不引入装饰色；
 * 图标负责在颜色相近时也能区分。认不出的分类退回中性标签，仍然显示原文，不丢内容。
 *
 * 这张表**必须覆盖 CHANGELOG 里出现的所有分类**：曾经漏了「变更」，
 * 于是它和「说明」都落到中性标签上，同一版的几类改动看起来是同一类
 * （见 changelog-tags.test.ts：新增分类不补表会直接挂测试）。
 */
export const SECTION_TAGS: Record<string, { variant: string; Icon: LucideIcon }> = {
  新增: { variant: 'success', Icon: Sparkles },
  优化: { variant: 'info', Icon: TrendingUp },
  修复: { variant: 'warning', Icon: Wrench },
  变更: { variant: 'info', Icon: ArrowLeftRight },
  说明: { variant: 'muted', Icon: Info }
}
