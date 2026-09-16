const state = {
  password: sessionStorage.getItem("appPassword") || "",
  stores: [],
  routes: [],
  storeAliases: [],
  routeAliases: [],
  summaryRows: [],
  compareRows: [],
  importQueue: [], // { file, rows, detectedStoreId, aliasKey, sourceMonth }
  trendMetric: "count",
};

const el = {};
let trendChartInstance = null;
let routeChartInstance = null;

function $(id) { return document.getElementById(id); }

// ============================== API ヘルパー ==============================

async function api(path, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (state.password) headers["x-app-password"] = state.password;
  const response = await fetch(path, Object.assign({}, options, { headers }));
  if (response.status === 401) {
    showLogin();
    throw new Error("unauthorized");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || `request_failed:${response.status}`);
  }
  return data;
}

// ============================== 初期化 ==============================

async function init() {
  cacheElements();
  bindEvents();

  try {
    await api("/api/health");
  } catch (e) {
    // health check failure is non-fatal for login flow
  }

  if (state.password) {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password: state.password }) });
      await startApp();
      return;
    } catch (e) {
      sessionStorage.removeItem("appPassword");
      state.password = "";
    }
  }

  // パスワード未設定サーバーなら、そのまま入ってみて確認する
  try {
    await api("/api/stores");
    await startApp();
  } catch (e) {
    showLogin();
  }
}

function cacheElements() {
  [
    "loginScreen", "loginPassword", "loginSubmit", "loginError", "app",
    "mainTabs", "syncStatus",
    "storeFilter", "storeFilterAll", "dateFromInput", "dateToInput", "compareModeSelect", "applyFilters",
    "kpiGrid", "trendMetricToggle", "trendChart", "routeChart", "routeTable", "storeTable",
    "csvFileInput", "importQueue", "runImport", "importResult",
    "addStoreBtn", "storeMasterTable", "storeAliasTable",
    "addRouteBtn", "routeMasterTable", "unmappedRouteTable",
  ].forEach((id) => { el[id] = $(id); });
}

function bindEvents() {
  el.loginSubmit.addEventListener("click", onLoginSubmit);
  el.loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") onLoginSubmit(); });

  el.mainTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  el.storeFilterAll.addEventListener("click", () => {
    Array.from(el.storeFilter.options).forEach((opt) => { opt.selected = false; });
  });
  el.applyFilters.addEventListener("click", () => refreshDashboard());

  el.trendMetricToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.trendMetric = btn.dataset.metric;
    Array.from(el.trendMetricToggle.children).forEach((c) => c.classList.toggle("active", c === btn));
    renderTrendChart();
  });

  el.csvFileInput.addEventListener("change", onFilesSelected);
  el.runImport.addEventListener("click", runImport);

  el.addStoreBtn.addEventListener("click", onAddStore);
  el.addRouteBtn.addEventListener("click", onAddRoute);
}

function showLogin() {
  el.loginScreen.classList.remove("hidden");
  el.app.classList.add("hidden");
}

async function onLoginSubmit() {
  const password = el.loginPassword.value;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    state.password = password;
    sessionStorage.setItem("appPassword", password);
    el.loginError.classList.add("hidden");
    await startApp();
  } catch (e) {
    el.loginError.classList.remove("hidden");
  }
}

async function startApp() {
  el.loginScreen.classList.add("hidden");
  el.app.classList.remove("hidden");
  await loadMasterData();
  setDefaultDateRange();
  await refreshDashboard();
}

function switchTab(tab) {
  Array.from(el.mainTabs.children).forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  ["dashboard", "import", "settings"].forEach((name) => {
    $(`tab-${name}`).classList.toggle("active", name === tab);
  });
  if (tab === "settings") renderSettingsTables();
}

// ============================== マスタデータ ==============================

async function loadMasterData() {
  const [storesRes, routesRes, storeAliasRes, routeAliasRes] = await Promise.all([
    api("/api/stores"),
    api("/api/routes"),
    api("/api/store-aliases"),
    api("/api/route-aliases"),
  ]);
  state.stores = storesRes.stores || [];
  state.routes = routesRes.routes || [];
  state.storeAliases = storeAliasRes.aliases || [];
  state.routeAliases = routeAliasRes.aliases || [];
  renderStoreFilterOptions();
  renderImportStoreSelectOptions();
}

function renderStoreFilterOptions() {
  el.storeFilter.innerHTML = "";
  state.stores
    .filter((s) => s.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja"))
    .forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      el.storeFilter.appendChild(opt);
    });
}

function setDefaultDateRange() {
  const now = new Date();
  const toMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const fromMonth = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}`;
  el.dateFromInput.value = fromMonth;
  el.dateToInput.value = toMonth;
}

function monthToRange(fromMonth, toMonth) {
  const dateFrom = `${fromMonth}-01`;
  const [y, m] = toMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const dateTo = `${toMonth}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

function monthsBetween(fromMonth, toMonth) {
  const months = [];
  let [y, m] = fromMonth.split("-").map(Number);
  const [ey, em] = toMonth.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function shiftMonth(month, delta) {
  let [y, m] = month.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ============================== ダッシュボード ==============================

async function refreshDashboard() {
  const fromMonth = el.dateFromInput.value;
  const toMonth = el.dateToInput.value;
  if (!fromMonth || !toMonth) return;

  const selectedStoreIds = Array.from(el.storeFilter.selectedOptions).map((o) => o.value);
  const { dateFrom, dateTo } = monthToRange(fromMonth, toMonth);
  const storeParam = selectedStoreIds.length ? `&storeIds=${selectedStoreIds.join(",")}` : "";

  setSyncStatus("読み込み中...");
  try {
    const main = await api(`/api/summary?dateFrom=${dateFrom}&dateTo=${dateTo}${storeParam}`);
    state.summaryRows = main.rows || [];

    const compareMode = el.compareModeSelect.value;
    state.compareRows = [];
    if (compareMode !== "none") {
      const monthSpan = monthsBetween(fromMonth, toMonth).length;
      let compareFrom, compareTo;
      if (compareMode === "prev-period") {
        compareTo = shiftMonth(fromMonth, -1);
        compareFrom = shiftMonth(compareTo, -(monthSpan - 1));
      } else {
        compareFrom = shiftMonth(fromMonth, -12);
        compareTo = shiftMonth(toMonth, -12);
      }
      const range2 = monthToRange(compareFrom, compareTo);
      const compareRes = await api(`/api/summary?dateFrom=${range2.dateFrom}&dateTo=${range2.dateTo}${storeParam}`);
      state.compareRows = compareRes.rows || [];
    }

    renderKpis();
    renderTrendChart();
    renderRouteChart();
    renderRouteTable();
    renderStoreTable();
    setSyncStatus(`最終更新 ${new Date().toLocaleTimeString("ja-JP")}`);
  } catch (e) {
    setSyncStatus("読み込みに失敗しました");
    console.error(e);
  }
}

function setSyncStatus(text) { el.syncStatus.textContent = text; }

function routeExcludedMap() {
  return new Map(state.routes.map((r) => [r.id, r.excluded_by_default]));
}

function sumRows(rows) {
  const excluded = routeExcludedMap();
  let count = 0, sales = 0, lineCount = 0;
  rows.forEach((r) => {
    if (excluded.get(r.routeId)) return;
    count += r.count;
    sales += r.sales;
    if (r.routeName === "LINEミニアプリ") lineCount += r.count;
  });
  return { count, sales, lineCount };
}

function renderKpis() {
  const current = sumRows(state.summaryRows);
  const compare = state.compareRows.length ? sumRows(state.compareRows) : null;
  const unitPrice = current.count ? current.sales / current.count : 0;
  const lineRatio = current.count ? current.lineCount / current.count : 0;

  const cards = [
    { label: "予約件数", value: formatNumber(current.count), delta: compare ? deltaText(current.count, compare.count, false) : null },
    { label: "売上", value: formatCurrency(current.sales), delta: compare ? deltaText(current.sales, compare.sales, false) : null },
    { label: "客単価", value: formatCurrency(unitPrice), delta: compare ? deltaText(unitPrice, compare.count ? compare.sales / compare.count : 0, false) : null },
    { label: "LINE比率", value: formatPercent(lineRatio), delta: compare ? deltaText(lineRatio, compare.count ? compare.lineCount / compare.count : 0, true) : null },
  ];

  el.kpiGrid.innerHTML = cards.map((c) => `
    <div class="kpi-card">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      ${c.delta ? `<div class="kpi-delta ${c.delta.cls}">${c.delta.text}</div>` : ""}
    </div>
  `).join("");
}

function deltaText(current, previous, isRatio) {
  const diff = current - previous;
  const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const sign = diff > 0 ? "+" : "";
  if (isRatio) {
    return { cls, text: `${sign}${(diff * 100).toFixed(1)}pt（前期間比）` };
  }
  const rate = previous ? (diff / previous) * 100 : null;
  const rateText = rate === null ? "" : ` (${sign}${rate.toFixed(1)}%)`;
  return { cls, text: `${sign}${formatNumber(Math.round(diff))}${rateText} 前期間比` };
}

function renderTrendChart() {
  const excluded = routeExcludedMap();
  const fromMonth = el.dateFromInput.value;
  const toMonth = el.dateToInput.value;
  const months = monthsBetween(fromMonth, toMonth);
  const selectedStoreIds = Array.from(el.storeFilter.selectedOptions).map((o) => o.value);

  const rows = state.summaryRows.filter((r) => !excluded.get(r.routeId));
  let datasets = [];

  const byStoreThenMonth = (storeId) => {
    const map = new Map();
    rows.filter((r) => r.storeId === storeId).forEach((r) => {
      const cur = map.get(r.month) || { count: 0, sales: 0 };
      cur.count += r.count;
      cur.sales += r.sales;
      map.set(r.month, cur);
    });
    return months.map((m) => (map.get(m) || { count: 0, sales: 0 })[state.trendMetric]);
  };

  if (selectedStoreIds.length >= 1 && selectedStoreIds.length <= 5) {
    datasets = selectedStoreIds.map((id, idx) => {
      const store = state.stores.find((s) => s.id === id);
      return {
        label: store ? store.name : "店舗",
        data: byStoreThenMonth(id),
        borderColor: paletteColor(idx),
        backgroundColor: paletteColor(idx),
        tension: 0.25,
      };
    });
  } else {
    const map = new Map();
    rows.forEach((r) => {
      const cur = map.get(r.month) || { count: 0, sales: 0 };
      cur.count += r.count;
      cur.sales += r.sales;
      map.set(r.month, cur);
    });
    datasets = [{
      label: "全店舗合計",
      data: months.map((m) => (map.get(m) || { count: 0, sales: 0 })[state.trendMetric]),
      borderColor: paletteColor(0),
      backgroundColor: paletteColor(0),
      tension: 0.25,
    }];
  }

  if (trendChartInstance) trendChartInstance.destroy();
  trendChartInstance = new Chart(el.trendChart, {
    type: "line",
    data: { labels: months, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function renderRouteChart() {
  const excluded = routeExcludedMap();
  const map = new Map();
  state.summaryRows.forEach((r) => {
    if (excluded.get(r.routeId)) return;
    const cur = map.get(r.routeName) || 0;
    map.set(r.routeName, cur + r.count);
  });
  const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);

  if (routeChartInstance) routeChartInstance.destroy();
  routeChartInstance = new Chart(el.routeChart, {
    type: "doughnut",
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{
        data: entries.map(([, count]) => count),
        backgroundColor: entries.map((_, idx) => paletteColor(idx)),
      }],
    },
    options: { responsive: true, plugins: { legend: { position: "right" } } },
  });
}

function renderRouteTable() {
  const excluded = routeExcludedMap();
  const map = new Map();
  state.summaryRows.forEach((r) => {
    const cur = map.get(r.routeName) || { count: 0, sales: 0, excluded: excluded.get(r.routeId) };
    cur.count += r.count;
    cur.sales += r.sales;
    map.set(r.routeName, cur);
  });
  const totalCount = Array.from(map.values()).filter((v) => !v.excluded).reduce((a, v) => a + v.count, 0);
  const rows = Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);

  const head = `<thead><tr><th>経路</th><th>件数</th><th>構成比</th><th>売上</th><th>客単価</th></tr></thead>`;
  const body = rows.map(([name, v]) => `
    <tr>
      <td>${escapeHtml(name)}${v.excluded ? "（除外）" : ""}</td>
      <td>${formatNumber(v.count)}</td>
      <td>${v.excluded ? "-" : formatPercent(totalCount ? v.count / totalCount : 0)}</td>
      <td>${formatCurrency(v.sales)}</td>
      <td>${formatCurrency(v.count ? v.sales / v.count : 0)}</td>
    </tr>
  `).join("");
  el.routeTable.innerHTML = head + `<tbody>${body}</tbody>`;
}

function renderStoreTable() {
  const excluded = routeExcludedMap();
  const compareMap = new Map();
  state.compareRows.forEach((r) => {
    if (excluded.get(r.routeId)) return;
    const cur = compareMap.get(r.storeId) || { count: 0, sales: 0 };
    cur.count += r.count;
    cur.sales += r.sales;
    compareMap.set(r.storeId, cur);
  });

  const map = new Map();
  state.summaryRows.forEach((r) => {
    if (excluded.get(r.routeId)) return;
    const cur = map.get(r.storeId) || { name: r.storeName, count: 0, sales: 0 };
    cur.count += r.count;
    cur.sales += r.sales;
    map.set(r.storeId, cur);
  });

  const hasCompare = state.compareRows.length > 0;
  const rows = Array.from(map.values()).sort((a, b) => b.sales - a.sales);

  const head = `<thead><tr><th>店舗</th><th>件数</th><th>売上</th><th>客単価</th>${hasCompare ? "<th>件数増減</th><th>売上増減</th>" : ""}</tr></thead>`;
  const body = rows.map((row) => {
    const storeId = Array.from(map.entries()).find(([, v]) => v === row)[0];
    const prev = compareMap.get(storeId);
    const compareCells = hasCompare
      ? `<td class="${deltaClass(row.count - (prev?.count || 0))}">${formatSignedNumber(row.count - (prev?.count || 0))}</td>
         <td class="${deltaClass(row.sales - (prev?.sales || 0))}">${formatSignedNumber(row.sales - (prev?.sales || 0), true)}</td>`
      : "";
    return `<tr><td>${escapeHtml(row.name)}</td><td>${formatNumber(row.count)}</td><td>${formatCurrency(row.sales)}</td><td>${formatCurrency(row.count ? row.sales / row.count : 0)}</td>${compareCells}</tr>`;
  }).join("");
  el.storeTable.innerHTML = head + `<tbody>${body}</tbody>`;
}

function paletteColor(idx) {
  const palette = ["#d97745", "#233e63", "#2d8f6f", "#cb4d41", "#8a6fb0", "#3e5c87", "#c9a227"];
  return palette[idx % palette.length];
}

// ============================== CSV取込 ==============================

const CSV_HEADER_MAP = {
  customerName: "予約者名",
  route: "予約経路",
  reservationNo: "予約番号",
  reservedDate: "予約日",
  reservedTime: "予約時間",
  visitDate: "来店日時",
  treatmentStart: "施術開始時間",
  treatmentEnd: "施術終了時間",
  fee: "料金",
  menuText: "メニュー情報",
  staffName: "スタッフ",
  nominated: "スタッフ指名",
  gender: "性別",
};

async function decodeCsvFile(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;
  const shiftJis = new TextDecoder("shift-jis", { fatal: false }).decode(buffer);
  return scoreReadableJapanese(shiftJis) >= scoreReadableJapanese(utf8) ? shiftJis : utf8;
}

function scoreReadableJapanese(text) {
  const good = (text.match(/[一-龠ぁ-んァ-ンー]/g) || []).length;
  const bad = (text.match(/\uFFFD/g) || []).length;
  return good - bad * 5;
}

function parseCsv(text) {
  const rows = [];
  let current = "", row = [], insideQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (insideQuote && next === '"') { current += '"'; i += 1; } else { insideQuote = !insideQuote; }
      continue;
    }
    if (char === "," && !insideQuote) { row.push(current); current = ""; continue; }
    if ((char === "\n" || char === "\r") && !insideQuote) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((v) => v !== "")) rows.push(row);
      row = []; current = "";
      continue;
    }
    current += char;
  }
  if (current !== "" || row.length) { row.push(current); rows.push(row); }
  return rows;
}

function aliasKeyFromFileName(fileName) {
  return fileName.replace(/\.csv$/i, "").replace(/_?20\d{2}-\d{2}-\d{2}$/, "");
}

function inferMonthFromFileName(fileName) {
  const match = String(fileName || "").match(/(20\d{2})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function guessStoreIdForFile(fileName) {
  const key = aliasKeyFromFileName(fileName);
  const alias = state.storeAliases.find((a) => a.alias === key);
  if (alias) return alias.storeId;
  const partial = state.storeAliases.find((a) => key.includes(a.alias) || a.alias.includes(key));
  return partial ? partial.storeId : "";
}

async function onFilesSelected(event) {
  const files = Array.from(event.target.files || []);
  state.importQueue = [];
  for (const file of files) {
    const text = await decodeCsvFile(file);
    const rows = parseCsv(text);
    if (!rows.length) continue;
    const header = rows[0];
    const indexOf = (jpName) => header.indexOf(jpName);
    const idx = Object.fromEntries(Object.entries(CSV_HEADER_MAP).map(([k, v]) => [k, indexOf(v)]));

    const dataRows = rows.slice(1).map((r) => {
      const get = (key) => (idx[key] >= 0 ? r[idx[key]] : "");
      return {
        customerName: get("customerName"),
        route: get("route"),
        reservationNo: get("reservationNo"),
        reservedDate: get("reservedDate"),
        reservedTime: get("reservedTime"),
        visitDate: get("visitDate"),
        treatmentStart: get("treatmentStart"),
        treatmentEnd: get("treatmentEnd"),
        fee: get("fee"),
        menuText: get("menuText"),
        staffName: get("staffName"),
        nominated: get("nominated"),
        gender: get("gender"),
      };
    });

    state.importQueue.push({
      file,
      fileName: file.name,
      rows: dataRows,
      detectedStoreId: guessStoreIdForFile(file.name),
      aliasKey: aliasKeyFromFileName(file.name),
      sourceMonth: inferMonthFromFileName(file.name),
    });
  }
  renderImportQueue();
}

function renderImportStoreSelectOptions() {
  // 取込キューがある場合は再描画のみ行う（マスタ読み込み後の初回は空のため何もしない）
  if (state.importQueue.length) renderImportQueue();
}

function renderImportQueue() {
  if (!state.importQueue.length) {
    el.importQueue.className = "import-queue empty-state";
    el.importQueue.textContent = "ファイルを選ぶと、ここに店舗名の推定結果が表示されます。";
    el.runImport.disabled = true;
    return;
  }
  el.importQueue.className = "import-queue";
  el.importQueue.innerHTML = state.importQueue.map((item, index) => `
    <div class="import-item">
      <div>
        <div class="file-name">${escapeHtml(item.fileName)}</div>
        <div class="row-count">${item.rows.length} 件</div>
      </div>
      <select data-index="${index}" class="store-picker">
        <option value="">（店舗を選択）</option>
        ${state.stores.filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === item.detectedStoreId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
  `).join("");

  el.importQueue.querySelectorAll(".store-picker").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.index);
      state.importQueue[index].detectedStoreId = e.target.value;
      updateRunImportEnabled();
    });
  });
  updateRunImportEnabled();
}

function updateRunImportEnabled() {
  el.runImport.disabled = !state.importQueue.every((item) => item.detectedStoreId);
}

async function runImport() {
  el.runImport.disabled = true;
  const results = [];
  for (const item of state.importQueue) {
    try {
      const res = await api("/api/import", {
        method: "POST",
        body: JSON.stringify({
          storeId: item.detectedStoreId,
          sourceFile: item.fileName,
          sourceMonth: item.sourceMonth,
          rows: item.rows,
        }),
      });
      results.push(`✅ ${item.fileName}: ${res.inserted}件取込${res.newUnmappedRoutes.length ? `（未分類の経路 ${res.newUnmappedRoutes.join("・")} は「設定」タブで割り当ててください）` : ""}`);

      // 店舗名の学習
      const existingAlias = state.storeAliases.find((a) => a.alias === item.aliasKey);
      if (!existingAlias) {
        await api("/api/store-aliases", {
          method: "POST",
          body: JSON.stringify({ alias: item.aliasKey, storeId: item.detectedStoreId }),
        });
      }
    } catch (e) {
      results.push(`❌ ${item.fileName}: 取込に失敗しました（${e.message}）`);
    }
  }
  el.importResult.textContent = results.join("\n");
  state.importQueue = [];
  el.csvFileInput.value = "";
  renderImportQueue();
  await loadMasterData();
  await refreshDashboard();
}

// ============================== 設定 ==============================

function renderSettingsTables() {
  renderStoreMasterTable();
  renderStoreAliasTable();
  renderRouteMasterTable();
  renderUnmappedRouteTable();
}

function renderStoreMasterTable() {
  const head = `<thead><tr><th>店舗名</th><th>ブランド</th><th>有効</th><th></th></tr></thead>`;
  const body = state.stores.map((s) => `
    <tr>
      <td><input type="text" data-id="${s.id}" data-field="name" value="${escapeAttr(s.name)}" /></td>
      <td><input type="text" data-id="${s.id}" data-field="brand" value="${escapeAttr(s.brand || "")}" style="width:120px" /></td>
      <td><input type="checkbox" data-id="${s.id}" data-field="active" ${s.active ? "checked" : ""} /></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-action="save-store" data-id="${s.id}">保存</button>
        <button class="btn btn-danger btn-sm" data-action="delete-store" data-id="${s.id}">削除</button>
      </td>
    </tr>
  `).join("");
  el.storeMasterTable.innerHTML = head + `<tbody>${body}</tbody>`;

  el.storeMasterTable.querySelectorAll('[data-action="save-store"]').forEach((btn) => {
    btn.addEventListener("click", () => saveStoreRow(btn.dataset.id));
  });
  el.storeMasterTable.querySelectorAll('[data-action="delete-store"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteStoreRow(btn.dataset.id));
  });
}

async function saveStoreRow(id) {
  const name = el.storeMasterTable.querySelector(`input[data-id="${id}"][data-field="name"]`).value;
  const brand = el.storeMasterTable.querySelector(`input[data-id="${id}"][data-field="brand"]`).value;
  const active = el.storeMasterTable.querySelector(`input[data-id="${id}"][data-field="active"]`).checked;
  await api("/api/stores", { method: "PUT", body: JSON.stringify({ id, name, brand, active }) });
  await loadMasterData();
  renderSettingsTables();
}

async function deleteStoreRow(id) {
  if (!confirm("この店舗を削除しますか？")) return;
  try {
    await api(`/api/stores?id=${id}`, { method: "DELETE" });
    await loadMasterData();
    renderSettingsTables();
  } catch (e) {
    alert(e.message);
  }
}

async function onAddStore() {
  const name = prompt("新しい店舗名を入力してください");
  if (!name) return;
  await api("/api/stores", { method: "POST", body: JSON.stringify({ name }) });
  await loadMasterData();
  renderSettingsTables();
}

function renderStoreAliasTable() {
  const head = `<thead><tr><th>ファイル名のパターン</th><th>店舗</th><th></th></tr></thead>`;
  const body = state.storeAliases.map((a) => `
    <tr>
      <td>${escapeHtml(a.alias)}</td>
      <td>${escapeHtml(a.storeName)}</td>
      <td><button class="btn btn-danger btn-sm" data-action="delete-store-alias" data-id="${a.id}">削除</button></td>
    </tr>
  `).join("");
  el.storeAliasTable.innerHTML = head + `<tbody>${body}</tbody>`;
  el.storeAliasTable.querySelectorAll('[data-action="delete-store-alias"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/store-aliases?id=${btn.dataset.id}`, { method: "DELETE" });
      await loadMasterData();
      renderSettingsTables();
    });
  });
}

function renderRouteMasterTable() {
  const head = `<thead><tr><th>経路名</th><th>表示順</th><th>集計から除外</th><th></th></tr></thead>`;
  const body = state.routes.filter((r) => r.name !== "未分類").map((r) => `
    <tr>
      <td><input type="text" data-id="${r.id}" data-field="name" value="${escapeAttr(r.name)}" /></td>
      <td><input type="number" data-id="${r.id}" data-field="sort_order" value="${r.sort_order}" style="width:60px" /></td>
      <td><input type="checkbox" data-id="${r.id}" data-field="excluded_by_default" ${r.excluded_by_default ? "checked" : ""} /></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-action="save-route" data-id="${r.id}">保存</button>
        <button class="btn btn-danger btn-sm" data-action="delete-route" data-id="${r.id}">削除</button>
      </td>
    </tr>
  `).join("");
  el.routeMasterTable.innerHTML = head + `<tbody>${body}</tbody>`;

  el.routeMasterTable.querySelectorAll('[data-action="save-route"]').forEach((btn) => {
    btn.addEventListener("click", () => saveRouteRow(btn.dataset.id));
  });
  el.routeMasterTable.querySelectorAll('[data-action="delete-route"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("この経路を削除しますか？")) return;
      try {
        await api(`/api/routes?id=${btn.dataset.id}`, { method: "DELETE" });
        await loadMasterData();
        renderSettingsTables();
      } catch (e) { alert(e.message); }
    });
  });
}

async function saveRouteRow(id) {
  const name = el.routeMasterTable.querySelector(`input[data-id="${id}"][data-field="name"]`).value;
  const sortOrder = Number(el.routeMasterTable.querySelector(`input[data-id="${id}"][data-field="sort_order"]`).value);
  const excludedByDefault = el.routeMasterTable.querySelector(`input[data-id="${id}"][data-field="excluded_by_default"]`).checked;
  await api("/api/routes", { method: "PUT", body: JSON.stringify({ id, name, sortOrder, excludedByDefault }) });
  await loadMasterData();
  renderSettingsTables();
}

async function onAddRoute() {
  const name = prompt("新しい経路名を入力してください");
  if (!name) return;
  await api("/api/routes", { method: "POST", body: JSON.stringify({ name }) });
  await loadMasterData();
  renderSettingsTables();
}

function renderUnmappedRouteTable() {
  const unclassified = state.routes.find((r) => r.name === "未分類");
  const rows = state.routeAliases.filter((a) => unclassified && a.routeId === unclassified.id);
  const assignableRoutes = state.routes.filter((r) => r.name !== "未分類");

  if (!rows.length) {
    el.unmappedRouteTable.innerHTML = `<tbody><tr><td class="muted">未分類の経路表記はありません。</td></tr></tbody>`;
    return;
  }

  const head = `<thead><tr><th>CSV上の表記</th><th>割り当て先</th><th></th></tr></thead>`;
  const body = rows.map((a) => `
    <tr>
      <td>${escapeHtml(a.alias)}</td>
      <td>
        <select data-id="${a.id}" class="unmapped-select">
          ${assignableRoutes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("")}
        </select>
      </td>
      <td><button class="btn btn-primary btn-sm" data-action="assign-route" data-id="${a.id}">割り当てる</button></td>
    </tr>
  `).join("");
  el.unmappedRouteTable.innerHTML = head + `<tbody>${body}</tbody>`;

  el.unmappedRouteTable.querySelectorAll('[data-action="assign-route"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const select = el.unmappedRouteTable.querySelector(`.unmapped-select[data-id="${btn.dataset.id}"]`);
      await api("/api/route-aliases", { method: "PUT", body: JSON.stringify({ id: btn.dataset.id, routeId: select.value }) });
      await loadMasterData();
      renderSettingsTables();
      await refreshDashboard();
    });
  });
}

// ============================== フォーマット ==============================

function formatNumber(v) { return new Intl.NumberFormat("ja-JP").format(Math.round(v || 0)); }
function formatCurrency(v) { return `¥${formatNumber(v)}`; }
function formatPercent(v) { return `${((v || 0) * 100).toFixed(1)}%`; }
function formatSignedNumber(v, isCurrency = false) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${isCurrency ? formatCurrency(v) : formatNumber(v)}`;
}
function deltaClass(v) { return v > 0 ? "positive" : v < 0 ? "negative" : ""; }
function escapeHtml(text) {
  return String(text || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(text) { return escapeHtml(text); }

init();
