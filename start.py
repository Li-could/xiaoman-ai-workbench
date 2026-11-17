# -*- coding: utf-8 -*-
"""
小满AI · 电商客服工作台 —— PyCharm 一键启动器

用法（PyCharm）：
    1. 用 PyCharm 打开本目录 E:\\Python\\xiaoman-workbench
    2. 右键 start.py → Run 'start'   （或点右上角绿色三角）
    3. 等待控制台打印「已启动」，浏览器会自动打开 http://127.0.0.1:8787

它做四件事：
    · 检查本机是否装了 Node.js（前后端都跑在 Node 上）
    · 读取 .env，告诉你数据将写进哪个 MySQL 库
    · 用子进程启动 node server.js
    · 轮询端口就绪后自动打开浏览器，并把日志实时打印出来

数据库：
    默认连本机 MySQL（配置见 .env），所有业务数据都落库。
    若 MySQL 不可用，服务会自动回落到本地 SQLite 文件，不会启动失败。
"""

import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8787"))
ROOT = Path(__file__).resolve().parent
URL = f"http://{HOST}:{PORT}/"


def port_in_use(host: str, port: int) -> bool:
    """端口是否已被监听（说明服务可能已经在跑）。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((host, port)) == 0


def find_node() -> Optional[str]:
    """在 PATH 中查找 node 可执行文件，返回完整路径。"""
    exts = [".exe", ".cmd", ""] if os.name == "nt" else [""]
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if not d:
            continue
        for ext in exts:
            p = Path(d) / f"node{ext}"
            if p.is_file():
                return str(p)
    return None


def stream(proc: subprocess.Popen) -> None:
    """把子进程输出逐行转发到 PyCharm 控制台。"""
    assert proc.stdout is not None
    for raw in iter(proc.stdout.readline, ""):
        if not raw:
            break
        sys.stdout.write(raw if raw.endswith("\n") else raw + "\n")
        sys.stdout.flush()


def open_later() -> None:
    """等端口就绪后打开浏览器，最多等 15 秒。"""
    for _ in range(150):
        if port_in_use(HOST, PORT):
            if not os.environ.get("NO_BROWSER"):
                webbrowser.open(URL)
            return
        time.sleep(0.1)
    print(f"[提示] 服务暂未就绪，请手动访问 {URL}")


def read_env() -> dict:
    """读取项目根目录的 .env（只用于启动时展示信息）。"""
    out = {}
    f = ROOT / ".env"
    if not f.is_file():
        return out
    try:
        for raw in f.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return out


def print_db_info() -> None:
    """打印数据库目标，让人一眼看出数据存哪。"""
    conf = read_env()
    driver = (os.environ.get("DB_DRIVER") or conf.get("DB_DRIVER") or "mysql").lower()
    if driver == "sqlite":
        print("[信息] 数据库: SQLite 文件（data/xiaoman.db）")
        return
    host = os.environ.get("DB_HOST") or conf.get("DB_HOST") or "127.0.0.1"
    port = os.environ.get("DB_PORT") or conf.get("DB_PORT") or "3306"
    user = os.environ.get("DB_USER") or conf.get("DB_USER") or "root"
    name = os.environ.get("DB_NAME") or conf.get("DB_NAME") or "xiaoman"
    print(f"[信息] 数据库: MySQL  {user}@{host}:{port}/{name}   配置文件: .env")
    if not (ROOT / "node_modules" / "mysql2").is_dir():
        print("[警告] 未安装 MySQL 驱动 mysql2，服务会自动回落到 SQLite。")
        print("       如需连接 MySQL，请在项目目录执行：")
        print("       npm install mysql2 --registry=https://registry.npmmirror.com")


def main() -> int:
    print("=" * 62)
    print("  小满AI · 电商客服聚合工作台")
    print(f"  项目目录: {ROOT}")
    print(f"  访问地址: {URL}")
    print("=" * 62)

    # 1) 服务已在运行 → 直接打开浏览器，不重复启动
    if port_in_use(HOST, PORT):
        print(f"[信息] 检测到 {PORT} 端口已有服务在运行，直接打开浏览器。")
        print(f"[信息] 若需重启，请先在任务管理器结束占用该端口的 node.exe。")
        if not os.environ.get("NO_BROWSER"):
            webbrowser.open(URL)
        return 0

    # 2) 检查 Node.js
    node = find_node()
    if not node:
        print("[错误] 未找到 Node.js。请先安装 Node.js 18+：https://nodejs.org/")
        print("       安装后重启 PyCharm，再运行本文件。")
        return 1
    ver = subprocess.run([node, "-v"], capture_output=True, text=True).stdout.strip()
    print(f"[信息] Node.js 版本: {ver}")
    try:
        parts = ver.lstrip("v").split(".")
        major, minor = int(parts[0]), int(parts[1])
        if (major, minor) < (22, 5):
            print("[警告] 本项目连接 MySQL 需要 Node.js 18+；SQLite 兜底需要 22.5+。")
            print("       当前版本可能无法启动兜底库，建议升级：https://nodejs.org/")
    except Exception:
        pass

    server = ROOT / "server.js"
    if not server.is_file():
        print(f"[错误] 未找到 {server}，请确认项目文件完整。")
        return 1

    print_db_info()

    # 3) 启动后端
    env = dict(os.environ)
    env.setdefault("PORT", str(PORT))
    print("[信息] 正在启动后端 server.js ...\n")
    proc = subprocess.Popen(
        [node, str(server)],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )

    threading.Thread(target=stream, args=(proc,), daemon=True).start()
    threading.Thread(target=open_later, daemon=True).start()

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n[信息] 收到 Ctrl+C，正在关闭服务 ...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("[信息] 已关闭。")
    return proc.returncode or 0


if __name__ == "__main__":
    sys.exit(main())
