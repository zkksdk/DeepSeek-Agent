"""新增移植工具的测试：JSON / 文本 / cron / 系统 / HTTP / 替换。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agentdesk import tools_port
from agentdesk.config import Settings
from agentdesk.sandbox import Sandbox


def run(name: str, args: dict, sandbox: Sandbox, settings: Settings) -> dict:
    return asyncio.run(tools_port.dispatch(name, args, sandbox, settings))


def text_of(result: dict) -> str:
    return "\n".join(item.get("text", "") for item in result["content"] if item.get("type") == "text")


def test_json_format_and_diff(sandbox: Sandbox, settings: Settings) -> None:
    pretty = text_of(run("desk_json", {"action": "format", "text": '{"a":1}'}, sandbox, settings))
    assert '"a": 1' in pretty
    diff = text_of(
        run(
            "desk_json",
            {"action": "diff", "text": '{"a":1,"b":2}', "other": '{"a":1,"b":3,"c":4}'},
            sandbox,
            settings,
        )
    )
    assert ".b" in diff and ".c" in diff
    assert "合法" in text_of(run("desk_json", {"action": "validate", "text": "[1,2]"}, sandbox, settings))


def test_text_word_frequency_and_template(sandbox: Sandbox, settings: Settings) -> None:
    freq = text_of(
        run(
            "desk_text",
            {"action": "word_frequency", "text": "hello hello 世界 世界 世界", "top": 5},
            sandbox,
            settings,
        )
    )
    assert "hello" in freq and "世界" in freq
    rendered = text_of(
        run(
            "desk_text",
            {"action": "template", "template": "Hi {{user.name}}", "variables": {"user": {"name": "Ada"}}},
            sandbox,
            settings,
        )
    )
    assert rendered == "Hi Ada"


def test_text_dedupe_and_strip(sandbox: Sandbox, settings: Settings) -> None:
    deduped = text_of(
        run("desk_text", {"action": "dedupe", "text": "a\nA\nb\n"}, sandbox, settings)
    )
    assert "去重后 3 行" in deduped
    insensitive = text_of(
        run(
            "desk_text",
            {"action": "dedupe", "text": "a\nA\nb\n", "case_insensitive": True},
            sandbox,
            settings,
        )
    )
    assert "去重后 2 行" in insensitive
    stripped = text_of(
        run("desk_text", {"action": "strip_invisible", "text": "a\u200bb\x00c"}, sandbox, settings)
    )
    assert "abc" in stripped
    ansi = text_of(
        run("desk_text", {"action": "strip_ansi", "text": "\u001b[31mred\u001b[0m"}, sandbox, settings)
    )
    assert ansi.endswith("red")


def test_cron_next(sandbox: Sandbox, settings: Settings) -> None:
    result = text_of(
        run(
            "desk_cron",
            {"expression": "0 9 * * 1-5", "count": 2, "start": "2026-11-22T10:00:00"},
            sandbox,
            settings,
        )
    )
    assert "09:00" in result
    assert result.count("09:00") == 2


def test_system_info(sandbox: Sandbox, settings: Settings) -> None:
    env = text_of(run("desk_system", {"action": "env"}, sandbox, settings))
    assert "Python" in env and "沙箱根目录" in env
    disk = text_of(run("desk_system", {"action": "disk"}, sandbox, settings))
    assert "总计" in disk and "可用" in disk


def test_http_blocks_private_hosts(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(Exception):
        run("desk_http", {"url": "http://127.0.0.1:8080/"}, sandbox, settings)
    with pytest.raises(Exception):
        run("desk_http", {"url": "http://localhost/"}, sandbox, settings)


def test_replace_preview_then_apply(sandbox: Sandbox, settings: Settings, tmp_path: Path) -> None:
    target = sandbox.root / "a.txt"
    target.write_text("hello world\nhello again\n", encoding="utf-8")
    preview = text_of(
        run(
            "desk_replace",
            {"path": "a.txt", "pattern": "hello", "replacement": "hi"},
            sandbox,
            settings,
        )
    )
    assert "未写入" in preview
    assert target.read_text(encoding="utf-8").startswith("hello")
    applied = text_of(
        run(
            "desk_replace",
            {"path": "a.txt", "pattern": "hello", "replacement": "hi", "dry_run": False},
            sandbox,
            settings,
        )
    )
    assert "已写入" in applied
    assert target.read_text(encoding="utf-8").startswith("hi")
