(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    err: $("global-error"),
    notice: $("global-notice"),
    authPanel: $("auth-panel"),
    ledgerPanel: $("ledger-panel"),
    whoami: $("whoami"),
    whoamiName: $("whoami-name"),
    btnLogout: $("btn-logout"),
    btnLogin: $("btn-login"),
    username: $("auth-username"),
    password: $("auth-password"),
    body: $("ledger-body"),
    total: $("st-total"),
    pending: $("st-pending"),
  };

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

  async function fetchJSON(url, options) {
    const r = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options && options.headers) },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || data.detail || r.statusText || "请求失败");
    }
    return data;
  }

  function setLoggedOut() {
    els.authPanel.hidden = false;
    els.ledgerPanel.hidden = true;
    els.whoami.hidden = true;
    els.btnLogout.hidden = true;
  }

  function setLoggedIn(username) {
    els.authPanel.hidden = true;
    els.ledgerPanel.hidden = false;
    els.whoami.hidden = false;
    els.btnLogout.hidden = false;
    els.whoamiName.textContent = username;
    if (els.password) els.password.value = "";
  }

  function renderAccounts(data) {
    els.total.textContent = String(data.total || 0);
    els.pending.textContent = String(data.pending || 0);
    els.body.innerHTML = "";
    (data.accounts || []).forEach((acc) => {
      const tr = document.createElement("tr");
      const pwd = acc.password_missing ? "（历史账号，无法回显）" : acc.password || "";
      const statusClass =
        acc.status === "approved"
          ? "status-approved"
          : acc.status === "rejected"
            ? "status-rejected"
            : "status-pending";
      const cells = [
        acc.username,
        pwd,
        acc.role_label || acc.role,
        acc.status_label || acc.status,
        acc.created_at || "—",
        acc.reviewed_at || "—",
        acc.reviewed_by || "—",
      ];
      cells.forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = String(text);
        if (i === 1) td.className = "password-cell";
        if (i === 3) td.className = statusClass;
        tr.appendChild(td);
      });
      const td = document.createElement("td");
      td.className = "ledger-actions";
      tr.appendChild(td);
      if (acc.status === "pending" || acc.status === "rejected") {
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "btn primary btn-sm";
        ok.textContent = "通过";
        ok.addEventListener("click", () => review(acc.username, "approve"));
        td.appendChild(ok);
      }
      if (acc.status === "pending" || acc.status === "approved") {
        if (acc.role !== "admin") {
          const no = document.createElement("button");
          no.type = "button";
          no.className = "btn btn-sm";
          no.textContent = "拒绝";
          no.addEventListener("click", () => review(acc.username, "reject"));
          td.appendChild(no);
        }
      }
      els.body.appendChild(tr);
    });
  }

  async function loadAccounts() {
    const data = await fetchJSON("/api/admin/accounts");
    renderAccounts(data);
  }

  async function review(username, action) {
    clearMsg();
    try {
      await fetchJSON("/api/admin/accounts/review", {
        method: "POST",
        body: JSON.stringify({ username, action }),
      });
      showNotice(action === "approve" ? `已通过：${username}` : `已拒绝：${username}`);
      await loadAccounts();
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  els.btnLogin.addEventListener("click", async () => {
    clearMsg();
    const username = (els.username.value || "").trim();
    const password = (els.password.value || "").trim();
    if (!username || !password) {
      showError("请输入用户名和密码");
      return;
    }
    try {
      const res = await fetchJSON("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (!res.is_admin) {
        await fetchJSON("/api/auth/logout", { method: "POST", body: "{}" });
        showError("该账号不是管理员，无法查看台账");
        return;
      }
      setLoggedIn(res.username || username);
      await loadAccounts();
    } catch (e) {
      showError(e.message || String(e));
    }
  });

  els.btnLogout.addEventListener("click", async () => {
    try {
      await fetchJSON("/api/auth/logout", { method: "POST", body: "{}" });
    } catch (_) {
      /* ignore */
    }
    setLoggedOut();
  });

  async function boot() {
    setLoggedOut();
    try {
      const me = await fetchJSON("/api/auth/me");
      if (me.logged_in && me.is_admin) {
        setLoggedIn(me.username || "");
        await loadAccounts();
      } else if (me.logged_in && !me.is_admin) {
        showError("当前登录账号不是管理员，请使用管理员账号登录。");
      }
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  boot();
})();
