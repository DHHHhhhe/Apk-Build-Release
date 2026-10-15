import { FolderPlus, ListChecks, Rocket } from 'lucide-react'
import { Button } from './ui/button'
import logoUrl from '../assets/logo.png'

const STEPS: Array<{ icon: typeof FolderPlus; title: string; desc: string }> = [
  { icon: FolderPlus, title: '添加本地项目', desc: '选项目根目录（有 settings.gradle 的那一层），也可以直接把文件夹拖进窗口' },
  { icon: ListChecks, title: '勾选要打的变体', desc: '变体列表来自项目自身的 Gradle 配置，不是写死的 debug / release' },
  { icon: Rocket, title: '加入队列并构建', desc: '多个项目排队跑，产物按项目名复制到统一输出目录' }
]

/** 没有任何项目时的引导：只说第一步该干什么，不摆空面板和用不上的环境卡 */
export function GuideCard({
  onAdd,
  dragging
}: {
  onAdd: () => void
  dragging: boolean
}): React.JSX.Element {
  return (
    <section className={`card-shell guide${dragging ? ' guide--dragging' : ''}`}>
      <div className="card-core card-core--pad guide__core">
        <img className="guide__logo" src={logoUrl} alt="" width={48} height={48} />
        <h2 className="guide__title">先添加一个 Android 项目</h2>
        <p className="guide__lead">
          工具复用本机已装好的 JDK、Android SDK 和项目的 Gradle Wrapper，不需要额外配置。
        </p>

        <ol className="guide__steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="guide__step">
              <span className="guide__step-index tabular">{index + 1}</span>
              <span className="guide__step-icon" aria-hidden="true">
                <step.icon size={16} />
              </span>
              <span className="guide__step-text">
                <span className="guide__step-title">{step.title}</span>
                <span className="guide__step-desc">{step.desc}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="guide__actions">
          <button type="button" className="btn-outline" onClick={onAdd}>
            <FolderPlus size={16} aria-hidden="true" />
            选择项目目录
          </button>
          <span className="guide__hint">{dragging ? '松手即添加' : '或把项目文件夹拖到这里'}</span>
        </div>
      </div>
    </section>
  )
}
