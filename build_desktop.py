#!/usr/bin/env python3
"""
生成本地可运行的桌面文件夹（PyInstaller --onedir）。

用法（在「刷题软件」目录下）:
  pip install -r requirements-build.txt
  python build_desktop.py

产物: dist/电力交易员刷题/  将整个文件夹打包成 zip 分发给他人即可。
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_NAME = "电力交易员刷题"
MAIN = "web_app.py"


def main() -> int:
    os.chdir(ROOT)
    sep = ";" if platform.system() == "Windows" else ":"
    datas = [
        f"--add-data=templates{sep}templates",
        f"--add-data=static{sep}static",
    ]
    hidden = [
        "--hidden-import=openpyxl",
        "--hidden-import=pandas",
        "--hidden-import=flask",
        "--hidden-import=jinja2",
        "--hidden-import=werkzeug",
        "--hidden-import=markupsafe",
        "--hidden-import=itsdangerous",
        "--hidden-import=click",
        "--hidden-import=blinker",
        "--collect-submodules=flask",
    ]
    try:
        import calamine  # noqa: F401

        hidden.append("--hidden-import=calamine")
    except ImportError:
        print("提示: 未安装 python-calamine，打包后优先用 openpyxl 读 Excel；建议先 pip install -r requirements.txt\n")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--onedir",
        "--console",
        f"--name={APP_NAME}",
        *datas,
        *hidden,
        MAIN,
    ]
    print("执行:", " ".join(cmd))
    r = subprocess.run(cmd, cwd=ROOT)
    if r.returncode != 0:
        return r.returncode

    dist_dir = ROOT / "dist" / APP_NAME
    note = ROOT / "安装说明.txt"
    if note.is_file() and dist_dir.is_dir():
        shutil.copy2(note, dist_dir / note.name)
        print(f"\n已复制 {note.name} 到 {dist_dir}\n")
    print(f"打包完成。请将整个文件夹「{APP_NAME}」压缩为 zip 分发。\n")
    print(
        "!" * 58
        + "\n重要：请只运行「dist」里的程序，不要运行「build」里的！\n"
        + f"正确路径示例：{dist_dir / APP_NAME}\n"
        + "build 目录只是打包中间文件，缺少 Python 库，运行会报错。\n"
        + "!" * 58
        + "\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
