"""沙箱边界：任何文件工具都不能越过工作目录。"""

from __future__ import annotations

import pytest

from agentdesk.sandbox import Sandbox, SandboxError


def test_resolve_relative_path(sandbox: Sandbox) -> None:
    path = sandbox.resolve("src/app.ts")
    assert path == sandbox.root / "src" / "app.ts"


def test_resolve_rejects_parent_escape(sandbox: Sandbox) -> None:
    with pytest.raises(SandboxError):
        sandbox.resolve("../outside.txt")


def test_resolve_rejects_absolute_escape(sandbox: Sandbox) -> None:
    with pytest.raises(SandboxError):
        sandbox.resolve("/etc/passwd")


def test_resolve_requires_existing(sandbox: Sandbox) -> None:
    with pytest.raises(SandboxError):
        sandbox.resolve("missing.txt", must_exist=True)


def test_allowed_directory_is_reachable(sandbox: Sandbox, tmp_path) -> None:
    extra = tmp_path / "skills"
    extra.mkdir()
    widened = Sandbox(sandbox.root, [extra])
    assert widened.resolve(str(extra)).name == "skills"
