// ==========================================
// ALLOCATE RESERVATION + VEHICLE ALLOCATION (AVAILABILITY ENGINE)
// Agent Dashboard → Agent Requests → "Allocate Reservations"
// Lista as reservas sem veículo (status 'fleet_pending') e as ofertas enviadas
// ('proposal_sent'), e cruza com a ocupação REAL do Fleet Planner
// (fleetGetOccupancy em gc-fleet-data.js) para mostrar o que está livre.
// Mesmo modelo e datas → aloca direto. Outro modelo ou datas → vira oferta
// para o cliente aceitar em My Bookings (e aviso no chat do booking).
// Depende de: gc-fleet-data.js, gc-chat.js, gc-payments.js (ppToast).
// ==========================================
let alCurrent = null; // { email, id } da reserva aberta no engine/notas

// ---------- Helpers ----------
function alBranchCode(loc) {
  return Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === loc) || '—';
}

function alWhen(ms) {
  return isNaN(ms) ? '—' : `${fleetFormatDate(ms)} ${fleetFormatTime(ms)}`;
}

function alToLocalInput(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function alEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function alAgent() {
  return typeof getAgentName === 'function' ? getAgentName() : 'Agent';
}

function alLoad(email, id) {
  const key = FLEET_MULTI_PREFIX + email;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  const b = list.find(x => String(x.id) === String(id)) || null;
  return { key, list, b };
}

function alSave(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

function alRemoveRequest(id) {
  let reqs = [];
  try { reqs = JSON.parse(localStorage.getItem(FLEET_REQUESTS_KEY) || '[]'); } catch (e) {}
  localStorage.setItem(FLEET_REQUESTS_KEY, JSON.stringify(reqs.filter(r => String(r.id) !== String(id))));
}

function alPushNote(b, text, subject) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  if (!b.notesList) b.notesList = [];
  b.notesList.push({
    id: Date.now(), priority: 'Medium', status: 'Active', subject: subject || 'Allocation', text,
    dateStr: `${pad(d.getDate())}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    author: alAgent()
  });
}

// Mensagem no chat do booking (mesmo sessionId email_ref usado no resto do sistema)
function alNotifyCustomer(b, email, text) {
  if (typeof ensureChatSession !== 'function') return;
  const sessionId = `${email}_${b.ref}`;
  ensureChatSession(sessionId, email, `${b.fname || ''} ${b.lname || ''}`.trim() || email, b.ref, b.date || 'N/A', b.plate || 'Pending allocation');
  sendChatMessage(sessionId, 'agent', alAgent(), text, { notice: true }); // aviso: não "pega" o chat
}

function alRefreshDashboard() {
  renderAllocationTable();
  if (typeof loadUpcomingBookings === 'function') loadUpcomingBookings();
  if (typeof loadGlobalBookingStatus === 'function') loadGlobalBookingStatus();
}

// ---------- Tabela "Allocate Reservation" ----------
function alInitFilters() {
  const loc = document.getElementById('al-f-location');
  if (loc.options.length) return;
  loc.innerHTML = '<option value="ALL">All Locations</option>' +
    Object.entries(FLEET_BRANCHES).map(([code, name]) => `<option value="${code}">${fleetBranchLabel(name)}</option>`).join('');
  document.getElementById('al-f-category').innerHTML = '<option value="ALL">All Category</option>' +
    FLEET_CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const today = new Date();
  const from = new Date(today); from.setDate(from.getDate() - 7);
  const to = new Date(today); to.setDate(to.getDate() + 90);
  document.getElementById('al-f-from').value = alToLocalInput(from.getTime()).slice(0, 10);
  document.getElementById('al-f-to').value = alToLocalInput(to.getTime()).slice(0, 10);
}

function alCollectRows() {
  const rows = [];
  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    const declined = b.status === 'cancelled' && b.declinedBy;
    if (b.status !== 'fleet_pending' && b.status !== 'proposal_sent' && !declined) return;
    rows.push({ b, email, range: fleetBookingRange(b), cat: fleetFindCategoryByModel(b.vehicle) });
  }));
  return rows.sort((x, y) => x.range.start - y.range.start);
}

function renderAllocationTable() {
  const body = document.getElementById('al-table-body');
  if (!body) return;
  alInitFilters();

  const all = alCollectRows();
  const pendingCount = all.filter(r => r.b.status === 'fleet_pending').length;
  document.getElementById('al-tab-count').textContent = pendingCount ? pendingCount : '';

  const fLoc = document.getElementById('al-f-location').value;
  const fCat = document.getElementById('al-f-category').value;
  const fFrom = document.getElementById('al-f-from').value;
  const fTo = document.getElementById('al-f-to').value;
  const fSearch = document.getElementById('al-f-search').value.trim().toLowerCase();
  const withOffers = document.getElementById('al-f-offers').checked;
  const withDeclined = document.getElementById('al-f-cancelled').checked;
  const fromMs = fFrom ? new Date(fFrom + 'T00:00').getTime() : -Infinity;
  const toMs = fTo ? new Date(fTo + 'T23:59').getTime() : Infinity;

  const rows = all.filter(r => {
    if (r.b.status === 'proposal_sent' && !withOffers) return false;
    if (r.b.status === 'cancelled' && !withDeclined) return false;
    if (fLoc !== 'ALL' && alBranchCode(r.b.loc) !== fLoc) return false;
    if (fCat !== 'ALL' && (!r.cat || r.cat.id !== fCat)) return false;
    if (r.range.start < fromMs || r.range.start > toMs) return false;
    if (fSearch && ![r.b.ref, r.b.fname, r.b.lname, r.email, r.b.vehicle].some(v => (v || '').toLowerCase().includes(fSearch))) return false;
    return true;
  });

  document.getElementById('al-count').textContent = `Showing ${rows.length} of ${all.length} entries · ${pendingCount} waiting for a vehicle`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="16" class="al-empty">✓ No reservations waiting for allocation.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r, i) => {
    const b = r.b;
    const days = Math.max(1, Math.ceil((r.range.end - r.range.start) / FLEET_DAY_MS));
    const total = typeof feeBookingMoney === 'function' ? `$${feeBookingMoney(b, r.cat).grand.toFixed(2)}`
      : b.priceTotal ? `$${b.priceTotal.toFixed(2)}` : (r.cat ? `~$${(r.cat.rate * days).toFixed(2)}` : '—');
    const dropLoc = b.dropoff && b.dropoff !== 'Same as Pick up' ? b.dropoff : b.loc;
    const entered = isNaN(Number(b.id)) ? '—' : fleetFormatDate(Number(b.id));
    const enteredBy = b.source === 'Direct Website' ? 'Online Booking' : (b.createdBy || 'Agent');
    const notes = (b.notesList || []).length;
    const type = b.status === 'fleet_pending' ? '<span class="pp-pill due">On Request</span>'
               : b.status === 'proposal_sent' ? '<span class="pp-pill soon">Offer Sent</span>'
               : '<span class="pp-pill cancelled">Declined</span>';
    const active = b.status !== 'cancelled';
    const args = `'${r.email}', '${b.id}'`;

    return `
      <tr class="${b.status === 'cancelled' ? 'al-row-declined' : ''}">
        <td>${i + 1}</td>
        <td class="al-res">${b.ref}</td>
        <td>${type}</td>
        <td>${active ? `<button class="pp-btn small" onclick="alAutoAllocate(${args})">AUTO Allocate</button>` : ''}</td>
        <td>${active ? `<button class="pp-btn small primary" onclick="alOpenEngine(${args})">Allocate Vehicle</button>` : ''}</td>
        <td><button class="pp-btn small ghost" onclick="alOpenNotes(${args})">${notes ? `View (${notes})` : 'Add'}</button></td>
        <td><strong>${b.fname || ''} ${b.lname || ''}</strong><div class="pp-sub">${r.email}</div>
          ${b.optionsSent ? `<div class="pp-sub al-options-sent">✓ Options sent by ${b.optionsSent.channel} · ${alWhen(b.optionsSent.at)} · ${b.optionsSent.by}</div>` : ''}
          ${active && b.status === 'fleet_pending' && typeof annaDraftNoVehicle === 'function' ? `<button type="button" class="anna-link-btn al-anna-btn" onclick="annaDraftNoVehicle(${args})" title="Concept: Anna finds what you can offer and drafts the message">✦ ${b.optionsSent ? 'Message again' : 'Message options'}</button>` : ''}</td>
        <td>${r.cat ? r.cat.name : b.vehicle}${b.status === 'proposal_sent' && b.proposal ? `<div class="pp-sub">Offered: ${b.proposal.newVehicle}</div>` : ''}
          ${b.altPreference ? `<div class="al-pref${b.altPreference.onlyThis ? ' only' : ''}" title="${b.altPreference.note ? 'Customer note: ' + alEsc(b.altPreference.note) : 'Set by the customer in My Bookings'}">★ ${b.altPreference.onlyThis ? 'Only this vehicle' : 'Prefers: ' + alEsc(fleetAltPreferenceText(b.altPreference))}</div>` : ''}</td>
        <td>${alBranchCode(b.loc)}</td>
        <td>${alWhen(r.range.start)}</td>
        <td>${alBranchCode(dropLoc)}</td>
        <td>${alWhen(r.range.end)}</td>
        <td>${entered}</td>
        <td>${enteredBy}</td>
        <td class="al-total">${total}</td>
        <td>${active ? `<button class="pp-btn small ghost danger" onclick="alDecline(${args}, this)">Decline</button>` : `<span class="pp-sub">by ${b.declinedBy}</span>`}</td>
      </tr>`;
  }).join('');
}

// ---------- Demo: reserva online que chegou sem veículo disponível ----------
// Cria uma reserva do site (cliente de demonstração do portal, felipe@testgctech.com) com status
// fleet_pending e coloca na fila de Agent Requests, para mostrar o fluxo: alocar, ou enviar uma
// oferta alternativa que o cliente aceita em My Bookings.
function alCreateDemoRequest() {
  const email = 'felipe@testgctech.com';
  const cat = fleetGetCategory('pantech');
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1); end.setHours(17, 0, 0, 0);
  const days = Math.max(1, Math.ceil((end - start) / FLEET_DAY_MS));

  const used = new Set();
  fleetForEachStoredBooking(list => list.forEach(b => used.add(b.ref)));
  let ref;
  do { ref = 'OR-' + (10000 + Math.floor(Math.random() * 90000)); } while (used.has(ref));

  const bk = {
    id: Date.now(), ref, vehicle: cat.model, plate: null,
    fname: 'Felipe', lname: 'Grigolli', phone: '0412 345 678',
    loc: FLEET_BRANCHES.MAS, dropoff: 'Same as Pick up', source: 'Direct Website',
    excessOption: 'standard', extras: { childSeat: 0, booster: 0 },
    priceTotal: Math.round(cat.rate * days * 100) / 100, amountPaid: 0, paymentStatus: 'not_charged',
    status: 'fleet_pending',
    notesList: [{ id: Date.now(), priority: 'High', status: 'Active', subject: 'Online booking',
                  text: `Booked online while no ${cat.model} was available for these dates. The customer has not been charged — allocate a vehicle or send an alternative offer.`,
                  dateStr: fleetNoteDateStr(Date.now()), author: 'Website' }]
  };
  fleetApplyRange(bk, start.getTime(), end.getTime());

  const key = FLEET_MULTI_PREFIX + email;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  list.unshift(bk);
  localStorage.setItem(key, JSON.stringify(list));
  fleetLog({ bookingId: bk.id, ref, operator: 'Online Booking', action: '',
    details: `Booking entered webApi3, ${fleetLogTripText(cat.name, '', 'MAS', start.getTime(), 'MAS', end.getTime())}, Rate = ${days} days x $${cat.rate.toFixed(2)}`,
    info: 'No CC entered, saved as quote.', total: bk.priceTotal });
  fleetSendToAgentRequests(bk, email, 'Felipe Grigolli', `No ${cat.name} available for the requested dates`);

  // Mostra na tabela: limpa a busca e destaca a linha nova
  const search = document.getElementById('al-f-search');
  if (search) search.value = '';
  alRefreshDashboard();
  const row = Array.from(document.querySelectorAll('#al-table-body tr')).find(tr => (tr.querySelector('.al-res') || {}).textContent === ref);
  if (row) { row.classList.add('al-row-new'); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (typeof gcToast === 'function') gcToast(`New online booking ${ref} — no ${cat.model} available\n\nIt is now in Agent Requests. Allocate a vehicle, send an alternative offer, or use "✦ Message options" and Anna drafts a WhatsApp or email with what you can offer.`, 'warning');
}

// ---------- AUTO Allocate ----------
// Primeiro carro livre da categoria pedida, preferindo os que ficam na filial de retirada
function alBestPlate(cat, start, end, pickupCode, occ) {
  const free = FLEET_VEHICLES
    .filter(v => v.categoryId === cat.id && fleetIsPlateFree(v.plate, start, end, null, occ))
    .sort((a, b) => (b.branch === pickupCode) - (a.branch === pickupCode));
  return free[0] || null;
}

function alAutoAllocate(email, id) {
  const { b } = alLoad(email, id);
  if (!b) return;
  const cat = fleetFindCategoryByModel(b.vehicle);
  const r = fleetBookingRange(b);
  const best = cat ? alBestPlate(cat, r.start, r.end, alBranchCode(b.loc), fleetGetOccupancy()) : null;
  if (!best) {
    const pref = b.altPreference ? ` The customer prefers: ${fleetAltPreferenceText(b.altPreference)}.` : '';
    ppToast(`No ${cat ? cat.name : b.vehicle} is free for these dates — use "Allocate Vehicle" to offer an alternative.${pref}`, true);
    return;
  }
  alAllocate(email, id, best.plate, false);
}

// ---------- Alocar (mesmo modelo e datas) ----------
function alAllocate(email, id, plate, openPlanner) {
  const { key, list, b } = alLoad(email, id);
  if (!b) return;
  const r = fleetBookingRange(b);
  if (!fleetIsPlateFree(plate, r.start, r.end, b.id)) {
    ppToast(`${plate} was just taken — please pick another vehicle.`, true);
    alRenderEngine();
    return;
  }
  const veh = fleetGetVehicle(plate);
  b.plate = plate;
  b.status = 'confirmed';
  b.proposal = null;
  b.allocatedBy = alAgent();
  b.allocatedAt = new Date().toISOString();
  alPushNote(b, `Allocated to ${plate} (${veh.label}, ${veh.branch}) by ${alAgent()}.`);
  alSave(key, list);
  fleetLog({ bookingId: b.id, ref: b.ref, plate, operator: alAgent(), action: 'Allocated',
    details: `Booking allocated to ${plate} (${veh.label}, ${veh.branch}) from Agent Requests`, info: 'Booking confirmed, customer notified' });
  alRemoveRequest(b.id);

  alNotifyCustomer(b, email, `Good news! A ${b.vehicle} has been allocated to your booking ${b.ref}. Pick-up: ${fleetBranchLabel(b.loc)}, ${alWhen(r.start)}. Your booking is now confirmed.`);
  alCloseEngine();
  alRefreshDashboard();
  ppToast(`${b.ref} allocated to ${plate} and confirmed.`);

  if (openPlanner) {
    localStorage.setItem('gc_planner_filters', JSON.stringify({ branch: 'ALL', section: 'ALL', category: veh.categoryId, search: plate }));
    window.location.href = 'gc-fleet-planner.html';
  }
}

// ---------- Oferecer alternativa (outro modelo e/ou outras datas) ----------
function alOffer(email, id, plate) {
  const { key, list, b } = alLoad(email, id);
  if (!b) return;
  const { start, end } = alReadEngineRange();
  if (!fleetIsPlateFree(plate, start, end, b.id)) {
    ppToast(`${plate} was just taken — please pick another vehicle.`, true);
    alRenderEngine();
    return;
  }
  const veh = fleetGetVehicle(plate);
  b.status = 'proposal_sent';
  b.proposal = {
    newVehicle: veh.model,
    newTime: `${fleetFormatDate(start)} at ${fleetFormatTime(start)}`,
    newDropoffISO: new Date(end).toISOString(),
    offeredPlate: plate,
    handledBy: alAgent()
  };
  alPushNote(b, `Offer sent: ${veh.model} (${plate}) ${alWhen(start)} → ${alWhen(end)}.`, 'Offer');
  alSave(key, list);
  fleetLog({ bookingId: b.id, ref: b.ref, plate, operator: alAgent(), action: 'Offer',
    details: `Alternative offered: ${veh.model} (${plate}) ${fleetNoteDateStr(start)} to ${fleetNoteDateStr(end)}`, info: 'Waiting for the customer to accept' });
  alRemoveRequest(b.id);

  alNotifyCustomer(b, email, `Hi ${b.fname || ''}, the ${b.vehicle} you requested isn't available for booking ${b.ref}. We can offer a ${veh.model} — pick-up ${alWhen(start)}, return ${alWhen(end)}. Please review and accept the offer in My Bookings.`);
  // Também por WhatsApp (via 3CX), modelo aprovado "Alternative vehicle offer"
  const waSent = typeof waSend === 'function' && b.phone
    ? waSend({ phone: b.phone, bookingId: b.id, template: 'vehicle_offer', vars: { requested: b.vehicle, offer: veh.model }, silent: true, noReply: true })
    : null;
  alCloseEngine();
  alRefreshDashboard();
  ppToast(`Offer sent to ${b.fname || email} (${veh.model})${waSent ? ' · also by WhatsApp' : ''}.`);
}

// ---------- Recusar ----------
function alDecline(email, id, btn) {
  if (btn.dataset.confirm !== 'yes') {
    btn.dataset.confirm = 'yes';
    btn.textContent = 'Confirm?';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Decline'; }, 3000);
    return;
  }
  const { key, list, b } = alLoad(email, id);
  if (!b) return;
  b.status = 'cancelled';
  b.declinedBy = alAgent();
  b.proposal = null;
  alPushNote(b, `Request declined by ${alAgent()} — no suitable vehicle.`, 'Declined');
  alSave(key, list);
  fleetLog({ bookingId: b.id, ref: b.ref, operator: alAgent(), action: 'Cancelled', details: 'Request declined - no suitable vehicle', info: 'Customer notified, not charged' });
  alRemoveRequest(b.id);
  alNotifyCustomer(b, email, `Hi ${b.fname || ''}, unfortunately we couldn't find a vehicle for booking ${b.ref} on those dates, so the request has been closed and you have not been charged. Reply here if you'd like help with other dates.`);
  alRefreshDashboard();
  ppToast(`${b.ref} declined.`, true);
}

// ---------- Availability Engine ----------
function alOpenEngine(email, id) {
  const { b } = alLoad(email, id);
  if (!b) return;
  alCurrent = { email, id: String(id) };
  const cat = fleetFindCategoryByModel(b.vehicle);

  let opts = '';
  ['Passenger', 'Commercial'].forEach(section => {
    opts += `<optgroup label="${section}">` + FLEET_CATEGORIES.filter(c => c.section === section)
      .map(c => `<option value="${c.id}">${c.name}${cat && c.id === cat.id ? ' (requested)' : ''}</option>`).join('') + '</optgroup>';
  });
  document.getElementById('al-e-category').innerHTML = opts;
  alResetEngineSearch();
  document.getElementById('al-engine').classList.add('open');
}

function alCloseEngine() {
  document.getElementById('al-engine').classList.remove('open');
}

// Volta categoria e datas para as da reserva
function alResetEngineSearch() {
  const { b } = alLoad(alCurrent.email, alCurrent.id);
  if (!b) return;
  const cat = fleetFindCategoryByModel(b.vehicle);
  const r = fleetBookingRange(b);
  document.getElementById('al-e-category').value = cat ? cat.id : FLEET_CATEGORIES[0].id;
  document.getElementById('al-e-rego').value = '';
  document.getElementById('al-e-pickup').value = alToLocalInput(r.start);
  document.getElementById('al-e-dropoff').value = alToLocalInput(r.end);
  document.getElementById('al-e-unavailable').checked = false;
  alRenderEngine();
}

function alReadEngineRange() {
  return {
    start: new Date(document.getElementById('al-e-pickup').value).getTime(),
    end: new Date(document.getElementById('al-e-dropoff').value).getTime()
  };
}

function alRenderEngine() {
  if (!alCurrent) return;
  const { b } = alLoad(alCurrent.email, alCurrent.id);
  if (!b) return;
  const requestedCat = fleetFindCategoryByModel(b.vehicle);
  const original = fleetBookingRange(b);
  const catId = document.getElementById('al-e-category').value;
  const rego = document.getElementById('al-e-rego').value.trim().toUpperCase();
  const showUnavailable = document.getElementById('al-e-unavailable').checked;
  const { start, end } = alReadEngineRange();
  const pickupCode = alBranchCode(b.loc);
  const dropLoc = b.dropoff && b.dropoff !== 'Same as Pick up' ? b.dropoff : b.loc;

  document.getElementById('al-e-booking').innerHTML =
    `Booking #${b.ref}, ${requestedCat ? requestedCat.name : b.vehicle}, PICKUP: <strong>${pickupCode} ${alWhen(original.start)}</strong>, DROPOFF: <strong>${alBranchCode(dropLoc)} ${alWhen(original.end)}</strong>
     <div class="pp-sub">${b.fname || ''} ${b.lname || ''} · ${alCurrent.email}</div>` + alPreferenceBox(b, original);

  const noteEl = document.getElementById('al-e-note');
  const body = document.getElementById('al-e-body');
  const validRange = !isNaN(start) && !isNaN(end) && end > start;
  const validHours = validRange && fleetIsValidBookingTime(start) && fleetIsValidBookingTime(end);
  if (!validRange || !validHours) {
    noteEl.className = 'al-engine-note err';
    noteEl.textContent = !validRange ? 'Dropoff must be after pickup.' : FLEET_HOURS_MESSAGE;
    body.innerHTML = '';
    document.getElementById('al-e-count').textContent = '';
    return;
  }

  const datesChanged = start !== original.start || end !== original.end;
  const occ = fleetGetOccupancy().filter(o => o.id !== String(b.id));

  const vehicles = (rego ? FLEET_VEHICLES.filter(v => v.plate.includes(rego)) : FLEET_VEHICLES.filter(v => v.categoryId === catId))
    .map(v => {
      const onPlate = occ.filter(o => o.plate === v.plate);
      const clash = onPlate.find(o => fleetTimesClash(o.start, o.end, start, end, o.ref === 'POSS-EXT'));
      const last = onPlate.filter(o => o.end <= start).sort((a, c) => c.end - a.end)[0];
      const next = onPlate.filter(o => o.start >= end).sort((a, c) => a.start - c.start)[0];
      return { v, cat: fleetGetCategory(v.categoryId), clash, last, next, here: v.branch === pickupCode };
    })
    .sort((x, y) => (!x.clash - !y.clash) * -1 || (y.here - x.here) || ((y.last ? y.last.end : 0) - (x.last ? x.last.end : 0)));

  const shown = vehicles.filter(x => showUnavailable || !x.clash);
  const freeCount = vehicles.filter(x => !x.clash).length;
  const anyOffer = datesChanged || (!rego && requestedCat && catId !== requestedCat.id);
  noteEl.className = `al-engine-note ${anyOffer ? 'offer' : 'ok'}`;
  noteEl.innerHTML = anyOffer
    ? '<strong>Offer mode:</strong> different category or dates — the customer will receive an offer to accept in My Bookings (and a message in the booking chat).'
    : rego
      ? '<strong>Rego search:</strong> vehicles of the requested category allocate directly; other categories become an offer to the customer.'
      : '<strong>Same category & dates:</strong> allocating confirms the booking straight away.';

  document.getElementById('al-e-count').textContent = `${freeCount} of ${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} available for ${alWhen(start)} → ${alWhen(end)}`;
  if (!shown.length) {
    body.innerHTML = `<tr><td colspan="10" class="al-empty">No vehicles available — try another category, other dates or tick "Show unavailable".</td></tr>`;
    return;
  }

  const args = `'${alCurrent.email}', '${alCurrent.id}'`;
  body.innerHTML = shown.map((x, i) => {
    const isOffer = datesChanged || !requestedCat || x.v.categoryId !== requestedCat.id;
    let actions = ['', ''];
    if (!x.clash) {
      actions = isOffer
        ? [`<button class="pp-btn small primary" onclick="alOffer(${args}, '${x.v.plate}')">Offer to customer</button>`, '']
        : [`<button class="pp-btn small" onclick="alAllocate(${args}, '${x.v.plate}', true)">Allocate & Update</button>`,
           `<button class="pp-btn small primary" onclick="alAllocate(${args}, '${x.v.plate}', false)">Quick Allocate</button>`];
    }
    return `
      <tr class="${x.clash ? 'al-row-busy' : ''}">
        <td>${i + 1}</td>
        <td>${x.cat.name}</td>
        <td>${x.v.label}</td>
        <td class="al-rego">${x.v.plate}</td>
        <td>${x.v.branch}${x.here ? ' <span class="al-here">pickup branch</span>' : ''}</td>
        <td>${x.last ? `${x.v.branch} ${alWhen(x.last.end)}` : '<span class="pp-sub">—</span>'}</td>
        <td>${x.next ? `${x.v.branch} ${alWhen(x.next.start)}` : '<span class="pp-sub">—</span>'}</td>
        <td>${x.clash ? `<span class="pp-pill overdue">Booked · ${x.clash.ref || 'hold'}</span>` : '<span class="pp-pill ok">Available</span>'}</td>
        <td>${actions[0]}</td>
        <td>${actions[1]}</td>
      </tr>`;
  }).join('');
}

// Escolha do cliente (My Bookings) para quando o veículo reservado não está livre:
// cada opção com quantos carros estão livres nas datas da reserva e um atalho para listá-los
function alPreferenceBox(b, range) {
  const pref = b.altPreference;
  if (!pref) return `<div class="al-pref-box none">The customer hasn't chosen a back-up vehicle in My Bookings.</div>`;
  const note = pref.note ? `<div class="al-pref-note">Customer note: “${alEsc(pref.note)}”</div>` : '';
  if (pref.onlyThis) {
    return `<div class="al-pref-box only"><strong>★ Customer preference:</strong> only the ${alEsc(b.vehicle)} — don't offer another vehicle. If none is free, contact the customer about other dates.${note}</div>`;
  }
  const occ = fleetGetOccupancy().filter(o => o.id !== String(b.id));
  const choices = fleetAltPreferenceChoices(pref).map((c, i) => {
    const free = FLEET_VEHICLES.filter(v => v.categoryId === c.id && fleetIsPlateFree(v.plate, range.start, range.end, null, occ)).length;
    return `<span class="al-pref-choice">${i ? '2nd' : '1st'} · <strong>${alEsc(c.model)}</strong>
      <span class="pp-pill ${free ? 'ok' : 'overdue'}">${free ? `${free} free` : 'none free'}</span>
      <button type="button" class="pp-btn small" onclick="alShowCategory('${c.id}')">Show</button></span>`;
  }).join('');
  return `<div class="al-pref-box"><strong>★ Customer's back-up choice</strong> (if the ${alEsc(b.vehicle)} isn't available):<div class="al-pref-choices">${choices}</div>${note}</div>`;
}

// Atalho da escolha do cliente: lista os veículos daquela categoria nas datas da reserva
function alShowCategory(catId) {
  const { b } = alLoad(alCurrent.email, alCurrent.id);
  if (!b) return;
  const r = fleetBookingRange(b);
  document.getElementById('al-e-category').value = catId;
  document.getElementById('al-e-rego').value = '';
  document.getElementById('al-e-pickup').value = alToLocalInput(r.start);
  document.getElementById('al-e-dropoff').value = alToLocalInput(r.end);
  alRenderEngine();
}

// ---------- Notas ----------
function alOpenNotes(email, id) {
  alCurrent = { email, id: String(id) };
  alRenderNotes();
  document.getElementById('al-notes').classList.add('open');
}

function alCloseNotes() {
  document.getElementById('al-notes').classList.remove('open');
}

function alRenderNotes() {
  const { b } = alLoad(alCurrent.email, alCurrent.id);
  if (!b) return;
  document.getElementById('al-notes-title').textContent = `Notes · ${b.ref} · ${b.fname || ''} ${b.lname || ''}`;
  const notes = (b.notesList || []).slice().reverse();
  document.getElementById('al-notes-list').innerHTML = notes.length
    ? notes.map(n => `<div class="pp-note"><small>${n.dateStr} · ${n.author}${n.subject && n.subject !== '-' ? ' · ' + n.subject : ''}</small>${n.text}</div>`).join('')
    : '<div class="pp-empty">No notes yet.</div>';
  document.getElementById('al-notes-input').value = '';
}

function alAddNote() {
  const text = document.getElementById('al-notes-input').value.trim();
  if (!text) return;
  const { key, list, b } = alLoad(alCurrent.email, alCurrent.id);
  if (!b) return;
  alPushNote(b, text, 'Note');
  alSave(key, list);
  alRenderNotes();
  renderAllocationTable();
}
