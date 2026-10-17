// ==========================================
// DAILY ACTIVITY — relatório de retiradas e devoluções (estilo "Vehicle Activity Report" do RCM)
// Mesmas reservas do Fleet Planner: demo (FLEET_SEED_BOOKINGS), portal/checkout/Add Booking
// (gc_multi_bookings_*), reserva principal GC-8832 e devoluções do ledger de bonds.
// Notas de cada reserva aparecem em linhas logo abaixo dela.
// Depende de: gc-fleet-data.js, gc-fees-data.js, gc-bonds.js, gc-ui.js
// ==========================================

const DA_FILTERS_KEY = 'gc_da_filters';
const DA_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DA_STATUS_LABELS = {
  reservation: 'Res', hired: 'Hired', returned: 'Returned', maintenance: 'Maintenance',
  'possible-ext': 'Possible Ext.', fleet_pending: 'Request', proposal_sent: 'Offer Sent', cancelled: 'Cancelled'
};

let daRecords = [];
const daTableState = { pickup: { limit: 'all', filter: '' }, dropoff: { limit: 'all', filter: '' } };

// ---------- Helpers ----------
function daEsc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function daPad(n) { return String(n).padStart(2, '0'); }
function daDate(ms) { const d = new Date(ms); return `${daPad(d.getDate())}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()}`; }
function daTime(ms) { const d = new Date(ms); return `${daPad(d.getHours())}:${daPad(d.getMinutes())}`; }
function daMoney(n) { return '$' + (Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function daBranchCode(loc) { return Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === loc) || ''; }
function daIsoDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${daPad(d.getMonth() + 1)}-${daPad(d.getDate())}`; }
function daVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

// Celular de exemplo estável por referência (reservas de demonstração não têm telefone)
function daDemoMobile(ref) {
  const h = fleetHash('mobile:' + ref);
  return `04${daPad(h % 100)} ${String(100 + (h >>> 7) % 900)} ${String(100 + (h >>> 17) % 900)}`;
}

function daItemsText(b) {
  const out = [];
  // Reserva com Booking Fees (Planner / Bookings / site): itens escolhidos, sem o bond e devoluções
  if (b.fees && typeof feeGetItem === 'function') {
    (b.fees.items || []).forEach(i => {
      const item = feeGetItem(i.id);
      if (item && !item.bond && !item.refund && item.kind !== 'percent') out.push(`${item.name}${i.qty > 1 ? ' ×' + i.qty : ''}`);
    });
    if (b.fees.insurance === 'reduced') out.push('Excess reduction');
    return out.join(', ');
  }
  const x = b.extras || {};
  if (x.childSeat) out.push(`Child seat ×${x.childSeat}`);
  if (x.booster) out.push(`Booster ×${x.booster}`);
  if (b.excessOption === 'reduced') out.push('Excess reduction');
  return out.join(', ');
}

// ---------- Coleta das reservas ----------
function daCollect() {
  const now = Date.now();
  const ledger = typeof bondReadLedger === 'function' ? bondReadLedger() : {};
  const out = [];

  const finish = r => {
    const rec = ledger[r.id];
    if (rec && !rec.seed && rec.fees && r.type !== 'maintenance') r.type = 'returned';
    r.vehicle = r.plate && !fleetIsVirtualPlate(r.plate) ? fleetGetVehicle(r.plate) : null;
    r.virtualVehicle = r.plate && fleetIsVirtualPlate(r.plate) && r.virtualFrom ? fleetGetVehicle(r.virtualFrom) : null;
    r.cat = r.cat || ((r.vehicle || r.virtualVehicle) ? fleetGetCategory((r.vehicle || r.virtualVehicle).categoryId) : null);
    r.maintenance = r.type === 'maintenance';
    r.days = r.maintenance ? 0 : Math.max(1, Math.ceil((r.end - r.start) / FLEET_DAY_MS));
    r.rate = r.maintenance || !r.cat ? 0 : r.cat.rate;
    if (r.value == null) r.value = r.maintenance ? 0 : r.rate * r.days;
    r.nonRevenue = !r.maintenance && (r.type === 'possible-ext' || r.value === 0);
    // Status = tipo no Fleet Planner (Reservation → Res, Hired, Returned…)
    r.statusKey = r.status && DA_STATUS_LABELS[r.status] && ['fleet_pending', 'proposal_sent', 'cancelled'].includes(r.status) ? r.status : r.type;
    // Sem pagamento registrado: pago na retirada (Hired/Returned não devem nada)
    if (r.balance == null) r.balance = ['hired', 'returned', 'maintenance'].includes(r.statusKey) ? 0 : r.value;
    out.push(r);
  };

  // 1. Reservas de demonstração do Planner
  // fleetSeedBookings(): lê na hora as alterações gravadas (Update / notas em outra janela)
  fleetSeedBookings().forEach(s => {
    const v = fleetGetVehicle(s.plate);
    const lead = 2 + fleetHash('lead:' + s.ref) % 28;
    finish({
      id: s.id, plannerId: s.id, ref: s.ref, refNo: '', plate: s.plate,
      fname: s.fname, lname: s.lname, email: s.clientEmail,
      customer: s.type === 'maintenance' ? (s.name || 'MAINTENANCE') : `${s.fname} ${s.lname}`,
      phone: s.type === 'maintenance' ? '' : daDemoMobile(s.ref),
      type: s.type, doNotMove: !!s.doNotMove,
      start: s.startMs, end: s.endMs,
      pickupCode: v ? v.branch : '', dropoffCode: v ? v.branch : '',
      bookedMs: s.type === 'maintenance' ? s.startMs - FLEET_DAY_MS : s.startMs - lead * FLEET_DAY_MS, seriesId: s.seriesId,
      items: '', arrival: '', card: '', notes: s.notesList || [], source: 'Phone'
    });
  });

  // 2. Reservas do site, portal e Add Booking
  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    const r = fleetBookingRange(b);
    if (isNaN(r.start)) return;
    const holding = b.plate && !FLEET_NON_HOLDING_STATUSES.includes(b.status);
    const cat = fleetFindCategoryByModel(b.vehicle);
    // Valor e pagamento iguais aos da aba Payments do Planner (os dois formatos de reserva)
    const money = typeof feeBookingMoney === 'function' ? feeBookingMoney(b, cat) : null;
    const value = money ? money.grand : (b.priceTotal != null ? Number(b.priceTotal) : null);
    const paid = money ? money.paid : (Number(b.amountPaid) || 0);
    const loc = b.loc || '';
    const drop = b.dropoff && b.dropoff !== 'Same as Pick up' ? b.dropoff : loc;
    finish({
      id: String(b.id), plannerId: holding ? String(b.id) : null, ref: b.ref || ('OR-' + String(b.id).slice(-6)),
      refNo: b.referenceNo || (b.details && b.details.referenceNo) || '',
      plate: holding ? b.plate : null, virtualFrom: b.virtualFrom,
      fname: b.fname || '', lname: b.lname || '', email,
      customer: `${b.fname || ''} ${b.lname || ''}`.trim() || email,
      phone: b.phone || '',
      type: b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation',
      status: b.status, doNotMove: !!b.doNotMove || b.plannerType === 'donotmove',
      start: r.start, end: r.end, cat,
      pickupCode: daBranchCode(loc), dropoffCode: daBranchCode(drop),
      bookedMs: isNaN(Number(b.id)) ? r.start : Number(b.id),
      items: daItemsText(b), arrival: b.flight || '', card: paid > 0 ? 'Visa' : '',
      notes: b.notesList || [], source: b.source || 'Direct Website', seriesId: b.seriesId,
      value, balance: value != null ? Math.max(0, value - paid) : null
    });
  }));

  // 3. Reserva principal do portal (GC-8832)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length || state.status === 'cancelled') continue;
    const email = key.replace(FLEET_MAIN_PREFIX, '');
    const r = fleetMainBookingRange(state);
    finish({
      id: 'main-' + email, plannerId: 'main-' + email, ref: 'GC-8832', refNo: '', plate: FLEET_MAIN_BOOKING_PLATE,
      fname: 'Felipe', lname: 'Grigolli', email, customer: 'Felipe Grigolli', phone: '0412 345 678',
      type: fleetMainBookingType(state), start: r.start, end: r.end,
      pickupCode: 'MAS', dropoffCode: 'MAS', bookedMs: r.start - 20 * FLEET_DAY_MS,
      items: '', arrival: '', card: 'Visa', notes: fleetBookingNotes('main-' + email), source: 'Direct Website'
    });
  }

  daLinkRentals(out, now);
  return out;
}

// Locação anterior / seguinte do mesmo veículo e aviso de limpeza
function daLinkRentals(records, now) {
  const byPlate = {};
  records.forEach(r => {
    if (!r.vehicle || r.maintenance || r.type === 'possible-ext' || r.statusKey === 'cancelled') return;
    (byPlate[r.plate] = byPlate[r.plate] || []).push(r);
  });
  Object.values(byPlate).forEach(list => list.sort((a, b) => a.start - b.start));

  records.forEach(r => {
    const list = r.vehicle ? byPlate[r.plate] || [] : [];
    r.prev = list.filter(o => o !== r && o.end <= r.start + 60000).pop() || null;
    r.next = list.find(o => o !== r && o.start >= r.end - 60000) || null;
    r.prevOut = r.prev ? (r.prev.type === 'hired' || (r.prev.type !== 'returned' && r.prev.end > now)) : false;
    r.notCleaned = !!r.prev && !r.maintenance && r.start > now && r.prev.type !== 'maintenance' &&
                   r.start - r.prev.end < FLEET_DAY_MS && (r.prev.end <= now || r.prevOut);
  });
}

// ---------- Filtros ----------
function daInitFilters() {
  const branchOpts = '<option value="ALL">All Locations</option>' +
    Object.entries(FLEET_BRANCHES).map(([code, name]) => `<option value="${code}">${fleetBranchLabel(name)}</option>`).join('');
  document.getElementById('da-branch').innerHTML = branchOpts;

  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${daPad(h)}">${daPad(h)}</option>`).join('');
  const mins = Array.from({ length: 12 }, (_, i) => `<option value="${daPad(i * 5)}">${daPad(i * 5)}</option>`).join('');
  ['da-from-h', 'da-to-h'].forEach(id => { document.getElementById(id).innerHTML = hours; });
  ['da-from-m', 'da-to-m'].forEach(id => { document.getElementById(id).innerHTML = mins; });

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(DA_FILTERS_KEY)); } catch (e) {}
  const today = daIsoDate(Date.now());
  const f = Object.assign({
    branch: 'ALL', fromDate: today, fromH: '00', fromM: '00', toDate: today, toH: '23', toM: '55',
    section: 'ALL', category: 'ALL', brand: 'ALL', activity: 'current', list: 'both',
    balance: 'include', notes: 'include', nonrev: 'include', lite: false, fixed: true
  }, saved || {});

  document.getElementById('da-branch').value = f.branch;
  document.getElementById('da-from-date').value = f.fromDate;
  document.getElementById('da-from-h').value = f.fromH;
  document.getElementById('da-from-m').value = f.fromM;
  document.getElementById('da-to-date').value = f.toDate;
  document.getElementById('da-to-h').value = f.toH;
  document.getElementById('da-to-m').value = f.toM;
  document.getElementById('da-section').value = f.section;
  daFillCategories(f.category);
  document.getElementById('da-brand').value = f.brand;
  document.getElementById('da-activity').value = f.activity;
  document.getElementById('da-list').value = f.list;
  document.getElementById('da-balance').value = f.balance;
  document.getElementById('da-notes').value = f.notes;
  document.getElementById('da-nonrev').value = f.nonrev;
  document.getElementById('da-lite').checked = !!f.lite;
  document.getElementById('da-fixed').checked = f.fixed !== false;
}

function daFillCategories(selected) {
  const section = daVal('da-section') || 'ALL';
  const sel = document.getElementById('da-category');
  sel.innerHTML = '<option value="ALL">All Category</option>' +
    FLEET_CATEGORIES.filter(c => section === 'ALL' || c.section === section)
      .map(c => `<option value="${c.id}">${daEsc(c.name)}</option>`).join('');
  sel.value = selected && Array.from(sel.options).some(o => o.value === selected) ? selected : 'ALL';
}

function daReadFilters() {
  return {
    branch: daVal('da-branch'), fromDate: daVal('da-from-date'), fromH: daVal('da-from-h'), fromM: daVal('da-from-m'),
    toDate: daVal('da-to-date'), toH: daVal('da-to-h'), toM: daVal('da-to-m'),
    section: daVal('da-section'), category: daVal('da-category'), brand: daVal('da-brand'), activity: daVal('da-activity'),
    list: daVal('da-list'), balance: daVal('da-balance'), notes: daVal('da-notes'), nonrev: daVal('da-nonrev'),
    lite: document.getElementById('da-lite').checked, fixed: document.getElementById('da-fixed').checked
  };
}

function daSaveFilters(f) {
  try { sessionStorage.setItem(DA_FILTERS_KEY, JSON.stringify(f)); } catch (e) {}
}

function daShiftDay(step) {
  ['da-from-date', 'da-to-date'].forEach(id => {
    const el = document.getElementById(id);
    const d = el.value ? new Date(el.value + 'T00:00') : new Date();
    d.setDate(d.getDate() + step);
    el.value = daIsoDate(d.getTime());
  });
  daView();
}

function daToday() {
  const today = daIsoDate(Date.now());
  document.getElementById('da-from-date').value = today;
  document.getElementById('da-to-date').value = today;
  daView();
}

// ---------- Colunas ----------
// lite: some na "Lite version" | money: some com "Exclude Balance" | only: só numa das listas
function daColumns(mode) {
  const pickup = mode === 'pickup';
  const cols = [
    { key: 'n', label: '#' },
    { key: 'res', label: 'Res.' },
    { key: 'refNo', label: 'Ref.', lite: true },
    { key: 'update', label: 'Update', action: true },
    { key: 'change', label: 'Change', lite: true, action: true },
    { key: 'notesBtn', label: 'Notes', action: true },
    { key: 'status', label: 'Status' }
  ];
  const pickupCols = [
    { key: 'pickupCode', label: 'Pickup' }, { key: 'pDay', label: 'Day' }, { key: 'pDate', label: 'Pickup Date' }, { key: 'pTime', label: 'Time' },
    { key: 'dropoffCode', label: 'Dropoff' }, { key: 'dDate', label: 'Dropoff Date' }
  ];
  const dropCols = [
    { key: 'dropoffCode', label: 'Dropoff' }, { key: 'dDay', label: 'Day' }, { key: 'dDate', label: 'Dropoff Date' }, { key: 'dTime', label: 'Time' },
    { key: 'pickupCode', label: 'Pickup' }, { key: 'pDate', label: 'Pickup Date' }
  ];
  return cols.concat(pickup ? pickupCols : dropCols, [
    { key: 'booked', label: 'Booked', lite: true },
    { key: 'days', label: '# Days' },
    { key: 'category', label: 'Category' },
    { key: 'plate', label: 'Vehicle' },
    { key: 'location', label: 'Current Location' },
    { key: 'colour', label: 'Colour', lite: true },
    { key: 'items', label: 'Items', lite: true },
    { key: 'customer', label: 'Customer' },
    { key: 'mobile', label: 'Mobile', lite: true },
    pickup ? { key: 'arrival', label: 'Arrival', lite: true } : null,
    pickup ? { key: 'lastRental', label: 'Last rental' } : { key: 'nextRental', label: 'Next rental' },
    { key: 'checkin', label: 'Checkin Completed', lite: true },
    { key: 'esign', label: 'E-Sign Send', lite: true },
    { key: 'esigned', label: 'Primary Driver E-Signed', lite: true },
    { key: 'card', label: 'Credit Card', lite: true },
    { key: 'rate', label: 'Daily Rate', money: true, num: true },
    { key: 'value', label: 'Rental Value', money: true, num: true },
    { key: 'balance', label: 'Balance', money: true, num: true }
  ].filter(Boolean));
}

function daVisibleColumns(mode, f) {
  return daColumns(mode).filter(c => !(f.lite && c.lite) && !(f.balance === 'exclude' && c.money));
}

function daRentalCell(o, label) {
  if (!o) return '<span class="da-muted">—</span>';
  const status = o.type === 'returned' || (o.end <= Date.now() && o.type !== 'hired') ? 'Returned' : (o.start <= Date.now() ? 'Hired' : 'Reserved');
  const out = label === 'last' && (o.type === 'hired' || (o.type !== 'returned' && o.end > Date.now() && o.start <= Date.now()));
  const when = label === 'last' ? o.end : o.start;
  return `${daEsc(label === 'last' ? o.dropoffCode : o.pickupCode)}<br>#${daEsc(o.ref)} ${status}<br>${daDate(when)} ${daTime(when)}` +
         (out ? '<br><span class="da-red">Not Returned</span>' : '');
}

// Valor da célula: html (tela) e text (Excel / copiar)
function daCell(col, r, i) {
  const yesNo = v => v ? 'Yes' : 'No';
  const signed = ['hired', 'returned'].includes(r.statusKey);
  switch (col.key) {
    case 'n': return { text: i + 1 };
    case 'res': return { html: `<span class="da-res">${daEsc(r.ref)}</span>`, text: r.ref };
    case 'refNo': return { text: r.refNo };
    case 'update': return { html: r.plannerId
      ? `<button type="button" class="da-btn" onclick="daOpenPlanner('${daEsc(r.plannerId)}')">Update</button>`
      : `<button type="button" class="da-btn" onclick="window.location.href='agent-dashboard.html#module-agent-requests'">Allocate</button>`, text: '' };
    case 'change': return { html: r.maintenance ? '' : `<button type="button" class="da-btn" onclick="daOpenCustomer('${daEsc(r.ref)}')">Customer</button>`, text: '' };
    case 'notesBtn': return { html: `<button type="button" class="da-btn" onclick="daOpenNotes('${daEsc(r.id)}')">View</button>`, text: '' };
    case 'status': {
      const label = DA_STATUS_LABELS[r.statusKey] || r.statusKey;
      const badges = (r.notCleaned ? '<span class="da-badge clean">Not Cleaned</span>' : '') +
                     (r.doNotMove ? '<span class="da-badge dnm">Do Not Move</span>' : '') +
                     (r.seriesId ? `<span class="da-badge series" title="Weekly series ${daEsc(r.seriesId)}">↻ Weekly</span>` : '');
      return { html: `<span class="da-status s-${daEsc(r.statusKey)}">${daEsc(label)}</span>${badges}`, text: label + (r.notCleaned ? ' (Not Cleaned)' : '') };
    }
    case 'pickupCode': return { text: r.pickupCode || '—' };
    case 'dropoffCode': return { text: r.dropoffCode || '—' };
    case 'pDay': return { text: DA_DAY_NAMES[new Date(r.start).getDay()] };
    case 'dDay': return { text: DA_DAY_NAMES[new Date(r.end).getDay()] };
    case 'pDate': return { text: daDate(r.start) };
    case 'pTime': return { text: daTime(r.start) };
    case 'dDate': return { text: daDate(r.end) };
    case 'dTime': return { text: daTime(r.end) };
    case 'booked': return { text: daDate(r.bookedMs) };
    case 'days': return { text: r.days };
    case 'category': {
      if (!r.cat) return { text: '—' };
      return { html: `${daEsc(r.cat.model)}<br><span class="da-muted">${daEsc(r.cat.label)}</span>`, text: `${r.cat.model} (${r.cat.name})` };
    }
    case 'plate': {
      if (r.vehicle) return { html: `<a class="da-plate" href="gc-customers.html?rego=${encodeURIComponent(r.plate)}" title="Every booking on this vehicle">${daEsc(r.plate)}</a>`, text: r.plate };
      if (r.plate && fleetIsVirtualPlate(r.plate)) return { html: '<span class="da-amber">In Virtual</span>', text: 'In Virtual' };
      return { html: '<span class="da-red">Unallocated</span>', text: 'Unallocated' };
    }
    case 'location': {
      const v = r.vehicle || r.virtualVehicle;
      return { text: v ? v.branch : '—' };
    }
    case 'colour': return { text: r.vehicle ? 'White' : '' };
    case 'items': return { text: r.items };
    case 'customer': return { html: r.maintenance ? `<strong>${daEsc(r.customer)}</strong>` : daEsc(r.customer), text: r.customer };
    case 'mobile': return { text: r.phone };
    case 'arrival': return { text: r.arrival };
    case 'lastRental': return { html: daRentalCell(r.prev, 'last'), text: r.prev ? `${r.prev.dropoffCode} #${r.prev.ref} ${daDate(r.prev.end)} ${daTime(r.prev.end)}` : '' };
    case 'nextRental': return { html: daRentalCell(r.next, 'next'), text: r.next ? `${r.next.pickupCode} #${r.next.ref} ${daDate(r.next.start)} ${daTime(r.next.start)}` : '' };
    case 'checkin': return { text: yesNo(r.type === 'returned') };
    case 'esign': return { text: r.maintenance ? '' : yesNo(signed) };
    case 'esigned': return { text: r.maintenance ? '' : yesNo(signed) };
    case 'card': return { text: r.card };
    case 'rate': return { text: daMoney(r.rate) };
    case 'value': return { text: daMoney(r.value) };
    case 'balance': return { html: r.balance > 0 ? `<span class="da-amber">${daMoney(r.balance)}</span>` : daMoney(r.balance), text: daMoney(r.balance) };
    default: return { text: '' };
  }
}

function daNoteText(n) {
  return `${n.subject && n.subject !== '-' ? n.subject + ': ' : ''}${n.text}`;
}

// ---------- Seleção das linhas ----------
function daRange(f) {
  const from = new Date(`${f.fromDate}T${f.fromH}:${f.fromM}`).getTime();
  const to = new Date(`${f.toDate}T${f.toH}:${f.toM}`).getTime() + 59999;
  return { from, to };
}

function daRows(mode, f) {
  const { from, to } = daRange(f);
  const st = daTableState[mode];
  const term = st.filter.trim().toLowerCase();
  return daRecords.filter(r => {
    const t = mode === 'pickup' ? r.start : r.end;
    if (isNaN(t) || t < from || t > to) return false;
    const code = mode === 'pickup' ? r.pickupCode : r.dropoffCode;
    if (f.branch !== 'ALL' && code !== f.branch) return false;
    if (f.section !== 'ALL' && (!r.cat || r.cat.section !== f.section)) return false;
    if (f.category !== 'ALL' && (!r.cat || r.cat.id !== f.category)) return false;
    if (f.activity === 'current' && r.statusKey === 'cancelled') return false;
    // Retiradas: só o que ainda falta sair (Hired / Returned já saíram)
    if (mode === 'pickup' && (r.statusKey === 'hired' || r.statusKey === 'returned')) return false;
    if ((f.nonrev === 'exclude-both' || f.nonrev === 'exclude-maint') && r.maintenance) return false;
    if ((f.nonrev === 'exclude-both' || f.nonrev === 'exclude-nonrev') && r.nonRevenue) return false;
    if (term) {
      const hay = [r.ref, r.refNo, r.customer, r.email, r.plate, r.phone, r.cat && r.cat.model, r.cat && r.cat.name,
                   ...r.notes.map(daNoteText)].join(' ').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }).sort((a, b) => (mode === 'pickup' ? a.start - b.start : a.end - b.end) || String(a.ref).localeCompare(String(b.ref)));
}

// ---------- Render ----------
function daView() {
  const f = daReadFilters();
  if (!f.fromDate || !f.toDate) { gcToast('Please choose both dates.', 'warning'); return; }
  const { from, to } = daRange(f);
  if (to < from) { gcToast('"To" must be after "From".', 'warning'); return; }
  daSaveFilters(f);
  daRecords = daCollect();

  const sameDay = f.fromDate === f.toDate;
  const fromD = new Date(f.fromDate + 'T00:00');
  document.getElementById('da-day-title').textContent = sameDay
    ? fromD.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${daDate(from)} – ${daDate(new Date(f.toDate + 'T00:00').getTime())}`;
  document.getElementById('da-day-sub').textContent = f.branch === 'ALL' ? 'All locations' : FLEET_BRANCHES[f.branch];

  const results = document.getElementById('da-results');
  results.classList.toggle('da-fixed', f.fixed);
  const parts = [daStaleHtml()];
  if (f.list !== 'dropoff') parts.push(daSectionHtml('pickup', 'Pickup List', f));
  if (f.list !== 'pickup') parts.push(daSectionHtml('dropoff', 'Drop off List', f));
  results.innerHTML = parts.join('');
}

function daSectionHtml(mode, title, f) {
  const cols = daVisibleColumns(mode, f);
  const all = daRows(mode, f);
  const st = daTableState[mode];
  const rows = st.limit === 'all' ? all : all.slice(0, Number(st.limit));
  const firstNoteCol = Math.min(2, cols.length - 1);

  const body = rows.map((r, i) => {
    const cells = cols.map(c => {
      const v = daCell(c, r, i);
      return `<td class="c-${c.key}${c.num ? ' r' : ''}${c.action ? ' act' : ''}">${v.html != null ? v.html : daEsc(v.text)}</td>`;
    }).join('');
    const rowClass = r.maintenance ? 'maint' : (r.statusKey === 'cancelled' ? 'cancelled' : '');
    let html = `<tr class="da-row ${rowClass}">${cells}</tr>`;
    if (f.notes === 'include' && r.notes.length) {
      html += r.notes.map(n => `
        <tr class="da-note${n.priority === 'High' ? ' high' : ''}">
          <td colspan="${firstNoteCol}"></td>
          <td colspan="${cols.length - firstNoteCol}">${daEsc(daNoteText(n))}<span class="da-note-meta">${daEsc(n.author || '')}${n.dateStr ? ' · ' + daEsc(n.dateStr) : ''}</span></td>
        </tr>`).join('');
    }
    return html;
  }).join('');

  const totalValue = all.reduce((s, r) => s + r.value, 0);
  const totalBalance = all.reduce((s, r) => s + r.balance, 0);
  const footCells = cols.map((c, idx) => {
    if (idx === 0) return `<td colspan="1"></td>`;
    if (c.key === 'value') return `<td class="r">${daMoney(totalValue)}</td>`;
    if (c.key === 'balance') return `<td class="r">${daMoney(totalBalance)}</td>`;
    if (c.key === 'res') return `<td><strong>${all.length}</strong></td>`;
    return `<td class="${c.action ? 'act' : ''}"></td>`;
  }).join('');

  const empty = `<tr><td colspan="${cols.length}" class="da-empty">No ${mode === 'pickup' ? 'pick-ups' : 'drop-offs'} for these filters.</td></tr>`;
  const limits = ['all', '10', '25', '50', '100'].map(v => `<option value="${v}" ${st.limit === v ? 'selected' : ''}>${v === 'all' ? 'All' : v}</option>`).join('');

  return `
    <section class="da-section">
      <h2>${title}</h2>
      <div class="da-table-tools">
        <div class="da-tools-left">
          <label>Show <select onchange="daTableState['${mode}'].limit = this.value; daView();">${limits}</select> entries</label>
          <button type="button" class="da-icon-btn" title="Copy to clipboard" onclick="daCopy('${mode}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
          <button type="button" class="da-icon-btn xls" title="Export to Excel (CSV)" onclick="daExport('${mode}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13l5 5M14 13l-5 5"/></svg></button>
        </div>
        <label class="da-filter">Filter: <input type="text" value="${daEsc(st.filter)}" oninput="daSetFilter('${mode}', this.value)"></label>
      </div>
      <div class="da-table-wrap">
        <table class="da-table">
          <thead><tr>${cols.map(c => `<th class="c-${c.key}${c.num ? ' r' : ''}${c.action ? ' act' : ''}">${daEsc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${body || empty}</tbody>
          ${all.length ? `<tfoot><tr>${footCells}</tr></tfoot>` : ''}
        </table>
      </div>
      <div class="da-count">Showing ${rows.length ? 1 : 0} to ${rows.length} of ${all.length} entries</div>
    </section>`;
}

// Filtro de texto sem perder o foco do campo
let daFilterTimer = null;
function daSetFilter(mode, value) {
  daTableState[mode].filter = value;
  clearTimeout(daFilterTimer);
  daFilterTimer = setTimeout(() => {
    const active = document.activeElement;
    const caret = active && active.selectionStart;
    daView();
    const input = document.querySelector(`.da-section input[oninput*="'${mode}'"]`);
    if (input) { input.focus(); if (caret != null) input.setSelectionRange(caret, caret); }
  }, 180);
}

// ---------- Reservas vencidas (ainda Reservation com retirada antes de hoje) ----------
// Aparecem sempre no topo, em qualquer data do filtro, até serem canceladas ou mudarem de data
function daStaleHtml() {
  const stale = fleetStaleReservations();
  if (!stale.length) return '';
  return `
    <section class="da-stale">
      <div class="da-stale-head">
        <strong>⚠ ${stale.length} reservation${stale.length > 1 ? 's' : ''} past the pick-up date</strong>
        <span>The customer has not collected the vehicle. Move the booking to a new date or cancel it.</span>
      </div>
      ${stale.map(r => `
        <div class="da-stale-row">
          <span class="da-res">${daEsc(r.ref)}</span>
          <span>${daEsc(r.customer)}</span>
          <span class="da-muted">${daEsc(r.model)} · ${daEsc(r.plate)} · ${daEsc(r.branch)}</span>
          <span class="da-amber">${daEsc(fleetStaleLabel(r))}</span>
          <span class="da-stale-actions">
            ${typeof annaDraftNoShow === 'function' ? `<button type="button" class="anna-link-btn" onclick="annaDraftNoShow('${daEsc(r.id)}')" title="Concept: Anna drafts the message">✦ Draft message</button>` : ''}
            ${typeof waComposeForBooking === 'function' ? `<button type="button" class="wa-inline-btn" onclick="waComposeForBooking('${daEsc(r.id)}', 'no_show', 'Missed pick-up · WhatsApp')">${waIcon(13)} WhatsApp</button>` : ''}
            <button type="button" class="da-btn" onclick="daOpenPlanner('${daEsc(r.id)}')">Move date</button>
            <button type="button" class="da-btn danger" onclick="daCancelStale('${daEsc(r.id)}')">Cancel booking</button>
            <button type="button" class="da-btn ghost" onclick="daOpenNotes('${daEsc(r.id)}')">Notes</button>
          </span>
        </div>`).join('')}
    </section>`;
}

// ---------- Lembretes de retirada por WhatsApp (via 3CX) ----------
// Dia alvo: o dia exibido no relatório se for no futuro; senão, amanhã (lembrete na véspera)
function daWhatsAppReminders() {
  if (typeof waReminderDialog !== 'function') return;
  const f = daReadFilters();
  const tomorrow = fleetStartOfToday() + FLEET_DAY_MS;
  const shown = f.fromDate ? new Date(f.fromDate + 'T00:00').getTime() : tomorrow;
  const day0 = shown >= tomorrow ? shown : tomorrow;
  const day1 = fleetShiftMs(day0, 1);
  const list = daCollect().filter(r => r.start >= day0 && r.start < day1 && !r.maintenance &&
    ['reservation', 'confirmed', 'updated'].includes(r.statusKey) && r.type !== 'possible-ext')
    .sort((a, b) => a.start - b.start)
    .map(r => ({ id: r.id, ref: r.ref, customer: r.customer, phone: r.phone, start: r.start,
      model: r.cat ? r.cat.model : '', branch: r.pickupCode }));
  const label = day0 === tomorrow ? 'tomorrow, ' + daDate(day0) : daDate(day0);
  waReminderDialog(list, label);
}

async function daCancelStale(id) {
  const r = fleetStaleReservations().find(x => x.id === id);
  if (!r) return;
  const ok = await gcConfirm({ title: `Cancel booking ${r.ref}?`, message: `${r.customer} did not collect the vehicle. The booking will be cancelled and ${r.plate} becomes available.`, confirmText: 'Cancel booking', cancelText: 'Keep it', danger: true });
  if (!ok) return;
  fleetCancelBooking(id);
  daView();
  gcToast(`Booking ${r.ref} cancelled.`);
}

// ---------- Ações das linhas ----------
// Janela solta (popup), centralizada sobre o relatório; reusa a mesma janela por reserva
function daPopup(url, name, width, height) {
  const w = Math.min(width, screen.availWidth - 40);
  const h = Math.min(height, screen.availHeight - 60);
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - h) / 2);
  const win = window.open(url, name, `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`);
  if (!win) { gcToast('The browser blocked the pop-up window\n\nAllow pop-ups for this page and try again.', 'warning'); return; }
  win.focus();
}

// Update: edição da reserva (modal do Fleet Planner) numa janela separada
function daOpenPlanner(id) {
  daPopup('gc-fleet-planner.html?popup=1&open=' + encodeURIComponent(id), 'gcBooking_' + id.replace(/\W/g, '_'), 1180, 860);
}

function daOpenCustomer(ref) {
  window.location.href = 'gc-customers.html?search=' + encodeURIComponent(ref);
}

// View (Notes): lista de notas com "Add Notes", como no RCM
function daOpenNotes(id) {
  daPopup('gc-notes.html?id=' + encodeURIComponent(id), 'gcNotes_' + id.replace(/\W/g, '_'), 860, 560);
}

// ---------- Exportar / copiar / imprimir ----------
function daTableData(mode) {
  const f = daReadFilters();
  const cols = daVisibleColumns(mode, f).filter(c => !c.action);
  const header = cols.map(c => c.label);
  if (f.notes === 'include') header.push('Notes');
  const rows = daRows(mode, f).map((r, i) => {
    const line = cols.map(c => String(daCell(c, r, i).text == null ? '' : daCell(c, r, i).text));
    if (f.notes === 'include') line.push(r.notes.map(daNoteText).join(' | '));
    return line;
  });
  return [header, ...rows];
}

function daCsv(data) {
  return data.map(row => row.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
}

function daDownload(text, name) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function daFileStamp() {
  const f = daReadFilters();
  return f.fromDate === f.toDate ? f.fromDate : `${f.fromDate}_to_${f.toDate}`;
}

function daExport(mode) {
  daDownload(daCsv(daTableData(mode)), `daily-activity-${mode === 'pickup' ? 'pickups' : 'dropoffs'}-${daFileStamp()}.csv`);
  gcToast('Excel file downloaded.');
}

function daExportAll() {
  const f = daReadFilters();
  const parts = [];
  if (f.list !== 'dropoff') parts.push('Pickup List\r\n' + daCsv(daTableData('pickup')));
  if (f.list !== 'pickup') parts.push('Drop off List\r\n' + daCsv(daTableData('dropoff')));
  daDownload(parts.join('\r\n\r\n'), `daily-activity-${daFileStamp()}.csv`);
  gcToast('Excel file downloaded.');
}

function daCopy(mode) {
  const text = daTableData(mode).map(r => r.join('\t')).join('\n');
  const done = () => gcToast('Table copied to the clipboard.');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => daCopyFallback(text, done));
  } else daCopyFallback(text, done);
}

function daCopyFallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { gcToast('Could not copy the table.', 'error'); }
  ta.remove();
}

function daPrint() { window.print(); }

function daPdf() {
  gcToast('Choose "Save as PDF" as the printer\n\nThe print window opens next.', 'info');
  setTimeout(() => window.print(), 700);
}

function daToggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
}

// ---------- Início ----------
window.addEventListener('DOMContentLoaded', () => {
  daInitFilters();
  daView();
});

// Voltou para o relatório (ex.: fechou a janela do Update ou das notas): atualiza a lista
window.addEventListener('focus', () => {
  const active = document.activeElement;
  if (active && active.matches && active.matches('.da-filter input')) return; // não atrapalha quem está digitando no filtro
  daView();
});

// Outra janela mudou reservas ou notas (Update, Notes, site, portal, planner): atualiza a lista
let daRefreshTimer = null;
window.addEventListener('storage', e => {
  if (!e.key) return;
  if (e.key.startsWith(FLEET_MULTI_PREFIX) || e.key.startsWith(FLEET_MAIN_PREFIX) || e.key === 'gc_bond_ledger' || e.key === FLEET_SEED_OVERRIDES_KEY) {
    clearTimeout(daRefreshTimer);
    daRefreshTimer = setTimeout(daView, 120);
  }
});
