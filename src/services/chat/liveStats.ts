import { create } from 'zustand'
import type { MessageUsage } from '../api/types.js'
import { recordUsage } from '../usage.js'

/**
 * 底部状态条的实时数据源。
 * 服务端只在一轮结束时给出准确用量，所以流式过程中用字符权重估算输出 token，
 * 收到 message_delta 后用服务端数值替换本轮估算，避免数字倒退。
 */
export type LiveRun = {
  sessionId: string
  model: string
  active: boolean
  startedAt: number
  firstTokenAt: number | null
  endedAt: number | null
  /** 正文与思考的字符数，用于估算速度 */
  textChars: number
  thinkingChars: number
  /** 已完成轮次的服务端输出 token 累计 */
  serverOutput: number
  /** 当前轮尚未结算的估算输出 token */
  roundEstimate: number
  inputTokens: number
  cacheRead: number
  cacheCreation: number
  /** 已完成的请求轮次（工具循环会累加） */
  rounds: number
  /** 输出 token 的时间采样点，用来算瞬时速度 */
  samples: TokenSample[]
}

/** 采样点：t 为时间戳，tokens 为当时的累计输出 token（未取整） */
export type TokenSample = { t: number; tokens: number }

type LiveState = { run: LiveRun | null }

export const useLiveStats = create<LiveState>(() => ({ run: null }))

const patchRun = (fn: (run: LiveRun) => LiveRun) => {
  useLiveStats.setState((state) => (state.run ? { run: fn(state.run) } : state))
}

/** 中文按 1 token、其余按 0.3 token 估算，足够速度条使用 */
const tokenWeight = (text: string): number => {
  let weight = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    weight += code >= 0x2e80 && code <= 0x9fff ? 1 : 0.3
  }
  return weight
}

export const beginLiveRun = (sessionId: string, model: string) => {
  useLiveStats.setState({
    run: {
      sessionId,
      model,
      active: true,
      startedAt: Date.now(),
      firstTokenAt: null,
      endedAt: null,
      textChars: 0,
      thinkingChars: 0,
      serverOutput: 0,
      roundEstimate: 0,
      inputTokens: 0,
      cacheRead: 0,
      cacheCreation: 0,
      rounds: 0,
      samples: [],
    },
  })
}

/** 采样窗口：只留最近几秒的点，长对话也不会越攒越多 */
const SAMPLE_KEEP_MS = 4000
const SAMPLE_MAX = 240

const pushSample = (samples: TokenSample[], sample: TokenSample): TokenSample[] => {
  const cutoff = sample.t - SAMPLE_KEEP_MS
  const next = [...samples, sample]
  let start = 0
  while (start < next.length - 2 && next[start].t < cutoff) {
    start += 1
  }
  const kept = start > 0 ? next.slice(start) : next
  return kept.length > SAMPLE_MAX ? kept.slice(kept.length - SAMPLE_MAX) : kept
}

export const noteDelta = (kind: 'text' | 'thinking', text: string) => {
  const weight = tokenWeight(text)
  const now = Date.now()
  patchRun((run) => {
    const roundEstimate = run.roundEstimate + weight
    return {
      ...run,
      firstTokenAt: run.firstTokenAt ?? now,
      textChars: kind === 'text' ? run.textChars + text.length : run.textChars,
      thinkingChars: kind === 'thinking' ? run.thinkingChars + text.length : run.thinkingChars,
      roundEstimate,
      samples: pushSample(run.samples, { t: now, tokens: run.serverOutput + roundEstimate }),
    }
  })
}

/**
 * phase=start：一轮请求开始，累计输入与缓存用量，重置本轮估算；
 * phase=delta：一轮结束，采用服务端输出 token。
 */
export const noteUsage = (usage: MessageUsage | undefined, phase: 'start' | 'delta') => {
  if (!usage) {
    return
  }
  const now = Date.now()
  // 本地账本：开始记输入（命中 + 未命中），结束记输出；金额按官方价估算
  const model = useLiveStats.getState().run?.model
  if (phase === 'start') {
    recordUsage(
      {
        model,
        cacheHit: usage.cache_read_input_tokens,
        cacheMiss: usage.input_tokens + usage.cache_creation_input_tokens,
      },
      'input'
    )
  } else {
    recordUsage({ model, output: usage.output_tokens }, 'output')
  }
  patchRun((run) =>
    phase === 'start'
      ? {
          ...run,
          inputTokens: run.inputTokens + (usage.input_tokens ?? 0),
          cacheRead: run.cacheRead + (usage.cache_read_input_tokens ?? 0),
          cacheCreation: run.cacheCreation + (usage.cache_creation_input_tokens ?? 0),
          roundEstimate: 0,
          // 新一轮的估算清零，旧采样点会和当前总量对不上，直接丢掉重新计
          samples: [],
        }
      : {
          ...run,
          serverOutput: run.serverOutput + (usage.output_tokens ?? 0),
          roundEstimate: 0,
          rounds: run.rounds + 1,
          samples: pushSample(run.samples, {
            t: now,
            tokens: run.serverOutput + (usage.output_tokens ?? 0),
          }),
        }
  )
}

export const finishLiveRun = (sessionId?: string) => {
  patchRun((run) =>
    run.active && (sessionId === undefined || run.sessionId === sessionId)
      ? { ...run, active: false, endedAt: Date.now() }
      : run
  )
}

/** 瞬时速度的观察窗口：太短会抖，太长又退化成平均值 */
const SPEED_WINDOW_MS = 1200
/** 窗口内至少要有这么多数据，否则差值噪声太大 */
const SPEED_MIN_SPAN_S = 0.2

/**
 * 瞬时速度：拿窗口起点的累计 token 和当前值做差分。
 * 生成中断（比如等工具）时差值为 0，速度自然落回 0，而不是被历史产量撑着。
 */
const instantTps = (samples: TokenSample[], now: number, tokens: number): number => {
  if (samples.length === 0) {
    return 0
  }
  const target = now - SPEED_WINDOW_MS
  let base = samples[0]
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].t <= target) {
      base = samples[index]
      break
    }
  }
  const span = (now - base.t) / 1000
  const delta = tokens - base.tokens
  if (span < SPEED_MIN_SPAN_S || delta <= 0) {
    return 0
  }
  return delta / span
}

/** 展示用派生值；调用方负责每秒触发一次重渲染 */
export const readLiveMetrics = (run: LiveRun) => {
  const now = run.endedAt ?? Date.now()
  const elapsed = Math.max(0, now - run.startedAt)
  const firstTokenMs =
    run.firstTokenAt === null ? null : Math.max(0, run.firstTokenAt - run.startedAt)
  const rawOutput = run.serverOutput + run.roundEstimate
  const outputTokens = Math.round(rawOutput)
  const totalInput = run.inputTokens + run.cacheRead + run.cacheCreation
  const cacheRate = totalInput > 0 ? run.cacheRead / totalInput : null
  const seconds = elapsed / 1000
  // 速度从首字之后算，避免把等待首字的时间摊进吞吐
  const streamSeconds =
    run.firstTokenAt === null ? 0 : Math.max(0.2, (now - run.firstTokenAt) / 1000)
  const averageTps = streamSeconds > 0 ? rawOutput / streamSeconds : 0
  // 生成中报瞬时速度，跑完再给出整轮平均，收尾数字才有意义
  const tps = run.active ? instantTps(run.samples, now, rawOutput) : averageTps
  return {
    elapsed,
    firstTokenMs,
    outputTokens,
    inputTokens: totalInput,
    cacheRate,
    tps,
    seconds,
  }
}

/** 每 1 秒刷新一次；只在生成中订阅，结束后停表 */
export const subscribeLiveTick = (active: boolean, tick: () => void) => {
  if (!active) {
    return () => undefined
  }
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)
}
