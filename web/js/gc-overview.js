// ==========================================
// TODAY'S OVERVIEW — painel inicial no estilo do RCM (Agent Dashboard → Dashboard)
// Painéis: Quick Menu, Message Board, To Do List, Registration/Inspection Expiry,
// Daily Activity, Maintenance Due, My RCM e Fleet Right Now.
//
// Dados reais do protótipo: reservas (anLiveRecords em gc-analytics-data.js),
// ocupação da frota (fleetGetOccupancy), chats, alocações pendentes e planos.
// Vencimentos de registro/inspeção e manutenção não existem no protótipo: são
// gerados de forma DETERMINÍSTICA a partir da placa (sempre os mesmos por placa),
// relativos ao dia de hoje.
// Depende de: gc-fleet-data.js, gc-analytics-data.js, gc-chat.js, gc-payments.js
// ==========================================

const OV_TODO_KEY = 'gc_todo_items';
const OV_COLLAPSED_KEY = 'gc_overview_collapsed';
const OV_OPEN_HOUR = 8, OV_CLOSE_HOUR = 17;

let ovDayOffset = 0;          // Daily Activity: 0 = hoje, -1 = ontem, +1 = amanhã
let ovTodoShowAll = false;    // To Do List: só abertos ou todos
const ovFilters = { activity: 'ALL', expiry: 'ALL', maintenance: 'ALL' };

// ---------- Helpers ----------
function ovEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ovStartOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function ovAddDays(ms, n) {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function ovDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}-${FLEET_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function ovReadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}

// Número pseudoaleatório estável por texto (placa + tipo)
function ovHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

function ovBranchOptions(selected) {
  return '<option value="ALL">All Locations</option>' +
    Object.entries(FLEET_BRANCHES).map(([code, name]) =>
      `<option value="${code}" ${code === selected ? 'selected' : ''}>${fleetBranchLabel(name)}</option>`).join('');
}

function ovMenuAccessible(moduleId) {
  const link = document.querySelector(`.menu-item[onclick*="${moduleId}"]`);
  return !!link && !link.hidden;
}

function ovGo(moduleId, title) {
  // Vários itens usam module-placeholder: escolhe o do mesmo título para marcar o menu certo
  const links = Array.from(document.querySelectorAll(`.menu-item[onclick*="${moduleId}"]`));
  const link = links.find(a => (a.getAttribute('onclick') || '').includes(`'${title}'`)) || links[0] || null;
  switchModule(moduleId, link, title);
}

function ovGoUpcoming() {
  ovGo('module-agent-requests', 'Agent Requests & Allocations');
  switchAgentTab('upcoming');
}

// ---------- Ícones ----------
const OV_ICONS = {
  planner: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7"/>',
  plus: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 12v6M9 15h6"/>',
  car: '<path d="M5 17h14M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4h-2M3 13v4h2m-2-4h18"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-5-6.7"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  refund: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.7c0 2.6-5 1.4-5 4 0 1.1 1 1.8 2.5 1.8s2.5-.6 2.5-1.5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'
};

function ovIcon(name, size) {
  return `<svg width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${OV_ICONS[name] || ''}</svg>`;
}

// ---------- Estrutura (montada uma vez) ----------
function ovPanel(id, title, color, bodyHtml) {
  const collapsed = ovReadJSON(OV_COLLAPSED_KEY, []).includes(id);
  return `
    <section class="ov-panel ${collapsed ? 'collapsed' : ''}" id="ov-panel-${id}" style="--ov-accent: ${color};">
      <header class="ov-panel-head">
        <span>${title}</span>
        <button type="button" class="ov-collapse" title="Minimise" onclick="ovToggle('${id}')">–</button>
      </header>
      <div class="ov-panel-body">${bodyHtml}</div>
    </section>`;
}

function ovShell() {
  const nav = [
    { icon: 'planner', label: 'Reservations', action: "window.location.href='gc-fleet-planner.html'" },
    { icon: 'chart', label: 'Reports', action: "ovGo('module-analytics', 'Reports & Analytics')", module: 'module-analytics' },
    { icon: 'wrench', label: 'Vehicle Maintenance', action: "ovGo('module-placeholder', 'Maintenance Schedules')" },
    { icon: 'gear', label: 'System Setup', action: "ovGo('module-placeholder', 'System Settings')" }
  ];

  return `
    <nav class="ov-topnav" id="ov-topnav">
      ${nav.map(n => `<button type="button" class="ov-topnav-item" ${n.module ? `data-module="${n.module}"` : ''} onclick="${n.action}">${ovIcon(n.icon, 22)}<span>${n.label}</span></button>`).join('')}
    </nav>

    <div id="ov-stale"></div>

    <div class="ov-grid">
      <div class="ov-col">
        ${ovPanel('quick', 'Quick Menu', '#8b5cf6', '<div class="ov-quick" id="ov-quick"></div>')}
      </div>

      <div class="ov-col">
        ${ovPanel('messages', 'Message Board', '#ef4444', '<div id="ov-messages"></div>')}
        ${ovPanel('todo', 'To Do List', '#64748b', `
          <form class="ov-todo-form" onsubmit="ovAddTodo(event)">
            <input type="text" id="ov-todo-input" placeholder="New to do item…" maxlength="140">
            <button type="submit" class="pp-btn small">Create To Do Item</button>
          </form>
          <div class="ov-todo-toggle">
            <button type="button" id="ov-todo-open" onclick="ovSetTodoView(false)">Open</button>
            <button type="button" id="ov-todo-all" onclick="ovSetTodoView(true)">All Items</button>
          </div>
          <ul class="ov-todo-list" id="ov-todo-list"></ul>`)}
        ${ovPanel('expiry', 'Registration / Inspection Expiry', '#d97706', `
          <select class="ov-select" onchange="ovFilters.expiry = this.value; ovRenderExpiry();">${ovBranchOptions('ALL')}</select>
          <div id="ov-expiry"></div>`)}
      </div>

      <div class="ov-col">
        ${ovPanel('activity', 'Daily Activity', '#3b82f6', `
          <select class="ov-select" onchange="ovFilters.activity = this.value; ovRenderActivity();">${ovBranchOptions('ALL')}</select>
          <div class="ov-daynav">
            <button type="button" onclick="ovShiftDay(-1)" title="Previous day">&laquo;</button>
            <button type="button" onclick="ovShiftDay(0)" id="ov-day-label">Today</button>
            <button type="button" onclick="ovShiftDay(1)" title="Next day">&raquo;</button>
          </div>
          <div id="ov-activity"></div>`)}
        ${ovPanel('maintenance', 'Maintenance Due', '#10b981', `
          <select class="ov-select" onchange="ovFilters.maintenance = this.value; ovRenderMaintenance();">${ovBranchOptions('ALL')}</select>
          <div id="ov-maintenance"></div>`)}
      </div>

      <div class="ov-col">
        ${ovPanel('myrcm', 'My RCM', '#FF5E00', '<div id="ov-myrcm"></div>')}
        ${ovPanel('fleet', 'Fleet Right Now', '#0ea5e9', '<div id="ov-fleet"></div>')}
      </div>
    </div>`;
}

function ovToggle(id) {
  const panel = document.getElementById('ov-panel-' + id);
  if (!panel) return;
  panel.classList.toggle('collapsed');
  const list = ovReadJSON(OV_COLLAPSED_KEY, []).filter(x => x !== id);
  if (panel.classList.contains('collapsed')) list.push(id);
  localStorage.setItem(OV_COLLAPSED_KEY, JSON.stringify(list));
}

// ---------- Render geral ----------
function renderOverviewModule() {
  const root = document.getElementById('module-dashboard');
  if (!root) return;
  if (!root.dataset.ready) { root.innerHTML = ovShell(); root.dataset.ready = '1'; }

  document.querySelectorAll('#ov-topnav [data-module]').forEach(btn => { btn.hidden = !ovMenuAccessible(btn.dataset.module); });

  ovRenderStale();
  ovRenderQuickMenu();
  ovRenderMessages();
  ovRenderTodo();
  ovRenderExpiry();
  ovRenderActivity();
  ovRenderMaintenance();
  ovRenderMyRcm();
  ovRenderFleet();
}

// ---------- Reservas vencidas (ainda Reservation com retirada antes de hoje) ----------
function ovRenderStale() {
  const box = document.getElementById('ov-stale');
  if (!box) return;
  const stale = typeof fleetStaleReservations === 'function' ? fleetStaleReservations() : [];
  if (!stale.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <section class="ov-stale">
      <div class="ov-stale-head">
        <strong>⚠ ${stale.length} reservation${stale.length > 1 ? 's' : ''} past the pick-up date</strong>
        <span>Not collected by the customer. Move each booking to a new date or cancel it.</span>
        <a href="gc-daily-activity.html">Open Daily Activity →</a>
      </div>
      ${stale.map(r => `
        <div class="ov-stale-row">
          <span class="ov-stale-ref">${ovEsc(r.ref)}</span>
          <span>${ovEsc(r.customer)}</span>
          <span class="ov-muted">${ovEsc(r.model)} · ${ovEsc(r.plate)}</span>
          <span class="ov-stale-late">${ovEsc(fleetStaleLabel(r))}</span>
          <span class="ov-stale-actions">
            ${typeof annaDraftNoShow === 'function' ? `<button type="button" class="anna-link-btn" onclick="annaDraftNoShow('${ovEsc(r.id)}')" title="Concept: Anna drafts the message">✦ Draft message</button>` : ''}
            ${typeof waComposeForBooking === 'function' ? `<button type="button" class="wa-inline-btn" onclick="waComposeForBooking('${ovEsc(r.id)}', 'no_show', 'Missed pick-up · WhatsApp')">${waIcon(13)} WhatsApp</button>` : ''}
            <button type="button" class="pp-btn small" onclick="fleetOpenBookingWindow('${ovEsc(r.id)}')">Move date</button>
            <button type="button" class="pp-btn small ghost danger" onclick="ovCancelStale('${ovEsc(r.id)}')">Cancel booking</button>
          </span>
        </div>`).join('')}
    </section>`;
}

async function ovCancelStale(id) {
  const r = fleetStaleReservations().find(x => x.id === id);
  if (!r) return;
  const ok = await gcConfirm({ title: `Cancel booking ${r.ref}?`, message: `${r.customer} did not collect the vehicle. The booking will be cancelled and ${r.plate} becomes available.`, confirmText: 'Cancel booking', cancelText: 'Keep it', danger: true });
  if (!ok) return;
  fleetCancelBooking(id);
  renderOverviewModule();
  gcToast(`Booking ${r.ref} cancelled.`);
}

// Voltou para o dashboard (ex.: fechou a janela da reserva): atualiza o painel
window.addEventListener('focus', () => {
  const mod = document.getElementById('module-dashboard');
  if (mod && mod.classList.contains('active') && mod.dataset.ready) renderOverviewModule();
});

// ---------- Quick Menu ----------
function ovRenderQuickMenu() {
  const box = document.getElementById('ov-quick');
  if (!box) return;

  let pendingAlloc = 0;
  fleetForEachStoredBooking(list => list.forEach(b => { if (b.status === 'fleet_pending') pendingAlloc++; }));
  const waitingChats = (typeof getChatSessions === 'function' ? getChatSessions() : []).filter(s => s.status === 'waiting').length;
  let overduePlans = 0;
  if (typeof ppLoad === 'function') overduePlans = ppLoad().filter(pl => ppStatus(pl).key === 'overdue').length;
  let openDamage = 0;
  try { openDamage = ovReadJSON('gc_damage_reports', []).filter(d => d.status !== 'Closed').length; } catch (e) {}

  const items = [
    { icon: 'planner', color: '#7c3aed', label: 'Fleet Planner', action: "window.location.href='gc-fleet-planner.html'" },
    { icon: 'plus', color: '#16a34a', label: 'Quick Reservation', action: "window.location.href='gc-add-booking.html'" },
    { icon: 'list', color: '#0d9488', label: 'Daily Activity Report', action: "window.location.href='gc-daily-activity.html'" },
    { icon: 'car', color: '#0284c7', label: 'Allocate Reservation', count: pendingAlloc, countLabel: 'new', action: "ovGo('module-agent-requests', 'Agent Requests & Allocations'); switchAgentTab('alerts');" },
    { icon: 'list', color: '#ea580c', label: 'Upcoming Bookings', action: 'ovGoUpcoming()' },
    { icon: 'users', color: '#0891b2', label: 'Customers & Vehicles', action: "window.location.href='gc-customers.html'" },
    { icon: 'alert', color: '#dc2626', label: 'Damage Control', count: openDamage, countLabel: 'open', action: "window.location.href='gc-damage-control.html'" },
    { icon: 'card', color: '#2563eb', label: 'Payment Plans', count: overduePlans, countLabel: 'overdue', action: "ovGo('module-payments', 'Payment Plans')" },
    { icon: 'refund', color: '#65a30d', label: 'Bond Refunds', module: 'module-bonds', action: "ovGo('module-bonds', 'Bond Refunds')" },
    { icon: 'chat', color: '#db2777', label: 'Live Chat', count: waitingChats, countLabel: 'waiting', action: "ovGo('module-livechat', 'Live Chat System'); renderLiveChatModule();" },
    { icon: 'phone', color: '#0f766e', label: '3CX Calls', count: typeof cxPendingCallbacksToday === 'function' ? cxPendingCallbacksToday() : 0, countLabel: 'to call back', action: "ovGo('module-3cx', '3CX · Calls')" },
    { icon: 'chat', color: '#16a34a', label: 'WhatsApp', count: typeof waUnreadTotal === 'function' ? waUnreadTotal() : 0, countLabel: 'unread', action: "ovGo('module-whatsapp', 'WhatsApp · via 3CX')" },
    { icon: 'chart', color: '#9333ea', label: 'Reports & Analytics', module: 'module-analytics', action: "ovGo('module-analytics', 'Reports & Analytics')" }
  ].filter(it => !it.module || ovMenuAccessible(it.module));

  box.innerHTML = items.map(it => `
    <button type="button" class="ov-quick-item" onclick="${it.action}">
      <span class="ov-quick-icon" style="background: ${it.color};">${ovIcon(it.icon, 17)}</span>
      <span class="ov-quick-label">${it.label}${it.count ? `: <strong>${it.count} ${it.countLabel}</strong>` : ''}</span>
    </button>`).join('');
}

// ---------- Message Board (chats aguardando agente) ----------
function ovRenderMessages() {
  const box = document.getElementById('ov-messages');
  if (!box) return;
  const sessions = (typeof getChatSessions === 'function' ? getChatSessions() : [])
    .filter(s => s.status === 'waiting' || s.unreadForAgent > 0)
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    .slice(0, 5);

  if (!sessions.length) { box.innerHTML = '<p class="ov-empty">No messages.</p>'; return; }

  box.innerHTML = sessions.map(s => {
    const t = s.lastMessageAt ? new Date(s.lastMessageAt) : null;
    const when = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
    return `
      <button type="button" class="ov-message" onclick="ovGo('module-livechat', 'Live Chat System'); renderLiveChatModule();">
        <span class="ov-message-top"><strong>${ovEsc(s.customerName)}</strong><span>${when}</span></span>
        <span class="ov-message-ref">${ovEsc(s.bookingRef)}${s.status === 'waiting' ? ' · waiting for an agent' : ''}</span>
        ${s.lastMessage ? `<span class="ov-message-text">${ovEsc(s.lastMessage)}</span>` : ''}
      </button>`;
  }).join('');
}

// ---------- To Do List ----------
function ovTodos() { return ovReadJSON(OV_TODO_KEY, []); }
function ovSaveTodos(list) { localStorage.setItem(OV_TODO_KEY, JSON.stringify(list)); }

function ovAddTodo(e) {
  e.preventDefault();
  const input = document.getElementById('ov-todo-input');
  const text = input.value.trim();
  if (!text) return;
  const author = typeof getAgentName === 'function' ? getAgentName() : 'Agent';
  ovSaveTodos([{ id: Date.now(), text, done: false, createdAt: Date.now(), author }, ...ovTodos()]);
  input.value = '';
  ovRenderTodo();
}

function ovToggleTodo(id) {
  ovSaveTodos(ovTodos().map(t => t.id === id ? { ...t, done: !t.done } : t));
  ovRenderTodo();
}

function ovDeleteTodo(id) {
  ovSaveTodos(ovTodos().filter(t => t.id !== id));
  ovRenderTodo();
}

function ovSetTodoView(all) {
  ovTodoShowAll = all;
  ovRenderTodo();
}

function ovRenderTodo() {
  const list = document.getElementById('ov-todo-list');
  if (!list) return;
  document.getElementById('ov-todo-open').classList.toggle('active', !ovTodoShowAll);
  document.getElementById('ov-todo-all').classList.toggle('active', ovTodoShowAll);

  const items = ovTodos().filter(t => ovTodoShowAll || !t.done);
  list.innerHTML = items.length
    ? items.map(t => `
      <li class="${t.done ? 'done' : ''}">
        <label><input type="checkbox" ${t.done ? 'checked' : ''} onchange="ovToggleTodo(${t.id})"><span>${ovEsc(t.text)}</span></label>
        <small>${ovEsc(t.author)} · ${ovDate(t.createdAt)}</small>
        <button type="button" class="ov-todo-del" title="Delete" onclick="ovDeleteTodo(${t.id})">×</button>
      </li>`).join('')
    : `<li class="ov-empty">${ovTodoShowAll ? 'No items yet.' : 'Nothing to do.'}</li>`;
}

// ---------- Registration / Inspection Expiry ----------
function ovExpiryData() {
  const today0 = ovStartOfDay(Date.now());
  const rego = [], inspection = [];
  FLEET_VEHICLES.forEach(v => {
    const cat = fleetGetCategory(v.categoryId);
    // Registro: vence entre 4 dias atrás e 365 dias à frente (poucos atrasados)
    rego.push({ v, due: ovAddDays(today0, (ovHash(v.plate + ':rego') % 370) - 4) });
    // Inspeção anual só para comerciais (vans, utes e trucks)
    if (cat.section === 'Commercial') inspection.push({ v, due: ovAddDays(today0, (ovHash(v.plate + ':insp') % 240) - 6) });
  });
  return { rego, inspection, today0 };
}

function ovRenderExpiry() {
  const box = document.getElementById('ov-expiry');
  if (!box) return;
  const { rego, inspection, today0 } = ovExpiryData();
  const f = ovFilters.expiry;
  const limit = ovAddDays(today0, 30);
  const pick = list => list.filter(x => (f === 'ALL' || x.v.branch === f) && x.due <= limit).sort((a, b) => a.due - b.due);

  const block = (title, list) => {
    const rows = list.slice(0, 8).map(x => `
      <li class="${x.due < today0 ? 'overdue' : ''}">due ${ovDate(x.due)} - <strong>${x.v.plate}</strong> <span>${x.v.label}</span></li>`).join('');
    const more = list.length > 8 ? `<li class="ov-more">+ ${list.length - 8} more</li>` : '';
    return `<h4 class="ov-subtitle">${title}</h4>${list.length ? `<ul class="ov-due-list">${rows}${more}</ul>` : '<p class="ov-empty">Nothing due in the next 30 days.</p>'}`;
  };

  box.innerHTML = block('Registration Expiry', pick(rego)) + block('Inspection Expiry', pick(inspection));
}

// ---------- Daily Activity ----------
function ovShiftDay(step) {
  ovDayOffset = step === 0 ? 0 : ovDayOffset + step;
  ovRenderActivity();
}

function ovChart(counts, color, label) {
  const W = 230, H = 90, L = 18, R = 8, T = 18, B = 16;
  const max = Math.max(2, ...counts);
  const step = (W - L - R) / (counts.length - 1);
  const pts = counts.map((c, i) => [L + i * step, T + (H - T - B) * (1 - c / max)]);
  const line = pts.map(p => p.join(',')).join(' ');
  const area = `${L},${H - B} ${line} ${L + (counts.length - 1) * step},${H - B}`;
  const labels = counts.map((_, i) => {
    if (i % 2) return '';
    const h = OV_OPEN_HOUR + i;
    return `<text x="${L + i * step}" y="${H - 4}" text-anchor="middle">${h > 12 ? h - 12 : h} ${h >= 12 ? 'pm' : 'am'}</text>`;
  }).join('');
  return `
    <svg class="ov-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <text x="${L}" y="10" class="ov-chart-title">${label}</text>
      <line x1="${L}" y1="${T}" x2="${W - R}" y2="${T}" class="ov-grid-line"/>
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="ov-grid-line"/>
      <text x="${L - 4}" y="${T + 3}" text-anchor="end">${max}</text>
      <text x="${L - 4}" y="${H - B + 3}" text-anchor="end">0</text>
      <polygon points="${area}" fill="${color}" opacity=".18"/>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.8" fill="${color}"><title>${counts[i]}</title></circle>`).join('')}
      ${labels}
    </svg>`;
}

// Situação real de cada reserva (a mesma do Planner), não só o horário:
// pickup feito = Hired/Returned · drop off feito = Returned · passou da hora e não foi feito = atrasado
function ovActivityState(kind, r, now) {
  const time = kind === 'pickup' ? r.start : r.end;
  const done = kind === 'pickup' ? ['hired', 'returned'].includes(r.type) : r.type === 'returned';
  return done ? 'done' : time < now ? 'late' : 'due';
}

function ovActivityBlock(kind, list, now, color) {
  const timeOf = r => kind === 'pickup' ? r.start : r.end;
  const sorted = list.slice().sort((a, b) => timeOf(a) - timeOf(b)).map(r => ({ r, st: ovActivityState(kind, r, now) }));
  const n = { done: 0, late: 0, due: 0 };
  sorted.forEach(x => n[x.st]++);
  const toGo = n.late + n.due;
  const counts = [];
  for (let h = OV_OPEN_HOUR; h <= OV_CLOSE_HOUR; h++) counts.push(sorted.filter(x => new Date(timeOf(x.r)).getHours() === h).length);
  const next = sorted.find(x => x.st === 'due');
  const title = kind === 'pickup' ? 'Pickups' : 'Drop Offs';
  const doneWord = kind === 'pickup' ? 'Picked up' : 'Returned';
  const lateWord = kind === 'pickup' ? 'Not picked up' : 'Not returned';
  const vehicle = r => { const v = r.plate ? fleetGetVehicle(r.plate) : null; return v ? `${v.label} · ${v.plate}` : (fleetGetCategory(r.categoryId) || {}).label || ''; };
  const pct = k => sorted.length ? (n[k] / sorted.length * 100) : 0;
  const chip = st => `<span class="ov-st ${st}">${st === 'done' ? '✓ ' + doneWord : st === 'late' ? '⚠ ' + lateWord : 'Due'}</span>`;

  return `
    <div class="ov-activity-block">
      <div class="ov-activity-title">${title} - ${toGo} to go</div>
      <div class="ov-activity-bar" title="${n.done} ${doneWord.toLowerCase()} · ${n.late} late · ${n.due} still to come">
        ${sorted.length ? `<span class="seg" style="width:${pct('done')}%; background:${color};"></span><span class="seg late" style="width:${pct('late')}%"></span><span class="seg due" style="width:${pct('due')}%; background:${color};"></span>` : ''}
        <b>${sorted.length}</b>
      </div>
      ${sorted.length ? `<div class="ov-activity-legend"><span><i style="background:${color}"></i>${n.done} ${doneWord.toLowerCase()}</span>${n.late ? `<span class="late"><i></i>${n.late} late</span>` : ''}<span><i style="background:${color}; opacity:.4"></i>${n.due} to come</span></div>` : ''}
      ${ovChart(counts, color, `${title} by hour`)}
      <div class="ov-next">Next ${kind === 'pickup' ? 'pickup' : 'drop off'}: ${next
        ? `<a href="#" onclick="ovOpenBooking(event, '${ovEsc(next.r.id || '')}', ${next.r.bondOnly ? 'true' : 'false'})"><strong>${fleetFormatTime(timeOf(next.r))}</strong> · ${ovEsc(next.r.name || next.r.ref)} · ${ovEsc(vehicle(next.r))}</a>`
        : '<span class="ov-muted">—</span>'}</div>
      ${n.late ? `<div class="ov-late-line">⚠ ${n.late} ${kind === 'pickup' ? 'not picked up yet — mark as Hired or call the customer' : 'not returned yet — past the drop-off time'}</div>` : ''}
      ${sorted.length ? `
        <details class="ov-day-list"${n.late ? ' open' : ''}>
          <summary>View ${sorted.length} ${title.toLowerCase()}</summary>
          <ul>${sorted.map(({ r, st }) => `<li class="${st}" onclick="ovOpenBooking(event, '${ovEsc(r.id || '')}', ${r.bondOnly ? 'true' : 'false'})" title="Open booking ${ovEsc(r.ref)}">
            <span>${fleetFormatTime(timeOf(r))}</span><span>${ovEsc(r.name || r.ref)} <span class="ov-muted">#${ovEsc(r.ref)}</span></span>${chip(st)}
            <span class="ov-muted">${ovEsc(vehicle(r))}</span></li>`).join('')}</ul>
        </details>` : ''}
    </div>`;
}

// Abre a reserva (popup do Planner); devolvida antiga do Bond Refunds abre o extrato lá
function ovOpenBooking(e, id, bondOnly) {
  e.preventDefault();
  if (!id) return;
  if (bondOnly) {
    const link = document.querySelector(`.menu-item[onclick*="'module-bonds'"]`);
    if (link && !link.hidden) { switchModule('module-bonds', link, 'Bond Refunds'); bnOpenLedger(id); }
    return;
  }
  fleetOpenBookingWindow(id);
}

function ovRenderActivity() {
  const box = document.getElementById('ov-activity');
  if (!box) return;
  const now = Date.now();
  const day0 = ovAddDays(ovStartOfDay(now), ovDayOffset);
  const day1 = ovAddDays(day0, 1);
  const isToday = ovDayOffset === 0;

  const label = document.getElementById('ov-day-label');
  if (label) label.textContent = isToday ? 'Today' : new Date(day0).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  // Retirada pela filial de retirada; devolução pela filial de devolução (one-way)
  const f = ovFilters.activity;
  const rentals = (typeof anLiveRecords === 'function' ? anLiveRecords() : [])
    .filter(r => !r.cancelled && !r.pending && !['maintenance', 'on-request', 'possible-ext', 'cancelled'].includes(r.type));
  const pickups = rentals.filter(r => r.start >= day0 && r.start < day1 && (f === 'ALL' || r.pickBranch === f));
  const drops = rentals.filter(r => r.end >= day0 && r.end < day1 && (f === 'ALL' || r.dropBranch === f));

  box.innerHTML = ovActivityBlock('pickup', pickups, now, '#3b82f6') +
                  ovActivityBlock('drop', drops, now, '#22c55e') +
                  `<div class="ov-updated">Live from bookings · updated ${fleetFormatTime(now)}</div>` +
                  `<a class="ov-report-link" href="gc-daily-activity.html" onclick="ovOpenDailyReport(event, ${day0})">Open Daily Activity report →</a>`;
}

// O "to go" e os atrasos mudam com a hora: redesenha a cada minuto enquanto o painel está aberto
setInterval(() => {
  const mod = document.getElementById('module-dashboard');
  if (mod && mod.classList.contains('active') && mod.dataset.ready) ovRenderActivity();
}, 60000);

// Abre o relatório já no dia e filial escolhidos no painel
function ovOpenDailyReport(e, day0) {
  e.preventDefault();
  const d = new Date(day0);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem('gc_da_filters')) || {}; } catch (err) {}
  try {
    sessionStorage.setItem('gc_da_filters', JSON.stringify({ ...saved, fromDate: iso, toDate: iso, fromH: '00', fromM: '00', toH: '23', toM: '55', branch: ovFilters.activity }));
  } catch (err) {}
  window.location.href = 'gc-daily-activity.html';
}

// ---------- Maintenance Due ----------
const OV_SERVICES = ['Lube Service', 'Lube Service', 'Lube Service', 'Major Service', 'Tyre Rotation', 'Brake Inspection'];

function ovRenderMaintenance() {
  const box = document.getElementById('ov-maintenance');
  if (!box) return;
  const f = ovFilters.maintenance;
  const now = Date.now();

  // Bloqueios de manutenção reais do Fleet Planner que ainda estão valendo
  const holds = FLEET_SEED_BOOKINGS
    .filter(s => s.type === 'maintenance' && s.endMs > now)
    .filter(s => f === 'ALL' || (fleetGetVehicle(s.plate) || {}).branch === f)
    .map(s => `<li><strong>${s.plate}</strong> <span>${ovEsc(s.name || 'Workshop')} until ${ovDate(s.endMs)}</span></li>`);

  // Serviço por quilometragem (gerado por placa): negativo = já passou do ponto
  const services = FLEET_VEHICLES
    .filter(v => f === 'ALL' || v.branch === f)
    .map(v => {
      const h = ovHash(v.plate + ':svc');
      const commercial = fleetGetCategory(v.categoryId).section === 'Commercial';
      return { v, service: commercial && h % 7 === 0 ? 'Warranty Servicing' : OV_SERVICES[h % OV_SERVICES.length], km: (h % 20000) - 700 };
    })
    .filter(x => x.km < 2000)
    .sort((a, b) => a.km - b.km);

  const rows = services.slice(0, 10).map(x => `
    <li class="${x.km < 0 ? 'overdue' : ''}"><strong>${x.v.plate}</strong> <span>${x.service} ${x.km < 0
      ? `overdue by ${Math.abs(x.km).toLocaleString('en-AU')} km`
      : `due in ${x.km.toLocaleString('en-AU')} km`}</span></li>`);
  const more = services.length > 10 ? [`<li class="ov-more">+ ${services.length - 10} more</li>`] : [];

  const all = [...holds, ...rows, ...more];
  box.innerHTML = all.length ? `<ul class="ov-due-list">${all.join('')}</ul>` : '<p class="ov-empty">No maintenance due.</p>';
}

// ---------- My RCM ----------
function ovRenderMyRcm() {
  const box = document.getElementById('ov-myrcm');
  if (!box) return;
  const profile = ovReadJSON('gc_agent_profile', {});
  box.innerHTML = `
    <div class="ov-myrcm">
      <img src="../assets/img/gc-logo.svg" alt="GC Tech Rentals">
      <div>
        <div class="ov-myrcm-name">${ovEsc(profile.name || 'Agent')}</div>
        <div class="ov-muted">${ovEsc(profile.role || '')}</div>
      </div>
    </div>
    <div class="ov-myrcm-date">${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>`;
}

// ---------- Fleet Right Now (antes eram números fixos no HTML) ----------
function ovRenderFleet() {
  const box = document.getElementById('ov-fleet');
  if (!box) return;
  const now = Date.now();
  const today0 = ovStartOfDay(now), tomorrow = ovAddDays(today0, 1);
  const live = typeof anLiveRecords === 'function' ? anLiveRecords() : [];
  const rentals = live.filter(r => !['maintenance', 'on-request', 'possible-ext'].includes(r.type));
  const occ = fleetGetOccupancy();
  const busy = new Set(occ.filter(o => o.start <= now && o.end > now && !fleetIsVirtualPlate(o.plate)).map(o => o.plate));
  const inMaintenance = live.filter(r => r.type === 'maintenance' && r.start <= now && r.end > now).length;

  const stats = [
    { label: 'Vehicles available', value: FLEET_VEHICLES.length - busy.size, color: '#60a5fa' },
    { label: 'Currently on rent', value: rentals.filter(r => r.start <= now && r.end > now).length, color: '#34d399' },
    { label: 'Pick-ups today', value: rentals.filter(r => r.start >= today0 && r.start < tomorrow).length, color: '#f59e0b' },
    { label: 'Overdue returns', value: live.filter(r => r.type === 'hired' && r.end < now).length, color: '#ef4444' },
    { label: 'In maintenance', value: inMaintenance, color: '#a3a3a3' },
    { label: 'Fleet size', value: FLEET_VEHICLES.length, color: '#cbd5e1' }
  ];
  box.innerHTML = `<div class="ov-fleet">${stats.map(s => `
    <div class="ov-fleet-stat"><span class="ov-fleet-value" style="color: ${s.color};">${s.value}</span><span class="ov-fleet-label">${s.label}</span></div>`).join('')}</div>`;
}

// Atualiza quando outra aba (portal, planner, chat) muda os dados
window.addEventListener('storage', e => {
  const mod = document.getElementById('module-dashboard');
  if (!mod || !mod.classList.contains('active') || !mod.dataset.ready) return;
  if (e.key && e.key.startsWith('gc_') && e.key !== OV_COLLAPSED_KEY) renderOverviewModule();
});
