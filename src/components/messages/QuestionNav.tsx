import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useGlassAttach } from '../glass/useLiquidGlass.js'
import styles from './QuestionNav.module.css'

export type QuestionNavItem = {
  id: string
  /** 已压平空白的问题文本，展示时再交给 CSS 截断 */
  text: string
}

/**
 * 右侧问题导航：收起时是一列刻度，鼠标移上去展开成问题列表，点一下滚到那条消息。
 * 悬停展开而不是点击展开，是为了「扫过去就能跳」。
 */
export const QuestionNav = ({
  items,
  activeId,
  onJump,
}: {
  items: QuestionNavItem[]
  activeId: string | null
  onJump: (id: string) => void
}) => {
  const t = useTranslate()
  const [expanded, setExpanded] = useState(false)
  // 常驻液态玻璃：参数与输入框完全一致（同一组默认值），收起与展开都是同一块玻璃
  const glassRef = useGlassAttach()

  return (
    <div
      className={styles.nav}
      data-expanded={expanded || undefined}
      role="navigation"
      aria-label={t('questionNavLabel')}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        // 焦点还在列表内（比如 Tab 到下一项）时不收起
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExpanded(false)
        }
      }}
    >
      <div ref={glassRef} className={styles.list}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.item}
            data-active={item.id === activeId || undefined}
            title={item.text}
            onClick={() => {
              onJump(item.id)
              setExpanded(false)
            }}
          >
            <span className={styles.tick} aria-hidden="true" />
            <span className={styles.text}>{item.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
