from __future__ import annotations

import pandas as pd
import random
import os
import re
import sys


def _is_pyinstaller() -> bool:
    return bool(getattr(sys, "frozen", False)) and hasattr(sys, "_MEIPASS")


def _user_data_dir() -> str:
    """题库 Excel、question_progress.csv 所在目录：开发与 PyInstaller 下均为可执行文件/脚本同目录。"""
    if _is_pyinstaller():
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


_SCRIPT_DIR = _user_data_dir()

_OPTION_COLS = ("选项 A", "选项 B", "选项 C", "选项 D", "选项 E", "选项E")

# 全库题号（从 1 起）：1–350 单选，351–550 多选（5 项 A–E，须全中），551–790 判断
Q_SINGLE_END = 350
Q_MULTI_START, Q_MULTI_END = 351, 550
Q_JUDGE_START, Q_JUDGE_END = 551, 790
ROUND_PLAN = {"single": 100, "multi": 30, "judge": 40}

def _resolve_path(path: str) -> str:
    return path if os.path.isabs(path) else os.path.join(_SCRIPT_DIR, path)


def type_by_question_number(n: int) -> str:
    """按全库题号（第 n 题）划分题型；与 Excel 行顺序一致（question_index = n - 1）。"""
    if 1 <= n <= Q_SINGLE_END:
        return "single"
    if Q_MULTI_START <= n <= Q_MULTI_END:
        return "multi"
    if Q_JUDGE_START <= n <= Q_JUDGE_END:
        return "judge"
    return "single"


def _question_number_for_row(row: pd.Series, row_pos: int) -> int:
    """row_pos 为 0-based 行序；若已有 question_index 则以之为准。"""
    if "question_index" in row.index and pd.notna(row.get("question_index")):
        return int(row["question_index"]) + 1
    return row_pos + 1


def _read_excel(path: str) -> pd.DataFrame:
    """部分题库 xlsx 会让 openpyxl 在解析数据校验时报错，改用 calamine 可绕过。"""
    try:
        return pd.read_excel(path)
    except ValueError as e:
        if "must be one of" not in str(e):
            raise
    try:
        return pd.read_excel(path, engine="calamine")
    except Exception as e2:
        raise RuntimeError(
            "题库 Excel 无法用默认引擎读取（常见于工作表数据校验格式问题）。\n"
            "请先执行：pip install python-calamine\n"
            "安装后重试；若仍失败，请用 Excel 打开题库「另存为」新的 .xlsx 再试。"
        ) from e2


def _strip_answer_prefix(s: str) -> str:
    s = str(s).strip()
    m = re.search(r"参考答案[：:]\s*(.+)", s, flags=re.DOTALL)
    return m.group(1).strip() if m else s


def _parse_judge_canonical(raw) -> str:
    if pd.isna(raw):
        return ""
    s = _strip_answer_prefix(str(raw))
    letters = re.findall(r"[ABCD]", s.upper())
    if letters:
        return letters[0]
    if "对" in s and "错" not in s:
        return "A"
    if "错" in s and "对" not in s:
        return "B"
    if "对" in s and "错" in s:
        return "A" if s.index("对") < s.index("错") else "B"
    return ""


def _canonical_standard(raw, qtype: str, row: pd.Series) -> str:
    raw_str = _strip_answer_prefix(str(raw)) if pd.notna(raw) else ""
    if qtype == "multi":
        return "".join(sorted(set(re.findall(r"[A-E]", raw_str.upper()))))
    if qtype == "judge":
        return _parse_judge_canonical(raw_str)
    letters = re.findall(r"[ABCD]", raw_str.upper())
    if letters:
        return letters[0]
    return _parse_judge_canonical(raw_str)


def normalize_user_answer(user_in: str, qtype: str) -> str:
    """将用户输入规范成与标准答案可比的形式。"""
    qtype = str(qtype).strip()
    u = str(user_in).strip()
    if qtype == "multi":
        return "".join(sorted(set(re.findall(r"[A-E]", u.upper()))))
    u = u.upper()
    if qtype == "judge":
        if u in ("A", "B"):
            return u
        if u in ("对", "√", "V"):
            return "A"
        if u in ("错", "×", "X"):
            return "B"
        if u in ("T", "TRUE", "1", "Y", "YES"):
            return "A"
        if u in ("F", "FALSE", "0", "N", "NO"):
            return "B"
        m = re.search(r"[ABCD]", u)
        return m.group(0) if m else ""
    m = re.search(r"[ABCD]", u)
    return m.group(0) if m else ""


def check_answer(user_in: str, standard: str, qtype: str) -> bool:
    """多选题：所选字母集合与标准答案完全一致才算对（顺序无关）。"""
    nu = normalize_user_answer(user_in, qtype)
    ns = str(standard).strip().upper()
    return nu == ns


def format_standard_display(standard: str, qtype: str) -> str:
    s = str(standard).strip().upper()
    qtype = str(qtype).strip()
    if qtype == "multi":
        return "、".join(list(s)) if s else ""
    if qtype == "judge":
        if s == "A":
            return "A（对）"
        if s == "B":
            return "B（错）"
        return s
    return s


def _type_label(qt: str) -> str:
    return {"single": "单选", "multi": "多选", "judge": "判断"}.get(str(qt), str(qt))


def _build_question_content(row: pd.Series) -> str:
    if "题目内容" in row.index and pd.notna(row["题目内容"]) and str(row["题目内容"]).strip():
        return str(row["题目内容"]).strip()
    stem = row["题干"] if "题干" in row.index else ""
    lines = [str(stem).strip()]
    for col in _OPTION_COLS:
        if col in row.index and pd.notna(row[col]) and str(row[col]).strip():
            lines.append(str(row[col]).strip())
    return "\n".join(lines)


def _prepare_question_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """统一列名与答案格式，兼容「题干/正确答案」与「题目内容/标准答案」两套表头。"""
    if "标准答案" not in df.columns and "正确答案" in df.columns:
        df = df.rename(columns={"正确答案": "标准答案"})
    if "题目内容" not in df.columns and "题干" in df.columns:
        df = df.copy()
        df["题目内容"] = df.apply(_build_question_content, axis=1)
    elif "题目内容" in df.columns:
        mask = df["题目内容"].isna() | (df["题目内容"].astype(str).str.strip() == "")
        if mask.any() and "题干" in df.columns:
            df = df.copy()
            sub = df.loc[mask]
            df.loc[mask, "题目内容"] = sub.apply(_build_question_content, axis=1)
    if "解析" not in df.columns:
        df = df.copy()
        df["解析"] = "无"
    else:
        df = df.copy()
        df["解析"] = df["解析"].fillna("无")

    types_list = []
    canon_list = []
    for i, (_, row) in enumerate(df.iterrows()):
        raw = row["标准答案"]
        qnum = _question_number_for_row(row, i)
        qt = type_by_question_number(qnum)
        ca = _canonical_standard(raw, qt, row)
        types_list.append(qt)
        canon_list.append(ca)
    df["题目类型"] = types_list
    df["标准答案"] = canon_list
    return df


class QuestionBank:
    def __init__(
        self,
        excel_path="电力交易员中级工题库2025(2).xlsx",
        progress_path="question_progress.csv",
        wrong_book_path="wrong_book.csv",
        quiet: bool = False,
    ):
        self.excel_path = _resolve_path(excel_path)
        self.progress_path = _resolve_path(progress_path)
        self.wrong_book_path = _resolve_path(wrong_book_path)
        self.quiet = quiet
        self.df = self.load_progress()
        self.wrong_book = self.load_wrong_book()
        self.total_questions = len(self.df)
        if not self.quiet:
            self.show_overall_progress()
            print(f"✅ 题库加载成功！总题数：{self.total_questions} 道")

    def load_progress(self):
        if os.path.exists(self.progress_path):
            df = pd.read_csv(self.progress_path, encoding="utf-8")
            return _prepare_question_dataframe(df)
        if not os.path.isfile(self.excel_path):
            raise FileNotFoundError(
                f"找不到题库 Excel：{self.excel_path}\n"
                "请将题库文件放在与 exam.py 同一目录，或把文件名改为默认的 "
                "「电力交易员中级工题库2025(2).xlsx」，或在代码里传入正确的 excel_path。"
            )
        df = _read_excel(self.excel_path)
        df = _prepare_question_dataframe(df)
        df["status"] = "未做"
        df["question_index"] = range(len(df))
        self.save_progress(df)
        return df

    def save_progress(self, df=None):
        if df is None:
            df = self.df
        df.to_csv(self.progress_path, index=False, encoding="utf-8")

    def load_wrong_book(self) -> set[int]:
        if not os.path.exists(self.wrong_book_path):
            return set()
        try:
            df = pd.read_csv(self.wrong_book_path, encoding="utf-8")
            if "question_index" not in df.columns:
                return set()
            ids = {
                int(x)
                for x in df["question_index"].dropna().tolist()
                if str(x).strip() != ""
            }
            return ids
        except Exception:
            return set()

    def save_wrong_book(self) -> None:
        ids = sorted(self.wrong_book)
        wb = pd.DataFrame({"question_index": ids})
        wb.to_csv(self.wrong_book_path, index=False, encoding="utf-8")

    def record_wrong_question(self, q_idx: int) -> None:
        if int(q_idx) not in self.wrong_book:
            self.wrong_book.add(int(q_idx))
            self.save_wrong_book()

    def clear_wrong_book(self) -> int:
        n = len(self.wrong_book)
        self.wrong_book = set()
        self.save_wrong_book()
        return n

    def update_question_status(self, q_idx, is_correct):
        idx = self.df[self.df["question_index"] == q_idx].index[0]
        self.df.at[idx, "status"] = "正确" if is_correct else "错误"
        self.save_progress()

    def _pick_questions_by_type(self, qtype: str, target: int) -> list[int]:
        """按题型抽题：错题优先，其次未做，再补正确题，最后打乱。"""
        pool = self.df[self.df["题目类型"] == qtype]
        wrong = pool[pool["status"] == "错误"]["question_index"].tolist()
        undone = pool[pool["status"] == "未做"]["question_index"].tolist()
        correct = pool[pool["status"] == "正确"]["question_index"].tolist()

        selected = list(wrong)
        need = target - len(selected)
        if need > 0 and undone:
            selected += random.sample(undone, min(need, len(undone)))
        need = target - len(selected)
        if need > 0 and correct:
            selected += random.sample(correct, min(need, len(correct)))
        random.shuffle(selected)
        return selected[:target]

    def get_round_questions(self) -> list[int]:
        """固定每轮：100 单选 + 30 多选 + 40 判断（错题优先）。"""
        selected: list[int] = []
        for qtype, count in ROUND_PLAN.items():
            selected += self._pick_questions_by_type(qtype, count)
        random.shuffle(selected)
        return selected

    def get_wrong_questions(self) -> list[int]:
        """错题集重刷：按独立错题本 wrong_book.csv。"""
        valid = set(self.df["question_index"].tolist())
        wrong = [qid for qid in self.wrong_book if qid in valid]
        random.shuffle(wrong)
        return wrong

    def get_stats(self):
        total = len(self.df)
        done = len(self.df[self.df["status"].isin(["正确", "错误"])])
        correct = len(self.df[self.df["status"] == "正确"])
        wrong = len(self.df[self.df["status"] == "错误"])
        undone = total - done
        rate_pct = round(correct / done * 100, 1) if done else 0.0
        return {
            "total": total,
            "done": int(done),
            "undone": int(undone),
            "correct": int(correct),
            "wrong": int(wrong),
            "wrong_book": int(len(self.wrong_book)),
            "accuracy_percent": rate_pct,
        }

    def show_overall_progress(self):
        s = self.get_stats()
        rate = f"{s['accuracy_percent']:.1f}%"
        print("\n📊 整体刷题进度")
        print("-"*50)
        print(f"总题数：{s['total']} | 已做：{s['done']} | 未做：{s['undone']}")
        print(f"正确：{s['correct']} | 错题：{s['wrong']} | 正确率：{rate}")
        print("-"*50)

class Exam:
    def __init__(self):
        self.qb = QuestionBank()

    def start(self):
        while True:
            print("\n" + "="*50)
            print("📝 开始一轮刷题（100单选 + 30多选 + 40判断｜错题优先）")
            print("="*50)
            questions = self.qb.get_round_questions()
            correct = 0
            wrong_list = []

            for i, qid in enumerate(questions, 1):
                q = self.qb.df[self.qb.df["question_index"] == qid].iloc[0]
                qt = str(q["题目类型"])
                print(f"\n【第{i}题】[{_type_label(qt)}]")
                print(q["题目内容"])
                if qt == "multi":
                    ans = input("请输入答案（多选 5 项 A–E，字母连写如 ACDE，须全部正确选项）：").strip()
                elif qt == "judge":
                    ans = input("请输入答案（A/B 或 对/错）：").strip()
                else:
                    ans = input("请输入答案（A/B/C/D）：").strip()

                if check_answer(ans, q["标准答案"], qt):
                    print("✅ 回答正确")
                    correct += 1
                    self.qb.update_question_status(qid, True)
                else:
                    disp = format_standard_display(q["标准答案"], qt)
                    print(f"❌ 错误！正确答案：{disp}")
                    self.qb.update_question_status(qid, False)
                    wrong_list.append(q)

            print(f"\n🎯 本轮得分：{correct*2} 分 | 答对：{correct} 题")
            if wrong_list and input("\n查看错题解析？(y/n)：").lower() == "y":
                for w in wrong_list:
                    print("\n" + "-"*50)
                    print("❌ 错题")
                    print(w["题目内容"])
                    print("正确答案：", format_standard_display(w["标准答案"], str(w["题目类型"])))
                    print("解析：", w["解析"])

            self.qb.show_overall_progress()
            if input("\n继续下一轮？(y/n)：").lower() != "y":
                print("\n👋 进度已自动保存，下次打开继续刷题！")
                break

if __name__ == "__main__":
    app = Exam()
    app.start()
