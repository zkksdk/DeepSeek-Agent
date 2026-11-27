# 合并 HiSH 的 Linux 到本 App

> 结论：**可行，且比预想简单。** HiSH 的 napi 接口只有 4 个核心函数，QEMU 命令行已完整拿到，组件清单明确。

## 一、可行性验证（已查证）

### 为什么 HiSH 能跑真 Linux 而我们之前判断不行

我之前的判断错在：只想到「`execve` 被禁 ⇒ 无法加载 ELF」，漏掉了**虚拟机不需要 exec**。

```
libqemu-system-aarch64.so   ← QEMU 编译成 .so，在进程内 dlopen 加载
  + kernel_aarch64           ← 完整 arm64 Linux 内核
  + rootfs_aarch64.qcow2     ← Alpine 根文件系统
```

QEMU **自己解释执行 CPU 指令**，Linux 内核在它模拟的虚拟 CPU 上跑。全程一个进程，不 fork、不 exec。

### 手机端的代价

> 官方 README：**JIT（Pad/2in1 设备支持，Phone 设备不支持）**

| 设备 | 加速方式 | 性能 |
| --- | --- | --- |
| PC / 平板 | QEMU + JIT | 可用 |
| **手机（应用市场版）** | QEMU + TCI 解释器 | **很慢** |
| 手机（自行签名） | QEMU + JIT | 好些，但上不了应用市场 |

构建参数：`make aarch64-tci` 生成 `libqemu-system-aarch64-tci.so`（不依赖 JIT）。

---

## 二、组件清单（已从 release-20260516 解出）

```
libs/arm64-v8a/
  libqemu-system-aarch64.so   39.5 MB   ← QEMU 主体
  libqemu-img.so               4.4 MB   ← 镜像管理
  libslirp.so.0                0.2 MB   ← 用户态网络
  libentry.so                  1.2 MB   ← napi 桥（接口见下）
  libc++_shared.so             1.2 MB
  libzstdnapi.so               0.6 MB

resources/rawfile/
  vm/kernel_aarch64           12.4 MB   ← Linux 6.12 内核
  vm/rootfs_aarch64.qcow2     46.4 MB   ← Alpine 根文件系统
```

**总计约 105 MB**（不含文档图片）。

---

## 三、napi 接口（完整，来自 `Index.d.ts`）

```typescript
export type NapiVmOptions = {
  argsLines: string      // QEMU 命令行（空格分隔）
  unixSocket: string     // 串口 socket 路径
  qmpSocket: string      // QMP 控制 socket 路径
  supportJit: boolean
}

export const startVM: (options: NapiVmOptions) => boolean;
export const onData: (callback: (ArrayBuffer) => void) => void;
export const onShutdown: (callback: () => void) => void;
export const sendInput: (content: ArrayBuffer) => void;
```

**四个函数就能跑起来**：启动、收串口输出、收关机事件、发键盘输入。

其余是可选能力（需要时再接）：VNC 画面、快照管理、镜像优化、端口检测。

---

## 四、QEMU 命令行（完整，来自 `startVm.ets`）

核心几段：

```
# 机器与 CPU
-machine virt,acpi=on,gic-version=max,iommu=none,its=off,usb=off,virtualization=off,
         memory-backend=mem0,compact-highmem=on,dump-guest-core=off,mem-merge=off,hmat=off
-cpu max,pauth-impdef=on,sve=off,pmu=off
-accel tcg,thread=multi,tb-size=2048        # 关键：TCG 多线程 + 2GB 翻译缓存
-smp cpus=N,sockets=1,cores=N,threads=1
-object memory-backend-ram,id=mem0,size=NM,merge=off,prealloc=off -m NM

# 内核与根文件系统
-kernel <kernel_aarch64>
-append "root=/dev/vda rw rootfstype=ext4 console=ttyAMA0 ... init=<init>"
-drive if=none,format=qcow2,file=<rootfs.qcow2>,id=hd0,cache=writeback,aio=threads,discard=unmap
-device virtio-scsi-pci-non-transitional,id=scsi0,num_queues=N,virtqueue_size=256,iothread=iothread0
-device scsi-hd,drive=hd0,bus=scsi0.0,logical_block_size=4096,bootindex=1

# I/O 通道（三个 unix socket）
-serial unix:<serial.sock>,server,nowait      # 终端串口
-qmp unix:<qmp.sock>,server,nowait            # 控制接口
-chardev socket,path=<qga.sock>,server=on,wait=off,id=qga0
-device virtserialport,chardev=qga0,name=org.qemu.guest_agent.0

# 网络与共享目录
-netdev user,id=eth0,hostfwd=tcp::<host>-:<guest>
-fsdev local,security_model=mapped-file,id=fsdev0,path=<shared>,mount_tag=hostshare
-device virtio-9p-pci,id=fs0,fsdev=fsdev0,mount_tag=hostshare
```

**关键洞察**：

- `-accel tcg,thread=multi` —— 这是我们能改性能的抓手
- `-serial unix:<sock>` —— 终端 I/O 走 socket，**不用 VNC 也能有 shell**
- `-fsdev local,...,path=<shared>` —— **共享目录就是我们的工作区**，宿主写文件，VM 里能读到

---

## 五、合并方案

### 架构

```
┌─ 我们的 App ────────────────────────────────┐
│  ArkTS 层                                    │
│    ├─ ShellBridge（已有）                    │
│    └─ QemuBridge（新增）                     │
│         ├─ startVM / sendInput / onData      │
│         └─ LocalSocket 连 serial.sock        │
│                                              │
│  Web 层（React）                             │
│    ├─ 现有对话界面                           │
│    └─ 终端面板（新增，xterm.js）             │
│         └─ run_sandbox 工具 → 走 Linux       │
└──────────────────────────────────────────────┘
```

### 与现有工作区的关系（这是最大的价值点）

**把 `filesDir/workspace` 挂成 9p 共享目录**：

```
宿主 filesDir/workspace/files  ←─ 9p ─→  VM 里 /mnt/hostshare
```

这样：

- agent 用现有 `workspace_edit` 改文件 → VM 里立刻可见
- VM 里 `git commit` → 工作区面板立刻看到 diff
- **两套工具共用一个文件系统，不用同步**

---

## 六、实施阶段

### 阶段 1：跑起来（1-2 天）

目标：App 里打开终端，输入 `ls /` 有输出。

- [ ] 复制 6 个 `.so` 到 `entry/libs/arm64-v8a/`
- [ ] 复制 `kernel_aarch64` 与 `rootfs_aarch64.qcow2` 到 `rawfile/vm/`
- [ ] 首次启动时从 rawfile 解到沙箱（rawfile 不能直接给 QEMU 当路径）
- [ ] 写 `QemuBridge.ets`：拼命令行 + startVM
- [ ] LocalSocket 连 serial.sock，收发数据
- [ ] Web 层加终端页（xterm.js）

**验收**：终端里 `uname -a` 输出 Linux 版本。

### 阶段 2：挂共享目录（1 天）

- [ ] `-fsdev ... path=<filesDir>/workspace/files`
- [ ] VM 里 `mount -t 9p hostshare /mnt`
- [ ] 验证两边互见

**验收**：Web 界面改一个文件，终端里 `cat` 能看到。

### 阶段 3：接成工具（1 天）

- [ ] `run_sandbox({ runtime: 'linux', cmd: 'git status' })`
- [ ] 通过 QGA 执行命令拿 stdout（比走串口解析干净）
- [ ] 超时控制

**验收**：发「用 git 看看工作区有什么改动」，返回真实 `git status` 输出。

### 阶段 4：性能（可选）

- [ ] 检测是否支持 JIT（`deviceInfo` 判断设备类型）
- [ ] 支持则用 JIT 版 so，否则 TCI
- [ ] CPU 核数按设备规格给（`-smp`）

---

## 七、风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 包体积 +105 MB | 安装包巨大 | 内核与 rootfs 首次启动时下载，不内置；或分渠道包 |
| 手机无 JIT 很慢 | 交互卡顿 | 用 TCI；复杂任务放后台；给用户预期 |
| `libentry.so` 是 HiSH 的 | 接口可能不通用 | 接口已确认单纯（4 个函数），可直接复用 |
| 应用市场审核 | 可能被拒 | 自行签名分发；或只上 PC/平板渠道 |
| QEMU 崩溃拖垮主 App | 整个 App 挂 | QEMU 跑在子进程（需 fork 权限）或接受风险 |

---

## 八、许可

HiSH 是开源项目，README 写明：

> 使用本项目代码，按照惯例需在软件本体「关于」中注明基于本项目（HiSH）以及本项目的仓库地址。

**必须做**：App 的「关于」页加上 HiSH 与 qemu-ohos 的署名和仓库链接。

---

## 九、和原 WASM 方案的关系

| 方案 | 优势 | 劣势 | 结论 |
| --- | --- | --- | --- |
| WASM（Pyodide） | 轻、快、无需审核 | 只能跑特定语言 | **先做，兜底** |
| QEMU Linux | 完整环境、真 git/python | 105MB、手机慢 | **后做，增强** |

**两个都要，分先后。** WASM 解决 80% 的日常需求且体验好；Linux 解决「必须真环境」的场景（编译、docker、复杂依赖）。

---

*写于 2026-11-27 01:00*
*依据：HiSH release-20260516 实际解包 + GitHub 源码（startVm.ets / Index.d.ts / QemuAgent.ets）*