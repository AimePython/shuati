(function () {
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
    notice: $("global-notice"),
    authPanel: $("auth-panel"),
    authUsername: $("auth-username"),
    authPassword: $("auth-password"),
    btnLogin: $("btn-login"),
    btnRegister: $("btn-register"),
    whoami: $("whoami"),
    whoamiName: $("whoami-name"),
    btnAdmin: $("btn-admin"),
    btnLogout: $("btn-logout"),
    bankPanel: $("bank-panel"),
    bankName: $("bank-name"),
    bankList: $("bank-list"),
    btnStart: $("btn-start"),
    btnStartWrong: $("btn-start-wrong"),
    btnStartPaper: $("btn-start-paper"),
    paperPicker: $("paper-picker"),
    paperSelect: $("paper-select"),
    paperHint: $("paper-hint"),
    btnPaperGo: $("btn-paper-go"),
    modeTag: $("mode-tag"),
    wrongBookCount: $("wrong-book-count"),
    btnClearWrongBook: $("btn-clear-wrong-book"),
    startPanel: $("start-panel"),
    statsPanel: $("stats-panel"),
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

  let loggedIn = false;
  let roundIds = [];
  let idx = 0;
  let roundCorrect = 0;
  let answered = false;
  let multiPicked = null;
  let currentQtype = "single";
  let currentRoundMode = "normal";
  let currentPaperName = "";
  let currentQuestion = null;
  let questionLoadSeq = 0;

  function refreshRoundModeUI() {
    const isWrong = currentRoundMode === "wrong";
    const isPaper = currentRoundMode === "paper";
    if (els.modeTag) {
      els.modeTag.textContent = isWrong ? "错题重刷" : isPaper ? "按样卷顺序" : "普通刷题";
    }
    els.btnStart.classList.toggle("primary", !isWrong && !isPaper);
    els.btnStartWrong.classList.toggle("primary", isWrong);
    if (els.btnStartPaper) els.btnStartPaper.classList.toggle("primary", isPaper);
    if (els.paperPicker) els.paperPicker.hidden = !isPaper;
  }

  async function fetchJSON(url, options) {
    const r = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options && options.headers) },
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) {
      setLoggedOutState();
      throw new Error(data.error || "请先登录");
    }
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || data.detail || r.statusText || "请求失败");
    }
    return data;
  }

  function setLoggedOutState() {
    loggedIn = false;
    els.authPanel.hidden = false;
    els.statsPanel.hidden = true;
    els.startPanel.hidden = true;
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.whoami.hidden = true;
    els.btnLogout.hidden = true;
    if (els.btnAdmin) els.btnAdmin.hidden = true;
    if (els.bankPanel) els.bankPanel.hidden = true;
  }

  function setLoggedInState(username, isAdmin) {
    loggedIn = true;
    els.authPanel.hidden = true;
    els.statsPanel.hidden = false;
    els.startPanel.hidden = false;
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.whoami.hidden = false;
    els.btnLogout.hidden = false;
    els.whoamiName.textContent = username;
    if (els.btnAdmin) els.btnAdmin.hidden = !isAdmin;
    if (els.bankPanel) els.bankPanel.hidden = false;
    refreshRoundModeUI();
  }

  function showError(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
    if (els.notice) els.notice.hidden = true;
  }

  function showNotice(msg) {
    if (!els.notice) return;
    els.notice.textContent = msg;
    els.notice.hidden = false;
    els.err.hidden = true;
  }

  function clearError() {
    els.err.hidden = true;
    els.err.textContent = "";
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.textContent = "";
    }
  }

  function applyStats(s) {
    els.stats.total.textContent = s.total;
    els.stats.done.textContent = s.done;
    els.stats.undone.textContent = s.undone;
    els.stats.correct.textContent = s.correct;
    els.stats.wrong.textContent = s.wrong;
    els.stats.rate.textContent = `${Number(s.accuracy_percent || 0).toFixed(1)}%`;
    if (els.wrongBookCount && s.wrong_book != null) {
      els.wrongBookCount.textContent = `${s.wrong_book || 0} 题`;
    }
    if (els.bankName && s.bank_name) {
      els.bankName.textContent = s.bank_name;
    }
  }

  function bumpStatsOptimistic(prevStatus, isCorrect) {
    const total = parseInt(els.stats.total.textContent, 10);
    let done = parseInt(els.stats.done.textContent, 10);
    let correct = parseInt(els.stats.correct.textContent, 10);
    let wrong = parseInt(els.stats.wrong.textContent, 10);
    if (![total, done, correct, wrong].every(Number.isFinite)) return;
    const prev = String(prevStatus || "未做");
    const wasCorrect = prev === "正确";
    const wasWrong = prev === "错误";
    const wasDone = wasCorrect || wasWrong;
    if (!wasDone) {
      done += 1;
      if (isCorrect) correct += 1;
      else wrong += 1;
    } else if (wasCorrect && !isCorrect) {
      correct -= 1;
      wrong += 1;
    } else if (wasWrong && isCorrect) {
      correct += 1;
      wrong -= 1;
    }
    applyStats({
      total,
      done,
      undone: Math.max(0, total - done),
      correct,
      wrong,
      accuracy_percent: done ? Math.round((correct / done) * 1000) / 10 : 0,
    });
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
    const m = u.match(/[A-E]/);
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

  function paintFeedback(isOk, disp, explanation) {
    els.feedback.hidden = false;
    els.feedback.classList.toggle("ok", isOk);
    els.feedback.classList.toggle("bad", !isOk);
    els.feedbackMsg.textContent = isOk
      ? `回答正确。正确答案：${disp}`
      : `回答错误。正确答案：${disp}`;
    const ex = (explanation || "").trim();
    els.feedbackExplain.textContent = ex && ex !== "无" ? `解析：${ex}` : "";
    els.btnNext.disabled = false;
  }

  function clearFeedback() {
    els.feedback.hidden = true;
    els.feedback.classList.remove("ok", "bad");
    els.feedbackMsg.textContent = "";
    els.feedbackExplain.textContent = "";
  }

  function resetQuestionSurface(loadingText) {
    answered = false;
    clearFeedback();
    els.btnNext.disabled = true;
    clearChoices();
    els.qStatus.textContent = "";
    els.questionText.textContent = loadingText || "";
    currentQuestion = null;
  }

  function markPickedChoices(answerStr) {
    const picked = new Set(String(answerStr).toUpperCase().split(""));
    els.choices.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
      if (picked.has(String(b.dataset.value || "").toUpperCase())) {
        b.classList.add("picked");
      }
    });
  }

  function optionLetters(q) {
    if (Array.isArray(q.option_letters) && q.option_letters.length) {
      return q.option_letters.map(String);
    }
    if (q.question_type === "multi") return ["A", "B", "C", "D", "E"];
    if (q.question_type === "judge") return ["A", "B"];
    return ["A", "B", "C", "D"];
  }

  async function loadBanks() {
    if (!els.bankList) return;
    const data = await fetchJSON("/api/banks");
    if (els.bankName) els.bankName.textContent = data.bank_name || "—";
    els.bankList.innerHTML = "";
    (data.banks || []).forEach((bank) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn bank-btn" + (bank.current ? " primary" : "");
      b.textContent = bank.short_name || bank.name;
      b.dataset.bankId = bank.id;
      b.addEventListener("click", () => selectBank(bank.id));
      els.bankList.appendChild(b);
    });
  }

  async function selectBank(bankId) {
    clearError();
    try {
      const data = await fetchJSON("/api/bank", {
        method: "POST",
        body: JSON.stringify({ bank_id: bankId }),
      });
      applyStats(data);
      await loadBanks();
      await loadPapers();
      els.quizPanel.hidden = true;
      els.summaryPanel.hidden = true;
      els.startPanel.hidden = false;
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  async function loadStats() {
    if (!loggedIn) return;
    clearError();
    const s = await fetchJSON("/api/stats");
    applyStats(s);
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

  function renderChoices(q) {
    currentQtype = q.question_type || "single";
    els.qTypeTag.textContent = q.type_label ? `${q.type_label}题` : "—";
    els.qHint.textContent = q.hint || "";

    if (currentQtype === "single") {
      const letters = optionLetters(q);
      if (letters.length >= 5) els.choices.classList.add("choices--multi");
      letters.forEach((ch) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.dataset.value = ch;
        b.textContent = ch;
        b.addEventListener("click", () => {
          if (!answered) submitAnswer(ch);
        });
        els.choices.appendChild(b);
      });
      return;
    }

    if (currentQtype === "multi") {
      els.choices.classList.add("choices--multi");
      els.btnConfirmMulti.hidden = false;
      multiPicked = new Set();
      optionLetters(q).forEach((ch) => {
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
      });
      els.btnConfirmMulti.onclick = () => {
        if (answered) return;
        const s = Array.from(multiPicked).sort().join("");
        submitAnswer(s);
      };
      return;
    }

    if (currentQtype === "judge") {
      els.choices.classList.add("choices--judge");
      [
        { v: "A", label: "A · 对" },
        { v: "B", label: "B · 错" },
      ].forEach(({ v, label }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice judge";
        b.dataset.value = v;
        b.textContent = label;
        b.addEventListener("click", () => {
          if (!answered) submitAnswer(v);
        });
        els.choices.appendChild(b);
      });
    }
  }

  function submitAnswer(answerStr) {
    if (answered) return;
    answered = true;
    markPickedChoices(answerStr);
    els.btnConfirmMulti.hidden = true;

    const qid = roundIds[idx];
    const submittedIdx = idx;
    const q = currentQuestion;
    const std = q && q.standard_answer != null ? String(q.standard_answer) : "";
    const canGradeLocally = Boolean(q && std);
    if (canGradeLocally) {
      const qt = q.question_type || currentQtype;
      const isOk = checkAnswer(answerStr, std, qt);
      const disp = q.correct_answer_display || formatStandardDisplay(std, qt);
      if (isOk) roundCorrect += 1;
      paintFeedback(isOk, disp, q.explanation);
      bumpStatsOptimistic(q.status, isOk);
    }

    fetchJSON("/api/answer", {
      method: "POST",
      body: JSON.stringify({ qid, answer: answerStr }),
    })
      .then((res) => {
        const stillOnSame =
          idx === submittedIdx &&
          roundIds[idx] === qid &&
          currentQuestion &&
          Number(currentQuestion.qid) === Number(qid);
        if (!canGradeLocally && stillOnSame) {
          if (res.correct) roundCorrect += 1;
          const disp = res.correct_answer_display || res.correct_answer;
          paintFeedback(res.correct, disp, res.explanation);
        }
        if (res.stats) applyStats(res.stats);
      })
      .catch((e) => {
        const stillOnSame =
          idx === submittedIdx &&
          roundIds[idx] === qid &&
          currentQuestion &&
          Number(currentQuestion.qid) === Number(qid);
        if (!canGradeLocally && stillOnSame) {
          answered = false;
          els.choices.querySelectorAll(".choice").forEach((b) => {
            b.disabled = false;
            b.classList.remove("picked");
          });
          if (currentQtype === "multi") els.btnConfirmMulti.hidden = false;
        }
        showError(e.message || String(e));
      });
  }

  function showQuestion() {
    const seq = ++questionLoadSeq;
    const total = roundIds.length;
    const cur = idx + 1;
    const qid = roundIds[idx];
    resetQuestionSurface("加载中…");
    els.quizProgress.textContent =
      currentRoundMode === "paper"
        ? `${currentPaperName ? `${currentPaperName} · ` : ""}第 ${cur} / ${total} 题`
        : `第 ${cur} / ${total} 题`;

    return fetchJSON(`/api/question/${qid}`).then((q) => {
      if (seq !== questionLoadSeq) return;
      currentQuestion = q;
      els.questionText.textContent = q.content;
      els.qStatus.textContent = q.status === "未做" ? "未做" : q.status;
      const qn = q.question_number != null ? q.question_number : "";
      els.quizProgress.textContent = qn
        ? `第 ${cur} / ${total} 题（全库第 ${qn} 题）`
        : `第 ${cur} / ${total} 题`;
      if (currentRoundMode === "paper") {
        const name = currentPaperName ? `${currentPaperName} · ` : "";
        els.quizProgress.textContent = `${name}第 ${cur} / ${total} 题`;
      }
      renderChoices(q);
    });
  }

  function finishRound() {
    questionLoadSeq += 1;
    const score = roundCorrect * 2;
    els.sumScore.textContent = String(score);
    els.sumCorrect.textContent = String(roundCorrect);
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = false;
    loadStats().catch(() => {});
  }

  async function loadPapers() {
    if (!els.paperSelect) return;
    try {
      const data = await fetchJSON("/api/papers");
      const papers = data.papers || [];
      const prev = els.paperSelect.value;
      els.paperSelect.innerHTML = "";
      papers.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name}（${p.count} 题）`;
        els.paperSelect.appendChild(opt);
      });
      if (prev && papers.some((p) => p.id === prev)) {
        els.paperSelect.value = prev;
      }
      if (els.paperHint) {
        if (!papers.length) {
          els.paperHint.textContent = "当前题库没有可顺序练习的套卷。";
        } else if (data.bank_id === "zhongji") {
          els.paperHint.textContent = "中级工题库按全库题号从第 1 题做到最后一题。";
        } else {
          els.paperHint.textContent = `共 ${papers.length} 套，按原卷顺序从头做到尾。`;
        }
      }
      if (els.btnPaperGo) els.btnPaperGo.disabled = !papers.length;
    } catch (e) {
      if (els.paperHint) els.paperHint.textContent = e.message || String(e);
      if (els.btnPaperGo) els.btnPaperGo.disabled = true;
    }
  }

  async function startRound(mode, paperId) {
    clearError();
    try {
      const body = { mode };
      if (mode === "paper") {
        body.paper_id = paperId || (els.paperSelect && els.paperSelect.value) || "";
      }
      const data = await fetchJSON("/api/round/start", {
        method: "POST",
        body: JSON.stringify(body),
      });
      roundIds = data.question_ids;
      idx = 0;
      roundCorrect = 0;
      currentRoundMode = data.mode || mode || "normal";
      currentPaperName = data.paper_name || "";
      refreshRoundModeUI();
      if (!roundIds.length) {
        if (currentRoundMode === "wrong") {
          showError("当前错题集为空，暂无可重刷题目。");
        } else if (currentRoundMode === "paper") {
          showError("该套卷没有题目。");
        } else {
          showError("没有可抽取的题目（请检查题库与进度）。");
        }
        return;
      }
      els.startPanel.hidden = true;
      els.summaryPanel.hidden = true;
      els.quizPanel.hidden = false;
      await showQuestion();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  els.btnStart.addEventListener("click", () => {
    currentRoundMode = "normal";
    refreshRoundModeUI();
    startRound("normal");
  });

  els.btnStartWrong.addEventListener("click", () => {
    currentRoundMode = "wrong";
    refreshRoundModeUI();
    startRound("wrong");
  });

  if (els.btnStartPaper) {
    els.btnStartPaper.addEventListener("click", () => {
      currentRoundMode = "paper";
      refreshRoundModeUI();
      loadPapers();
    });
  }
  if (els.btnPaperGo) {
    els.btnPaperGo.addEventListener("click", () => {
      currentRoundMode = "paper";
      refreshRoundModeUI();
      startRound("paper");
    });
  }

  els.btnClearWrongBook.addEventListener("click", async () => {
    clearError();
    const ok = window.confirm("确认清空错题本？此操作不会改动当前做题进度。");
    if (!ok) return;
    try {
      await fetchJSON("/api/wrong-book/clear", { method: "POST", body: "{}" });
      if (currentRoundMode === "wrong") {
        currentRoundMode = "normal";
        refreshRoundModeUI();
      }
      await loadStats();
    } catch (e) {
      showError(e.message || String(e));
    }
  });

  els.btnNext.addEventListener("click", () => {
    idx += 1;
    if (idx >= roundIds.length) {
      finishRound();
      return;
    }
    showQuestion().catch((e) => showError(e.message || String(e)));
  });

  els.btnAbort.addEventListener("click", () => {
    questionLoadSeq += 1;
    els.quizPanel.hidden = true;
    els.startPanel.hidden = false;
    loadStats().catch(() => {});
  });

  els.btnBack.addEventListener("click", () => {
    els.summaryPanel.hidden = true;
    els.startPanel.hidden = false;
    loadStats().catch(() => {});
  });

  async function auth(action) {
    clearError();
    const username = (els.authUsername.value || "").trim();
    const password = (els.authPassword.value || "").trim();
    if (!username) {
      showError("请输入用户名");
      return;
    }
    if (!password) {
      showError("请输入密码");
      return;
    }
    try {
      const res = await fetchJSON(`/api/auth/${action}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (res.pending) {
        showNotice(res.message || "已提交注册，请等待管理员审批通过后再登录。");
        els.authPassword.value = "";
        return;
      }
      setLoggedInState(res.username || username, Boolean(res.is_admin));
      els.authPassword.value = "";
      await loadBanks();
      await loadPapers();
      await loadStats();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  els.btnLogin.addEventListener("click", () => auth("login"));
  els.btnRegister.addEventListener("click", () => auth("register"));
  els.btnLogout.addEventListener("click", async () => {
    clearError();
    try {
      await fetchJSON("/api/auth/logout", { method: "POST", body: "{}" });
    } catch (_) {
      // 即使后端响应异常也允许本地回到未登录态
    }
    setLoggedOutState();
  });

  async function boot() {
    setLoggedOutState();
    refreshRoundModeUI();
    try {
      const me = await fetchJSON("/api/auth/me");
      if (me.logged_in) {
        setLoggedInState(me.username || "", Boolean(me.is_admin));
        await loadBanks();
        await loadPapers();
        await loadStats();
      }
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  boot();
})();
