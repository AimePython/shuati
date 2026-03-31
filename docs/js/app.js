(function () {
  const STORAGE_KEY = "dl_trader_quiz_pages_v1";

  const $ = (id) => document.getElementById(id);

  const els = {
    stats: {
      total: $("st-total"),
      done: $("st-done"),
      undone: $("st-undone"),
      correct: $("st-correct"),
      wrong: $("st-wrong"),
      rate: $("st-rate"),
    },
    err: $("global-error"),
    roundNum: $("round-num"),
    btnStart: $("btn-start"),
    startPanel: $("start-panel"),
    quizPanel: $("quiz-panel"),
    summaryPanel: $("summary-panel"),
    quizProgress: $("quiz-progress"),
    qStatus: $("q-status"),
    qTypeTag: $("q-type-tag"),
    qHint: $("q-hint"),
    questionText: $("question-text"),
    choices: $("choices"),
    btnConfirmMulti: $("btn-confirm-multi"),
    feedback: $("feedback"),
    feedbackMsg: $("feedback-msg"),
    feedbackExplain: $("feedback-explain"),
    btnNext: $("btn-next"),
    btnAbort: $("btn-abort"),
    sumScore: $("sum-score"),
    sumCorrect: $("sum-correct"),
    btnBack: $("btn-back"),
  };

  /** @type {Array<Record<string, unknown>>} */
  let bank = [];
  let roundIds = [];
  let idx = 0;
  let roundCorrect = 0;
  let answered = false;
  /** @type {Set<string> | null} */
  let multiPicked = null;
  let currentQtype = "single";

  function loadProgressMap() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o.progress === "object" && o.progress ? o.progress : {};
    } catch {
      return {};
    }
  }

  function saveProgressMap(progress) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ progress, updated: Date.now() }),
    );
  }

  function mergeBank(baseQuestions, progress) {
    return baseQuestions.map((q) => ({
      ...q,
      status:
        progress[q.qid] !== undefined && progress[q.qid] !== null
          ? String(progress[q.qid])
          : String(q.status),
    }));
  }

  function normalizeUserAnswer(userIn, qtype) {
    const qt = String(qtype).trim();
    let u = String(userIn).trim();
    if (qt === "multi") {
      const letters = u.toUpperCase().match(/[A-E]/g) || [];
      const set = [...new Set(letters)];
      set.sort();
      return set.join("");
    }
    u = u.toUpperCase();
    if (qt === "judge") {
      if (u === "A" || u === "B") return u;
      if (["对", "√", "V"].includes(u)) return "A";
      if (["错", "×", "X"].includes(u)) return "B";
      if (["T", "TRUE", "1", "Y", "YES"].includes(u)) return "A";
      if (["F", "FALSE", "0", "N", "NO"].includes(u)) return "B";
      const mj = u.match(/[ABCD]/);
      return mj ? mj[0] : "";
    }
    const m = u.match(/[ABCD]/);
    return m ? m[0] : "";
  }

  function checkAnswer(userIn, standard, qtype) {
    const nu = normalizeUserAnswer(userIn, qtype);
    const ns = String(standard).trim().toUpperCase();
    return nu === ns;
  }

  function formatStandardDisplay(standard, qtype) {
    const s = String(standard).trim().toUpperCase();
    const qt = String(qtype).trim();
    if (qt === "multi") return s ? s.split("").join("、") : "";
    if (qt === "judge") {
      if (s === "A") return "A（对）";
      if (s === "B") return "B（错）";
      return s;
    }
    return s;
  }

  function getStats() {
    const total = bank.length;
    let done = 0;
    let correct = 0;
    let wrong = 0;
    for (const r of bank) {
      const st = r.status;
      if (st === "正确" || st === "错误") {
        done += 1;
        if (st === "正确") correct += 1;
        else wrong += 1;
      }
    }
    const undone = total - done;
    const ratePct = done ? Math.round((correct / done) * 1000) / 10 : 0;
    return { total, done, undone, correct, wrong, accuracy_percent: ratePct };
  }

  function persistBankProgress() {
    const progress = {};
    for (const r of bank) progress[r.qid] = r.status;
    saveProgressMap(progress);
  }

  function updateQuestionStatus(qid, isCorrect) {
    const row = bank.find((r) => r.qid === qid);
    if (!row) return;
    row.status = isCorrect ? "正确" : "错误";
    persistBankProgress();
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sampleWithoutReplacement(ids, k) {
    const copy = ids.slice();
    shuffleInPlace(copy);
    return copy.slice(0, k);
  }

  /** 与 exam.QuestionBank.get_round_questions 一致 */
  function getRoundQuestions(num) {
    const wrong = bank.filter((r) => r.status === "错误").map((r) => r.qid);
    const undone = bank.filter((r) => r.status === "未做").map((r) => r.qid);
    const selected = wrong.slice(0, num);
    let need = num - selected.length;
    if (need > 0 && undone.length) {
      const extra = sampleWithoutReplacement(
        undone,
        Math.min(need, undone.length),
      );
      selected.push(...extra);
    }
    shuffleInPlace(selected);
    return selected;
  }

  function showError(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
  }

  function clearError() {
    els.err.hidden = true;
    els.err.textContent = "";
  }

  function renderStats() {
    const s = getStats();
    els.stats.total.textContent = String(s.total);
    els.stats.done.textContent = String(s.done);
    els.stats.undone.textContent = String(s.undone);
    els.stats.correct.textContent = String(s.correct);
    els.stats.wrong.textContent = String(s.wrong);
    els.stats.rate.textContent = `${s.accuracy_percent.toFixed(1)}%`;
  }

  function clearChoices() {
    els.choices.innerHTML = "";
    els.choices.className = "choices";
    els.btnConfirmMulti.hidden = true;
    els.btnConfirmMulti.onclick = null;
    els.qHint.textContent = "";
    els.qTypeTag.textContent = "—";
    multiPicked = null;
  }

  /** @param {Record<string, unknown>} q */
  function renderChoices(q) {
    currentQtype = (q.question_type && String(q.question_type)) || "single";
    els.qTypeTag.textContent = q.type_label ? `${q.type_label}题` : "—";
    els.qHint.textContent = (q.hint && String(q.hint)) || "";

    if (currentQtype === "single") {
      for (const ch of ["A", "B", "C", "D"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.dataset.value = ch;
        b.textContent = ch;
        b.addEventListener("click", () => {
          if (!answered) submitAnswer(ch);
        });
        els.choices.appendChild(b);
      }
      return;
    }

    if (currentQtype === "multi") {
      els.choices.classList.add("choices--multi");
      els.btnConfirmMulti.hidden = false;
      multiPicked = new Set();
      for (const ch of ["A", "B", "C", "D", "E"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice multi";
        b.dataset.value = ch;
        b.textContent = ch;
        b.addEventListener("click", () => {
          if (answered) return;
          if (multiPicked.has(ch)) {
            multiPicked.delete(ch);
            b.classList.remove("active");
          } else {
            multiPicked.add(ch);
            b.classList.add("active");
          }
        });
        els.choices.appendChild(b);
      }
      els.btnConfirmMulti.onclick = () => {
        if (answered) return;
        const s = Array.from(multiPicked).sort().join("");
        submitAnswer(s);
      };
      return;
    }

    if (currentQtype === "judge") {
      els.choices.classList.add("choices--judge");
      for (const { v, label } of [
        { v: "A", label: "A · 对" },
        { v: "B", label: "B · 错" },
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice judge";
        b.dataset.value = v;
        b.textContent = label;
        b.addEventListener("click", () => {
          if (!answered) submitAnswer(v);
        });
        els.choices.appendChild(b);
      }
    }
  }

  async function submitAnswer(answerStr) {
    if (answered) return;
    answered = true;
    els.choices.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
    });
    els.btnConfirmMulti.hidden = true;

    const qid = roundIds[idx];
    const row = bank.find((r) => r.qid === qid);
    if (!row) return;

    const qt = String(row.question_type);
    const std = String(row.standard).trim();
    const isOk = checkAnswer(answerStr, std, qt);
    updateQuestionStatus(qid, isOk);

    const disp = formatStandardDisplay(std, qt);
    if (isOk) roundCorrect += 1;

    els.feedback.hidden = false;
    els.feedback.classList.toggle("ok", isOk);
    els.feedback.classList.toggle("bad", !isOk);
    els.feedbackMsg.textContent = isOk
      ? `回答正确。正确答案：${disp}`
      : `回答错误。正确答案：${disp}`;
    const ex = String(row.explanation || "").trim();
    els.feedbackExplain.textContent =
      ex && ex !== "无" ? `解析：${ex}` : "";

    els.btnNext.disabled = false;
    renderStats();
  }

  function getQuestionById(qid) {
    return bank.find((r) => r.qid === qid);
  }

  function showQuestion() {
    answered = false;
    els.feedback.hidden = true;
    els.feedback.classList.remove("ok", "bad");
    els.btnNext.disabled = true;
    clearChoices();

    const total = roundIds.length;
    const cur = idx + 1;
    const qid = roundIds[idx];
    const q = getQuestionById(qid);
    if (!q) {
      showError("题目不存在");
      return Promise.resolve();
    }

    els.questionText.textContent = String(q.content);
    els.qStatus.textContent = q.status === "未做" ? "未做" : String(q.status);
    const qn = q.question_number != null ? q.question_number : "";
    els.quizProgress.textContent = qn
      ? `第 ${cur} / ${total} 题（全库第 ${qn} 题）`
      : `第 ${cur} / ${total} 题`;
    renderChoices(q);
    return Promise.resolve();
  }

  function finishRound() {
    const score = roundCorrect * 2;
    els.sumScore.textContent = String(score);
    els.sumCorrect.textContent = String(roundCorrect);
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = false;
    renderStats();
  }

  els.btnStart.addEventListener("click", () => {
    clearError();
    const num = parseInt(els.roundNum.value, 10) || 50;
    roundIds = getRoundQuestions(Math.max(1, Math.min(num, 200)));
    idx = 0;
    roundCorrect = 0;
    if (!roundIds.length) {
      showError("没有可抽取的题目（请检查题库与进度）。");
      return;
    }
    els.startPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.quizPanel.hidden = false;
    showQuestion();
  });

  els.btnNext.addEventListener("click", () => {
    idx += 1;
    if (idx >= roundIds.length) {
      finishRound();
      return;
    }
    showQuestion();
  });

  els.btnAbort.addEventListener("click", () => {
    els.quizPanel.hidden = true;
    els.startPanel.hidden = false;
    renderStats();
  });

  els.btnBack.addEventListener("click", () => {
    els.summaryPanel.hidden = true;
    els.startPanel.hidden = false;
    renderStats();
  });

  async function boot() {
    clearError();
    try {
      const r = await fetch("questions.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`无法加载题库 (${r.status})`);
      const data = await r.json();
      const base = data.questions;
      if (!Array.isArray(base) || base.length === 0) {
        throw new Error("题库为空或未运行 export_bank_for_pages.py 生成 questions.json");
      }
      bank = mergeBank(base, loadProgressMap());
      renderStats();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  boot();
})();
