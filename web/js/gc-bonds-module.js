// ==========================================
// AGENT DASHBOARD — MÓDULO BOND REFUNDS ("Reservations Due Closed" do RCM)
// Dados e regras em js/gc-bonds.js. Prefixo bn/Bonds para não colidir.
// ==========================================
let bnActiveId = null;

function bnCurrentAgent() {
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem(AGENT_PROFILE_KEY) || '{}') || {}; } catch (e) {}
  const username = profile.username || Object.keys(validAgents).find(u => validAgents[u].name === profile.name);
  return { username, name: profile.name || 'Agent' };
}

function bnEsc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bnToast(text, warn) {
  const t = document.getElementById('bn-toast');
  t.textContent = text;
  t.className = 'pp-toast show' + (warn ? ' warn' : '');
  clearTimeout(bnToast.timer);
  bnToast.timer = setTimeout(() => { t.className = 'pp-toast'; }, 3200);
}

// Contador no menu lateral (bonds ainda a devolver)
function bnUpdateMenuCount() {
  const el = document.getElementById('bn-menu-count');
  if (!el) return;
  const n = bondAllRecords().filter(r => bondBalance(r) < 0 && !bondIsHeld(r)).length;
  el.textContent = n || '';
}

function renderBondsModule() {
  const agent = bnCurrentAgent();
  const module = document.getElementById('module-bonds');
  if (!bondHasAccess(agent.username)) {
    module.querySelector('.al-table-wrap').style.display = 'none';
    document.getElementById('bn-count').textContent = "You don't have access to Bond Refunds. Ask Felipe or Alex.";
    return;
  }
  module.querySelector('.al-table-wrap').style.display = '';
  document.getElementById('bn-access-btn').style.display = bondIsAdmin(agent.username) ? '' : 'none';

  const branch = document.getElementById('bn-f-branch');
  if (!branch.options.length) {
    branch.innerHTML = '<option value="">All locations</option>' +
      Object.values(FLEET_BRANCHES).map(n => `<option value="${n}">${fleetBranchLabel(n)}</option>`).join('');
  }
  renderBondsTable();
}

function renderBondsTable() {
  const branch = document.getElementById('bn-f-branch').value;
  const from = document.getElementById('bn-f-from').value;
  const to = document.getElementById('bn-f-to').value;
  const status = document.getElementById('bn-f-status').value;
  const q = document.getElementById('bn-f-search').value.trim().toLowerCase();
  const fromMs = from ? new Date(from + 'T00:00').getTime() : -Infinity;
  const toMs = to ? new Date(to + 'T23:59').getTime() : Infinity;

  const all = bondAllRecords().map(r => ({ r, balance: bondBalance(r), refund: bondLastRefund(r), held: bondIsHeld(r) }));
  const rows = all.filter(({ r, balance, refund, held }) => {
    if (branch && (r.dropoffLoc || r.loc) !== branch) return false;
    if (r.dropoffMs < fromMs || r.dropoffMs > toMs) return false;
    if (status === 'owed' && (balance >= 0 || held)) return false;
    if (status === 'held' && !held) return false;
    if (status === 'refunded' && !(refund && balance === 0)) return false;
    if (q && ![r.lname, r.fname, r.ref, r.plate].some(v => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  const owed = all.filter(x => x.balance < 0 && !x.held);
  const heldList = all.filter(x => x.held);
  const refunded = all.filter(x => x.refund && x.balance === 0);
  document.getElementById('bn-stats').innerHTML = `
    <div class="bn-stat"><span>Bonds to refund</span><strong>${owed.length}</strong></div>
    <div class="bn-stat"><span>Amount owed to customers</span><strong class="owed">${feeMoney(-owed.reduce((s, x) => s + x.balance, 0))}</strong></div>
    <div class="bn-stat"><span>Bonds on hold</span><strong class="held">${heldList.length}${heldList.length ? ` <small>${feeMoney(-heldList.reduce((s, x) => s + x.balance, 0))}</small>` : ''}</strong></div>
    <div class="bn-stat"><span>Refunded</span><strong class="ok">${refunded.length}</strong></div>`;

  const body = document.getElementById('bn-body');
  body.innerHTML = rows.length ? rows.map(({ r, balance, refund, held }, i) => {
    const loc = r.dropoffLoc || r.loc;
    const code = Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === loc) || '';
    const d = new Date(r.dropoffMs);
    const when = `${String(d.getDate()).padStart(2, '0')}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<tr>
      <td>${i + 1}</td>
      <td class="bn-res"><button type="button" class="bn-res-link" title="Open booking ${bnEsc(r.ref)}" onclick="fleetOpenBookingWindow('${bnEsc(r.id)}')">${bnEsc(r.ref)}</button></td>
      <td><button class="pp-btn small" onclick="bnOpenLedger('${r.id}')">Update</button></td>
      <td>${code}</td>
      <td>${loc.split(' - ')[0]}</td>
      <td>${when}</td>
      <td>${bnEsc(r.plate)}</td>
      <td>${bnEsc(r.company)}</td>
      <td>${bnEsc(r.fname)} ${bnEsc((r.lname || '').toUpperCase())}</td>
      <td>${bnEsc(r.card || 'visa')}</td>
      <td class="r ${balance < 0 ? 'bn-owed' : 'bn-zero'}">${feeMoney(balance)}${balance < 0 && bondBreakdownShort(r) ? `<span class="bn-why" title="Why the refund isn't the bond amount — open Update for the details">${bnEsc(bondBreakdownShort(r))}</span>` : ''}</td>
      <td>${refund ? `${bnEsc(refund.refundedBy)}<br><small>${bondFmtDate(refund.dateMs)}</small>` : ''}</td>
      <td>${held ? `<span class="bn-held" title="${bnEsc(bondHoldLabel(r))} · held by ${bnEsc(r.hold.by)} · ${bondFmtDate(r.hold.atMs)}">🔒 On hold · ${bnEsc(bondHoldReason(r).label)}</span>${bondRefundRequest(r) ? `<span class="bn-req">📩 Customer asked for the refund · ${bnEsc(bondRefundRequest(r).channel)} · ${bondFmtDate(bondRefundRequest(r).at)}</span>` : ''} <button class="pp-btn small" onclick="bnOpenLedger('${r.id}')">Refund</button>` : balance < 0 ? `<button class="pp-btn small primary" onclick="bnOpenLedger('${r.id}')">Refund ${feeMoney(-balance)}</button>` : balance > 0 ? '<span class="bn-closed" style="color:#b45309">Bond kept · customer owes</span>' : '<span class="bn-closed">✓ Closed</span>'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="13" class="bn-empty">No returned bookings match these filters.</td></tr>`;

  document.getElementById('bn-count').textContent = `${rows.length} booking(s)`;
  bnUpdateMenuCount();
}

// ------------------------------------------
// EXTRATO + LIBERAR BOND
// ------------------------------------------
function bnOpenLedger(id) {
  bnActiveId = id;
  bnRenderLedger();
  document.getElementById('bn-ledger-msg').textContent = '';
  document.getElementById('bn-ledger-modal').classList.add('open');
}

function bnRenderLedger() {
  const rec = bondGetRecord(bnActiveId);
  if (!rec) return;
  const balance = bondBalance(rec);
  document.getElementById('bn-ledger-title').innerHTML = `Update Booking #${bnEsc(rec.ref)} <small>- ${bnEsc(rec.fname)} ${bnEsc(rec.lname.toUpperCase())}</small>`;
  document.getElementById('bn-ledger-body').innerHTML = bondLedgerHtml(rec);
  const btn = document.getElementById('bn-release-btn');
  btn.disabled = false;
  btn.style.display = balance < 0 ? '' : 'none';
  btn.textContent = `Refund ${feeMoney(-balance)} via API`;
}

function bnCloseLedger() {
  document.getElementById('bn-ledger-modal').classList.remove('open');
  bnActiveId = null;
}

function bnReleaseBond() {
  const agent = bnCurrentAgent();
  if (!bondHasAccess(agent.username)) { bnToast("You don't have access to release bonds.", true); return; }

  const btn = document.getElementById('bn-release-btn');
  const msg = document.getElementById('bn-ledger-msg');
  btn.disabled = true;
  btn.textContent = 'Contacting payment gateway…';
  msg.textContent = '';

  // Simula a latência da chamada à API do gateway
  setTimeout(() => {
    const res = bondReleaseRefund(bnActiveId, agent.name);
    if (res.error) {
      msg.textContent = res.error;
      bnRenderLedger();
      return;
    }
    bnRenderLedger();
    msg.textContent = `✓ ${feeMoney(res.amount)} refunded to the customer's card by ${agent.name}.`;
    renderBondsTable();
    bnToast(`Bond for #${res.rec.ref} released — balance due is now $0.00.`);
  }, 900);
}

// ------------------------------------------
// ACESSO (só Felipe e Alex)
// ------------------------------------------
function bnOpenAccess() {
  if (!bondIsAdmin(bnCurrentAgent().username)) return;
  const allowed = bondGetAccessList();
  document.getElementById('bn-access-list').innerHTML = Object.keys(validAgents).map(u => {
    const a = validAgents[u];
    const admin = bondIsAdmin(u);
    return `<label class="bn-access-row ${admin ? 'locked' : ''}">
      <input type="checkbox" value="${u}" ${allowed.includes(u) ? 'checked' : ''} ${admin ? 'disabled' : ''}>
      <span><strong>${bnEsc(a.name)}</strong><small>${bnEsc(a.role)} · ${u}</small></span>
      ${admin ? '<em>Admin</em>' : ''}
    </label>`;
  }).join('');
  document.getElementById('bn-access-modal').classList.add('open');
}

function bnCloseAccess() {
  document.getElementById('bn-access-modal').classList.remove('open');
}

function bnSaveAccess() {
  if (!bondIsAdmin(bnCurrentAgent().username)) return;
  const checked = Array.from(document.querySelectorAll('#bn-access-list input:checked')).map(i => i.value);
  bondSetAccessList(checked);
  bnCloseAccess();
  bnToast(`Access saved — ${bondGetAccessList().length} people can release bonds.`);
}

// Contador do menu e fila sempre atualizados (ex: booking devolvido no Fleet Planner em outra aba)
window.addEventListener('storage', e => {
  if (e.key === BOND_LEDGER_KEY) {
    bnUpdateMenuCount();
    if (document.getElementById('module-bonds').classList.contains('active')) renderBondsTable();
  }
  if (e.key === BOND_ACCESS_KEY) {
    try { applyAgentAccess(JSON.parse(localStorage.getItem(AGENT_PROFILE_KEY) || '{}')); } catch (err) {}
  }
});
window.addEventListener('DOMContentLoaded', bnUpdateMenuCount);
