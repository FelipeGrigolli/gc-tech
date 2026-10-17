// ==========================================
// GC TECH ANALYTICS — TELAS
//   "Reports & Analytics"  (module-analytics)  → analista de dados (Alex)
//   "Executive Overview"   (module-executive)  → dono (Sam)
// Gráficos: Chart.js (CDN). Cada gráfico tem uma visão em tabela ("Table").
// Paleta: modo escuro do guia de visualização (cores categóricas em ordem fixa;
// verde/amarelo/vermelho só para status, sempre com ícone + texto).
// Depende de: gc-analytics-data.js, gc-fleet-data.js, gc-payments.js.
// ==========================================
const AN_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const AN_STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#64748b' };
const AN_INK = { secondary: '#cbd5e1', muted: '#94a3b8', grid: 'rgba(148, 163, 184, 0.14)' };
const AN_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const anCharts = {};
const anTables = {};
const anSortState = {};

// ---------- Formatação ----------
function anMoney(n, compact) {
  if (compact && Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (compact && Math.abs(n) >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'k';
  return '$' + Math.round(n).toLocaleString('en-AU');
}
function anPct(x, digits) { return (x * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }
function anNum(n) { return Math.round(n).toLocaleString('en-AU'); }
function anShortDate(ms) { const d = new Date(ms); return `${d.getDate()} ${FLEET_MONTHS[d.getMonth()]}`; }
function anVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

// Variação vs período anterior: % para valores, pontos percentuais para taxas
function anDelta(cur, prev, upIsGood, isRate) {
  if (!prev && !isRate) return '<span class="an-delta flat">no prior data</span>';
  const diff = isRate ? (cur - prev) * 100 : ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(diff) < 0.05) return '<span class="an-delta flat">● no change <small>vs previous</small></span>';
  const up = diff > 0;
  const good = up === (upIsGood !== false);
  return `<span class="an-delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}${isRate ? ' pts' : '%'} <small>vs previous</small></span>`;
}

function anTile(label, value, deltaHtml, hint) {
  return `<div class="an-tile"><span class="an-tile-label">${label}</span><strong class="an-tile-value">${value}</strong>${deltaHtml || ''}${hint ? `<small class="an-tile-hint">${hint}</small>` : ''}</div>`;
}

// ---------- Cartões de gráfico + visão em tabela ----------
function anCard(id, title, sub, wide) {
  return `
    <div class="an-card ${wide ? 'wide' : ''}">
      <div class="an-card-head">
        <div><h4>${title}</h4>${sub ? `<span>${sub}</span>` : ''}</div>
        <button class="an-table-toggle" id="an-tg-${id}" onclick="anToggleTable('${id}')">Table</button>
      </div>
      <div class="an-chart-box" id="an-box-${id}"><canvas id="an-c-${id}"></canvas></div>
      <div class="an-chart-table" id="an-t-${id}" hidden></div>
    </div>`;
}

function anSetTable(id, headers, rows) {
  anTables[id] = { headers, rows };
  const el = document.getElementById(`an-t-${id}`);
  if (el && !el.hidden) anRenderTwin(id);
}

function anRenderTwin(id) {
  const t = anTables[id];
  const el = document.getElementById(`an-t-${id}`);
  if (!t || !el) return;
  el.innerHTML = `<table class="an-table"><thead><tr>${t.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function anToggleTable(id) {
  const box = document.getElementById(`an-box-${id}`);
  const table = document.getElementById(`an-t-${id}`);
  const showTable = table.hidden;
  table.hidden = !showTable;
  box.hidden = showTable;
  document.getElementById(`an-tg-${id}`).textContent = showTable ? 'Chart' : 'Table';
  if (showTable) anRenderTwin(id);
}

let anDefaultsReady = false;
function anChartDefaults() {
  if (anDefaultsReady || typeof Chart === 'undefined') return;
  Chart.defaults.color = AN_INK.muted;
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0f172a';
  Chart.defaults.plugins.tooltip.borderColor = '#334155';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#f8fafc';
  Chart.defaults.plugins.tooltip.bodyColor = AN_INK.secondary;
  Chart.defaults.plugins.tooltip.padding = 10;
  anDefaultsReady = true;
}

function anRenderChart(id, config) {
  if (anCharts[id]) { anCharts[id].destroy(); delete anCharts[id]; }
  if (typeof Chart === 'undefined') {
    // Sem internet (Chart.js não carregou): mostra a tabela no lugar do gráfico
    const box = document.getElementById(`an-box-${id}`);
    if (box && !box.hidden) anToggleTable(id);
    return;
  }
  anChartDefaults();
  anCharts[id] = new Chart(document.getElementById(`an-c-${id}`), config);
}

function anValueAxis(fmt, max) {
  return { beginAtZero: true, max, grid: { color: AN_INK.grid, drawTicks: false }, border: { display: false }, ticks: { callback: v => fmt(v), maxTicksLimit: 5, padding: 6 } };
}
function anCategoryAxis() {
  return { grid: { display: false }, border: { color: 'rgba(148,163,184,0.35)' }, ticks: { color: AN_INK.secondary } };
}

// Barras: uma série → uma cor (slot 1); colors[] só quando cada barra é um status
function anBar(id, labels, values, opts) {
  const o = opts || {};
  const fmt = o.fmt || anNum;
  anRenderChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: o.colors || AN_SERIES[0], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26, barPercentage: 0.88, categoryPercentage: 0.88 }] },
    options: {
      indexAxis: o.horizontal ? 'y' : 'x', maintainAspectRatio: false, responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(o.horizontal ? c.parsed.x : c.parsed.y) } } },
      scales: o.horizontal ? { x: anValueAxis(o.axisFmt || fmt, o.max), y: anCategoryAxis() } : { x: anCategoryAxis(), y: anValueAxis(o.axisFmt || fmt, o.max) }
    }
  });
}

function anLine(id, labels, values, fmt) {
  anRenderChart(id, {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: AN_SERIES[0], backgroundColor: 'rgba(57, 135, 229, 0.12)', fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: AN_SERIES[0], pointHoverBorderColor: '#1e293b', pointHoverBorderWidth: 2, tension: 0.25 }] },
    options: {
      maintainAspectRatio: false, responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed.y) } } },
      scales: { x: { ...anCategoryAxis(), ticks: { color: AN_INK.muted, maxTicksLimit: 8, maxRotation: 0 } }, y: anValueAxis(v => anMoney(v, true)) }
    }
  });
}

// ---------- Tabelas ordenáveis ----------
// rows: [{ cells: [{ v: valorParaOrdenar, t: textoExibido }] }]
function anSortableTable(containerId, headers, rows, defaultCol) {
  const state = anSortState[containerId] || (anSortState[containerId] = { col: defaultCol || 1, dir: -1 });
  const sorted = rows.slice().sort((a, b) => {
    const x = a.cells[state.col].v, y = b.cells[state.col].v;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * state.dir;
  });
  document.getElementById(containerId).innerHTML = `
    <table class="an-table sortable">
      <thead><tr>${headers.map((h, i) => `<th onclick="anSortBy('${containerId}', ${i})" class="${i === state.col ? 'sorted' : ''}">${h}${i === state.col ? (state.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(r => `<tr>${r.cells.map((c, i) => `<td class="${i ? 'num' : ''}">${c.t}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  anSortState[containerId].rerender = () => anSortableTable(containerId, headers, rows, defaultCol);
}

function anSortBy(containerId, col) {
  const s = anSortState[containerId];
  s.dir = s.col === col ? -s.dir : -1;
  s.col = col;
  s.rerender();
}

// Barra inline (para tabelas) — mostra proporção sem depender de cor
function anInlineBar(fraction, text) {
  return `<span class="an-inline"><span class="an-inline-bar" style="width:${Math.max(2, Math.min(100, fraction * 100))}%"></span><span>${text}</span></span>`;
}

// Selo de status: sempre ícone + texto (cor nunca sozinha)
function anStatusChip(kind, text) {
  const icon = { good: '✓', warning: '!', serious: '▲', critical: '⛔', neutral: '•' }[kind];
  return `<span class="an-chip ${kind}"><b>${icon}</b> ${text}</span>`;
}

// ==========================================
// REPORTS & ANALYTICS (analista)
// ==========================================
function anAnalyticsShell() {
  const branches = Object.entries(FLEET_BRANCHES).map(([c, n]) => `<option value="${c}">${fleetBranchLabel(n)}</option>`).join('');
  return `
    <div class="an-head">
      <div>
        <h2>Reports & Analytics</h2>
        <p>Revenue, demand, fleet performance and risk. <span class="an-demo-note">Includes 12 months of simulated history for the prototype + live bookings.</span></p>
      </div>
      <button class="pp-btn primary" onclick="anExportCsv()">⬇ Export CSV</button>
    </div>
    <div class="an-filters">
      <label>Period
        <select id="an-f-period" onchange="renderAnalytics()">
          <option value="30">Last 30 days</option><option value="90" selected>Last 90 days</option>
          <option value="mtd">Month to date</option><option value="ytd">Year to date</option><option value="365">Last 12 months</option>
        </select>
      </label>
      <label>Branch<select id="an-f-branch" onchange="renderAnalytics()"><option value="ALL">All branches</option>${branches}</select></label>
      <label>Fleet<select id="an-f-section" onchange="renderAnalytics()"><option value="ALL">All fleet</option><option value="Passenger">Passenger</option><option value="Commercial">Commercial</option></select></label>
      <span class="an-period-label" id="an-period-label"></span>
    </div>
    <div class="an-tiles" id="an-tiles"></div>
    <div class="an-ahead" id="an-ahead"></div>
    <div class="an-grid">
      ${anCard('trend', 'Revenue trend', 'Recognised at pick-up', true)}
      ${anCard('util', 'Utilisation by category', 'Share of vehicle-days on hire')}
      ${anCard('source', 'Bookings by source', 'Where customers found us')}
      ${anCard('branch', 'Revenue by branch')}
      ${anCard('lead', 'Booking lead time', 'Days between booking and pick-up')}
      ${anCard('weekday', 'Pick-ups by weekday')}
      ${anCard('length', 'Rental length')}
      ${anCard('damage', 'Damage cost by category', 'Last 60 days from Damage Control reports · older months simulated')}
      ${anCard('plans', 'Payment plans — outstanding balance', 'Live from Payment Plans')}
    </div>
    <div class="an-section-title">Category performance</div>
    <div class="an-table-wrap" id="an-cat-table"></div>
    <div class="an-section-title">Branch performance</div>
    <div class="an-table-wrap" id="an-branch-table"></div>`;
}

let anLastExport = [];

function renderAnalytics() {
  const root = document.getElementById('module-analytics');
  if (!root) return;
  if (!root.dataset.ready) { root.innerHTML = anAnalyticsShell(); root.dataset.ready = '1'; }

  const f = { branch: anVal('an-f-branch'), section: anVal('an-f-section') };
  const p = anPeriod(anVal('an-f-period'));
  const all = anAllRecords();
  const cur = anSummary(all, p.from, p.to, f);
  const prev = anSummary(all, p.prevFrom, p.prevTo, f);
  document.getElementById('an-period-label').textContent = `${fleetFormatDate(p.from)} – ${fleetFormatDate(p.to - 1)} · compared with the previous ${p.days} days`;

  document.getElementById('an-tiles').innerHTML = [
    anTile('Revenue', anMoney(cur.revenue, true), anDelta(cur.revenue, prev.revenue)),
    anTile('Bookings', anNum(cur.bookings), anDelta(cur.bookings, prev.bookings)),
    anTile('Avg daily rate', anMoney(cur.adr), anDelta(cur.adr, prev.adr), 'Revenue ÷ rental days'),
    anTile('Avg rental length', cur.avgLength.toFixed(1) + ' days', anDelta(cur.avgLength, prev.avgLength)),
    anTile('Fleet utilisation', anPct(cur.utilization), anDelta(cur.utilization, prev.utilization, true, true), `${cur.fleet} vehicles`),
    anTile('Revenue / vehicle / day', anMoney(cur.revPerVehicleDay), anDelta(cur.revPerVehicleDay, prev.revPerVehicleDay)),
    anTile('Excess reduction uptake', anPct(cur.excessUptake), anDelta(cur.excessUptake, prev.excessUptake, true, true)),
    anTile('Cancellation rate', anPct(cur.cancellationRate), anDelta(cur.cancellationRate, prev.cancellationRate, false, true))
  ].join('');

  const inP = anInPeriod(all, p.from, p.to, f);
  const done = inP.filter(anCounts);
  anLastExport = inP;

  // Já reservado à frente (só reservas reais): muda na hora quando entra uma reserva nova
  anRenderAhead(f);

  // Tendência: diária até 31 dias, semanal acima disso
  const step = p.days <= 31 ? FLEET_DAY_MS : 7 * FLEET_DAY_MS;
  const buckets = Math.ceil((p.to - p.from) / step);
  const trend = new Array(buckets).fill(0);
  done.forEach(r => { trend[Math.min(buckets - 1, Math.floor((r.start - p.from) / step))] += r.revenue; });
  const trendLabels = trend.map((_, i) => (step === FLEET_DAY_MS ? '' : 'Wk ') + anShortDate(p.from + i * step));
  anLine('trend', trendLabels, trend.map(v => Math.round(v)), v => anMoney(v));
  anSetTable('trend', [step === FLEET_DAY_MS ? 'Day' : 'Week starting', 'Revenue'], trend.map((v, i) => [anShortDate(p.from + i * step), anMoney(v)]));

  // Utilização por categoria
  const cats = FLEET_CATEGORIES.filter(c => f.section === 'ALL' || c.section === f.section);
  const util = cats.map(c => {
    const ff = { ...f, categoryId: c.id };
    const fleet = anFleetSize(ff);
    return { c, u: fleet ? Math.min(1, anBookedVehicleDays(all, p.from, p.to, ff) / (fleet * p.days)) : 0 };
  }).sort((a, b) => b.u - a.u);
  anBar('util', util.map(x => x.c.model), util.map(x => +(x.u * 100).toFixed(1)), { horizontal: true, fmt: v => v.toFixed(1) + '%', max: 100 });
  anSetTable('util', ['Category', 'Utilisation'], util.map(x => [x.c.name, anPct(x.u)]));
  document.getElementById('an-box-util').style.height = Math.max(260, util.length * 26 + 40) + 'px';

  // Origem das reservas
  const src = [...anGroupSum(done, r => r.source, () => 1)].sort((a, b) => b[1] - a[1]);
  anBar('source', src.map(s => s[0]), src.map(s => s[1]), { horizontal: true });
  anSetTable('source', ['Source', 'Bookings', 'Share'], src.map(s => [s[0], anNum(s[1]), anPct(s[1] / (done.length || 1))]));

  // Receita por filial
  const br = [...anGroupSum(done, r => r.branch, r => r.revenue)].sort((a, b) => b[1] - a[1]);
  anBar('branch', br.map(b => fleetBranchLabel(FLEET_BRANCHES[b[0]])), br.map(b => Math.round(b[1])), { horizontal: true, fmt: v => anMoney(v), axisFmt: v => anMoney(v, true) });
  anSetTable('branch', ['Branch', 'Revenue'], br.map(b => [fleetBranchLabel(FLEET_BRANCHES[b[0]]), anMoney(b[1])]));

  // Antecedência
  const leadLabels = ['Same day', '1–3 days', '4–7 days', '8–14 days', '15–30 days', '31+ days'];
  const leadIdx = d => d === 0 ? 0 : d <= 3 ? 1 : d <= 7 ? 2 : d <= 14 ? 3 : d <= 30 ? 4 : 5;
  const lead = new Array(6).fill(0);
  done.forEach(r => lead[leadIdx(r.leadDays)]++);
  anBar('lead', leadLabels, lead);
  anSetTable('lead', ['Lead time', 'Bookings'], lead.map((v, i) => [leadLabels[i], anNum(v)]));

  // Dia da semana
  const wd = new Array(7).fill(0);
  done.forEach(r => wd[(new Date(r.start).getDay() + 6) % 7]++);
  anBar('weekday', AN_WEEKDAYS, wd);
  anSetTable('weekday', ['Weekday', 'Pick-ups'], wd.map((v, i) => [AN_WEEKDAYS[i], anNum(v)]));

  // Duração
  const lenLabels = ['1 day', '2 days', '3 days', '4–7 days', '8+ days'];
  const len = new Array(5).fill(0);
  done.forEach(r => len[r.days <= 3 ? r.days - 1 : r.days <= 7 ? 3 : 4]++);
  anBar('length', lenLabels, len);
  anSetTable('length', ['Rental length', 'Bookings'], len.map((v, i) => [lenLabels[i], anNum(v)]));

  // Danos
  const dmg = [...anGroupSum(done.filter(r => r.damage), r => r.categoryId, r => r.damageCost)].sort((a, b) => b[1] - a[1]).slice(0, 8);
  anBar('damage', dmg.map(d => fleetGetCategory(d[0]).model), dmg.map(d => d[1]), { horizontal: true, fmt: v => anMoney(v), axisFmt: v => anMoney(v, true) });
  anSetTable('damage', ['Category', 'Damage cost', 'Incidents'], dmg.map(d => [fleetGetCategory(d[0]).name, anMoney(d[1]), anNum(done.filter(r => r.damage && r.categoryId === d[0]).length)]));

  // Payment plans (status → cor de status, com rótulo)
  anRenderPlansChart('plans');

  // Tabela por categoria
  anSortableTable('an-cat-table',
    ['Category', 'Bookings', 'Rental days', 'Revenue', 'Avg daily rate', 'Utilisation', 'Excess uptake', 'Damage rate'],
    cats.map(c => {
      const s = anSummary(all, p.from, p.to, { ...f, categoryId: c.id });
      return { cells: [
        { v: c.name, t: `<strong>${c.name}</strong><div class="an-sub">${c.model}</div>` },
        { v: s.bookings, t: anNum(s.bookings) }, { v: s.rentalDays, t: anNum(s.rentalDays) },
        { v: s.revenue, t: anMoney(s.revenue) }, { v: s.adr, t: anMoney(s.adr) },
        { v: s.utilization, t: anInlineBar(s.utilization, anPct(s.utilization)) },
        { v: s.excessUptake, t: anPct(s.excessUptake) }, { v: s.damageRate, t: anPct(s.damageRate) }
      ] };
    }), 3);

  // Tabela por filial
  anSortableTable('an-branch-table',
    ['Branch', 'Vehicles', 'Bookings', 'Revenue', 'vs previous', 'Utilisation', 'Revenue / vehicle / day', 'Damage cost'],
    Object.keys(FLEET_BRANCHES).filter(code => f.branch === 'ALL' || f.branch === code).map(code => {
      const s = anSummary(all, p.from, p.to, { ...f, branch: code });
      const sp = anSummary(all, p.prevFrom, p.prevTo, { ...f, branch: code });
      return { cells: [
        { v: code, t: `<strong>${fleetBranchLabel(FLEET_BRANCHES[code])}</strong>` },
        { v: s.fleet, t: anNum(s.fleet) }, { v: s.bookings, t: anNum(s.bookings) },
        { v: s.revenue, t: anMoney(s.revenue) }, { v: sp.revenue ? (s.revenue - sp.revenue) / sp.revenue : 0, t: anDelta(s.revenue, sp.revenue) },
        { v: s.utilization, t: anInlineBar(s.utilization, anPct(s.utilization)) },
        { v: s.revPerVehicleDay, t: anMoney(s.revPerVehicleDay) }, { v: s.damageCost, t: anMoney(s.damageCost) }
      ] };
    }), 3);
}

// "On the books": reservas confirmadas com retirada nos próximos 30 dias + o que entrou hoje
function anRenderAhead(f) {
  const el = document.getElementById('an-ahead');
  if (!el) return;
  const today0 = anStartOfDay(Date.now());
  const tomorrow = today0 + FLEET_DAY_MS;
  const live = anLiveRecords().filter(r => anMatches(r, f));
  const ahead = live.filter(r => anCounts(r) && r.start >= tomorrow && r.start < tomorrow + 30 * FLEET_DAY_MS);
  const waiting = live.filter(r => r.pending && r.end > Date.now());
  // Reservas criadas hoje (site, portal, Add Booking): o id é o momento da criação
  let today = 0;
  fleetForEachStoredBooking(list => list.forEach(b => { if (Number(b.id) >= today0 && b.status !== 'cancelled') today++; }));
  const rev = ahead.reduce((s, r) => s + r.revenue, 0);
  el.innerHTML = `
    <div class="an-ahead-main"><span>On the books · next 30 days</span><strong>${anMoney(rev, true)}</strong><small>${anNum(ahead.length)} confirmed pick-up${ahead.length === 1 ? '' : 's'} · live</small></div>
    <div><span>New bookings today</span><strong>${anNum(today)}</strong><small>Website, portal and agents</small></div>
    <div><span>Waiting for a vehicle</span><strong>${anNum(waiting.length)}</strong><small>Agent Requests and offers sent</small></div>
    <p>Revenue above is recognised on the pick-up day. A new booking shows here straight away and moves into revenue when the vehicle goes out.</p>`;
}

// A tela aberta acompanha reservas feitas em outra aba ou janela
function anRefreshIfVisible() {
  const a = document.getElementById('module-analytics');
  const e = document.getElementById('module-executive');
  if (a && a.dataset.ready && a.classList.contains('active')) renderAnalytics();
  if (e && e.dataset.ready && e.classList.contains('active')) renderExecutive();
}
window.addEventListener('focus', anRefreshIfVisible);
window.addEventListener('storage', ev => { if (ev.key && /^gc_(multi_bookings_|seed_overrides|booking_poc_)/.test(ev.key)) anRefreshIfVisible(); });

function anRenderPlansChart(id) {
  if (typeof ppLoad !== 'function') return;
  const groups = [
    { key: 'ok', label: 'On track', color: AN_STATUS.good, keys: ['ok', 'soon'] },
    { key: 'due', label: 'Due today', color: AN_STATUS.warning, keys: ['due'] },
    { key: 'overdue', label: 'Overdue', color: AN_STATUS.critical, keys: ['overdue'] },
    { key: 'paused', label: 'Paused', color: AN_STATUS.neutral, keys: ['paused'] }
  ];
  const plans = ppLoad().filter(pl => pl.status !== 'cancelled');
  const data = groups.map(g => plans.filter(pl => g.keys.includes(ppStatus(pl).key)).reduce((s, pl) => s + (pl.totalAmount - ppPaid(pl)), 0));
  anBar(id, groups.map(g => g.label), data.map(Math.round), { colors: groups.map(g => g.color), fmt: v => anMoney(v) });
  anSetTable(id, ['Status', 'Outstanding', 'Plans'], groups.map((g, i) => [g.label, anMoney(data[i]), anNum(plans.filter(pl => g.keys.includes(ppStatus(pl).key)).length)]));
}

function anExportCsv() {
  const headers = ['ref', 'pickup', 'return', 'days', 'category', 'fleet', 'branch', 'source', 'revenue_aud', 'excess_reduction', 'cancelled', 'damage', 'damage_cost_aud', 'lead_days', 'data_source'];
  const iso = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const lines = anLastExport.map(r => [
    r.ref, iso(r.start), iso(r.end), r.days, fleetGetCategory(r.categoryId).name, r.section, r.branch, r.source,
    r.revenue.toFixed(2), r.excessReduction ? 'yes' : 'no', r.cancelled ? 'yes' : 'no', r.damage ? 'yes' : 'no',
    r.damageCost, r.leadDays, r.live ? 'live' : 'simulated'
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([headers.join(',') + '\n' + lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gc-bookings-${anVal('an-f-period')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (typeof ppToast === 'function') ppToast(`Exported ${lines.length} bookings to CSV.`);
}

// ==========================================
// EXECUTIVE OVERVIEW (dono)
// ==========================================
function anExecutiveShell() {
  return `
    <div class="an-head">
      <div>
        <h2 id="ex-greeting">Executive Overview</h2>
        <p id="ex-date"></p>
      </div>
      <div class="an-head-actions">
        <button class="pp-btn ghost" onclick="anGoModule('module-analytics', 'Reports & Analytics')">Full analytics →</button>
      </div>
    </div>

    <div class="an-section-title first">Needs your attention</div>
    <div class="ex-attention" id="ex-attention"></div>

    <div class="an-section-title">Today · live from the Fleet Planner</div>
    <div class="an-tiles five" id="ex-today"></div>

    <div class="an-section-title">Money</div>
    <div class="an-tiles" id="ex-money"></div>

    <div class="an-grid">
      ${anCard('ex-monthly', 'Revenue by month', 'Last 12 months', true)}
      ${anCard('ex-branch', 'Revenue by branch', 'Last 30 days')}
      ${anCard('ex-plans', 'Payment plans — outstanding balance', 'Accident & damage repayments')}
    </div>

    <div class="an-section-title">Branch scoreboard · last 30 days</div>
    <div class="an-table-wrap" id="ex-branches"></div>

    <div class="an-section-title">Fleet recommendations · utilisation over the last 90 days</div>
    <div class="an-table-wrap" id="ex-fleet"></div>
    <p class="an-demo-note block">Revenue and utilisation include 12 months of simulated history for the prototype. "Today" figures come only from real bookings in the system.</p>`;
}

function anGoModule(moduleId, title) {
  const link = document.querySelector(`.menu-item[onclick*="${moduleId}"]`);
  switchModule(moduleId, link, title);
}

function renderExecutive() {
  const root = document.getElementById('module-executive');
  if (!root) return;
  if (!root.dataset.ready) { root.innerHTML = anExecutiveShell(); root.dataset.ready = '1'; }

  const now = Date.now();
  const today0 = anStartOfDay(now);
  const tomorrow = today0 + FLEET_DAY_MS;
  const profile = JSON.parse(localStorage.getItem('gc_agent_profile') || '{}');
  const hour = new Date().getHours();
  document.getElementById('ex-greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${(profile.name || 'there').split(' ')[0]}`;
  document.getElementById('ex-date').textContent = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · GC Tech Rentals';

  const live = anLiveRecords();
  const all = anAllRecords();
  const rentals = live.filter(r => anCounts(r) && r.type !== 'possible-ext');

  // ---------- Atenção ----------
  const items = [];
  const waiting = live.filter(r => r.type === 'on-request');
  if (waiting.length) items.push({ kind: 'serious', title: `${waiting.length} reservation${waiting.length > 1 ? 's' : ''} waiting for a vehicle`, detail: 'Customers are waiting for an allocation or an alternative offer.', action: `anGoModule('module-agent-requests', 'Agent Requests & Allocations')`, cta: 'Allocate' });
  // Reservas vencidas: ainda Reservation com retirada antes de hoje
  const stale = typeof fleetStaleReservations === 'function' ? fleetStaleReservations() : [];
  if (stale.length) items.push({ kind: 'serious', title: `${stale.length} reservation${stale.length > 1 ? 's' : ''} past the pick-up date`, detail: stale.slice(0, 3).map(r => `${r.ref} · ${r.customer} — ${fleetStaleLabel(r)}`).join(' — ') + '. Move to a new date or cancel.', action: `window.location.href='gc-daily-activity.html'`, cta: 'Resolve' });
  const overdueReturns = live.filter(r => r.type === 'hired' && r.end < now);
  if (overdueReturns.length) items.push({ kind: 'critical', title: `${overdueReturns.length} vehicle${overdueReturns.length > 1 ? 's' : ''} overdue for return`, detail: overdueReturns.slice(0, 3).map(r => `${r.plate} · ${r.name || r.ref}`).join(' — '), action: `window.location.href='gc-fleet-planner.html'`, cta: 'Open planner' });

  if (typeof ppLoad === 'function') {
    const overduePlans = ppLoad().filter(pl => ppStatus(pl).key === 'overdue');
    if (overduePlans.length) {
      const owed = overduePlans.reduce((s, pl) => s + pl.installments.filter(i => i.status !== 'paid' && (i.status === 'failed' || i.dueDate < ppToday())).reduce((a, i) => a + i.amount, 0), 0);
      items.push({ kind: 'critical', title: `${anMoney(owed)} in missed payment-plan instalments`, detail: `${overduePlans.length} customer${overduePlans.length > 1 ? 's' : ''}: ${overduePlans.map(pl => pl.customerName).join(', ')}`, action: `anGoModule('module-payments', 'Payment Plans')`, cta: 'Review' });
    }
  }
  let damage = [];
  try { damage = JSON.parse(localStorage.getItem('gc_damage_reports') || '[]').filter(d => d.status !== 'Closed'); } catch (e) {}
  if (damage.length) items.push({ kind: 'warning', title: `${damage.length} open damage report${damage.length > 1 ? 's' : ''}`, detail: damage.slice(0, 3).map(d => `${d.plate} (${d.status})`).join(' — '), action: `window.location.href='gc-damage-control.html'`, cta: 'Open' });
  let chats = [];
  try { chats = JSON.parse(localStorage.getItem('gc_chat_sessions') || '[]').filter(s => s.status === 'waiting'); } catch (e) {}
  if (chats.length) items.push({ kind: 'warning', title: `${chats.length} customer chat${chats.length > 1 ? 's' : ''} waiting for an agent`, detail: chats.slice(0, 3).map(s => s.customerName).join(', '), action: `anGoModule('module-livechat', 'Live Chat System'); renderLiveChatModule();`, cta: 'Open chat' });

  // Categorias sem nenhum carro livre em algum dia dos próximos 7
  const occ = fleetGetOccupancy();
  const soldOut = FLEET_CATEGORIES.map(c => {
    const plates = FLEET_VEHICLES.filter(v => v.categoryId === c.id).map(v => v.plate);
    const days = [];
    for (let d = 0; d < 7; d++) {
      const s = today0 + d * FLEET_DAY_MS, e = s + FLEET_DAY_MS;
      if (plates.every(pl => occ.some(o => o.plate === pl && fleetTimesClash(o.start, o.end, s, e, o.ref === 'POSS-EXT')))) days.push(anShortDate(s));
    }
    return { c, days };
  }).filter(x => x.days.length);
  soldOut.forEach(x => items.push({ kind: 'warning', title: `${x.c.name} fully booked`, detail: `No ${x.c.model} free on ${x.days.join(', ')} — new requests will need alternatives.`, action: `window.location.href='gc-fleet-planner.html'`, cta: 'View' }));

  const order = { critical: 0, serious: 1, warning: 2 };
  items.sort((a, b) => order[a.kind] - order[b.kind]);
  document.getElementById('ex-attention').innerHTML = items.length
    ? items.map(it => `
      <div class="ex-item ${it.kind}">
        ${anStatusChip(it.kind, it.kind === 'critical' ? 'Critical' : it.kind === 'serious' ? 'Action' : 'Watch')}
        <div class="ex-item-text"><strong>${it.title}</strong><span>${it.detail}</span></div>
        <button class="pp-btn small ghost" onclick="${it.action}">${it.cta}</button>
      </div>`).join('')
    : `<div class="ex-item good">${anStatusChip('good', 'All clear')}<div class="ex-item-text"><strong>Nothing needs your attention right now.</strong><span>No waiting allocations, overdue returns or missed payments.</span></div></div>`;

  // ---------- Hoje (planner) ----------
  const pickups = rentals.filter(r => r.start >= today0 && r.start < tomorrow);
  const returns = rentals.filter(r => r.end >= today0 && r.end < tomorrow);
  const onHire = rentals.filter(r => r.start <= now && r.end > now);
  const busyPlates = new Set(occ.filter(o => o.start <= now && o.end > now).map(o => o.plate));
  document.getElementById('ex-today').innerHTML = [
    anTile('Pick-ups today', anNum(pickups.length), '', pickups.slice(0, 2).map(r => r.name || r.ref).join(', ') || '—'),
    anTile('Returns today', anNum(returns.length), '', returns.slice(0, 2).map(r => r.name || r.ref).join(', ') || '—'),
    anTile('On hire now', anNum(onHire.length)),
    anTile('Available now', `${anNum(FLEET_VEHICLES.length - busyPlates.size)} / ${FLEET_VEHICLES.length}`, '', 'Includes maintenance holds'),
    anTile('Overdue returns', anNum(overdueReturns.length), overdueReturns.length ? anStatusChip('critical', 'Follow up') : anStatusChip('good', 'None'))
  ].join('');

  // ---------- Dinheiro ----------
  const monthStart = (() => { const d = new Date(today0); d.setDate(1); return d.getTime(); })();
  const lastMonthStart = (() => { const d = new Date(monthStart); d.setMonth(d.getMonth() - 1); return d.getTime(); })();
  const monthEnd = (() => { const d = new Date(monthStart); d.setMonth(d.getMonth() + 1); return d.getTime(); })();
  const mtd = anSummary(all, monthStart, tomorrow, {});
  const lastMtd = anSummary(all, lastMonthStart, lastMonthStart + (tomorrow - monthStart), {});
  const r30 = anSummary(all, tomorrow - 30 * FLEET_DAY_MS, tomorrow, {});
  const p30 = anSummary(all, tomorrow - 60 * FLEET_DAY_MS, tomorrow - 30 * FLEET_DAY_MS, {});
  const bookedAhead = live.filter(r => anCounts(r) && r.start >= tomorrow && r.start < monthEnd).reduce((s, r) => s + r.revenue, 0);
  let planOutstanding = 0, planCollected = 0;
  if (typeof ppLoad === 'function') {
    const monthPrefix = ppToday().slice(0, 7);
    ppLoad().filter(pl => pl.status !== 'cancelled').forEach(pl => {
      planOutstanding += pl.totalAmount - ppPaid(pl);
      planCollected += pl.installments.filter(i => i.status === 'paid' && i.paidAt && i.paidAt.slice(0, 7) === monthPrefix).reduce((s, i) => s + i.amount, 0);
    });
  }
  document.getElementById('ex-money').innerHTML = [
    anTile('Revenue month to date', anMoney(mtd.revenue, true), anDelta(mtd.revenue, lastMtd.revenue), 'vs same days last month'),
    anTile('Revenue last 30 days', anMoney(r30.revenue, true), anDelta(r30.revenue, p30.revenue), `${anNum(r30.bookings)} bookings`),
    anTile('Booked for rest of month', anMoney(bookedAhead, true), '', 'Confirmed future pick-ups'),
    anTile('Fleet utilisation (30 days)', anPct(r30.utilization), anDelta(r30.utilization, p30.utilization, true, true)),
    anTile('Payment plans outstanding', anMoney(planOutstanding, true), '', `${anMoney(planCollected)} collected this month`)
  ].join('');

  // ---------- Gráficos ----------
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(monthStart); d.setMonth(d.getMonth() - i);
    const s = d.getTime(); const e = new Date(d); e.setMonth(e.getMonth() + 1);
    months.push({ label: `${FLEET_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}${i === 0 ? ' (MTD)' : ''}`, revenue: anSummary(all, s, Math.min(e.getTime(), tomorrow), {}).revenue });
  }
  anBar('ex-monthly', months.map(m => m.label), months.map(m => Math.round(m.revenue)), { fmt: v => anMoney(v), axisFmt: v => anMoney(v, true) });
  anSetTable('ex-monthly', ['Month', 'Revenue'], months.map(m => [m.label, anMoney(m.revenue)]));

  const br = Object.keys(FLEET_BRANCHES).map(code => ({ code, s: anSummary(all, tomorrow - 30 * FLEET_DAY_MS, tomorrow, { branch: code }), p: anSummary(all, tomorrow - 60 * FLEET_DAY_MS, tomorrow - 30 * FLEET_DAY_MS, { branch: code }) }))
    .sort((a, b) => b.s.revenue - a.s.revenue);
  anBar('ex-branch', br.map(b => fleetBranchLabel(FLEET_BRANCHES[b.code])), br.map(b => Math.round(b.s.revenue)), { horizontal: true, fmt: v => anMoney(v), axisFmt: v => anMoney(v, true) });
  anSetTable('ex-branch', ['Branch', 'Revenue'], br.map(b => [fleetBranchLabel(FLEET_BRANCHES[b.code]), anMoney(b.s.revenue)]));
  anRenderPlansChart('ex-plans');

  // ---------- Placar das filiais ----------
  const topRevenue = Math.max(...br.map(b => b.s.revenue), 1);
  anSortableTable('ex-branches',
    ['Branch', 'Revenue', 'vs previous 30 days', 'Bookings', 'Utilisation', 'Avg daily rate', 'Damage incidents'],
    br.map(b => ({ cells: [
      { v: b.code, t: `<strong>${fleetBranchLabel(FLEET_BRANCHES[b.code])}</strong>` },
      { v: b.s.revenue, t: anInlineBar(b.s.revenue / topRevenue, anMoney(b.s.revenue)) },
      { v: b.p.revenue ? (b.s.revenue - b.p.revenue) / b.p.revenue : 0, t: anDelta(b.s.revenue, b.p.revenue) },
      { v: b.s.bookings, t: anNum(b.s.bookings) },
      { v: b.s.utilization, t: anPct(b.s.utilization) },
      { v: b.s.adr, t: anMoney(b.s.adr) },
      { v: Math.round(b.s.damageRate * b.s.bookings), t: anNum(Math.round(b.s.damageRate * b.s.bookings)) }
    ] })), 1);

  // ---------- Recomendações de frota ----------
  const from90 = tomorrow - 90 * FLEET_DAY_MS;
  anSortableTable('ex-fleet',
    ['Category', 'Vehicles', 'Utilisation', 'Revenue (90 days)', 'Revenue / vehicle / day', 'Recommendation'],
    FLEET_CATEGORIES.map(c => {
      const s = anSummary(all, from90, tomorrow, { categoryId: c.id });
      const rec = s.utilization >= 0.85 ? anStatusChip('warning', 'High demand — consider adding vehicles')
                : s.utilization < 0.4 ? anStatusChip('serious', 'Under-used — review fleet size or promote')
                : anStatusChip('good', 'Healthy');
      return { cells: [
        { v: c.name, t: `<strong>${c.name}</strong><div class="an-sub">${c.model}</div>` },
        { v: s.fleet, t: anNum(s.fleet) },
        { v: s.utilization, t: anInlineBar(s.utilization, anPct(s.utilization)) },
        { v: s.revenue, t: anMoney(s.revenue) },
        { v: s.revPerVehicleDay, t: anMoney(s.revPerVehicleDay) },
        { v: s.utilization, t: rec }
      ] };
    }), 2);
}
