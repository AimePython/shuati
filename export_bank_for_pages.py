#!/usr/bin/env python3
"""
将全部题库导出为 docs/ 下的 JSON，供 GitHub Pages 静态站点使用。

用法（在项目根目录）：
  python3 export_bank_for_pages.py

会写入：
  docs/banks.json
  docs/questions_zhongji.json
  docs/questions_erji.json
  docs/questions_sanji.json
  docs/questions.json   （中级工题库副本，兼容旧链接）
"""
from __future__ import annotations

import json
import os
import shutil
import sys

from exam import (
    QuestionBank,
    _type_label,
    hint_for_type,
    list_banks,
    option_letters_for_row,
)


def export_bank(bank_id: str) -> tuple[dict, list[dict]]:
    meta = next(b for b in list_banks() if b["id"] == bank_id)
    progress = (
        "question_progress.csv"
        if bank_id == "zhongji"
        else f"question_progress__{bank_id}.csv"
    )
    b = QuestionBank(
        excel_path=meta["excel"],
        progress_path=progress,
        quiet=True,
        bank_id=bank_id,
    )
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
                "status": "未做",
                "question_type": qt,
                "type_label": _type_label(qt),
                "hint": hint_for_type(qt, type_by_number=b.type_by_number),
                "option_letters": option_letters_for_row(row, qt),
                "standard": str(row["标准答案"]).strip(),
                "explanation": str(row["解析"]),
            }
        )
    payload = {
        "version": 2,
        "bank_id": bank_id,
        "bank_name": b.bank_name,
        "exported_by": "export_bank_for_pages.py",
        "papers": [
            {
                "id": p["id"],
                "name": p["name"],
                "count": int(p.get("count") or 0),
                "pack": p.get("pack") or "",
                "set_no": int(p.get("set_no") or 0),
                "question_ids": list(p.get("question_ids") or []),
            }
            for p in b.list_papers(include_ids=True)
        ],
        "questions": questions,
    }
    info = {
        "id": bank_id,
        "name": b.bank_name,
        "short_name": meta["short_name"],
        "file": f"questions_{bank_id}.json",
        "count": len(questions),
        "papers": [
            {"id": p["id"], "name": p["name"], "count": int(p.get("count") or 0)}
            for p in b.list_papers(include_ids=False)
        ],
    }
    return info, payload


def main() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(root, "docs")
    os.makedirs(out_dir, exist_ok=True)

    catalog = []
    try:
        for meta in list_banks():
            info, payload = export_bank(meta["id"])
            out_path = os.path.join(out_dir, info["file"])
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            catalog.append(info)
            print(f"✅ 已写入 {out_path}（共 {info['count']} 题）")
    except Exception as e:
        print(f"❌ 无法加载题库：{e}", file=sys.stderr)
        return 1

    banks_path = os.path.join(out_dir, "banks.json")
    with open(banks_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": 2,
                "default": "zhongji",
                "banks": catalog,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"✅ 已写入 {banks_path}")

    zhongji = os.path.join(out_dir, "questions_zhongji.json")
    compat = os.path.join(out_dir, "questions.json")
    if os.path.isfile(zhongji):
        shutil.copy2(zhongji, compat)
        print(f"✅ 已同步兼容文件 {compat}")

    print("下一步：git add docs banks && git commit && git push。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
