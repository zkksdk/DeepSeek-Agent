from pathlib import Path

from agentdesk.config import Settings


def test_current_sandbox_is_first_workspace(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTDESK_HOME", str(tmp_path / "cfg"))
    custom = tmp_path / "custom"
    other = tmp_path / "other"
    custom.mkdir()
    other.mkdir()

    settings = Settings(sandbox=custom, workspaces=[other])
    paths = settings.configured_workspaces()

    assert paths[0] == custom.resolve()
    assert other.resolve() in paths


def test_describe_keeps_hidden_workspace(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTDESK_HOME", str(tmp_path / "cfg"))
    hidden = tmp_path / ".agentworkspace"
    hidden.mkdir()

    settings = Settings(sandbox=hidden, workspaces=[])
    info = settings.describe()

    assert info["sandbox"] == str(hidden.resolve())
    assert info["workspaces"][0]["name"] == ".agentworkspace"
    assert info["workspaces"][0]["current"] is True


def test_config_dir_is_not_a_workspace(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "cfg"
    home.mkdir()
    monkeypatch.setenv("AGENTDESK_HOME", str(home))
    workspace = tmp_path / "ws"
    workspace.mkdir()

    settings = Settings(sandbox=workspace, workspaces=[home])
    assert home.resolve() not in settings.configured_workspaces()


def test_hidden_env_workspace_is_kept(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTDESK_HOME", str(tmp_path / "cfg"))
    hidden = tmp_path / ".agentworkspace"
    hidden.mkdir()
    monkeypatch.setenv("AGENTDESK_SANDBOX", str(hidden))
    monkeypatch.setenv("AGENTDESK_WORKSPACES", str(hidden))

    settings = Settings()
    info = settings.describe()

    assert info["workspaces"][0]["path"] == str(hidden.resolve())
    assert info["workspaces"][0]["current"] is True
