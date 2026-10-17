const DAMAGE_STORAGE_KEY = 'gc_damage_reports';
const DAMAGE_SEEDED_KEY = 'gc_damage_seeded_v2';
const DAMAGE_SEED_VERSION = '4';
let allDamageReports = [];

// ==========================================
// RELATÓRIOS DE EXEMPLO — ligados a reservas reais da demo (mesma placa, cliente e datas)
// booking: reserva fixa do Planner · bond: reserva devolvida da fila do Bond Refunds ·
// sem os dois: uma reserva retirada/devolvida da categoria (cat).
// charged: a taxa já está no Booking Fees da reserva (gc-fleet-data.js / gc-bonds.js),
// com o mesmo valor; o bond abate o dano e o resto, quando há, está num Payment Plan (gc-payments.js).
// ==========================================
const DC_SEED_INCIDENTS = [
  { fault: 'No', quote: 'Yes', status: 'Open', cat: 'small', dayAfterStart: 1,
    description: 'Rear-ended at the traffic lights on Canterbury Rd while stopped. Rear bumper cracked and boot lid misaligned. Police event number E-58213. Vehicle still drivable, returned early.',
    thirdParty: { name: 'Daniel Moretti', phone: '0413 552 908', insuranceCo: 'NRMA Insurance', claimNo: 'NRMA-CLM-77412' },
    docs: ['police-event-E58213.pdf', 'rear-bumper-photos.zip', 'other-driver-licence.jpg'] },
  { fault: 'No', quote: 'Yes', status: 'Quoted', cat: 'suv', dayAfterStart: 2, amount: 380, fee: 'windscreen',
    description: 'Stone chip on the windscreen from a truck on the M5, driver side, about 2 cm with a small crack starting. Quote from O\'Brien Glass: $380 to replace. No third party to claim from.',
    docs: ['windscreen-chip.jpg', 'obrien-glass-quote-380.pdf'] },
  { fault: 'Yes', quote: 'Yes', status: 'Quoted', booking: 'bk-truck-0', dayAfterStart: 1, amount: 1240, fee: 'damage-ext', charged: true,
    description: 'Tail-lift platform bent after hitting a loading dock edge while reversing. Lift still works but does not sit flat. Repair quote $1,240 (parts + labour). $400 of the bond kept towards it; the customer pays the other $840 on a weekly payment plan. Repair booked.',
    docs: ['tail-lift-damage-1.jpg', 'tail-lift-damage-2.jpg', 'truck-repairs-quote-1240.pdf'] },
  { fault: 'Yes', quote: 'Yes', status: 'Quoted', booking: 'bk-truck-1', dayAfterStart: 0, amount: 2800, fee: 'damage-ext', charged: true,
    description: 'Roof of the box scraped on the height bar of a shopping centre car park (2.1 m). Long scratches and a dent above the rear roller door. Panel shop quote $2,800. $400 of the bond kept towards it; the other $2,400 on a weekly payment plan.',
    docs: ['roof-scrape-photos.zip', 'panel-shop-quote-2800.pdf'] },
  { fault: 'Yes', quote: 'No', status: 'Closed', bond: 'old-6', dayAfterStart: 1, amount: 120, fee: 'damage-ext', charged: true,
    description: 'Front left alloy wheel scuffed on a kerb. Refurbished in-house for $120, taken from the bond at return. Customer agreed at the counter.',
    docs: ['wheel-kerb-damage.jpg', 'bond-deduction-receipt.pdf'] },
  { fault: 'Undetermined', quote: 'Yes', status: 'Open', cat: 'any', dayAfterStart: 2,
    description: 'Hail damage while parked at the customer\'s home in Parramatta during the storm. Multiple small dents on the bonnet and roof. Lodged with GC Tech\'s fleet insurer, assessor booked.',
    thirdParty: { name: '', phone: '', insuranceCo: 'Allianz (GC Tech fleet policy)', claimNo: 'ALZ-FL-302118' },
    docs: ['hail-dents-bonnet.jpg', 'hail-dents-roof.jpg', 'bom-storm-report.pdf'] },
  { fault: 'No', quote: 'Yes', status: 'Quoted', cat: 'ute', dayAfterStart: 1, amount: 295, fee: 'damage-ext',
    description: 'Passenger side mirror clipped by a passing truck on a narrow road. Mirror housing broken, glass intact. Other driver stopped and gave details. Quote $295.',
    thirdParty: { name: 'Westside Haulage Pty Ltd', phone: '02 9644 1180', insuranceCo: 'QBE', claimNo: 'QBE-55902741' },
    docs: ['mirror-damage.jpg', 'mirror-quote-295.pdf'] },
  { fault: 'Yes', quote: 'No', status: 'Closed', bond: 'old-4', dayAfterStart: 1, amount: 300, fee: 'smoking', charged: true,
    description: 'Cigarette burn on the rear seat and smell of smoke at return. Smoking fee $300 applied as per the rental terms and taken from the bond.',
    docs: ['seat-burn.jpg'] },
  { fault: 'Undetermined', quote: 'No', status: 'Open', cat: 'any', dayAfterStart: 1,
    description: 'Dent in the rear passenger door found at return. Customer says it happened in a car park and nobody left a note. Waiting for the customer\'s written statement.',
    docs: [] },
  { fault: 'Yes', quote: 'Yes', status: 'Closed', booking: 'bk-or7716', dayAfterStart: 1, amount: 1650, fee: 'damage-ext', charged: true,
    description: 'Front left bumper and headlight hit a pole while turning into a loading zone. Repaired by the panel shop for $1,650. $400 of the bond kept towards it; the other $1,250 on a weekly payment plan.',
    docs: ['front-bumper-photos.zip', 'panel-shop-invoice-1650.pdf'] },
  { fault: 'Yes', quote: 'Yes', status: 'Closed', booking: 'bk2', dayAfterStart: 1, amount: 1400, fee: 'damage-ext', charged: true,
    description: 'Reversed into a bollard in a shopping centre car park. Rear bumper and boot lid replaced for $1,400. $400 of the bond kept towards it; the other $1,000 on a weekly payment plan.',
    docs: ['rear-bumper-bollard.jpg', 'repair-invoice-1400.pdf'] },
  { fault: 'Yes', quote: 'Yes', status: 'Closed', booking: 'bk6', dayAfterStart: 1, amount: 2500, fee: 'damage-ext', charged: true,
    description: 'Ran into the back of a car in slow traffic on Parramatta Rd. Customer at fault: the $2,500 damage excess applies. Other driver\'s claim passed to GC Tech\'s fleet insurer. $400 of the bond kept; the other $2,100 on a weekly payment plan.',
    thirdParty: { name: 'Grace Li', phone: '0422 310 774', insuranceCo: 'AAMI', claimNo: 'AAMI-4471920' },
    docs: ['front-damage-photos.zip', 'other-driver-details.jpg', 'police-event-E60117.pdf'] },
  { fault: 'Yes', quote: 'Yes', status: 'Closed', booking: 'bk7', dayAfterStart: 1, amount: 1100, fee: 'damage-ext', charged: true,
    description: 'Side mirror and driver door scraped along a pole in a car park. Repaired for $1,100. $400 of the bond kept towards it; the other $700 on a weekly payment plan.',
    docs: ['driver-door-scrape.jpg', 'repair-invoice-1100.pdf'] },
  { fault: 'Yes', quote: 'No', status: 'Closed', booking: 'bk1', dayAfterStart: 2, amount: 900, fee: 'tyre', charged: true,
    description: 'Hit a kerb at speed: two tyres and the front left rim replaced for $900. $400 of the bond kept towards it; the other $500 on a weekly payment plan.',
    docs: ['tyre-rim-damage.jpg', 'tyre-invoice-900.pdf'] }
];
const DC_SEED_AGENTS = ['Felipe Grigolli', 'Jessica Tran', 'Liam O\'Connor', 'Priya Sharma'];

function dcSeedReports() {
  const fmt = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const stamp = ms => new Date(ms).toLocaleString('en-GB');
  const catMatch = (key, catId) => key === 'any' || (catId || '').includes(key === 'small' ? 'small' : key === 'van' ? 'hiace' : key === 'ute' ? 'hilux' : key);
  let seeds = [];
  try { seeds = fleetSeedBookings(); } catch (e) {}
  const bonds = typeof BOND_SEED_RETURNED !== 'undefined' ? BOND_SEED_RETURNED : [];
  const fixed = DC_SEED_INCIDENTS.map(inc => inc.booking).filter(Boolean);
  // Mesmo formato para as três origens
  const fromSeed = s => { const v = fleetGetVehicle(s.plate); return v ? { id: s.id, ref: s.ref, plate: s.plate, renter: `${s.fname} ${s.lname}`, startMs: s.startMs, endMs: s.endMs, loc: FLEET_BRANCHES[v.branch] || '', catId: v.categoryId } : null; };
  const fromBond = r => ({ id: r.id, ref: r.ref, plate: r.plate, renter: `${r.fname} ${r.lname}`, startMs: r.pickupMs, endMs: r.dropoffMs, loc: r.loc, catId: r.categoryId });
  const pool = seeds.filter(s => (s.type === 'returned' || s.type === 'hired') && s.startMs < Date.now() && !fixed.includes(s.id))
    .map(fromSeed).filter(Boolean)
    .sort((a, b) => fleetHash('dmg:' + a.id) - fleetHash('dmg:' + b.id)); // filiais variadas
  const used = new Set();
  return DC_SEED_INCIDENTS.map((inc, i) => {
    let bk = null;
    if (inc.booking) { const s = seeds.find(x => x.id === inc.booking); bk = s ? fromSeed(s) : null; }
    else if (inc.bond) { const r = bonds.find(x => x.id === inc.bond); bk = r ? fromBond(r) : null; }
    else {
      bk = pool.find(x => !used.has(x.id) && catMatch(inc.cat, x.catId)) || pool.find(x => !used.has(x.id));
      if (bk) used.add(bk.id);
    }
    if (!bk) return null;
    const incidentMs = Math.min(bk.startMs + inc.dayAfterStart * FLEET_DAY_MS, bk.endMs, Date.now());
    const agent = DC_SEED_AGENTS[i % DC_SEED_AGENTS.length];
    const reportedMs = Math.min(Math.max(bk.endMs, incidentMs) + 3600000, Date.now() - 3600000);
    const feeName = inc.fee ? ((typeof feeGetItem === 'function' && feeGetItem(inc.fee)) || {}).name || inc.fee : '';
    return {
      id: `dmg-seed-${String(i + 1).padStart(2, '0')}`,
      bookingId: bk.id, recoverAmount: inc.amount || '', recoverFee: inc.fee || 'damage-ext',
      bookingRef: bk.ref, plate: bk.plate, renter: bk.renter, driver: bk.renter,
      atFault: inc.fault, ageCategory: i % 4 === 1 ? '21-24' : '25+',
      locationOfHire: bk.loc, countryOfLicence: i % 5 === 3 ? 'United Kingdom' : 'Australia',
      returnDoneBy: agent, dateOfIncident: fmt(incidentMs), quoteRequired: inc.quote,
      description: inc.description, status: inc.status,
      // A taxa já está no Booking Fees da reserva (lançada na devolução)
      chargedToBooking: inc.charged ? { bookingId: bk.id, ref: bk.ref, feeId: inc.fee, feeName, amount: inc.amount, by: agent, at: reportedMs, atReturn: true } : undefined,
      lastModifiedBy: DC_SEED_AGENTS[(i + 1) % DC_SEED_AGENTS.length], lastModifiedAt: stamp(Math.min(reportedMs + (i + 1) * 5400000, Date.now() - 60000)),
      thirdParty: Object.assign({ name: '', phone: '', insuranceCo: '', claimNo: '' }, inc.thirdParty || {}),
      documents: inc.docs.map((fileName, k) => ({ fileName, uploadedBy: k ? DC_SEED_AGENTS[(i + 2) % DC_SEED_AGENTS.length] : agent, uploadedAt: stamp(reportedMs + k * 2700000) }))
    };
  }).filter(Boolean);
}

// Exemplos desta versão: troca os exemplos antigos (e o relatório inicial da GC-8832, que tinha a placa
// e a data erradas) pelos novos. Relatórios criados pelo agente ficam como estão.
function dcAddSeedReports() {
  if (localStorage.getItem(DAMAGE_SEEDED_KEY) === DAMAGE_SEED_VERSION) return;
  allDamageReports = allDamageReports.filter(r => !String(r.id).startsWith('dmg-seed-') &&
    !(r.bookingRef === 'GC-8832' && r.plate === 'HTR-800'));
  allDamageReports.push(...dcSeedReports());
  localStorage.setItem(DAMAGE_SEEDED_KEY, DAMAGE_SEED_VERSION);
  saveDamageReports();
}

// ==========================================
// RESERVA LIGADA AO RELATÓRIO
// Find booking (Res #, placa, nome ou e-mail) · Open no popup do Planner ·
// cobrança do dano no Booking Fees (o Planner abre com o item marcado; o agente salva)
// ==========================================
let dcCurrentId = null;
let dcSearchOpen = false;
const DC_TYPE_LABELS = { reservation: 'Reservation', hired: 'On hire', returned: 'Returned', cancelled: 'Cancelled' };
const DC_CHARGE_FEES = ['damage-ext', 'damage-int', 'damage-admin', 'windscreen', 'tyre', 'towing', 'cleaning', 'smoking'];

function dcEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dcMoney(n) { return n == null || isNaN(n) ? '—' : '$' + Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dcDate(ms) { return `${fleetFormatDate(ms)} ${fleetFormatTime(ms)}`; }

// Todas as reservas do sistema (demo, site/portal/Add Booking e GC-8832), no mesmo formato
function dcAllBookings() {
  const out = [];
  const total = (fees, cat, start, end) => {
    try { return feeCalc(fees || feeDefaults(cat, 'standard'), cat, Math.max(1, Math.ceil((end - start) / FLEET_DAY_MS))).grand; } catch (e) { return null; }
  };
  fleetSeedBookings().forEach(s => {
    if (s.type === 'maintenance') return;
    const v = fleetGetVehicle(s.plate);
    const cat = v ? fleetGetCategory(v.categoryId) : null;
    const ov = typeof fleetGetOverride === 'function' ? (fleetGetOverride(s.id) || {}) : {};
    out.push({ id: s.id, ref: s.ref, plate: s.plate, name: `${s.fname} ${s.lname}`, email: s.clientEmail || '',
      start: s.startMs, end: s.endMs, type: s.type, model: cat ? cat.model : '', loc: v ? FLEET_BRANCHES[v.branch] : '',
      total: total(s.fees || ov.fees, cat, s.startMs, s.endMs) });
  });
  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    const r = fleetBookingRange(b);
    if (isNaN(r.start)) return;
    const cat = fleetFindCategoryByModel(b.vehicle);
    const plate = typeof fleetIsVirtualPlate === 'function' && fleetIsVirtualPlate(b.plate) ? b.virtualFrom : b.plate;
    out.push({ id: String(b.id), ref: b.ref || ('OR-' + String(b.id).slice(-6)), plate: plate || '', name: `${b.fname || ''} ${b.lname || ''}`.trim() || email, email,
      start: r.start, end: r.end, type: b.status === 'cancelled' ? 'cancelled' : (b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation'),
      model: cat ? cat.model : (b.vehicle || ''), loc: b.loc || '',
      licenceCountry: b.licenceCountry || (b.driver && b.driver.country) || '', age: ['21-24', '25+', 'Under 21'].includes(b.driverAge) ? b.driverAge : '',
      total: typeof feeBookingMoney === 'function' ? feeBookingMoney(b, cat).grand : (b.priceTotal || null) });
  }));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length) continue;
    const r = fleetMainBookingRange(state);
    const email = key.slice(FLEET_MAIN_PREFIX.length);
    out.push({ id: 'main-' + email, ref: 'GC-8832', plate: FLEET_MAIN_BOOKING_PLATE, name: 'Felipe Grigolli', email,
      start: r.start, end: r.end, type: state.status === 'cancelled' ? 'cancelled' : fleetMainBookingType(state), model: 'Auto Pantech Truck', loc: FLEET_BRANCHES.MAS, total: null });
  }
  // Reservas antigas já devolvidas que só existem na fila do Bond Refunds
  if (typeof BOND_SEED_RETURNED !== 'undefined') BOND_SEED_RETURNED.forEach(r => {
    if (out.some(x => x.id === r.id)) return;
    const cat = fleetGetCategory(r.categoryId);
    out.push({ id: r.id, ref: r.ref, plate: r.plate, name: `${r.fname} ${r.lname}`, email: r.email, start: r.pickupMs, end: r.dropoffMs,
      type: 'returned', model: cat ? cat.model : '', loc: r.loc, total: bondCalc(r).grand, bondOnly: true });
  });
  return out;
}

function dcLinkedBooking(report, all) {
  all = all || dcAllBookings();
  if (report.bookingId) { const b = all.find(x => x.id === String(report.bookingId)); if (b) return b; }
  const ref = String(report.bookingRef || '').trim().toUpperCase().replace(/^#/, '');
  return ref ? all.find(x => String(x.ref).toUpperCase() === ref) || null : null;
}

function dcBookingRowHtml(b, actions, match) {
  return `<tr class="${match ? 'match' : ''}">
    <td><span class="dc-ref">${dcEsc(b.ref)}</span><div class="dc-muted">${dcEsc(b.name)}</div></td>
    <td>${dcEsc(b.model)}${b.plate ? `<br><span class="dc-plate">${dcEsc(b.plate)}</span>` : ''}</td>
    <td>${dcDate(b.start)}<div class="dc-muted">→ ${dcDate(b.end)}</div></td>
    <td><span class="dc-pill ${dcEsc(b.type)}">${DC_TYPE_LABELS[b.type] || dcEsc(b.type)}</span></td>
    <td style="text-align:right">${dcMoney(b.total)}</td>
    <td style="text-align:right; white-space:nowrap">${actions}</td>
  </tr>`;
}

function dcLinkedHtml(report) {
  const all = dcAllBookings();
  const b = dcLinkedBooking(report, all);
  const head = `<div class="dc-link-head">
      <small>${b ? 'Booking for this report — open it to see every detail.' : `No booking found for Res # “${dcEsc(report.bookingRef || '')}”.`}</small>
      <button type="button" class="dc-mini-btn" onclick="dcToggleSearch('${report.id}')">🔎 ${dcSearchOpen ? 'Close search' : 'Find booking'}</button>
    </div>`;
  let body = '';
  if (b) {
    const opts = DC_CHARGE_FEES.map(id => feeGetItem(id)).filter(Boolean);
    const feeSel = report.recoverFee || 'damage-ext';
    const amount = report.recoverAmount || '';
    const done = report.chargedToBooking;
    body = `<table class="dc-bk-table">
        <thead><tr><th>Booking Ref</th><th>Vehicle</th><th>Pick-up → Drop-off</th><th>Status</th><th style="text-align:right">Total</th><th></th></tr></thead>
        <tbody>${dcBookingRowHtml(b, `<button type="button" class="dc-mini-btn blue" onclick="dcOpenBooking('${dcEsc(b.id)}')">Open</button>`)}</tbody>
      </table>
      ${b.bondOnly ? `<div class="dc-charge"><span class="dc-muted">${dcEsc(b.ref)} was returned and is in the Bond Refunds queue: charges at return come off the bond there. Open shows its Booking Payments.</span></div>` : `<div class="dc-charge">
        <label>Charge type<select id="dc-charge-fee">${opts.map(f => `<option value="${f.id}" ${f.id === feeSel ? 'selected' : ''}>${dcEsc(f.name)}</option>`).join('')}</select></label>
        <label>Amount ($)<input type="number" id="dc-charge-amount" min="0" step="0.01" value="${dcEsc(amount)}" placeholder="0.00"></label>
        <button type="button" class="dc-mini-btn red" onclick="dcChargeToBooking('${report.id}')">➕ Add to Booking Fees ↗</button>
        <span class="dc-muted">Opens ${dcEsc(b.ref)} on Booking Fees with the charge ticked. Review it and click Save Booking.</span>
      </div>`}
      ${dcChargeStatusHtml(done)}`;
  }
  return `<div class="dc-link">${head}${body}${dcSearchOpen ? dcSearchHtml(report, all) : ''}</div>`;
}

// ---------- Status rápido (Open · Quoted · Closed): salva na hora ----------
const DC_STATUSES = [
  { id: 'Open', color: '#ef4444', hint: 'Reported, waiting for inspection or a quote' },
  { id: 'Quoted', color: '#f59e0b', hint: 'Repair quote received, waiting for payment or approval' },
  { id: 'Closed', color: '#10b981', hint: 'Repaired and charged to the customer (bond, booking or payment plan), or settled by insurance' }
];

function dcStatusSwitchHtml(report) {
  return `<span>Status</span>` + DC_STATUSES.map(s => `
    <button type="button" class="${report.status === s.id ? 'on' : ''}" style="--c:${s.color}" title="${s.hint}" onclick="dcSetStatus('${report.id}', '${s.id}')">${s.id}</button>`).join('');
}

function dcSetStatus(reportId, status) {
  const report = allDamageReports.find(d => d.id === reportId);
  if (!report || report.status === status) return;
  const prev = report.status;
  report.status = status;
  report.lastModifiedBy = getActiveAgent();
  report.lastModifiedAt = new Date().toLocaleString('en-GB');
  (report.statusHistory = report.statusHistory || []).push({ from: prev, to: status, by: report.lastModifiedBy, at: Date.now() });
  saveDamageReports();
  // Atualiza só o que mudou: o resto do formulário pode ter edições ainda não salvas
  const sw = document.getElementById('dc-status-switch');
  if (sw) sw.innerHTML = dcStatusSwitchHtml(report);
  const sel = document.getElementById('ev-status');
  if (sel) sel.value = status;
  const audit = document.querySelector('#dc-main-area .audit-trail');
  if (audit) audit.innerHTML = `Last modified by <strong style="color: #ef4444;">${dcEsc(report.lastModifiedBy)}</strong> on ${dcEsc(report.lastModifiedAt)}`;
  renderDamageList(document.getElementById('dc-search').value);
  const b = dcLinkedBooking(report);
  if (b && typeof fleetLog === 'function') fleetLog({ bookingId: b.id, ref: b.ref, plate: report.plate, action: 'Damage', details: `Damage report status changed: ${prev} → ${status}`, info: 'Damage Control' });
  gcToast(`Report ${report.plate} marked as ${status}.`, 'success');
}

// Situação da cobrança na reserva (sincronizada pelo Planner a cada Save Booking)
function dcChargeStatusHtml(c) {
  if (!c) return '';
  const when = ms => new Date(ms).toLocaleString('en-GB');
  if (c.removed) {
    return `<div class="dc-charge-done" style="color:#fbbf24">⚠ The ${dcMoney(c.amount)} ${dcEsc(c.feeName)} charge was removed from ${dcEsc(c.ref)}'s Booking Fees by ${dcEsc(c.removedBy)} on ${when(c.removedAt)}. Add it again above if it still applies.</div>`;
  }
  const origin = c.atReturn ? `charged at return by ${dcEsc(c.by)}` : c.fromBooking ? `entered in the booking by ${dcEsc(c.by)}` : `added from this report by ${dcEsc(c.by)}`;
  return `<div class="dc-charge-done">✓ ${dcMoney(c.amount)} ${dcEsc(c.feeName)} on ${dcEsc(c.ref)}'s Booking Fees · ${origin} on ${when(c.at)}.` +
    (c.updatedAt ? `<br><span style="color:#fbbf24">Changed in the booking from ${dcMoney(c.prevAmount)} to ${dcMoney(c.amount)} by ${dcEsc(c.updatedBy)} on ${when(c.updatedAt)}.</span>` : '') +
    `<br><span class="dc-muted">${c.atReturn ? "Taken from the bond (up to $400); anything above it is paid on the booking or on a payment plan." : "Charge it from the booking's Payments tab (or the bond)."}</span></div>`;
}

function dcSearchHtml(report, all) {
  return `<div class="dc-search-row">
      <input type="text" id="dc-bk-search" placeholder="Res #, rego, customer name or email…" value="${dcEsc(report._search || '')}"
        oninput="dcRunSearch('${report.id}')" onkeydown="if (event.key === 'Enter') { event.preventDefault(); dcRunSearch('${report.id}'); }">
    </div>
    <div id="dc-bk-results">${dcResultsHtml(report, all, report._search || '')}</div>`;
}

// Sem texto: sugere as reservas da mesma placa, as mais próximas da data do incidente primeiro
function dcResultsHtml(report, all, term) {
  const t = term.trim().toLowerCase();
  const incident = report.dateOfIncident ? new Date(report.dateOfIncident + 'T12:00').getTime() : Date.now();
  const dist = b => incident >= b.start && incident <= b.end ? 0 : Math.min(Math.abs(incident - b.start), Math.abs(incident - b.end));
  const plate = String(report.plate || '').toUpperCase();
  const list = all.filter(b => t
      ? [b.ref, b.plate, b.name, b.email].some(v => String(v || '').toLowerCase().includes(t))
      : plate && String(b.plate).toUpperCase() === plate)
    .sort((a, b) => dist(a) - dist(b)).slice(0, 10);
  if (!list.length) return `<p class="dc-muted">${t ? 'No bookings match this search.' : `No bookings found for rego ${dcEsc(plate) || '—'}. Search by Res #, rego or customer.`}</p>`;
  return `<p class="dc-muted">${t ? `${list.length} booking${list.length > 1 ? 's' : ''} found` : `Bookings on ${dcEsc(plate)}, closest to the incident date first`}</p>
    <table class="dc-bk-table"><thead><tr><th>Booking Ref</th><th>Vehicle</th><th>Pick-up → Drop-off</th><th>Status</th><th style="text-align:right">Total</th><th></th></tr></thead>
    <tbody>${list.map(b => dcBookingRowHtml(b,
      `<button type="button" class="dc-mini-btn" onclick="dcOpenBooking('${dcEsc(b.id)}')">Open</button> <button type="button" class="dc-mini-btn blue" onclick="dcLinkBooking('${report.id}', '${dcEsc(b.id)}')">Link</button>`,
      dist(b) === 0)).join('')}</tbody></table>`;
}

function dcRefreshLinkBox(reportId) {
  const report = allDamageReports.find(d => d.id === reportId);
  const box = document.getElementById('dc-link-box');
  if (!report || !box) return;
  // Mantém o que o agente estava digitando na cobrança
  const fee = document.getElementById('dc-charge-fee'), amt = document.getElementById('dc-charge-amount');
  const keep = fee && amt ? { fee: fee.value, amt: amt.value } : null;
  box.innerHTML = dcLinkedHtml(report);
  if (keep) {
    const f2 = document.getElementById('dc-charge-fee'), a2 = document.getElementById('dc-charge-amount');
    if (f2) f2.value = keep.fee;
    if (a2) a2.value = keep.amt;
  }
}

function dcToggleSearch(reportId) {
  dcSearchOpen = !dcSearchOpen;
  dcRefreshLinkBox(reportId);
  const input = document.getElementById('dc-bk-search');
  if (input) input.focus();
}

function dcRunSearch(reportId) {
  const report = allDamageReports.find(d => d.id === reportId);
  const input = document.getElementById('dc-bk-search');
  if (!report || !input) return;
  report._search = input.value;
  document.getElementById('dc-bk-results').innerHTML = dcResultsHtml(report, dcAllBookings(), input.value);
}

function dcOpenBooking(bookingId) {
  // Devolvida que só existe no Bond Refunds: abre o extrato dela lá
  if (typeof BOND_SEED_RETURNED !== 'undefined' && BOND_SEED_RETURNED.some(r => r.id === bookingId)) {
    window.open('agent-dashboard.html#bond:' + encodeURIComponent(bookingId), '_blank');
    return;
  }
  fleetOpenBookingWindow(bookingId);
}

// Liga a reserva: Res #, placa, locatário e filial vêm da reserva
function dcLinkBooking(reportId, bookingId) {
  const report = allDamageReports.find(d => d.id === reportId);
  const b = dcAllBookings().find(x => x.id === String(bookingId));
  if (!report || !b) return;
  Object.assign(report, { bookingId: b.id, bookingRef: b.ref, plate: b.plate || report.plate, renter: b.name,
    driver: report.driver && report.driver !== report.renter ? report.driver : b.name,
    locationOfHire: b.loc || report.locationOfHire, lastModifiedBy: getActiveAgent(), lastModifiedAt: new Date().toLocaleString('en-GB') });
  delete report._search;
  saveDamageReports();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('ev-ref', report.bookingRef); set('ev-plate', report.plate); set('ev-renter', report.renter); set('ev-driver', report.driver); set('ev-location', report.locationOfHire);
  dcSearchOpen = false;
  dcRefreshLinkBox(reportId);
  renderDamageList(document.getElementById('dc-search').value);
  if (typeof fleetLog === 'function') fleetLog({ bookingId: b.id, ref: b.ref, plate: b.plate, action: 'Damage', details: `Damage report linked to this booking (${report.plate}, incident ${report.dateOfIncident})`, info: 'Damage Control' });
  gcToast(`Report linked to booking ${b.ref}.`, 'success');
}

// Abre a reserva no Booking Fees com a cobrança do dano marcada (o agente confere e salva)
function dcChargeToBooking(reportId) {
  const report = allDamageReports.find(d => d.id === reportId);
  const b = report ? dcLinkedBooking(report) : null;
  if (!b) return;
  const fee = document.getElementById('dc-charge-fee').value;
  const amount = Math.round(Number(document.getElementById('dc-charge-amount').value) * 100) / 100;
  if (!(amount > 0)) { gcToast('Enter the amount to charge for this damage.', 'warning'); return; }
  report.recoverFee = fee;
  report.recoverAmount = amount;
  saveDamageReports();
  fleetOpenBookingWindow(b.id, `&tab=fees&fee=${encodeURIComponent(fee)}&amount=${amount}&damage=${encodeURIComponent(report.id)}`);
}

// Voltou do popup do Planner (ou ele salvou em outra janela): atualiza a cobrança registrada
// e a reserva ligada, sem mexer no formulário em edição
function dcSyncFromStorage() {
  if (!dcCurrentId) return;
  try {
    const fresh = JSON.parse(localStorage.getItem(DAMAGE_STORAGE_KEY) || '[]').find(d => d.id === dcCurrentId);
    const cur = allDamageReports.find(d => d.id === dcCurrentId);
    if (fresh && cur && JSON.stringify(fresh.chargedToBooking || null) !== JSON.stringify(cur.chargedToBooking || null)) {
      cur.chargedToBooking = fresh.chargedToBooking;
      cur.lastModifiedBy = fresh.lastModifiedBy; cur.lastModifiedAt = fresh.lastModifiedAt;
      const audit = document.querySelector('#dc-main-area .audit-trail strong');
      if (audit) audit.textContent = cur.lastModifiedBy;
    }
    // Sempre redesenha a reserva ligada: status, datas e total podem ter mudado no Planner
    if (!dcSearchOpen) dcRefreshLinkBox(dcCurrentId);
  } catch (e) {}
}
window.addEventListener('focus', dcSyncFromStorage);
window.addEventListener('storage', e => { if (!e.key || (e.key.startsWith('gc_') && e.key !== 'gc_activity_log')) dcSyncFromStorage(); });

// ==========================================
// 1. LOAD & SAVE DATA
// ==========================================
function loadDamageReports() {
  try {
    const data = localStorage.getItem(DAMAGE_STORAGE_KEY);
    if (data) {
      allDamageReports = JSON.parse(data);
      
      // Legacy data migration safety check
      allDamageReports.forEach(report => {
        if (!report.lastModifiedBy) report.lastModifiedBy = 'System (Legacy)';
        if (!report.lastModifiedAt) report.lastModifiedAt = 'Original Record';
        if (!report.thirdParty) report.thirdParty = { name: '', phone: '', insuranceCo: '', claimNo: '' };
        if (!report.documents) report.documents = [];
      });

    } else {
      allDamageReports = []; // os exemplos entram em dcAddSeedReports
    }
  } catch(e) {
    allDamageReports = [];
  }
  dcAddSeedReports();
}

function saveDamageReports() {
  localStorage.setItem(DAMAGE_STORAGE_KEY, JSON.stringify(allDamageReports));
}

function getActiveAgent() {
  return localStorage.getItem('gc_agent_name') || 'System User';
}

// ==========================================
// 2. RENDER LIST (Left Side) & SEARCH FILTER
// ==========================================
function renderDamageList(filterText = '') {
  const listEl = document.getElementById('damage-list');
  listEl.innerHTML = '';
  const term = filterText.toLowerCase().trim();

  const filtered = allDamageReports.filter(d => 
    (d.bookingRef && d.bookingRef.toLowerCase().includes(term)) || 
    (d.plate && d.plate.toLowerCase().includes(term)) ||
    (d.renter && d.renter.toLowerCase().includes(term)) ||
    (d.driver && d.driver.toLowerCase().includes(term))
  );

  filtered.sort((a, b) => b.id.localeCompare(a.id));

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="padding: 30px 20px; color: #64748b; text-align: center; font-size: 13px;">No damage reports found matching "${filterText}".</div>`;
    return;
  }

  const plans = ppLoad();

  filtered.forEach(d => {
    const div = document.createElement('div');
    div.className = 'dc-card' + (d.id === dcCurrentId ? ' active' : '');
    div.onclick = () => showDamageDetails(d.id, div);
    const hasPlan = plans.some(p => p.damageReportId === d.id && p.status !== 'cancelled');

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="font-weight: 700; font-size: 14px; color: #fff;">${d.plate}</span>
        <span style="font-size: 11px; font-weight: 700;">
          ${hasPlan ? '<span style="color: #fbbf24; margin-right: 8px;">PLAN</span>' : ''}
          <span style="color: ${{ Open: '#ef4444', Quoted: '#f59e0b', Closed: '#10b981' }[d.status] || '#ef4444'};">${d.status.toUpperCase()}</span>
        </span>
      </div>
      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Ref: ${d.bookingRef || 'N/A'}${d.dateOfIncident ? ` · ${d.dateOfIncident.split('-').reverse().join('/')}` : ''}</div>
      <div style="font-size: 12px; color: #94a3b8;">Renter: ${d.renter}</div>
    `;
    listEl.appendChild(div);
  });
}

function filterDamageReports() {
  const text = document.getElementById('dc-search').value;
  renderDamageList(text);
}

// ==========================================
// 3. CREATE NEW DAMAGE REPORT FORM
// ==========================================
function showNewDamageForm() {
  dcCurrentId = null;
  dcNewAutofill = {};
  dcNewBookingId = null;
  document.querySelectorAll('.dc-card').forEach(el => el.classList.remove('active'));
  const mainEl = document.getElementById('dc-main-area');
  
  mainEl.innerHTML = `
    <div style="background: #1e293b; padding: 30px; border-radius: 8px; border: 1px solid #334155;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 15px; margin-bottom: 25px;">
        <h2 style="margin: 0; color: #fff; font-size: 18px;">Create New Damage Report</h2>
        <span class="badge-damage">NEW RECORD</span>
      </div>

      <form onsubmit="saveNewReport(event)">
        <h3 class="section-title">Core Booking Info</h3>
        <div class="form-grid">
          <div class="form-group"><label>Booking Ref</label><input type="text" id="df-ref" required autocomplete="off" placeholder="Type the Res # — details fill in automatically" oninput="dcNewRefLookup()"></div>
          <div class="form-group"><label>Vehicle Plate</label><input type="text" id="df-plate" required></div>
        </div>
        <div id="df-ref-found" style="margin: -6px 0 6px;"></div>

        <h3 class="section-title">Driver & Incident Details</h3>
        <div class="form-grid">
          <div class="form-group"><label>Renter</label><input type="text" id="df-renter" required></div>
          <div class="form-group"><label>Driver</label><input type="text" id="df-driver" required></div>
          <div class="form-group"><label>At Fault</label>
            <select id="df-fault"><option>Yes</option><option>No</option><option>Undetermined</option></select>
          </div>
          <div class="form-group"><label>Age Category</label>
            <select id="df-age" onchange="this.dataset.touched = '1'"><option>Under 21</option><option>21-24</option><option selected>25+</option></select>
          </div>
          <div class="form-group"><label>Location of Hire</label><input type="text" id="df-location"></div>
          <div class="form-group"><label>Licence Country</label><input type="text" id="df-country"></div>
          <div class="form-group"><label>Return Done By</label><input type="text" id="df-returnby"></div>
          <div class="form-group"><label>Date of Incident</label><input type="date" id="df-date" style="color-scheme: dark;" required></div>
          <div class="form-group"><label>Quote Required?</label>
            <select id="df-quote"><option>Yes</option><option>No</option></select>
          </div>
          <div class="form-group"><label>Status</label>
            <select id="df-status"><option>Open</option><option>Quoted</option><option>Closed</option></select>
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="df-description" rows="3" required></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 15px; margin-top: 30px;">
          <button type="button" class="btn btn-cancel" onclick="resetMainArea()">Cancel</button>
          <button type="submit" class="btn btn-submit" style="background: #ef4444; border: none;">💾 Save Report</button>
        </div>
      </form>
    </div>
  `;
}

// ---------- Relatório novo: digitou o Res # → preenche com os dados da reserva ----------
// Só preenche campo vazio ou que foi preenchido automaticamente antes (não apaga o que o agente digitou)
let dcNewAutofill = {};
let dcNewBookingId = null;

function dcNewRefLookup() {
  const ref = document.getElementById('df-ref').value.trim().toUpperCase().replace(/^#/, '');
  const box = document.getElementById('df-ref-found');
  const b = ref ? dcAllBookings().find(x => String(x.ref).toUpperCase() === ref) : null;
  dcNewBookingId = b ? b.id : null;
  if (!b) {
    box.innerHTML = ref.length >= 4 ? `<span class="dc-warn">No booking found with Res # “${dcEsc(ref)}”. You can still fill the report by hand.</span>` : '';
    return;
  }
  const fill = (id, value) => {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    if (value === '') { if (dcNewAutofill[id] && el.value === dcNewAutofill[id]) { el.value = ''; dcNewAutofill[id] = ''; } return; }
    const untouchedSelect = el.tagName === 'SELECT' && !el.dataset.touched;
    if (el.value === '' || el.value === dcNewAutofill[id] || untouchedSelect) { el.value = value; dcNewAutofill[id] = el.value; }
  };
  fill('df-plate', b.plate);
  fill('df-renter', b.name);
  fill('df-driver', b.name);
  fill('df-location', b.loc);
  fill('df-country', b.licenceCountry);
  if (b.age) fill('df-age', b.age);
  // Data do incidente: hoje se o carro está na rua; senão o dia da devolução (o agente ajusta)
  const d = new Date(b.type === 'hired' ? Date.now() : b.end);
  fill('df-date', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  fill('df-returnby', b.type === 'returned' ? getActiveAgent() : '');
  box.innerHTML = `<div class="dc-link" style="padding:10px 14px">
      <div class="dc-link-head" style="margin:0"><small>✓ Booking found — details filled in below. Check them before saving.</small>
        <button type="button" class="dc-mini-btn" onclick="dcOpenBooking('${dcEsc(b.id)}')">Open booking</button></div>
      <table class="dc-bk-table"><tbody>${dcBookingRowHtml(b, '')}</tbody></table>
    </div>`;
}

function saveNewReport(e) {
  e.preventDefault();
  const agentName = getActiveAgent();
  const newReport = {
    id: 'dmg-' + Date.now(),
    ...(dcNewBookingId ? { bookingId: dcNewBookingId } : {}),
    bookingRef: document.getElementById('df-ref').value,
    plate: document.getElementById('df-plate').value,
    renter: document.getElementById('df-renter').value,
    driver: document.getElementById('df-driver').value,
    atFault: document.getElementById('df-fault').value,
    ageCategory: document.getElementById('df-age').value,
    locationOfHire: document.getElementById('df-location').value,
    countryOfLicence: document.getElementById('df-country').value,
    returnDoneBy: document.getElementById('df-returnby').value,
    dateOfIncident: document.getElementById('df-date').value,
    quoteRequired: document.getElementById('df-quote').value,
    status: document.getElementById('df-status').value,
    description: document.getElementById('df-description').value,
    lastModifiedBy: agentName,
    lastModifiedAt: new Date().toLocaleString('en-GB'),
    thirdParty: { name: '', phone: '', insuranceCo: '', claimNo: '' },
    documents: []
  };

  allDamageReports.push(newReport);
  saveDamageReports();
  renderDamageList();
  showDamageDetails(newReport.id, null);
  gcToast("Damage report created.");
}

// ==========================================
// 4. LIVE EDIT VIEW SCREEN
// ==========================================
function showDamageDetails(id, cardElement) {
  if (cardElement) {
    document.querySelectorAll('.dc-card').forEach(el => el.classList.remove('active'));
    cardElement.classList.add('active');
  }

  const report = allDamageReports.find(d => d.id === id);
  if (!report) return;

  if (!report.thirdParty) report.thirdParty = { name: '', phone: '', insuranceCo: '', claimNo: '' };
  if (!report.documents) report.documents = [];

  const mainEl = document.getElementById('dc-main-area');
  dcCurrentId = id;
  dcSearchOpen = false;

  let docsHtml = '';
  if (report.documents.length === 0) {
    docsHtml = `<div style="color: #64748b; font-size: 13px; font-style: italic;">No documents uploaded yet.</div>`;
  } else {
    report.documents.forEach((doc, idx) => {
      docsHtml += `
        <div class="doc-item">
          <div class="doc-item-info">
            <strong style="color: #3b82f6;">📄 ${doc.fileName}</strong>
            <span class="doc-item-meta">Uploaded by ${doc.uploadedBy} on ${doc.uploadedAt}</span>
          </div>
          <button type="button" class="btn btn-cancel" style="padding: 4px 8px; font-size: 11px; border: none; color: #ef4444;" onclick="deleteDocument('${report.id}', ${idx})">Delete</button>
        </div>
      `;
    });
  }

  mainEl.innerHTML = `
    <div style="background: #1e293b; padding: 30px; border-radius: 8px; border: 1px solid #334155;">
      
      <form onsubmit="updateExistingReport(event, '${report.id}')">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #334155; padding-bottom: 20px; margin-bottom: 20px;">
          <div>
            <h2 style="margin: 0 0 5px 0; color: #fff; font-size: 22px;">Vehicle: ${report.plate}</h2>
            <div style="color: #94a3b8; font-size: 14px;">Live Edit Mode - You can edit any field below.</div>
            <div class="dc-status-switch" id="dc-status-switch">${dcStatusSwitchHtml(report)}</div>
          </div>
          <div style="text-align: right; display: flex; gap: 10px; align-items: flex-start;">
            <button type="button" class="btn btn-cancel" style="border-color: #ef4444; color: #ef4444;" onclick="deleteReport('${report.id}')">🗑️ Delete</button>
            <button type="submit" class="btn btn-submit" style="background: #ef4444; border: none;">💾 Save Changes</button>
          </div>
        </div>

        <!-- RESERVA LIGADA: Find booking · Open · cobrança no Booking Fees -->
        <h3 class="section-title" style="color: #60a5fa;">Linked Booking</h3>
        <div id="dc-link-box">${dcLinkedHtml(report)}</div>

        <h3 class="section-title">Core & Driver Details</h3>
        <div class="form-grid">
          <div class="form-group"><label>Booking Ref</label><input type="text" id="ev-ref" value="${report.bookingRef}"></div>
          <div class="form-group"><label>Vehicle Plate</label><input type="text" id="ev-plate" value="${report.plate}"></div>
          <div class="form-group"><label>Renter</label><input type="text" id="ev-renter" value="${report.renter}"></div>
          <div class="form-group"><label>Driver</label><input type="text" id="ev-driver" value="${report.driver}"></div>
        </div>

        <h3 class="section-title">Incident Details</h3>
        <div class="form-grid">
          <div class="form-group">
            <label>At Fault</label>
            <select id="ev-fault">
              <option value="Yes" ${report.atFault==='Yes'?'selected':''}>Yes</option>
              <option value="No" ${report.atFault==='No'?'selected':''}>No</option>
              <option value="Undetermined" ${report.atFault==='Undetermined'?'selected':''}>Undetermined</option>
            </select>
          </div>
          <div class="form-group">
            <label>Quote Required?</label>
            <select id="ev-quote">
              <option value="Yes" ${report.quoteRequired==='Yes'?'selected':''}>Yes</option>
              <option value="No" ${report.quoteRequired==='No'?'selected':''}>No</option>
            </select>
          </div>
          <div class="form-group"><label>Date of Incident</label><input type="date" id="ev-date" value="${report.dateOfIncident}" style="color-scheme: dark;"></div>
          <div class="form-group"><label>Location of Hire</label><input type="text" id="ev-location" value="${report.locationOfHire}"></div>
          <div class="form-group"><label>Age Category</label>
            <select id="ev-age">
              <option ${report.ageCategory==='Under 21'?'selected':''}>Under 21</option>
              <option ${report.ageCategory==='21-24'?'selected':''}>21-24</option>
              <option ${report.ageCategory==='25+'?'selected':''}>25+</option>
            </select>
          </div>
          <div class="form-group"><label>Licence Country</label><input type="text" id="ev-country" value="${report.countryOfLicence}"></div>
          <div class="form-group"><label>Return Done By</label><input type="text" id="ev-returnby" value="${report.returnDoneBy}"></div>
          <div class="form-group">
            <label>Status</label>
            <select id="ev-status">
              <option value="Open" ${report.status==='Open'?'selected':''}>Open</option>
              <option value="Quoted" ${report.status==='Quoted'?'selected':''}>Quoted</option>
              <option value="Closed" ${report.status==='Closed'?'selected':''}>Closed</option>
            </select>
          </div>
        </div>
        
        <div class="form-group">
          <label>Description</label>
          <textarea id="ev-description" rows="3">${report.description}</textarea>
        </div>

        <!-- INSURANCE & THIRD PARTY -->
        <h3 class="section-title" style="color: #3b82f6;">Insurance & Third-Party Details</h3>
        <p style="font-size: 12px; color: #94a3b8; margin-top: -5px; margin-bottom: 15px;">Dedicated section for the Insurance Dept to register the other driver's details.</p>
        <div class="form-grid">
          <div class="form-group"><label>Third-Party Name</label><input type="text" id="tp-name" value="${report.thirdParty.name}" placeholder="Name of the other driver"></div>
          <div class="form-group"><label>Third-Party Phone</label><input type="text" id="tp-phone" value="${report.thirdParty.phone}" placeholder="Contact number"></div>
          <div class="form-group"><label>Insurance Company</label><input type="text" id="tp-insurance" value="${report.thirdParty.insuranceCo}" placeholder="E.g., Allianz, NRMA"></div>
          <div class="form-group"><label>Claim Number</label><input type="text" id="tp-claim" value="${report.thirdParty.claimNo}" placeholder="Insurance Claim Ref."></div>
        </div>

        <!-- DOCUMENTS & PHOTOS UPLOAD (100% English custom button) -->
        <h3 class="section-title" style="color: #10b981;">Documents & Photos</h3>
        <div style="background: #0f172a; padding: 15px; border-radius: 6px; border: 1px dashed #334155; margin-bottom: 15px;">
          <label style="display: block; font-size: 13px; color: #fff; margin-bottom: 10px; font-weight: 600;">Upload New File</label>
          
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="file-upload-wrapper" style="flex: 1;">
              <button type="button" class="file-upload-btn" id="file-chosen-label">📁 Choose files...</button>
              <input type="file" id="doc-upload-input" multiple onchange="updateFileLabel(this)">
            </div>
            <button type="button" class="btn btn-submit" style="background: #10b981; border: none; padding: 10px 20px; font-size: 13px; height: 41px;" onclick="simulateFileUpload('${report.id}')">Upload</button>
          </div>
        </div>
        <div id="docs-list-container">
          ${docsHtml}
        </div>

        <!-- PAYMENT PLAN (cliente paga o dano em parcelas semanais) -->
        <h3 class="section-title" style="color: #fbbf24;">Customer Payment Plan</h3>
        <div id="dc-plan-section">${dcPlanSectionHtml(report)}</div>

        <!-- AUDIT TRAIL -->
        <div class="audit-trail">
          Last modified by <strong style="color: #ef4444;">${report.lastModifiedBy || 'System'}</strong> on ${report.lastModifiedAt || 'Unknown'}
        </div>
      </form>

    </div>
  `;
}

// Updates label when files are selected
function updateFileLabel(input) {
  const label = document.getElementById('file-chosen-label');
  if (input.files && input.files.length > 0) {
    if (input.files.length === 1) {
      label.textContent = "📄 " + input.files[0].name;
    } else {
      label.textContent = `📁 ${input.files.length} files selected`;
    }
  } else {
    label.textContent = "📁 Choose files...";
  }
}

// Save inputs changes and stamp agent name
function updateExistingReport(e, id) {
  e.preventDefault();
  
  const reportIndex = allDamageReports.findIndex(d => d.id === id);
  if (reportIndex === -1) return;

  const agentName = getActiveAgent();
  // Trocou o Res # à mão: a ligação antiga com a reserva deixa de valer (volta a ligar pelo Res #)
  const newRef = document.getElementById('ev-ref').value;
  if (newRef.trim().toUpperCase() !== String(allDamageReports[reportIndex].bookingRef || '').trim().toUpperCase()) delete allDamageReports[reportIndex].bookingId;

  allDamageReports[reportIndex] = {
    ...allDamageReports[reportIndex],
    bookingRef: newRef,
    plate: document.getElementById('ev-plate').value,
    renter: document.getElementById('ev-renter').value,
    driver: document.getElementById('ev-driver').value,
    atFault: document.getElementById('ev-fault').value,
    ageCategory: document.getElementById('ev-age').value,
    locationOfHire: document.getElementById('ev-location').value,
    countryOfLicence: document.getElementById('ev-country').value,
    returnDoneBy: document.getElementById('ev-returnby').value,
    dateOfIncident: document.getElementById('ev-date').value,
    quoteRequired: document.getElementById('ev-quote').value,
    status: document.getElementById('ev-status').value,
    description: document.getElementById('ev-description').value,
    thirdParty: {
      name: document.getElementById('tp-name').value,
      phone: document.getElementById('tp-phone').value,
      insuranceCo: document.getElementById('tp-insurance').value,
      claimNo: document.getElementById('tp-claim').value
    },
    lastModifiedBy: agentName,
    lastModifiedAt: new Date().toLocaleString('en-GB')
  };

  saveDamageReports();
  renderDamageList();
  showDamageDetails(id, null); 
  gcToast(`Changes saved by ${agentName}.`);
}

function simulateFileUpload(id) {
  const input = document.getElementById('doc-upload-input');
  if (!input.files || input.files.length === 0) {
    gcToast("Please select at least one file to upload.", 'warning');
    return;
  }

  const report = allDamageReports.find(d => d.id === id);
  if (!report) return;

  const agentName = getActiveAgent();

  for (let i = 0; i < input.files.length; i++) {
    report.documents.push({
      fileName: input.files[i].name,
      uploadedBy: agentName,
      uploadedAt: new Date().toLocaleString('en-GB')
    });
  }

  report.lastModifiedBy = agentName;
  report.lastModifiedAt = new Date().toLocaleString('en-GB');
  
  saveDamageReports();
  showDamageDetails(id, null); 
}

async function deleteDocument(reportId, docIndex) {
  const ok = await gcConfirm({ title: 'Delete this document?', message: 'The file will be removed from this damage report.', confirmText: 'Delete', danger: true });
  if (!ok) return;

  const report = allDamageReports.find(d => d.id === reportId);
  if (report && report.documents) {
    report.documents.splice(docIndex, 1);
    report.lastModifiedBy = getActiveAgent();
    report.lastModifiedAt = new Date().toLocaleString('en-GB');
    saveDamageReports();
    showDamageDetails(reportId, null);
  }
}

async function deleteReport(id) {
  if (await gcConfirm({ title: 'Delete this damage report?', message: 'The whole report, including its documents, will be removed. This cannot be undone.', confirmText: 'Delete report', danger: true })) {
    allDamageReports = allDamageReports.filter(d => d.id !== id);
    saveDamageReports();
    renderDamageList();
    resetMainArea();
  }
}

function resetMainArea() {
  document.getElementById('dc-main-area').innerHTML = `
    <div style="display: flex; height: 100%; align-items: center; justify-content: center; color: #64748b; font-style: italic; font-size: 14px;">
      Select a report from the list or click "New Damage Report" to begin.
    </div>
  `;
  document.querySelectorAll('.dc-card').forEach(el => el.classList.remove('active'));
}

// ==========================================
// 5. PAYMENT PLAN LIGADO AO RELATÓRIO (dados em js/gc-payments.js)
// ==========================================
function dcPlanSectionHtml(report) {
  const plan = ppLoad().find(p => p.damageReportId === report.id && p.status !== 'cancelled');
  if (!plan) {
    return `
      <div style="background: #0f172a; border: 1px dashed #334155; border-radius: 6px; padding: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px;">
        <span style="color: #94a3b8; font-size: 13px;">No payment plan for this damage yet. Set up weekly instalments if the customer can't pay the full amount now. ${report.chargedToBooking && !report.chargedToBooking.removed ? 'Each instalment paid comes off the booking balance.' : 'Tip: add the damage to the booking fees first, so each instalment comes off the booking balance.'}</span>
        <button type="button" class="pp-btn primary" onclick="dcOpenPlanModal('${report.id}')">+ Create payment plan</button>
      </div>`;
  }

  const st = ppStatus(plan);
  const paid = ppPaid(plan);
  const pct = Math.min(100, Math.round((paid / plan.totalAmount) * 100));
  const next = ppNextInstallment(plan);
  return `
    <div style="background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <strong style="font-size: 15px;">${plan.customerName}</strong>
          <span style="color: #94a3b8; font-size: 12px; margin-left: 8px;">${ppMoney(plan.weeklyAmount)} / week · paid by phone, chat or at a branch</span>
        </div>
        <span class="pp-pill ${st.key}">${st.label}</span>
      </div>
      <div class="pp-progress"><div class="pp-progress-bar ${st.key}" style="width: ${pct}%"></div></div>
      <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: #cbd5e1;">
        <span>${ppMoney(paid)} paid of ${ppMoney(plan.totalAmount)} (${pct}%)</span>
        <span>${next ? `Next instalment: ${ppFormat(next.dueDate, true)} · ${ppMoney(next.amount)}` : 'Fully paid'}</span>
      </div>
      <div style="margin-top: 8px; font-size: 12px; color: ${report.chargedToBooking && !report.chargedToBooking.removed ? '#34d399' : '#fbbf24'};">
        ${report.chargedToBooking && !report.chargedToBooking.removed
          ? `✓ Instalments paid come off ${report.chargedToBooking.ref}'s booking balance (damage on Booking Fees).`
          : '⚠ The damage is not on the booking fees yet, so instalments are not reducing the booking balance. Use "Add to Booking Fees" above.'}
      </div>
      <div style="text-align: right; margin-top: 12px;">
        <a class="pp-link" href="agent-dashboard.html#payments:${encodeURIComponent(plan.id)}">Open in Payment Plans ↗</a>
      </div>
    </div>`;
}

let dcPlanReportId = null;

function dcOpenPlanModal(reportId) {
  const report = allDamageReports.find(d => d.id === reportId);
  if (!report) return;
  dcPlanReportId = reportId;
  const booking = ppFindBookingByRef(report.bookingRef);

  document.getElementById('dc-plan-context').textContent = `Damage report · ${report.plate} · incident ${report.dateOfIncident || 'N/A'}`;
  document.getElementById('dc-pp-name').value = report.renter || (booking ? booking.name : '');
  document.getElementById('dc-pp-email').value = booking ? booking.email : '';
  document.getElementById('dc-pp-ref').value = report.bookingRef || '';
  document.getElementById('dc-pp-phone').value = '';
  document.getElementById('dc-pp-reason').value = `${report.atFault === 'Yes' ? 'At-fault damage' : 'Damage'} — ${(report.description || '').slice(0, 80)}`;
  document.getElementById('dc-pp-total').value = '';
  document.getElementById('dc-pp-weekly').value = '';
  document.getElementById('dc-pp-first').value = ppAddDays(ppToday(), 7);
  document.getElementById('dc-pp-card').value = '';
  document.getElementById('dc-pp-error').textContent = booking ? '' : 'Booking not found — please enter the customer email manually.';
  dcUpdatePlanPreview();
  document.getElementById('dc-plan-modal').classList.add('open');
}

function dcClosePlanModal() {
  document.getElementById('dc-plan-modal').classList.remove('open');
}

function dcUpdatePlanPreview() {
  const html = ppPreviewText(
    parseFloat(document.getElementById('dc-pp-total').value),
    parseFloat(document.getElementById('dc-pp-weekly').value),
    document.getElementById('dc-pp-first').value
  );
  document.getElementById('dc-pp-preview').innerHTML = html || 'Enter the amount owed, weekly instalment and first instalment date to preview the schedule.';
}

function dcCreatePlan() {
  const report = allDamageReports.find(d => d.id === dcPlanReportId);
  if (!report) return;
  const val = id => document.getElementById(id).value.trim();
  const booking = ppFindBookingByRef(val('dc-pp-ref'));
  const vehicle = fleetGetVehicle(report.plate);

  const input = {
    customerName: val('dc-pp-name'),
    email: val('dc-pp-email'),
    phone: val('dc-pp-phone'),
    bookingRef: val('dc-pp-ref'),
    vehicle: booking ? booking.vehicle : (vehicle ? vehicle.model : '—'),
    plate: report.plate,
    reason: val('dc-pp-reason'),
    damageReportId: report.id,
    totalAmount: parseFloat(val('dc-pp-total')),
    weeklyAmount: parseFloat(val('dc-pp-weekly')),
    cardLast4: val('dc-pp-card'),
    firstDate: val('dc-pp-first')
  };
  const error = ppValidatePlanInput(input);
  if (error) { document.getElementById('dc-pp-error').textContent = error; return; }

  const plan = ppCreatePlanRecord(input);
  report.lastModifiedBy = getActiveAgent();
  report.lastModifiedAt = new Date().toLocaleString('en-GB');
  saveDamageReports();

  dcClosePlanModal();
  renderDamageList();
  showDamageDetails(report.id, null);
  ppToast(`Payment plan created: ${plan.installments.length} weekly instalments of ${ppMoney(plan.weeklyAmount)}.`);
}

window.addEventListener('DOMContentLoaded', () => {
  loadDamageReports();
  ppSeedIfEmpty(); // planos de exemplo, já ligados aos relatórios de exemplo (damageReportId)

  renderDamageList();
});