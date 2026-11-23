"""目录沙箱：文件操作必须落在工作目录或明确放行的目录内，符号链接也按真实路径校验。"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path


class SandboxError(Exception):
    """路径越界或不可访问"""


class Sandbox:
    def __init__(self, root: Path, allowed: Iterable[Path] | None = None) -> None:
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        # 额外放行的目录（默认是 ~/.skills）：读取技能说明与脚本时需要越过工作目录
        self.allowed = tuple(Path(path).expanduser().resolve() for path in allowed or ())

    def resolve(self, raw: str, *, must_exist: bool = False) -> Path:
        if not raw or not str(raw).strip():
            raise SandboxError("路径不能为空")
        target = Path(os.path.expanduser(str(raw).strip()))
        if not target.is_absolute():
            target = self.root / target
        try:
            resolved = target.resolve()
        except OSError as error:
            raise SandboxError(f"无法解析路径：{error}") from error
        if not self._inside(resolved):
            raise SandboxError(
                f"路径超出沙箱范围：{resolved}。当前工作目录是 {self.root}，"
                f"请使用相对路径{self._allowed_hint()}。"
            )
        if must_exist and not resolved.exists():
            raise SandboxError(f"路径不存在：{self.relative(resolved)}")
        return resolved

    def _inside(self, path: Path) -> bool:
        try:
            if path == self.root or self.root in path.parents:
                return True
            return any(path == extra or extra in path.parents for extra in self.allowed)
        except OSError:
            return False

    def _allowed_hint(self) -> str:
        if not self.allowed:
            return ""
        names = "、".join(self.label(extra) for extra in self.allowed)
        return f"，或使用已放行的目录（{names}）"

    def label(self, path: Path) -> str:
        """把放行目录显示成 ~/xxx，比绝对路径好读。"""
        try:
            return f"~/{path.relative_to(Path.home()).as_posix()}"
        except ValueError:
            return str(path)

    def relative(self, path: Path) -> str:
        """沙箱内显示相对路径，放行目录里显示 ~/...，其余保持绝对路径。"""
        try:
            rel = path.relative_to(self.root)
        except ValueError:
            return self.label(path) if self._inside(path) else str(path)
        return "." if str(rel) == "." else str(rel)

    def switch_root(self, target: Path, allowed: Iterable[Path]) -> Path:
        """切换工作区：只接受配置里出现过的目录，切换后所有相对路径都按新根解析。"""
        resolved = Path(target).expanduser().resolve()
        options = {Path(item).expanduser().resolve() for item in allowed}
        if resolved not in options:
            raise SandboxError(f"不在可用工作区列表里：{resolved}")
        resolved.mkdir(parents=True, exist_ok=True)
        self.root = resolved
        return resolved

    def ensure_parent(self, path: Path) -> None:
        parent = path.parent
        parent.mkdir(parents=True, exist_ok=True)
        if not self._inside(parent.resolve()):
            raise SandboxError("父目录超出沙箱范围")
