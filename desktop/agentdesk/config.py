"""配置、令牌与本地 MCP 清单的读取。"""

from __future__ import annotations

import json
import os
import secrets
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "agentdesk"


def app_dir() -> Path:
    custom = os.environ.get("AGENTDESK_HOME")
    base = Path(custom).expanduser() if custom else Path.home() / f".{APP_NAME}"
    base.mkdir(parents=True, exist_ok=True)
    return base


def config_path() -> Path:
    return app_dir() / "config.json"


def _is_app_dir(path: Path) -> bool:
    """只有应用自己的配置目录要排除，隐藏目录可能是用户故意选的工作区。"""
    try:
        return path.expanduser().resolve() == app_dir().resolve()
    except OSError:
        return False


def default_sandbox() -> Path:
    """沙箱根；如果不小心指到了应用自己的配置目录，退回默认工作区。"""
    raw = Path(os.environ.get("AGENTDESK_SANDBOX", Path.home() / "AgentWorkspace")).expanduser()
    if _is_app_dir(raw):
        return Path.home() / "AgentWorkspace"
    return raw


def default_workspaces() -> list[Path]:
    """可切换的工作区：沙箱根 + AGENTDESK_WORKSPACES（用系统分隔符分隔）。"""
    roots = [default_sandbox()]
    extra = os.environ.get("AGENTDESK_WORKSPACES", "")
    for item in extra.split(os.pathsep):
        text = item.strip()
        if text:
            candidate = Path(text).expanduser()
            if not _is_app_dir(candidate):
                roots.append(candidate)
    return roots


def read_config() -> dict:
    try:
        return json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def default_allowed_paths() -> list[Path]:
    """~/.skills 默认放行：Agent 需要直接读技能说明与脚本，否则一切都被关在沙箱里。"""
    custom = os.environ.get("AGENTDESK_SKILLS")
    return [Path(custom).expanduser() if custom else Path.home() / ".skills"]


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    token: str = ""
    sandbox: Path = field(default_factory=default_sandbox)
    # 除沙箱外额外放行的目录
    allowed_paths: list[Path] = field(default_factory=default_allowed_paths)
    web_root: Path | None = None
    web_port: int = 8890
    allowed_origins: list[str] = field(default_factory=list)
    mcp_config: Path | None = None
    allow_shell: bool = True
    max_output: int = 200_000
    # 可在运行中切换的工作区；第一个是默认，切换只改沙箱根目录
    workspaces: list[Path] = field(default_factory=default_workspaces)

    def configured_workspaces(self) -> list[Path]:
        """合并当前沙箱、命令行与 config.json 里的 workspaces，去重并保持顺序。

        当前沙箱永远排在第一个：用 --sandbox 指定的目录以前不会出现在列表里，
        网页端只能显示旧的默认工作区，看起来像是「怎么设置都不生效」。
        只排除应用自己的配置目录（~/.agentdesk），隐藏目录只要用户明确指定就保留。
        """
        candidates = [
            self.sandbox,
            *self.workspaces,
            *[
                Path(item).expanduser()
                for item in read_config().get("workspaces", [])
                if isinstance(item, str)
            ],
        ]
        roots: list[Path] = []
        config_dir = app_dir().resolve()
        for path in candidates:
            try:
                resolved = path.expanduser().resolve()
            except OSError:
                continue
            if resolved == config_dir:
                continue
            if resolved not in roots:
                roots.append(resolved)
        if not roots:
            roots.append(default_sandbox().resolve())
        return roots

    def describe(self) -> dict:
        current = self.sandbox.expanduser().resolve()
        return {
            "name": "AgentDesk",
            "version": "1.0.0",
            "platform": f"{sys.platform} · Python {sys.version.split()[0]}",
            "sandbox": str(current),
            "allowed": [str(path) for path in self.allowed_paths],
            "workspaces": [
                {"name": path.name or str(path), "path": str(path), "current": path == current}
                for path in self.configured_workspaces()
            ],
            "capabilities": ["files", "shell", "python", "mcp"],
        }


def read_config_file() -> dict:
    path = config_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def load_token(*, refresh: bool = False) -> str:
    """读取或生成访问令牌；令牌只保存在用户目录，权限 0600。"""
    data = read_config_file()
    token = "" if refresh else str(data.get("token", ""))
    if not token:
        token = secrets.token_urlsafe(18)
        data["token"] = token
        save_config(data)
    return token


def save_config(data: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def load_mcp_servers(path: Path | None) -> dict[str, dict]:
    """
    读取 MCP 配置。支持 Claude Desktop 风格：
    {"mcpServers": {"name": {"command": "...", "args": [], "env": {}}}}
    默认查找 --mcp-config 指定的文件、./mcp.json、~/.agentdesk/mcp.json。
    """
    candidates: list[Path] = []
    if path:
        candidates.append(path)
    else:
        candidates.extend([Path.cwd() / "mcp.json", app_dir() / "mcp.json"])
    for candidate in candidates:
        try:
            if not candidate.exists():
                continue
            payload = json.loads(candidate.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        servers = payload.get("mcpServers", payload)
        if not isinstance(servers, dict):
            continue
        result: dict[str, dict] = {}
        for name, item in servers.items():
            if not isinstance(item, dict) or not item.get("command"):
                continue
            if item.get("disabled") is True:
                continue
            result[str(name)] = item
        if result:
            return result
    return {}


ORIGIN_HINT = (
    "允许的来源：https://*.github.io、http://localhost:*、http://127.0.0.1:*、file://"
)
