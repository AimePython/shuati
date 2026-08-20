(function () {
  const USERS_KEY = "dl_trader_pages_users_v3";
  const SESSION_KEY = "dl_trader_pages_session_v3";
  const ADMIN_NAME = "admin";
  const STATUS_LABEL = { pending: "待审批", approved: "已通过", rejected: "已拒绝" };
  const ROLE_LABEL = { admin: "管理员", user: "学员" };

  const $ = (id) => document.getElementById(id);
  const els = {
    err: $("global-error"),
    notice: $("global-notice"),
    initPanel: $("init-panel"),
    authPanel: $("auth-panel"),
    ledgerPanel: $("ledger-panel"),
    whoami: $("whoami"),
    whoamiName: $("whoami-name"),
    btnLogout: $("btn-logout"),
    btnLogin: $("btn-login"),
    btnInit: $("btn-init"),
    btnDownload: $("btn-download"),
    username: $("auth-username"),
    password: $("auth-password"),
    initPassword: $("init-password"),
    body: $("ledger-body"),
    total: $("st-total"),
    pending: $("st-pending"),
  };

  function nowText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

  function clearMsg() {
    els.err.hidden = true;
    els.err.textContent = "";
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.textContent = "";
    }
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
      return localStorage.getItem(SESSION_KEY) || "";
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

  function publicAccount(username, rec) {
    const status = rec.status || "approved";
    const role = rec.role || (username === ADMIN_NAME ? "admin" : "user");
    return {
      username,
      password: rec.password || "",
      password_missing: !String(rec.password || "").trim(),
      role,
      role_label: ROLE_LABEL[role] || "学员",
      status,
      status_label: STATUS_LABEL[status] || status,
      created_at: rec.created_at || "",
      reviewed_at: rec.reviewed_at || "",
      reviewed_by: rec.reviewed_by || "",
    };
  }

  function setMode(mode, username) {
    els.initPanel.hidden = mode !== "init";
    els.authPanel.hidden = mode !== "login";
    els.ledgerPanel.hidden = mode !== "ledger";
    els.whoami.hidden = mode !== "ledger";
    els.btnLogout.hidden = mode !== "ledger";
    if (mode === "ledger") els.whoamiName.textContent = username || "";
  }

  function renderAccounts(adminName) {
    const users = loadUsers();
    const accounts = Object.keys(users)
      .sort()
      .map((name) => publicAccount(name, users[name]));
    const pending = accounts.filter((a) => a.status === "pending").length;
    els.total.textContent = String(accounts.length);
    els.pending.textContent = String(pending);
    els.body.innerHTML = "";
    accounts.forEach((acc) => {
      const tr = document.createElement("tr");
      const pwd = acc.password_missing ? "（历史账号，无法回显）" : acc.password || "";
      const statusClass =
        acc.status === "approved"
          ? "status-approved"
          : acc.status === "rejected"
            ? "status-rejected"
            : "status-pending";
      [acc.username, pwd, acc.role_label, acc.status_label, acc.created_at || "—", acc.reviewed_at || "—", acc.reviewed_by || "—"].forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = String(text);
        if (i === 1) td.className = "password-cell";
        if (i === 3) td.className = statusClass;
        tr.appendChild(td);
      });
      const td = document.createElement("td");
      td.className = "ledger-actions";
      if (acc.status === "pending" || acc.status === "rejected") {
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn primary btn-sm";
        ok.textContent = "通过";
        ok.addEventListener("click", () => review(adminName, acc.username, "approve"));
        td.appendChild(ok);
      }
      if ((acc.status === "pending" || acc.status === "approved") && acc.role !== "admin") {
        const no = document.createElement("button");
        no.type = "button";
        no.className = "btn btn-sm";
        no.textContent = "拒绝";
        no.addEventListener("click", () => review(adminName, acc.username, "reject"));
        td.appendChild(no);
      }
      tr.appendChild(td);
      els.body.appendChild(tr);
    });
  }

  function review(adminName, username, action) {
    clearMsg();
    const users = loadUsers();
    const rec = users[username];
    if (!rec) {
      showError("账号不存在");
      return;
    }
    if (rec.role === "admin" && action === "reject") {
      showError("不能拒绝管理员账号");
      return;
    }
    rec.status = action === "approve" ? "approved" : "rejected";
    rec.reviewed_at = nowText();
    rec.reviewed_by = adminName;
    saveUsers(users);
    showNotice(action === "approve" ? `已通过：${username}` : `已拒绝：${username}`);
    renderAccounts(adminName);
  }

  function downloadCsv() {
    const users = loadUsers();
    const header = ["用户名", "密码", "角色", "状态", "注册时间", "审批时间", "审批人"];
    const lines = [header.join(",")];
    Object.keys(users)
      .sort()
      .forEach((name) => {
        const acc = publicAccount(name, users[name]);
        const pwd = acc.password_missing ? "（历史账号，无法回显）" : acc.password;
        const cells = [acc.username, pwd, acc.role_label, acc.status_label, acc.created_at, acc.reviewed_at, acc.reviewed_by].map(
          (v) => `"${String(v || "").replace(/"/g, '""')}"`,
        );
        lines.push(cells.join(","));
      });
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "account_ledger.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  els.btnInit.addEventListener("click", async () => {
    clearMsg();
    const password = (els.initPassword.value || "").trim();
    if (password.length < 6) {
      showError("密码至少 6 位");
      return;
    }
    const users = loadUsers();
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    users[ADMIN_NAME] = {
      salt,
      hash,
      password,
      role: "admin",
      status: "approved",
      created_at: nowText(),
      reviewed_at: nowText(),
      reviewed_by: "bootstrap",
    };
    saveUsers(users);
    setSessionUser(ADMIN_NAME);
    setMode("ledger", ADMIN_NAME);
    renderAccounts(ADMIN_NAME);
    showNotice("管理员已创建，可以开始审批。");
  });

  els.btnLogin.addEventListener("click", async () => {
    clearMsg();
    const username = (els.username.value || "").trim();
    const password = (els.password.value || "").trim();
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
    if (rec.role !== "admin" || rec.status !== "approved") {
      showError("该账号不是管理员，无法查看台账");
      return;
    }
    setSessionUser(username);
    setMode("ledger", username);
    renderAccounts(username);
  });

  els.btnLogout.addEventListener("click", () => {
    setSessionUser("");
    const users = loadUsers();
    setMode(users[ADMIN_NAME] ? "login" : "init");
  });

  els.btnDownload.addEventListener("click", downloadCsv);

  function boot() {
    const users = loadUsers();
    const hasAdmin = Object.keys(users).some((name) => (users[name].role || name) === "admin" || name === ADMIN_NAME);
    const sess = getSessionUser();
    const rec = sess ? users[sess] : null;
    if (rec && rec.role === "admin" && rec.status !== "rejected") {
      rec.status = "approved";
      rec.role = "admin";
      saveUsers(users);
      setMode("ledger", sess);
      renderAccounts(sess);
      return;
    }
    setMode(hasAdmin ? "login" : "init");
  }

  boot();
})();
