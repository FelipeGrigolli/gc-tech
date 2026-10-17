// ==========================================
// TOLLS — pedágios das locações
// Política aprovada da GC Tech:
//  • Pedágios não estão incluídos na locação.
//  • Processado pela GC Tech: custo do pedágio + $4.40 de taxa administrativa por pedágio.
//  • Pode levar até 7 dias para o pedágio chegar à GC Tech; depois é cobrado no cartão da locação.
//  • Cartão recusado: $5.50 de taxa de reprocessamento por pedágio não pago (no lugar dos $4.40).
//  • Cobrança judicial (debt collection): + $16.50 por pedágio em aberto.
//  • O cliente pode usar a própria tag ou um passe temporário Linkt.
// ⚠️ SIMULADO: os pedágios de exemplo e o "extrato" importado são gerados a partir das locações
// de demonstração. Na versão real o extrato vem do Linkt / operadoras e é casado pela placa e pelo horário.
// Depende de: gc-fleet-data.js, gc-powerboard.js, gc-ui.js
// ==========================================

const TOLL_KEY = 'gc_tolls';   // { items: [pedágios importados/manuais], state: { tollId: { status, fee, chargedAt, chargeId, by } } }
const TOLL_FEE_ADMIN = 4.40;
const TOLL_FEE_DECLINE = 5.50;
const TOLL_FEE_COLLECTION = 16.50;
const TOLL_ROADS = {
  SYD: [['WestConnex M8', 7.12], ['M5 South-West', 5.31], ['Eastern Distributor', 9.18], ['Sydney Harbour Bridge', 4.00], ['Lane Cove Tunnel', 3.94],
        ['M2 Hills Motorway', 9.84], ['M7 Westlink', 9.05], ['NorthConnex', 9.06], ['Cross City Tunnel', 6.79], ['WestConnex M4', 6.50]],
  BNE: [['Gateway Motorway', 5.35], ['Logan Motorway', 3.62], ['Clem7 Tunnel', 6.20], ['Legacy Way', 6.20], ['AirportlinkM7', 6.73], ['Go Between Bridge', 3.68]]
};

function tollEsc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function tollMoney(n) { return '$' + (Number(n) || 0).toFixed(2); }
function tollRead() { try { const v = JSON.parse(localStorage.getItem(TOLL_KEY) || '{}') || {}; return { items: v.items || [], state: v.state || {} }; } catch (e) { return { items: [], state: {} }; } }
function tollWrite(v) { localStorage.setItem(TOLL_KEY, JSON.stringify(v)); }
function tollWhen(ms) { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${FLEET_MONTHS[d.getMonth()]} ${fleetFormatTime(ms)}`; }
function tollCity(plate) { const v = fleetGetVehicle(plate); return v && ['EGF', 'WGB'].includes(v.branch) ? 'BNE' : 'SYD'; }

// ---------- Casar pedágio com a locação (placa + horário) ----------
function tollRentals() {
  const out = [];
  fleetSeedBookings().forEach(s => { if (s.type !== 'maintenance') out.push({ id: s.id, ref: s.ref, plate: s.plate, start: s.startMs, end: s.endMs, customer: `${s.fname} ${s.lname}` }); });
  fleetForEachStoredBooking(list => list.forEach(b => {
    if (!b.plate || b.status === 'cancelled' || fleetIsVirtualPlate(b.plate)) return;
    const r = fleetBookingRange(b);
    out.push({ id: String(b.id), ref: b.ref, plate: b.plate, start: r.start, end: r.end, customer: `${b.fname || ''} ${b.lname || ''}`.trim() });
  }));
  if (typeof BOND_SEED_RETURNED !== 'undefined') BOND_SEED_RETURNED.forEach(r => out.push({ id: r.id, ref: r.ref, plate: r.plate, start: r.pickupMs, end: r.dropoffMs, customer: `${r.fname} ${r.lname}` }));
  return out;
}

function tollMatch(plate, at, rentals) {
  return (rentals || tollRentals()).find(r => r.plate === plate && at >= r.start - 30 * 60000 && at <= r.end + 60 * 60000) || null;
}

// ---------- Pedágios de exemplo (locações dos últimos dias) ----------
let tollSeedCache = null;
function tollSeeds() {
  const key = Math.floor(Date.now() / 60000);
  if (tollSeedCache && tollSeedCache.key === key) return tollSeedCache.list;
  const now = Date.now();
  const from = now - 12 * FLEET_DAY_MS;
  const list = [];
  tollRentals().filter(r => r.start < now && r.end > from && r.id.indexOf('main-') !== 0).forEach(r => {
    const h = fleetHash('toll:' + r.id);
    const n = h % 4 === 0 ? 0 : 1 + h % 3;
    const roads = TOLL_ROADS[tollCity(r.plate)];
    for (let i = 0; i < n; i++) {
      const at = r.start + Math.floor((Math.min(r.end, now) - r.start) * ((i + 1) / (n + 1)));
      const [road, base] = roads[(h >>> (3 + i * 4)) % roads.length];
      const received = at + (1 + (h >>> (i + 2)) % 6) * FLEET_DAY_MS;
      if (received > now) continue;
      list.push({ id: `toll-${r.id}-${i}`, plate: r.plate, at, road, amount: Math.round(base * 100) / 100, receivedAt: received,
        bookingId: r.id, ref: r.ref, seed: true });
    }
  });
  tollSeedCache = { key, list };
  return list;
}

// Todos os pedágios com o status atual (os de exemplo mais antigos já foram cobrados)
// Como hoje no sistema de pagamentos: o relatório do dia é enviado (upload), cada pedágio é ligado à
// reserva pela placa e horário ("matched") ou fica "imported" esperando alguém fazer o Assign,
// e os "matched" são cobrados automaticamente durante a noite.
function tollAll() {
  const { items, state } = tollRead();
  const today0 = fleetStartOfToday();
  return tollSeeds().concat(items).map(t => {
    const st = state[t.id] || null;
    const base = st && 'bookingId' in st ? { ...t, bookingId: st.bookingId, ref: st.ref } : t;
    let status = st && st.status ? st.status : (base.bookingId ? 'pending' : 'unmatched');
    let chargedAt = st ? st.chargedAt : null, by = st ? st.by : '';
    // Já passou uma noite desde o upload: a cobrança automática já rodou
    if ((!st || !st.status) && status === 'pending' && t.receivedAt < today0) {
      const night = new Date(t.receivedAt); night.setDate(night.getDate() + 1); night.setHours(2, 0, 0, 0);
      const card = typeof pbSelectedCard === 'function' ? pbSelectedCard(base.bookingId) : null;
      // Cartão vencido: a cobrança da noite foi recusada
      if (card && pbCardExpired(card)) { status = 'declined'; by = 'Overnight run'; }
      else { status = 'charged'; chargedAt = night.getTime(); by = 'Overnight run'; }
    }
    return { ...base, status, chargedAt, by, importName: t.importName || tollImportNameFor(t.receivedAt) };
  }).sort((a, b) => b.at - a.at);
}

function tollImportNameFor(ms) {
  const d = new Date(ms);
  return `AIMS_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_daily.csv`;
}

// Assign / Reassign / Unassign: liga o pedágio a outra reserva (ou a nenhuma)
function tollAssign(id, bookingId) {
  const info = bookingId ? pbBookingInfo(bookingId) : null;
  const t = tollAll().find(x => x.id === id);
  if (!t) return;
  tollSetState([id], info ? { bookingId: String(bookingId), ref: info.ref, status: 'pending' } : { bookingId: '', ref: '', status: 'unmatched' });
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: info ? bookingId : (t.bookingId || 'tolls'), ref: info ? info.ref : (t.ref || 'TOLLS'), plate: t.plate, action: 'Toll',
      details: info ? `Toll ${t.road} ${tollWhen(t.at)} ${t.bookingId ? 'reassigned' : 'assigned'} to ${info.ref}` : `Toll ${t.road} ${tollWhen(t.at)} unassigned from ${t.ref}`,
      info: info ? 'Charged tonight with the other matched tolls' : 'Back to imported' });
  }
}

function tollsForBooking(bookingId) { return tollAll().filter(t => t.bookingId === String(bookingId)); }

// Valor devido por pedágio conforme o status
function tollFee(t) { return t.status === 'declined' || t.status === 'collections' ? TOLL_FEE_DECLINE : TOLL_FEE_ADMIN; }
function tollOwed(t) { return t.amount + tollFee(t) + (t.status === 'collections' ? TOLL_FEE_COLLECTION : 0); }

function tollSetState(ids, patch) {
  const v = tollRead();
  ids.forEach(id => { v.state[id] = { ...(v.state[id] || {}), ...patch }; });
  tollWrite(v);
}

// ---------- Cobrar os pedágios de uma locação no cartão dela ----------
function tollChargeBooking(bookingId, ids, by) {
  const list = tollsForBooking(bookingId).filter(t => (t.status === 'pending' || t.status === 'declined') && (!ids || ids.includes(t.id)));
  if (!list.length) return { error: 'No tolls to charge on this booking.' };
  const total = list.reduce((s, t) => s + t.amount + (t.status === 'declined' ? TOLL_FEE_DECLINE : TOLL_FEE_ADMIN), 0);
  const res = pbCharge(bookingId, total, 'toll', `${list.length} toll${list.length > 1 ? 's' : ''}`);
  const agent = by || pbAgent();
  if (res.error) return res;
  const info = pbBookingInfo(bookingId);
  if (res.declined) {
    tollSetState(list.map(t => t.id), { status: 'declined', by: agent, declinedAt: Date.now() });
    if (typeof fleetLog === 'function') fleetLog({ bookingId, ref: info.ref, plate: info.plate, action: 'Toll', details: `${list.length} toll${list.length > 1 ? 's' : ''} declined on ${pbBrandLabel(res.card.brand)} ending ${res.card.last4}`, info: `$${TOLL_FEE_DECLINE.toFixed(2)} reprocessing fee per unpaid toll` });
  } else {
    tollSetState(list.map(t => t.id), { status: 'charged', by: agent, chargedAt: Date.now(), chargeId: res.charge.id });
    if (typeof fleetLog === 'function') fleetLog({ bookingId, ref: info.ref, plate: info.plate, action: 'Toll', details: `${list.length} toll${list.length > 1 ? 's' : ''} charged: ${list.map(t => t.road).join(', ')}`, info: `cost + $${TOLL_FEE_ADMIN.toFixed(2)} admin fee per toll`, total: Math.round(total * 100) / 100 });
  }
  return { ...res, count: list.length, total };
}

function tollSendToCollections(id) {
  const t = tollAll().find(x => x.id === id);
  if (!t || t.status !== 'declined') return;
  tollSetState([id], { status: 'collections', by: pbAgent(), collectionsAt: Date.now() });
  if (typeof fleetLog === 'function') fleetLog({ bookingId: t.bookingId, ref: t.ref, plate: t.plate, action: 'Toll', details: `Toll sent to debt collection: ${t.road} ${tollWhen(t.at)}`, info: `+$${TOLL_FEE_COLLECTION.toFixed(2)} administration fee`, total: Math.round(tollOwed({ ...t, status: 'collections' }) * 100) / 100 });
}

// Pedágio lançado à mão (ex.: aviso de multa/pedágio que chegou por e-mail)
function tollAddManual(bookingId, road, at, amount) {
  const info = pbBookingInfo(bookingId);
  if (!info) return null;
  const v = tollRead();
  const t = { id: 'toll-m-' + Date.now().toString(36), plate: info.plate, at, road, amount: Math.round(amount * 100) / 100, receivedAt: Date.now(), bookingId: String(bookingId), ref: info.ref, manual: true };
  v.items.push(t);
  tollWrite(v);
  if (typeof fleetLog === 'function') fleetLog({ bookingId, ref: info.ref, plate: info.plate, action: 'Toll', details: `Toll added: ${road} ${tollWhen(at)} ${tollMoney(t.amount)}`, info: 'Entered manually' });
  return t;
}

// "Importar extrato": gera pedágios novos das locações recentes, já casados pela placa e horário
function tollImportStatement(fileName) {
  const now = Date.now();
  const importName = fileName || tollImportNameFor(now);
  const rentals = tollRentals();
  const recent = rentals.filter(r => r.start < now && r.end > now - 7 * FLEET_DAY_MS);
  const v = tollRead();
  const batch = 'stmt-' + now.toString(36);
  const picks = recent.sort((a, b) => fleetHash(a.id + batch) - fleetHash(b.id + batch)).slice(0, 6);
  let matched = 0;
  picks.forEach((r, i) => {
    const roads = TOLL_ROADS[tollCity(r.plate)];
    const [road, base] = roads[(fleetHash(batch + i) >>> 3) % roads.length];
    const at = r.start + Math.floor((Math.min(r.end, now) - r.start) * (0.3 + (i % 3) * 0.2));
    const m = tollMatch(r.plate, at, rentals);
    v.items.push({ id: `${batch}-${i}`, plate: r.plate, at, road, amount: base, receivedAt: now, bookingId: m ? m.id : '', ref: m ? m.ref : '', statement: batch, importName });
    if (m) matched++;
  });
  // Um pedágio de um carro que não estava alugado naquele horário (ex.: transferência entre filiais)
  const v0 = FLEET_VEHICLES[fleetHash(batch) % FLEET_VEHICLES.length];
  const atU = now - 2 * FLEET_DAY_MS - 5 * 3600000;
  const mU = tollMatch(v0.plate, atU, rentals);
  const [roadU, baseU] = TOLL_ROADS[tollCity(v0.plate)][0];
  v.items.push({ id: `${batch}-u`, plate: v0.plate, at: atU, road: roadU, amount: baseU, receivedAt: now, bookingId: mU ? mU.id : '', ref: mU ? mU.ref : '', statement: batch, importName });
  if (mU) matched++;
  tollWrite(v);
  const total = picks.length + 1;
  if (typeof fleetLog === 'function') fleetLog({ bookingId: 'tolls-' + batch, ref: 'TOLLS', action: 'Toll', details: `Toll report uploaded (${importName}): ${total} tolls, ${matched} matched to bookings by rego and time`, info: `${total - matched} imported without a booking · matched tolls charge tonight` });
  return { total, matched };
}

// ---------- Painel "Tolls for this booking" (aba Payments do Planner) ----------
let tollPanelState = null;
function tollRenderBookingPanel(containerId, bookingId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  tollPanelState = { containerId, bookingId };
  const list = tollsForBooking(bookingId);
  const open = list.filter(t => t.status === 'pending' || t.status === 'declined');
  const openTotal = open.reduce((s, t) => s + t.amount + tollFee(t), 0);
  const roads = TOLL_ROADS[tollCity((pbBookingInfo(bookingId) || {}).plate)];
  box.innerHTML = `
    <section class="pb-card">
      <div class="pb-head"><h3>Tolls for this booking</h3>
        <span class="pb-muted small">cost + ${tollMoney(TOLL_FEE_ADMIN)} per toll · ${tollMoney(TOLL_FEE_DECLINE)} if the card declines</span></div>
      ${list.length ? `<div class="pb-table-wrap"><table class="pb-table">
        <thead><tr><th>When</th><th>Toll road</th><th>Rego</th><th class="r">Toll</th><th class="r">Fee</th><th>Status</th></tr></thead>
        <tbody>${list.map(t => `<tr><td class="nw">${tollWhen(t.at)}</td><td>${tollEsc(t.road)}</td><td class="nw">${tollEsc(t.plate)}</td>
          <td class="r">${tollMoney(t.amount)}</td><td class="r">${tollMoney(tollFee(t))}${t.status === 'collections' ? ` + ${tollMoney(TOLL_FEE_COLLECTION)}` : ''}</td>
          <td>${tollStatusPill(t)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="pb-muted">No tolls for this booking.</p>'}
      <div class="pb-actions">
        ${open.length ? `<button type="button" class="pb-btn primary" onclick="tollChargeFromPanel()">Charge now · ${open.length} toll${open.length > 1 ? 's' : ''} · ${tollMoney(openTotal)}</button><span class="pb-muted small">otherwise charged tonight automatically</span>` : ''}
        <button type="button" class="pb-btn ghost" onclick="document.getElementById('toll-add-box').hidden = false">＋ Add toll</button>
      </div>
      <div class="toll-add" id="toll-add-box" hidden>
        <select id="toll-add-road">${roads.map(([r, a]) => `<option value="${tollEsc(r)}" data-amount="${a}">${tollEsc(r)}</option>`).join('')}</select>
        <input type="datetime-local" id="toll-add-at">
        <input type="number" id="toll-add-amount" step="0.01" min="0" placeholder="Toll amount">
        <button type="button" class="pb-btn" onclick="tollAddFromPanel()">Add</button>
      </div>
    </section>`;
}

function tollStatusPill(t) {
  return {
    pending: '<span class="pb-st warn">Matched</span><small class="pb-muted"> · charges tonight</small>',
    charged: `<span class="pb-st ok">Charged</span>${t.by ? `<small class="pb-muted"> · ${tollEsc(t.by)}</small>` : ''}`,
    declined: '<span class="pb-st bad">Card declined</span>',
    collections: '<span class="pb-st bad">Debt collection</span>',
    unmatched: '<span class="pb-st muted">Imported</span><small class="pb-muted"> · needs a booking</small>'
  }[t.status] || t.status;
}

function tollChargeFromPanel() {
  if (!tollPanelState) return;
  const res = tollChargeBooking(tollPanelState.bookingId);
  if (res.error) { gcToast(res.error, 'warning'); return; }
  if (res.declined) gcToast(`Card declined\n\n${pbBrandLabel(res.card.brand)} ending ${res.card.last4} has expired. Each unpaid toll now carries the ${tollMoney(TOLL_FEE_DECLINE)} reprocessing fee. Add a new card or send a payment method request.`, 'error');
  else gcToast(`${res.count} toll${res.count > 1 ? 's' : ''} charged · ${tollMoney(res.total)}`, 'success');
  pbRefresh(tollPanelState.bookingId);
}

function tollAddFromPanel() {
  const road = document.getElementById('toll-add-road');
  const atVal = document.getElementById('toll-add-at').value;
  const amountEl = document.getElementById('toll-add-amount');
  const amount = Number(amountEl.value || road.selectedOptions[0].dataset.amount);
  if (!atVal) { gcToast('Enter the date and time of the toll.', 'warning'); return; }
  if (!(amount > 0)) { gcToast('Enter the toll amount.', 'warning'); return; }
  tollAddManual(tollPanelState.bookingId, road.value, new Date(atVal).getTime(), amount);
  gcToast('Toll added to the booking.', 'success');
  pbRefresh(tollPanelState.bookingId);
}

// Painéis abertos se redesenham depois de qualquer cobrança
function pbAfterCharge(bookingId) {
  if (tollPanelState && tollPanelState.bookingId === bookingId) tollRenderBookingPanel(tollPanelState.containerId, bookingId);
  if (typeof plannerAfterPayment === 'function') plannerAfterPayment(bookingId);
  if (typeof tollPageRender === 'function' && document.getElementById('tl-results')) tollPageRender();
}

// ==========================================
// PÁGINA TOLLS (pages/gc-tolls.html)
// ==========================================
let tollFilter = { status: 'open', q: '' };

function tollPageRender() {
  const box = document.getElementById('tl-results');
  if (!box) return;
  const all = tollAll();
  const now = Date.now();
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0);
  const pending = all.filter(t => t.status === 'pending');
  const declined = all.filter(t => t.status === 'declined');
  const coll = all.filter(t => t.status === 'collections');
  const unmatched = all.filter(t => t.status === 'unmatched');
  const charged30 = all.filter(t => t.status === 'charged' && t.chargedAt && t.chargedAt > now - 30 * FLEET_DAY_MS);

  document.getElementById('tl-kpis').innerHTML = [
    { l: 'Imported · needs a booking', v: unmatched.length, s: 'Assign them to a hire', c: unmatched.length ? 'warn' : 'good' },
    { l: 'Matched · charges tonight', v: pending.length, s: tollMoney(sum(pending, t => t.amount + TOLL_FEE_ADMIN)) + ' incl. fees' },
    { l: 'Card declined', v: declined.length, s: tollMoney(sum(declined, tollOwed)) + ' owed', c: declined.length ? 'bad' : '' },
    { l: 'Debt collection', v: coll.length, s: tollMoney(sum(coll, tollOwed)) + ' owed' },
    { l: 'Charged · 30 days', v: tollMoney(sum(charged30, t => t.amount + TOLL_FEE_ADMIN)), s: `${tollMoney(charged30.length * TOLL_FEE_ADMIN)} in processing fees` }
  ].map(k => `<div class="tl-kpi ${k.c || ''}"><span>${k.l}</span><strong>${k.v}</strong><small>${k.s}</small></div>`).join('');
  const charged = all.filter(t => t.status === 'charged');
  const sumEl = document.getElementById('tl-summary');
  if (sumEl) sumEl.innerHTML = `<b>Total</b> · Toll fees ${tollMoney(sum(all, t => t.amount))} · Charged fees ${tollMoney(sum(charged, t => t.amount + TOLL_FEE_ADMIN))} · GC Tech processing fees ${tollMoney(charged.length * TOLL_FEE_ADMIN)} · across ${all.length} tolls`;

  const q = tollFilter.q.trim().toLowerCase();
  const rows = all.filter(t => {
    if (tollFilter.status === 'open' && !['pending', 'declined', 'unmatched'].includes(t.status)) return false;
    if (!['open', 'all'].includes(tollFilter.status) && t.status !== tollFilter.status) return false;
    if (!q) return true;
    return [t.ref, t.plate, t.road, t.importName, (tollRentals().find(r => r.id === t.bookingId) || {}).customer].join(' ').toLowerCase().includes(q);
  });
  const rentals = tollRentals();

  box.innerHTML = `
    <div class="pb-table-wrap tl-table"><table class="pb-table">
      <thead><tr><th>Trip date</th><th>Toll road</th><th>Rego</th><th>Booking</th><th>Customer</th><th class="r">Toll</th><th class="r">Fee</th><th class="r">Owed</th><th>Status</th><th>Import</th><th>Actions</th></tr></thead>
      <tbody>${rows.map(t => {
        const r = rentals.find(x => x.id === t.bookingId);
        const owed = t.status === 'charged' ? 0 : tollOwed(t);
        const id = tollEsc(t.id);
        let act = '';
        if (t.status === 'unmatched') act = `<button type="button" class="tl-act" onclick="tollPageAssign('${id}')">Assign</button>`;
        else if (t.status === 'pending') act = `<button type="button" class="tl-act" onclick="tollPageAssign('${id}')">Reassign</button> <button type="button" class="tl-act warn" onclick="tollPageUnassign('${id}')">Unassign</button>`;
        else if (t.status === 'declined') act = `<button type="button" class="tl-act" onclick="tollPageCharge('${tollEsc(t.bookingId)}')">Retry</button> <button type="button" class="tl-act warn" onclick="tollPageCollections('${id}')">Debt collection</button>`;
        return `<tr class="${t.status}">
          <td class="nw">${tollWhen(t.at)}</td>
          <td>${tollEsc(t.road)}</td><td class="nw"><span class="tl-plate">${tollEsc(t.plate)}</span></td>
          <td class="nw">${t.bookingId ? `<button type="button" class="tl-link" onclick="fleetOpenBookingWindow('${tollEsc(t.bookingId)}')">${tollEsc(t.ref)}</button>` : '<span class="pb-muted">—</span>'}</td>
          <td>${r ? tollEsc(r.customer) : '<span class="pb-muted">Not on hire at this time</span>'}</td>
          <td class="r">${tollMoney(t.amount)}</td><td class="r">${t.status === 'unmatched' ? '—' : tollMoney(tollFee(t)) + (t.status === 'collections' ? ' + ' + tollMoney(TOLL_FEE_COLLECTION) : '')}</td>
          <td class="r">${t.status === 'unmatched' ? '—' : owed ? tollMoney(owed) : '<span class="pb-muted">paid</span>'}</td>
          <td>${tollStatusPill(t)}</td><td class="nw pb-muted">${tollEsc(t.importName)}</td><td class="nw">${act || '<span class="pb-muted">—</span>'}</td></tr>`;
      }).join('') || '<tr><td colspan="11" class="tl-empty">No tolls match these filters.</td></tr>'}</tbody>
    </table></div>
    <p class="tl-count">${rows.length} toll${rows.length === 1 ? '' : 's'}</p>`;
}

function tollPageCharge(bookingId) {
  const res = tollChargeBooking(bookingId);
  if (res.error) { gcToast(res.error, 'warning'); return; }
  if (res.declined) gcToast(`Card declined for booking ${pbBookingInfo(bookingId).ref}\n\nThe card on file has expired. The ${tollMoney(TOLL_FEE_DECLINE)} reprocessing fee now applies to each unpaid toll.`, 'error');
  else gcToast(`${res.count} toll${res.count > 1 ? 's' : ''} charged · ${tollMoney(res.total)}`, 'success');
  tollPageRender();
}

// Demo: roda agora o que o sistema faz sozinho durante a noite
async function tollPageRunTonight() {
  const ids = [...new Set(tollAll().filter(t => t.status === 'pending').map(t => t.bookingId))];
  if (!ids.length) { gcToast('No matched tolls waiting for tonight.', 'info'); return; }
  const ok = await gcConfirm({ title: `Run tonight's toll charges now?`, message: `Demo only. Every night the system charges each matched toll to the card on the booking (toll + ${tollMoney(TOLL_FEE_ADMIN)}). Nobody needs to press this. ${ids.length} booking${ids.length > 1 ? 's' : ''} waiting.`, confirmText: 'Run now', kind: 'info' });
  if (!ok) return;
  let okCount = 0, declined = 0, total = 0;
  ids.forEach(id => { const r = tollChargeBooking(id, null, 'Overnight run'); if (r.ok) { okCount++; total += r.total; } else if (r.declined) declined++; });
  gcToast(`Overnight run finished\n\nTolls charged on ${okCount} booking${okCount === 1 ? '' : 's'} · ${tollMoney(total)}` + (declined ? `\n${declined} card${declined > 1 ? 's' : ''} declined — see "Card declined".` : ''), declined ? 'warning' : 'success');
  tollPageRender();
}

// Assign / Reassign: escolhe a reserva (mesma placa primeiro, ou pelo Res #)
function tollPageAssign(id) {
  const t = tollAll().find(x => x.id === id);
  if (!t) return;
  const rentals = tollRentals();
  const samePlate = rentals.filter(r => r.plate === t.plate && r.id !== t.bookingId)
    .sort((a, b) => Math.abs((a.start + a.end) / 2 - t.at) - Math.abs((b.start + b.end) / 2 - t.at)).slice(0, 6);
  const fmtD = ms => new Date(ms).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
  document.getElementById('tl-dlg')?.remove();
  const dlg = document.createElement('div');
  dlg.id = 'tl-dlg';
  dlg.className = 'tl-dlg-back';
  dlg.innerHTML = `<div class="tl-dlg">
    <h3>${t.bookingId ? 'Reassign' : 'Assign'} toll</h3>
    <p class="pb-muted">${tollEsc(t.road)} · <span class="tl-plate">${tollEsc(t.plate)}</span> · ${tollWhen(t.at)} · ${tollMoney(t.amount)}</p>
    ${samePlate.length ? `<p class="tl-dlg-sub">Bookings on this rego</p><div class="tl-dlg-list">${samePlate.map(r => `
      <button type="button" class="tl-dlg-opt" onclick="tollPageAssignDo('${tollEsc(id)}','${tollEsc(r.id)}')">
        <b>${tollEsc(r.ref)}</b> ${tollEsc(r.customer)}<small>${fmtD(r.start)} → ${fmtD(r.end)}</small></button>`).join('')}</div>` : ''}
    <p class="tl-dlg-sub">Or enter a Res #</p>
    <div class="tl-dlg-row"><input type="text" id="tl-dlg-ref" placeholder="e.g. GC-8832"><button type="button" class="pb-btn primary small" onclick="tollPageAssignRef('${tollEsc(id)}')">Assign</button></div>
    <div class="tl-dlg-foot"><button type="button" class="pb-btn ghost small" onclick="document.getElementById('tl-dlg').remove()">Cancel</button></div>
  </div>`;
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  document.body.appendChild(dlg);
  document.getElementById('tl-dlg-ref').focus();
}

function tollPageAssignRef(id) {
  const ref = document.getElementById('tl-dlg-ref').value.trim().toUpperCase();
  const r = tollRentals().find(x => String(x.ref).toUpperCase() === ref);
  if (!r) { gcToast(`No booking found with Res # ${ref || '(empty)'}.`, 'warning'); return; }
  tollPageAssignDo(id, r.id);
}

function tollPageAssignDo(id, bookingId) {
  tollAssign(id, bookingId);
  document.getElementById('tl-dlg')?.remove();
  gcToast(`Toll assigned to ${pbBookingInfo(bookingId).ref}\n\nIt will be charged tonight with the other matched tolls.`, 'success');
  tollPageRender();
}

async function tollPageUnassign(id) {
  const t = tollAll().find(x => x.id === id);
  if (!t) return;
  const ok = await gcConfirm({ title: 'Unassign this toll?', message: `It will no longer be charged to ${t.ref} tonight and goes back to "Imported · needs a booking".`, confirmText: 'Unassign', danger: true });
  if (!ok) return;
  tollAssign(id, '');
  tollPageRender();
}

async function tollPageCollections(id) {
  const ok = await gcConfirm({ title: 'Send this toll to debt collection?', message: `A ${tollMoney(TOLL_FEE_COLLECTION)} administration fee is added on top of the toll and the ${tollMoney(TOLL_FEE_DECLINE)} reprocessing fee.`, confirmText: 'Send to debt collection', danger: true });
  if (!ok) return;
  tollSendToCollections(id);
  tollPageRender();
}

// Upload do relatório diário (no demo o conteúdo do arquivo não é lido; só o nome)
function tollPageImport(fileName) {
  const res = tollImportStatement(fileName);
  tollFilter.status = 'open';
  const sel = document.getElementById('tl-status'); if (sel) sel.value = 'open';
  gcToast(`Toll report uploaded\n\n${res.total} tolls · ${res.matched} matched by rego and time, charged tonight automatically${res.total - res.matched ? ` · ${res.total - res.matched} need a booking (Assign)` : ''}.`, 'success');
  tollPageRender();
}

function tollPageUploadPicked(input) {
  const f = input.files && input.files[0];
  input.value = '';
  tollPageImport(f ? f.name : undefined);
}

if (document.getElementById('tl-results')) {
  window.addEventListener('focus', tollPageRender);
  document.addEventListener('DOMContentLoaded', tollPageRender);
  if (document.readyState !== 'loading') tollPageRender();
}
