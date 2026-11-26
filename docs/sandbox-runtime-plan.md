# 沙箱运行时方案：WASM 而不是 Linux

> 结论先行：**不做 Linux 容器，做 WASM 运行时。** 前者在手机端被系统禁止，后者今天就能跑。

---

## 一、为什么不能跑真 Linux

### 查证结论

华为官方 FAQ（faqs-ability-112）原文：

> 系统会对普通应用直接进行 Fork 进程限制、管控；**手机产品不允许普通应用直接创建进程**，如需要，HarmonyOS 要在配置文件中申明，并在上架审核的时候上传每个进程的必要性说明。
>
> 目前**不允许使用 Fork+exec**，仅手机端可以使用 fork，但需通过审核后方可使用。

拆开看：

| 能力 | 手机端 | 说明 |
| --- | --- | --- |
| fork() | 过审可用 | 配置文件申明 + 上架时提交必要性说明 |
| execve() | 禁止 | 无法加载外部 ELF |
| PC / 2-in-1 | 允许 | 有官方文档 Integrating bin Files into Application Packages |

真 Linux 需要 execve 加载 /bin/sh、/usr/bin/git 这些二进制。手机端这一环被封死，所以 termux/proot 那套方案走不通。

### 对照：卓易通怎么做到的

卓易通能跑 Android APK，技术路径是：

```
卓易通 App（普通应用，已过审）
  └─ iSulad 容器引擎（华为自研，C）
       └─ anco_hmos.img（裁剪过的 Android 镜像）
            └─ ART + Framework 用户态
                 └─ 用户的 APK
       ↓ 系统调用转译 → 鸿蒙内核
       ↓ 图形共享内存 → 直连合成器
```

**关键洞察**：它 fork 出容器进程后，在进程内直接跑已加载的 ART，**不需要 execve 加载新二进制**。这是它能绕开限制的原因。

> 换句话说：卓易通不是「跑了一个 Linux」，而是「往进程里塞了一个安卓运行时」。

这个思路可以直接迁移——我们往进程里塞一个 **WASM 运行时**，规模小一档，且不需要签协议、不需要等审核。

---

## 二、方案：WASM 运行时

### 为什么 WASM 不受限

WASM 在 JS 引擎的虚拟机里执行，**全程一个进程**，不 fork、不 exec。系统层面看到的只是一段 JS 在跑。

### 能力对照

| 需求 | WASM 方案 | 包体积 | 成熟度 |
| --- | --- | --- | --- |
| Python | Pyodide（CPython 3.12 → WASM） | ~10 MB（可裁到 6） | 官方维护，pandas/numpy/matplotlib 全可用 |
| git | isomorphic-git | ~200 KB | 纯 JS，clone/commit/diff 都有 |
| sqlite | sql.js | ~1 MB | 成熟 |
| ffmpeg | ffmpeg.wasm | ~25 MB | 可用但重，按需加载 |
| npm / node | 无解 | - | 需要 native |

### 架构位置

```
┌─ HarmonyOS App ─────────────────────────────┐
│  ArkTS 壳（文件系统、原生能力）              │
│    └─ __DS_SHELL__ 桥                       │
│         └─ ArkWeb（WebView）                │
│              └─ React 前端                  │
│                   └─ 沙箱运行时（新增）      │
│                        ├─ Pyodide Worker    │
│                        ├─ isomorphic-git    │
│                        └─ 挂载 workspace FS  │
└─────────────────────────────────────────────┘
```

**Pyodide 跑在 Web Worker 里**，理由：

1. 不阻塞 UI
2. 崩了只死 worker，不拖垮 App
3. 可以 terminate() 强制中断（对应「取消执行」）

### 文件系统挂载

Pyodide 有 FS 接口，需要桥接：执行前把工作区文件同步进虚拟 FS 的 /ws，执行完把改动写回沙箱。这样 Python 改的文件在工作区面板里能看到 diff。

---

## 三、工具设计

### 只加一个工具，不是七个

```typescript
{
  name: 'run_sandbox',
  description: '在沙箱里跑代码或命令。runtime=python 跑 Python（可用 pandas/numpy）；runtime=git 执行 git 操作；runtime=shell 执行带管道的简单命令。',
  inputSchema: {
    runtime: { enum: ['python', 'git', 'shell'] },
    code: { type: 'string' },       // runtime=python 时代码
    args: { type: 'array' },        // runtime=git/shell 时的参数
    timeout_ms: { type: 'number' }, // 默认 30000
  }
}
```

**为什么合并**：上一轮把 60 个工具合到 34 个，教训是工具越多模型越挑不准。运行时统一一个入口，runtime 选执行环境。

### 与现有工具的关系

| 现有 | 新方案下的定位 |
| --- | --- |
| workspace / workspace_edit | 保留——改单个文件比起 Python 快 |
| text / json / csv | 保留——高频小操作，不值得起运行时 |
| calculate | 保留——一行算术 |
| **新增 run_sandbox** | 复杂计算、数据清洗、git 操作 |

**不是替代，是补齐。** 简单的仍然走轻工具，重的走运行时。

---

## 四、实施阶段

### 阶段 1：Pyodide 最小闭环（1-2 天）

目标：run_sandbox({ runtime: 'python', code: 'print(1+1)' }) 返回 2。

- [ ] 引入 Pyodide（先 CDN，后考虑内置）
- [ ] 起 Web Worker，加载运行时
- [ ] 消息协议：主线程 ↔ worker
- [ ] run_sandbox 工具注册
- [ ] 超时控制 + terminate()

验收：发一条「用 Python 算 100 的阶乘」，返回正确的大整数。

### 阶段 2：文件系统挂载（2-3 天）

目标：Python 读写工作区文件。

- [ ] 执行前把 workspace 同步进 /ws
- [ ] 执行后 diff 出改动，写回沙箱
- [ ] 处理二进制文件（Pyodide FS 支持 Uint8Array）

验收：发「用 Python 把 README.md 里的所有 TODO 改成 DONE」，工作区面板能看到 diff。

### 阶段 3：isomorphic-git（1 天）

- [ ] 引入 isomorphic-git
- [ ] 挂到同一套虚拟 FS
- [ ] run_sandbox({ runtime: 'git', args: ['status'] })

验收：git log 能看到提交历史（如果工作区有 .git）。

### 阶段 4：按需加载优化（1 天）

- [ ] Pyodide 首次使用时才下载，不阻塞首屏
- [ ] 缓存到 IndexedDB，二次启动秒开
- [ ] 加载进度 UI

---

## 五、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Pyodide 首包 10MB | 首次慢 | CDN + IndexedDB 缓存，只在用 Python 时下 |
| 内存占用 | 低端机 OOM | Worker 闲置 5 分钟后 terminate |
| 中断执行 | 死循环卡住 | SharedArrayBuffer + Atomics 可中断；退化方案是 worker.terminate() |
| WASM 编译慢 | 冷启动 2-3 秒 | 预热：App 空闲时后台加载 |
| 文件同步开销 | 大工作区卡 | 只同步 /ws 下的文本文件，二进制按需 |

---

## 六、不做什么

- **不做 Android 容器** —— 那是华为自家的活，第三方签不到协议
- **不做 proot/termux** —— 需要 execve，手机端禁止
- **不强制替换现有工具** —— 轻工具更快，保留
- **不内置 ffmpeg.wasm** —— 25MB 太重，真需要时再按需加载

---

## 七、一句话总结

**卓易通往进程里塞了 ART，我们往进程里塞 Pyodide。同一套逻辑，规模小一档，不需要签协议、不需要等审核、今天就能跑。**

---

*写于 2026-11-27 04:30*
*依据：华为官方 FAQ faqs-ability-112 + 卓易通技术分析*