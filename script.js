/* =====================================================================
   MOMENTUM — script.js
   All app logic. No backend, no frameworks — plain JS + localStorage.

   STORAGE SCHEMA
   ---------------------------------------------------------------------
   localStorage["momentum_tasks"]  -> JSON array of:
       { id, title, createdAt (ISO string), completed (bool), completedAt }

   localStorage["momentum_days"]   -> JSON object keyed by "YYYY-MM-DD":
       { added: number, completed: number }
     This is a derived/cached ledger so History & Analytics stay fast
     and so a day's stats survive even if its tasks are later deleted.

   localStorage["momentum_theme"]  -> "dark" | "light"
   ===================================================================== */

(function () {
  "use strict";

  /* ---------------------- Constants & helpers ---------------------- */
  const TASKS_KEY = "momentum_tasks";
  const DAYS_KEY  = "momentum_days";
  const THEME_KEY = "momentum_theme";

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const todayKey = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const fmtTime = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const fmtDateLong = (d = new Date()) =>
    d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------------------------- State ------------------------------ */
  let tasks = loadJSON(TASKS_KEY, []);
  let days  = loadJSON(DAYS_KEY, {});
  let currentFilter = "all";
  let historyFilterDate = null;
  let charts = {}; // Chart.js instances, kept so we can destroy/redraw

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn(`Could not parse localStorage[${key}], resetting.`, e);
      return fallback;
    }
  }
  function saveTasks() { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); }
  function saveDays()  { localStorage.setItem(DAYS_KEY, JSON.stringify(days)); }

  function ensureDay(key) {
    if (!days[key]) days[key] = { added: 0, completed: 0 };
    return days[key];
  }

  /* ======================================================================
     NAVIGATION
     ====================================================================== */
  function initNav() {
    $$(".nav-item").forEach((item) => {
      item.addEventListener("click", () => goToPage(item.dataset.page));
    });
    $$("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => goToPage(btn.dataset.goto));
    });
  }

  function goToPage(pageName) {
    $$(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.page === pageName));
    $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${pageName}`));
    if (pageName === "analytics") renderCharts();
    if (pageName === "history") renderHistory();
  }

  /* ======================================================================
     TASKS
     ====================================================================== */
  function addTask(title) {
    const trimmed = title.trim();
    if (!trimmed) return;

    const now = new Date();
    const task = {
      id: uid(),
      title: trimmed,
      createdAt: now.toISOString(),
      completed: false,
      completedAt: null,
    };
    tasks.unshift(task);
    ensureDay(todayKey(now)).added += 1;

    saveTasks();
    saveDays();
    renderAll();
    showToast("Task added");
  }

  function toggleTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    task.completed = !task.completed;
    const dayKey = todayKey(new Date(task.createdAt));
    const bucket = ensureDay(dayKey);

    if (task.completed) {
      task.completedAt = new Date().toISOString();
      bucket.completed += 1;
    } else {
      task.completedAt = null;
      bucket.completed = Math.max(0, bucket.completed - 1);
    }

    saveTasks();
    saveDays();
    renderAll();
  }

  function deleteTask(id) {
    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    const finish = () => {
      tasks = tasks.filter((t) => t.id !== id);
      saveTasks();
      renderAll();
    };
    if (card) {
      card.classList.add("removing");
      card.addEventListener("transitionend", finish, { once: true });
      // Fallback in case transitionend doesn't fire
      setTimeout(finish, 400);
    } else {
      finish();
    }
  }

  function buildTaskCard(task, { compact = false } = {}) {
    const li = document.createElement("li");
    li.className = "task-card" + (task.completed ? " completed" : "");
    li.dataset.id = task.id;

    li.innerHTML = `
      <button class="task-check" aria-label="Toggle task complete">✓</button>
      <div class="task-body">
        <div class="task-title"></div>
        <span class="task-time">Created ${fmtTime(task.createdAt)}</span>
      </div>
      ${compact ? "" : '<button class="task-delete" aria-label="Delete task">🗑</button>'}
    `;
    li.querySelector(".task-title").textContent = task.title;
    li.querySelector(".task-check").addEventListener("click", () => toggleTask(task.id));
    const del = li.querySelector(".task-delete");
    if (del) del.addEventListener("click", () => deleteTask(task.id));

    return li;
  }

  function renderTasks() {
    const list = $("#taskList");
    list.innerHTML = "";

    let visible = tasks;
    if (currentFilter === "pending") visible = tasks.filter((t) => !t.completed);
    if (currentFilter === "completed") visible = tasks.filter((t) => t.completed);

    visible.forEach((t) => list.appendChild(buildTaskCard(t)));

    $("#taskEmptyState").classList.toggle("show", visible.length === 0);

    // Dashboard "recent" mini list — top 5, most recent first
    const recentList = $("#recentTaskList");
    recentList.innerHTML = "";
    tasks.slice(0, 5).forEach((t) => recentList.appendChild(buildTaskCard(t, { compact: true })));
    if (tasks.length === 0) {
      recentList.innerHTML = `<li class="empty-state show">No tasks yet — head to the Tasks page.</li>`;
    }
  }

  function initTaskForm() {
    $("#addTaskForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#taskInput");
      addTask(input.value);
      input.value = "";
      input.focus();
    });

    $$(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $$(".chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        currentFilter = chip.dataset.filter;
        renderTasks();
      });
    });
  }

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  function todayStats() {
    const key = todayKey();
    const createdToday = tasks.filter((t) => todayKey(new Date(t.createdAt)) === key);
    const completedToday = createdToday.filter((t) => t.completed).length;
    const created = createdToday.length;
    const pending = created - completedToday;
    const pct = created === 0 ? 0 : Math.round((completedToday / created) * 100);
    return { created, completedToday, pending, pct };
  }

  function motivationMessage(pct, created) {
    if (created === 0) return "Add a task to get moving.";
    if (pct < 30) return "Low productivity — pick one small task and start there.";
    if (pct < 70) return "Good progress — keep the momentum going.";
    return "Excellent day — you're on fire! 🔥";
  }

  const RING_CIRCUMFERENCE = 2 * Math.PI * 86; // r=86, matches CSS

  function renderDashboard() {
    $("#todayDate").textContent = fmtDateLong();

    const { created, completedToday, pending, pct } = todayStats();
    $("#statCreated").textContent = created;
    $("#statCompleted").textContent = completedToday;
    $("#statPending").textContent = pending;

    $("#ringPercent").textContent = `${pct}%`;
    const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
    // Slight delay so the transition animates on load too
    requestAnimationFrame(() => {
      $("#ringProgress").style.strokeDashoffset = offset;
    });

    $("#motivationMsg").textContent = motivationMessage(pct, created);
  }

  /* ======================================================================
     ANALYTICS (Chart.js)
     ====================================================================== */
  function lastNDays(n) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push({ key: todayKey(d), label: d.toLocaleDateString(undefined, { weekday: "short" }) });
    }
    return arr;
  }

  function chartTheme() {
    const light = document.body.dataset.theme === "light";
    return {
      text: light ? "#565f76" : "#8992a8",
      grid: light ? "rgba(20,25,45,0.08)" : "rgba(255,255,255,0.06)",
    };
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function renderCharts() {
    const theme = chartTheme();
    const last7 = lastNDays(7);

    /* --- 1. Daily completed tasks (bar) --- */
    destroyChart("daily");
    charts.daily = new Chart($("#dailyCompletedChart"), {
      type: "bar",
      data: {
        labels: last7.map((d) => d.label),
        datasets: [{
          label: "Completed",
          data: last7.map((d) => (days[d.key] ? days[d.key].completed : 0)),
          backgroundColor: "#2dd4bf",
          borderRadius: 8,
          maxBarThickness: 34,
        }],
      },
      options: baseChartOptions(theme, { legend: false }),
    });

    /* --- 2. Weekly productivity trend (line, % per day) --- */
    destroyChart("weekly");
    charts.weekly = new Chart($("#weeklyProductivityChart"), {
      type: "line",
      data: {
        labels: last7.map((d) => d.label),
        datasets: [{
          label: "Productivity %",
          data: last7.map((d) => {
            const rec = days[d.key];
            if (!rec || rec.added === 0) return 0;
            return Math.round((rec.completed / rec.added) * 100);
          }),
          borderColor: "#f5a623",
          backgroundColor: "rgba(245,166,35,0.18)",
          fill: true,
          tension: 0.35,
          pointBackgroundColor: "#f5a623",
          pointRadius: 4,
        }],
      },
      options: baseChartOptions(theme, { legend: false, max: 100 }),
    });

    /* --- 3. Completed vs Pending today (doughnut) --- */
    const { completedToday, pending } = todayStats();
    destroyChart("cp");
    charts.cp = new Chart($("#completedPendingChart"), {
      type: "doughnut",
      data: {
        labels: ["Completed", "Pending"],
        datasets: [{
          data: [completedToday, pending],
          backgroundColor: ["#2dd4bf", "#ff6b6b"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: theme.text, font: { family: "Inter" } } },
        },
        cutout: "68%",
      },
    });
  }

  function baseChartOptions(theme, { legend = true, max = null } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: legend } },
      scales: {
        x: { ticks: { color: theme.text, font: { family: "Inter" } }, grid: { color: theme.grid } },
        y: {
          beginAtZero: true,
          max: max ?? undefined,
          ticks: { color: theme.text, font: { family: "Inter" } },
          grid: { color: theme.grid },
        },
      },
    };
  }

  /* ======================================================================
     HISTORY
     ====================================================================== */
  function renderHistory() {
    const list = $("#historyList");
    list.innerHTML = "";

    let keys = Object.keys(days).sort((a, b) => (a < b ? 1 : -1)); // newest first
    if (historyFilterDate) keys = keys.filter((k) => k === historyFilterDate);

    $("#historyEmptyState").classList.toggle("show", keys.length === 0);

    keys.forEach((key) => {
      const rec = days[key];
      const pct = rec.added === 0 ? 0 : Math.round((rec.completed / rec.added) * 100);
      const d = new Date(key + "T00:00:00");

      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <div>
          <div class="history-date">${d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
          <div class="history-sub">${key}</div>
        </div>
        <div class="history-metrics">
          <div class="history-metric"><span class="m-val">${rec.added}</span><span class="m-lbl">added</span></div>
          <div class="history-metric"><span class="m-val">${rec.completed}</span><span class="m-lbl">done</span></div>
          <div class="history-metric"><span class="m-val">${pct}%</span><span class="m-lbl">rate</span></div>
        </div>
      `;
      list.appendChild(item);
    });
  }

  function initHistory() {
    $("#historyDate").addEventListener("change", (e) => {
      historyFilterDate = e.target.value || null;
      renderHistory();
    });
    $("#historyClear").addEventListener("click", () => {
      historyFilterDate = null;
      $("#historyDate").value = "";
      renderHistory();
    });
  }

  /* ======================================================================
     THEME
     ====================================================================== */
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    $("#themeIcon").textContent = theme === "dark" ? "☾" : "☀";
    $("#themeLabel").textContent = theme === "dark" ? "Dark" : "Light";
    // Redraw charts so axis colors match the new theme, if analytics page has run
    if ($("#page-analytics").classList.contains("active")) renderCharts();
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "dark";
    applyTheme(saved);
    const toggle = () => applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
    $("#themeToggle").addEventListener("click", toggle);
    $("#settingsThemeToggle").addEventListener("click", toggle);
  }

  /* ======================================================================
     SETTINGS: export & reset
     ====================================================================== */
  function initSettings() {
    $("#exportBtn").addEventListener("click", () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        tasks,
        dailyStats: days,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `momentum-stats-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("Statistics exported");
    });

    $("#resetBtn").addEventListener("click", () => {
      if (!confirm("This will permanently delete every task and stat stored in this browser. Continue?")) return;
      tasks = [];
      days = {};
      saveTasks();
      saveDays();
      renderAll();
      showToast("All data reset");
    });
  }

  /* ======================================================================
     TOAST
     ====================================================================== */
  let toastTimer = null;
  function showToast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ======================================================================
     MASTER RENDER + INIT
     ====================================================================== */
  function renderAll() {
    renderDashboard();
    renderTasks();
    if ($("#page-analytics").classList.contains("active")) renderCharts();
    if ($("#page-history").classList.contains("active")) renderHistory();
  }

  function init() {
    initTheme();
    initNav();
    initTaskForm();
    initHistory();
    initSettings();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
