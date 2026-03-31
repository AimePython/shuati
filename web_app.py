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

from flask import Flask, jsonify, render_template, request

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
_bank: QuestionBank | None = None


def get_bank() -> QuestionBank:
    global _bank
    if _bank is None:
        _bank = QuestionBank(quiet=True)
    return _bank


@app.route("/health")
def health():
    """不读题库，用于确认服务已启动。"""
    return jsonify({"ok": True})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/stats")
def api_stats():
    try:
        b = get_bank()
        return jsonify({"ok": True, **b.get_stats()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "detail": traceback.format_exc()}), 500


@app.route("/api/round/start", methods=["POST"])
def api_round_start():
    try:
        data = request.get_json(silent=True) or {}
        num = int(data.get("num", 50))
        num = max(1, min(num, 200))
        b = get_bank()
        ids = b.get_round_questions(num)
        return jsonify({"ok": True, "question_ids": ids, "count": len(ids)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/question/<int:qid>")
def api_question(qid: int):
    try:
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
