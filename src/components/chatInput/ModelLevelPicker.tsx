import clsx from 'clsx'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import {
  IconCheckedOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconRefreshOutline16,
} from '../base/icons.js'
import {
  BUILTIN_MODELS,
  fetchRemoteModels,
  modelLabel,
  readCachedModels,
  type ModelOption,
} from '../../services/api/models.js'
import {
  EFFORT_LEVELS,
  setModel,
  setReasoningEffort,
  useSettings,
} from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { useGlassAttach } from '../glass/useLiquidGlass.js'
import styles from './ModelLevelPicker.module.css'

const LEVEL_KEYS = [
  'thinkingLevel0',
  'thinkingLevel1',
  'thinkingLevel2',
  'thinkingLevel3',
  'thinkingLevel4',
] as const

/** 滑杆上每个档位的位置（0 档在最左，4 档在最右） */
const STEPS = Array.from({ length: EFFORT_LEVELS + 1 }, (_, index) => index)

/** 滑块半径：轨道左右各留出这一段，圆点才能完整落在轨道内 */
const THUMB_RADIUS = 13

const mergeModels = (remote: ModelOption[]): ModelOption[] => {
  const seen = new Set(remote.map((item) => item.id))
  return [...remote, ...BUILTIN_MODELS.filter((item) => !seen.has(item.id))]
}

/**
 * 模型与推理等级：参考视频里的合并入口。
 *
 * 收起时是输入框底部的一行「模型名 + 当前等级」；展开后上方是模型行，
 * 下方是一张内嵌卡片：标题行 + 一条厚胶囊滑杆，档位越高颜色越偏紫。
 */
export const ModelLevelPicker = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const effort = useSettings((state) => state.reasoningEffort)
  const mockAgent = useSettings((state) => state.mockAgent)
  const [open, setOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [models, setModels] = useState<ModelOption[]>(() => mergeModels(readCachedModels() ?? []))
  const [loading, setLoading] = useState(false)
  // 满档提示只出现一会儿，然后淡回正常标题（和视频一致）
  const [hint, setHint] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fetched = useRef(false)

  /*
   * 滑杆的动画引擎：--p 直接写到 DOM 上，不走 React 渲染。
   * 拖动时指数阻尼跟随指针（手指/鼠标停下后滑块再滑一小段），
   * 松手吸附到最近档位，再用欠阻尼弹簧过冲一点后回弹。
   */
  const sliderRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>
  const posRef = useRef(effort / EFFORT_LEVELS)
  const targetRef = useRef(posRef.current)
  const velocityRef = useRef(0)
  const draggingRef = useRef(false)
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)
  const stepRef = useRef<((now: number) => void) | null>(null) as MutableRefObject<((now: number) => void) | null>

  const paint = useCallback((value: number) => {
    const next = Math.min(1, Math.max(0, value))
    posRef.current = next
    sliderRef.current?.style.setProperty('--p', next.toFixed(4))
  }, [sliderRef])

  useEffect(() => {
    const step = (now: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - lastFrameRef.current) / 1000))
      lastFrameRef.current = now
      if (draggingRef.current) {
        // 阻尼跟随：时间常数 58ms，快速拖动也不会一步跳到位
        const ease = 1 - Math.exp(-dt / 0.058)
        paint(posRef.current + (targetRef.current - posRef.current) * ease)
        const level = Math.round(posRef.current * EFFORT_LEVELS)
        if (level !== useSettings.getState().reasoningEffort) {
          setReasoningEffort(level)
        }
      } else {
        // 弹簧：刚度 300、阻尼 16，略欠阻尼，松手会轻轻过冲再回来
        const accel = -300 * (posRef.current - targetRef.current) - 16 * velocityRef.current
        velocityRef.current += accel * dt
        paint(posRef.current + velocityRef.current * dt)
        if (
          Math.abs(posRef.current - targetRef.current) < 0.0015 &&
          Math.abs(velocityRef.current) < 0.02
        ) {
          paint(targetRef.current)
          rafRef.current = 0
          return
        }
      }
      rafRef.current = requestAnimationFrame(step)
    }
    stepRef.current = step
    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [paint, stepRef])

  const startSpring = useCallback(() => {
    if (rafRef.current) {
      return
    }
    const step = stepRef.current
    if (!step) {
      return
    }
    lastFrameRef.current = performance.now()
    rafRef.current = requestAnimationFrame(step)
  }, [stepRef])

  // 外部改档位（设置页、键盘）时弹到新位置；打开面板时直接落到当前档
  useEffect(() => {
    if (!open || draggingRef.current) {
      return
    }
    const next = effort / EFFORT_LEVELS
    if (Math.abs(next - targetRef.current) < 1e-6 && rafRef.current) {
      return
    }
    targetRef.current = next
    velocityRef.current = 0
    if (Math.abs(next - posRef.current) < 1e-6) {
      paint(next)
      return
    }
    startSpring()
  }, [effort, open, paint, startSpring])

  const ratioAt = (clientX: number) => {
    const el = sliderRef.current
    if (!el) {
      return 0
    }
    const rect = el.getBoundingClientRect()
    const travel = Math.max(1, rect.width - THUMB_RADIUS * 2)
    return Math.min(1, Math.max(0, (clientX - rect.left - THUMB_RADIUS) / travel))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = true
    setDragging(true)
    velocityRef.current = 0
    targetRef.current = ratioAt(event.clientX)
    startSpring()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) {
      targetRef.current = ratioAt(event.clientX)
    }
  }

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) {
      return
    }
    draggingRef.current = false
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // 以松手位置为准（快速拖动时最后一个 move 可能还没处理），再吸附到最近档位
    targetRef.current = ratioAt(event.clientX)
    const snapped = Math.round(targetRef.current * EFFORT_LEVELS)
    targetRef.current = snapped / EFFORT_LEVELS
    setReasoningEffort(snapped)
    startSpring()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = useSettings.getState().reasoningEffort
    let next = current
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = Math.min(EFFORT_LEVELS, current + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = Math.max(0, current - 1)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = EFFORT_LEVELS
    } else {
      return
    }
    event.preventDefault()
    setReasoningEffort(next)
  }

  // 挂载时用当前档位初始化 --p；回调保持稳定，拖动中的重渲染不会把它重置
  const setSlider = useCallback((node: HTMLDivElement | null) => {
    sliderRef.current = node
    if (node) {
      const initial = useSettings.getState().reasoningEffort / EFFORT_LEVELS
      posRef.current = initial
      node.style.setProperty('--p', initial.toFixed(4))
    }
  }, [sliderRef])
  // 面板只要一层磨砂：跟着输入框透出背景，但不做折射贴图
  const glassRef = useGlassAttach({ tier: 'frost', tint: 0.12 })

  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, {
    side: 'top',
    align: 'end',
    offset: 10,
    maxHeight: 420,
    minSpace: 220,
    measureKey: `${models.length}-${modelOpen}`,
  })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  const refresh = useCallback(
    async (silent = false) => {
      const apiKey = useSettings.getState().apiKey ?? ''
      if (!apiKey) {
        if (!silent) {
          showToast(t('modelFetchFailed'))
        }
        return
      }
      setLoading(true)
      try {
        const remote = await fetchRemoteModels(apiKey)
        setModels(mergeModels(remote))
      } catch {
        if (!silent) {
          showToast(t('modelFetchFailed'))
        }
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (!open || fetched.current || mockAgent) {
      return
    }
    fetched.current = true
    if (!readCachedModels()) {
      void refresh(true)
    }
  }, [open, mockAgent, refresh])

  // 收起后回到主页面，下次打开仍是「模型 + 推理等级」
  useEffect(() => {
    if (!open) {
      setModelOpen(false)
    }
  }, [open])

  useEffect(() => {
    if (effort < EFFORT_LEVELS) {
      setHint(false)
      return
    }
    setHint(true)
    const timer = window.setTimeout(() => setHint(false), 1600)
    return () => window.clearTimeout(timer)
  }, [effort])

  const sourceText = useMemo(() => {
    if (loading) {
      return t('modelRefreshing')
    }
    const count = models.filter((item) => item.source === 'remote').length
    return count > 0 ? t('modelRemoteOk', { count }) : t('modelBuiltinFallback')
  }, [loading, models, t])

  const maxed = effort >= EFFORT_LEVELS

  // 回调 ref 必须稳定，否则滑杆每次 onChange 都会重挂液态玻璃贴图
  const setFloating = useCallback(
    (node: HTMLDivElement | null) => {
      glassRef(node)
      floatingRef.current = node
    },
    [glassRef, floatingRef]
  )

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open)}
        data-level={effort || undefined}
        aria-label={t('modelSelect')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.model}>{modelLabel(model)}</span>
        {/* 固定宽度的等级位：切换档位时按钮宽度不变，面板不会跟着左右跳 */}
        <span className={styles.level}>{t(LEVEL_KEYS[effort])}</span>
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={setFloating}
              className={styles.panel}
              style={position ?? undefined}
              data-level={effort || undefined}
              role="dialog"
              aria-label={t('modelSelect')}
            >
              {modelOpen ? (
                <div className={styles.sub}>
                  <div className={styles.subHead}>
                    <button
                      type="button"
                      className={styles.back}
                      aria-label={t('modelBack')}
                      onClick={() => setModelOpen(false)}
                    >
                      <IconChevronRightOutline14 />
                    </button>
                    <span className={styles.rowLabel}>{t('modelSelect')}</span>
                  </div>
                  <div className={styles.models} role="listbox" aria-label={t('modelSelect')}>
                    {models.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={item.id === model}
                        className={clsx(styles.option, item.id === model && styles.optionActive)}
                        onClick={() => {
                          setModel(item.id)
                          setModelOpen(false)
                        }}
                      >
                        <span className={styles.optionMain}>
                          <span className={styles.optionName}>{item.label}</span>
                          <span className={styles.optionId}>{item.id}</span>
                        </span>
                        {item.id === model ? <IconCheckedOutline14 /> : null}
                      </button>
                    ))}
                  </div>
                  <div className={styles.modelFoot}>
                    <span className={styles.source}>{sourceText}</span>
                    <button
                      type="button"
                      className={clsx(styles.refresh, loading && styles.spinning)}
                      disabled={loading}
                      onClick={() => void refresh()}
                    >
                      <IconRefreshOutline16 />
                      {loading ? t('modelRefreshing') : t('modelRemoteFetch')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.modelRow}>
                    <span className={styles.rowLabel}>{t('modelSelect')}</span>
                    <button
                      type="button"
                      className={styles.modelValue}
                      aria-haspopup="listbox"
                      onClick={() => setModelOpen(true)}
                    >
                      <span className={styles.modelName}>{modelLabel(model)}</span>
                      <span className={styles.chevron}>
                        <IconChevronRightOutline14 />
                      </span>
                    </button>
                  </div>

                  <div
                    className={styles.card}
                    data-glow={effort > 0 || undefined}
                    data-max={maxed || undefined}
                  >
                    <div className={styles.cardHead} data-hint={hint || undefined}>
                      <div className={styles.headNormal}>
                        <span className={styles.rowLabel}>{t('modelLevelReasoning')}</span>
                        <span className={styles.levelRight}>
                          <span className={styles.levelValue}>{t(LEVEL_KEYS[effort])}</span>
                          <span className={styles.chevron} aria-hidden>
                            <IconChevronRightOutline14 />
                          </span>
                        </span>
                      </div>
                      <span className={styles.headHint} aria-live="polite">
                        {t('thinkingMaxWarning')}
                      </span>
                    </div>

                    <div
                      ref={setSlider}
                      className={styles.slider}
                      data-dragging={dragging || undefined}
                      role="slider"
                      tabIndex={0}
                      aria-label={t('modelLevelReasoning')}
                      aria-valuemin={0}
                      aria-valuemax={EFFORT_LEVELS}
                      aria-valuenow={effort}
                      aria-valuetext={t(LEVEL_KEYS[effort])}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={stopDrag}
                      onPointerCancel={stopDrag}
                      onKeyDown={onKeyDown}
                    >
                      <div className={styles.track}>
                        <span className={styles.fill} />
                        <span className={styles.stars} aria-hidden>
                          <span className={styles.starTile} />
                          <span className={styles.starTileAlt} />
                        </span>
                        {STEPS.map((step) =>
                          step > effort ? (
                            <span
                              key={step}
                              className={styles.dot}
                              style={{
                                left: `calc(${THUMB_RADIUS}px + (100% - ${
                                  THUMB_RADIUS * 2
                                }px) * ${step / EFFORT_LEVELS})`,
                              }}
                            />
                          ) : null
                        )}
                        <span className={styles.thumb} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
