"""rich 终端面板：连接状态、工具调用日志与本地 MCP 概况。"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from rich.align import Align
from rich.console import Console, Group, RenderableType
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import tools
from .config import Settings
from .server import AppState


class Dashboard:
    def __init__(self, state: AppState, *, web_url: str | None = None, tui: bool = True) -> None:
        self.state = state
        self.web_url = web_url
        self.console = Console(highlight=False)
        self.tui = tui and self.console.is_terminal
        self._live: Live | None = None

    # ---------- 视图 ----------
    def _header(self) -> RenderableType:
        settings = self.state.settings
        text = Text()
        text.append("  AgentDesk  ", style="bold white on #3964FE")
        text.append("  本机能力运行中  ", style="bold #3964FE")
        text.append(f"ws://{settings.host}:{settings.port}", style="dim")
        return Align.left(text)

    def _overview(self) -> RenderableType:
        settings = self.state.settings
        table = Table.grid(padding=(0, 2))
        table.add_column(style="dim", no_wrap=True)
        table.add_column(style="bold")
        table.add_row("访问令牌", Text(settings.token, style="bold yellow"))
        table.add_row("沙箱目录", Text(str(settings.sandbox), style="#4EC87E"))
        table.add_row("网页连接", Text(str(self.state.connections), style="#679EFE"))
        table.add_row(
            "本地 MCP",
            Text(
                f"{sum(1 for s in self.state.hub.status() if s['status'] == 'ready')} / {len(self.state.hub.servers)} 已连接",
                style="#679EFE",
            ),
        )
        if self.web_url:
            table.add_row("打开网页", Text(self.web_url, style="underline #679EFE"))
        return Panel(table, title="[bold]连接信息[/]", border_style="#3964FE", padding=(0, 1))

    def _stats(self) -> RenderableType:
        uptime = int(time.time() - self.state.started_at)
        minutes, seconds = divmod(max(0, uptime), 60)
        table = Table.grid(padding=(0, 2))
        table.add_column(style="dim", no_wrap=True)
        table.add_column(style="bold", justify="right")
        table.add_row("运行时长", f"{minutes:02d}:{seconds:02d}")
        table.add_row("工具调用", str(self.state.calls))
        table.add_row("失败", Text(str(self.state.failures), style="#F25A5A" if self.state.failures else "dim"))
        table.add_row("工具总数", str(len(self.state.hub.definitions()) + len(tools.definitions())))
        return Panel(table, title="[bold]运行统计[/]", border_style="#3F3F46", padding=(0, 1))

    def _logs(self) -> RenderableType:
        table = Table(expand=True, box=None, padding=(0, 1), show_edge=False)
        table.add_column("时间", style="dim", width=8, no_wrap=True)
        table.add_column("工具", style="#679EFE", width=16, no_wrap=True)
        table.add_column("详情", overflow="ellipsis", no_wrap=True)
        table.add_column("耗时", justify="right", width=7, style="dim")
        table.add_column("", width=4)
        entries = list(self.state.logs)[-12:]
        if not entries:
            table.add_row("", "等待调用", Text("在网页里让 Agent 使用本机工具", style="dim"), "", "")
        for entry in reversed(entries):
            table.add_row(
                entry.at,
                entry.tool.replace("desk_", ""),
                entry.detail,
                f"{entry.ms}ms",
                Text("✓", style="#4EC87E") if entry.ok else Text("✗", style="#F25A5A"),
            )
        return Panel(table, title="[bold]工具调用[/]", border_style="#3F3F46", padding=(0, 1))

    def _mcp(self) -> RenderableType:
        servers = self.state.hub.status()
        if not servers:
            body: RenderableType = Text("未配置本地 MCP。把 mcp.json 放到项目根目录或 ~/.agentdesk/mcp.json。", style="dim")
        else:
            table = Table(box=None, expand=True, padding=(0, 1))
            table.add_column("服务器", style="bold")
            table.add_column("状态", width=10)
            table.add_column("工具", justify="right", width=6)
            table.add_column("说明", overflow="ellipsis")
            for server in servers:
                status = server["status"]
                style = {"ready": "#4EC87E", "error": "#F25A5A"}.get(status, "yellow")
                table.add_row(
                    server["name"],
                    Text(status, style=style),
                    str(server["tools"]),
                    server["error"] or "",
                )
            body = table
        return Panel(body, title="[bold]本地 MCP[/]", border_style="#3F3F46", padding=(0, 1))

    def _footer(self) -> RenderableType:
        return Align.center(
            Text("把令牌填入网页的「Agent 能力 → 桌面端」；Ctrl+C 退出", style="dim")
        )

    def render(self) -> RenderableType:
        layout = Layout()
        layout.split_column(
            Layout(self._header(), size=1),
            Layout(name="top", size=8),
            Layout(name="logs", ratio=1),
            Layout(self._mcp(), size=6),
            Layout(self._footer(), size=1),
        )
        layout["top"].split_row(Layout(self._overview()), Layout(self._stats(), size=34))
        layout["logs"].update(self._logs())
        return layout

    # ---------- 运行 ----------
    async def run(self) -> None:
        if not self.tui:
            await self._plain()
            return
        with Live(self.render(), console=self.console, refresh_per_second=4, screen=False) as live:
            self._live = live
            while True:
                live.update(self.render())
                await asyncio.sleep(0.35)

    async def _plain(self) -> None:
        settings = self.state.settings
        self.console.print(f"[bold]AgentDesk[/] ws://{settings.host}:{settings.port}")
        self.console.print(f"令牌: [bold yellow]{settings.token}[/]")
        self.console.print(f"沙箱: {settings.sandbox}")
        if self.web_url:
            self.console.print(f"打开: {self.web_url}")
        while True:
            await asyncio.sleep(3600)


def banner(settings: Settings, web_url: str | None) -> str:
    lines = [
        "",
        "  AgentDesk · 本机 Agent 能力",
        f"  端点  ws://{settings.host}:{settings.port}",
        f"  令牌  {settings.token}",
        f"  沙箱  {settings.sandbox}",
    ]
    if web_url:
        lines.append(f"  网页  {web_url}")
    lines.append("")
    return "\n".join(lines)
