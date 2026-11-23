"""内置工具与扩展工具合并后的清单校验。"""

from __future__ import annotations

from agentdesk import tools


def test_definitions_unique_and_exposed() -> None:
    items = tools.definitions()
    names = [item["name"] for item in items]
    assert len(names) == len(set(names))
    assert all(name.startswith("desk_") for name in names)


def test_core_tools_present() -> None:
    names = {item["name"] for item in tools.definitions()}
    for expected in ("desk_fs_read", "desk_fs_write", "desk_shell_exec", "desk_python_exec"):
        assert expected in names


def test_extended_tools_merged() -> None:
    names = {item["name"] for item in tools.definitions()}
    for expected in ("desk_grep", "desk_hash", "desk_archive", "desk_git"):
        assert expected in names


def test_blocked_command_patterns() -> None:
    assert tools._is_blocked("rm -rf /") is not None
    assert tools._is_blocked("echo hello") is None
