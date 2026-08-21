"""答题进度写入 CSV 后，新 session 再登录仍能恢复。"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.pop("CORS_ORIGINS", None)

from werkzeug.security import generate_password_hash

import web_app
from web_app import _blank_user


class ProgressPersistTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data_dir = tempfile.mkdtemp(prefix="shuati_progress_")
        os.environ["DATA_DIR"] = self.data_dir
        with web_app._bank_lock:
            web_app._bank_by_user.clear()
        web_app._accounts_ready = False
        self.app = web_app.app
        self.app.config["TESTING"] = True
        self.username = "persist_user1"
        self.password = "pass1234"
        self._seed_user()
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        with web_app._bank_lock:
            web_app._bank_by_user.clear()
        shutil.rmtree(self.data_dir, ignore_errors=True)

    def _seed_user(self) -> None:
        with web_app._users_lock:
            users = web_app._load_users()
            users[self.username] = _blank_user(
                generate_password_hash(self.password),
                password=self.password,
                role="user",
                status="approved",
                reviewed_at="test",
                reviewed_by="test",
            )
            web_app._save_users(users)

    def _login(self, client):
        res = client.post(
            "/api/auth/login",
            json={"username": self.username, "password": self.password},
        )
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        data = res.get_json()
        self.assertTrue(data.get("ok"))

    def _select_erji(self, client):
        res = client.post("/api/bank", json={"bank_id": "erji"})
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        return data

    def _wrong_letter(self, standard: str) -> str:
        std = str(standard or "A").strip().upper()[:1] or "A"
        return "B" if std == "A" else "A"

    def test_answer_survives_new_session_and_wrong_book(self) -> None:
        self._login(self.client)
        self._select_erji(self.client)

        q = self.client.get("/api/question/0")
        self.assertEqual(q.status_code, 200, q.get_data(as_text=True))
        qdata = q.get_json()
        self.assertTrue(qdata.get("ok"))
        std = qdata.get("standard_answer")
        wrong = self._wrong_letter(std)

        ans = self.client.post("/api/answer", json={"qid": 0, "answer": wrong})
        self.assertEqual(ans.status_code, 200, ans.get_data(as_text=True))
        body = ans.get_json()
        self.assertTrue(body.get("ok"))
        self.assertFalse(body.get("correct"))
        self.assertGreaterEqual(int(body["stats"]["done"]), 1)
        self.assertGreaterEqual(int(body["stats"]["wrong_book"]), 1)

        q1 = self.client.get("/api/question/1")
        self.assertEqual(q1.status_code, 200, q1.get_data(as_text=True))
        std1 = q1.get_json().get("standard_answer")
        ok_ans = self.client.post("/api/answer", json={"qid": 1, "answer": std1})
        self.assertEqual(ok_ans.status_code, 200, ok_ans.get_data(as_text=True))
        self.assertTrue(ok_ans.get_json().get("correct"))

        progress_csv = os.path.join(
            self.data_dir, "user_progress", f"{self.username}__erji.csv"
        )
        wrong_csv = os.path.join(
            self.data_dir, "user_progress", f"{self.username}__erji_wrong_book.csv"
        )
        self.assertTrue(os.path.isfile(progress_csv), "答题后进度 CSV 应立即落盘")
        self.assertTrue(os.path.isfile(wrong_csv), "答错后错题本 CSV 应立即落盘")

        # 模拟进程重启：内存题库丢弃，不经过 logout 的缓存对象。
        with web_app._bank_lock:
            web_app._bank_by_user.clear()

        other = self.app.test_client()
        self._login(other)
        restored = self._select_erji(other)
        self.assertGreaterEqual(int(restored["done"]), 2)
        self.assertGreaterEqual(int(restored["correct"]), 1)
        self.assertGreaterEqual(int(restored["wrong"]), 1)
        self.assertGreaterEqual(int(restored["wrong_book"]), 1)

        q0 = other.get("/api/question/0").get_json()
        q1b = other.get("/api/question/1").get_json()
        self.assertEqual(q0.get("status"), "错误")
        self.assertEqual(q1b.get("status"), "正确")

        prog = other.get("/api/progress")
        self.assertEqual(prog.status_code, 200, prog.get_data(as_text=True))
        pdata = prog.get_json()
        self.assertEqual(pdata["statuses"].get("0"), "错误")
        self.assertEqual(pdata["statuses"].get("1"), "正确")
        self.assertIn(0, pdata.get("wrong_book") or [])

        stats = other.get("/api/stats").get_json()
        self.assertGreaterEqual(int(stats["done"]), 2)
        self.assertGreaterEqual(int(stats["wrong_book"]), 1)

    def test_text_plain_beacon_answer_is_saved(self) -> None:
        self._login(self.client)
        self._select_erji(self.client)
        q = self.client.get("/api/question/2").get_json()
        payload = json.dumps({"qid": 2, "answer": q.get("standard_answer")})
        res = self.client.post(
            "/api/answer",
            data=payload,
            content_type="text/plain",
        )
        self.assertEqual(res.status_code, 200, res.get_data(as_text=True))
        self.assertTrue(res.get_json().get("ok"))

        with web_app._bank_lock:
            web_app._bank_by_user.clear()
        other = self.app.test_client()
        self._login(other)
        self._select_erji(other)
        q2 = other.get("/api/question/2").get_json()
        self.assertEqual(q2.get("status"), "正确")


if __name__ == "__main__":
    unittest.main()
