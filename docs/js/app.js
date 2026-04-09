(function () {
  const USERS_KEY = "dl_trader_pages_users_v3";
  const SESSION_KEY = "dl_trader_pages_session_v3";

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
    btnStart: $("btn-start"),
    btnStartWrong: $("btn-start-wrong"),
    modeTag: $("mode-tag"),
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

  /** @type {Array<Record<string, unknown>>} */
  let baseQuestions = [];
  /** @type {Array<Record<string, unknown>>} */
  let bank = [];
  let currentUser = "";
  let questionsReady = false;

  let roundIds = [];
  let idx = 0;
  let roundCorrect = 0;
  let answered = false;
  /** @type {Set<string> | null} */
  let multiPicked = null;
  let currentQtype = "single";
  let currentRoundMode = "normal";

  function refreshRoundModeUI() {
    const isWrong = currentRoundMode === "wrong";
    if (els.modeTag) {
      els.modeTag.textContent = isWrong ? "错题重刷" : "普通刷题";
    }
    els.btnStart.classList.toggle("primary", !isWrong);
    els.btnStartWrong.classList.toggle("primary", isWrong);
  }

  function progressStorageKey(username) {
    return `dl_trader_quiz_pages_u_${username}`;
  }

  function validUsername(username) {
    return /^[A-Za-z0-9_]{3,32}$/.test(username);
  }

  function loadUsers() {
    try {
      const raw = localStorage.getItem(USERS_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function getSessionUser() {
    try {
      const u = localStorage.getItem(SESSION_KEY);
      return u ? String(u) : "";
    } catch {
      return "";
    }
  }

  function setSessionUser(username) {
    if (username) localStorage.setItem(SESSION_KEY, username);
    else localStorage.removeItem(SESSION_KEY);
  }

  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  }

  async function hashPassword(password, salt) {
    return sha256Hex(`${salt}:${password}`);
  }

  function loadProgressMap() {
    if (!currentUser) return {};
    try {
      const raw = localStorage.getItem(progressStorageKey(currentUser));
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o.progress === "object" && o.progress ? o.progress : {};
    } catch {
      return {};
    }
  }

  function saveProgressMap(progress) {
    if (!currentUser) return;
    localStorage.setItem(
      progressStorageKey(currentUser),
      JSON.stringify({ progress, updated: Date.now() }),
    );
  }

  function mergeBank(base, progress) {
    return base.map((q) => ({
      ...q,
      status:
        progress[q.qid] !== undefined && progress[q.qid] !== null
          ? String(progress[q.qid])
          : "未做",
    }));
  }

  function rebuildBank() {
    if (!currentUser || !baseQuestions.length) {
      bank = [];
      return;
    }
    bank = mergeBank(baseQuestions, loadProgressMap());
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

  function pickByType(qtype, target) {
    const pool = bank.filter((r) => r.question_type === qtype);
    const wrong = pool.filter((r) => r.status === "错误").map((r) => r.qid);
    const undone = pool.filter((r) => r.status === "未做").map((r) => r.qid);
    const correct = pool.filter((r) => r.status === "正确").map((r) => r.qid);
    const selected = wrong.slice();
    let need = target - selected.length;
    if (need > 0 && undone.length) {
      selected.push(...sampleWithoutReplacement(undone, Math.min(need, undone.length)));
    }
    need = target - selected.length;
    if (need > 0 && correct.length) {
      selected.push(...sampleWithoutReplacement(correct, Math.min(need, correct.length)));
    }
    shuffleInPlace(selected);
    return selected.slice(0, target);
  }

  function getRoundQuestions() {
    const selected = [];
    selected.push(...pickByType("single", 100));
    selected.push(...pickByType("multi", 30));
    selected.push(...pickByType("judge", 40));
    shuffleInPlace(selected);
    return selected;
  }

  function getWrongQuestions() {
    const wrong = bank.filter((r) => r.status === "错误").map((r) => r.qid);
    shuffleInPlace(wrong);
    return wrong;
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

  function setLoggedOutUI() {
    currentUser = "";
    els.authPanel.hidden = false;
    els.whoami.hidden = true;
    els.btnLogout.hidden = true;
    els.statsPanel.hidden = true;
    els.startPanel.hidden = true;
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = true;
    currentRoundMode = "normal";
    refreshRoundModeUI();
  }

  function setLoggedInUI(username) {
    currentUser = username;
    els.authPanel.hidden = true;
    els.whoami.hidden = false;
    els.btnLogout.hidden = false;
    els.whoamiName.textContent = username;
    els.statsPanel.hidden = false;
    els.startPanel.hidden = false;
    els.quizPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.authPassword.value = "";
    refreshRoundModeUI();
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

  function startRound(mode) {
    if (!currentUser) {
      showError("请先登录");
      return;
    }
    clearError();
    currentRoundMode = mode === "wrong" ? "wrong" : "normal";
    refreshRoundModeUI();
    roundIds = mode === "wrong" ? getWrongQuestions() : getRoundQuestions();
    idx = 0;
    roundCorrect = 0;
    if (!roundIds.length) {
      if (mode === "wrong") {
        showError("当前错题集为空，暂无可重刷题目。");
      } else {
        showError("没有可抽取的题目（请检查题库与进度）。");
      }
      return;
    }
    els.startPanel.hidden = true;
    els.summaryPanel.hidden = true;
    els.quizPanel.hidden = false;
    showQuestion();
  }

  els.btnStart.addEventListener("click", () => {
    startRound("normal");
  });

  els.btnStartWrong.addEventListener("click", () => {
    startRound("wrong");
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

  async function tryRegister() {
    clearError();
    const username = (els.authUsername.value || "").trim();
    const password = (els.authPassword.value || "").trim();
    if (!validUsername(username)) {
      showError("用户名格式：3-32 位，仅字母/数字/下划线");
      return;
    }
    if (password.length < 6) {
      showError("密码至少 6 位");
      return;
    }
    const users = loadUsers();
    if (users[username]) {
      showError("用户名已存在");
      return;
    }
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    users[username] = { salt, hash };
    saveUsers(users);
    setSessionUser(username);
    setLoggedInUI(username);
    rebuildBank();
    renderStats();
  }

  async function tryLogin() {
    clearError();
    const username = (els.authUsername.value || "").trim();
    const password = (els.authPassword.value || "").trim();
    const users = loadUsers();
    const rec = users[username];
    if (!rec || !rec.salt || !rec.hash) {
      showError("用户名或密码错误");
      return;
    }
    const h = await hashPassword(password, rec.salt);
    if (h !== rec.hash) {
      showError("用户名或密码错误");
      return;
    }
    setSessionUser(username);
    setLoggedInUI(username);
    rebuildBank();
    renderStats();
  }

  els.btnLogin.addEventListener("click", () => {
    tryLogin().catch((e) => showError(e.message || String(e)));
  });
  els.btnRegister.addEventListener("click", () => {
    tryRegister().catch((e) => showError(e.message || String(e)));
  });
  els.btnLogout.addEventListener("click", () => {
    clearError();
    setSessionUser("");
    setLoggedOutUI();
    bank = [];
  });

  async function boot() {
    clearError();
    setLoggedOutUI();
    try {
      const r = await fetch("questions.json", { cache: "no-store" });
      if (!r.ok) throw new Error(`无法加载题库 (${r.status})`);
      const data = await r.json();
      const base = data.questions;
      if (!Array.isArray(base) || base.length === 0) {
        throw new Error(
          "题库为空或未运行 export_bank_for_pages.py 生成 questions.json",
        );
      }
      baseQuestions = base;
      questionsReady = true;

      const sess = getSessionUser();
      const users = loadUsers();
      if (sess && users[sess]) {
        setLoggedInUI(sess);
        rebuildBank();
        renderStats();
      }
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  boot();
})();
