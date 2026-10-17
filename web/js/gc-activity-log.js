// ==========================================
// ACTIVITY LOG — relatório de todas as alterações (quem, quando, o quê)
// Dados: fleetLogAll() em js/gc-fleet-data.js (histórico de exemplo + alterações gravadas)
// ?ref=<Res #> abre filtrado por uma reserva; ?rego=<placa> por um veículo
// ==========================================
const LG_PAGE = 200;
let lgShown = LG_PAGE;
let lgRows = [];

function lgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function lgDateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lgSetPeriod(p) {
  const from = document.getElementById('lg-from'), to = document.getElementById('lg-to');
  const today = fleetStartOfToday();
  if (p === 'all') { from.value = ''; to.value = ''; }
  else if (p === 'today') { from.value = lgDateInput(today); to.value = lgDateInput(today); }
  else if (p !== 'custom') { from.value = lgDateInput(today - (Number(p) - 1) * FLEET_DAY_MS); to.value = lgDateInput(today); }
  lgView(true);
}

function lgFillSelect(id, values, allLabel) {
  const el = document.getElementById(id);
  const cur = el.value;
  el.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option value="${lgEsc(v)}">${lgEsc(v)}</option>`).join('');
  if (values.includes(cur)) el.value = cur;
}

// Nome do cliente por reserva (para a busca e a coluna Customer)
function lgCustomerIndex() {
  const idx = {};
  fleetSeedBookings().forEach(s => { idx[s.id] = s.type === 'maintenance' ? '' : `${s.fname} ${s.lname}`; });
  fleetForEachStoredBooking(list => list.forEach(b => { idx[String(b.id)] = `${b.fname || ''} ${b.lname || ''}`.trim(); }));
  return idx;
}

function lgLoad() {
  lgRows = fleetLogAll();
  const ops = [...new Set(lgRows.map(e => e.operator || 'System'))].sort((a, b) => a.localeCompare(b));
  const acts = [...new Set(lgRows.map(e => e.action || 'Update'))].sort((a, b) => a.localeCompare(b));
  lgFillSelect('lg-operator', ops, 'All operators');
  lgFillSelect('lg-action', acts, 'All actions');
}

function lgFiltered() {
  const q = document.getElementById('lg-search').value.trim().toLowerCase();
  const qPlate = q.replace(/[\s-]/g, '');
  const op = document.getElementById('lg-operator').value;
  const act = document.getElementById('lg-action').value;
  const fromV = document.getElementById('lg-from').value, toV = document.getElementById('lg-to').value;
  const from = fromV ? new Date(fromV + 'T00:00').getTime() : -Infinity;
  const to = toV ? new Date(toV + 'T23:59:59').getTime() : Infinity;
  const staffOnly = document.getElementById('lg-staff').checked;
  const cust = lgCustomerIndex();

  return lgRows.filter(e => {
    if (e.at < from || e.at > to) return false;
    if (op && (e.operator || 'System') !== op) return false;
    if (act && (e.action || 'Update') !== act) return false;
    if (staffOnly && (!e.operator || e.operator === 'Online Booking' || e.operator === 'Customer (portal)')) return false;
    if (q) {
      const hay = [e.ref, e.operator, e.action, e.details, e.info, cust[e.bookingId]].join(' ').toLowerCase();
      if (!hay.includes(q) && !(qPlate.length >= 4 && String(e.plate || '').toLowerCase().includes(qPlate))) return false;
    }
    return true;
  }).map(e => ({ ...e, customer: cust[e.bookingId] || '' }));
}

function lgCanOpen(e) {
  const id = String(e.bookingId || '');
  return id && !id.startsWith('vehicle-') && !id.startsWith('bk-ext-') && !id.startsWith('bk-wh-');
}

function lgView(keepPeriod) {
  if (keepPeriod !== true) {
    // Mexeu nas datas à mão: período vira "Custom"
    const p = document.getElementById('lg-period');
    const ev = window.event;
    if (ev && ev.target && (ev.target.id === 'lg-from' || ev.target.id === 'lg-to')) p.value = 'custom';
  }
  lgShown = LG_PAGE;
  lgRender();
}

function lgRender() {
  const rows = lgFiltered();
  const box = document.getElementById('lg-results');
  const staff = rows.filter(e => e.operator && e.operator !== 'Online Booking' && e.operator !== 'Customer (portal)');
  const byOp = {};
  staff.forEach(e => { byOp[e.operator] = (byOp[e.operator] || 0) + 1; });
  const topOp = Object.entries(byOp).sort((a, b) => b[1] - a[1])[0];
  const bookings = new Set(rows.map(e => e.ref)).size;
  const last = rows[0];

  const fromV = document.getElementById('lg-from').value, toV = document.getElementById('lg-to').value;
  const fmtD = v => fleetFormatDate(new Date(v + 'T00:00').getTime());
  const scope = fromV || toV ? `${fromV ? fmtD(fromV) : 'start'} – ${toV ? fmtD(toV) : 'today'}` : 'All dates';

  const shown = rows.slice(0, lgShown);
  box.innerHTML = `
    <div class="lg-summary">
      <div class="lg-kpi"><span>Changes</span><strong>${rows.length}</strong><small>${lgEsc(scope)}</small></div>
      <div class="lg-kpi"><span>Bookings touched</span><strong>${bookings}</strong><small>Distinct Res #</small></div>
      <div class="lg-kpi"><span>Most active</span><strong>${topOp ? lgEsc(topOp[0]) : '—'}</strong><small>${topOp ? topOp[1] + ' change' + (topOp[1] === 1 ? '' : 's') : 'No staff changes'}</small></div>
      <div class="lg-kpi"><span>Last change</span><strong>${last ? lgEsc(last.operator || 'System') : '—'}</strong><small>${last ? fleetLogDateStr(last.at) + ' · ' + lgEsc(last.ref) : ''}</small></div>
    </div>
    <div class="log-table-wrap">
      <table class="log-table">
        <thead><tr><th>#</th><th>Res #</th><th>Rego</th><th>Customer</th><th>Operator</th><th>Date Updated</th><th>Action</th><th>Details</th><th>Rate</th><th>Info</th><th class="num">Total</th></tr></thead>
        <tbody>${shown.length ? shown.map((e, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="nowrap">${lgCanOpen(e) ? `<button type="button" class="lg-ref-btn" title="Open booking" onclick="fleetOpenBookingWindow('${lgEsc(e.bookingId)}')">${lgEsc(e.ref)}</button>` : `<span class="lg-ref">${lgEsc(e.ref)}</span>`}</td>
            <td class="nowrap">${e.plate && !fleetIsVirtualPlate(e.plate) ? `<span class="lg-plate">${lgEsc(e.plate)}</span>` : ''}</td>
            <td class="nowrap">${lgEsc(e.customer)}</td>
            <td class="op${e.operator ? '' : ' sys'}">${lgEsc(e.operator || 'System')}</td>
            <td class="nowrap">${fleetLogDateStr(e.at)}</td>
            <td>${e.action ? `<span class="log-act ${lgEsc(e.action.toLowerCase())}">${lgEsc(e.action)}</span>` : ''}</td>
            <td class="details">${lgEsc(e.details)}</td>
            <td class="nowrap">${lgEsc(e.rate)}</td>
            <td class="info">${lgEsc(e.info)}</td>
            <td class="num">${e.total != null ? '$' + Number(e.total).toFixed(2) : ''}</td>
          </tr>`).join('') : '<tr><td colspan="11" class="log-empty">No changes match these filters.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${rows.length > shown.length ? `<button type="button" class="da-nav-btn lg-more" onclick="lgShown += ${LG_PAGE}; lgRender()">Show more (${rows.length - shown.length} left)</button>` : ''}`;
}

function lgExport() {
  const rows = lgFiltered();
  const head = ['Res #', 'Rego', 'Customer', 'Operator', 'Date Updated', 'Action', 'Details', 'Rate', 'Info', 'Total'];
  const csv = [head, ...rows.map(e => [e.ref, e.plate, e.customer, e.operator || 'System', fleetLogDateStr(e.at), e.action, e.details, e.rate, e.info, e.total != null ? Number(e.total).toFixed(2) : ''])]
    .map(r => r.map(v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gc-activity-log-${lgDateInput(Date.now())}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function lgReset() {
  document.getElementById('lg-search').value = '';
  document.getElementById('lg-operator').value = '';
  document.getElementById('lg-action').value = '';
  document.getElementById('lg-staff').checked = false;
  document.getElementById('lg-period').value = '7';
  history.replaceState(null, '', location.pathname);
  lgSetPeriod('7');
}

function lgInit() {
  lgLoad();
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref') || params.get('rego');
  if (ref) {
    // Uma reserva / um veículo: mostra o histórico inteiro, sem limite de datas
    document.getElementById('lg-search').value = ref;
    document.getElementById('lg-period').value = 'all';
    lgSetPeriod('all');
  } else {
    lgSetPeriod('7');
  }
}

// Voltou para a aba (ex.: alterou uma reserva na janela do booking): recarrega
window.addEventListener('focus', () => { lgLoad(); lgRender(); });
window.addEventListener('storage', e => { if (e.key === FLEET_LOG_KEY) { lgLoad(); lgRender(); } });

lgInit();
