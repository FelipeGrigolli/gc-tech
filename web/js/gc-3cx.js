// ==========================================
// 3CX CALLS — painel de ligações (Agent Dashboard → 3CX Calls)
// ⚠️ DADOS SIMULADOS: ainda não está conectado ao 3CX. O histórico de 30 dias é gerado
// de forma DETERMINÍSTICA (sempre igual para o mesmo dia) e relativo a hoje.
// Os números de clientes são os mesmos do Daily Activity (celular de exemplo por reserva),
// então uma ligação de cliente mostra a reserva dele.
// Na versão real: 3CX Configuration API (histórico de chamadas) + Call Control API
// (chamada em tempo real), via um pequeno serviço conector.
// Depende de: gc-fleet-data.js, gc-ui.js, Chart.js
// ==========================================

const CX_CALLBACKS_KEY = 'gc_3cx_callbacks';   // { callId: { by, at } } retornos marcados pelo agente
const CX_AGENTS = [
  { ext: '101', name: 'Felipe Grigolli', weight: 5 },
  { ext: '102', name: 'Alex', weight: 3 },
  { ext: '201', name: 'Mascot desk', weight: 4 },
  { ext: '301', name: 'Eagle Farm desk', weight: 3 }
];
const CX_QUEUES = { SYD: 'Bookings · Sydney', BNE: 'Bookings · Brisbane' };
const CX_HOUR_WEIGHTS = { 7: 2, 8: 12, 9: 13, 10: 10, 11: 8, 12: 6, 13: 7, 14: 8, 15: 10, 16: 11, 17: 5 };

let cxPeriod = 'today';
let cxLogFilter = { text: '', result: 'all' };
let cxChart = null;
let cxCache = null;   // { dayKey, calls, contacts }

// ---------- Helpers ----------
function cxEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cxPad(n) { return String(n).padStart(2, '0'); }
function cxDigits(s) { return String(s || '').replace(/\D/g, ''); }
function cxTime(ms) { const d = new Date(ms); return `${cxPad(d.getHours())}:${cxPad(d.getMinutes())}`; }
function cxDay(ms) { const d = new Date(ms); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${FLEET_MONTHS[d.getMonth()]}`; }
function cxDur(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${cxPad(s)}s` : `${s}s`;
}
function cxIso(ms) { const d = new Date(ms); return `${d.getFullYear()}-${cxPad(d.getMonth() + 1)}-${cxPad(d.getDate())}`; }

// Mesmo celular de exemplo do Daily Activity (por referência da reserva)
function cxDemoMobile(ref) {
  const h = fleetHash('mobile:' + ref);
  return `04${cxPad(h % 100)} ${String(100 + (h >>> 7) % 900)} ${String(100 + (h >>> 17) % 900)}`;
}

function cxRand(seedText) {
  let s = fleetHash(seedText) || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function cxPickWeighted(rand, items, weightOf) {
  const total = items.reduce((t, x) => t + weightOf(x), 0);
  let r = rand() * total;
  for (const x of items) { if ((r -= weightOf(x)) < 0) return x; }
  return items[items.length - 1];
}

function cxReadCallbacks() {
  try { return JSON.parse(localStorage.getItem(CX_CALLBACKS_KEY)) || {}; } catch (e) { return {}; }
}

// ---------- Contatos: clientes com reserva (telefone → cliente) ----------
function cxContacts() {
  const map = new Map();
  const add = (phone, c) => { const k = cxDigits(phone); if (k.length >= 8 && !map.has(k)) map.set(k, { phone, ...c }); };
  fleetSeedBookings().forEach(s => {
    if (s.type === 'maintenance') return;
    const v = fleetGetVehicle(s.plate);
    add(cxDemoMobile(s.ref), { name: `${s.fname} ${s.lname}`, email: s.clientEmail, ref: s.ref, start: s.startMs, branch: v ? v.branch : 'MAS' });
  });
  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    if (!b.phone) return;
    const r = fleetBookingRange(b);
    add(b.phone, { name: `${b.fname || ''} ${b.lname || ''}`.trim() || email, email, ref: b.ref, start: r.start, branch: Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === b.loc) || 'MAS' });
  }));
  return map;
}

// ---------- Histórico simulado (30 dias, determinístico) ----------
function cxBuildCalls() {
  const today0 = fleetStartOfToday();
  const now = Date.now();
  const dayKey = cxIso(today0) + '|' + Math.floor(now / 600000); // recalcula a cada 10 min (chamadas de hoje avançam)
  if (cxCache && cxCache.dayKey === dayKey) return cxCache;

  const contacts = cxContacts();
  const contactList = Array.from(contacts.values());
  const calls = [];

  for (let back = 29; back >= 0; back--) {
    const day0 = fleetShiftMs(today0, -back);
    const date = new Date(day0);
    const dow = date.getDay();
    const rand = cxRand('3cx-day-' + cxIso(day0));
    const base = dow === 0 ? 14 : dow === 6 ? 34 : 62;
    const count = Math.round(base * (0.85 + rand() * 0.3));
    const dayCalls = [];

    for (let i = 0; i < count; i++) {
      const hour = Number(cxPickWeighted(rand, Object.keys(CX_HOUR_WEIGHTS), h => CX_HOUR_WEIGHTS[h]));
      const t = day0 + hour * 3600000 + Math.floor(rand() * 60) * 60000 + Math.floor(rand() * 60) * 1000;
      const known = rand() < 0.55 && contactList.length;
      const contact = known ? contactList[Math.floor(rand() * contactList.length)] : null;
      const number = contact ? contact.phone
        : (rand() < 0.6 ? `04${cxPad(Math.floor(rand() * 100))} ${100 + Math.floor(rand() * 900)} ${100 + Math.floor(rand() * 900)}`
                        : `(0${rand() < 0.7 ? 2 : 7}) ${1000 + Math.floor(rand() * 9000)} ${1000 + Math.floor(rand() * 9000)}`);
      const branchCode = contact ? contact.branch : (number.startsWith('(07)') ? 'EGF' : 'MAS');
      const queue = ['EGF', 'WGB'].includes(branchCode) ? CX_QUEUES.BNE : CX_QUEUES.SYD;
      const outbound = rand() < 0.18;
      const peak = [8, 9, 16].includes(hour);
      const call = { id: `${cxIso(day0)}-${i}`, t, number, digits: cxDigits(number), contact, queue, direction: outbound ? 'out' : 'in' };

      if (outbound) {
        call.agent = cxPickWeighted(rand, CX_AGENTS, a => a.weight);
        call.result = rand() < 0.85 ? 'answered' : 'noanswer';
        call.wait = 0;
        call.talk = call.result === 'answered' ? 30 + Math.floor(Math.pow(rand(), 1.8) * 420) : 0;
      } else {
        const missed = rand() < (peak ? 0.2 : 0.09);
        call.wait = missed ? 20 + Math.floor(rand() * 70) : 4 + Math.floor(Math.pow(rand(), 2) * 55);
        if (missed) {
          call.result = rand() < 0.3 ? 'voicemail' : 'missed';
          call.talk = call.result === 'voicemail' ? 15 + Math.floor(rand() * 40) : 0;
        } else {
          call.agent = cxPickWeighted(rand, CX_AGENTS, a => a.weight);
          call.result = 'answered';
          call.talk = 35 + Math.floor(Math.pow(rand(), 1.7) * 540);
        }
      }
      dayCalls.push(call);
    }

    // Retornos: a maioria das perdidas recebe ligação de volta 10–150 min depois
    dayCalls.filter(c => c.direction === 'in' && c.result !== 'answered').forEach((c, idx) => {
      if (rand() < 0.72) {
        const t = c.t + (10 + Math.floor(rand() * 140)) * 60000;
        const agent = cxPickWeighted(rand, CX_AGENTS, a => a.weight);
        dayCalls.push({ id: `${c.id}-cb${idx}`, t, number: c.number, digits: c.digits, contact: c.contact, queue: c.queue, direction: 'out',
                        agent, result: 'answered', wait: 0, talk: 40 + Math.floor(rand() * 240), callbackFor: c.id });
        c.returnedAt = t;
        c.returnedBy = agent.name;
      }
    });

    dayCalls.forEach(c => { if (c.t <= now) calls.push(c); });
  }

  // Retorno só conta se já aconteceu
  calls.forEach(c => { if (c.returnedAt && c.returnedAt > now) { delete c.returnedAt; delete c.returnedBy; } });
  calls.sort((a, b) => b.t - a.t);
  cxCache = { dayKey, calls, contacts };
  return cxCache;
}

// ---------- Período ----------
function cxRange() {
  const today0 = fleetStartOfToday();
  if (cxPeriod === 'yesterday') return { from: fleetShiftMs(today0, -1), to: today0, label: 'Yesterday' };
  if (cxPeriod === '7d') return { from: fleetShiftMs(today0, -6), to: fleetShiftMs(today0, 1), label: 'Last 7 days' };
  if (cxPeriod === '30d') return { from: fleetShiftMs(today0, -29), to: fleetShiftMs(today0, 1), label: 'Last 30 days' };
  return { from: today0, to: fleetShiftMs(today0, 1), label: 'Today' };
}

function cxIsMissed(c) { return c.direction === 'in' && c.result !== 'answered'; }

function cxCallbackState(c, marks) {
  if (!cxIsMissed(c)) return null;
  if (marks[c.id]) return { done: true, by: marks[c.id].by, at: marks[c.id].at };
  if (c.returnedAt) return { done: true, by: c.returnedBy, at: c.returnedAt };
  return { done: false };
}

// ---------- Estrutura ----------
function cxShell() {
  return `
    <div class="cx-head">
      <div>
        <h2>3CX · Calls</h2>
        <p>Answered and missed calls, who needs a call back and how the team is doing.</p>
      </div>
      <div class="cx-periods" id="cx-periods">
        ${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days']].map(([k, l]) =>
          `<button type="button" data-period="${k}" onclick="cxSetPeriod('${k}')">${l}</button>`).join('')}
      </div>
    </div>

    <div class="cx-status">
      <span class="cx-pill">Demo data</span>
      <span><strong>Not connected to 3CX yet.</strong> Live data needs 3CX API access (8SC+ licence) and a small connector service.
      Missed mobile calls can be followed up on <strong>WhatsApp</strong>, which the company now has through 3CX.</span>
    </div>

    <div class="cx-kpis" id="cx-kpis"></div>

    <div class="cx-grid">
      <section class="cx-card">
        <div class="cx-card-head"><h3>Calls by hour</h3><span id="cx-chart-sub"></span></div>
        <div class="cx-chart-box"><canvas id="cx-chart"></canvas></div>
      </section>
      <section class="cx-card">
        <div class="cx-card-head"><h3>Missed calls to return</h3><span id="cx-cb-count"></span></div>
        <div id="cx-callbacks" class="cx-callbacks"></div>
      </section>
    </div>

    <section class="cx-card">
      <div class="cx-card-head"><h3>By agent</h3><span id="cx-agent-sub"></span></div>
      <div class="cx-table-wrap"><table class="cx-table" id="cx-agents"></table></div>
    </section>

    <section class="cx-card">
      <div class="cx-card-head">
        <h3>Call log</h3>
        <div class="cx-log-tools">
          <select onchange="cxLogFilter.result = this.value; cxRenderLog();">
            <option value="all">All calls</option>
            <option value="answered">Answered</option>
            <option value="missed">Missed &amp; voicemail</option>
            <option value="out">Outbound</option>
          </select>
          <input type="text" placeholder="Number, customer or agent…" oninput="cxLogFilter.text = this.value; cxRenderLog();">
        </div>
      </div>
      <div class="cx-table-wrap"><table class="cx-table" id="cx-log"></table></div>
      <div class="cx-count" id="cx-log-count"></div>
    </section>`;
}

function cxSetPeriod(p) {
  cxPeriod = p;
  render3cxModule();
}

// ---------- Render ----------
function render3cxModule() {
  const root = document.getElementById('module-3cx');
  if (!root) return;
  if (!root.dataset.ready) { root.innerHTML = cxShell(); root.dataset.ready = '1'; }
  document.querySelectorAll('#cx-periods button').forEach(b => b.classList.toggle('active', b.dataset.period === cxPeriod));

  const { calls } = cxBuildCalls();
  const { from, to, label } = cxRange();
  const inPeriod = calls.filter(c => c.t >= from && c.t < to);
  const marks = cxReadCallbacks();

  cxRenderKpis(inPeriod, marks, label);
  cxRenderChart(inPeriod, label);
  cxRenderCallbacks(calls, marks);
  cxRenderAgents(inPeriod, label);
  cxRenderLog();
}

function cxRenderKpis(list, marks, label) {
  const inbound = list.filter(c => c.direction === 'in');
  const answered = inbound.filter(c => c.result === 'answered');
  const missed = inbound.filter(c => c.result !== 'answered');
  const outbound = list.filter(c => c.direction === 'out');
  const pending = missed.filter(c => !cxCallbackState(c, marks).done);
  const avg = (arr, f) => arr.length ? Math.round(arr.reduce((t, x) => t + f(x), 0) / arr.length) : 0;
  const rate = inbound.length ? Math.round(answered.length / inbound.length * 100) : 0;

  const tiles = [
    { label: 'Incoming calls', value: inbound.length, sub: label },
    { label: 'Answered', value: answered.length, sub: `${rate}% answer rate`, cls: 'good' },
    { label: 'Missed', value: missed.length, sub: `${missed.filter(c => c.result === 'voicemail').length} left a voicemail`, cls: missed.length ? 'bad' : '' },
    { label: 'Still to call back', value: pending.length, sub: pending.length ? 'Missed, not returned yet' : 'All returned', cls: pending.length ? 'warn' : 'good' },
    { label: 'Avg wait to answer', value: cxDur(avg(answered, c => c.wait)), sub: 'Answered calls' },
    { label: 'Avg call length', value: cxDur(avg(list.filter(c => c.talk), c => c.talk)), sub: `${outbound.length} outbound call${outbound.length === 1 ? '' : 's'}` }
  ];
  document.getElementById('cx-kpis').innerHTML = tiles.map(t => `
    <div class="cx-kpi ${t.cls || ''}"><span>${t.label}</span><strong>${t.value}</strong><small>${t.sub}</small></div>`).join('');
}

function cxRenderChart(list, label) {
  const hours = Object.keys(CX_HOUR_WEIGHTS).map(Number);
  const answered = hours.map(h => list.filter(c => c.direction === 'in' && c.result === 'answered' && new Date(c.t).getHours() === h).length);
  const missed = hours.map(h => list.filter(c => cxIsMissed(c) && new Date(c.t).getHours() === h).length);
  document.getElementById('cx-chart-sub').textContent = `${label} · incoming calls`;
  const canvas = document.getElementById('cx-chart');
  if (cxChart) cxChart.destroy();
  if (typeof Chart === 'undefined') return;
  cxChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: hours.map(h => `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`),
      datasets: [
        { label: 'Answered', data: answered, backgroundColor: '#3b82f6', borderRadius: 3, stack: 'calls' },
        { label: 'Missed', data: missed, backgroundColor: '#ef4444', borderRadius: 3, stack: 'calls' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 12 } }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(148, 163, 184, .12)' } }
      }
    }
  });
}

// Perdidas ainda sem retorno (últimos 7 dias), mais recentes primeiro
function cxRenderCallbacks(calls, marks) {
  const from = fleetShiftMs(fleetStartOfToday(), -6);
  const pending = calls.filter(c => c.t >= from && cxIsMissed(c) && !cxCallbackState(c, marks).done).slice(0, 12);
  document.getElementById('cx-cb-count').textContent = pending.length ? `${pending.length} waiting · last 7 days` : 'Nothing waiting';
  document.getElementById('cx-callbacks').innerHTML = pending.length
    ? pending.map(c => `
      <div class="cx-cb">
        <div class="cx-cb-main">
          <strong>${cxEsc(c.contact ? c.contact.name : c.number)}</strong>
          <span>${cxEsc(c.contact ? c.number : 'Unknown number')} · ${cxEsc(c.queue)}</span>
          ${c.contact ? `<span class="cx-link-row">Booking <button type="button" class="cx-link" onclick="cxOpenCustomer('${cxEsc(c.contact.email)}')">${cxEsc(c.contact.ref)}</button> · pick-up ${cxDay(c.contact.start)}</span>` : ''}
        </div>
        <div class="cx-cb-side">
          <span class="cx-when">${cxDay(c.t)} ${cxTime(c.t)}</span>
          <span class="cx-badge ${c.result}">${c.result === 'voicemail' ? 'Voicemail' : 'Missed'}</span>
          ${typeof waCompose === 'function' && /^04/.test(c.number) ? `<button type="button" class="wa-inline-btn" title="Send a WhatsApp instead of calling back" onclick="cxWhatsApp('${cxEsc(c.id)}')">${waIcon(13)} WhatsApp</button>` : ''}
          <button type="button" class="pp-btn small" onclick="cxMarkCalledBack('${cxEsc(c.id)}')">Called back</button>
        </div>
      </div>`).join('')
    : '<p class="cx-empty">No missed calls waiting for a call back.</p>';
}

function cxRenderAgents(list, label) {
  document.getElementById('cx-agent-sub').textContent = label;
  const rows = CX_AGENTS.map(a => {
    const mine = list.filter(c => c.agent && c.agent.ext === a.ext);
    const answered = mine.filter(c => c.direction === 'in');
    const out = mine.filter(c => c.direction === 'out');
    const talk = mine.reduce((t, c) => t + (c.talk || 0), 0);
    return { a, answered: answered.length, out: out.length, talk, avg: mine.length ? Math.round(talk / mine.length) : 0 };
  }).sort((x, y) => y.answered - x.answered);
  document.getElementById('cx-agents').innerHTML = `
    <thead><tr><th>Agent</th><th>Ext.</th><th class="r">Answered</th><th class="r">Outbound</th><th class="r">Talk time</th><th class="r">Avg call</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr><td><strong>${cxEsc(r.a.name)}</strong></td><td>${r.a.ext}</td><td class="r">${r.answered}</td><td class="r">${r.out}</td>
          <td class="r">${cxDur(r.talk)}</td><td class="r">${cxDur(r.avg)}</td></tr>`).join('')}</tbody>`;
}

function cxRenderLog() {
  const table = document.getElementById('cx-log');
  if (!table) return;
  const { calls } = cxBuildCalls();
  const { from, to } = cxRange();
  const marks = cxReadCallbacks();
  const term = cxLogFilter.text.trim().toLowerCase();
  const termDigits = cxDigits(term);
  const list = calls.filter(c => c.t >= from && c.t < to).filter(c => {
    if (cxLogFilter.result === 'answered' && !(c.direction === 'in' && c.result === 'answered')) return false;
    if (cxLogFilter.result === 'missed' && !cxIsMissed(c)) return false;
    if (cxLogFilter.result === 'out' && c.direction !== 'out') return false;
    if (!term) return true;
    return (termDigits.length >= 3 && c.digits.includes(termDigits)) ||
      [c.contact && c.contact.name, c.contact && c.contact.ref, c.agent && c.agent.name, c.queue].join(' ').toLowerCase().includes(term);
  });
  const shown = list.slice(0, 150);
  table.innerHTML = `
    <thead><tr><th></th><th>Time</th><th>Number</th><th>Customer</th><th>Queue</th><th>Agent</th><th class="r">Wait</th><th class="r">Duration</th><th>Result</th></tr></thead>
    <tbody>${shown.map(c => {
      const cb = cxCallbackState(c, marks);
      const result = c.direction === 'out' ? (c.result === 'answered' ? 'Outbound' : 'No answer') : (c.result === 'answered' ? 'Answered' : c.result === 'voicemail' ? 'Voicemail' : 'Missed');
      return `<tr>
        <td class="cx-dir ${c.direction}" title="${c.direction === 'in' ? 'Incoming' : 'Outgoing'}">${c.direction === 'in' ? '↙' : '↗'}</td>
        <td class="nw">${cxDay(c.t)} ${cxTime(c.t)}</td>
        <td class="nw">${cxEsc(c.number)}</td>
        <td>${c.contact ? `<button type="button" class="cx-link" onclick="cxOpenCustomer('${cxEsc(c.contact.email)}')">${cxEsc(c.contact.name)}</button><small>${cxEsc(c.contact.ref)}</small>` : '<span class="cx-muted">Unknown</span>'}</td>
        <td class="cx-muted">${cxEsc(c.queue)}</td>
        <td>${c.agent ? cxEsc(c.agent.name) : '<span class="cx-muted">—</span>'}</td>
        <td class="r">${c.direction === 'in' ? cxDur(c.wait) : '—'}</td>
        <td class="r">${cxDur(c.talk)}</td>
        <td><span class="cx-badge ${c.direction === 'out' ? 'out' : c.result}">${result}</span>${cb ? (cb.done ? `<small class="cx-ok">Returned by ${cxEsc(cb.by)}</small>` : '<small class="cx-warn">Not returned</small>') : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="cx-empty">No calls match.</td></tr>'}</tbody>`;
  document.getElementById('cx-log-count').textContent = `Showing ${shown.length} of ${list.length} calls`;
}

// ---------- Ações ----------
function cxMarkCalledBack(id) {
  const marks = cxReadCallbacks();
  const agent = (typeof getAgentName === 'function' ? getAgentName() : localStorage.getItem('gc_agent_name')) || 'Agent';
  marks[id] = { by: agent, at: Date.now() };
  localStorage.setItem(CX_CALLBACKS_KEY, JSON.stringify(marks));
  gcToast('Marked as called back.');
  render3cxModule();
}

// Chamada perdida → WhatsApp pelo 3CX (modelo "Missed call follow-up"); conta como retorno
function cxWhatsApp(id) {
  const c = cxBuildCalls().calls.find(x => x.id === id);
  if (!c) return;
  const first = c.contact ? c.contact.name.split(' ')[0] : '';
  waCompose({
    phone: c.number, template: 'missed_call', title: 'Missed call · WhatsApp follow-up',
    vars: { name: first, callTime: `${cxTime(c.t)}${cxDay(c.t) !== cxDay(Date.now()) ? ' on ' + cxDay(c.t) : ''}` },
    onSent: () => {
      const marks = cxReadCallbacks();
      const agent = (typeof getAgentName === 'function' ? getAgentName() : localStorage.getItem('gc_agent_name')) || 'Agent';
      marks[id] = { by: agent + ' (WhatsApp)', at: Date.now() };
      localStorage.setItem(CX_CALLBACKS_KEY, JSON.stringify(marks));
      render3cxModule();
    }
  });
}

function cxOpenCustomer(email) {
  window.location.href = 'gc-customers.html?search=' + encodeURIComponent(email);
}

// Retornos pendentes de hoje (usado no Quick Menu do Dashboard)
function cxPendingCallbacksToday() {
  const { calls } = cxBuildCalls();
  const today0 = fleetStartOfToday();
  const marks = cxReadCallbacks();
  return calls.filter(c => c.t >= today0 && cxIsMissed(c) && !cxCallbackState(c, marks).done).length;
}
