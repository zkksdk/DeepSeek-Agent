"""把 Dashboard 渲染成图片用的 HTML（演示数据）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
import term_shot  # noqa: E402
from agentdesk.config import Settings
from agentdesk.server import AppState
from agentdesk.tui import Dashboard


class FakeServer:
    def __init__(self, name, status, error="", tools=0):
        self.name, self.status, self.error, self.tool_count = name, status, error, tools

    @property
    def tools(self):
        return list(range(self.tool_count))


class FakeHub:
    def __init__(self):
        self.servers = {
            "filesystem": FakeServer("filesystem", "ready", tools=11),
            "github": FakeServer("github", "ready", tools=26),
            "sqlite": FakeServer("sqlite", "error", error="spawn npx ENOENT", tools=0),
        }

    def status(self):
        return [
            {"name": s.name, "status": s.status, "error": s.error, "tools": s.tool_count}
            for s in self.servers.values()
        ]

    def definitions(self):
        return [1] * 37


LOGS = [
    ("13:02:11", "desk_fs_read", "读取 README.md（1.8 KB）", 12, True),
    ("13:02:14", "desk_shell_exec", "pnpm test --filter core", 8402, True),
    ("13:02:29", "desk_fs_write", "写入 reports/bench.md", 21, True),
    ("13:02:41", "desk_python_exec", "分析 CSV，输出 3 张图", 2317, True),
    ("13:03:02", "desk_mcp_filesystem_read_file", "读取 package.json", 33, True),
    ("13:03:18", "desk_fs_list", "列出 src/components（18 项）", 9, True),
    ("13:03:26", "desk_shell_exec", "git status --short", 140, True),
    ("13:03:39", "desk_fs_delete", "删除 .cache/tmp-8f2.bin", 7, True),
    ("13:03:51", "desk_python_exec", "ModuleNotFoundError: pandas", 511, False),
    ("13:04:05", "desk_fs_move", "renamed draft.md → final.md", 11, True),
    ("13:04:19", "desk_system_info", "进程 214 · 内存 38%", 4, True),
    ("13:04:33", "desk_shell_exec", "pnpm build", 15604, True),
]


def build(path: str = "tui.png", width: int = 112, height: int = 36) -> None:
    settings = Settings(port=8765, token="K7pQm2xR9tLw4bZc", sandbox=Path("/Users/you/AgentWorkspace"))
    state = AppState(settings=settings, hub=FakeHub())
    for at, tool, detail, ms, ok in LOGS:
        state.logs.append(type("L", (), {"at": at, "tool": tool, "detail": detail, "ms": ms, "ok": ok})())
    state.calls, state.failures, state.connections = len(LOGS), 1, 1

    ansi = term_shot.capture(
        Dashboard(state, web_url="http://localhost:8890/", tui=False).render(), width=width, height=height
    )
    term_shot.render(ansi).save(path)


if __name__ == "__main__":
    build()
    print("done")
