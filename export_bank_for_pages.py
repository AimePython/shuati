#!/usr/bin/env python3
"""
将题库导出为 docs/questions.json，供 GitHub Pages 静态站点使用。

用法（在项目根目录）：
  python3 export_bank_for_pages.py

前提：与 exam.QuestionBank 相同 —— 当前目录已有 question_progress.csv，
或存在默认 Excel「电力交易员中级工题库2025(2).xlsx」生成进度。

导出后把 docs/ 推送到 GitHub，仓库 Settings → Pages → Source 选「Deploy from a branch」
分支 main、文件夹 /docs，即可通过 https://<用户>.github.io/<仓库名>/ 访问。
"""
from __future__ import annotations

import json
import os
import sys

from exam import QuestionBank, _type_label


def main() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(root, "docs")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "questions.json")

    hints = {
        "single": "单选题（全库第 1–350 题）：四选一",
        "multi": "多选题（全库第 351–550 题，选项 A–E）：须选中全部正确选项，选好后点「确认答案」；提交后显示正确答案",
        "judge": "判断题（全库第 551–790 题）：选对（A/对）或错（B/错）",
    }

    try:
        b = QuestionBank(quiet=True)
    except Exception as e:
        print(f"❌ 无法加载题库：{e}", file=sys.stderr)
        print(
            "请放置 Excel 或已有的 question_progress.csv 到项目根目录后重试。",
            file=sys.stderr,
        )
        return 1

    questions = []
    for _, row in b.df.iterrows():
        qt = str(row["题目类型"])
        qid = int(row["question_index"])
        qnum = qid + 1
        questions.append(
            {
                "qid": qid,
                "question_number": qnum,
                "content": str(row["题目内容"]),
                "status": str(row["status"]),
                "question_type": qt,
                "type_label": _type_label(qt),
                "hint": hints.get(qt, ""),
                "standard": str(row["标准答案"]).strip(),
                "explanation": str(row["解析"]),
            }
        )

    payload = {"version": 1, "exported_by": "export_bank_for_pages.py", "questions": questions}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"✅ 已写入 {out_path}（共 {len(questions)} 题）")
    print("下一步：git add docs && git commit && git push，并启用 GitHub Pages（/docs）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
