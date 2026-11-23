import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import { useGlassAttach } from '../glass/useLiquidGlass.js'
import styles from './SearchPanel.module.css'

/** 右侧「搜索结果」面板 */
export const SearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  // 右侧结果面板也是一片玻璃：叠在消息区上，底下的内容会透出来
  // 搜索面板面积大，保持普通毛玻璃，避免整块折射贴图拖慢滚动
  const glassRef = useGlassAttach({ tier: 'frost', tint: 0.14 })
  if (!entry) {
    return null
  }
  return (
    <aside ref={glassRef} className={`${styles.panel} lg`}>
      <div className={styles.header}>
        <div role="heading" className={styles.title}>
          {t('searchResult')}
        </div>
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeSearchPanel}
        />
      </div>
      <div className={styles.content}>
        {sources.map((source) => (
          <SourceCard key={source.url} source={source} className={styles.item} />
        ))}
      </div>
    </aside>
  )
}
