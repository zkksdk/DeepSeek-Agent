"""测试夹具：给每个用例一个独立的沙箱目录，避免互相污染。"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 允许直接从仓库里跑 pytest，不必先安装包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agentdesk.config import Settings  # noqa: E402
from agentdesk.sandbox import Sandbox  # noqa: E402


@pytest.fixture()
def sandbox(tmp_path: Path) -> Sandbox:
    root = tmp_path / "workspace"
    root.mkdir()
    return Sandbox(root)


@pytest.fixture()
def settings(tmp_path: Path, sandbox: Sandbox) -> Settings:
    return Settings(sandbox=sandbox.root, allowed_paths=[])
