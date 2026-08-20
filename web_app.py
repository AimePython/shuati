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

import csv
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser
import json
import re
from datetime import datetime
from io import StringIO
from threading import Lock

from flask import Flask, Response, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from exam import (
    QuestionBank,
    check_answer,
    format_standard_display,
    _type_label,
    DEFAULT_BANK_ID,
    get_bank_meta,
    list_banks,
    hint_for_type,
    option_letters_for_row,
)


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
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
if os.environ.get("RENDER"):
    app.config["SESSION_COOKIE_SECURE"] = True
_bank_by_user: dict[str, QuestionBank] = {}
_bank_lock = Lock()
_accounts_ready = False


@app.before_request
def _bootstrap_accounts() -> None:
    global _accounts_ready
    if _accounts_ready:
        return
    with _users_lock:
        _load_users()
    _accounts_ready = True


def _data_dir() -> str:
    env = os.environ.get("DATA_DIR", "").strip()
    if env:
        os.makedirs(env, exist_ok=True)
        return env
    return os.path.dirname(os.path.abspath(__file__))


def _users_file() -> str:
    return os.path.join(_data_dir(), "users.json")


def _ledger_file() -> str:
    return os.path.join(_data_dir(), "account_ledger.csv")


def _progress_dir() -> str:
    p = os.path.join(_data_dir(), "user_progress")
    os.makedirs(p, exist_ok=True)
    return p


_users_lock = Lock()

_STATUS_LABEL = {"pending": "待审批", "approved": "已通过", "rejected": "已拒绝"}
_ROLE_LABEL = {"admin": "管理员", "user": "学员"}
_LEDGER_FIELDS = ("用户名", "密码", "角色", "状态", "注册时间", "审批时间", "审批人")


def _now_text() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")


def _admin_username() -> str:
    return (os.environ.get("ADMIN_USERNAME") or "admin").strip() or "admin"


def _admin_password() -> str:
    return (os.environ.get("ADMIN_PASSWORD") or "").strip()


def _blank_user(
    password_hash: str,
    password: str = "",
    role: str = "user",
    status: str = "pending",
    created_at: str = "",
    reviewed_at: str = "",
    reviewed_by: str = "",
) -> dict:
    return {
        "password_hash": password_hash,
        "password": password,
        "role": role,
        "status": status,
        "created_at": created_at or _now_text(),
        "reviewed_at": reviewed_at,
        "reviewed_by": reviewed_by,
    }


def _normalize_users(raw) -> tuple[dict[str, dict], bool]:
    """兼容旧版 {用户名: 哈希}，返回 (users, 是否发生了迁移)。"""
    if not isinstance(raw, dict):
        return {}, False
    inner = raw.get("users") if "users" in raw and isinstance(raw.get("users"), dict) else raw
    if inner is raw and any(isinstance(v, dict) and "password_hash" in v for v in raw.values()):
        inner = raw
    elif "users" in raw and isinstance(raw.get("users"), dict):
        inner = raw["users"]
    migrated = False
    users: dict[str, dict] = {}
    for name, rec in inner.items():
        username = str(name)
        if isinstance(rec, str):
            users[username] = _blank_user(
                rec,
                password="",
                role="admin" if username == _admin_username() else "user",
                status="approved",
                created_at="",
                reviewed_at=_now_text(),
                reviewed_by="migrate",
            )
            migrated = True
            continue
        if not isinstance(rec, dict):
            continue
        status = str(rec.get("status") or "approved").strip() or "approved"
        if status not in _STATUS_LABEL:
            status = "approved"
        role = str(rec.get("role") or "user").strip() or "user"
        if role not in _ROLE_LABEL:
            role = "user"
        users[username] = {
            "password_hash": str(rec.get("password_hash") or rec.get("hash") or ""),
            "password": str(rec.get("password") or ""),
            "role": role,
            "status": status,
            "created_at": str(rec.get("created_at") or ""),
            "reviewed_at": str(rec.get("reviewed_at") or rec.get("approved_at") or ""),
            "reviewed_by": str(rec.get("reviewed_by") or rec.get("approved_by") or ""),
        }
    return users, migrated


def _ledger_rows(users: dict[str, dict]) -> list[dict[str, str]]:
    rows = []
    for username in sorted(users):
        rec = users[username]
        pwd = str(rec.get("password") or "").strip()
        rows.append(
            {
                "用户名": username,
                "密码": pwd if pwd else "（历史账号，仅保存加密密码）",
                "角色": _ROLE_LABEL.get(str(rec.get("role")), "学员"),
                "状态": _STATUS_LABEL.get(str(rec.get("status")), str(rec.get("status"))),
                "注册时间": str(rec.get("created_at") or ""),
                "审批时间": str(rec.get("reviewed_at") or ""),
                "审批人": str(rec.get("reviewed_by") or ""),
            }
        )
    return rows


def _write_ledger_csv(users: dict[str, dict]) -> None:
    path = _ledger_file()
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(_LEDGER_FIELDS))
        writer.writeheader()
        writer.writerows(_ledger_rows(users))


def _save_users(users: dict[str, dict]) -> None:
    path = _users_file()
    payload = {"version": 2, "users": users}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    _write_ledger_csv(users)


def _ensure_admin(users: dict[str, dict]) -> bool:
    name = _admin_username()
    rec = users.get(name)
    if rec and rec.get("role") == "admin" and rec.get("status") == "approved" and rec.get("password_hash"):
        return False
    password = _admin_password()
    if not password:
        return False
    if rec and rec.get("password_hash"):
        rec["role"] = "admin"
        rec["status"] = "approved"
        if not rec.get("reviewed_at"):
            rec["reviewed_at"] = _now_text()
            rec["reviewed_by"] = "bootstrap"
        return True
    users[name] = _blank_user(
        generate_password_hash(password),
        password=password,
        role="admin",
        status="approved",
        reviewed_at=_now_text(),
        reviewed_by="bootstrap",
    )
    return True


def _load_users() -> dict[str, dict]:
    path = _users_file()
    raw = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            try:
                raw = json.load(f)
            except json.JSONDecodeError:
                raw = {}
    users, migrated = _normalize_users(raw)
    created = _ensure_admin(users)
    if migrated or created or not os.path.exists(_ledger_file()):
        _save_users(users)
    return users


def _account_public(username: str, rec: dict) -> dict:
    return {
        "username": username,
        "password": str(rec.get("password") or ""),
        "password_missing": not bool(str(rec.get("password") or "").strip()),
        "role": str(rec.get("role") or "user"),
        "role_label": _ROLE_LABEL.get(str(rec.get("role") or "user"), "学员"),
        "status": str(rec.get("status") or "pending"),
        "status_label": _STATUS_LABEL.get(str(rec.get("status") or "pending"), "待审批"),
        "created_at": str(rec.get("created_at") or ""),
        "reviewed_at": str(rec.get("reviewed_at") or ""),
        "reviewed_by": str(rec.get("reviewed_by") or ""),
    }


def _current_record() -> tuple[str | None, dict | None]:
    username = _current_user()
    if not username:
        return None, None
    with _users_lock:
        rec = _load_users().get(username)
    return username, rec


def _is_admin_user(username: str | None, rec: dict | None) -> bool:
    return bool(
        username
        and rec
        and rec.get("role") == "admin"
        and rec.get("status") == "approved"
    )


def _valid_username(username: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9_]{3,32}", username))


def _user_progress_path(username: str, bank_id: str) -> str:
    if bank_id == DEFAULT_BANK_ID:
        legacy = os.path.join(_progress_dir(), f"{username}.csv")
        if os.path.exists(legacy):
            return legacy
    return os.path.join(_progress_dir(), f"{username}__{bank_id}.csv")


def _user_wrong_book_path(username: str, bank_id: str) -> str:
    if bank_id == DEFAULT_BANK_ID:
        legacy = os.path.join(_progress_dir(), f"{username}_wrong_book.csv")
        if os.path.exists(legacy):
            return legacy
    return os.path.join(_progress_dir(), f"{username}__{bank_id}_wrong_book.csv")


def _current_user() -> str | None:
    u = session.get("username")
    return str(u) if u else None


def _current_bank_id() -> str:
    bid = str(session.get("bank_id") or DEFAULT_BANK_ID).strip()
    try:
        return get_bank_meta(bid)["id"]
    except Exception:
        return DEFAULT_BANK_ID


def get_bank() -> QuestionBank:
    user = _current_user()
    if not user:
        raise PermissionError("未登录")
    bank_id = _current_bank_id()
    key = f"{user}::{bank_id}"
    with _bank_lock:
        bank = _bank_by_user.get(key)
        if bank is None:
            meta = get_bank_meta(bank_id)
            bank = QuestionBank(
                excel_path=meta["excel"],
                progress_path=_user_progress_path(user, bank_id),
                wrong_book_path=_user_wrong_book_path(user, bank_id),
                quiet=True,
                bank_id=bank_id,
            )
            _bank_by_user[key] = bank
        return bank


@app.route("/health")
def health():
    """不读题库，用于确认服务已启动。"""
    return jsonify({"ok": True})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/admin")
def admin_page():
    return render_template("admin.html")


@app.route("/api/auth/me")
def api_auth_me():
    username, rec = _current_record()
    return jsonify(
        {
            "ok": True,
            "logged_in": bool(username),
            "username": username,
            "role": (rec or {}).get("role") if rec else None,
            "is_admin": _is_admin_user(username, rec),
        }
    )


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
    if username.lower() == _admin_username().lower():
        return jsonify({"ok": False, "error": "该用户名已保留，请换一个"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "密码至少 6 位"}), 400
    with _users_lock:
        users = _load_users()
        if username in users:
            rec = users[username]
            if rec.get("status") == "pending":
                return jsonify({"ok": False, "error": "该账号已提交，正在等待管理员审批"}), 409
            return jsonify({"ok": False, "error": "用户名已存在"}), 409
        users[username] = _blank_user(
            generate_password_hash(password),
            password=password,
            role="user",
            status="pending",
        )
        _save_users(users)
    return jsonify(
        {
            "ok": True,
            "pending": True,
            "username": username,
            "message": "已提交注册，请等待管理员审批通过后再登录。",
        }
    )


@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    with _users_lock:
        users = _load_users()
        rec = users.get(username)
    if not rec or not check_password_hash(str(rec.get("password_hash") or ""), password):
        return jsonify({"ok": False, "error": "用户名或密码错误"}), 401
    status = str(rec.get("status") or "pending")
    if status == "pending":
        return jsonify({"ok": False, "error": "账号待管理员审批，通过后方可登录"}), 403
    if status == "rejected":
        return jsonify({"ok": False, "error": "该账号未通过审批，无法登录"}), 403
    session["username"] = username
    return jsonify(
        {
            "ok": True,
            "username": username,
            "role": rec.get("role") or "user",
            "is_admin": _is_admin_user(username, rec),
        }
    )


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    session.pop("username", None)
    return jsonify({"ok": True})


def _require_admin():
    username, rec = _current_record()
    if not username:
        return None, (jsonify({"ok": False, "error": "未登录"}), 401)
    if not _is_admin_user(username, rec):
        return None, (jsonify({"ok": False, "error": "需要管理员权限"}), 403)
    return username, None


@app.route("/api/admin/accounts")
def api_admin_accounts():
    admin_name, err = _require_admin()
    if err:
        return err
    with _users_lock:
        users = _load_users()
        items = [_account_public(name, rec) for name, rec in sorted(users.items())]
    pending = sum(1 for x in items if x["status"] == "pending")
    return jsonify(
        {
            "ok": True,
            "admin": admin_name,
            "pending": pending,
            "total": len(items),
            "accounts": items,
            "ledger_path": os.path.basename(_ledger_file()),
        }
    )


@app.route("/api/admin/accounts/review", methods=["POST"])
def api_admin_review():
    admin_name, err = _require_admin()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    action = str(data.get("action", "")).strip().lower()
    if action not in ("approve", "reject"):
        return jsonify({"ok": False, "error": "未知操作"}), 400
    if not username:
        return jsonify({"ok": False, "error": "缺少用户名"}), 400
    with _users_lock:
        users = _load_users()
        rec = users.get(username)
        if not rec:
            return jsonify({"ok": False, "error": "账号不存在"}), 404
        if rec.get("role") == "admin" and action == "reject":
            return jsonify({"ok": False, "error": "不能拒绝管理员账号"}), 400
        rec["status"] = "approved" if action == "approve" else "rejected"
        rec["reviewed_at"] = _now_text()
        rec["reviewed_by"] = admin_name
        _save_users(users)
        public = _account_public(username, rec)
    return jsonify({"ok": True, "account": public})


@app.route("/api/admin/ledger.csv")
def api_admin_ledger_csv():
    _, err = _require_admin()
    if err:
        return err
    with _users_lock:
        users = _load_users()
        buf = StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(_LEDGER_FIELDS))
        writer.writeheader()
        writer.writerows(_ledger_rows(users))
        body = buf.getvalue()
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=account_ledger.csv"},
    )


@app.route("/api/stats")
def api_stats():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        b = get_bank()
        return jsonify(
            {
                "ok": True,
                "bank_id": b.bank_id,
                "bank_name": b.bank_name,
                **b.get_stats(),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "detail": traceback.format_exc()}), 500


@app.route("/api/banks")
def api_banks():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        current = _current_bank_id()
        banks = []
        for meta in list_banks():
            banks.append(
                {
                    "id": meta["id"],
                    "name": meta["name"],
                    "short_name": meta["short_name"],
                    "current": meta["id"] == current,
                }
            )
        return jsonify(
            {
                "ok": True,
                "bank_id": current,
                "bank_name": get_bank_meta(current)["name"],
                "banks": banks,
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/bank", methods=["POST"])
def api_select_bank():
    try:
        if not _current_user():
            return jsonify({"ok": False, "error": "未登录"}), 401
        data = request.get_json(silent=True) or {}
        bid = str(data.get("bank_id", "")).strip()
        known = {m["id"] for m in list_banks()}
        if bid not in known:
            return jsonify({"ok": False, "error": "未知题库"}), 400
        session["bank_id"] = bid
        b = get_bank()
        return jsonify(
            {
                "ok": True,
                "bank_id": b.bank_id,
                "bank_name": b.bank_name,
                **b.get_stats(),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


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
        letters = option_letters_for_row(row, qt)
        return jsonify(
            {
                "ok": True,
                "qid": int(qid),
                "question_number": qnum,
                "content": str(row["题目内容"]),
                "status": str(row["status"]),
                "question_type": qt,
                "type_label": _type_label(qt),
                "hint": hint_for_type(qt, type_by_number=b.type_by_number),
                "option_letters": letters,
                "multi_option_count": len(letters) if qt == "multi" else None,
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
    host = os.environ.get("HOST")
    if not host:
        host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
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
    if os.environ.get("NO_BROWSER") != "1" and not os.environ.get("RENDER"):

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
