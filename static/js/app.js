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
    authPanel: $("auth-panel"),
    authUsername: $("auth-username"),
    authPassword: $("auth-password"),
    btnLogin: $("btn-login"),
    btnRegister: $("btn-register"),
    whoami: $("whoami"),
    whoamiName: $("whoami-name"),
    btnLogout: $("btn-logout"),
    roundNum: $("round-num"),
    btnStart: $("btn-start"),
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
  }

  function setLoggedInState(username) {
    loggedIn = true;
    els.authPanel.hidden = true;
    els.statsPanel.hidden = false;
    els.startPanel.hidden = false;
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.whoami.hidden = false;
    els.btnLogout.hidden = false;
    els.whoamiName.textContent = username;
  }

  function showError(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
  }

  function clearError() {
    els.err.hidden = true;
    els.err.textContent = "";
  }

  async function loadStats() {
    if (!loggedIn) return;
    clearError();
    const s = await fetchJSON("/api/stats");
    els.stats.total.textContent = s.total;
    els.stats.done.textContent = s.done;
    els.stats.undone.textContent = s.undone;
    els.stats.correct.textContent = s.correct;
    els.stats.wrong.textContent = s.wrong;
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

  function renderChoices(q) {
    currentQtype = q.question_type || "single";
    els.qTypeTag.textContent = q.type_label ? `${q.type_label}题` : "—";
    els.qHint.textContent = q.hint || "";

    if (currentQtype === "single") {
      "ABCD".split("").forEach((ch) => {
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
      "ABCDE".split("").forEach((ch) => {
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

  async function submitAnswer(answerStr) {
    if (answered) return;
    answered = true;
    els.choices.querySelectorAll(".choice").forEach((b) => {
      b.disabled = true;
    });
    els.btnConfirmMulti.hidden = true;

    const qid = roundIds[idx];
    const res = await fetchJSON("/api/answer", {
      method: "POST",
      body: JSON.stringify({ qid, answer: answerStr }),
    });

    if (res.correct) roundCorrect += 1;

    els.feedback.hidden = false;
    els.feedback.classList.toggle("ok", res.correct);
    els.feedback.classList.toggle("bad", !res.correct);
    const disp = res.correct_answer_display || res.correct_answer;
    els.feedbackMsg.textContent = res.correct
      ? `回答正确。正确答案：${disp}`
      : `回答错误。正确答案：${disp}`;
    const ex = (res.explanation || "").trim();
    els.feedbackExplain.textContent = ex && ex !== "无" ? `解析：${ex}` : "";

    els.btnNext.disabled = false;
    loadStats().catch(() => {});
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
    return fetchJSON(`/api/question/${qid}`).then((q) => {
      els.questionText.textContent = q.content;
      els.qStatus.textContent = q.status === "未做" ? "未做" : q.status;
      const qn = q.question_number != null ? q.question_number : "";
      els.quizProgress.textContent = qn
        ? `第 ${cur} / ${total} 题（全库第 ${qn} 题）`
        : `第 ${cur} / ${total} 题`;
      renderChoices(q);
    });
  }

  function finishRound() {
    const score = roundCorrect * 2;
    els.sumScore.textContent = String(score);
    els.sumCorrect.textContent = String(roundCorrect);
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = false;
    loadStats().catch(() => {});
  }

  els.btnStart.addEventListener("click", async () => {
    clearError();
    const num = parseInt(els.roundNum.value, 10) || 50;
    try {
      const data = await fetchJSON("/api/round/start", {
        method: "POST",
        body: JSON.stringify({ num }),
      });
      roundIds = data.question_ids;
      idx = 0;
      roundCorrect = 0;
      if (!roundIds.length) {
        showError("没有可抽取的题目（请检查题库与进度）。");
        return;
      }
      els.startPanel.hidden = true;
      els.summaryPanel.hidden = true;
      els.quizPanel.hidden = false;
      await showQuestion();
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
      setLoggedInState(res.username || username);
      els.authPassword.value = "";
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
    try {
      const me = await fetchJSON("/api/auth/me");
      if (me.logged_in) {
        setLoggedInState(me.username || "");
        await loadStats();
      }
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  boot();
})();
