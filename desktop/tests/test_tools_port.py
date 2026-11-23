"""移植工具集的单元测试：只经过 definitions / dispatch 两个入口。"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest

from agentdesk import tools_port
from agentdesk.config import Settings
from agentdesk.sandbox import Sandbox


def run(name: str, args: dict, sandbox: Sandbox, settings: Settings) -> dict:
    return asyncio.run(tools_port.dispatch(name, args, sandbox, settings))


def text_of(result: dict) -> str:
    return "\n".join(item.get("text", "") for item in result["content"] if item.get("type") == "text")


def test_definitions_are_well_formed() -> None:
    items = tools_port.definitions()
    names = [item["name"] for item in items]
    assert len(names) == len(set(names)), "工具名不能重复"
    for item in items:
        assert item["name"].startswith("desk_")
        assert item["description"], item["name"]
        assert item["inputSchema"]["type"] == "object"


def test_calculate_is_safe(sandbox: Sandbox, settings: Settings) -> None:
    assert "= 14" in text_of(run("desk_calculate", {"expression": "2+3*4"}, sandbox, settings))
    assert "= 3" in text_of(run("desk_calculate", {"expression": "sqrt(9)"}, sandbox, settings))
    # 不做任意代码执行
    with pytest.raises(Exception):
        text_of(run("desk_calculate", {"expression": "__import__('os')"}, sandbox, settings))


def test_codec_roundtrip(sandbox: Sandbox, settings: Settings) -> None:
    encoded = text_of(run("desk_codec", {"action": "base64_encode", "text": "你好"}, sandbox, settings))
    decoded = text_of(
        run("desk_codec", {"action": "base64_decode", "text": encoded}, sandbox, settings)
    )
    assert decoded == "你好"
    assert text_of(run("desk_codec", {"action": "url_encode", "text": "a b"}, sandbox, settings)) == "a%20b"


def test_regex_extract_and_replace(sandbox: Sandbox, settings: Settings) -> None:
    found = text_of(
        run("desk_regex", {"action": "extract", "pattern": r"\d+", "text": "a1 b22 c333"}, sandbox, settings)
    )
    assert "1" in found and "333" in found
    replaced = text_of(
        run(
            "desk_regex",
            {"action": "replace", "pattern": "a", "replacement": "b", "text": "a a"},
            sandbox,
            settings,
        )
    )
    assert replaced == "b b"


def test_csv_query(tmp_path: Path, sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "rows.csv").write_text("name,status\n甲,done\n乙,todo\n", encoding="utf-8")
    result = run(
        "desk_csv", {"action": "query", "path": "rows.csv", "where": "status=done"}, sandbox, settings
    )
    data = json.loads(text_of(result))
    assert data == [{"name": "甲", "status": "done"}]


def test_sqlite_reads_and_blocks_writes(tmp_path: Path, sandbox: Sandbox, settings: Settings) -> None:
    target = sandbox.root / "demo.db"
    connection = sqlite3.connect(target)
    connection.execute("create table t (id integer primary key, name text)")
    connection.execute("insert into t (name) values ('x')")
    connection.commit()
    connection.close()

    tables = text_of(run("desk_sqlite", {"action": "tables", "path": "demo.db"}, sandbox, settings))
    assert "t" in tables
    rows = text_of(
        run("desk_sqlite", {"action": "query", "path": "demo.db", "sql": "select name from t"}, sandbox, settings)
    )
    assert "x" in rows
    with pytest.raises(Exception):
        run(
            "desk_sqlite",
            {"action": "query", "path": "demo.db", "sql": "delete from t"},
            sandbox,
            settings,
        )


def test_glob_and_tree(sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "src").mkdir()
    (sandbox.root / "src" / "a.ts").write_text("export {}\n", encoding="utf-8")
    (sandbox.root / "src" / "b.ts").write_text("export {}\n", encoding="utf-8")

    hit = text_of(run("desk_glob", {"pattern": "*.ts"}, sandbox, settings))
    assert "a.ts" in hit and "b.ts" in hit
    tree = text_of(run("desk_tree", {}, sandbox, settings))
    assert "src/" in tree and "a.ts" in tree


def test_diff_reports_change(sandbox: Sandbox, settings: Settings) -> None:
    (sandbox.root / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
    (sandbox.root / "b.txt").write_text("one\nthree\n", encoding="utf-8")
    diff = text_of(run("desk_diff", {"path_a": "a.txt", "path_b": "b.txt"}, sandbox, settings))
    assert "-two" in diff and "+three" in diff


def test_similarity_dedupe(sandbox: Sandbox, settings: Settings) -> None:
    out = text_of(
        run(
            "desk_similarity",
            {"action": "dedupe", "text": "hello world\nhello world\nanother line", "threshold": 0.95},
            sandbox,
            settings,
        )
    )
    assert out.count("hello world") == 1
    assert "去掉 1 行近似重复" in out


def test_markdown_to_html_escapes(sandbox: Sandbox, settings: Settings) -> None:
    html = text_of(
        run("desk_markdown", {"action": "to_html", "text": "# 标题\n<script>x</script>"}, sandbox, settings)
    )
    assert "<h1>标题</h1>" in html
    assert "<script>" not in html


def test_password_length(sandbox: Sandbox, settings: Settings) -> None:
    secret = text_of(run("desk_password", {"length": 24, "count": 2}, sandbox, settings))
    lines = secret.splitlines()
    assert len(lines) == 2
    assert all(len(line) == 24 for line in lines)


def test_path_escape_is_rejected(sandbox: Sandbox, settings: Settings) -> None:
    with pytest.raises(Exception):
        run("desk_glob", {"pattern": "*.txt", "path": "../.."}, sandbox, settings)
