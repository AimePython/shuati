#!/usr/bin/env python3
"""从「电力交易员/样卷2、样卷3」PDF 解析题目，生成 banks/erji.xlsx 与 banks/sanji.xlsx。"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter
from pathlib import Path

import fitz
import pandas as pd

ROOT = Path(__file__).resolve().parent
PDF_ROOT = ROOT / "电力交易员"
OUT_DIR = ROOT / "banks"

SECTION_RE = re.compile(r"[一二三四五六七八]、\s*(单选题|多选题|判断题)")
QSPLIT_RE = re.compile(r"(?m)^(\d+)、\s*")
OPT_SPLIT_RE = re.compile(r"(?m)^([A-E])[、.．]\s*")
ANSWER_RE = re.compile(r"【参考答案】\s*([A-Ea-e]+)")
NOISE_LINE_RE = re.compile(
    r"^(单位名称|姓名|准考证号|地区|得分|评分人|考生姓名|身份证号|"
    r"题号|[一二三四五六七]|【样卷】|考试时间.*|样卷说明|"
    r"本样卷仅供参考.*|样卷中的题目类型.*|请仔细阅读题目.*|"
    r"电力交易员---+.*)$"
)
TYPE_MAP = {"单选题": "single", "多选题": "multi", "判断题": "judge"}
EXPECTED = {"single": 100, "multi": 30, "judge": 40}

LEVEL_FROM_NAME = re.compile(r"电力交易员---(二级|三级)")


def _clean_lines(text: str) -> str:
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if NOISE_LINE_RE.match(line):
            continue
        out.append(line)
    return "\n".join(out)


def _norm_space(s: str) -> str:
    s = re.sub(r"\s+", "", s)
    s = s.replace("（", "(").replace("）", ")")
    s = s.replace("：", ":").replace("，", ",")
    return s


def _parse_body(body: str, qtype: str) -> dict | None:
    body = body.strip()
    if not body:
        return None
    am = ANSWER_RE.search(body)
    if not am:
        return None
    raw_ans = am.group(1).upper()
    body = body[: am.start()].strip()
    parts = OPT_SPLIT_RE.split(body)
    if len(parts) < 3:
        return None
    stem = parts[0].strip()
    stem = re.sub(r"^\d+[、.．]\s*", "", stem)
    options: dict[str, str] = {}
    i = 1
    while i + 1 < len(parts):
        letter = parts[i].upper()
        text = parts[i + 1].strip()
        options[letter] = text
        i += 2
    if qtype == "judge":
        if "A" not in options:
            options["A"] = "正确"
        if "B" not in options:
            options["B"] = "错误"
        letters = re.findall(r"[AB]", raw_ans)
        answer = letters[0] if letters else ""
    elif qtype == "multi":
        answer = "".join(sorted(set(re.findall(r"[A-E]", raw_ans))))
    else:
        letters = re.findall(r"[A-E]", raw_ans)
        answer = letters[0] if letters else ""
    if not answer or not stem:
        return None
    content_lines = [stem]
    for ch in "ABCDE":
        if ch in options and options[ch]:
            content_lines.append(f"{ch}、 {options[ch]}")
    return {
        "题干": stem,
        "标准答案": answer,
        "选项 A": options.get("A", ""),
        "选项 B": options.get("B", ""),
        "选项 C": options.get("C", ""),
        "选项 D": options.get("D", ""),
        "选项E": options.get("E", ""),
        "题目内容": "\n".join(content_lines),
        "解析": "无",
        "题目类型": qtype,
    }


def parse_pdf(path: Path) -> list[dict]:
    doc = fitz.open(path)
    text = "\n".join(page.get_text() for page in doc)
    text = _clean_lines(text)
    chunks = SECTION_RE.split(text)
    questions: list[dict] = []
    i = 1
    while i + 1 < len(chunks):
        heading = chunks[i]
        section = chunks[i + 1]
        qtype = TYPE_MAP.get(heading)
        i += 2
        if not qtype:
            continue
        parts = QSPLIT_RE.split(section)
        j = 1
        while j + 1 < len(parts):
            body = parts[j + 1]
            parsed = _parse_body(body, qtype)
            if parsed:
                questions.append(parsed)
            j += 2
    return questions


def level_of(path: Path) -> str | None:
    m = LEVEL_FROM_NAME.search(path.name)
    return m.group(1) if m else None


def dedupe(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        key = "|".join(
            [
                row["题目类型"],
                _norm_space(row["题干"]),
                _norm_space(row.get("选项 A", "")),
                _norm_space(row.get("选项 B", "")),
                _norm_space(row.get("选项 C", "")),
                _norm_space(row.get("选项 D", "")),
                _norm_space(row.get("选项E", "")),
            ]
        )
        if key not in seen:
            seen[key] = row
            order.append(key)
        else:
            old = seen[key]
            if len(row["标准答案"]) > len(old["标准答案"]):
                seen[key] = row
    return [seen[k] for k in order]


def sort_by_type(rows: list[dict]) -> list[dict]:
    rank = {"single": 0, "multi": 1, "judge": 2}
    return sorted(rows, key=lambda r: (rank.get(r["题目类型"], 9), r["题干"]))


def to_excel(rows: list[dict], path: Path) -> None:
    df = pd.DataFrame(rows)
    df = df[
        [
            "题干",
            "标准答案",
            "选项 A",
            "选项 B",
            "选项 C",
            "选项 D",
            "选项E",
            "题目内容",
            "解析",
            "题目类型",
        ]
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_excel(path, index=False)


def main() -> int:
    if not PDF_ROOT.is_dir():
        print(f"❌ 找不到样卷目录：{PDF_ROOT}", file=sys.stderr)
        return 1
    pdfs = sorted(PDF_ROOT.rglob("*.pdf"))
    if not pdfs:
        print("❌ 没有 PDF", file=sys.stderr)
        return 1

    by_level: dict[str, list[dict]] = {"二级": [], "三级": []}
    paper_stats = []
    for pdf in pdfs:
        level = level_of(pdf)
        if not level:
            print(f"跳过（无法识别等级）：{pdf.name}")
            continue
        qs = parse_pdf(pdf)
        counts = Counter(q["题目类型"] for q in qs)
        missing_ans = 0
        paper_stats.append((pdf.relative_to(PDF_ROOT).as_posix(), counts, len(qs)))
        if counts != EXPECTED:
            print(
                f"⚠ {pdf.relative_to(PDF_ROOT)} 题量 {dict(counts)} / 共 {len(qs)} "
                f"（期望 {EXPECTED}）"
            )
        by_level[level].extend(qs)

    print("\n—— 各卷解析 ——")
    for name, counts, n in paper_stats:
        flag = "" if dict(counts) == EXPECTED and n == 170 else " ⚠"
        print(f"  {name}: {n} {dict(counts)}{flag}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for level, rows in by_level.items():
        uniq = sort_by_type(dedupe(rows))
        counts = Counter(q["题目类型"] for q in uniq)
        slug = "erji" if level == "二级" else "sanji"
        out = OUT_DIR / f"{slug}.xlsx"
        to_excel(uniq, out)
        written.append((level, out, len(rows), len(uniq), counts))
        print(
            f"\n✅ {level}: 原始 {len(rows)} 题 → 去重 {len(uniq)} 题 {dict(counts)}"
        )
        print(f"   写入 {out}")

    empty_ans = [
        (lv, i, r["题干"][:40])
        for lv, rows in by_level.items()
        for i, r in enumerate(sort_by_type(dedupe(rows)), 1)
        if not r["标准答案"]
    ]
    if empty_ans:
        print("\n⚠ 无答案题目：", empty_ans[:10])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
