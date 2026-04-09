"""
刷题 Web 界面：python web_app.py 后浏览器打开终端里显示的地址。

默认端口 5001（避免与 macOS「隔空播放」占用 5000）。
默认只监听 127.0.0.1（本机浏览器最稳）。手机/局域网访问请用：
  HOST=0.0.0.0 python3 web_app.py
换端口：PORT=8080 python3 web_app.py
打包为桌面程序：python build_desktop.py（需安装 PyInstaller）

依赖：pip install flask
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
import json
import re
from threading import Lock

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from exam import QuestionBank, check_answer, format_standard_display, _type_label


def _bundle_dir() -> str:
    """模板与静态资源目录（PyInstaller 解压目录或源码目录）。"""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


app = Flask(
    __name__,
    template_folder=os.path.join(_bundle_dir(), "templates"),
    static_folder=os.path.join(_bundle_dir(), "static"),
)
app.secret_key = os.environ.get("SECRET_KEY", "please-change-this-secret-key")
_bank_by_user: dict[str, QuestionBank] = {}
_bank_lock = Lock()


def _data_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def _users_file() -> str:
    return os.path.join(_data_dir(), "users.json")


def _progress_dir() -> str:
    p = os.path.join(_data_dir(), "user_progress")
    os.makedirs(p, exist_ok=True)
    return p


_users_lock = Lock()


def _load_users() -> dict[str, str]:
    path = _users_file()
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def _save_users(users: dict[str, str]) -> None:
    path = _users_file()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _valid_username(username: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_]{3,32}", username))


def _user_progress_path(username: str) -> str:
    return os.path.join(_progress_dir(), f"{username}.csv")


def _user_wrong_book_path(username: str) -> str:
    return os.path.join(_progress_dir(), f"{username}_wrong_book.csv")


def _current_user() -> str | None:
    u = session.get("username")
    return str(u) if u else None


def get_bank() -> QuestionBank:
    user = _current_user()
    if not user:
        raise PermissionError("未登录")
    with _bank_lock:
        bank = _bank_by_user.get(user)
        if bank is None:
            bank = QuestionBank(
                progress_path=_user_progress_path(user),
                wrong_book_path=_user_wrong_book_path(user),
                quiet=True,
            )
            _bank_by_user[user] = bank
        return bank


@app.route("/health")
def health():
    """不读题库，用于确认服务已启动。"""
    return jsonify({"ok": True})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth/me")
def api_auth_me():
    u = _current_user()
    return jsonify({"ok": True, "logged_in": bool(u), "username": u})


@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    if not _valid_username(username):
        return jsonify(
            {
                "ok": False,
                "error": "用户名格式不正确：3-32位，仅支持字母/数字/下划线",
            }
        ), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "密码至少 6 位"}), 400
    with _users_lock:
        users = _load_users()
        if username in users:
            return jsonify({"ok": False, "error": "用户名已存在"}), 409
        users[username] = generate_password_hash(password)
        _save_users(users)
    # 新用户首次创建时不带历史记录：若文件不存在，QuestionBank 会以全“未做”初始化。
    session["username"] = username
    return jsonify({"ok": True, "username": username})


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    with _users_lock:
        users = _load_users()
        h = users.get(username)
    if not h or not check_password_hash(h, password):
        return jsonify({"ok": False, "error": "用户名或密码错误"}), 401
    session["username"] = username
    return jsonify({"ok": True, "username": username})


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    session.pop("username", None)
    return jsonify({"ok": True})


@app.route("/api/stats")
def api_stats():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        b = get_bank()
        return jsonify({"ok": True, **b.get_stats()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "detail": traceback.format_exc()}), 500


@app.route("/api/round/start", methods=["POST"])
def api_round_start():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        data = request.get_json(silent=True) or {}
        mode = str(data.get("mode", "normal")).strip().lower()
        b = get_bank()
        if mode == "wrong":
            ids = b.get_wrong_questions()
        else:
            mode = "normal"
            ids = b.get_round_questions()
        return jsonify({"ok": True, "mode": mode, "question_ids": ids, "count": len(ids)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/question/<int:qid>")
def api_question(qid: int):
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        b = get_bank()
        sub = b.df[b.df["question_index"] == qid]
        if sub.empty:
            return jsonify({"ok": False, "error": "题目不存在"}), 404
        row = sub.iloc[0]
        qt = str(row["题目类型"])
        qnum = int(row["question_index"]) + 1
        hints = {
            "single": "单选题（全库第 1–350 题）：四选一",
            "multi": "多选题（全库第 351–550 题，选项 A–E）：须选中全部正确选项，选好后点「确认答案」；提交后显示正确答案",
            "judge": "判断题（全库第 551–790 题）：选对（A/对）或错（B/错）",
        }
        return jsonify(
            {
                "ok": True,
                "qid": int(qid),
                "question_number": qnum,
                "content": str(row["题目内容"]),
                "status": str(row["status"]),
                "question_type": qt,
                "type_label": _type_label(qt),
                "hint": hints.get(qt, ""),
                "multi_option_count": 5 if qt == "multi" else None,
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/answer", methods=["POST"])
def api_answer():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        data = request.get_json(silent=True) or {}
        qid = int(data.get("qid"))
        raw = data.get("answer", "")
        if isinstance(raw, list):
            ans = "".join(str(x) for x in raw)
        else:
            ans = str(raw).strip()
        b = get_bank()
        sub = b.df[b.df["question_index"] == qid]
        if sub.empty:
            return jsonify({"ok": False, "error": "题目不存在"}), 404
        row = sub.iloc[0]
        qt = str(row["题目类型"])
        std = str(row["标准答案"]).strip()
        is_ok = check_answer(ans, std, qt)
        b.update_question_status(qid, is_ok)
        if not is_ok:
            b.record_wrong_question(qid)
        disp = format_standard_display(std, qt)
        return jsonify(
            {
                "ok": True,
                "correct": is_ok,
                "your_answer": ans,
                "correct_answer": std,
                "correct_answer_display": disp,
                "explanation": str(row["解析"]),
                "question_type": qt,
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/wrong-book/clear", methods=["POST"])
def api_wrong_book_clear():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        b = get_bank()
        cleared = b.clear_wrong_book()
        return jsonify({"ok": True, "cleared": cleared})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


def _pick_free_port(preferred: int, host: str, span: int = 30) -> int:
    """若首选端口被占用（常见于重复启动程序），自动顺延。"""
    for port in range(preferred, preferred + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return preferred


if __name__ == "__main__":
    # 默认 127.0.0.1：避免仅本机使用时 0.0.0.0 + VPN/多网卡导致浏览器连不上
    host = os.environ.get("HOST", "127.0.0.1")
    preferred = int(os.environ.get("PORT", "5001"))
    frozen = getattr(sys, "frozen", False)
    port = _pick_free_port(preferred, host)
    if port != preferred:
        print(f"\n⚠ 端口 {preferred} 已被占用，已改用 {port}。\n")
    print("\n" + "=" * 56)
    print("  刷题服务已启动 —— 运行期间请勿关闭本窗口！")
    print("=" * 56)
    print(f"\n→ 在浏览器打开（注意端口是 {port}）：")
    print(f"   http://127.0.0.1:{port}/")
    print(f"→ 自检：http://127.0.0.1:{port}/health\n")
    if frozen:
        print("题库请放在本程序同一文件夹内（默认文件名见 exam.py）。\n")
    if os.environ.get("NO_BROWSER") != "1":

        def _open_browser() -> None:
            time.sleep(1.0)
            webbrowser.open(f"http://127.0.0.1:{port}/")

        threading.Thread(target=_open_browser, daemon=True).start()
    try:
        app.run(host=host, port=port, debug=not frozen, use_reloader=False)
    except OSError as e:
        print(f"\n❌ 无法启动服务（端口 {port}）：{e}")
        print("请关闭占用该端口的其它程序，或执行: PORT=8080 python3 web_app.py\n")
        sys.exit(1)
