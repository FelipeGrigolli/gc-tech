// ==========================================
// GC TECH PAYMENT PLANS (Agent Dashboard → Payments)
// Planos de pagamento semanais para danos/acidentes.
// Chave: 'gc_payment_plans' → [{ id, customerName, email, phone, bookingRef, vehicle, plate,
//   reason, damageReportId, totalAmount, weeklyAmount, cardLast4, status, installments[], notes[] }]
// installments: [{ n, dueDate 'YYYY-MM-DD', amount, status 'scheduled'|'paid'|'failed', paidAt, method }]
// Cartão terminado em 0002 sempre é recusado (convenção de cartão de teste) para demonstrar falhas.
// Depende de: gc-chat.js (ensureChatSession, sendChatMessage, getAgentName).
// ==========================================
const PAYMENT_PLANS_KEY = 'gc_payment_plans';
const PP_DECLINE_CARD = '0002';

let ppFilter = 'all';
let ppSearch = '';
let ppOpenPlanId = null;

// ---------- Datas ----------
function ppToday() {
  const d = new Date();
  return ppIso(d);
}

function ppIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ppAddDays(iso, n) {
  const d = new Date(iso + 'T00:00');
  d.setDate(d.getDate() + n);
  return ppIso(d);
}

function ppFormat(iso, withWeekday) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const base = fleetFormatDate(d.getTime());
  return withWeekday ? `${days[d.getDay()]} ${base}` : base;
}

function ppMoney(n) {
  return '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Dados ----------
function ppLoad() {
  try { return JSON.parse(localStorage.getItem(PAYMENT_PLANS_KEY) || '[]'); } catch (e) { return []; }
}

function ppSave(plans) {
  localStorage.setItem(PAYMENT_PLANS_KEY, JSON.stringify(plans));
}

// Parcelas semanais a partir da 1ª data até cobrir o total (a última leva o resto)
function ppBuildInstallments(total, weekly, firstDate) {
  const list = [];
  let remaining = Math.round(total * 100) / 100;
  let n = 1;
  while (remaining > 0.009 && n <= 520) {
    const amount = Math.min(weekly, remaining);
    list.push({ n, dueDate: ppAddDays(firstDate, (n - 1) * 7), amount: Math.round(amount * 100) / 100, status: 'scheduled', paidAt: null, method: null });
    remaining = Math.round((remaining - amount) * 100) / 100;
    n++;
  }
  return list;
}

function ppPaid(plan) {
  return plan.installments.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
}

function ppNextInstallment(plan) {
  return plan.installments.find(i => i.status !== 'paid') || null;
}

// Status calculado a partir do cronograma (não fica gravado, sempre reflete o dia de hoje)
function ppStatus(plan) {
  if (plan.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled' };
  if (plan.installments.every(i => i.status === 'paid')) return { key: 'completed', label: 'Completed' };
  if (plan.status === 'paused') return { key: 'paused', label: 'Paused' };
  const today = ppToday();
  if (plan.installments.some(i => i.status !== 'paid' && (i.status === 'failed' || i.dueDate < today))) return { key: 'overdue', label: 'Overdue' };
  const next = ppNextInstallment(plan);
  if (next && next.dueDate === today) return { key: 'due', label: 'Due today' };
  if (next && next.dueDate <= ppAddDays(today, 2)) return { key: 'soon', label: 'Due soon' };
  return { key: 'ok', label: 'On track' };
}

// ---------- Dados de exemplo ----------
// Cada plano de exemplo é o resto de um dano de exemplo: mesma reserva devolvida (gc-fleet-data.js,
// taxa lançada na devolução), mesmo cliente e o mesmo relatório do Damage Control (dmg-seed-NN).
// Total do plano = dano − $500 do bond que a GC Tech ficou. As parcelas começam depois da devolução.
const PP_SEED_VERSION_KEY = 'gc_pp_seeded_v';
const PP_SEED_VERSION = '2';
const PP_SEED_IDS = ['pp-GC-8832', 'pp-GC-7716', 'pp-429424', 'pp-493149', 'pp-492814', 'pp-101992', 'pp-500100', 'pp-500101'];

function ppSeedIfEmpty() {
  if (localStorage.getItem(PP_SEED_VERSION_KEY) === PP_SEED_VERSION && localStorage.getItem(PAYMENT_PLANS_KEY)) return;
  const T = ppToday();

  const make = (p, startOffset, paidUntilIndex, extra = {}) => {
    const seed = FLEET_SEED_BASE.find(s => s.id === p.bookingId) || {};
    const cat = fleetGetCategory(seed.cat) || {};
    const first = ppAddDays(T, startOffset);
    const installments = ppBuildInstallments(p.totalAmount, p.weeklyAmount, first);
    installments.forEach((inst, idx) => {
      if (idx <= paidUntilIndex) { inst.status = 'paid'; inst.paidAt = inst.dueDate + 'T09:00'; inst.method = 'Card at branch'; }
    });
    const { bookingId, ...rest } = p;
    return {
      id: 'pp-' + seed.ref, status: 'active', phone: '+61 400 000 000',
      customerName: `${seed.fname} ${seed.lname}`, email: seed.clientEmail, bookingRef: seed.ref, vehicle: cat.model || '', plate: seed.plate,
      createdBy: 'Felipe Grigolli', createdAt: first,
      notes: [{ date: first, author: 'Felipe Grigolli', text: `Damage ${ppMoney(p.totalAmount + 500)} charged at return: $500 kept from the bond, ${ppMoney(p.totalAmount)} agreed as a weekly plan. Instalments taken by card by the team (phone, chat or branch).` }],
      ...rest, installments, ...extra
    };
  };

  const plans = [
    make({ bookingId: 'bk-or7716', damageReportId: 'dmg-seed-10', reason: 'At-fault accident — front left bumper', totalAmount: 1150, weeklyAmount: 150, cardLast4: '4242' }, -35, 4),
    make({ bookingId: 'bk2', damageReportId: 'dmg-seed-11', reason: 'Rear bumper & boot lid — reversed into a bollard', totalAmount: 900, weeklyAmount: 100, cardLast4: PP_DECLINE_CARD }, -8, 0),
    make({ bookingId: 'bk6', damageReportId: 'dmg-seed-12', reason: 'Rear-end collision — damage excess', totalAmount: 2000, weeklyAmount: 250, cardLast4: '1881' }, 0, -1),
    make({ bookingId: 'bk7', damageReportId: 'dmg-seed-13', reason: 'Side mirror & door panel', totalAmount: 600, weeklyAmount: 75, cardLast4: '5100' }, -5, 0, { status: 'paused' }),
    make({ bookingId: 'bk1', damageReportId: 'dmg-seed-14', reason: 'Tyres & rim damage', totalAmount: 400, weeklyAmount: 100, cardLast4: '3055' }, -6, 0),
    make({ bookingId: 'bk-truck-0', damageReportId: 'dmg-seed-03', reason: 'Tail lift repair', totalAmount: 740, weeklyAmount: 185, cardLast4: '7713' }, 3, -1),
    make({ bookingId: 'bk-truck-1', damageReportId: 'dmg-seed-04', reason: 'Roof damage — low clearance', totalAmount: 2300, weeklyAmount: 300, cardLast4: '2026' }, -3, 0)
  ];

  // Emily: a parcela de ontem foi recusada no balcão
  plans[1].installments[1].status = 'failed';
  plans[1].notes.push({ date: ppAddDays(T, -1), author: 'System', text: `Card declined at the branch (card ending ${PP_DECLINE_CARD}).` });
  // Lucas: pausado a pedido do cliente
  plans[3].notes.push({ date: ppAddDays(T, -2), author: 'Felipe Grigolli', text: 'Customer lost job — plan paused for 2 weeks, review on return.' });

  // Troca os exemplos antigos pelos desta versão; planos criados pelo agente ficam
  const keep = ppLoad().filter(p => !PP_SEED_IDS.includes(p.id));
  ppSave([...plans, ...keep]);
  localStorage.setItem(PP_SEED_VERSION_KEY, PP_SEED_VERSION);
}

// ---------- Cobrança (simulada) ----------
// opts.manualMethod: agente registrou pagamento com outro cartão na loja — nunca é recusado
// (a GC Tech só aceita cartão: sem dinheiro nem transferência)
// opts.actor: quem iniciou a cobrança no cartão (ex: 'Customer (online)'); sem isso = débito automático
function ppCharge(planId, n, opts = {}) {
  const plans = ppLoad();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return false;
  const inst = plan.installments.find(i => i.n === n);
  if (!inst || inst.status === 'paid') return false;

  const agent = (typeof getAgentName === 'function') ? getAgentName() : 'Agent';
  const manual = !!opts.manualMethod;
  if (!manual && plan.cardLast4 === PP_DECLINE_CARD) {
    inst.status = 'failed';
    plan.notes.push({ date: ppToday(), author: opts.actor || 'System', text: `Payment #${n} of ${ppMoney(inst.amount)} declined (card ending ${plan.cardLast4}).` });
    ppSave(plans);
    return false;
  }
  inst.status = 'paid';
  inst.paidAt = new Date().toISOString();
  inst.method = manual ? opts.manualMethod : `Card •••• ${plan.cardLast4}${opts.actor ? ' · ' + opts.actor : ''}`;
  if (manual) plan.notes.push({ date: ppToday(), author: agent, text: `Payment #${n} of ${ppMoney(inst.amount)} recorded manually (${opts.manualMethod}).` });
  if (opts.actor) plan.notes.push({ date: ppToday(), author: opts.actor, text: `Payment #${n} of ${ppMoney(inst.amount)} paid online.` });
  if (plan.installments.every(i => i.status === 'paid')) {
    plan.notes.push({ date: ppToday(), author: 'System', text: 'Plan fully paid.' });
  }
  ppSave(plans);
  return true;
}

// Cobra tudo que vence hoje ou está atrasado (planos ativos)
function ppRunTodaysDebits() {
  const today = ppToday();
  let ok = 0, failed = 0, total = 0;
  ppLoad().forEach(plan => {
    if (plan.status !== 'active') return;
    plan.installments.filter(i => i.status !== 'paid' && i.dueDate <= today).forEach(i => {
      if (ppCharge(plan.id, i.n)) { ok++; total += i.amount; } else failed++;
    });
  });
  renderPaymentsModule();
  if (!ok && !failed) ppToast('Nothing to charge today.');
  else ppToast(`${ok} payment${ok !== 1 ? 's' : ''} collected (${ppMoney(total)})${failed ? ` · ${failed} declined` : ''}.`, failed > 0);
}

function ppChargeOne(planId, n) {
  const success = ppCharge(planId, n);
  renderPaymentsModule();
  if (ppOpenPlanId) ppOpenDetails(ppOpenPlanId);
  ppToast(success ? 'Payment collected.' : 'Card declined — contact the customer.', !success);
}

function ppRecordManual(planId, n) {
  const method = document.getElementById(`pp-manual-${n}`)?.value || 'Card by phone';
  ppCharge(planId, n, { manualMethod: method });
  renderPaymentsModule();
  ppOpenDetails(planId);
  ppToast('Manual payment recorded.');
}

// ---------- Toast ----------
let ppToastTimer = null;
function ppToast(message, warn) {
  const el = document.getElementById('pp-toast');
  el.textContent = message;
  el.classList.toggle('warn', !!warn);
  el.classList.add('show');
  clearTimeout(ppToastTimer);
  ppToastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ---------- Render principal ----------
function renderPaymentsModule() {
  const container = document.getElementById('module-payments');
  if (!container) return;
  ppSeedIfEmpty();

  const plans = ppLoad();
  const today = ppToday();
  const monthPrefix = today.slice(0, 7);
  const live = plans.filter(p => p.status !== 'cancelled');

  const outstanding = live.reduce((s, p) => s + (p.totalAmount - ppPaid(p)), 0);
  const collectedMonth = plans.reduce((s, p) => s + p.installments
    .filter(i => i.status === 'paid' && i.paidAt && i.paidAt.slice(0, 7) === monthPrefix)
    .reduce((a, i) => a + i.amount, 0), 0);

  // Fila do dia: vence hoje + atrasados (só planos ativos)
  const queue = [];
  live.filter(p => p.status === 'active').forEach(p => p.installments
    .filter(i => i.status !== 'paid' && i.dueDate <= today)
    .forEach(i => queue.push({ plan: p, inst: i, overdue: i.dueDate < today || i.status === 'failed' })));
  const dueToday = queue.filter(q => !q.overdue);
  const overdue = queue.filter(q => q.overdue);

  document.getElementById('pp-stats').innerHTML = `
    <div class="pp-stat"><span>Outstanding balance</span><strong>${ppMoney(outstanding)}</strong><small>${live.filter(p => ppStatus(p).key !== 'completed').length} open plans</small></div>
    <div class="pp-stat"><span>Collected this month</span><strong class="green">${ppMoney(collectedMonth)}</strong><small>${new Date().toLocaleString('en-AU', { month: 'long' })}</small></div>
    <div class="pp-stat"><span>Due today</span><strong class="amber">${ppMoney(dueToday.reduce((s, q) => s + q.inst.amount, 0))}</strong><small>${dueToday.length} instalment${dueToday.length !== 1 ? 's' : ''} to collect (phone, chat or branch)</small></div>
    <div class="pp-stat"><span>Overdue</span><strong class="red">${ppMoney(overdue.reduce((s, q) => s + q.inst.amount, 0))}</strong><small>${overdue.length} payment${overdue.length !== 1 ? 's' : ''} missed</small></div>
  `;

  // Painel "Instalments due today" (o agente cobra quando o cliente paga na loja)
  document.getElementById('pp-today-title').textContent = `Instalments due today · ${ppFormat(today, true)}`;
  document.getElementById('pp-today-list').innerHTML = queue.length ? queue.map(q => `
    <div class="pp-queue-row ${q.overdue ? 'overdue' : ''}">
      <div class="pp-queue-who">
        <strong>${q.plan.customerName}</strong>
        <span>${q.plan.bookingRef} · payment ${q.inst.n} of ${q.plan.installments.length} · card •••• ${q.plan.cardLast4}</span>
      </div>
      <div class="pp-queue-when">${q.overdue ? `<span class="pp-pill overdue">${q.inst.status === 'failed' ? 'Declined' : 'Missed'} · ${ppFormat(q.inst.dueDate)}</span>` : '<span class="pp-pill due">Due today</span>'}</div>
      <div class="pp-queue-amount">${ppMoney(q.inst.amount)}</div>
      <div class="pp-queue-actions">
        <button class="pp-btn ghost" onclick="ppSendReminder('${q.plan.id}')">Remind</button>
        <button class="pp-btn" onclick="ppChargeOne('${q.plan.id}', ${q.inst.n})" title="Charge the card on file (customer paying by phone, chat, WhatsApp or at the branch)">${q.inst.status === 'failed' ? 'Retry' : 'Take payment'}</button>
      </div>
    </div>`).join('') : `<div class="pp-empty">✓ All instalments for today are paid.</div>`;

  // Filtros
  const counts = { all: plans.length };
  plans.forEach(p => { const k = ppStatus(p).key; counts[k] = (counts[k] || 0) + 1; });
  const filters = [['all', 'All'], ['due', 'Due today'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['ok', 'On track'], ['paused', 'Paused'], ['completed', 'Completed']];
  document.getElementById('pp-filters').innerHTML = filters.map(([k, label]) =>
    `<button class="pp-chip ${ppFilter === k ? 'active' : ''}" onclick="ppSetFilter('${k}')">${label}${counts[k] ? ` <span>${counts[k]}</span>` : ''}</button>`).join('');

  // Tabela
  const term = ppSearch.toLowerCase();
  const order = { overdue: 0, due: 1, soon: 2, ok: 3, paused: 4, completed: 5, cancelled: 6 };
  const rows = plans
    .filter(p => ppFilter === 'all' || ppStatus(p).key === ppFilter)
    .filter(p => !term || [p.customerName, p.email, p.bookingRef, p.reason, p.plate].some(v => (v || '').toLowerCase().includes(term)))
    .sort((a, b) => order[ppStatus(a).key] - order[ppStatus(b).key]);

  document.getElementById('pp-table-body').innerHTML = rows.length ? rows.map(p => {
    const st = ppStatus(p);
    const paid = ppPaid(p);
    const pct = Math.min(100, Math.round((paid / p.totalAmount) * 100));
    const next = ppNextInstallment(p);
    const paidCount = p.installments.filter(i => i.status === 'paid').length;
    return `
      <tr onclick="ppOpenDetails('${p.id}')">
        <td><strong>${p.customerName}</strong><div class="pp-sub">${p.email}</div></td>
        <td><span class="pp-ref">${p.bookingRef}</span><div class="pp-sub">${p.vehicle} · ${p.plate || '—'}</div></td>
        <td class="pp-reason">${p.reason}</td>
        <td><strong>${ppMoney(p.weeklyAmount)}</strong><div class="pp-sub">/ week</div></td>
        <td class="pp-progress-cell">
          <div class="pp-progress"><div class="pp-progress-bar ${st.key}" style="width:${pct}%"></div></div>
          <div class="pp-sub">${ppMoney(paid)} of ${ppMoney(p.totalAmount)} · ${paidCount}/${p.installments.length}</div>
        </td>
        <td>${next && st.key !== 'completed' ? `${ppFormat(next.dueDate, true)}<div class="pp-sub">${ppMoney(next.amount)}</div>` : '—'}</td>
        <td><span class="pp-pill ${st.key}">${st.label}</span></td>
        <td onclick="event.stopPropagation()">
          <div class="pp-row-actions">
            <button class="pp-btn ghost" onclick="ppSendReminder('${p.id}')" ${st.key === 'completed' ? 'disabled' : ''}>Send reminder</button>
          </div>
        </td>
      </tr>`;
  }).join('') : `<tr><td colspan="8" class="pp-empty">No payment plans match this filter.</td></tr>`;
}

function ppSetFilter(k) {
  ppFilter = k;
  renderPaymentsModule();
}

function ppOnSearch(value) {
  ppSearch = value;
  renderPaymentsModule();
}

// ---------- Painel de detalhes ----------
function ppOpenDetails(planId) {
  const plan = ppLoad().find(p => p.id === planId);
  if (!plan) return;
  ppOpenPlanId = planId;
  const st = ppStatus(plan);
  const paid = ppPaid(plan);
  const remaining = plan.totalAmount - paid;
  const left = plan.installments.filter(i => i.status !== 'paid');
  const last = plan.installments[plan.installments.length - 1];
  const today = ppToday();

  document.getElementById('pp-drawer-body').innerHTML = `
    <div class="pp-drawer-head">
      <div>
        <span class="pp-pill ${st.key}">${st.label}</span>
        <h2>${plan.customerName}</h2>
        <div class="pp-sub">${plan.email} · ${plan.phone || ''}</div>
      </div>
      <button class="pp-close" onclick="ppCloseDetails()">✕</button>
    </div>

    <div class="pp-reason-box">
      <div><small>Reason</small>${plan.reason}</div>
      <div><small>Booking</small>${plan.bookingRef} · ${plan.vehicle} (${plan.plate || '—'})</div>
      ${plan.damageReportId ? `<a href="gc-damage-control.html" class="pp-link">View damage report →</a>` : ''}
    </div>

    <div class="pp-figures">
      <div><small>Total</small><strong>${ppMoney(plan.totalAmount)}</strong></div>
      <div><small>Paid</small><strong class="green">${ppMoney(paid)}</strong></div>
      <div><small>Remaining</small><strong>${ppMoney(remaining)}</strong></div>
      <div><small>Weekly instalment</small><strong>${ppMoney(plan.weeklyAmount)}</strong></div>
      <div><small>Payments left</small><strong>${left.length}</strong></div>
      <div><small>Final payment</small><strong>${ppFormat(last.dueDate)}</strong></div>
    </div>
    <div class="pp-card-line">💳 Card used •••• ${plan.cardLast4}${plan.cardLast4 === PP_DECLINE_CARD ? ' <span class="pp-warn">(test card — always declines)</span>' : ''}</div>

    <h3>Schedule</h3>
    <div class="pp-schedule">
      ${plan.installments.map(i => {
        const late = i.status !== 'paid' && (i.status === 'failed' || i.dueDate < today);
        const label = i.status === 'paid' ? 'Paid' : i.status === 'failed' ? 'Declined' : late ? 'Missed' : i.dueDate === today ? 'Due today' : 'Scheduled';
        const cls = i.status === 'paid' ? 'completed' : late ? 'overdue' : i.dueDate === today ? 'due' : 'scheduled';
        const canAct = i.status !== 'paid' && plan.status === 'active' && i.dueDate <= ppAddDays(today, 7);
        return `
          <div class="pp-sched-row">
            <span class="pp-sched-n">#${i.n}</span>
            <span class="pp-sched-date">${ppFormat(i.dueDate, true)}</span>
            <span class="pp-sched-amount">${ppMoney(i.amount)}</span>
            <span class="pp-pill ${cls}">${label}</span>
            <span class="pp-sched-meta">${i.status === 'paid' ? (i.method || '') : ''}</span>
            <span class="pp-sched-actions">
              ${canAct ? `
                <button class="pp-btn small" onclick="ppChargeOne('${plan.id}', ${i.n})">${i.status === 'failed' ? 'Retry' : 'Charge'}</button>
                <select id="pp-manual-${i.n}" class="pp-mini-select" title="How the customer gave the card — GC Tech takes card payments only, no cash or bank transfer"><option>Card by phone</option><option>Card via live chat / WhatsApp</option><option>Card at branch</option></select>
                <button class="pp-btn small ghost" onclick="ppRecordManual('${plan.id}', ${i.n})">Record</button>` : ''}
            </span>
          </div>`;
      }).join('')}
    </div>

    <h3>Notes</h3>
    <div class="pp-notes">
      ${plan.notes.slice().reverse().map(n => `<div class="pp-note"><small>${ppFormat(n.date)} · ${n.author}</small>${n.text}</div>`).join('')}
    </div>
    <div class="pp-note-form">
      <input type="text" id="pp-note-input" placeholder="Add a note (e.g. customer called, promised payment Friday)">
      <button class="pp-btn" onclick="ppAddNote('${plan.id}')">Add</button>
    </div>

    <div class="pp-drawer-actions">
      ${st.key !== 'completed' && plan.status !== 'cancelled' ? `
        <button class="pp-btn ghost" onclick="ppTogglePause('${plan.id}')">${plan.status === 'paused' ? 'Resume plan' : 'Pause plan'}</button>
        <button class="pp-btn ghost danger" onclick="ppCancelPlan('${plan.id}', this)">Cancel plan</button>
        <button class="pp-btn" onclick="ppSendReminder('${plan.id}')">✉ Send reminder</button>` : ''}
    </div>
  `;
  document.getElementById('pp-drawer').classList.add('open');
}

function ppCloseDetails() {
  ppOpenPlanId = null;
  document.getElementById('pp-drawer').classList.remove('open');
}

function ppUpdatePlan(planId, mutate) {
  const plans = ppLoad();
  const plan = plans.find(p => p.id === planId);
  if (!plan) return;
  mutate(plan);
  ppSave(plans);
  renderPaymentsModule();
  ppOpenDetails(planId);
}

function ppAddNote(planId) {
  const input = document.getElementById('pp-note-input');
  const text = input.value.trim();
  if (!text) return;
  const agent = (typeof getAgentName === 'function') ? getAgentName() : 'Agent';
  ppUpdatePlan(planId, p => p.notes.push({ date: ppToday(), author: agent, text }));
}

function ppTogglePause(planId) {
  const agent = (typeof getAgentName === 'function') ? getAgentName() : 'Agent';
  ppUpdatePlan(planId, p => {
    p.status = p.status === 'paused' ? 'active' : 'paused';
    p.notes.push({ date: ppToday(), author: agent, text: p.status === 'paused' ? 'Plan paused.' : 'Plan resumed.' });
  });
  ppToast('Plan updated.');
}

// Pede um segundo clique para confirmar (sem confirm() do navegador)
function ppCancelPlan(planId, btn) {
  if (btn.dataset.confirm !== 'yes') {
    btn.dataset.confirm = 'yes';
    btn.textContent = 'Click again to confirm';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Cancel plan'; }, 3000);
    return;
  }
  const agent = (typeof getAgentName === 'function') ? getAgentName() : 'Agent';
  ppUpdatePlan(planId, p => {
    p.status = 'cancelled';
    p.notes.push({ date: ppToday(), author: agent, text: 'Plan cancelled.' });
  });
  ppToast('Plan cancelled.', true);
}

// ---------- Lembrete: WhatsApp (via 3CX), e-mail ou chat do booking ----------
// Canal sugerido = preferência de contato do cliente. WhatsApp fora das 24 h usa o modelo aprovado.
const PP_PLACEHOLDER_PHONE = '+61 400 000 000';
let ppReminder = null; // { planId, channel, edited }

function ppReminderPhone(plan) {
  const p = (plan.phone || '').trim();
  if (p && p !== PP_PLACEHOLDER_PHONE) return p;
  return typeof waDemoMobile === 'function' ? waDemoMobile(plan.bookingRef) : p; // exemplo: celular de demo da reserva
}

function ppReminderText(plan, channel) {
  const next = ppNextInstallment(plan);
  const overdue = ppStatus(plan).key === 'overdue';
  const firstName = plan.customerName.split(' ')[0];
  const agent = ppAgentName();
  const balance = ppMoney(plan.totalAmount - ppPaid(plan));
  if (channel === 'template') {
    const tpl = WA_TEMPLATES[overdue ? 'payment_plan_overdue' : 'payment_plan_reminder'];
    return tpl.body({ name: firstName, ref: plan.bookingRef, amount: ppMoney(next.amount), due: ppFormat(next.dueDate, true), card: plan.cardLast4, balance });
  }
  const body = overdue
    ? `Your payment plan instalment of ${ppMoney(next.amount)} for booking ${plan.bookingRef} (${plan.reason}) is overdue. Reply to this message or call us and our team will take it on your credit or debit card right away — the remaining balance is ${balance}.`
    : `A friendly reminder that your next payment plan instalment of ${ppMoney(next.amount)} for booking ${plan.bookingRef} is due on ${ppFormat(next.dueDate, true)}. No need to come in: reply to this message or call us and our team will take it on your credit or debit card (we don't accept cash or bank transfer). Remaining balance after this payment: ${ppMoney(plan.totalAmount - ppPaid(plan) - next.amount)}.`;
  if (channel === 'email') return `Hi ${firstName},\n\n${body}\n\nIf you have any questions, just reply to this email.\n\nKind regards,\n${agent}\nGC Tech Car & Truck Rental`;
  return `Hi ${firstName}, this is ${agent} from GC Tech. ${body}`;
}

function ppSendReminder(planId) {
  const plan = ppLoad().find(p => p.id === planId);
  if (!plan) return;
  if (!ppNextInstallment(plan)) { ppToast('This plan is fully paid — no reminder needed.'); return; }
  const pref = typeof fleetContactPref === 'function' && plan.email ? fleetContactPref(plan.email) : { channel: 'whatsapp', whatsapp: null };
  const canWa = typeof waSend === 'function' && ppReminderPhone(plan);
  const channel = pref.whatsapp === false || pref.channel === 'email' || !canWa ? 'email' : 'whatsapp';
  ppReminder = { planId, channel, edited: false };
  let modal = document.getElementById('pp-reminder-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'pp-modal';
    modal.id = 'pp-reminder-modal';
    modal.onclick = e => { if (e.target === modal) ppCloseReminder(); };
    document.body.appendChild(modal);
  }
  modal.classList.add('open');
  ppRenderReminder();
}

function ppCloseReminder() {
  const modal = document.getElementById('pp-reminder-modal');
  if (modal) modal.classList.remove('open');
  ppReminder = null;
}

function ppRenderReminder() {
  const plan = ppReminder && ppLoad().find(p => p.id === ppReminder.planId);
  const modal = document.getElementById('pp-reminder-modal');
  if (!plan || !modal) return;
  const phone = ppReminderPhone(plan);
  const canWa = typeof waSend === 'function' && !!phone;
  const thread = canWa && typeof waThread === 'function' ? waThread(phone) : null;
  const windowOpen = !!(thread && thread.windowOpen);
  const ch = ppReminder.channel;
  const template = ch === 'whatsapp' && !windowOpen;
  const prefChip = typeof waPrefChip === 'function' && plan.email ? waPrefChip(plan.email) : '';
  const note = ch === 'whatsapp'
    ? (template ? 'No message from the customer in the last 24 h, so WhatsApp only allows an approved template (shown below).' : 'The customer wrote in the last 24 h: this goes as a free WhatsApp reply. You can edit it.')
    : ch === 'email' ? `Goes by email to ${plan.email}. You can edit it.` : 'Goes to the booking chat (Customer Portal). You can edit it.';
  const text = template || !ppReminder.edited ? ppReminderText(plan, template ? 'template' : ch) : (document.getElementById('pp-rem-text') || {}).value || '';
  const st = ppStatus(plan);
  modal.innerHTML = `
    <div class="pp-modal-card">
      <h3>Payment plan reminder</h3>
      <p class="pp-sub">${plan.customerName} · booking ${plan.bookingRef} · <span class="pp-pill ${st.key}">${st.label}</span></p>
      <div class="pp-rem-channels">
        <span>Send by</span>
        <button type="button" class="${ch === 'whatsapp' ? 'on' : ''}" ${canWa ? '' : 'disabled title="No mobile number on this plan"'} onclick="ppSetReminderChannel('whatsapp')">WhatsApp</button>
        <button type="button" class="${ch === 'email' ? 'on' : ''}" ${plan.email ? '' : 'disabled'} onclick="ppSetReminderChannel('email')">Email</button>
        <button type="button" class="${ch === 'chat' ? 'on' : ''}" onclick="ppSetReminderChannel('chat')">Booking chat</button>
        ${prefChip}
      </div>
      <p class="pp-sub" style="margin-top:8px">${ch === 'whatsapp' ? `To ${phone} via 3CX. ` : ''}${note}</p>
      <textarea id="pp-rem-text" class="pp-rem-text" rows="${ch === 'email' ? 10 : 6}" ${template ? 'readonly' : ''} oninput="ppReminder.edited = true">${text.replace(/</g, '&lt;')}</textarea>
      <div class="pp-modal-actions" style="margin-top:14px">
        <button type="button" class="pp-btn ghost" onclick="ppCloseReminder()">Cancel</button>
        <button type="button" class="pp-btn primary" onclick="ppDoSendReminder()">Send ${ch === 'whatsapp' ? 'WhatsApp' : ch === 'email' ? 'email' : 'in chat'}</button>
      </div>
    </div>`;
}

function ppSetReminderChannel(channel) {
  if (!ppReminder) return;
  ppReminder.channel = channel;
  ppReminder.edited = false;
  ppRenderReminder();
}

function ppDoSendReminder() {
  const plan = ppReminder && ppLoad().find(p => p.id === ppReminder.planId);
  if (!plan) return;
  const ch = ppReminder.channel;
  const text = document.getElementById('pp-rem-text').value.trim();
  if (!text) { ppToast('The message is empty.', true); return; }
  const agent = ppAgentName();
  const firstName = plan.customerName.split(' ')[0];
  const phone = ppReminderPhone(plan);
  const overdue = ppStatus(plan).key === 'overdue';
  const bk = { id: '', ref: plan.bookingRef, email: plan.email, plate: plan.plate || '' };
  let sentBy = '';

  if (ch === 'whatsapp') {
    const thread = typeof waThread === 'function' ? waThread(phone) : null;
    const next = ppNextInstallment(plan);
    const msg = thread && thread.windowOpen
      ? waSend({ phone, text, channel: 'whatsapp', silent: true })
      : waSend({ phone, template: overdue ? 'payment_plan_overdue' : 'payment_plan_reminder', channel: 'whatsapp', silent: true,
          vars: { name: firstName, ref: plan.bookingRef, amount: ppMoney(next.amount), due: ppFormat(next.dueDate, true), card: plan.cardLast4, balance: ppMoney(plan.totalAmount - ppPaid(plan)) } });
    if (!msg) { ppToast('WhatsApp could not be sent — check the mobile number.', true); return; }
    sentBy = msg.channel === 'email' ? 'email (WhatsApp not delivered)' : 'WhatsApp';
  } else if (ch === 'email') {
    if (typeof waSendEmail === 'function') waSendEmail(bk, phone, text, '', agent, true);
    else if (typeof fleetLog === 'function') fleetLog({ bookingId: 'pp-' + plan.bookingRef, ref: plan.bookingRef, action: 'Email', details: `Email sent to ${plan.email} (payment plan reminder)` });
    sentBy = 'email';
  } else {
    const sessionId = `${plan.email}_${plan.bookingRef}`; // mesmo formato do chat de reservas
    ensureChatSession(sessionId, plan.email, plan.customerName, plan.bookingRef, 'Payment plan', plan.plate || 'N/A');
    sendChatMessage(sessionId, 'agent', agent, text, { notice: true }); // lembrete: não "pega" o chat
    window.open(`gc-chat.html?role=agent&email=${encodeURIComponent(plan.email)}&name=${encodeURIComponent(plan.customerName)}&sessionId=${encodeURIComponent(sessionId)}`,
      'gcChat_' + sessionId, 'width=380,height=580');
    sentBy = 'the booking chat';
  }

  ppUpdatePlan(plan.id, p => p.notes.push({ date: ppToday(), author: agent, text: `Reminder sent by ${sentBy}.` }));
  ppCloseReminder();
  if (typeof renderPaymentsModule === 'function') renderPaymentsModule();
  if (ppOpenPlanId === plan.id && typeof ppOpenDetails === 'function') ppOpenDetails(plan.id);
  ppToast(`Reminder sent to ${firstName} by ${sentBy}.`);
}

// ---------- Funções compartilhadas (Agent Dashboard, Damage Control, Customer Portal) ----------
function ppAgentName() {
  if (typeof getAgentName === 'function') return getAgentName();
  return localStorage.getItem('gc_agent_name') || 'Agent';
}

// Todas as reservas conhecidas, para localizar cliente/veículo pelo booking ref
function ppCollectBookingOptions() {
  const options = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('gc_multi_bookings_')) {
      const email = key.replace('gc_multi_bookings_', '');
      try {
        JSON.parse(localStorage.getItem(key) || '[]').forEach(b => options.push({ ref: b.ref, email, name: `${b.fname || ''} ${b.lname || ''}`.trim(), vehicle: b.vehicle, plate: b.plate }));
      } catch (e) {}
    } else if (key.startsWith('gc_booking_poc_')) {
      const email = key.replace('gc_booking_poc_', '');
      options.push({ ref: 'GC-8832', email, name: email === 'felipe@testgctech.com' ? 'Felipe Grigolli' : email.split('@')[0], vehicle: 'Auto Pantech Truck', plate: FLEET_MAIN_BOOKING_PLATE });
    }
  }
  FLEET_SEED_BOOKINGS.filter(s => s.type !== 'maintenance').forEach(s =>
    options.push({ ref: s.ref, email: s.clientEmail, name: `${s.fname} ${s.lname}`, vehicle: fleetGetVehicle(s.plate).model, plate: s.plate }));
  return options;
}

function ppFindBookingByRef(ref) {
  return ppCollectBookingOptions().find(o => o.ref === (ref || '').trim()) || null;
}

// Texto de prévia do cronograma (HTML) ou null se os dados estiverem incompletos
function ppPreviewText(total, weekly, first) {
  if (!(total > 0) || !(weekly > 0) || !first) return null;
  const inst = ppBuildInstallments(total, weekly, first);
  const last = inst[inst.length - 1];
  const weekday = ppFormat(first, true).split(' ')[0];
  return `<strong>${inst.length} weekly payment${inst.length > 1 ? 's' : ''}</strong> every ${weekday}
    — ${inst.length > 1 && last.amount !== weekly ? `${inst.length - 1} × ${ppMoney(weekly)} + final ${ppMoney(last.amount)}` : `${ppMoney(weekly)} each`}.
    <br>First instalment ${ppFormat(first)} · final instalment <strong>${ppFormat(last.dueDate)}</strong>.`;
}

// f: { customerName, email, phone, bookingRef, vehicle, plate, reason, damageReportId, totalAmount, weeklyAmount, cardLast4, firstDate }
function ppValidatePlanInput(f) {
  if (!f.customerName || !f.email || !f.bookingRef || !f.reason) return 'Please fill in customer, email, booking ref and reason.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return 'Please enter a valid email.';
  if (!(f.totalAmount > 0) || !(f.weeklyAmount > 0)) return 'Total and weekly amount must be greater than zero.';
  if (f.weeklyAmount > f.totalAmount) return 'Weekly amount cannot be greater than the total.';
  if (!f.firstDate) return 'Choose the first instalment date.';
  if (!/^\d{4}$/.test(f.cardLast4 || '')) return 'Enter the last 4 digits of the card.';
  return '';
}

function ppCreatePlanRecord(f) {
  const agent = ppAgentName();
  const plan = {
    id: 'pp-' + Date.now(),
    customerName: f.customerName,
    email: f.email.toLowerCase(),
    phone: f.phone || '',
    bookingRef: f.bookingRef,
    vehicle: f.vehicle || '—',
    plate: f.plate || '',
    reason: f.reason,
    damageReportId: f.damageReportId || null,
    totalAmount: f.totalAmount,
    weeklyAmount: f.weeklyAmount,
    cardLast4: f.cardLast4,
    status: 'active',
    installments: ppBuildInstallments(f.totalAmount, f.weeklyAmount, f.firstDate),
    notes: [{ date: ppToday(), author: agent, text: `Plan created: ${ppMoney(f.totalAmount)} at ${ppMoney(f.weeklyAmount)}/week.` }],
    createdBy: agent,
    createdAt: ppToday()
  };
  const plans = ppLoad();
  plans.unshift(plan);
  ppSave(plans);
  return plan;
}

// ---------- Novo plano (modal do Agent Dashboard) ----------
function ppOpenNewPlan() {
  // Sugestões de reservas conhecidas para preencher o cliente automaticamente
  const options = ppCollectBookingOptions();
  window.ppBookingOptions = options;
  document.getElementById('pp-booking-list').innerHTML = options.map(o => `<option value="${o.ref}">${o.name} — ${o.vehicle}</option>`).join('');

  let reports = [];
  try { reports = JSON.parse(localStorage.getItem('gc_damage_reports') || '[]'); } catch (e) {}
  document.getElementById('pp-new-damage').innerHTML = `<option value="">— None —</option>` +
    reports.map(r => `<option value="${r.id}">${r.bookingRef} · ${r.plate} · ${(r.description || '').slice(0, 40)}</option>`).join('');

  ['pp-new-ref', 'pp-new-name', 'pp-new-email', 'pp-new-phone', 'pp-new-reason', 'pp-new-total', 'pp-new-weekly', 'pp-new-card'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pp-new-first').value = ppAddDays(ppToday(), 7);
  document.getElementById('pp-new-error').textContent = '';
  ppUpdatePreview();
  document.getElementById('pp-new-modal').classList.add('open');
}

function ppCloseNewPlan() {
  document.getElementById('pp-new-modal').classList.remove('open');
}

function ppFillFromBooking() {
  const ref = document.getElementById('pp-new-ref').value.trim();
  const match = (window.ppBookingOptions || []).find(o => o.ref === ref);
  if (!match) return;
  document.getElementById('pp-new-name').value = match.name;
  document.getElementById('pp-new-email').value = match.email;
}

function ppUpdatePreview() {
  const html = ppPreviewText(
    parseFloat(document.getElementById('pp-new-total').value),
    parseFloat(document.getElementById('pp-new-weekly').value),
    document.getElementById('pp-new-first').value
  );
  document.getElementById('pp-new-preview').innerHTML = html || 'Enter the total, weekly amount and first instalment date to preview the schedule.';
}

function ppCreatePlan() {
  const val = id => document.getElementById(id).value.trim();
  const booking = ppFindBookingByRef(val('pp-new-ref')) || {};
  const input = {
    customerName: val('pp-new-name'),
    email: val('pp-new-email'),
    phone: val('pp-new-phone'),
    bookingRef: val('pp-new-ref'),
    vehicle: booking.vehicle,
    plate: booking.plate,
    reason: val('pp-new-reason'),
    damageReportId: val('pp-new-damage') || null,
    totalAmount: parseFloat(val('pp-new-total')),
    weeklyAmount: parseFloat(val('pp-new-weekly')),
    cardLast4: val('pp-new-card'),
    firstDate: val('pp-new-first')
  };
  const error = ppValidatePlanInput(input);
  if (error) { document.getElementById('pp-new-error').textContent = error; return; }

  const plan = ppCreatePlanRecord(input);
  ppCloseNewPlan();
  renderPaymentsModule();
  ppToast(`Payment plan created for ${plan.customerName}.`);
}

// Outra aba (ex: Damage Control) alterou os planos → atualiza
window.addEventListener('storage', e => {
  if (e.key === PAYMENT_PLANS_KEY && document.getElementById('module-payments')?.classList.contains('active')) renderPaymentsModule();
});
