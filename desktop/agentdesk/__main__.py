"""AgentDesk：把本机文件、命令与 Python 能力安全地交给浏览器里的 Agent。"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import quote

from .config import (
    APP_NAME,
    Settings,
    default_allowed_paths,
    default_sandbox,
    load_mcp_servers,
    load_token,
)
from .mcp_bridge import McpHub
from .server import AgentServer, AppState
from .tui import Dashboard, banner


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog=APP_NAME,
        description="把本机文件、命令、Python 与本地 MCP 暴露给网页 Agent。",
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认只允许本机")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket 端口，默认 8765")
    parser.add_argument("--sandbox", type=Path, default=None, help="工作目录，所有文件操作限制在此")
    parser.add_argument(
        "--allow-path",
        type=Path,
        action="append",
        default=[],
        help="额外放行的目录，可重复；默认已放行 ~/.skills",
    )
    parser.add_argument("--token", default=None, help="固定访问令牌；默认自动生成并保存在 ~/.agentdesk")
    parser.add_argument("--new-token", action="store_true", help="重新生成访问令牌")
    parser.add_argument("--no-shell", action="store_true", help="禁用命令执行与 Python 执行")
    parser.add_argument("--serve-web", type=Path, default=None, help="同时托管构建产物 dist 目录")
    parser.add_argument("--web-port", type=int, default=8890, help="静态站点端口，默认 8890")
    parser.add_argument("--mcp-config", type=Path, default=None, help="本地 MCP 配置 mcp.json")
    parser.add_argument("--allow-origin", action="append", default=[], help="额外允许的网页来源，可重复")
    parser.add_argument("--no-tui", action="store_true", help="不渲染面板，仅输出日志")
    return parser.parse_args(argv)


def build_settings(args: argparse.Namespace) -> Settings:
    sandbox = (args.sandbox or default_sandbox()).expanduser()
    token = args.token or load_token(refresh=args.new_token)
    web_root = args.serve_web.expanduser().resolve() if args.serve_web else None
    if web_root and not (web_root / "index.html").exists():
        raise SystemExit(f"{web_root} 下没有 index.html，请先执行 pnpm build")
    # 默认放行 ~/.skills，命令行再用 --allow-path 追加
    allowed_paths = [*default_allowed_paths(), *args.allow_path]
    return Settings(
        host=args.host,
        port=args.port,
        token=token,
        sandbox=sandbox,
        allowed_paths=allowed_paths,
        web_root=web_root,
        web_port=args.web_port,
        allowed_origins=args.allow_origin,
        mcp_config=args.mcp_config,
        allow_shell=not args.no_shell,
    )


async def main_async(args: argparse.Namespace) -> int:
    settings = build_settings(args)
    hub = McpHub()
    configs = load_mcp_servers(settings.mcp_config)
    if configs:
        await hub.start_all(configs)

    state = AppState(settings=settings, hub=hub)
    server = AgentServer(state)

    web_url = None
    if settings.web_root:
        web_url = (
            f"http://localhost:{settings.web_port}/?desktop="
            f"{quote(f'ws://{settings.host}:{settings.port}')}&token={quote(settings.token)}"
        )
    else:
        web_url = (
            f"http://localhost:8090/?desktop="
            f"{quote(f'ws://{settings.host}:{settings.port}')}&token={quote(settings.token)}"
        )

    print(banner(settings, web_url))
    dashboard = Dashboard(state, web_url=web_url if settings.web_root else None, tui=not args.no_tui)

    serve_task = asyncio.create_task(server.run())
    ui_task = asyncio.create_task(dashboard.run())
    try:
        await asyncio.gather(serve_task, ui_task)
    except asyncio.CancelledError:
        pass
    finally:
        await hub.stop_all()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n已退出 AgentDesk。")
        return 0


if __name__ == "__main__":
    sys.exit(main())
