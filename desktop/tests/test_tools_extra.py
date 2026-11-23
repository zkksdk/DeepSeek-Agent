"""扩展工具集的单元测试：全部走公开的 definitions / dispatch 入口。"""

from __future__ import annotations

import asyncio
import json
import zipfile
from pathlib import Path

import pytest

from agentdesk import tools_extra
from agentdesk.config import Settings
from agentdesk.sandbox import Sandbox


def run(name: str, args: dict, sandbox: Sandbox, settings: Settings) -> dict:
    return asyncio.run(tools_extra.dispatch(name, args, sandbox, settings))


def text_of(result: dict) -> str:
    return "\n".join(item.get("text", "") for item in result["content"] if item.get("type") == "text")


def test_definitions_are_well_formed() -> None:
    items = tools_extra.definitions()
    names = [item["name"] for item in items]
    assert len(names) == len(set(names)), "工具名不能重复"
    for item in items:
        assert item["name"].startswith("desk_")
        assert item["inputSchema"]["type"] == "object"
        assert isinstance(item.get("description"), str) and item["description"]


def test_unknown_tool_returns_none(sandbox: Sandbox, settings: Settings) -> None:
    assert run("desk_not_exists", {}, sandbox, settings) is None


def test_hash_text_and_file(sandbox: Sandbox, settings: Settings) -> None:
    result = run("desk_hash", {"text": "hello", "algorithm": "sha256"}, sandbox, settings)
    assert "2cf24dba5fb0a30e26e83b2ac5b9e29e" in text_of(result)

    target = sandbox.root / "a.txt"
    target.write_text("hello", encoding="utf-8")
    from_file = run("desk_hash", {"path": "a.txt"}, sandbox, settings)
    assert "2cf24dba5fb0a30e26e83b2ac5b9e29e" in text_of(from_file)


def test_hash_base64_roundtrip(sandbox: Sandbox, settings: Settings) -> None:
    encoded = text_of(run("desk_hash", {"action": "base64_encode", "text": "深度求索"}, sandbox, settings))
    payload = encoded.splitlines()[-1]
    decoded = text_of(
        run("desk_hash", {"action": "base64_decode", "text": payload}, sandbox, settings)
    )
    assert "深度求索" in decoded


def test_hash_generates_uuid(sandbox: Sandbox, settings: Settings) -> None:
    assert "uuid4" in text_of(run("desk_hash", {"action": "uuid"}, sandbox, settings))


def test_grep_finds_lines(sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "app.ts").write_text("const x = 1\nconst needToken = 2\n", encoding="utf-8")
    (sandbox.root / "skip.bin").write_bytes(b"\x00\x01\x02needToken")
    result = text_of(run("desk_grep", {"pattern": "needToken"}, sandbox, settings))
    assert "app.ts:2" in result
    assert "skip.bin" not in result


def test_grep_invalid_regex(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_grep", {"pattern": "([a-z"}, sandbox, settings)


def test_json_query_nested(sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "data.json").write_text(
        json.dumps({"items": [{"name": "alpha"}, {"name": "beta"}]}), encoding="utf-8"
    )
    result = text_of(
        run("desk_json_query", {"path": "data.json", "query": "items.1.name"}, sandbox, settings)
    )
    assert "beta" in result


def test_json_query_missing_key(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_json_query", {"text": '{"a": 1}', "query": "b"}, sandbox, settings)


def test_archive_create_and_extract(sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "one.txt").write_text("one", encoding="utf-8")
    created = text_of(
        run("desk_archive", {"action": "create", "path": "pack.zip", "sources": ["one.txt"]}, sandbox, settings)
    )
    assert "已打包" in created

    listed = text_of(run("desk_archive", {"action": "list", "path": "pack.zip"}, sandbox, settings))
    assert "one.txt" in listed

    text_of(
        run(
            "desk_archive",
            {"action": "extract", "path": "pack.zip", "target": "out"},
            sandbox,
            settings,
        )
    )
    assert (sandbox.root / "out" / "one.txt").read_text(encoding="utf-8") == "one"


def test_archive_blocks_zip_slip(sandbox: Sandbox, settings: Settings) -> None:
    evil = sandbox.root / "evil.zip"
    with zipfile.ZipFile(evil, "w") as archive:
        archive.writestr("../escape.txt", "boom")
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_archive", {"action": "extract", "path": "evil.zip", "target": "out"}, sandbox, settings)
    assert not (sandbox.root.parent / "escape.txt").exists()


def test_text_stats_counts(sandbox: Sandbox, settings: Settings) -> None:
    result = text_of(run("desk_text_stats", {"text": "第一行\nsecond line"}, sandbox, settings))
    assert "行数：2" in result
    assert "词数" in result


def test_net_probe_rejects_non_http(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_net_probe", {"action": "http", "url": "file:///etc/passwd"}, sandbox, settings)


def test_net_probe_dns_localhost(sandbox: Sandbox, settings: Settings) -> None:
    result = run("desk_net_probe", {"action": "dns", "host": "localhost"}, sandbox, settings)
    assert not result.get("isError")


def test_git_requires_repository(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_git", {"action": "status"}, sandbox, settings)


def test_git_status_in_repo(sandbox: Sandbox, settings: Settings) -> None:
    import shutil
    import subprocess

    if shutil.which("git") is None:
        pytest.skip("环境里没有 git")
    subprocess.run(["git", "init", "-q"], cwd=sandbox.root, check=True)
    (sandbox.root / "README.md").write_text("hi", encoding="utf-8")
    result = text_of(run("desk_git", {"action": "status"}, sandbox, settings))
    assert "README.md" in result


def test_workspace_list_and_switch(tmp_path, sandbox: Sandbox, settings: Settings) -> None:
    second = tmp_path / "second"
    second.mkdir()
    settings.workspaces = [sandbox.root, second]

    listed = text_of(run("desk_workspace", {"action": "list"}, sandbox, settings))
    assert "second" in listed

    switched = text_of(
        run("desk_workspace", {"action": "use", "path": str(second)}, sandbox, settings)
    )
    assert "已切换" in switched
    assert sandbox.root == second.resolve()


def test_workspace_rejects_unknown_path(sandbox: Sandbox, settings: Settings) -> None:
    settings.workspaces = [sandbox.root]
    with pytest.raises(tools_extra.ExtraToolError):
        run("desk_workspace", {"action": "use", "path": "/tmp/not-allowed"}, sandbox, settings)
