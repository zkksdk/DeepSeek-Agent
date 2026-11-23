# 扩展打包产物

| 文件 | 用途 |
| --- | --- |
| `deepseek-agent-bridge-1.0.0.zip` | 解压后通过「加载已解压的扩展程序」安装 |
| `deepseek-agent-bridge-1.0.0.crx` | 已签名包，供企业策略分发或 Chromium 命令行安装 |

桌面版 Chrome 不再允许拖入非商店来源的 crx，日常使用请选解压加载。

`agent-bridge.pem` 是打包时生成的签名私钥，**不提交**。重新打包时如果换用新私钥，扩展 ID 会变化，需要在 Agent 面板里重新确认连接。
