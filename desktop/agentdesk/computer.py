"""跨平台的屏幕与输入控制：截屏、鼠标、键盘、窗口。

Linux 依赖 xdotool 与 ImageMagick（import）或 scrot；
macOS 依赖系统自带的 screencapture / osascript，鼠标点击需要 cliclick；
Windows 走 PowerShell + user32。缺少依赖时返回可读的安装提示。
"""

from __future__ import annotations

import base64
import io
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

SYSTEM = platform.system()


class ComputerError(Exception):
    """可预期的操作失败，直接回传给模型"""


def _require(command: str, hint: str) -> str:
    path = shutil.which(command)
    if not path:
        raise ComputerError(f"缺少命令 {command}。{hint}")
    return path


def _run(cmd: list[str], timeout: int = 20) -> str:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as error:
        raise ComputerError(f"缺少命令 {cmd[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise ComputerError("操作超时，请确认目标窗口是否响应") from error
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or "命令执行失败").strip()
        raise ComputerError(message[:400])
    return proc.stdout


def _powershell(script: str, timeout: int = 30) -> str:
    """用 EncodedCommand 传脚本，避免引号与中文转义问题。"""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    return _run(
        ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        timeout=timeout,
    )


# ---------- 截屏 ----------

def capture_screen() -> tuple[str, bytes]:
    if SYSTEM == "Darwin":
        target = Path(tempfile.gettempdir()) / "agentdesk-shot.png"
        _run(["screencapture", "-x", "-t", "png", str(target)])
        data = target.read_bytes()
        target.unlink(missing_ok=True)
        return "image/png", data

    if SYSTEM == "Windows":
        target = Path(tempfile.gettempdir()) / "agentdesk-shot.png"
        _powershell(
            "\n".join(
                [
                    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
                    "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
                    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
                    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
                    "$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)",
                    f'$bmp.Save("{target}", [System.Drawing.Imaging.ImageFormat]::Png)',
                    "$g.Dispose(); $bmp.Dispose()",
                ]
            )
        )
        data = target.read_bytes()
        target.unlink(missing_ok=True)
        return "image/png", data

    if os.environ.get("XDG_SESSION_TYPE", "").lower() == "wayland":
        raise ComputerError("当前是 Wayland 会话，xdotool 与 import 无法直接截屏；请改用 X11 会话。")

    hint = "Debian/Ubuntu 可执行 sudo apt install imagemagick xdotool"
    if shutil.which("import"):
        tool = _require("import", hint)
        proc = subprocess.run(
            [tool, "-silent", "-window", "root", "png:-"],
            capture_output=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            message = (proc.stderr or "截屏失败".encode()).decode("utf-8", "replace")
            raise ComputerError(message[:400])
        return "image/png", proc.stdout
    if shutil.which("scrot"):
        target = Path(tempfile.gettempdir()) / "agentdesk-shot.png"
        _run([_require("scrot", hint), "-o", str(target)])
        data = target.read_bytes()
        target.unlink(missing_ok=True)
        return "image/png", data
    raise ComputerError(f"未找到截屏工具。{hint}")


def screen_size() -> tuple[int, int]:
    if SYSTEM == "Darwin":
        out = _run(["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'])
        parts = [int(item.strip()) for item in out.split(",") if item.strip().isdigit()]
        if len(parts) == 4:
            return parts[2], parts[3]
        return 0, 0
    if SYSTEM == "Windows":
        out = _powershell(
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen; "
            'Write-Output "$($b.Width)x$($b.Height)"'
        )
        width, _, height = out.strip().partition("x")
        return int(width or 0), int(height or 0)
    out = _run([_require("xdotool", "sudo apt install xdotool"), "getdisplaygeometry"])
    width, _, height = out.strip().partition(" ")
    return int(width or 0), int(height or 0)


# ---------- 鼠标 ----------

def _cliclick() -> str:
    return _require("cliclick", "brew install cliclick")


def move_mouse(x: int, y: int) -> str:
    if SYSTEM == "Darwin":
        _run([_cliclick(), f"m:{x},{y}"])
    elif SYSTEM == "Windows":
        _powershell(
            "Add-Type -TypeDefinition 'using System.Runtime.InteropServices;"
            "public class M{[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int x,int y);}';"
            f"[M]::SetCursorPos({x},{y})"
        )
    else:
        _run([_require("xdotool", "sudo apt install xdotool"), "mousemove", "--sync", str(x), str(y)])
    return f"鼠标已移动到 ({x}, {y})"


def click(x: int, y: int, button: str = "left", clicks: int = 1) -> str:
    clicks = max(1, min(3, clicks))
    if SYSTEM == "Darwin":
        tool = _cliclick()
        prefix = {"left": "c", "right": "rc", "middle": "mc"}.get(button, "c")
        _run([tool, f"{prefix}:{x},{y}"] * clicks)
    elif SYSTEM == "Windows":
        down, up = {
            "left": ("0x02", "0x04"),
            "right": ("0x08", "0x10"),
            "middle": ("0x20", "0x40"),
        }.get(button, ("0x02", "0x04"))
        script = [
            "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;"
            "public class M{[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int x,int y);"
            "[DllImport(\"user32.dll\")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e);}';",
            f"[M]::SetCursorPos({x},{y}); Start-Sleep -Milliseconds 60",
        ]
        for _ in range(clicks):
            script.append(f"[M]::mouse_event({down},0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 40")
            script.append(f"[M]::mouse_event({up},0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 60")
        _powershell("\n".join(script))
    else:
        tool = _require("xdotool", "sudo apt install xdotool")
        _run(
            [
                tool,
                "mousemove",
                "--sync",
                str(x),
                str(y),
                "click",
                "--repeat",
                str(clicks),
                "--delay",
                "80",
                str({"left": 1, "middle": 2, "right": 3}.get(button, 1)),
            ]
        )
    return f"已在 ({x}, {y}) {button} 点击 {clicks} 次"


# ---------- 键盘 ----------

def _clipboard_paste(text: str) -> str:
    if SYSTEM == "Darwin":
        subprocess.run(["pbcopy"], input=text.encode(), check=True, timeout=10)
        _run(["osascript", "-e", 'tell application "System Events" to keystroke "v" using command down'])
        return "已通过剪贴板粘贴"
    if SYSTEM == "Windows":
        escaped = text.replace("'", "''")
        _powershell(f"Set-Clipboard -Value '{escaped}'")
        _powershell(
            "Add-Type -AssemblyName System.Windows.Forms; "
            '[System.Windows.Forms.SendKeys]::SendWait("^v")'
        )
        return "已通过剪贴板粘贴"
    if shutil.which("xclip"):
        subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(), check=True, timeout=10)
        _run([_require("xdotool", "sudo apt install xdotool"), "key", "--clearmodifiers", "ctrl+v"])
        return "已通过剪贴板粘贴"
    return ""


def type_text(text: str, submit: bool = False) -> str:
    if not text:
        raise ComputerError("text 不能为空")
    mode = ""
    if SYSTEM == "Darwin":
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        _run(
            [
                "osascript",
                "-e",
                'tell application "System Events" to keystroke "%s"' % escaped,
            ]
        )
    elif SYSTEM == "Windows":
        mode = _clipboard_paste(text)
    else:
        tool = _require("xdotool", "sudo apt install xdotool")
        if all(ord(ch) < 128 for ch in text):
            _run([tool, "type", "--delay", "18", "--clearmodifiers", text])
        else:
            mode = _clipboard_paste(text)
            if not mode:
                _run([tool, "type", "--delay", "18", "--clearmodifiers", text])
    if submit:
        press_keys("Return")
        return f"已输入 {len(text)} 个字符并回车" + (f"（{mode}）" if mode else "")
    return f"已输入 {len(text)} 个字符" + (f"（{mode}）" if mode else "")


def press_keys(keys: str) -> str:
    keys = keys.strip()
    if not keys:
        raise ComputerError("keys 不能为空，例如 ctrl+s 或 Return")
    if SYSTEM == "Darwin":
        parts = [part.strip().lower() for part in keys.split("+")]
        key = parts[-1]
        modifiers = {
            "cmd": "command down",
            "command": "command down",
            "ctrl": "control down",
            "control": "control down",
            "alt": "option down",
            "option": "option down",
            "shift": "shift down",
        }
        holds = [modifiers[part] for part in parts[:-1] if part in modifiers]
        script = f'tell application "System Events" to keystroke "{key}"'
        if holds:
            script += " using {" + ", ".join(holds) + "}"
        _run(["osascript", "-e", script])
    elif SYSTEM == "Windows":
        table = {"ctrl": "^", "control": "^", "alt": "%", "shift": "+", "cmd": "^", "win": "^"}
        parts = [part.strip().lower() for part in keys.split("+")]
        combo = "".join(table.get(part, "") for part in parts[:-1]) + parts[-1]
        escaped = combo.replace("'", "''")
        _powershell(
            "Add-Type -AssemblyName System.Windows.Forms; "
            f'[System.Windows.Forms.SendKeys]::SendWait(\'{escaped}\')'
        )
    else:
        _run([_require("xdotool", "sudo apt install xdotool"), "key", "--clearmodifiers", keys])
    return f"已发送按键 {keys}"


# ---------- 窗口 ----------

def list_windows() -> list[dict[str, Any]]:
    if SYSTEM == "Darwin":
        script = (
            'tell application "System Events" to get {name, title of front window} '
            'of every process whose background only is false'
        )
        out = _run(["osascript", "-e", script])
        return [{"title": item.strip()} for item in out.split(",") if item.strip()]
    if SYSTEM == "Windows":
        out = _powershell(
            "Get-Process | Where-Object {$_.MainWindowTitle} | "
            'Select-Object -First 40 Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress'
        )
        import json

        try:
            items = json.loads(out or "[]")
        except ValueError:
            return []
        return [
            {
                "id": item.get("Id"),
                "app": item.get("ProcessName"),
                "title": item.get("MainWindowTitle"),
            }
            for item in items
            if isinstance(item, dict)
        ]
    tool = _require("xdotool", "sudo apt install xdotool")
    ids = _run([tool, "search", "--onlyvisible", "--name", ".*"]).split()
    windows = []
    for window_id in ids[:40]:
        try:
            name = _run([tool, "getwindowname", window_id]).strip()
        except ComputerError:
            continue
        if name:
            windows.append({"id": window_id, "title": name})
    return windows


def focus_window(title: str) -> str:
    title = title.strip()
    if not title:
        raise ComputerError("title 不能为空")
    if SYSTEM == "Darwin":
        _run(
            [
                "osascript",
                "-e",
                f'tell application "System Events" to set frontmost of process "{title}" to true',
            ]
        )
    elif SYSTEM == "Windows":
        escaped = title.replace("'", "''")
        _powershell(
            "Add-Type -AssemblyName Microsoft.VisualBasic; "
            f"[Microsoft.VisualBasic.Interaction]::AppActivate('{escaped}')"
        )
    else:
        tool = _require("xdotool", "sudo apt install xdotool")
        _run([tool, "search", "--name", title, "windowactivate", "--sync"])
    return f"已尝试聚焦窗口「{title}」"


def as_image_content(mime: str, data: bytes) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "image",
                "mimeType": mime,
                "data": base64.b64encode(data).decode(),
            }
        ],
        "isError": False,
    }
