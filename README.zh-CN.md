# DeepSeek Agent

[English](README.en.md) | 简体中文

一个带完整 agent 能力的 DeepSeek 客户端：工具调用循环、Python 桌面桥、Chrome 扩展桥、MCP 服务器、多工作区 diff、后台任务与子 agent。

不需要应用后端 —— 浏览器直接请求配置好的 API 服务。

## 这个仓库

它是 [Aoan2011/DeepSeek-Agent](https://github.com/Aoan2011/DeepSeek-Agent) 的 fork，额外加了一层 **HarmonyOS NEXT 原生壳**（`harmony/`），把 web 产物装进 ArkWeb 容器跑在手机上。

构建方式、实测结论、以及哪些能力在手机上跑不了，见 [HARMONY.md](HARMONY.md)。
为什么会这样做，见 [harmony/CHANGELOG.md](harmony/CHANGELOG.md)。

## 快速开始（web）

```sh
pnpm install
pnpm dev
```

打开页面后填入 DeepSeek API Key 即可。

## 更多

- 上游说明：[README.en.md](README.en.md)
- 鸿蒙壳：[HARMONY.md](HARMONY.md)
