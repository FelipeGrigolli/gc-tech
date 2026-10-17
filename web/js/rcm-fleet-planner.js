// ==========================================
// MÓDULO FLEET PLANNER (GANTT CHART INTERATIVO)
// A frota (categorias, placas, filiais) e as reservas fixas de demonstração
// vêm de js/gc-fleet-data.js — que precisa ser carregado ANTES deste arquivo.
// ==========================================

const BASE_DATE_MS = new Date('2026-09-24T00:00:00').getTime();
const MS_IN_DAY = FLEET_DAY_MS;
const DEFAULT_VIEW_DAYS = 31;
const MAX_VIEW_DAYS = 92;
const COLLAPSED_KEY = 'gc_planner_collapsed';
const FILTERS_KEY = 'gc_planner_filters';

let viewStartMs = addDays(startOfDay(Date.now()), -2);
let viewDays = DEFAULT_VIEW_DAYS;
let plannerFilters = { branch: 'ALL', section: 'ALL', category: 'ALL', search: '' };
let activeBookingId = null;

let plannerBookings = FLEET_SEED_BOOKINGS.map(s => ({
  id: s.id,
  ref: s.ref,
  plate: s.plate,
  fname: s.fname,
  lname: s.lname,
  clientEmail: s.clientEmail,
  name: s.name || `${s.ref}: ${s.fname.charAt(0)}. ${s.lname.toUpperCase()}`,
  type: s.type,
  doNotMove: !!s.doNotMove,
  loc: s.loc || FLEET_BRANCHES[fleetGetVehicle(s.plate).branch],
  dropoffLoc: s.dropoffLoc,
  pickupStr: formatCustomDate(s.startMs),
  dropoffStr: formatCustomDate(s.endMs),
  notesList: s.notesList.map(n => ({ ...n })),
  seriesId: s.seriesId,
  // Alterações gravadas (Booking Fees, motorista, detalhes) — gc-fleet-data.js → fleetApplySeedOverride
  fees: s.fees, details: s.details, phone: s.phone, licence: s.licence, driver: s.driver, paidSnapshot: s.paidSnapshot
}));

// ==========================================
// FUNÇÕES DE CONVERSÃO DE TEMPO
// ==========================================
function parseDateTime(str) {
  const ms = fleetParseDate(str);
  return isNaN(ms) ? BASE_DATE_MS : ms;
}

function formatCustomDate(ms) {
  let d = new Date(ms);
  let days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let hrs = d.getHours().toString().padStart(2, '0');
  let mins = d.getMinutes().toString().padStart(2, '0');
  return `${days[d.getDay()]} ${d.getDate()}-${months[d.getMonth()]} ${d.getFullYear()} ${hrs}:${mins}`;
}

function toDatetimeLocalString(dateObj) {
  const pad = n => n.toString().padStart(2, '0');
  return dateObj.getFullYear() + '-' +
         pad(dateObj.getMonth() + 1) + '-' +
         pad(dateObj.getDate()) + 'T' +
         pad(dateObj.getHours()) + ':' +
         pad(dateObj.getMinutes());
}

function getCurrentNoteDateStr() {
    let d = new Date();
    let months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${months[d.getMonth()]}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Soma dias pelo calendário (e não 24h fixas), para não desalinhar na troca de horário de verão
function addDays(ms, n) {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ==========================================
// CARREGAMENTO E PERSISTÊNCIA DAS RESERVAS DINÂMICAS
// ==========================================
// Bate se ficar a menos de 15 min de outro booking no veículo (fleetTimesClash).
// Sem intervalo: área Virtual, Possible Extension/Weekend hold, ou noGap (a própria extensão sendo colocada).
function checkConflict(targetPlate, reqStartMs, reqEndMs, ignoreBookingId = null, noGap = false) {
  let vBookings = plannerBookings.filter(b => b.plate === targetPlate && b.id !== ignoreBookingId);
  for (let b of vBookings) {
    let bStart = parseDateTime(b.pickupStr);
    let bEnd = parseDateTime(b.dropoffStr);
    const free = noGap || b.type === 'possible-ext' || fleetIsVirtualPlate(targetPlate);
    if (fleetTimesClash(bStart, bEnd, reqStartMs, reqEndMs, free)) return true;
  }
  return false;
}

function loadDynamicBookings() {
  // Garante que toda reserva gravada tem uma placa só dela (ou vai para Agent Requests)
  fleetEnsureAllocations();

  // 1. RESERVAS DO PORTAL / ADD BOOKING (gc_multi_bookings_<email>)
  fleetForEachStoredBooking((list, key, email) => {
    list.forEach(bk => {
      if (!bk.plate || FLEET_NON_HOLDING_STATUSES.includes(bk.status)) return;
      const id = String(bk.id);
      if (plannerBookings.find(p => p.id === id)) return;

      const r = fleetBookingRange(bk);
      // Mantém exatamente a referência original ("OR-xxxx") para o SessionID do Chat não quebrar
      const ref = bk.ref || ('OR-' + id.slice(-6));

      plannerBookings.push({
        id: id,
        ref: ref,
        plate: bk.plate,
        fname: bk.fname || "Customer",
        lname: bk.lname || "Guest",
        name: `${ref}: ${bk.lname ? bk.lname.toUpperCase() : 'CUSTOMER'}`,
        // 'donotmove' era um tipo nas versões antigas; hoje é uma marcação separada
        type: bk.plannerType && bk.plannerType !== 'donotmove' ? bk.plannerType : "reservation",
        doNotMove: !!bk.doNotMove || bk.plannerType === 'donotmove',
        loc: bk.loc,
        dropoffLoc: bk.dropoff && bk.dropoff !== 'Same as Pick up' ? bk.dropoff : bk.loc,
        phone: bk.phone,
        licence: bk.licence,
        licenceCountry: bk.licenceCountry,
        driver: bk.driver,
        details: bk.details || {
          source: bk.source, revBooking: bk.revBooking, arrival: bk.flight,
          youngestDriver: bk.driverAge === '21-24' ? '21 - 24' : (bk.driverAge ? '25 - 69' : '')
        },
        pickupStr: formatCustomDate(r.start),
        dropoffStr: formatCustomDate(r.end),
        notesList: bk.notesList || [],
        fees: bk.fees,
        paidSnapshot: bk.paidSnapshot,
        excessOption: bk.excessOption,
        extras: bk.extras,
        paymentStatus: bk.paymentStatus,
        virtualFrom: bk.virtualFrom,
        seriesId: bk.seriesId,
        clientEmail: email,
        storageKey: key
      });
    });
  });

  // 2. RESERVA PRINCIPAL DO PORTAL (GC-8832), sempre no primeiro Pantech
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    const email = key.replace(FLEET_MAIN_PREFIX, '');
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length || state.status === 'cancelled') continue;

    const id = 'main-' + email;
    if (plannerBookings.find(p => p.id === id)) continue;
    const r = fleetMainBookingRange(state);
    plannerBookings.push({
      id: id,
      ref: 'GC-8832', // Fixado para alinhar com o código
      plate: FLEET_MAIN_BOOKING_PLATE,
      fname: 'Felipe',
      lname: 'Grigolli',
      name: 'GC-8832: GRIGOLLI',
      type: fleetMainBookingType(state),
      loc: 'Sydney - Mascot',
      pickupStr: formatCustomDate(r.start),
      dropoffStr: formatCustomDate(r.end),
      notesList: fleetBookingNotes(id).map(n => ({ ...n })),
      paidSnapshot: (fleetGetOverride(id) || {}).paidSnapshot,
      clientEmail: email,
      mainKey: key
    });
  }
}

// Reservas fixas de demonstração não são gravadas: se foram devolvidas (Returned) no
// Planner, o status e as cobranças ficam no ledger de bonds (js/gc-bonds.js)
function applyReturnedFromBondLedger() {
  const ledger = bondReadLedger();
  plannerBookings.forEach(b => {
    const rec = ledger[b.id];
    if (!rec || rec.seed || !rec.fees) return;
    b.type = 'returned';
    b.fees = rec.fees;
  });
}

// ==========================================
// VIRTUAL — área de espera para trocar veículos quando a categoria está toda bookada.
// O booking vai para uma faixa "VIRTUAL-n" e guarda em virtualFrom a placa de onde saiu
// (é ela que define o modelo/categoria enquanto ele está estacionado).
// ==========================================
function plannerHomePlate(b) {
  return fleetIsVirtualPlate(b.plate) ? b.virtualFrom : b.plate;
}

function plannerHomeVehicle(b) {
  return fleetGetVehicle(plannerHomePlate(b));
}

// Faixas visíveis: as que têm booking + sempre uma vazia no fim (mínimo 2)
function plannerVirtualLanes() {
  const used = plannerBookings.filter(b => fleetIsVirtualPlate(b.plate)).map(b => Number(b.plate.slice(FLEET_VIRTUAL_PREFIX.length)) || 0);
  const count = Math.max(2, (used.length ? Math.max(...used) : 0) + 1);
  return Array.from({ length: count }, (_, i) => FLEET_VIRTUAL_PREFIX + (i + 1));
}

// Primeira faixa livre nas datas (começando pela preferida); cria uma nova se precisar
function plannerFreeVirtualLane(startMs, endMs, excludeId, preferred) {
  const lanes = plannerVirtualLanes();
  const order = preferred ? [preferred, ...lanes.filter(l => l !== preferred)] : lanes;
  return order.find(l => !checkConflict(l, startMs, endMs, excludeId)) || FLEET_VIRTUAL_PREFIX + (lanes.length + 1);
}

function plannerAgentName() {
  return localStorage.getItem('gc_agent_name') || 'Felipe Grigolli';
}

// ---------- Activity Log (quem alterou o quê) ----------
function plannerLog(booking, action, details, extra) {
  if (!booking || typeof fleetLog !== 'function') return;
  fleetLog(Object.assign({
    bookingId: booking.id, ref: booking.ref, plate: plannerHomePlate(booking) || booking.plate,
    operator: plannerAgentName(), action, details
  }, extra || {}));
  if (booking.id === activeBookingId) { bdRenderLastUpdate(); renderLogTable(); }
}

function plannerEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Last updated by X · data" no topo da aba Booking Details
function bdRenderLastUpdate() {
  const el = document.getElementById('bd-last-update');
  if (!el) return;
  const b = plannerBookings.find(x => x.id === activeBookingId);
  const last = b ? fleetLogLast(b.id, b.ref) : null;
  el.innerHTML = last ? `🕘 Last updated by <strong>${plannerEsc(last.operator)}</strong> · ${fleetLogDateStr(last.at)}` : '';
}

// Aba Log: tabela no formato do RCM (#, Res #, Operator, Date Updated, Action, Details, Rate, Info, Total)
function renderLogTable() {
  const tbody = document.getElementById('log-table-body');
  if (!tbody) return;
  const b = plannerBookings.find(x => x.id === activeBookingId);
  if (!b) { tbody.innerHTML = ''; return; }
  const list = fleetLogFor(b.id, b.ref);
  const last = list.length ? list[list.length - 1] : null;
  const lastOp = fleetLogLast(b.id, b.ref);
  document.getElementById('log-title').textContent = `Booking Log · ${b.ref}`;
  document.getElementById('log-sub').innerHTML = list.length
    ? `${list.length} entr${list.length === 1 ? 'y' : 'ies'} · oldest first${lastOp ? ` · last change by <strong>${plannerEsc(lastOp.operator)}</strong> on ${fleetLogDateStr(lastOp.at)}` : ''}`
    : 'No changes recorded yet.';
  document.getElementById('log-report-link').href = 'gc-activity-log.html?ref=' + encodeURIComponent(b.ref);
  tbody.innerHTML = list.length ? list.map((e, i) => `
    <tr class="${e === last ? 'latest' : ''}">
      <td>${i + 1}</td>
      <td class="nowrap">${plannerEsc(e.ref)}</td>
      <td class="op${e.operator ? '' : ' sys'}">${plannerEsc(e.operator || 'System')}</td>
      <td class="nowrap">${fleetLogDateStr(e.at)}</td>
      <td>${e.action ? `<span class="log-act ${plannerEsc(e.action.toLowerCase())}">${plannerEsc(e.action)}</span>` : ''}</td>
      <td class="details">${plannerEsc(e.details)}</td>
      <td class="nowrap">${plannerEsc(e.rate)}</td>
      <td class="info">${plannerEsc(e.info)}</td>
      <td class="num">${e.total != null ? '$' + Number(e.total).toFixed(2) : ''}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="log-empty">No changes recorded for this booking yet.</td></tr>';
}

function plannerLogTotal(b) {
  try {
    const veh = plannerHomeVehicle(b);
    const cat = veh ? fleetGetCategory(veh.categoryId) : null;
    const days = fleetLogDays(parseDateTime(b.pickupStr), parseDateTime(b.dropoffStr));
    return Math.round(feeCalc(feBookingFees(b), cat, days).grand * 100) / 100;
  } catch (e) { return null; }
}

function plannerLogTrip(b) {
  const veh = plannerHomeVehicle(b);
  const cat = veh ? fleetGetCategory(veh.categoryId) : null;
  return fleetLogTripText(cat ? cat.name : 'Vehicle', b.plate, fleetLogBranchCode(b.loc) || (veh ? veh.branch : ''),
    parseDateTime(b.pickupStr), fleetLogBranchCode(b.dropoffLoc || b.loc) || (veh ? veh.branch : ''), parseDateTime(b.dropoffStr));
}

// JSON estável que ignora campos vazios (o formulário grava "" onde antes não havia nada)
function plannerLogNorm(v) {
  if (Array.isArray(v)) return '[' + v.map(plannerLogNorm).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== '' && v[k] != null && v[k] !== false)
      .map(k => k + ':' + plannerLogNorm(v[k])).join(',') + '}';
  }
  return String(v == null ? '' : v);
}

function plannerLogSnapshot(b) {
  const d = b.details || {};
  return {
    type: b.type, plate: b.plate, start: parseDateTime(b.pickupStr), end: parseDateTime(b.dropoffStr),
    loc: b.loc || '', dropoffLoc: b.dropoffLoc || b.loc || '', doNotMove: !!b.doNotMove,
    name: `${b.fname || ''} ${b.lname || ''}`.trim(), email: b.clientEmail || '', phone: b.phone || '', licence: b.licence || '',
    driver: plannerLogNorm(b.driver || {}), kmsOut: d.kmsOut || '', kmsIn: d.kmsIn || '', fuelOut: d.fuelOut || '', fuelIn: d.fuelIn || '',
    details: plannerLogNorm(Object.assign({}, d, { kmsOut: '', kmsIn: '', fuelOut: '', fuelIn: '', bookingNotes: d.bookingNotes || '' })),
    total: plannerLogTotal(b)
  };
}

// Compara antes/depois do "Save Booking" e grava uma linha por alteração
function plannerLogChanges(booking, before) {
  const after = plannerLogSnapshot(booking);
  const label = t => fleetLogTitle(BD_TYPE_LABELS[t] || t);
  const days = fleetLogDays(after.start, after.end);
  const veh = plannerHomeVehicle(booking);
  const cat = veh ? fleetGetCategory(veh.categoryId) : null;
  const rate = booking.fees && booking.fees.rate != null ? Number(booking.fees.rate) : (cat ? cat.rate : 0);
  let logged = 0;
  const log = (action, details, extra) => { plannerLog(booking, action, details, extra); logged++; };

  if (after.type !== before.type) {
    if (after.type === 'hired') {
      log('Hired', plannerLogTrip(booking), { rate: `${days}x$${rate.toFixed(2)}`, info: `Hired${after.kmsOut ? ', kms out ' + after.kmsOut : ''}${after.fuelOut ? ', fuel ' + after.fuelOut : ''}`, total: after.total });
    } else if (after.type === 'returned') {
      log('Returned', `${booking.plate} returned to ${fleetLogBranchCode(after.dropoffLoc)}`, { info: [after.kmsIn ? 'kms in ' + after.kmsIn : '', after.fuelIn ? 'fuel ' + after.fuelIn : ''].filter(Boolean).join(', '), total: after.total });
    } else {
      log(label(after.type), `Status changed from ${label(before.type)} to ${label(after.type)}`);
    }
  }
  if (after.start !== before.start || after.end !== before.end) {
    log('Amended', `Dates changed: ${fleetNoteDateStr(before.start)} → ${fleetNoteDateStr(before.end)} to ${fleetNoteDateStr(after.start)} → ${fleetNoteDateStr(after.end)}`,
      { rate: `${days}x$${rate.toFixed(2)}`, total: after.total });
  }
  if (after.plate !== before.plate) log('Vehicle', `Vehicle changed from ${before.plate} to ${after.plate}`);
  if (after.loc !== before.loc || after.dropoffLoc !== before.dropoffLoc) {
    log('Amended', `Locations changed: ${fleetLogBranchCode(before.loc)} → ${fleetLogBranchCode(before.dropoffLoc)} to ${fleetLogBranchCode(after.loc)} → ${fleetLogBranchCode(after.dropoffLoc)}`);
  }
  if (after.doNotMove !== before.doNotMove) log('Amended', after.doNotMove ? 'Marked as Do Not Move' : 'Do Not Move removed');
  // Detalhes do motorista e da reserva: compara com o formulário como estava ao abrir
  // (o formulário grava campos vazios que a reserva original não tinha)
  const base = plannerFormBase || {};
  const driverFields = [['name', 'name'], ['email', 'email'], ['phone', 'phone'], ['licence', 'licence']]
    .filter(([k]) => after[k] !== before[k]).map(([, l]) => l);
  if (base.driver != null && base.driver !== after.driver) driverFields.push('details');
  if (driverFields.length) {
    const nameTxt = after.name !== before.name ? ` (${before.name} → ${after.name})` : '';
    log('Driver', `Driver ${driverFields.join(', ')} updated${nameTxt}`);
  }
  if (after.type === before.type) {
    const kms = [['kmsOut', 'kms out'], ['kmsIn', 'kms in'], ['fuelOut', 'fuel out'], ['fuelIn', 'fuel in']]
      .filter(([k]) => after[k] !== before[k]).map(([k, l]) => `${l} ${after[k] || '—'}`);
    if (kms.length) log('Amended', `Vehicle check updated: ${kms.join(', ')}`);
  }
  // Total mudou sem mudar datas nem status = taxas alteradas
  if (after.total != null && before.total != null && Math.abs(after.total - before.total) > 0.005 &&
      after.type === before.type && after.start === before.start && after.end === before.end) {
    log('Fees', 'Booking fees updated', { info: `Was $${before.total.toFixed(2)}`, total: after.total });
  }
  if (base.details != null && after.details !== base.details) log('Amended', 'Booking details updated (source, travel or agency info)');
  return logged;
}

let plannerFormBase = null;
function plannerFormSnapshot() {
  const drv = dvReadForm();
  const d = bdReadDetailsForm();
  return {
    driver: drv.error ? null : plannerLogNorm(drv.driver),
    details: plannerLogNorm(Object.assign({}, d, { kmsOut: '', kmsIn: '', fuelOut: '', fuelIn: '', bookingNotes: d.bookingNotes || '' }))
  };
}

function plannerAddSystemNote(booking, subject, text) {
  if (!booking.notesList) booking.notesList = [];
  booking.notesList.push({ id: Date.now(), priority: 'Medium', status: 'Active', subject, text, dateStr: getCurrentNoteDateStr(), author: plannerAgentName() });
}

// Estaciona no Virtual (lane = faixa onde soltou, ou a primeira livre)
function plannerParkVirtual(booking, lane) {
  const from = plannerHomePlate(booking);
  const target = plannerFreeVirtualLane(parseDateTime(booking.pickupStr), parseDateTime(booking.dropoffStr), booking.id, lane);
  if (!fleetIsVirtualPlate(booking.plate)) {
    booking.virtualFrom = booking.plate;
    plannerAddSystemNote(booking, 'Virtual', `Moved from ${from} to the Virtual holding area.`);
  }
  booking.plate = target;
}

// Sai do Virtual para um carro de verdade
function plannerUnparkVirtual(booking, plate) {
  const from = booking.virtualFrom;
  booking.plate = plate;
  delete booking.virtualFrom;
  plannerAddSystemNote(booking, 'Vehicle swap', from === plate
    ? `Moved back from Virtual to ${plate}.`
    : `Vehicle swap: ${from} → ${plate} (via Virtual).`);
}

// Registro no formato do extrato de bonds (Payments tab / Bond Refunds)
function plannerBondRecord(b) {
  const veh = plannerHomeVehicle(b);
  const ledger = bondReadLedger()[b.id];
  const rec = {
    id: b.id, ref: b.ref, fname: b.fname, lname: b.lname, email: b.clientEmail || '',
    company: (b.driver && b.driver.company) || '', plate: b.plate, categoryId: veh ? veh.categoryId : null,
    loc: b.loc, dropoffLoc: b.dropoffLoc || b.loc,
    pickupMs: parseDateTime(b.pickupStr), dropoffMs: parseDateTime(b.dropoffStr),
    fees: feBookingFees(b), card: 'visa',
    returnInfo: (b.details || {}).returnInfo || null, // dias previstos × usados (explica o refund no Bond Refunds)
    beforePickup: b.type === 'reservation' // nada é cobrado antes do pick-up
  };
  if (ledger && ledger.payments) {
    rec.payments = ledger.payments;
  } else {
    // Pagamento feito na reserva: congelado na primeira vez que o booking é aberto.
    // Assim, mudar o excess, extras ou taxas depois gera saldo a cobrar (em vez de "já pago").
    // Nada é cobrado antes do pick-up: o agente cobra na loja. Reserva ainda não retirada = nada pago.
    // Retirada/devolvida sem registro (histórico de exemplo) = paga no pick-up, congelada na primeira abertura.
    if (!b.paidSnapshot && b.type === 'reservation') {
      rec.payments = [];
    } else {
      if (!b.paidSnapshot) { b.paidSnapshot = ['not_charged', 'pay_at_pickup'].includes(b.paymentStatus) ? [] : bondDefaultPayments(rec); plannerSavePaidSnapshot(b); }
      rec.payments = b.paidSnapshot;
    }
  }
  if (typeof pbLedgerPayments === 'function') rec.payments = rec.payments.concat(pbLedgerPayments(b.id));
  // Parcelas pagas do Payment Plan do dano abatem o saldo
  if (typeof feePlanPayments === 'function') rec.payments = rec.payments.concat(feePlanPayments(b.ref, rec.fees));
  return rec;
}

function plannerSavePaidSnapshot(b) {
  if (b.type === 'possible-ext') return;
  if (b.storageKey) updateStoredBooking(b, s => { s.paidSnapshot = b.paidSnapshot; });
  else fleetSetOverride(b.id, { paidSnapshot: b.paidSnapshot });
}

function renderModalLedger(b) {
  document.getElementById('mod-ledger').innerHTML = bondLedgerHtml(plannerBondRecord(b));
  plannerRenderPaymentPanels(b);
}

// Aba Payments: cartões e cobranças (PowerBoard) + pedágios da reserva
function plannerRenderPaymentPanels(b) {
  if (typeof pbRenderPanel === 'function') pbRenderPanel('mod-pb-panel', b.id, () => plannerBondRecord(b));
  if (typeof tollRenderBookingPanel === 'function') tollRenderBookingPanel('mod-toll-panel', b.id);
  const card = typeof pbSelectedCard === 'function' ? pbSelectedCard(b.id) : null;
  if (card) {
    document.getElementById('ext-card-holder').value = card.holder;
    document.getElementById('ext-card-number').value = `${pbBrandLabel(card.brand)} •••• ${card.last4}  ·  exp ${card.expMonth}/${card.expYear}`;
  }
}

// Depois de uma cobrança na aba Payments: atualiza o extrato (saldo) sem redesenhar os painéis à toa
function plannerAfterPayment(bookingId) {
  const b = plannerBookings.find(x => x.id === bookingId);
  if (!b || bookingId !== activeBookingId) return;
  document.getElementById('mod-ledger').innerHTML = bondLedgerHtml(plannerBondRecord(b));
  const card = pbSelectedCard(b.id);
  if (card) {
    document.getElementById('ext-card-holder').value = card.holder;
    document.getElementById('ext-card-number').value = `${pbBrandLabel(card.brand)} •••• ${card.last4}  ·  exp ${card.expMonth}/${card.expYear}`;
  }
  bdRenderLastUpdate();
  renderLogTable();
}

// Aplica uma alteração na reserva gravada no localStorage (só reservas dinâmicas;
// as fixas de demonstração voltam ao estado original no F5)
function updateStoredBooking(booking, mutate) {
  if (!booking.storageKey) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(booking.storageKey) || '[]'); } catch (e) { return; }
  const stored = list.find(x => String(x.id) === booking.id);
  if (!stored) return;
  mutate(stored);
  localStorage.setItem(booking.storageKey, JSON.stringify(list));
}

// E-mail mudou: a reserva vai para 'gc_multi_bookings_<novo e-mail>' para o
// Customer Portal do novo e-mail enxergá-la (a chave é por e-mail)
function moveStoredBookingEmail(booking, newEmail) {
  if (!newEmail || newEmail === booking.clientEmail) return;
  if (booking.storageKey) {
    let oldList = [];
    try { oldList = JSON.parse(localStorage.getItem(booking.storageKey) || '[]'); } catch (e) { return; }
    const idx = oldList.findIndex(x => String(x.id) === booking.id);
    if (idx === -1) return;
    const [record] = oldList.splice(idx, 1);
    localStorage.setItem(booking.storageKey, JSON.stringify(oldList));

    const newKey = FLEET_MULTI_PREFIX + newEmail;
    const newList = JSON.parse(localStorage.getItem(newKey) || '[]');
    newList.unshift(record);
    localStorage.setItem(newKey, JSON.stringify(newList));
    booking.storageKey = newKey;
  }
  booking.clientEmail = newEmail;
}

function persistDynamicBooking(booking) {
  // Possible Extension arrastada para outro carro: grava a lista de extensões
  if (booking.type === 'possible-ext') { plannerSaveExtensions(); return; }
  // Reservas de demonstração e GC-8832: grava as alterações por id (gc-fleet-data.js)
  if (!booking.storageKey) {
    if (booking.mainKey) {
      fleetSetOverride(booking.id, { notesList: booking.notesList || [] });
      try {
        const state = JSON.parse(localStorage.getItem(booking.mainKey) || '{}');
        const next = booking.type === 'hired' ? 'hired' : (state.status === 'hired' ? 'confirmed' : state.status);
        if (next && next !== state.status) { state.status = next; localStorage.setItem(booking.mainKey, JSON.stringify(state)); }
      } catch (e) {}
      return;
    }
    const realPlate = fleetIsVirtualPlate(booking.plate) ? booking.virtualFrom : booking.plate;
    fleetSetOverride(booking.id, {
      plate: realPlate, type: booking.type, doNotMove: !!booking.doNotMove,
      fname: booking.fname, lname: booking.lname, notesList: booking.notesList || [],
      startMs: parseDateTime(booking.pickupStr), endMs: parseDateTime(booking.dropoffStr),
      // Taxas (excess, extras), motorista, detalhes e locais também ficam gravados
      fees: booking.fees, details: booking.details, phone: booking.phone, licence: booking.licence,
      driver: booking.driver, loc: booking.loc, dropoffLoc: booking.dropoffLoc, clientEmail: booking.clientEmail
    });
    return;
  }
  updateStoredBooking(booking, stored => {
    stored.fname = booking.fname;
    stored.lname = booking.lname;
    if (booking.phone !== undefined) stored.phone = booking.phone;
    if (booking.licence !== undefined) stored.licence = booking.licence;
    if (booking.driver) stored.driver = booking.driver;
    stored.plate = booking.plate;
    if (fleetIsVirtualPlate(booking.plate)) stored.virtualFrom = booking.virtualFrom;
    else delete stored.virtualFrom;
    const v = fleetGetVehicle(booking.plate);
    if (v) stored.vehicle = v.model; // arrastar para outra categoria = upgrade/downgrade do modelo
    stored.plannerType = booking.type;
    stored.doNotMove = !!booking.doNotMove;
    stored.notesList = booking.notesList;
    if (booking.fees) stored.fees = booking.fees;
    if (booking.loc) stored.loc = booking.loc;
    if (booking.dropoffLoc) stored.dropoff = booking.dropoffLoc === booking.loc ? 'Same as Pick up' : booking.dropoffLoc;
    if (booking.details) {
      stored.details = booking.details;
      if (booking.details.source) stored.source = booking.details.source;
      if (booking.details.revBooking) stored.revBooking = booking.details.revBooking;
      if (booking.details.arrival) stored.flight = booking.details.arrival;
    }
    fleetApplyRange(stored, parseDateTime(booking.pickupStr), parseDateTime(booking.dropoffStr));
  });
}

// ==========================================
// CATEGORIAS RECOLHÍVEIS
// ==========================================
function categoryHasBookings(catId) {
  return plannerBookings.some(b => {
    const v = fleetGetVehicle(b.plate);
    return v && v.categoryId === catId;
  });
}

function getCollapsedState() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || 'null'); } catch (e) {}
  if (state) return state;
  // Padrão: abre só as categorias que têm reservas
  state = {};
  FLEET_CATEGORIES.forEach(c => { state[c.id] = !categoryHasBookings(c.id); });
  return state;
}

function toggleCategory(catId) {
  const state = getCollapsedState();
  state[catId] = !state[catId];
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  renderPlanner();
}

function setAllCategories(collapsed) {
  const state = {};
  FLEET_CATEGORIES.forEach(c => { state[c.id] = collapsed; });
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  renderPlanner();
}

// ==========================================
// FILTROS (Branch / Período / Seção / Categoria / Busca)
// ==========================================
function toDateInputValue(ms) {
  return toDatetimeLocalString(new Date(ms)).slice(0, 10);
}

function loadPlannerFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null');
    if (saved) plannerFilters = { ...plannerFilters, ...saved };
  } catch (e) {}
}

function savePlannerFilters() {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(plannerFilters));
}

function initFilterBar() {
  const branchSel = document.getElementById('flt-branch');
  if (!branchSel) return;
  branchSel.innerHTML = `<option value="ALL">All Branches</option>` +
    Object.entries(FLEET_BRANCHES).map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');

  branchSel.value = plannerFilters.branch;
  document.getElementById('flt-section').value = plannerFilters.section;
  populateCategoryFilter();
  document.getElementById('flt-category').value = plannerFilters.category;
  if (!document.getElementById('flt-category').value) document.getElementById('flt-category').value = 'ALL';
  document.getElementById('flt-search').value = plannerFilters.search;
  syncDateInputs();
}

// Lista de categorias respeita a seção escolhida (Passenger / Commercial)
function populateCategoryFilter() {
  const section = document.getElementById('flt-section').value;
  const catSel = document.getElementById('flt-category');
  const previous = catSel.value;
  catSel.innerHTML = `<option value="ALL">All Categories</option>` +
    FLEET_CATEGORIES.filter(c => section === 'ALL' || c.section === section)
      .map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  catSel.value = Array.from(catSel.options).some(o => o.value === previous) ? previous : 'ALL';
}

function syncDateInputs() {
  const fromInput = document.getElementById('flt-from');
  const toInput = document.getElementById('flt-to');
  if (fromInput) fromInput.value = toDateInputValue(viewStartMs);
  if (toInput) toInput.value = toDateInputValue(addDays(viewStartMs, viewDays - 1));
}

function applyPlannerFilters() {
  plannerFilters.branch = document.getElementById('flt-branch').value;
  plannerFilters.section = document.getElementById('flt-section').value;
  plannerFilters.category = document.getElementById('flt-category').value;
  plannerFilters.search = document.getElementById('flt-search').value.trim();
  savePlannerFilters();

  const fromVal = document.getElementById('flt-from').value;
  const toVal = document.getElementById('flt-to').value;
  if (fromVal && toVal) {
    const fromMs = new Date(fromVal + 'T00:00').getTime();
    const toMs = new Date(toVal + 'T00:00').getTime();
    const days = Math.round((toMs - fromMs) / MS_IN_DAY) + 1;
    if (days < 1) {
      gcToast('"To" date must be on or after the "From" date.', 'warning');
      syncDateInputs();
    } else {
      viewStartMs = fromMs;
      viewDays = Math.min(days, MAX_VIEW_DAYS);
    }
  }
  renderPlanner();
}

function resetPlannerFilters() {
  plannerFilters = { branch: 'ALL', section: 'ALL', category: 'ALL', search: '' };
  savePlannerFilters();
  viewStartMs = addDays(startOfDay(Date.now()), -2);
  viewDays = DEFAULT_VIEW_DAYS;
  initFilterBar();
  renderPlanner();
}

function vehicleMatchesFilters(veh) {
  if (plannerFilters.branch !== 'ALL' && veh.branch !== plannerFilters.branch) return false;
  const term = plannerFilters.search.toLowerCase();
  if (term && !(veh.plate.toLowerCase().includes(term) || veh.label.toLowerCase().includes(term) || veh.model.toLowerCase().includes(term))) return false;
  return true;
}

function categoryMatchesFilters(cat) {
  if (plannerFilters.section !== 'ALL' && cat.section !== plannerFilters.section) return false;
  if (plannerFilters.category !== 'ALL' && cat.id !== plannerFilters.category) return false;
  return true;
}

// ==========================================
// NAVEGAÇÃO DE DATAS
// ==========================================
function shiftPlannerWeek(direction) {
  viewStartMs = addDays(viewStartMs, direction * 7);
  syncDateInputs();
  renderPlanner();
}

function goToToday() {
  viewStartMs = addDays(startOfDay(Date.now()), -2);
  syncDateInputs();
  renderPlanner();
}

// Posição do bloco (em %) dentro da janela visível; null se estiver fora dela
function bookingSegment(bk) {
  const viewEndMs = addDays(viewStartMs, viewDays);
  const s = parseDateTime(bk.pickupStr);
  const e = parseDateTime(bk.dropoffStr);
  if (e <= viewStartMs || s >= viewEndMs) return null;
  const total = viewEndMs - viewStartMs;
  const vs = Math.max(s, viewStartMs);
  const ve = Math.min(e, viewEndMs);
  return {
    left: ((vs - viewStartMs) / total) * 100,
    // Largura real do período (mínimo só para continuar clicável): barra curta não cobre o booking vizinho
    width: Math.max(((ve - vs) / total) * 100, 0.12),
    clippedLeft: s < viewStartMs,
    clippedRight: e > viewEndMs
  };
}

// ==========================================
// GANTT RENDER
// ==========================================
function initFleetPlanner() {
  bdInitForm();
  dvInitForm();
  feInitForm();
  loadPlannerFilters();
  loadDynamicBookings();
  plannerLoadExtensions();
  applyReturnedFromBondLedger();
  initFilterBar();
  renderPlanner();
  openBookingFromUrl();
}

// Vindo do Daily Activity: gc-fleet-planner.html?open=<id da reserva> abre o modal dela.
// Com &popup=1 (janela separada) só o modal aparece, e fechar o modal fecha a janela.
let plannerPopup = false;

function openBookingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('open');
  if (!id) return;
  plannerPopup = params.get('popup') === '1';
  if (plannerPopup) document.body.classList.add('planner-popup');
  const booking = plannerBookings.find(b => b.id === id) || (plannerPopup ? plannerArchivedBooking(id) : null);
  if (!booking) { gcToast('Booking not found in the planner.', 'warning'); return; }
  if (plannerPopup) document.title = `Booking ${booking.ref} :: GC Tech Rentals`;
  viewStartMs = addDays(startOfDay(parseDateTime(booking.pickupStr)), -2);
  syncDateInputs();
  renderPlanner();
  openModal({ stopPropagation() {} }, id);
  // Vindo do Damage Control: abre o Booking Fees com a cobrança do dano já marcada
  if (params.get('fee')) plannerApplyDamagePrefill(booking, params.get('fee'), Number(params.get('amount')) || 0, params.get('damage'));
  if (!plannerPopup && window.history && history.replaceState) history.replaceState(null, '', window.location.pathname);
  if (booking.archived) bdMessage(`${booking.ref} is a closed booking from before the planner history, shown read-only. Bond refunds and holds are done in Bond Refunds.`, true);
}

// Booking devolvido antigo que só existe na fila do Bond Refunds (js/gc-bonds.js, BOND_SEED_RETURNED):
// abre no mesmo popup, só leitura (não há onde gravar alterações no planner)
function plannerArchivedBooking(id) {
  const rec = typeof bondGetRecord === 'function' ? bondGetRecord(id) : null;
  if (!rec || !rec.seed) return null;
  const base = BOND_SEED_RETURNED.find(s => s.id === id);
  const booking = {
    id: rec.id, ref: rec.ref, plate: rec.plate, fname: rec.fname, lname: rec.lname, clientEmail: rec.email,
    name: `${rec.ref}: ${String(rec.lname || '').toUpperCase()}`, type: 'returned',
    loc: rec.loc, dropoffLoc: rec.dropoffLoc || rec.loc,
    pickupStr: formatCustomDate(rec.pickupMs), dropoffStr: formatCustomDate(rec.dropoffMs),
    notesList: [], fees: rec.fees, driver: rec.company ? { company: rec.company } : undefined,
    // Pagamentos do exemplo (refund feito depois no Bond Refunds vem do ledger — plannerBondRecord)
    paidSnapshot: base ? base.payments : rec.payments.filter(p => !p.extra),
    archived: true
  };
  plannerBookings.push(booking);
  return booking;
}

// ==========================================
// COBRANÇA DE DANO (Damage Control → Booking Fees)
// O item vem marcado e com o valor; o agente confere e clica Save Booking.
// Ao salvar, o relatório de dano registra que a cobrança foi lançada.
// ==========================================
let plannerDamagePrefill = null;

function plannerApplyDamagePrefill(booking, feeId, amount, reportId) {
  const tr = document.querySelector(`#fe-items tr[data-fee="${feeId}"]`);
  const item = feeGetItem(feeId);
  if (!tr || !item) return;
  const sel = tr.querySelector('.fe-sel'), amt = tr.querySelector('.fe-amt');
  const already = sel.checked;
  sel.checked = true;
  if (amount > 0) amt.value = ((already ? Number(amt.value) || 0 : 0) + amount).toFixed(2);
  feRecalc();
  switchModalTab('mod-fees', document.getElementById('tab-btn-fees'));
  tr.classList.add('fe-prefill');
  setTimeout(() => tr.scrollIntoView({ block: 'center' }), 50);
  plannerDamagePrefill = { bookingId: booking.id, feeId, amount, reportId };
  gcToast(`Damage charge from Damage Control\n\n${item.name}: ${feeMoney(amount)}${already ? ' added to the amount already on the booking' : ''}. Review it and click Save Booking.`, 'info', { duration: 7000 });
}

function plannerDamageAfterSave(booking) {
  const p = plannerDamagePrefill;
  if (!p || p.bookingId !== booking.id) return;
  plannerDamagePrefill = null;
  const item = ((booking.fees && booking.fees.items) || []).find(i => i.id === p.feeId);
  if (!item) return; // agente desmarcou: nada lançado
  const feeName = (feeGetItem(p.feeId) || {}).name || p.feeId;
  const agent = plannerAgentName();
  try {
    const reports = JSON.parse(localStorage.getItem('gc_damage_reports') || '[]');
    const r = reports.find(x => x.id === p.reportId);
    if (r) {
      // Valor da linha como ficou salvo (o agente pode ter ajustado antes de salvar)
      const saved = Math.round(Number(item.amount) * (Number(item.qty) || 1) * 100) / 100;
      r.chargedToBooking = { bookingId: booking.id, ref: booking.ref, feeId: p.feeId, feeName, amount: saved, by: agent, at: Date.now() };
      r.lastModifiedBy = agent;
      r.lastModifiedAt = new Date().toLocaleString('en-GB');
      localStorage.setItem('gc_damage_reports', JSON.stringify(reports));
    }
  } catch (e) {}
  plannerLog(booking, 'Fees', `Damage charge added from Damage Control: ${feeName} ${feeMoney(Math.round(Number(item.amount) * (Number(item.qty) || 1) * 100) / 100)}`);
}

// O caminho inverso: mudou a cobrança do dano no Booking Fees → o relatório de dano acompanha.
// Valor alterado, item desmarcado, ou item lançado direto aqui (do tipo indicado no relatório).
const PLANNER_DAMAGE_FEES = ['damage-ext', 'damage-int', 'damage-admin', 'windscreen', 'tyre', 'towing', 'cleaning', 'smoking'];

function plannerDamageSync(booking) {
  let reports;
  try { reports = JSON.parse(localStorage.getItem('gc_damage_reports') || '[]'); } catch (e) { return; }
  const ref = String(booking.ref || '').toUpperCase();
  const linked = reports.filter(r => (r.bookingId && String(r.bookingId) === String(booking.id)) || (!r.bookingId && ref && String(r.bookingRef || '').toUpperCase() === ref));
  if (!linked.length) return;
  const items = (booking.fees && booking.fees.items) || [];
  const lineTotal = i => Math.round(Number(i.amount) * (Number(i.qty) || 1) * 100) / 100;
  const agent = plannerAgentName(), now = Date.now();
  const stamp = new Date(now).toLocaleString('en-GB');
  let changed = 0;
  linked.forEach(r => {
    const c = r.chargedToBooking;
    if (c && !c.removed) {
      const item = items.find(i => i.id === c.feeId);
      if (!item) {
        r.chargedToBooking = { ...c, removed: true, removedBy: agent, removedAt: now };
        plannerLog(booking, 'Fees', `Damage charge removed: ${c.feeName} ${feeMoney(c.amount)} (damage report ${r.plate})`);
      } else if (Math.abs(lineTotal(item) - Number(c.amount)) > 0.004) {
        r.chargedToBooking = { ...c, prevAmount: c.amount, amount: lineTotal(item), updatedBy: agent, updatedAt: now };
        plannerLog(booking, 'Fees', `Damage charge changed: ${c.feeName} ${feeMoney(c.amount)} → ${feeMoney(lineTotal(item))} (damage report ${r.plate})`);
      } else return;
    } else {
      // Sem cobrança registrada (ou removida antes): item de dano lançado aqui, do tipo do relatório
      const feeId = (c && c.removed) ? c.feeId : (r.recoverFee || 'damage-ext');
      const item = items.find(i => i.id === feeId && PLANNER_DAMAGE_FEES.includes(i.id));
      if (!item) return;
      const feeName = (feeGetItem(feeId) || {}).name || feeId;
      r.chargedToBooking = { bookingId: booking.id, ref: booking.ref, feeId, feeName, amount: lineTotal(item), by: agent, at: now, fromBooking: true };
      plannerLog(booking, 'Fees', `Damage charge recorded on damage report ${r.plate}: ${feeName} ${feeMoney(lineTotal(item))}`);
    }
    r.lastModifiedBy = agent;
    r.lastModifiedAt = stamp;
    changed++;
  });
  if (changed) {
    localStorage.setItem('gc_damage_reports', JSON.stringify(reports));
    gcToast(`Damage report updated\n\nThe damage charge on ${booking.ref} changed, and Damage Control now shows the same.`, 'info', { duration: 5000 });
  }
}

function renderPlanner() {
  const daysRow = document.getElementById('planner-days');
  const body = document.getElementById('planner-body');
  if (!daysRow || !body) return;

  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const todayMs = startOfDay(Date.now());
  const dayStarts = [];
  for (let i = 0; i <= viewDays; i++) dayStarts.push(addDays(viewStartMs, i));
  const visibleDays = dayStarts.slice(0, viewDays);

  // Colunas estreitas quando o período é longo (estilo RCM, ~31 dias na tela)
  const dayWidth = viewDays <= 7 ? 120 : (viewDays <= 14 ? 80 : 52);
  document.documentElement.style.setProperty('--day-width', dayWidth + 'px');

  const dayClass = ms => {
    const dow = new Date(ms).getDay();
    return (ms === todayMs ? ' today' : '') + (dow === 0 || dow === 6 ? ' weekend' : '');
  };

  daysRow.innerHTML = visibleDays.map(ms => {
    const d = new Date(ms);
    const dd = String(d.getDate()).padStart(2, '0');
    return `<div class="day-header${dayClass(ms)}"><span>${months[d.getMonth()]}</span><span>${daysOfWeek[d.getDay()]}-${dd}</span></div>`;
  }).join('');

  const rangeLabel = document.getElementById('planner-range-label');
  if (rangeLabel) rangeLabel.textContent = `${fleetFormatDate(dayStarts[0])} – ${fleetFormatDate(dayStarts[viewDays - 1])} (${viewDays} days)`;

  const collapsed = getCollapsedState();
  const singleCategory = plannerFilters.category !== 'ALL';
  let html = '';
  let currentSection = null;
  let shownVehicles = 0;

  FLEET_CATEGORIES.forEach(cat => {
    if (!categoryMatchesFilters(cat)) return;
    const vehicles = FLEET_VEHICLES.filter(v => v.categoryId === cat.id && vehicleMatchesFilters(v));
    if (vehicles.length === 0) return;
    shownVehicles += vehicles.length;

    if (cat.section !== currentSection) {
      currentSection = cat.section;
      html += `<div class="planner-section">${cat.section.toUpperCase()} FLEET</div>`;
    }

    // Categoria escolhida no filtro ou busca ativa: sempre aberta
    const isCollapsed = !singleCategory && !plannerFilters.search && !!collapsed[cat.id];

    // Cabeçalho da categoria: quantos veículos estão livres o dia INTEIRO
    const freeCells = visibleDays.map((dayStart, i) => {
      const dayEnd = dayStarts[i + 1];
      const free = vehicles.filter(v => !checkConflict(v.plate, dayStart, dayEnd)).length;
      const cls = free === 0 ? 'none' : (free <= Math.ceil(vehicles.length * 0.2) ? 'low' : '');
      return `<div class="category-day ${cls}${dayClass(dayStart)}" title="${free} of ${vehicles.length} free on ${fleetFormatDate(dayStart)}">${free}</div>`;
    }).join('');

    html += `
      <div class="planner-category-row" onclick="toggleCategory('${cat.id}')">
        <div class="category-label">
          <span class="cat-chevron">${isCollapsed ? '▸' : '▾'}</span>
          <span class="cat-name">${cat.name}</span>
          <span class="cat-count">${vehicles.length}</span>
        </div>
        <div class="category-days">${freeCells}</div>
      </div>
    `;
    if (isCollapsed) return;

    vehicles.forEach(veh => {
      html += `
        <div class="planner-row" data-plate="${veh.plate}">
          <div class="plate-col" title="${veh.model} — ${FLEET_BRANCHES[veh.branch]}">
            <span class="vehicle-desc">${veh.label}</span>
            <span class="plate-text">${veh.plate}, ${veh.branch}</span>
          </div>
          <div class="timeline-grid dropzone" ondragover="allowDrop(event)" ondrop="drop(event, this)">
      `;

      visibleDays.forEach(dayStart => {
        html += `<div class="day-cell${dayClass(dayStart)}" onclick="openQuickAction(event, '${veh.plate}', '${veh.label}', '${formatCustomDate(dayStart)}')"></div>`;
      });

      html += plannerBlocksHtml(veh.plate);
      html += `</div></div>`;
    });
  });

  if (shownVehicles === 0) {
    html = `<div class="planner-empty">No vehicles match the selected filters.</div>`;
  }
  body.innerHTML = plannerVirtualHtml(visibleDays, dayClass) + html;
  plannerRenderStale();
}

// ==========================================
// REPEAT WEEKLY (js/gc-repeat.js): replica a reserva aberta toda semana por X meses
// ==========================================
async function plannerRepeatWeekly() {
  const b = plannerBookings.find(x => x.id === activeBookingId);
  if (!b) return;
  if (!['reservation', 'hired', 'returned'].includes(b.type)) {
    gcToast('Only rental bookings can be repeated.', 'warning');
    return;
  }
  if (!b.clientEmail) {
    gcToast("Add the customer's email in Drivers Details and save first.", 'warning');
    return;
  }
  const v = plannerHomeVehicle(b);
  const cat = v ? fleetGetCategory(v.categoryId) : null;
  const branch = repeatBranchCode(b.loc) || (v ? v.branch : '');
  const src = {
    start: parseDateTime(b.pickupStr), end: parseDateTime(b.dropoffStr),
    model: cat ? cat.model : '', cat, branch, loc: FLEET_BRANCHES[branch],
    dropoff: b.dropoffLoc && b.dropoffLoc !== b.loc ? b.dropoffLoc : 'Same as Pick up',
    email: b.clientEmail, fname: b.fname, lname: b.lname, phone: b.phone || '',
    source: 'Repeat Customer', originRef: b.ref, agent: plannerAgentName()
  };
  const problem = repeatValidate(src);
  if (problem) { gcToast(problem, 'warning'); return; }

  const result = await repeatDialog(src, { subtitle: `${b.ref} · ${b.fname} ${b.lname} — uses the saved booking details` });
  if (!result) return;

  src.seriesId = b.seriesId || repeatNewSeriesId();
  const res = repeatCreate(src, result.plan);
  // A reserva original passa a fazer parte da série
  if (b.storageKey) updateStoredBooking(b, stored => { stored.seriesId = src.seriesId; });
  else if (!b.mainKey) fleetSetOverride(b.id, { seriesId: src.seriesId });

  gcFlash(repeatResultText(b.ref, res), res.pending ? 'warning' : 'success');
  plannerNotifyOpener();
  window.location.reload();
}

// Conceito "Anna inside the RCM": resumo da reserva aberta (js/gc-anna.js)
function plannerAnnaSummary() {
  const b = plannerBookings.find(x => x.id === activeBookingId);
  if (b && typeof annaSummariseBooking === 'function') annaSummariseBooking(b.ref);
}

// Reserva vencida: ainda "Reservation" com retirada antes de hoje
function plannerIsStale(b) {
  return b.type === 'reservation' && parseDateTime(b.pickupStr) < fleetStartOfToday();
}

// Aviso no topo do Planner com as reservas vencidas (abrir para mudar a data, ou cancelar)
function plannerRenderStale() {
  const box = document.getElementById('planner-stale');
  if (!box) return;
  const stale = plannerBookings.filter(plannerIsStale).sort((a, b) => parseDateTime(a.pickupStr) - parseDateTime(b.pickupStr));
  box.hidden = !stale.length;
  if (!stale.length) { box.innerHTML = ''; return; }
  const today0 = fleetStartOfToday();
  box.innerHTML = `
    <div class="stale-head">
      <strong>⚠ ${stale.length} reservation${stale.length > 1 ? 's' : ''} past the pick-up date</strong>
      <span>The customer has not collected the vehicle. Move the booking to a new date or cancel it.</span>
    </div>
    ${stale.map(b => {
      const v = plannerHomeVehicle(b);
      const start = parseDateTime(b.pickupStr);
      const late = Math.max(1, Math.ceil((today0 - startOfDay(start)) / MS_IN_DAY));
      return `
        <div class="stale-row">
          <span class="stale-ref">${b.ref}</span>
          <span>${b.fname} ${b.lname}</span>
          <span class="stale-muted">${v ? v.label + ' · ' + v.plate : b.plate}</span>
          <span class="stale-late">Was due ${b.pickupStr} · ${late} day${late > 1 ? 's' : ''} ago</span>
          <span class="stale-actions">
            ${typeof annaDraftNoShow === 'function' ? `<button type="button" class="anna-link-btn" onclick="annaDraftNoShow('${b.id}')" title="Concept: Anna drafts the message">✦ Draft message</button>` : ''}
            ${typeof waComposeForBooking === 'function' ? `<button type="button" class="wa-inline-btn" onclick="waComposeForBooking('${b.id}', 'no_show', 'Missed pick-up · WhatsApp')">${waIcon(13)} WhatsApp</button>` : ''}
            <button type="button" class="btn btn-submit" onclick="plannerOpenStale('${b.id}')">Move date</button>
            <button type="button" class="btn stale-cancel" onclick="plannerCancelStale('${b.id}')">Cancel booking</button>
          </span>
        </div>`;
    }).join('')}`;
}

function plannerOpenStale(id) {
  const b = plannerBookings.find(x => x.id === id);
  if (!b) return;
  viewStartMs = addDays(startOfDay(parseDateTime(b.pickupStr)), -2);
  syncDateInputs();
  renderPlanner();
  openModal({ stopPropagation() {} }, id);
}

async function plannerCancelStale(id) {
  const b = plannerBookings.find(x => x.id === id);
  if (!b) return;
  const ok = await gcConfirm({ title: `Cancel booking ${b.ref}?`, message: `${b.fname} ${b.lname} did not collect the vehicle. The booking will be cancelled and ${b.plate} becomes available.`, confirmText: 'Cancel booking', cancelText: 'Keep it', danger: true });
  if (!ok) return;
  fleetCancelBooking(id);
  gcFlash(`Booking ${b.ref} cancelled.`);
  window.location.reload();
}

// Texto da barra no formato do RCM: "495309: HADDAD, PAR-PAR" · "POSSIBLE EXTENSION, MAS-MAS" · "499001: BLK - TYRES HOLD"
function plannerBarLabel(bk) {
  const home = fleetGetVehicle(plannerHomePlate(bk));
  const code = loc => (loc && fleetLogBranchCode(loc)) || (home ? home.branch : '');
  const trip = `${code(bk.loc)}-${code(bk.dropoffLoc || bk.loc)}`;
  if (bk.type === 'possible-ext') return `${bk.kind === 'weekend' ? 'WEEKEND HOLD' : 'POSSIBLE EXTENSION'}, ${trip}`;
  if (bk.type === 'maintenance') return `${bk.ref}: ${code(bk.loc)} - ${(bk.name || 'MAINTENANCE').replace(/^[^:]*:\s*/, '')}`;
  return `${bk.ref}: ${String(bk.lname || bk.name || '').toUpperCase()}, ${trip}`;
}

// Blocos de reserva de uma faixa (placa real ou VIRTUAL-n) + linha vermelha do horário atual
function plannerBlocksHtml(plate) {
  const blocks = plannerBookings.filter(b => b.plate === plate).map(bk => {
    const seg = bookingSegment(bk);
    if (!seg) return '';
    const maintDone = bk.type === 'maintenance' && bk.details && bk.details.maintDone;
    const label = (maintDone ? '✓ ' : '') + (bk.seriesId ? '↻ ' : '') + plannerBarLabel(bk) + (fleetIsVirtualPlate(bk.plate) ? ` · from ${bk.virtualFrom}` : '');
    return `
      <div class="booking-block ${bk.type} ${maintDone ? 'maint-done' : ''} ${bk.doNotMove ? 'locked' : ''} ${seg.clippedLeft ? 'clip-left' : ''} ${seg.clippedRight ? 'clip-right' : ''} ${fleetIsVirtualPlate(bk.plate) ? 'in-virtual' : ''} ${plannerIsStale(bk) ? 'stale' : ''} ${bk.kind === 'weekend' ? 'weekend-hold' : ''}"
           style="left: ${seg.left}%; width: calc(${seg.width}% - 2px);"
           draggable="true" ondragstart="drag(event)" onclick="openModal(event, '${bk.id}')"
           onmouseenter="showTooltip(event, '${bk.id}')" onmouseleave="hideTooltip()" onmousemove="moveTooltip(event)"
           id="${bk.id}">
        <span class="bb-label">${label}</span><span class="bb-info" aria-hidden="true">i</span>
      </div>`;
  }).join('');
  return blocks + plannerNowLineHtml();
}

// Linha vermelha no horário atual (como no RCM), contínua de linha em linha
function plannerNowLineHtml() {
  const now = Date.now();
  const viewEndMs = addDays(viewStartMs, viewDays);
  if (now < viewStartMs || now > viewEndMs) return '';
  return `<div class="now-line" style="left: ${((now - viewStartMs) / (viewEndMs - viewStartMs)) * 100}%"></div>`;
}

// Seção VIRTUAL no topo: sempre visível (independe dos filtros), aceita qualquer modelo
function plannerVirtualHtml(visibleDays, dayClass) {
  const lanes = plannerVirtualLanes();
  const parked = plannerBookings.filter(b => fleetIsVirtualPlate(b.plate)).length;
  let html = `
    <div class="planner-section virtual-section">VIRTUAL — HOLDING AREA
      <span class="virtual-hint">Drag a booking here to free its vehicle, then drag it back to any vehicle of the same model.</span>
      ${parked ? `<span class="virtual-count">${parked} parked</span>` : ''}
    </div>`;
  lanes.forEach((lane, i) => {
    html += `
      <div class="planner-row virtual-row${i === lanes.length - 1 ? ' virtual-last' : ''}" data-plate="${lane}">
        <div class="plate-col">
          <span class="vehicle-desc">Virtual ${i + 1}</span>
          <span class="plate-text">Any model</span>
        </div>
        <div class="timeline-grid dropzone" ondragover="allowDrop(event)" ondrop="drop(event, this)">
          ${visibleDays.map(dayStart => `<div class="day-cell${dayClass(dayStart)}"></div>`).join('')}
          ${plannerBlocksHtml(lane)}
        </div>
      </div>`;
  });
  return html;
}

// ==========================================
// TOOLTIP
// ==========================================
function showTooltip(ev, bookingId) {
  const bk = plannerBookings.find(b => b.id === bookingId);
  if(!bk) return;
  const tooltip = document.getElementById('hover-tooltip');

  let daysDuration = Math.ceil((parseDateTime(bk.dropoffStr) - parseDateTime(bk.pickupStr)) / MS_IN_DAY);
  const veh = plannerHomeVehicle(bk);
  const virtualInfo = fleetIsVirtualPlate(bk.plate)
    ? `<span style="color: #a78bfa; font-weight: 700;">🅥 Parked in Virtual — from ${bk.virtualFrom}</span><br>` : '';
  let notesIndicator = (bk.notesList && bk.notesList.length > 0) ?
      `<br><span style="color: #f59e0b; font-size: 11px; margin-top: 5px; display: inline-block;">📝 Has ${bk.notesList.length} internal note(s)</span>` : '';

  tooltip.innerHTML = `
      <strong style="color: #2563eb; font-size: 13px;">${bk.ref}: ${bk.lname.toUpperCase()}</strong><br>
      ${virtualInfo}${veh ? `${veh.label} · ${veh.plate} · ${FLEET_BRANCHES[veh.branch]}<br>` : ''}
      Pickup: ${bk.pickupStr}<br>Drop off: ${bk.dropoffStr}<br>Rental days: ${daysDuration}
      ${notesIndicator}
  `;
  tooltip.style.display = 'block';
  moveTooltip(ev);
}
function moveTooltip(ev) {
  const tooltip = document.getElementById('hover-tooltip');
  if (tooltip.style.display === 'block') {
      tooltip.style.left = (ev.pageX + 15) + 'px';
      tooltip.style.top = (ev.pageY + 15) + 'px';
  }
}
function hideTooltip() { document.getElementById('hover-tooltip').style.display = 'none'; }


// ==========================================
// MODAL & DATAS (RESERVAS EXISTENTES)
// ==========================================
function switchModalTab(tabId, element) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  if (element) element.classList.add('active');
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
}

function openModal(ev, bookingId) {
  ev.stopPropagation();
  const booking = plannerBookings.find(b => b.id === bookingId);
  // Possible Extension tem janela própria (datas, observação, cancelar)
  if (booking && booking.type === 'possible-ext') { extOpen(bookingId); return; }
  activeBookingId = bookingId;

  if(booking) {
    dvLoadBooking(booking);
    bdLoadBooking(booking);
    feLoadBooking(booking);
    renderModalLedger(booking);
    plannerRenderRaBar(booking);
    document.getElementById('extension-box').style.display = 'none';
    renderNotesTable();
    renderModalChat(booking); // Chama e Renderiza o Chat no clique!
    if (typeof waRenderBookingPanel === 'function') waRenderBookingPanel('mod-wa-panel', booking.id);    bdRenderLastUpdate();
    renderLogTable();
    plannerFormBase = plannerFormSnapshot();

    switchModalTab('mod-booking-details', document.getElementById('tab-btn-booking-details'));
    document.getElementById('booking-modal').style.display = 'flex';
    // Reserva vencida: avisa logo ao abrir o que precisa ser feito
    if (plannerIsStale(booking)) bdMessage('Pick-up date has passed and this booking is still a Reservation. Move it to a new date, mark it as Hired, or cancel it.', false);
  }
}

// Faixa no topo do popup: RA # sempre visível, em qualquer aba
function plannerRenderRaBar(b) {
  const bar = document.getElementById('modal-ra-bar');
  if (!bar || !b) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const v = fleetGetVehicle(b.plate);
  const cat = v ? fleetGetCategory(v.categoryId) : null;
  const name = `${b.fname || ''} ${(b.lname || '').toUpperCase()}`.trim();
  bar.innerHTML = `<span class="ra-label">RA #</span><strong class="ra-num">${esc(b.ref)}</strong>` +
    (name ? `<span class="ra-sep">·</span><span>${esc(name)}</span>` : '') +
    (cat ? `<span class="ra-sep">·</span><span>${esc(cat.model)}</span>` : '') +
    (b.plate ? `<span class="ra-sep">·</span><span class="ra-plate">${esc(b.plate)}</span>` : '');
}

function closeModal() {
  if (plannerPopup) { plannerNotifyOpener(); window.close(); return; }
  document.getElementById('booking-modal').style.display = 'none';
  activeBookingId = null;
  const waBox = document.getElementById('mod-wa-panel');
  if (waBox) { waBox.innerHTML = ''; waBox.dataset.booking = ''; }
  bdPendingCancel = null;
  document.getElementById('add-note-form').style.display = 'none';
}

// ==========================================
// ABA BOOKING DETAILS (mesmos campos do Rental Car Manager)
// ==========================================
const BD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BD_TYPE_LABELS = { reservation: 'RESERVATION', hired: 'HIRED', returned: 'RETURNED', maintenance: 'MAINTENANCE', 'maint-done': 'MAINTENANCE COMPLETED', 'possible-ext': 'POSSIBLE EXT.', cancelled: 'CANCELLED' };
const BD_LISTS = {
  source: ['Google Search', 'Google Maps', 'Direct Website', 'Repeat Customer', 'Word of Mouth', 'Facebook / Instagram', 'Phone', 'Walk-in'],
  youngest: ['21 - 24', '25 - 69', '70+'], // menores de 21 não alugam (FLEET_MIN_DRIVER_AGE)
  transmission: ['No Preference', 'Automatic', 'Manual'],
  travellers: ['1', '2', '3', '4', '5', '6', '7', '8', '9+'],
  area: ['Metro', 'Regional', 'Interstate'],
  campaign: ['Corporate rate', 'Repeat customer', 'Online promotion', 'Insurance replacement'],
  referred: ['Customer', 'Staff member', 'Business partner', 'Agency'],
  agency: ['Direct', 'Travel agent', 'Corporate account', 'Insurance company'],
  fuel: ['Full', '7/8', '3/4', '5/8', '1/2', '3/8', '1/4', '1/8', 'Empty'],
  points: ['Branch counter', 'Sydney Airport (Domestic)', 'Sydney Airport (International)', 'Brisbane Airport', 'Customer address', 'Hotel']
};
let bdPendingCancel = null;
// Booking aberto como foi carregado: para saber se ele está sendo devolvido agora
// e voltar a data original se o agente desistir do Returned antes de salvar
let bdLoaded = null; // { id, type, dropoffMs, autoReturn }

// Devolução real = agora, arredondado para o próximo horário de 15 min dentro do expediente (08:00–17:15)
function plannerActualReturnMs(pickupMs) {
  const now = new Date();
  const slot = FLEET_TIME_STEP * 60000;
  let ms = Math.ceil(now.getTime() / slot) * slot;
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const open = day.getTime() + FLEET_OPEN_MINUTES * 60000;
  const close = day.getTime() + FLEET_CLOSE_MINUTES * 60000;
  ms = Math.min(Math.max(ms, open), close);
  return ms > pickupMs ? ms : null; // retirada ainda no futuro: não mexe
}

// Type → Returned: a data de devolução passa a ser hoje (os dias e o valor são recalculados).
// Pago a mais (devolveu antes) entra no refund junto com o bond; devolveu depois = dias extras a cobrar.
function bdApplyActualReturn(type) {
  if (!bdLoaded || bdLoaded.id !== activeBookingId) return;
  const days = (p, d) => Math.max(1, Math.ceil((d - p) / MS_IN_DAY));
  const pMs = bdReadDate('p');
  if (type === 'returned' && bdLoaded.type !== 'returned') {
    const actual = plannerActualReturnMs(pMs);
    if (!actual) return;
    if (actual !== bdReadDate('d')) { bdSetDate('d', actual); bdOnDatesChange(); }
    bdLoaded.autoReturn = true;
    const before = days(pMs, bdLoaded.dropoffMs), now = days(pMs, actual);
    const when = `${fleetFormatDate(actual)} ${fleetFormatTime(actual)}`;
    bdMessage(now < before
      ? `Drop off set to today, ${when} (actual return): ${now} day${now > 1 ? 's' : ''} charged instead of ${before}. What was paid for the unused days is refunded with the bond.`
      : now > before
        ? `Drop off set to today, ${when} (actual return): returned late, ${now - before} extra day${now - before > 1 ? 's' : ''} to charge.`
        : `Drop off set to today, ${when} (actual return).`, true);
  } else if (bdLoaded.autoReturn) {
    // Desistiu do Returned: volta a devolução prevista
    bdSetDate('d', bdLoaded.dropoffMs);
    bdOnDatesChange();
    bdLoaded.autoReturn = false;
  }
}

function bdTitle(s) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// withPlaceholder: primeira opção "Please select..." com valor vazio (como no RCM)
function bdOptions(list, withPlaceholder) {
  return (withPlaceholder ? '<option value="">Please select...</option>' : '') +
    list.map(v => `<option value="${v}">${v}</option>`).join('');
}

function bdSetSelect(id, value) {
  const el = document.getElementById(id);
  if (value && !Array.from(el.options).some(o => o.value === value)) el.add(new Option(value, value));
  el.value = value || '';
  if (el.selectedIndex === -1) el.selectedIndex = 0;
}

// Monta os selects fixos uma vez (datas, horários, categorias, filiais e listas)
function bdInitForm() {
  let cats = '';
  ['Passenger', 'Commercial'].forEach(section => {
    cats += `<optgroup label="${section}">` + FLEET_CATEGORIES.filter(c => c.section === section)
      .map(c => `<option value="${c.id}">${bdTitle(c.name)}</option>`).join('') + '</optgroup>';
  });
  document.getElementById('bd-category').innerHTML = cats;

  const branches = Object.values(FLEET_BRANCHES).map(n => `<option value="${n}">${fleetBranchLabel(n)}</option>`).join('');
  document.getElementById('bd-pickup-loc').innerHTML = branches;
  document.getElementById('bd-dropoff-loc').innerHTML = branches;
  // Sem one-way entre Sydney e Brisbane: a devolução acompanha a cidade da retirada
  document.getElementById('bd-pickup-loc').addEventListener('change', e =>
    fleetRestrictDropoffSelect(document.getElementById('bd-dropoff-loc'), e.target.value));

  const year = new Date().getFullYear();
  ['p', 'd'].forEach(prefix => {
    let days = '', years = '', hours = '';
    for (let d = 1; d <= 31; d++) days += `<option value="${d}">${d}</option>`;
    for (let y = year - 1; y <= year + 2; y++) years += `<option value="${y}">${y}</option>`;
    // Horário de atendimento: 08:00–17:15 (17:30/17:45 são barrados ao salvar)
    for (let h = Math.floor(FLEET_OPEN_MINUTES / 60); h <= Math.floor(FLEET_CLOSE_MINUTES / 60); h++) hours += `<option value="${h}">${String(h).padStart(2, '0')}</option>`;
    document.getElementById(`bd-${prefix}-date`).innerHTML = `
      <select id="bd-${prefix}-day" onchange="bdOnDatesChange()">${days}</select>
      <select id="bd-${prefix}-month" onchange="bdOnDatesChange()">${BD_MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join('')}</select>
      <select id="bd-${prefix}-year" onchange="bdOnDatesChange()">${years}</select>
      <span class="bd-cal"><button type="button" onclick="bdOpenCalendar('${prefix}')" title="Pick from calendar">📅</button><input type="date" id="bd-${prefix}-cal" onchange="bdFromCalendar('${prefix}')"></span>`;
    document.getElementById(`bd-${prefix}-time`).innerHTML = `
      <select id="bd-${prefix}-hour" onchange="bdOnDatesChange()">${hours}</select><span>:</span>
      <select id="bd-${prefix}-min" onchange="bdOnDatesChange()">${['0', '15', '30', '45'].map(m => `<option value="${m}">${m.padStart(2, '0')}</option>`).join('')}</select>`;
  });

  document.getElementById('bd-source').innerHTML = bdOptions(BD_LISTS.source, true);
  document.getElementById('bd-youngest').innerHTML = bdOptions(BD_LISTS.youngest, true);
  document.getElementById('bd-transmission').innerHTML = bdOptions(BD_LISTS.transmission, false);
  document.getElementById('bd-travellers').innerHTML = bdOptions(BD_LISTS.travellers, true);
  document.getElementById('bd-area').innerHTML = bdOptions(BD_LISTS.area, false);
  document.getElementById('bd-campaign').innerHTML = bdOptions(BD_LISTS.campaign, true);
  document.getElementById('bd-referred').innerHTML = bdOptions(BD_LISTS.referred, true);
  document.getElementById('bd-agency').innerHTML = bdOptions(BD_LISTS.agency, true);
  document.getElementById('bd-fuel-out').innerHTML = bdOptions(BD_LISTS.fuel, true);
  document.getElementById('bd-fuel-in').innerHTML = bdOptions(BD_LISTS.fuel, true);
  document.getElementById('bd-points').innerHTML = BD_LISTS.points.map(p => `<option value="${p}">`).join('');
}

function bdSetDate(prefix, ms) {
  const d = new Date(ms);
  bdSetSelect(`bd-${prefix}-day`, String(d.getDate()));
  bdSetSelect(`bd-${prefix}-month`, String(d.getMonth()));
  bdSetSelect(`bd-${prefix}-year`, String(d.getFullYear()));
  bdSetSelect(`bd-${prefix}-hour`, String(d.getHours()));
  bdSetSelect(`bd-${prefix}-min`, String(d.getMinutes()));
}

function bdReadDate(prefix) {
  const v = part => Number(document.getElementById(`bd-${prefix}-${part}`).value);
  const d = new Date(v('year'), v('month'), v('day'), v('hour'), v('min'));
  return d.getDate() === v('day') ? d.getTime() : NaN; // ex: 31 Feb → inválido
}

function bdOpenCalendar(prefix) {
  const input = document.getElementById(`bd-${prefix}-cal`);
  const ms = bdReadDate(prefix);
  if (!isNaN(ms)) input.value = toDatetimeLocalString(new Date(ms)).slice(0, 10);
  try { input.showPicker(); } catch (e) { input.focus(); }
}

function bdFromCalendar(prefix) {
  const value = document.getElementById(`bd-${prefix}-cal`).value; // YYYY-MM-DD
  if (!value) return;
  const [y, m, d] = value.split('-').map(Number);
  bdSetSelect(`bd-${prefix}-year`, String(y));
  bdSetSelect(`bd-${prefix}-month`, String(m - 1));
  bdSetSelect(`bd-${prefix}-day`, String(d));
  bdOnDatesChange();
}

// Cor do select e do selo mudam na hora em que o tipo é trocado
function bdOnTypeChange() {
  const type = document.getElementById('bd-type').value;
  const locked = document.getElementById('bd-donotmove').checked;
  document.getElementById('bd-type').className = `type-select t-${type}`;
  const badge = document.getElementById('bd-type-badge');
  badge.className = `type-badge t-${type}${locked ? ' locked' : ''}`;
  badge.textContent = BD_TYPE_LABELS[type] + (locked ? ' · DO NOT MOVE' : '');
  bdPendingCancel = null;

  // Aviso imediato: o carro ainda está com outro cliente
  if (type === 'hired') {
    const other = plannerHiredOnPlate(document.getElementById('bd-vehicle').value, activeBookingId);
    if (other) bdMessage(`${other.plate} is still on hire with ${other.ref} (${other.fname} ${other.lname}). Mark it as Returned first.`, false);
    else bdMessage('', true);
  } else {
    bdMessage('', true);
  }
  bdApplyActualReturn(type);
}

function bdOnCategoryChange() {
  bdRefreshVehicleOptions(null);
}

function bdOnDatesChange() {
  bdRefreshVehicleOptions(document.getElementById('bd-vehicle').value);
  feSyncDays();
}

// Lista as placas da categoria indicando quais estão livres no período escolhido
function bdRefreshVehicleOptions(preferredPlate) {
  const booking = plannerBookings.find(b => b.id === activeBookingId);
  const cat = fleetGetCategory(document.getElementById('bd-category').value);
  if (!booking || !cat) return;
  const pMs = bdReadDate('p');
  const dMs = bdReadDate('d');
  const validRange = !isNaN(pMs) && !isNaN(dMs) && dMs > pMs;

  const vehicles = FLEET_VEHICLES.filter(v => v.categoryId === cat.id).map(v => ({
    ...v, free: !validRange || !checkConflict(v.plate, pMs, dMs, booking.id)
  }));
  const select = document.getElementById('bd-vehicle');
  const inVirtual = fleetIsVirtualPlate(booking.plate);
  // Estacionado no Virtual: a faixa atual aparece como primeira opção
  if (inVirtual) vehicles.unshift({ plate: booking.plate, free: true, virtual: true });
  select.innerHTML = vehicles.map(v => v.virtual
    ? `<option value="${v.plate}" data-free="true">🅥 Virtual holding area (from ${booking.virtualFrom})</option>`
    : `<option value="${v.plate}" data-free="${v.free}">${bdTitle(cat.name)} - ${v.label} ${v.plate} (${v.branch})${v.free ? '' : ' — unavailable'}</option>`
  ).join('');

  // Reserva já Hired nunca troca de placa (mesmo se as novas datas conflitarem — o Save avisa)
  const preferred = vehicles.find(v => v.plate === (booking.type === 'hired' || inVirtual ? booking.plate : preferredPlate));
  const pick = preferred || vehicles.find(v => v.free) || vehicles[0];
  if (pick) select.value = pick.plate;
  bdRefreshVehicleStatus();
}

function bdRefreshVehicleStatus() {
  const select = document.getElementById('bd-vehicle');
  const opt = select.options[select.selectedIndex];
  const el = document.getElementById('bd-vehicle-status');
  const free = opt && opt.dataset.free === 'true';
  el.textContent = free ? '✓' : '✗';
  el.title = free ? 'Available for these dates' : 'Booked for these dates';
  el.className = `bd-vehicle-status ${free ? 'ok' : 'bad'}`;
  bdRenderSpareKey(opt ? opt.value : null);
}

// Onde está a chave reserva do veículo escolhido (só leitura; atualiza na ficha do veículo)
function bdRenderSpareKey(plate, editing) {
  const box = document.getElementById('bd-spare-key');
  if (!box) return;
  const k = typeof fleetSpareKey === 'function' && plate && !fleetIsVirtualPlate(plate) ? fleetSpareKey(plate) : null;
  if (!k) { box.innerHTML = ''; box.className = 'bd-spare-key'; return; }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p = esc(plate);

  if (editing) {
    const opts = Object.keys(FLEET_BRANCHES).map(c =>
      `<option value="${c}"${c === k.branch ? ' selected' : ''}>${esc(fleetBranchLabel(FLEET_BRANCHES[c]))}${c === k.home ? ' (home)' : ''}</option>`).join('');
    box.className = 'bd-spare-key editing';
    box.innerHTML = `🔑 Spare key:
      <select id="bd-sk-branch">${opts}</select>
      <input type="text" id="bd-sk-note" maxlength="80" placeholder="Where exactly? e.g. Key cabinet, hook 14" value="${esc(k.note || '')}">
      <button type="button" class="bd-sk-btn save" onclick="bdSaveSpareKey('${p}')">Save</button>
      <button type="button" class="bd-sk-btn" onclick="bdRenderSpareKey('${p}')">Cancel</button>`;
    document.getElementById('bd-sk-note').focus();
    return;
  }

  box.className = 'bd-spare-key' + (k.away ? ' away' : '');
  const meta = k.at ? `Updated ${fleetFormatDate(k.at)}${k.by ? ' by ' + k.by : ''}` : '';
  box.innerHTML = `🔑 Spare key: <strong>${esc(fleetBranchLabel(FLEET_BRANCHES[k.branch]))}</strong>${k.note ? ` · ${esc(k.note)}` : ''}` +
    (k.away ? ` <span class="bd-sk-flag">not at ${esc(k.home)}</span>` : '') +
    ` <button type="button" class="bd-sk-link" title="${esc(meta)}" onclick="bdRenderSpareKey('${p}', true)">Update</button>`;
}

function bdSaveSpareKey(plate) {
  const branch = document.getElementById('bd-sk-branch').value;
  const note = document.getElementById('bd-sk-note').value;
  let by = 'Agent';
  try { by = localStorage.getItem('gc_agent_name') || by; } catch (e) {}
  if (!fleetSetSpareKey(plate, branch, note, by)) return;
  bdRenderSpareKey(plate);
  if (typeof gcToast === 'function') gcToast(`Spare key for ${plate} is now at ${fleetBranchLabel(FLEET_BRANCHES[branch])}.`, 'success');
}

// ==========================================
// REGRAS DE ALOCAÇÃO
// ==========================================
// Tipos que não são locação (não seguem o horário de atendimento)
const PLANNER_TIME_EXEMPT_TYPES = ['maintenance', 'possible-ext'];

// Outra reserva ainda "Hired" (não devolvida) nessa placa?
function plannerHiredOnPlate(plate, excludeId) {
  return plannerBookings.find(b => b.plate === plate && b.id !== excludeId && b.type === 'hired') || null;
}

function plannerSameModel(plateA, plateB) {
  const a = fleetGetVehicle(plateA);
  const b = fleetGetVehicle(plateB);
  return !!a && !!b && a.categoryId === b.categoryId;
}

// Mensagem aparece no rodapé das duas abas (Drivers e Booking Details)
function bdMessage(text, ok) {
  document.querySelectorAll('.bd-message').forEach(el => {
    el.textContent = text;
    el.className = `bd-message ${ok ? 'ok' : 'err'}`;
  });
  // Erro que impede salvar: também em destaque, para não passar despercebido
  if (!ok && text && typeof gcToast === 'function') gcToast(text, 'error');
}

// ==========================================
// JANELA SEPARADA (Daily Activity) E ABAS ABERTAS HÁ MAIS TEMPO
// ==========================================
// Atualiza o relatório que abriu esta janela (não depende do evento "storage" do navegador)
function plannerNotifyOpener() {
  try {
    if (window.opener && !window.opener.closed && typeof window.opener.daView === 'function') window.opener.daView();
  } catch (e) {}
}

// Estado gravado das reservas: se mudou enquanto esta aba estava em segundo plano
// (outra janela, portal, Daily Activity), a aba recarrega ao voltar para ela
function plannerStorageSignature() {
  const parts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(FLEET_MULTI_PREFIX) || key.startsWith(FLEET_MAIN_PREFIX) ||
                key === FLEET_SEED_OVERRIDES_KEY || key === FLEET_EXT_KEY || key === 'gc_bond_ledger')) parts.push(key + '=' + localStorage.getItem(key));
  }
  return parts.sort().join('|');
}

let plannerSignature = null;
function plannerCheckExternalChanges() {
  if (plannerPopup || plannerSignature === null) return;
  const modalOpen = document.getElementById('booking-modal').style.display === 'flex';
  if (!modalOpen && plannerStorageSignature() !== plannerSignature) window.location.reload();
}
window.addEventListener('blur', () => { if (!plannerPopup) plannerSignature = plannerStorageSignature(); });
window.addEventListener('focus', plannerCheckExternalChanges);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') plannerCheckExternalChanges();
  else if (!plannerPopup) plannerSignature = plannerStorageSignature();
});

// ==========================================
// ABA BOOKING FEES (mesmas cobranças do Rental Car Manager)
// Catálogo e cálculo em js/gc-fees-data.js. Gravado em booking.fees:
// { days, rate, discount, insurance, kms, items: [{ id, qty, amount }], total, extras, grandTotal }
// ==========================================
function feInitForm() {
  const opts = list => list.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  document.getElementById('fe-discount').innerHTML = '<option value="">Please select...</option>' + opts(FEE_DISCOUNTS);
}

// Kms do booking aberto: excedente calculado pelas leituras (ou digitado pelo agente) e se a opção
// de kms foi trocada pelo agente (senão segue a política da categoria)
let feKmsCharge = null;
let feKmsManual = false;

function feOnKmsOptionChange() {
  feKmsManual = true;
  feAutoKms();
}

// Agente digitou o Kms Cost: vale o valor dele
function feOnKmsCostInput() {
  const amount = Math.max(0, Number(document.getElementById('fe-kms-cost').value) || 0);
  feKmsCharge = { ...(feKmsCharge || { out: '', in: '', distance: 0, extra: 0, rate: 0 }), amount, manual: true };
  feRecalc();
}

// Recalcula o Kms Cost pelas leituras do odômetro (Booking Details). force: botão 🧮, mesmo com "Recalc Kms cost: No"
function feAutoKms(force) {
  const booking = plannerBookings.find(b => b.id === activeBookingId);
  const kmsSel = document.getElementById('fe-kms');
  if (!booking || !kmsSel || !kmsSel.options.length) return;
  const recalc = (document.querySelector('input[name="bd-kms-recalc"]:checked') || {}).value !== 'No';
  if (recalc || force) {
    const days = Math.max(1, Math.floor(Number(document.getElementById('fe-days').value) || feDaysFromForm()));
    const opt = FEE_KMS.find(k => k.id === kmsSel.value) || feeKmsOption({}, feCategoryOf(booking));
    feKmsCharge = feeKmsCharge(opt, days, document.getElementById('bd-kms-out').value.trim(), document.getElementById('bd-kms-in').value.trim());
    document.getElementById('fe-kms-cost').value = feKmsCharge ? feKmsCharge.amount.toFixed(2) : '0.00';
    if (force && !feKmsCharge) gcToast('Enter Kms Out and Kms In in Booking Details (Vehicle Selection) to work out the kms charge.', 'warning');
  }
  feRecalc();
}

// Texto da franquia e do cálculo, embaixo das opções de kms
function feRenderKmsInfo(fees, calc) {
  const hint = document.getElementById('fe-kms-hint');
  const detail = document.getElementById('fe-kms-detail');
  if (!hint || !detail) return;
  const allowance = feeKmsAllowance(calc.kms, fees.days);
  hint.textContent = Number.isFinite(allowance)
    ? `${allowance.toLocaleString('en-AU')} kms free for ${fees.days} day${fees.days > 1 ? 's' : ''} · additional kms ${feeMoney(calc.kms.perKm)} each${feKmsManual ? '' : ' · company policy for this vehicle'}`
    : 'Unlimited kms: no kms charge.';
  const kc = feKmsCharge;
  detail.textContent = kc && kc.out !== '' && kc.out != null
    ? `Out ${kc.out} → In ${kc.in} · ${kc.distance} kms travelled · ${kc.extra} over the allowance${kc.manual ? ' · amount edited' : ''}`
    : kc && kc.manual ? 'Amount entered by the agent' : 'Kms Out / Kms In not entered yet';
}

function feCategoryOf(b) {
  const veh = plannerHomeVehicle(b);
  return veh ? fleetGetCategory(veh.categoryId) : null;
}

// Cobranças do booking: as salvas, ou as padrão (diária + excess do portal + Debit Bond)
function feBookingFees(b) {
  return b.fees || feeDefaults(feCategoryOf(b), b.excessOption, b.extras);
}

// Dias cobrados a partir das datas da aba Booking Details (mínimo 1)
function feDaysFromForm() {
  const p = bdReadDate('p'), d = bdReadDate('d');
  if (isNaN(p) || isNaN(d) || d <= p) return 1;
  return Math.max(1, Math.ceil((d - p) / MS_IN_DAY));
}

function feSyncDays() {
  document.getElementById('fe-days').value = feDaysFromForm();
  feAutoKms(); // a franquia de kms depende dos dias
}

function feLoadBooking(b) {
  const f = feBookingFees(b);
  const selected = {};
  (f.items || []).forEach(i => { selected[i.id] = i; });

  document.getElementById('fe-insurance').innerHTML = feeExcessOptions(feCategoryOf(b))
    .map(o => `<option value="${o.id}">${o.name}, ${feeMoney(o.daily)} Daily</option>`).join('');

  // Sempre pelas datas atuais: o booking pode ter sido arrastado/estendido desde o último save
  document.getElementById('fe-days').value = feDaysFromForm();
  document.getElementById('fe-rate').value = Number(f.rate || 0).toFixed(2);
  document.getElementById('fe-discount').value = f.discount || '';
  document.getElementById('fe-insurance').value = f.insurance === 'reduced' ? 'reduced' : 'standard';
  // Kms: política da categoria (ou a escolha do agente); as opções antigas só aparecem se já estiverem no booking
  const cat = feCategoryOf(b);
  const kmsNow = feeKmsOption(f, cat);
  feKmsManual = !!f.kmsManual;
  const kmsSel = document.getElementById('fe-kms');
  kmsSel.innerHTML = FEE_KMS.filter(k => !k.legacy || k.id === kmsNow.id)
    .map(k => `<option value="${k.id}">${k.name}${k.id === feeKmsDefault(cat) ? ' (policy)' : ''}</option>`).join('');
  kmsSel.value = kmsNow.id;
  feKmsCharge = f.kmsCharge ? { ...f.kmsCharge } : null;
  document.getElementById('fe-kms-cost').value = feKmsCharge ? Number(feKmsCharge.amount).toFixed(2) : '0.00';

  document.getElementById('fe-items').innerHTML = FEE_GROUPS.map(g =>
    `<tr class="fe-group"><td colspan="5">${g.label}</td></tr>` +
    FEE_ITEMS.filter(i => i.kind === g.kind).map(i => {
      const sel = selected[i.id];
      const amount = sel ? sel.amount : i.amount;
      return `<tr data-fee="${i.id}" class="${sel ? 'on' : ''}">
        <td>${i.name}${i.bond ? ' <span class="fe-tag">BOND</span>' : ''}</td>
        <td class="c"><input type="checkbox" class="fe-sel" ${sel ? 'checked' : ''} onchange="feRecalc()"></td>
        <td class="c"><input type="number" class="fe-qty" min="1" step="1" value="${sel ? sel.qty : 1}" oninput="feRecalc()"></td>
        <td class="r"><input type="number" class="fe-amt" step="0.01" value="${amount.toFixed(2)}" oninput="feRecalc()">${i.kind === 'percent' ? ' %' : ''}</td>
        <td class="r fe-line">—</td>
      </tr>`;
    }).join('')
  ).join('');

  feAutoKms(); // respeita "Recalc Kms cost: Yes/No" do Booking Details
}

// Lê a aba para o mesmo formato gravado em booking.fees e calcula com feeCalc()
function feCompute() {
  const booking = plannerBookings.find(b => b.id === activeBookingId);
  const days = Math.max(1, Math.floor(Number(document.getElementById('fe-days').value) || 1));
  const rows = Array.from(document.querySelectorAll('#fe-items tr[data-fee]')).map(tr => ({
    tr,
    item: feeGetItem(tr.dataset.fee),
    on: tr.querySelector('.fe-sel').checked,
    qty: Number(tr.querySelector('.fe-qty').value),
    amount: Number(tr.querySelector('.fe-amt').value) || 0
  }));
  const fees = {
    days,
    rate: Number(document.getElementById('fe-rate').value) || 0,
    discount: document.getElementById('fe-discount').value,
    insurance: document.getElementById('fe-insurance').value,
    kms: document.getElementById('fe-kms').value,
    kmsManual: feKmsManual,
    kmsCharge: feKmsCharge,
    items: rows.filter(r => r.on).map(r => ({ id: r.item.id, qty: r.qty, amount: r.amount }))
  };
  return { fees, rows, calc: feeCalc(fees, booking ? feCategoryOf(booking) : null, days) };
}

function feRecalc() {
  const { fees, rows, calc } = feCompute();
  feRenderKmsInfo(fees, calc);
  rows.forEach(r => {
    const line = calc.lines.find(l => l.id === r.item.id);
    r.tr.classList.toggle('on', r.on);
    r.tr.querySelector('.fe-line').textContent = r.on && line ? feeMoney(line.total) : '—';
  });
  document.getElementById('fe-hire-total').textContent = feeMoney(calc.hire);
  document.getElementById('fe-sum-total').textContent = feeMoney(calc.total);
  document.getElementById('fe-sum-extras').textContent = feeMoney(calc.extras);
  document.getElementById('fe-sum-grand').textContent = feeMoney(calc.grand);
}

function feReadForm() {
  const { fees, rows, calc } = feCompute();
  if (fees.rate < 0) return { error: 'The daily rate can\'t be negative.' };
  const bad = rows.find(r => r.on && (!Number.isInteger(r.qty) || r.qty < 1));
  if (bad) return { error: `Quantity for "${bad.item.name}" must be a whole number of 1 or more.` };
  return {
    data: {
      ...fees,
      total: Number(calc.total.toFixed(2)),
      extras: Number(calc.extras.toFixed(2)),
      grandTotal: Number(calc.grand.toFixed(2))
    }
  };
}

// ==========================================
// ABA DRIVERS DETAILS (mesmos campos do Rental Car Manager)
// ==========================================
const DV_LISTS = {
  issued: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'New Zealand', 'United Kingdom', 'International Driving Permit'],
  country: ['Australia', 'New Zealand', 'United Kingdom', 'Ireland', 'United States', 'Canada', 'Brazil', 'India', 'China', 'Other'],
  occupation: ['Employed', 'Self-employed', 'Tradesperson', 'Student', 'Retired', 'Other'],
  // Só cartão, cobrado na loja no pick-up (a GC Tech não aceita dinheiro nem transferência)
  paymentType: ['Credit card', 'Debit card'],
  invoicing: ['Email', 'Post', 'Monthly account statement']
};

// Data só com dia/mês/ano, podendo ficar em branco (DOB, validade da CNH)
function dvDateHtml(prefix, fromYear, toYear) {
  let days = '<option value="">day</option>', years = '<option value="">year</option>';
  for (let d = 1; d <= 31; d++) days += `<option value="${d}">${d}</option>`;
  for (let y = toYear; y >= fromYear; y--) years += `<option value="${y}">${y}</option>`;
  return `
    <select id="${prefix}-day">${days}</select>
    <select id="${prefix}-month"><option value="">month</option>${BD_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
    <select id="${prefix}-year">${years}</select>
    <span class="bd-cal"><button type="button" onclick="dvOpenCalendar('${prefix}')" title="Pick from calendar">📅</button><input type="date" id="${prefix}-cal" onchange="dvFromCalendar('${prefix}')"></span>`;
}

function dvSetDate(prefix, iso) {
  const [y, m, d] = iso ? iso.split('-').map(Number) : ['', '', ''];
  bdSetSelect(`${prefix}-year`, y ? String(y) : '');
  bdSetSelect(`${prefix}-month`, m ? String(m) : '');
  bdSetSelect(`${prefix}-day`, d ? String(d) : '');
}

// Devolve 'YYYY-MM-DD', '' se vazio, ou null se incompleto/inválido
function dvReadDate(prefix) {
  const y = document.getElementById(`${prefix}-year`).value;
  const m = document.getElementById(`${prefix}-month`).value;
  const d = document.getElementById(`${prefix}-day`).value;
  if (!y && !m && !d) return '';
  if (!y || !m || !d) return null;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getDate() !== Number(d)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dvOpenCalendar(prefix) {
  const input = document.getElementById(`${prefix}-cal`);
  const current = dvReadDate(prefix);
  if (current) input.value = current;
  try { input.showPicker(); } catch (e) { input.focus(); }
}

function dvFromCalendar(prefix) {
  const value = document.getElementById(`${prefix}-cal`).value;
  if (value) dvSetDate(prefix, value);
}

function dvToggleLifetime() {
  const lifetime = document.getElementById('dv-lifetime').checked;
  ['day', 'month', 'year'].forEach(p => { document.getElementById(`dv-expiry-${p}`).disabled = lifetime; });
}

function dvInitForm() {
  const year = new Date().getFullYear();
  document.getElementById('dv-dob').innerHTML = dvDateHtml('dv-dob', year - 90, year - 16);
  document.getElementById('dv-expiry').innerHTML = dvDateHtml('dv-expiry', year - 1, year + 15);
  document.getElementById('dv-issued-list').innerHTML = DV_LISTS.issued.map(v => `<option value="${v}">`).join('');
  document.getElementById('dv-country').innerHTML = bdOptions(DV_LISTS.country, false);
  document.getElementById('dv-occupation').innerHTML = bdOptions(DV_LISTS.occupation, true);
  document.getElementById('dv-payment-type').innerHTML = bdOptions(DV_LISTS.paymentType, true);
  document.getElementById('dv-invoicing').innerHTML = bdOptions(DV_LISTS.invoicing, true);
}

function dvAdditionalRowHtml(driver) {
  const d = driver || {};
  return `
    <div class="dv-extra-row">
      <input type="text" class="dv-x-lname" placeholder="Last name" value="${d.lname || ''}">
      <input type="text" class="dv-x-fname" placeholder="First name" value="${d.fname || ''}">
      <input type="text" class="dv-x-licence" placeholder="License No" value="${d.licence || ''}">
      <input type="date" class="dv-x-dob" title="Date of birth" value="${d.dob || ''}">
      <button type="button" class="dv-x-remove" onclick="this.parentElement.remove()" title="Remove driver">✕</button>
    </div>`;
}

function dvAddAdditionalDriver() {
  document.getElementById('dv-additional').insertAdjacentHTML('beforeend', dvAdditionalRowHtml());
  const rows = document.querySelectorAll('#dv-additional .dv-extra-row');
  rows[rows.length - 1].querySelector('.dv-x-lname').focus();
}

function dvLoadBooking(b) {
  const drv = b.driver || {};
  document.getElementById('mod-lname').value = b.lname || '';
  document.getElementById('mod-fname').value = b.fname || '';
  document.getElementById('mod-email').value = b.clientEmail || '';
  document.getElementById('mod-phone').value = b.phone || '';
  document.getElementById('mod-licence').value = b.licence || '';
  dvSetDate('dv-dob', drv.dob);
  document.getElementById('dv-mobile').value = drv.mobile || '';
  document.getElementById('dv-fax').value = drv.fax || '';
  document.getElementById('dv-issued').value = drv.issuedIn || b.licenceCountry || '';
  dvSetDate('dv-expiry', drv.licenceExpiry);
  document.getElementById('dv-lifetime').checked = !!drv.licenceLifetime;
  dvToggleLifetime();
  document.getElementById('dv-company').value = drv.company || '';
  document.getElementById('dv-address').value = drv.address || '';
  document.getElementById('dv-city').value = drv.city || '';
  document.getElementById('dv-state').value = drv.state || '';
  document.getElementById('dv-postcode').value = drv.postcode || '';
  bdSetSelect('dv-country', drv.country || 'Australia');
  document.getElementById('dv-local-address').value = drv.localAddress || '';
  bdSetSelect('dv-occupation', drv.occupation || '');
  document.querySelector(`input[name="dv-mailing"][value="${drv.mailingList === 'No' ? 'No' : 'Yes'}"]`).checked = true;
  bdSetSelect('dv-payment-type', drv.paymentType || '');
  bdSetSelect('dv-invoicing', drv.invoicingMethod || '');
  document.getElementById('dv-additional').innerHTML = (drv.additionalDrivers || []).map(dvAdditionalRowHtml).join('');

  // Empresas já usadas em outras reservas viram sugestões
  const companies = [...new Set(plannerBookings.map(x => x.driver && x.driver.company).filter(Boolean))];
  document.getElementById('dv-company-list').innerHTML = companies.map(c => `<option value="${c}">`).join('');
}

// Lê e valida a aba Drivers. Devolve { error } ou os dados do motorista.
function dvReadForm() {
  const val = id => document.getElementById(id).value.trim();
  const lname = val('mod-lname');
  const fname = val('mod-fname');
  const email = val('mod-email').toLowerCase();
  if (!lname || !fname) return { error: 'First and last name are required.' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Please enter a valid email address.' };

  const dob = dvReadDate('dv-dob');
  if (dob === null) return { error: 'Date of birth is incomplete or invalid.' };
  const lifetime = document.getElementById('dv-lifetime').checked;
  const expiry = lifetime ? '' : dvReadDate('dv-expiry');
  if (expiry === null) return { error: 'Licence expiry date is incomplete or invalid.' };

  const additionalDrivers = Array.from(document.querySelectorAll('#dv-additional .dv-extra-row')).map(row => ({
    lname: row.querySelector('.dv-x-lname').value.trim(),
    fname: row.querySelector('.dv-x-fname').value.trim(),
    licence: row.querySelector('.dv-x-licence').value.trim(),
    dob: row.querySelector('.dv-x-dob').value
  })).filter(d => d.lname || d.fname);

  return {
    lname, fname, email,
    phone: val('mod-phone'),
    licence: val('mod-licence'),
    driver: {
      dob, mobile: val('dv-mobile'), fax: val('dv-fax'),
      issuedIn: val('dv-issued'), licenceExpiry: expiry, licenceLifetime: lifetime,
      company: val('dv-company'), address: val('dv-address'), city: val('dv-city'), state: val('dv-state'),
      postcode: val('dv-postcode'), country: val('dv-country'), localAddress: val('dv-local-address'),
      occupation: val('dv-occupation'),
      mailingList: document.querySelector('input[name="dv-mailing"]:checked').value,
      paymentType: val('dv-payment-type'), invoicingMethod: val('dv-invoicing'),
      additionalDrivers
    }
  };
}

function bdLoadBooking(b) {
  bdLoaded = { id: b.id, type: b.type, dropoffMs: parseDateTime(b.dropoffStr), autoReturn: false };
  const veh = plannerHomeVehicle(b);
  const d = b.details || {};
  const pickupLoc = b.loc || (veh ? FLEET_BRANCHES[veh.branch] : 'Sydney - Mascot');

  // "Possible Extension" não é uma opção do Type; só aparece se a reserva já for desse tipo
  const possibleExt = document.querySelector('#bd-type option[value="possible-ext"]');
  if (possibleExt) { possibleExt.hidden = b.type !== 'possible-ext'; possibleExt.disabled = b.type !== 'possible-ext'; }
  // "Maintenance Completed" só existe para bloqueios de manutenção (o carro voltou da oficina)
  const maintDone = document.querySelector('#bd-type option[value="maint-done"]');
  if (maintDone) { maintDone.hidden = b.type !== 'maintenance'; maintDone.disabled = b.type !== 'maintenance'; }
  bdSetSelect('bd-type', BD_TYPE_LABELS[b.type] ? b.type : 'reservation');
  if (b.type === 'maintenance' && d.maintDone) document.getElementById('bd-type').value = 'maint-done';
  document.getElementById('bd-donotmove').checked = !!b.doNotMove;
  if (veh) document.getElementById('bd-category').value = veh.categoryId;
  bdSetSelect('bd-pickup-loc', pickupLoc);
  bdSetSelect('bd-dropoff-loc', b.dropoffLoc || pickupLoc);
  fleetRestrictDropoffSelect(document.getElementById('bd-dropoff-loc'), document.getElementById('bd-pickup-loc').value);
  bdSetDate('p', parseDateTime(b.pickupStr));
  bdSetDate('d', parseDateTime(b.dropoffStr));

  bdSetSelect('bd-source', d.source || '');
  bdSetSelect('bd-youngest', d.youngestDriver || '');
  bdSetSelect('bd-transmission', d.transmission || 'No Preference');
  bdSetSelect('bd-travellers', d.travellers || '');
  bdSetSelect('bd-area', d.areaOfUse || 'Metro');
  document.querySelector(`input[name="bd-rev"][value="${d.revBooking === 'No' ? 'No' : 'Yes'}"]`).checked = true;
  document.getElementById('bd-arrival').value = d.arrival || '';
  document.getElementById('bd-collection').value = d.collectionPoint || '';
  document.getElementById('bd-departure').value = d.departure || '';
  document.getElementById('bd-return').value = d.returnPoint || '';
  bdSetSelect('bd-campaign', d.campaignCode || '');
  bdSetSelect('bd-referred', d.referredBy || '');
  document.getElementById('bd-referral-name').value = d.referralName || '';
  bdSetSelect('bd-agency', d.agency || '');
  document.getElementById('bd-agent').value = d.agent || '';
  document.getElementById('bd-agent-email').value = d.agentEmail || '';
  document.getElementById('bd-reference').value = d.referenceNo || '';
  document.getElementById('bd-kms-out').value = d.kmsOut || '';
  document.getElementById('bd-kms-in').value = d.kmsIn || '';
  bdSetSelect('bd-fuel-out', d.fuelOut || '');
  bdSetSelect('bd-fuel-in', d.fuelIn || '');
  document.querySelector(`input[name="bd-kms-recalc"][value="${d.kmsRecalc === 'No' ? 'No' : 'Yes'}"]`).checked = true;
  bdFillOdometer(b, d);
  document.getElementById('bd-notes').value = d.bookingNotes || '';

  bdRefreshVehicleOptions(b.plate);
  const vehicleSelect = document.getElementById('bd-vehicle');
  const lockedOnHire = b.type === 'hired' && !fleetIsVirtualPlate(b.plate);
  vehicleSelect.disabled = lockedOnHire;
  vehicleSelect.title = lockedOnHire ? 'Vehicle is on hire — to swap it, drag the booking to the VIRTUAL area first' : '';
  bdOnTypeChange();
  bdMessage('', true);
}

// Kms Out / Fuel Out vazios: copia a última leitura do veículo (devolução ou volta da manutenção anterior)
function bdFillOdometer(b, d) {
  const hint = document.getElementById('bd-odo-hint');
  const plate = plannerHomePlate(b);
  if (!hint) return;
  if (!plate || !fleetGetVehicle(plate)) { hint.innerHTML = ''; return; }
  const last = fleetLastOdometer(plate, parseDateTime(b.pickupStr), b.id);
  let copied = false;
  if (!d.kmsOut) { document.getElementById('bd-kms-out').value = last.kms; copied = true; }
  if (!d.fuelOut && last.fuel) bdSetSelect('bd-fuel-out', last.fuel);
  const src = last.kind === 'fleet' ? 'fleet record'
    : `${last.kind === 'in' ? 'returned' : 'picked up'}${last.ref ? ' on RA ' + last.ref : ''} · ${fleetFormatDate(last.atMs)}`;
  hint.innerHTML = `🧭 Last odometer reading for ${plate}: <strong>${Number(last.kms).toLocaleString('en-AU')} km</strong>${last.fuel ? ` · fuel ${last.fuel}` : ''} <span>(${src})</span>${copied ? ' — copied to Kms Out' : ''}`;
}

function saveBookingDetails() {
  const booking = plannerBookings.find(b => b.id === activeBookingId);
  if (!booking) return;
  if (booking.archived) { bdMessage(`${booking.ref} is a closed booking and can't be changed here. Use Bond Refunds for the bond.`, false); return; }
  const val = id => document.getElementById(id).value.trim();
  // "Maintenance Completed" continua sendo uma manutenção, marcada como concluída (details.maintDone)
  const typeSel = val('bd-type');
  const maintDoneSel = typeSel === 'maint-done';
  const type = maintDoneSel ? 'maintenance' : typeSel;
  const prevDetails = booking.details || {};
  const finishingMaint = maintDoneSel && !prevDetails.maintDone;

  // Cancelar pede um segundo clique (sem confirm() do navegador)
  if (type === 'cancelled') {
    if (bdPendingCancel !== booking.id) {
      bdPendingCancel = booking.id;
      bdMessage(`Click "Save Booking" again to cancel ${booking.ref} and release the vehicle.`, false);
      return;
    }
    plannerLog(booking, 'Cancelled', `Booking cancelled, ${booking.plate} released`, { info: `Was ${fleetLogTitle(BD_TYPE_LABELS[booking.type] || booking.type)}` });
    plannerBookings = plannerBookings.filter(b => b.id !== booking.id);
    updateStoredBooking(booking, stored => { stored.status = 'cancelled'; });
    if (!booking.storageKey && !booking.mainKey) fleetSetOverride(booking.id, { cancelled: true });
    if (booking.mainKey) {
      const state = JSON.parse(localStorage.getItem(booking.mainKey) || '{}');
      state.status = 'cancelled';
      localStorage.setItem(booking.mainKey, JSON.stringify(state));
    }
    closeModal();
    renderPlanner();
    return;
  }

  // Aba Drivers: se tiver erro, leva o agente até ela
  const drv = dvReadForm();
  if (drv.error) {
    switchModalTab('mod-drivers', document.getElementById('tab-btn-drivers'));
    bdMessage(drv.error, false);
    return;
  }

  // Leituras do odômetro (fotos na saída e na devolução)
  const kmsOut = val('bd-kms-out'), kmsIn = val('bd-kms-in'), fuelOut = val('bd-fuel-out'), fuelIn = val('bd-fuel-in');
  const pickingUp = type === 'hired' && !['hired', 'returned'].includes(booking.type);
  const returning = type === 'returned' && booking.type !== 'returned';
  const odoError = (pickingUp && (!kmsOut || !fuelOut)) ? 'Enter Kms Out and Fuel Out from the odometer photo before marking the booking as Hired.'
    : ((returning || finishingMaint) && (!kmsIn || !fuelIn)) ? `Enter Kms In and Fuel In from the odometer photo before marking it as ${returning ? 'Returned' : 'Maintenance Completed'}.`
    : (kmsOut && kmsIn && Number(kmsIn) < Number(kmsOut)) ? `Kms In (${kmsIn}) can't be lower than Kms Out (${kmsOut}).`
    : (kmsOut && Number(kmsOut) < 0) || (kmsIn && Number(kmsIn) < 0) ? 'Odometer readings can\'t be negative.' : '';
  if (odoError) {
    switchModalTab('mod-booking-details', document.getElementById('tab-btn-booking-details'));
    bdMessage(odoError, false);
    return;
  }

  feAutoKms(); // Kms Cost em dia com as leituras (respeita "Recalc Kms cost")
  const fees = feReadForm();
  if (fees.error) {
    switchModalTab('mod-fees', document.getElementById('tab-btn-fees'));
    bdMessage(fees.error, false);
    return;
  }

  const pMs = bdReadDate('p');
  let dMs = bdReadDate('d');
  if (isNaN(pMs) || isNaN(dMs)) { bdMessage('Please choose a valid pickup and dropoff date.', false); return; }
  // Voltou da oficina antes do previsto: o bloqueio termina agora e o carro fica livre para reservas
  let releasedEarly = false;
  if (finishingMaint) {
    const now = Date.now();
    if (pMs > now) { bdMessage("This maintenance hasn't started yet — it can only be completed once the vehicle has gone in.", false); return; }
    if (dMs > now) {
      const slot = 15 * 60000;
      dMs = Math.max(pMs + slot, Math.ceil(now / slot) * slot);
      bdSetDate('d', dMs);
      releasedEarly = true;
    }
  }
  if (dMs <= pMs) { bdMessage('Dropoff must be after pickup.', false); return; }

  // Idade mínima: todos os motoristas com 21 anos ou mais na data da retirada (bloqueios de manutenção não têm motorista)
  if (type !== 'maintenance') {
    const drivers = [{ who: 'The main driver', dob: drv.driver.dob }]
      .concat(drv.driver.additionalDrivers.map(x => ({ who: `Additional driver ${`${x.fname} ${x.lname}`.trim()}`, dob: x.dob })));
    const young = drivers.find(x => { const age = fleetAgeAt(x.dob, pMs); return age !== null && age < FLEET_MIN_DRIVER_AGE; });
    if (young || val('bd-youngest') === 'Under 21') {
      switchModalTab(young ? 'mod-drivers' : 'mod-booking-details', document.getElementById(young ? 'tab-btn-drivers' : 'tab-btn-booking-details'));
      bdMessage(young
        ? `${young.who} is ${fleetAgeAt(young.dob, pMs)} on the pick-up date. Drivers must be ${FLEET_MIN_DRIVER_AGE} or older to hire a vehicle.`
        : `Drivers must be ${FLEET_MIN_DRIVER_AGE} or older to hire a vehicle. Change "Youngest Driver" or the driver details.`, false);
      return;
    }
  }

  // Reserva não pode ficar "Reservation" com retirada no passado
  if (type === 'reservation' && pMs < fleetStartOfToday()) {
    bdMessage('The pick-up date is in the past. Move it to today or later, mark it as Hired, or cancel the booking.', false);
    return;
  }

  if (!PLANNER_TIME_EXEMPT_TYPES.includes(type) && (!fleetIsValidBookingTime(pMs) || !fleetIsValidBookingTime(dMs))) {
    bdMessage(FLEET_HOURS_MESSAGE, false);
    return;
  }

  if (!fleetOneWayAllowed(val('bd-pickup-loc'), val('bd-dropoff-loc'))) {
    bdMessage(FLEET_ONE_WAY_MESSAGE, false);
    return;
  }

  let plate = val('bd-vehicle');
  const fromVirtual = fleetIsVirtualPlate(booking.plate);
  const toVirtual = fleetIsVirtualPlate(plate);
  let extPlan = null;
  if (toVirtual) {
    // Continua no Virtual; se as novas datas batem com outro booking da faixa, vai para outra faixa
    plate = plannerFreeVirtualLane(pMs, dMs, booking.id, plate);
  } else {
    if (!plannerSameModel(plate, plannerHomePlate(booking))) {
      bdMessage("Bookings can't be moved to a different vehicle model.", false);
      return;
    }
    if (booking.type === 'hired' && !fromVirtual && plate !== booking.plate) {
      bdMessage(`${booking.plate} is on hire — to swap the vehicle, drag the booking to the VIRTUAL area first.`, false);
      return;
    }
    // Devolução adiada: a Possible Extension logo à frente acompanha a reserva
    extPlan = plannerPlanExtension(booking, plate, pMs, dMs);
    if (!extPlan.ok) {
      bdMessage(extPlan.message || `${plate} is already booked by ${extPlan.blocker.ref}${extPlan.blocker.type === 'possible-ext' ? '' : ` (${extPlan.blocker.fname} ${extPlan.blocker.lname})`} from ${extPlan.blocker.pickupStr} — choose other dates or another vehicle${fromVirtual ? ', or move the booking in the way to VIRTUAL' : ''}.`, false);
      return;
    }
    if (type === 'hired') {
      const other = plannerHiredOnPlate(plate, booking.id);
      if (other) {
        bdMessage(`${plate} is still on hire with ${other.ref} (${other.fname} ${other.lname}). Mark it as Returned first.`, false);
        return;
      }
    }
  }

  const previousType = booking.type;
  const logBefore = plannerLogSnapshot(booking);
  booking.fname = drv.fname;
  booking.lname = drv.lname;
  booking.phone = drv.phone;
  booking.licence = drv.licence;
  booking.driver = drv.driver;
  if (!booking.mainKey && booking.ref !== 'MAINT') booking.name = `${booking.ref}: ${drv.lname.toUpperCase()}`;
  moveStoredBookingEmail(booking, drv.email);

  // Pick-up agora (Reservation → Hired): nada foi pago antes, o agente cobra na loja
  if (booking.type === 'reservation' && type !== 'reservation' && !booking.paidSnapshot) {
    booking.paidSnapshot = [];
    plannerSavePaidSnapshot(booking);
  }
  booking.type = type;
  booking.doNotMove = document.getElementById('bd-donotmove').checked;
  if (fromVirtual && !toVirtual) plannerUnparkVirtual(booking, plate);
  else booking.plate = plate;
  booking.loc = val('bd-pickup-loc');
  booking.dropoffLoc = val('bd-dropoff-loc');
  booking.pickupStr = formatCustomDate(pMs);
  booking.dropoffStr = formatCustomDate(dMs);
  booking.details = bdReadDetailsForm();
  if (maintDoneSel) booking.details.maintDone = prevDetails.maintDone || { at: Date.now(), by: plannerAgentName() };
  // Devolução: guarda dias previstos × usados (o Bond Refunds explica o refund com isso)
  if (returning) {
    const plannedMs = bdLoaded && bdLoaded.id === booking.id ? bdLoaded.dropoffMs : dMs;
    const daysOf = end => Math.max(1, Math.ceil((end - pMs) / MS_IN_DAY));
    booking.details.returnInfo = { plannedMs, actualMs: dMs, plannedDays: daysOf(plannedMs), actualDays: daysOf(dMs) };
  } else if (prevDetails.returnInfo && type === 'returned') {
    booking.details.returnInfo = prevDetails.returnInfo;
  }
  // Devolvido agora: lança a devolução do bond e coloca na fila do Bond Refunds
  const justReturned = type === 'returned' && previousType !== 'returned';
  booking.fees = justReturned ? feeAddBondRefunds(fees.data) : fees.data;

  persistDynamicBooking(booking);
  // Odômetro: a leitura da devolução (ou da volta da oficina) vira o Kms Out do próximo booking do veículo
  const odoPlate = plannerHomePlate(booking);
  const odoInfo = kind => ({ ref: booking.ref, bookingId: booking.id, kind, by: plannerAgentName(),
    atMs: kind === 'out' ? parseDateTime(booking.pickupStr) : parseDateTime(booking.dropoffStr) });
  if (kmsOut && ['hired', 'returned', 'maintenance'].includes(type)) fleetRecordOdometer(odoPlate, kmsOut, fuelOut, odoInfo('out'));
  if (kmsIn && (type === 'returned' || maintDoneSel)) fleetRecordOdometer(odoPlate, kmsIn, fuelIn, odoInfo('in'));

  const extMovedMsg = extPlan ? plannerApplyExtensionShift(extPlan) : '';
  plannerLogChanges(booking, logBefore);
  plannerFormBase = plannerFormSnapshot();
  if (extMovedMsg) plannerLog(booking, 'Amended', extMovedMsg.trim());
  if (finishingMaint) {
    plannerLog(booking, 'Maintenance completed', `${odoPlate} back from maintenance${releasedEarly ? ', available for bookings from ' + fleetNoteDateStr(dMs) : ''}`,
      { info: `kms in ${kmsIn}, fuel ${fuelIn}` });
  }
  plannerAfterSave(booking, type, plate, extMovedMsg);
  if (finishingMaint) {
    bdLoadBooking(booking); // mostra "Maintenance Completed" e a nova data de fim
    bdMessage(`✓ ${odoPlate} marked as Maintenance Completed${releasedEarly ? ` — available for bookings from ${fleetNoteDateStr(dMs)}` : ''}. Kms ${kmsIn} and fuel ${fuelIn} will be used as the next booking's Kms Out.`, true);
  }
}

// Campos da aba Booking Details (o que é gravado em booking.details)
function bdReadDetailsForm() {
  const val = id => document.getElementById(id).value.trim();
  return {
    source: val('bd-source'),
    youngestDriver: val('bd-youngest'),
    transmission: val('bd-transmission'),
    travellers: val('bd-travellers'),
    areaOfUse: val('bd-area'),
    revBooking: document.querySelector('input[name="bd-rev"]:checked').value,
    arrival: val('bd-arrival'),
    collectionPoint: val('bd-collection'),
    departure: val('bd-departure'),
    returnPoint: val('bd-return'),
    campaignCode: val('bd-campaign'),
    referredBy: val('bd-referred'),
    referralName: val('bd-referral-name'),
    agency: val('bd-agency'),
    agent: val('bd-agent'),
    agentEmail: val('bd-agent-email'),
    referenceNo: val('bd-reference'),
    kmsOut: val('bd-kms-out'),
    kmsIn: val('bd-kms-in'),
    fuelOut: val('bd-fuel-out'),
    fuelIn: val('bd-fuel-in'),
    kmsRecalc: (document.querySelector('input[name="bd-kms-recalc"]:checked') || {}).value || 'Yes',
    bookingNotes: val('bd-notes')
  };
}

// Depois de gravar: bonds, tela, mensagens e janela popup
function plannerAfterSave(booking, type, plate, extMovedMsg) {
  const fromDamageControl = !!(plannerDamagePrefill && plannerDamagePrefill.bookingId === booking.id);
  plannerDamageAfterSave(booking);
  if (!fromDamageControl) plannerDamageSync(booking);
  if (type === 'returned') bondUpsertReturned(plannerBondRecord(booking));
  else bondRemoveReturned(booking.id);

  renderPlanner();
  bdRefreshVehicleOptions(plate);
  feLoadBooking(booking);
  renderModalLedger(booking);
  renderNotesTable(); // troca via Virtual gera nota automática
  const rec = plannerBondRecord(booking);
  const owed = type === 'returned' && bondHasBond(rec) && bondBalance(rec) < 0;
  plannerRenderRaBar(booking);
  // O refund junta o bond e o que foi pago a mais (devolveu antes); cobranças na devolução abatem
  let owedMsg = '';
  if (owed) {
    const why = bondBreakdownShort(rec);
    owedMsg = ` Refund of ${feeMoney(-bondBalance(rec))} sent to Bond Refunds` + (why ? ` (bond ${feeMoney(bondRefundBreakdown(rec).bond)} · ${why}).` : ' (bond).');
  }
  bdMessage(`✓ Booking ${booking.ref} saved.` + extMovedMsg + owedMsg, true);
  if (extMovedMsg && !plannerPopup) gcToast(`Booking ${booking.ref} saved.\n\n${extMovedMsg.trim()}`);

  // Reserva (antes do pick-up): nada é cobrado agora, o valor fica para o pick-up
  const due = bondBalance(rec);
  if (type === 'reservation' && due > 0.004) {
    bdMessage(`✓ Booking ${booking.ref} saved. ${feeMoney(due)} due at pick-up (card only).`, true);
  }
  // Pick-up / devolvido com valor em aberto: fica aberta na aba Payments com o botão de cobrança
  // no cartão do cliente — inclusive na janela aberta pelo Daily Activity
  if (type !== 'reservation' && due > 0.004) {
    if (plannerPopup) plannerNotifyOpener();
    plannerRenderPaymentPanels(booking);
    switchModalTab('mod-payments', document.getElementById('tab-btn-payments'));
    bdMessage(`✓ Booking ${booking.ref} saved. ${feeMoney(due)} to charge.`, true);
    gcToast(`Booking ${booking.ref} saved\n\n${feeMoney(due)} to pay${type === 'hired' ? ' at pick-up' : ''}. Charge it to the customer's credit or debit card below — no cash or bank transfer.`, 'info', { duration: 6000 });
    return;
  }
  // Total caiu depois de já pago (ex.: voltou do Excess Reduction para o Standard): devolver a diferença.
  // Caução de booking devolvido continua no Bond Refunds.
  const bondRefundLines = (rec.fees.items || []).some(i => (feeGetItem(i.id) || {}).refund);
  if (due < -0.004 && !bondRefundLines) {
    if (plannerPopup) plannerNotifyOpener();
    switchModalTab('mod-payments', document.getElementById('tab-btn-payments'));
    bdMessage(`✓ Booking ${booking.ref} saved. ${feeMoney(-due)} to refund.`, true);
    gcToast(`Booking ${booking.ref} saved\n\nThe booking total went down by ${feeMoney(-due)}. Refund the difference to the customer's card below.`, 'info', { duration: 6000 });
    return;
  }

  // Janela aberta pelo Daily Activity: atualiza o relatório e fecha
  if (plannerPopup) {
    plannerNotifyOpener();
    gcToast(`Booking ${booking.ref} saved as ${BD_TYPE_LABELS[type] || type}.` + (extMovedMsg ? `\n\n${extMovedMsg.trim()}` : ''));
    setTimeout(() => window.close(), owed || extMovedMsg ? 2600 : 1100);
  }
}

// ==========================================
// EXTENSÃO DA RESERVA + POSSIBLE EXTENSION À FRENTE
// Ao estender uma reserva, a Possible Extension logo depois dela (mesmo carro, começando
// até 3 dias após a devolução antiga) anda o mesmo tempo, mantendo a duração.
// Weekend Holds não se movem. Se a extensão movida bater em outra reserva, nada é salvo.
// ==========================================
function plannerExtensionsAhead(booking, oldEndMs) {
  return plannerBookings.filter(b => b.type === 'possible-ext' && b.kind !== 'weekend' && b.id !== booking.id &&
    b.plate === booking.plate && parseDateTime(b.pickupStr) >= oldEndMs - 60000 && parseDateTime(b.pickupStr) <= oldEndMs + 3 * MS_IN_DAY);
}

// Conflito na placa ignorando as reservas da lista (a própria e as extensões que vão se mover)
function plannerConflictIgnoring(plate, startMs, endMs, ignoreIds) {
  return plannerBookings.find(b => b.plate === plate && !ignoreIds.includes(b.id) &&
    fleetTimesClash(parseDateTime(b.pickupStr), parseDateTime(b.dropoffStr), startMs, endMs,
      b.type === 'possible-ext' || fleetIsVirtualPlate(plate))) || null;
}

// Plano da extensão: { ok, exts, delta, blocker, message }
function plannerPlanExtension(booking, plate, startMs, newEndMs) {
  const oldEnd = parseDateTime(booking.dropoffStr);
  const delta = newEndMs - oldEnd;
  const exts = delta > 0 && plate === booking.plate ? plannerExtensionsAhead(booking, oldEnd) : [];
  const ignore = [booking.id, ...exts.map(e => e.id)];
  const blocker = plannerConflictIgnoring(plate, startMs, newEndMs, ignore);
  if (blocker) return { ok: false, exts, delta, blocker };
  for (const ext of exts) {
    const s = parseDateTime(ext.pickupStr) + delta, e = parseDateTime(ext.dropoffStr) + delta;
    const hit = plannerConflictIgnoring(plate, s, e, ignore);
    if (hit) {
      return { ok: false, exts, delta, blocker: hit,
        message: `The possible extension after this booking would move into ${hit.ref} (${hit.fname} ${hit.lname}) on ${hit.pickupStr}. Shorten or cancel the possible extension first.` };
    }
  }
  return { ok: true, exts, delta };
}

function plannerApplyExtensionShift(plan) {
  if (!plan.exts.length) return '';
  plan.exts.forEach(ext => {
    ext.pickupStr = formatCustomDate(parseDateTime(ext.pickupStr) + plan.delta);
    ext.dropoffStr = formatCustomDate(parseDateTime(ext.dropoffStr) + plan.delta);
  });
  plannerSaveExtensions();
  const days = Math.round(plan.delta / MS_IN_DAY * 10) / 10;
  return ` Possible extension moved ${days} day${days === 1 ? '' : 's'} to follow it (now ${plan.exts[0].pickupStr} → ${plan.exts[0].dropoffStr}).`;
}

function extendBooking(daysToAdd) {
  const booking = plannerBookings.find(b => b.id === activeBookingId);
  if(booking) {
    if (booking.type === 'maintenance') { gcToast('Maintenance holds cannot be extended.', 'warning'); return; }

    let oldDropoffMs = parseDateTime(booking.dropoffStr);
    let newDropoffMs = addDays(oldDropoffMs, daysToAdd);
    let pMs = parseDateTime(booking.pickupStr);
    // Total antes da extensão: o valor da extensão é a diferença no total da reserva
    // (diária do Booking Fees + excess reduction + extras diários), igual ao saldo do Payments
    const grandBefore = bondCalc(plannerBondRecord(booking)).grand;

    // A Possible Extension logo à frente acompanha a reserva
    const plan = plannerPlanExtension(booking, booking.plate, pMs, newDropoffMs);
    if (!plan.ok) {
      gcToast('Cannot extend\n\n' + (plan.message || `${booking.plate} is already booked by ${plan.blocker.ref} for the requested period.`), 'error');
      return;
    }

    booking.dropoffStr = formatCustomDate(newDropoffMs);
    persistDynamicBooking(booking);
    const movedMsg = plannerApplyExtensionShift(plan);
    const cost = Math.max(0, Math.round((bondCalc(plannerBondRecord(booking)).grand - grandBefore) * 100) / 100);
    const beforePickup = booking.type === 'reservation';
    {
      const vh = plannerHomeVehicle(booking);
      const ct = vh ? fleetGetCategory(vh.categoryId) : null;
      const r = booking.fees && booking.fees.rate != null ? Number(booking.fees.rate) : (ct ? ct.rate : 145);
      plannerLog(booking, 'Extended', `Extended ${daysToAdd} day${daysToAdd > 1 ? 's' : ''}: drop-off ${fleetNoteDateStr(oldDropoffMs)} → ${fleetNoteDateStr(newDropoffMs)}`,
        { rate: `${daysToAdd}x$${r.toFixed(2)}`, info: [beforePickup ? 'Added to the amount due at pick-up' : '', movedMsg ? movedMsg.trim() : ''].filter(Boolean).join(' · '), total: cost });
    }
    if (movedMsg) gcToast(`Booking extended ${daysToAdd} day${daysToAdd > 1 ? 's' : ''}.\n\n${movedMsg.trim()}`);
    bdSetDate('d', newDropoffMs);
    bdRefreshVehicleOptions(booking.plate);
    feSyncDays();
    // Antes do pick-up nada é cobrado: a extensão só aumenta o valor devido no pick-up
    plannerPendingExtension = beforePickup ? null : { bookingId: booking.id, days: daysToAdd, cost };
    renderPlanner();
    document.getElementById('extension-title').textContent = beforePickup ? 'Extension Added' : 'Process Extension Payment';
    document.getElementById('extension-summary').innerHTML = `
      <strong>Extension Added:</strong> ${daysToAdd} Day(s)<br>
      <strong>Updated Drop-off:</strong> ${booking.dropoffStr}<br><br>
      <strong>${beforePickup ? 'Added to the amount due at pick-up' : 'Additional Amount Due'}:</strong> $${cost.toFixed(2)} AUD` +
      (beforePickup ? `<br><span style="color:#94a3b8;font-size:12px">Nothing is charged now. The customer pays the new total at pick-up (card only).</span>` : '');
    document.getElementById('extension-charge').style.display = beforePickup ? 'none' : '';
    document.getElementById('extension-box').style.display = 'block';
    if (typeof plannerRenderPaymentPanels === 'function') plannerRenderPaymentPanels(booking);
    renderModalLedger(booking);
    plannerRenderRaBar(booking);
    switchModalTab('mod-payments', document.getElementById('tab-btn-payments'));
  }
}


// Extensão: cobra o valor no cartão selecionado (PowerBoard)
let plannerPendingExtension = null;
function processModalPayment() {
  const b = plannerBookings.find(x => x.id === activeBookingId);
  if (!b) return;
  const ext = plannerPendingExtension && plannerPendingExtension.bookingId === b.id ? plannerPendingExtension : null;
  if (ext && typeof pbCharge === 'function') {
    const res = pbCharge(b.id, ext.cost, 'extension', `Extension ${ext.days} day${ext.days > 1 ? 's' : ''}`);
    if (res.declined) {
      gcToast(`Card declined\n\n${pbBrandLabel(res.card.brand)} ending ${res.card.last4} has expired. Add a new card in Payment Methods above, then charge again.`, 'error');
      pbRefresh(b.id);
      return;
    }
    plannerPendingExtension = null;
    document.getElementById('extension-box').style.display = 'none';
    pbRefresh(b.id);
    gcToast(`${pbMoney(ext.cost)} charged to ${pbBrandLabel(res.card.brand)} ending ${res.card.last4}.`, 'success');
  } else {
    plannerLog(b, 'Payment', `Payment taken - ${b.fname} ${b.lname}`, { info: 'Processed by payment provider' });
    gcToast('Payment processed.');
  }
  switchModalTab('mod-docs', document.getElementById('tab-btn-docs'));
}

function sendModalInvoice() {
  const b = plannerBookings.find(x => x.id === activeBookingId);
  if (b) plannerLog(b, '', `Invoice emailed to customer${b.clientEmail ? ' [' + b.clientEmail + ']' : ''}`);
  gcToast('Updated invoice emailed to the customer.');
  closeModal();
}

// ==========================================
// RENDERIZAÇÃO DO CHAT NO MODAL
// ==========================================
function renderModalChat(booking) {
  const email = booking.clientEmail || `${booking.fname.toLowerCase()}.${booking.lname.toLowerCase()}@example.com`;
  // O Session ID exato que permite puxar a conversa!
  const sessionId = `${email}_${booking.ref}`;

  const thread = document.getElementById('mod-chat-thread');
  const openBtn = document.getElementById('mod-chat-open-btn');

  if (typeof getChatMessages !== 'function') {
     thread.innerHTML = '<p style="padding: 10px; color: #ef4444;">Chat script is missing.</p>';
     return;
  }

  const messages = getChatMessages(sessionId);

  if (messages.length === 0) {
    thread.innerHTML = `<div style="text-align: center; padding: 40px 20px; color: #94a3b8; font-style: italic;">No chat history for this booking yet.<br><br><span style="font-size: 11px;">Click 'Open Full Chat ↗' to start a conversation with the customer.</span></div>`;
  } else {
    // Renderezia o histórico puxando os estilos do gc-chat.css
    thread.innerHTML = messages.map(m => {
      if (m.sender === 'system') {
        return `<div class="chat-msg-row system"><div class="chat-bubble system">${m.text}</div></div>`;
      }
      const isAgent = m.sender === 'agent';
      return `
        <div class="chat-msg-row ${isAgent ? 'mine' : 'theirs'}">
          <div class="chat-bubble ${isAgent ? 'mine' : 'theirs'}">
            ${!isAgent ? `<div class="chat-sender-name">${m.senderName}</div>` : ''}
            <div>${m.text}</div>
            <div class="chat-timestamp">${new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Activa o botão de "Open Full Chat"
  openBtn.style.display = 'block';
  openBtn.onclick = function() {
    const custName = `${booking.fname} ${booking.lname}`;

    // Assegura-se de que a sessão existe antes de abrir
    if (typeof ensureChatSession === 'function') {
       ensureChatSession(sessionId, email, custName, booking.ref, booking.pickupStr, booking.plate);
    }

    // Abre no formato de agente
    window.open(
      `gc-chat.html?role=agent&email=${encodeURIComponent(email)}&name=${encodeURIComponent(custName)}&sessionId=${encodeURIComponent(sessionId)}`,
      'gcChat_' + sessionId,
      'width=380,height=580'
    );
  };

  setTimeout(() => { thread.scrollTop = thread.scrollHeight; }, 50);
}

// Atualiza o Chat dentro do modal "Live" quando alguém digita
window.addEventListener('storage', (e) => {
   if (e.key && e.key.startsWith('gc_chat_messages_') && activeBookingId) {
      const booking = plannerBookings.find(b => b.id === activeBookingId);
      if (booking) renderModalChat(booking);
   }
});

// ==========================================
// NOTAS INTERNAS
// ==========================================
function renderNotesTable() {
    const booking = plannerBookings.find(b => b.id === activeBookingId);
    const tbody = document.getElementById('notes-table-body');
    tbody.innerHTML = '';

    if(!booking || !booking.notesList || booking.notesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No internal notes found for this booking.</td></tr>`;
        return;
    }

    booking.notesList.slice().reverse().forEach(note => {
        let statusClass = note.status === "Active" ? "status-active" : "";
        let row = `
            <tr>
                <td>${note.priority}</td>
                <td class="${statusClass}">${note.status}</td>
                <td>${note.subject || '-'}</td>
                <td style="max-width: 250px; white-space: normal;">${note.text}</td>
                <td style="font-size: 11px; color: #94a3b8;">
                    ${note.dateStr}<br><strong style="color: #cbd5e1;">${note.author}</strong>
                </td>
                <td style="text-align: center;">
                    <button class="delete-note-btn" onclick="deleteInternalNote(${note.id})" title="Delete Note">🗑️</button>
                </td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function toggleAddNoteForm() {
    const form = document.getElementById('add-note-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if(form.style.display === 'block') {
        document.getElementById('new-note-content').value = '';
        document.getElementById('new-note-subject').value = '';
    }
}

function saveInternalNote() {
    const booking = plannerBookings.find(b => b.id === activeBookingId);
    if(!booking) return;

    let content = document.getElementById('new-note-content').value;
    if(!content.trim()) { gcToast('Please enter the note details.', 'warning'); return; }

    let priority = document.getElementById('new-note-priority').value;
    let subject = document.getElementById('new-note-subject').value;

    if(!booking.notesList) booking.notesList = [];

    booking.notesList.push({
        id: Date.now(),
        priority: priority,
        status: "Active",
        subject: subject,
        text: content,
        dateStr: getCurrentNoteDateStr(),
        author: plannerAgentName()
    });

    persistDynamicBooking(booking);
    plannerLog(booking, 'Note', `Note added${subject && subject !== '-' ? ' (' + subject + ')' : ''}: ${content.trim()}`, { info: priority + ' priority' });
    toggleAddNoteForm();
    renderNotesTable();
    renderPlanner();
}

async function deleteInternalNote(noteId) {
    const ok = await gcConfirm({ title: 'Delete this note?', message: 'The note will be removed from this booking.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    const booking = plannerBookings.find(b => b.id === activeBookingId);
    if(booking && booking.notesList) {
        const gone = booking.notesList.find(n => n.id === noteId);
        booking.notesList = booking.notesList.filter(n => n.id !== noteId);
        persistDynamicBooking(booking);
        if (gone) plannerLog(booking, 'Note', `Note deleted: ${gone.text}`, { info: gone.author ? 'Written by ' + gone.author : '' });
        renderNotesTable();
        renderPlanner();
    }
}

// ==========================================
// DRAG AND DROP
// ==========================================
function allowDrop(ev) {
  ev.preventDefault();
  ev.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
}
function drag(ev) {
  hideTooltip();
  ev.dataTransfer.setData("text", ev.target.id);
}
function drop(ev, dropzoneElement) {
  ev.preventDefault();
  dropzoneElement.style.background = 'transparent';
  let data = ev.dataTransfer.getData("text");
  let draggedElement = document.getElementById(data);

  if(draggedElement) {
    let newPlate = dropzoneElement.closest('.planner-row').getAttribute('data-plate');
    let booking = plannerBookings.find(b => b.id === draggedElement.id);
    if (booking && booking.doNotMove) {
      gcToast('Booking locked\n\nThis booking is marked Do Not Move, so its vehicle cannot be changed.', 'warning');
      return;
    }
    if(booking) {
      if (newPlate === booking.plate) return;
      const fromVirtual = fleetIsVirtualPlate(booking.plate);

      // Para o Virtual: qualquer booking (inclusive Hired), em qualquer faixa livre
      if (fleetIsVirtualPlate(newPlate)) {
        const fromPlate = plannerHomePlate(booking);
        plannerParkVirtual(booking, newPlate);
        persistDynamicBooking(booking);
        plannerLog(booking, 'Vehicle', `Moved from ${fromPlate} to the Virtual holding area (drag & drop)`);
        renderPlanner();
        return;
      }

      if (!plannerSameModel(newPlate, plannerHomePlate(booking))) {
        gcToast(`Cannot drop here\n\nBookings can only be moved to another vehicle of the same model${fromVirtual ? ` as ${booking.virtualFrom}` : ''}.`, 'warning');
        return;
      }
      // Carro já entregue ao cliente: só troca de placa passando pelo Virtual (troca de veículo)
      if (booking.type === 'hired' && !fromVirtual) {
        gcToast(`Cannot move this booking\n\n${booking.plate} is on hire with ${booking.fname} ${booking.lname}. To swap the vehicle, drag it to the VIRTUAL area first, then onto the vehicle the customer actually has.`, 'warning');
        return;
      }
      let pMs = parseDateTime(booking.pickupStr);
      let dMs = parseDateTime(booking.dropoffStr);
      if (checkConflict(newPlate, pMs, dMs, booking.id)) {
        gcToast("Cannot drop here\n\nThere is a time conflict with another booking on this vehicle." +
              (fromVirtual ? " Move the booking that is in the way to the VIRTUAL area first." : ''), 'error');
        return;
      }
      const fromPlate = fromVirtual ? booking.virtualFrom : booking.plate;
      if (fromVirtual) plannerUnparkVirtual(booking, newPlate);
      else booking.plate = newPlate;
      persistDynamicBooking(booking);
      plannerLog(booking, 'Vehicle', `Vehicle changed from ${fromPlate} to ${newPlate}${fromVirtual ? ' (via Virtual)' : ''} (drag & drop)`);
      renderPlanner();
    }
  }
}
document.addEventListener("dragleave", function(event) {
  if (event.target.classList && event.target.classList.contains("dropzone")) {
    event.target.style.background = 'transparent';
  }
}, false);

// ==========================================
// QUICK ACTION (CLIQUE VAZIO)
// ==========================================
let pendingActionPlate = null;
let pendingActionDateStr = null;
let pendingActionVehicleDesc = null;

function openQuickAction(ev, plate, vehDesc, dateStr) {
  pendingActionPlate = plate;
  pendingActionVehicleDesc = vehDesc;
  pendingActionDateStr = dateStr;
  document.getElementById('qa-plate').innerText = plate + " (" + vehDesc + ")";

  let startMs = parseDateTime(dateStr);
  let startDateObj = new Date(startMs);
  startDateObj.setHours(9, 0, 0, 0);
  let endDateObj = new Date(startDateObj.getTime() + (7 * MS_IN_DAY));

  document.getElementById('qa-start-date').value = toDatetimeLocalString(startDateObj);
  document.getElementById('qa-end-date').value = toDatetimeLocalString(endDateObj);
  document.getElementById('quick-action-modal').style.display = 'flex';
}

function closeQuickActionModal() {
  document.getElementById('quick-action-modal').style.display = 'none';
}

function redirectToAddBooking() {
  let startInputVal = document.getElementById('qa-start-date').value;
  let endInputVal = document.getElementById('qa-end-date').value;

  if(!startInputVal || !endInputVal) {
      gcToast('Please select both dates.', 'warning');
      return;
  }
  if (!fleetIsValidBookingTime(new Date(startInputVal).getTime()) || !fleetIsValidBookingTime(new Date(endInputVal).getTime())) {
      gcToast('Outside opening hours\n\n' + FLEET_HOURS_MESSAGE, 'error');
      return;
  }

  localStorage.setItem('gc_qa_plate', pendingActionPlate);
  localStorage.setItem('gc_qa_pickup', startInputVal);
  localStorage.setItem('gc_qa_dropoff', endInputVal);

  window.location.href = `gc-add-booking.html?plate=${pendingActionPlate}&pickup=${startInputVal}&dropoff=${endInputVal}`;
}

function addPossibleExtension() {
  let startInputVal = document.getElementById('qa-start-date').value;
  let endInputVal = document.getElementById('qa-end-date').value;
  if(!startInputVal || !endInputVal) return;

  let startMs = new Date(startInputVal).getTime();
  let endMs = new Date(endInputVal).getTime();

  if(checkConflict(pendingActionPlate, startMs, endMs, null, true)) { // hold pode ficar colado no booking
    gcToast('Cannot add hold\n\nThere is a time conflict on this vehicle.', 'error');
    return;
  }

  if (endMs <= startMs) {
    gcToast('The end must be after the start.', 'warning');
    return;
  }

  const newExt = extToBooking({
    id: 'bk-ext-' + Date.now(), plate: pendingActionPlate, startMs, endMs, note: '',
    createdBy: plannerAgentName(), createdAt: Date.now()
  });
  plannerBookings.push(newExt);
  plannerSaveExtensions();
  plannerLog(newExt, 'Hold', `Possible extension created: ${newExt.pickupStr} → ${newExt.dropoffStr}`);
  closeQuickActionModal();
  renderPlanner();
  gcToast('Possible extension added.');
}

// ==========================================
// POSSIBLE EXTENSION — gravadas em gc_possible_extensions (gc-fleet-data.js)
// Clique no bloco abre a janela da extensão: mudar datas, observação ou cancelar.
// ==========================================
let extActiveId = null;

// kind 'weekend' = Weekend Hold (bloqueio que se repete todo fim de semana; mesma mecânica da extensão)
function extToBooking(x) {
  const weekend = x.kind === 'weekend';
  return {
    id: x.id, ref: weekend ? 'WKND-HOLD' : 'POSS-EXT', plate: x.plate,
    fname: weekend ? 'Weekend' : 'Possible', lname: weekend ? 'Hold' : 'Extension',
    name: weekend ? 'WEEKEND HOLD' : 'POSSIBLE EXTENSION', type: 'possible-ext',
    kind: x.kind || 'extension', seriesId: x.seriesId || null,
    pickupStr: formatCustomDate(x.startMs), dropoffStr: formatCustomDate(x.endMs), notesList: [],
    note: x.note || '', createdBy: x.createdBy || '', createdAt: x.createdAt || null
  };
}

function plannerLoadExtensions() {
  fleetReadExtensions().forEach(x => {
    if (!plannerBookings.find(b => b.id === x.id)) plannerBookings.push(extToBooking(x));
  });
}

function plannerSaveExtensions() {
  fleetWriteExtensions(plannerBookings.filter(b => b.type === 'possible-ext').map(b => ({
    id: b.id, plate: fleetIsVirtualPlate(b.plate) ? b.virtualFrom : b.plate,
    startMs: parseDateTime(b.pickupStr), endMs: parseDateTime(b.dropoffStr),
    note: b.note || '', createdBy: b.createdBy || '', createdAt: b.createdAt || null,
    kind: b.kind || 'extension', seriesId: b.seriesId || null
  })));
}

function extFillTime(selectId, value, step) {
  const sel = document.getElementById(selectId);
  const max = step === 'h' ? 24 : 4;
  sel.innerHTML = Array.from({ length: max }, (_, i) => {
    const v = String(step === 'h' ? i : i * 15).padStart(2, '0');
    return `<option value="${v}">${v}</option>`;
  }).join('');
  sel.value = String(value).padStart(2, '0');
  if (!sel.value) sel.selectedIndex = 0;
}

function extSetRange(prefix, ms) {
  const d = new Date(ms);
  document.getElementById(`ext-${prefix}-date`).value = toDatetimeLocalString(d).slice(0, 10);
  extFillTime(`ext-${prefix}-h`, d.getHours(), 'h');
  extFillTime(`ext-${prefix}-m`, Math.floor(d.getMinutes() / 15) * 15, 'm');
}

function extReadRange(prefix) {
  const date = document.getElementById(`ext-${prefix}-date`).value;
  if (!date) return NaN;
  return new Date(`${date}T${document.getElementById(`ext-${prefix}-h`).value}:${document.getElementById(`ext-${prefix}-m`).value}`).getTime();
}

function extRefreshDays() {
  const s = extReadRange('from'), e = extReadRange('to');
  const el = document.getElementById('ext-days');
  el.textContent = isNaN(s) || isNaN(e) || e <= s ? '—' : `${Math.ceil((e - s) / MS_IN_DAY)} day(s)`;
}

function extAddDays(n) {
  const e = extReadRange('to');
  if (isNaN(e)) return;
  extSetRange('to', addDays(e, n));
  extRefreshDays();
}

function extOpen(id) {
  const ext = plannerBookings.find(b => b.id === id);
  if (!ext) return;
  extActiveId = id;
  hideTooltip();
  const plate = fleetIsVirtualPlate(ext.plate) ? ext.virtualFrom : ext.plate;
  const veh = fleetGetVehicle(plate);
  const startMs = parseDateTime(ext.pickupStr), endMs = parseDateTime(ext.dropoffStr);

  const weekend = ext.kind === 'weekend';
  document.getElementById('ext-title').textContent = weekend ? 'Weekend Hold' : 'Possible Extension';
  document.getElementById('ext-badge').textContent = weekend ? 'WEEKEND HOLD' : 'POSSIBLE EXT.';
  document.getElementById('ext-delete-btn').textContent = weekend ? 'Cancel this weekend' : 'Cancel extension';
  document.getElementById('ext-delete-series').hidden = !(weekend && ext.seriesId);
  document.getElementById('ext-plate').textContent = plate || '';
  document.getElementById('ext-vehicle').innerHTML = veh
    ? `${veh.label} · ${veh.plate}<span class="sub">${fleetGetCategory(veh.categoryId).name} — ${FLEET_BRANCHES[veh.branch]}</span>`
    : (plate || '—');

  // Reserva que esta extensão estende: a última que termina até o início dela (no máximo 3 dias antes), no mesmo carro
  const linked = plannerBookings
    .filter(b => b.plate === ext.plate && b.id !== id && !['possible-ext', 'maintenance'].includes(b.type) &&
                 parseDateTime(b.dropoffStr) <= startMs + 60000 && parseDateTime(b.dropoffStr) >= startMs - 3 * MS_IN_DAY)
    .sort((a, b) => parseDateTime(b.dropoffStr) - parseDateTime(a.dropoffStr))[0];
  document.getElementById('ext-linked-label').textContent = weekend ? 'Series' : 'Extends booking';
  if (weekend) {
    const series = plannerBookings.filter(b => b.seriesId && b.seriesId === ext.seriesId);
    const upcoming = series.filter(b => parseDateTime(b.pickupStr) >= startMs).length;
    const last = series.reduce((m, b) => Math.max(m, parseDateTime(b.pickupStr)), 0);
    document.getElementById('ext-linked').innerHTML = ext.seriesId
      ? `Every ${weekendPatternText(startMs, endMs)}<span class="sub">${upcoming} hold${upcoming === 1 ? '' : 's'} from this weekend on · last on ${fleetFormatDate(last)}</span>`
      : '<span class="sub">Single weekend</span>';
  } else {
    document.getElementById('ext-linked').innerHTML = linked
      ? `${linked.ref} · ${linked.fname} ${linked.lname}<span class="sub">Due back ${linked.dropoffStr}</span>`
      : '<span class="sub">No booking right before this hold</span>';
  }

  extSetRange('from', startMs);
  extSetRange('to', endMs);
  ['ext-from-date', 'ext-from-h', 'ext-from-m', 'ext-to-date', 'ext-to-h', 'ext-to-m'].forEach(i => { document.getElementById(i).onchange = extRefreshDays; });
  extRefreshDays();
  document.getElementById('ext-note').value = ext.note || '';
  document.getElementById('ext-created').textContent = ext.createdAt
    ? `${ext.createdBy || 'Agent'} · ${fleetNoteDateStr(ext.createdAt)}`
    : 'Created in the Planner';
  document.getElementById('ext-modal').style.display = 'flex';
}

function extClose() {
  document.getElementById('ext-modal').style.display = 'none';
  extActiveId = null;
}

function extSave() {
  const ext = plannerBookings.find(b => b.id === extActiveId);
  if (!ext) return;
  const s = extReadRange('from'), e = extReadRange('to');
  if (isNaN(s) || isNaN(e)) { gcToast('Please choose both dates.', 'warning'); return; }
  if (e <= s) { gcToast('The end must be after the start.', 'warning'); return; }
  if (checkConflict(ext.plate, s, e, ext.id, true)) { // a extensão fica colada no booking: sem intervalo
    gcToast(`Cannot save\n\n${ext.plate} has another booking in this period.`, 'error');
    return;
  }
  ext.pickupStr = formatCustomDate(s);
  ext.dropoffStr = formatCustomDate(e);
  const oldRange = `${ext.pickupStr} → ${ext.dropoffStr}`;
  ext.note = document.getElementById('ext-note').value.trim();
  plannerSaveExtensions();
  const newRange = `${ext.pickupStr} → ${ext.dropoffStr}`;
  plannerLog(ext, 'Amended', oldRange !== newRange ? `${ext.kind === 'weekend' ? 'Weekend hold' : 'Possible extension'} moved: ${oldRange} to ${newRange}` : `${ext.kind === 'weekend' ? 'Weekend hold' : 'Possible extension'} updated`, { info: ext.note });
  renderPlanner();
  extClose();
  gcToast(ext.kind === 'weekend' ? 'Weekend hold updated.' : 'Possible extension updated.');
}

async function extDelete() {
  const ext = plannerBookings.find(b => b.id === extActiveId);
  if (!ext) return;
  const weekend = ext.kind === 'weekend';
  const ok = await gcConfirm({
    title: weekend ? `Release ${ext.plate} this weekend?` : 'Cancel this possible extension?',
    message: weekend ? `Only this weekend's hold is removed (${ext.pickupStr} → ${ext.dropoffStr}). The other weekends stay on hold.`
                     : `The hold on ${ext.plate} will be removed and the vehicle becomes available again.`,
    confirmText: weekend ? 'Release this weekend' : 'Cancel extension', cancelText: 'Keep it', danger: true
  });
  if (!ok) return;
  plannerLog(ext, 'Cancelled', `${weekend ? 'Weekend hold' : 'Possible extension'} removed: ${ext.pickupStr} → ${ext.dropoffStr}`);
  plannerBookings = plannerBookings.filter(b => b.id !== ext.id);
  plannerSaveExtensions();
  renderPlanner();
  extClose();
  gcToast(weekend ? `${ext.plate} released for this weekend.` : 'Possible extension cancelled.');
}

// Weekend Hold: remove este fim de semana e todos os seguintes da mesma série
async function extDeleteSeries() {
  const ext = plannerBookings.find(b => b.id === extActiveId);
  if (!ext || !ext.seriesId) return;
  const from = parseDateTime(ext.pickupStr);
  const targets = plannerBookings.filter(b => b.seriesId === ext.seriesId && parseDateTime(b.pickupStr) >= from);
  const ok = await gcConfirm({
    title: `Cancel ${targets.length} weekend hold${targets.length === 1 ? '' : 's'}?`,
    message: `${ext.plate} will no longer be held from ${fleetFormatDate(from)} onwards. Earlier weekends are kept.`,
    confirmText: 'Cancel all future holds', cancelText: 'Keep them', danger: true
  });
  if (!ok) return;
  const ids = new Set(targets.map(b => b.id));
  targets.forEach(t => plannerLog(t, 'Cancelled', `Weekend hold removed: ${t.pickupStr} → ${t.dropoffStr}`, { info: `Series ${ext.seriesId}: all future holds cancelled` }));
  plannerBookings = plannerBookings.filter(b => !ids.has(b.id));
  plannerSaveExtensions();
  renderPlanner();
  extClose();
  gcToast(`${targets.length} weekend hold${targets.length === 1 ? '' : 's'} cancelled for ${ext.plate}.`);
}

// ==========================================
// WEEKEND HOLD — segura o veículo escolhido todo fim de semana por X meses
// Padrão: sexta 17:00 → segunda 08:00 (dias e horários editáveis). Fim de semana em que
// o carro já tem reserva é pulado. Gravado como as Possible Extensions (kind 'weekend').
// ==========================================
const WKND_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekendPatternText(startMs, endMs) {
  const s = new Date(startMs), e = new Date(endMs);
  const t = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${WKND_DAYS[s.getDay()]} ${t(s)} → ${WKND_DAYS[e.getDay()]} ${t(e)}`;
}

// Fins de semana a partir de baseMs: [{ start, end, free }]
function weekendBuildPlan(plate, baseMs, cfg) {
  const today0 = startOfDay(Date.now());
  const first = new Date(startOfDay(baseMs));
  while (first.getDay() !== cfg.fromDay) first.setDate(first.getDate() + 1);
  const span = ((cfg.toDay - cfg.fromDay + 7) % 7) || 7;
  const limit = new Date(startOfDay(baseMs)); limit.setMonth(limit.getMonth() + cfg.months);
  const plan = [];
  for (let k = 0; k < 60; k++) {
    const s = new Date(first); s.setDate(s.getDate() + 7 * k); s.setHours(cfg.fromH, cfg.fromM, 0, 0);
    if (s.getTime() > limit.getTime()) break;
    const e = new Date(s); e.setDate(e.getDate() + span); e.setHours(cfg.toH, cfg.toM, 0, 0);
    if (e.getTime() <= s.getTime() || s.getTime() < today0) continue;
    plan.push({ start: s.getTime(), end: e.getTime(), free: !checkConflict(plate, s.getTime(), e.getTime(), null, true) }); // hold: sem intervalo
  }
  return plan;
}

function plannerWeekendHold() {
  const plate = pendingActionPlate;
  const veh = fleetGetVehicle(plate);
  if (!veh) return;
  const baseVal = document.getElementById('qa-start-date').value;
  const baseMs = baseVal ? new Date(baseVal).getTime() : Date.now();
  closeQuickActionModal();
  if (typeof repeatInjectStyles === 'function') repeatInjectStyles();

  const opt = (vals, sel, fmt) => vals.map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${fmt(v)}</option>`).join('');
  const hours = Array.from({ length: 24 }, (_, i) => i), mins = [0, 15, 30, 45];
  const pad = n => String(n).padStart(2, '0');
  const overlay = document.createElement('div');
  overlay.className = 'rp-overlay';
  overlay.innerHTML = `
    <div class="rp-dialog" role="dialog" aria-modal="true">
      <div class="rp-head">
        <div><h3>🗓️ Weekend Hold · ${plate}</h3><p>${veh.label} · ${FLEET_BRANCHES[veh.branch]} — keeps this vehicle off the website and allocations every weekend</p></div>
        <button type="button" class="rp-x" data-wk="no">✕</button>
      </div>
      <div class="rp-body">
        <div class="rp-pattern">
          <label><span>Hold from</span><span class="wk-row">
            <select data-wk="fromDay">${opt([5, 6], 5, d => WKND_DAYS[d])}</select>
            <select data-wk="fromH">${opt(hours, 17, pad)}</select>:<select data-wk="fromM">${opt(mins, 0, pad)}</select></span></label>
          <label><span>Until</span><span class="wk-row">
            <select data-wk="toDay">${opt([0, 1], 1, d => WKND_DAYS[d])}</select>
            <select data-wk="toH">${opt(hours, 8, pad)}</select>:<select data-wk="toM">${opt(mins, 0, pad)}</select></span></label>
          <label><span>Repeat for the next</span>
            <select data-wk="months">${opt(Array.from({ length: 12 }, (_, i) => i + 1), 6, m => `${m} month${m > 1 ? 's' : ''}`)}</select></label>
        </div>
        <div class="rp-summary" data-wk="summary"></div>
        <div class="rp-table-wrap">
          <table class="rp-table"><thead><tr><th>#</th><th>From</th><th>Until</th><th>Status</th></tr></thead><tbody data-wk="rows"></tbody></table>
        </div>
        <p class="rp-note">Weekends where ${plate} already has a booking are skipped. Each weekend can be released on its own later by clicking the hold in the Planner.</p>
      </div>
      <div class="rp-foot">
        <button type="button" class="rp-btn ghost" data-wk="no">Cancel</button>
        <button type="button" class="rp-btn primary" data-wk="yes">Create holds</button>
      </div>
    </div>`;

  const val = k => Number(overlay.querySelector(`[data-wk="${k}"]`).value);
  const fmt = ms => { const d = new Date(ms); return `${WKND_DAYS[d.getDay()].slice(0, 3)} ${pad(d.getDate())} ${BD_MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  let plan = [];
  const render = () => {
    const cfg = { fromDay: val('fromDay'), fromH: val('fromH'), fromM: val('fromM'), toDay: val('toDay'), toH: val('toH'), toM: val('toM'), months: val('months') };
    plan = weekendBuildPlan(plate, baseMs, cfg);
    const free = plan.filter(p => p.free).length;
    overlay.querySelector('[data-wk="summary"]').innerHTML = plan.length
      ? `<strong>${plan.length}</strong> weekends · <span class="rp-ok">${free} on hold</span>${plan.length - free ? ` · <span class="rp-warn">${plan.length - free} skipped (already booked)</span>` : ''}`
      : 'No weekends in this period.';
    overlay.querySelector('[data-wk="rows"]').innerHTML = plan.map((p, i) => `
      <tr class="${p.free ? '' : 'pending'}"><td>${i + 1}</td><td>${fmt(p.start)}</td><td>${fmt(p.end)}</td>
      <td>${p.free ? '<span class="rp-ok">Hold</span>' : '<span class="rp-warn">Already booked — skipped</span>'}</td></tr>`).join('');
    const btn = overlay.querySelector('[data-wk="yes"]');
    btn.disabled = !free;
    btn.textContent = free ? `Create ${free} weekend hold${free > 1 ? 's' : ''}` : 'Create holds';
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('change', render);
  overlay.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.wk;
    if (e.target === overlay || act === 'no') close();
    if (act === 'yes') {
      const free = plan.filter(p => p.free);
      if (!free.length) return;
      const seriesId = 'WH-' + Date.now().toString(36).toUpperCase();
      const base = Date.now();
      free.forEach((p, i) => {
        const hold = extToBooking({
          id: `bk-wh-${base}-${i}`, plate, startMs: p.start, endMs: p.end, kind: 'weekend', seriesId,
          note: 'Weekend hold — keep available for weekend demand.', createdBy: plannerAgentName(), createdAt: base
        });
        plannerBookings.push(hold);
        plannerLog(hold, 'Hold', `Weekend hold created: ${hold.pickupStr} → ${hold.dropoffStr}`, { info: `Series ${seriesId} (${i + 1} of ${free.length})` });
      });
      plannerSaveExtensions();
      renderPlanner();
      close();
      gcToast(`${free.length} weekend hold${free.length > 1 ? 's' : ''} created for ${plate}` +
        (plan.length - free.length ? `\n\n${plan.length - free.length} weekend(s) skipped because the vehicle is already booked.` : ''));
    }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  render();
}

// ==========================================
// FULL RESET FUNCTION (ENGLISH)
// ==========================================
async function clearAllBookings() {
  const ok = await gcConfirm({
    title: 'Delete all bookings?',
    message: 'This clears every booking created in the Planner, the website and the portal, and all possible extensions. Demo bookings go back to their original state. This cannot be undone.',
    confirmText: 'Delete all', danger: true
  });
  if (ok) {
    let keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      let key = localStorage.key(i);
      if (key && (
          key.startsWith('gc_multi_bookings_') ||
          key.startsWith('gc_booking_poc_') ||
          key === 'gc_unavailable_requests' ||
          key === 'gc_active_proposal' ||
          key === FLEET_SEED_OVERRIDES_KEY ||
          key === FLEET_EXT_KEY ||
          key === FLEET_LOG_KEY
      )) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    gcFlash('Planner cleared\n\nAll created bookings were deleted.');
    window.location.reload();
  }
}

window.addEventListener('DOMContentLoaded', initFleetPlanner);
