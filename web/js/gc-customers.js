let allCustomers = [];

// 1. CARREGAR DADOS DO SISTEMA E AGRUPAR POR CLIENTE
function loadCustomersFromStorage() {
  const customerMap = {}; 

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    
    // Ler as reservas normais (Multi-bookings)
    if (key && key.startsWith('gc_multi_bookings_')) {
      const email = key.replace('gc_multi_bookings_', '').toLowerCase();
      try {
        const bookings = JSON.parse(localStorage.getItem(key) || '[]');
        bookings.forEach(b => {
          
          // Lógica inteligente para extrair o nome (Evita hardcodes)
          let rawName = b.name || b.fullName || b.fname || '';
          let fName = rawName;
          let lName = b.lname || '';

          if (rawName.includes(' ') && !lName) {
            let parts = rawName.split(' ');
            fName = parts[0];
            lName = parts.slice(1).join(' ');
          }

          // Se não houver nome, usa a primeira parte do email
          if (!fName && !lName) fName = email.split('@')[0];

          if (!customerMap[email]) {
            customerMap[email] = {
              email: email,
              fname: fName,
              lname: lName,
              phone: b.phone || '+61 400 000 000',
              bookings: []
            };
          } else {
             // Atualiza se o nome atual for melhor que o gravado anteriormente
             if (fName && fName !== email.split('@')[0] && customerMap[email].fname === email.split('@')[0]) {
                customerMap[email].fname = fName;
                customerMap[email].lname = lName;
             }
          }

          customerMap[email].bookings.push({
            id: String(b.id), plannerId: b.plate && !FLEET_NON_HOLDING_STATUSES.includes(b.status) ? String(b.id) : null,
            plate: b.plate || '',
            ref: b.ref || 'N/A',
            referenceNo: (b.details && b.details.referenceNo) || '',
            vehicle: b.vehicle || 'Standard Vehicle',
            pickup: b.date || b.pickupStr || 'Unknown Schedule',
            status: b.plannerType === 'returned' ? 'returned' : (b.status === 'confirmed' && b.plannerType === 'hired' ? 'hired' : (b.status || 'confirmed'))
          });
        });
      } catch (e) {}
    }

    // Ler a reserva principal POC
    if (key && key.startsWith('gc_booking_poc_')) {
      const email = key.replace('gc_booking_poc_', '').toLowerCase();
      try {
        const state = JSON.parse(localStorage.getItem(key) || '{}');
        if (state && Object.keys(state).length > 0) {
          
          let rawName = state.name || state.fullName || state.fname || '';
          let fName = rawName;
          let lName = state.lname || '';
          
          if (rawName.includes(' ') && !lName) {
            let parts = rawName.split(' ');
            fName = parts[0];
            lName = parts.slice(1).join(' ');
          }

          if (!fName && !lName) fName = email.split('@')[0];

          if (!customerMap[email]) {
            customerMap[email] = {
              email: email,
              fname: fName,
              lname: lName, 
              phone: state.phone || '+61 412 345 678',
              bookings: []
            };
          } else {
             if (fName && fName !== email.split('@')[0]) {
                customerMap[email].fname = fName;
                if(lName) customerMap[email].lname = lName;
             }
          }

          customerMap[email].bookings.push({
            id: 'main-' + email, plannerId: state.status === 'cancelled' ? null : 'main-' + email, plate: FLEET_MAIN_BOOKING_PLATE,
            ref: 'GC-8832',
            vehicle: 'Auto Pantech Truck',
            pickup: state.pickupTime || fleetMainDefaultPickup(),
            status: state.status || 'confirmed'
          });
        }
      } catch(e){}
    }
  }

  // Tentar ler o Perfil Global do Utilizador (Onde o registo fica gravado)
  try {
    const currentUser = JSON.parse(localStorage.getItem('gc_user_profile'));
    if (currentUser && currentUser.email) {
       const e = currentUser.email.toLowerCase();
       if (customerMap[e]) {
          let full = currentUser.name || '';
          if (full) {
             if (full.includes(' ')) {
                customerMap[e].fname = full.split(' ')[0];
                customerMap[e].lname = full.split(' ').slice(1).join(' ');
             } else {
                customerMap[e].fname = full;
                customerMap[e].lname = ''; // Limpa o apelido se for nome único (ex: "berry")
             }
          }
       }
    }
  } catch(e) {}

  addFleetBookings(customerMap);

  // Converter o Map num Array e ordenar por ordem alfabética
  allCustomers = Object.values(customerMap).sort((a, b) => a.fname.localeCompare(b.fname));
}

// Bookings que não estão no localStorage: os fixos do Fleet Planner (gc-fleet-data.js)
// e os devolvidos do Bond Refunds (gc-bonds.js). Assim qualquer RA do sistema é encontrado.
function addFleetBookings(customerMap) {
  const add = (email, fname, lname, booking) => {
    email = (email || '').toLowerCase();
    if (!email) return;
    if (!customerMap[email]) customerMap[email] = { email, fname, lname, phone: '+61 400 000 000', bookings: [] };
    if (customerMap[email].bookings.some(b => b.ref === booking.ref)) return; // já veio do localStorage
    customerMap[email].bookings.push(booking);
  };
  const when = ms => `${fleetFormatDate(ms)} ${fleetFormatTime(ms)}`;

  if (typeof fleetSeedBookings === 'function') {
    fleetSeedBookings().filter(s => s.type !== 'maintenance').forEach(s => {
      const veh = fleetGetVehicle(s.plate);
      add(s.clientEmail, s.fname, s.lname, {
        id: s.id, plannerId: s.id, plate: s.plate,
        ref: s.ref, referenceNo: '', vehicle: veh ? veh.model : 'Standard Vehicle',
        pickup: when(s.startMs), status: s.type === 'reservation' ? 'confirmed' : s.type
      });
    });
  }
  if (typeof bondAllRecords === 'function') {
    bondAllRecords().forEach(r => {
      const cat = fleetGetCategory(r.categoryId);
      add(r.email, r.fname, r.lname, {
        id: r.id, plannerId: null, plate: r.plate || '',
        ref: r.ref, referenceNo: '', vehicle: cat ? cat.model : 'Standard Vehicle',
        pickup: when(r.pickupMs), status: 'returned'
      });
    });
  }
}

// "GC-8832", "#495100", "ra 495100" → só letras e números, minúsculo
function normalizeRef(s) {
  return String(s || '').toLowerCase().replace(/^ra\s*/, '').replace(/[^a-z0-9]/g, '');
}

// Bookings do cliente cujo RA / Res # (ou Reference No da agência) bate com a busca
function matchingBookings(customer, term) {
  const t = normalizeRef(term);
  if (t.length < 3) return [];
  return customer.bookings.filter(b => normalizeRef(b.ref).includes(t) || (b.referenceNo && normalizeRef(b.referenceNo).includes(t)));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 2. RENDERIZAR A LISTA DA ESQUERDA (Com Filtro)
function renderCustomerList(filterText = '') {
  const listEl = document.getElementById('customer-list');
  listEl.innerHTML = '';

  const term = filterText.toLowerCase().trim();

  const filtered = allCustomers.filter(c =>
    c.email.toLowerCase().includes(term) ||
    c.lname.toLowerCase().includes(term) ||
    c.fname.toLowerCase().includes(term) ||
    `${c.fname} ${c.lname}`.toLowerCase().includes(term) ||
    c.phone.includes(term) ||
    matchingBookings(c, term).length > 0
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="padding: 30px 20px; color: #64748b; text-align: center; font-size: 13px;">No customers found matching "${escapeHtml(filterText)}".</div>`;
    return;
  }

  filtered.forEach(c => {
    const div = document.createElement('div');
    div.className = 'customer-card';
    div.dataset.email = c.email;
    div.onclick = () => selectCustomer(c.email, div, term);

    // Mostra o nome completo sem espaços extras se não houver apelido
    const displayName = `${c.fname} ${c.lname}`.trim();
    const refHits = matchingBookings(c, term);

    div.innerHTML = `
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: #fff;">${escapeHtml(displayName)}</div>
      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">📧 ${escapeHtml(c.email)}</div>
      <div style="font-size: 12px; color: #94a3b8;">📞 ${escapeHtml(c.phone)}</div>
      ${refHits.length ? `<div class="ref-hit">🔖 RA ${refHits.map(b => escapeHtml(b.ref)).join(', ')}</div>` : ''}
    `;
    listEl.appendChild(div);
  });

  // Busca por RA com um único cliente: abre o perfil direto
  if (filtered.length === 1 && matchingBookings(filtered[0], term).length) {
    selectCustomer(filtered[0].email, listEl.firstElementChild, term);
  }
}

// Dispara quando o agente escreve na barra de pesquisa
function filterCustomers() {
  const text = document.getElementById('crm-search').value;
  if (crmMode === 'vehicles') { renderVehicleList(text); return; }
  // Digitou uma placa completa na busca de clientes: vai direto para o veículo
  const plate = crmExactPlate(text);
  if (plate) { crmOpenVehicle(plate); return; }
  renderCustomerList(text);
}

// ==========================================
// VEÍCULOS — histórico de reservas por rego
// ==========================================
let crmMode = 'customers';
let crmVehicleIndex = {};   // { plate: [registros] }
let crmSelectedPlate = null;
let crmSelectedEmail = null;

function crmNormPlate(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function crmExactPlate(text) {
  const t = crmNormPlate(text);
  if (t.length < 5) return null;
  const v = FLEET_VEHICLES.find(x => crmNormPlate(x.plate) === t);
  return v ? v.plate : null;
}

function crmFmt(ms) {
  const d = new Date(ms);
  return `${fleetFormatDate(ms)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Todas as reservas de todas as origens, agrupadas pela placa
function buildVehicleIndex() {
  const index = {};
  const seen = new Set();
  const add = (plate, rec) => {
    if (!plate || !fleetGetVehicle(plate)) return;
    const key = rec.ref + '|' + plate;
    if (seen.has(key)) return;
    seen.add(key);
    (index[plate] = index[plate] || []).push(rec);
  };
  const ledger = typeof bondReadLedger === 'function' ? bondReadLedger() : {};

  // Reservas do Planner (demonstração, com as alterações gravadas)
  fleetSeedBookings().forEach(s => {
    const rec = ledger[s.id];
    const type = rec && !rec.seed && rec.fees && s.type !== 'maintenance' ? 'returned' : s.type;
    add(s.plate, {
      id: s.id, plannerId: s.id, ref: s.ref, type, email: s.type === 'maintenance' ? '' : s.clientEmail,
      customer: s.type === 'maintenance' ? (s.name || 'Maintenance') : `${s.fname} ${s.lname}`,
      start: s.startMs, end: s.endMs, notes: (s.notesList || []).length
    });
  });

  // Site, portal e Add Booking
  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    const plate = fleetIsVirtualPlate(b.plate) ? b.virtualFrom : b.plate;
    if (!plate) return;
    const r = fleetBookingRange(b);
    const cancelled = b.status === 'cancelled';
    add(plate, {
      id: String(b.id), plannerId: cancelled || FLEET_NON_HOLDING_STATUSES.includes(b.status) ? null : String(b.id),
      ref: b.ref || ('OR-' + String(b.id).slice(-6)), type: cancelled ? 'cancelled' : (b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation'),
      email, customer: `${b.fname || ''} ${b.lname || ''}`.trim() || email,
      start: r.start, end: r.end, notes: (b.notesList || []).length
    });
  }));

  // Reserva principal do portal (GC-8832)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state || !Object.keys(state).length) continue;
    const email = key.replace(FLEET_MAIN_PREFIX, '');
    const r = fleetMainBookingRange(state);
    add(FLEET_MAIN_BOOKING_PLATE, {
      id: 'main-' + email, plannerId: state.status === 'cancelled' ? null : 'main-' + email, ref: 'GC-8832',
      type: state.status === 'cancelled' ? 'cancelled' : fleetMainBookingType(state),
      email, customer: 'Felipe Grigolli', start: r.start, end: r.end, notes: fleetBookingNotes('main-' + email).length
    });
  }

  // Locações antigas já devolvidas (fila do Bond Refunds)
  if (typeof bondAllRecords === 'function') bondAllRecords().forEach(r => add(r.plate, {
    id: r.id, plannerId: null, ref: r.ref, type: 'returned', email: r.email,
    customer: `${r.fname} ${r.lname}`, start: r.pickupMs, end: r.dropoffMs, notes: 0
  }));

  // Possible Extensions do Planner
  fleetReadExtensions().forEach(x => add(x.plate, {
    id: x.id, plannerId: null, ref: x.kind === 'weekend' ? 'WKND-HOLD' : 'POSS-EXT', type: 'possible-ext', email: '',
    customer: x.kind === 'weekend' ? 'Weekend hold' : 'Possible extension', start: x.startMs, end: x.endMs, notes: x.note ? 1 : 0
  }));

  Object.values(index).forEach(list => list.sort((a, b) => b.start - a.start));
  crmVehicleIndex = index;
}

function crmVehicleNow(plate) {
  const now = Date.now();
  const list = crmVehicleIndex[plate] || [];
  const current = list.find(r => r.type !== 'cancelled' && r.type !== 'returned' && r.start <= now && r.end > now);
  const next = list.filter(r => r.type !== 'cancelled' && r.start > now).sort((a, b) => a.start - b.start)[0] || null;
  let status = { key: 'available', label: 'Available' };
  if (current && current.type === 'maintenance') status = { key: 'maint', label: 'In maintenance' };
  else if (current && current.type === 'possible-ext') status = { key: 'held', label: 'Held · possible ext.' };
  else if (current) status = { key: 'onhire', label: 'On hire' };
  return { current, next, status };
}

function crmSetMode(mode, search) {
  crmMode = mode;
  document.getElementById('crm-tab-customers').classList.toggle('active', mode === 'customers');
  document.getElementById('crm-tab-vehicles').classList.toggle('active', mode === 'vehicles');
  document.getElementById('crm-search-label').textContent = mode === 'vehicles' ? 'SEARCH VEHICLE' : 'SEARCH CUSTOMER';
  const input = document.getElementById('crm-search');
  input.placeholder = mode === 'vehicles' ? 'Rego, model or branch...' : 'Name, Email, Phone, RA / Res # or Rego...';
  input.value = search != null ? search : '';
  if (mode === 'vehicles') renderVehicleList(input.value);
  else renderCustomerList(input.value);
}

function renderVehicleList(filterText) {
  const listEl = document.getElementById('customer-list');
  const term = String(filterText || '').trim().toLowerCase();
  const plateTerm = crmNormPlate(filterText);
  const vehicles = FLEET_VEHICLES.filter(v => {
    if (!term) return true;
    const cat = fleetGetCategory(v.categoryId);
    return crmNormPlate(v.plate).includes(plateTerm) && plateTerm.length > 0 ||
      [v.model, v.label, cat.name, v.branch, FLEET_BRANCHES[v.branch]].join(' ').toLowerCase().includes(term);
  });

  if (!vehicles.length) {
    listEl.innerHTML = `<div style="padding: 30px 20px; color: #64748b; text-align: center; font-size: 13px;">No vehicles found matching "${escapeHtml(filterText)}".</div>`;
    return;
  }

  listEl.innerHTML = vehicles.map(v => {
    const count = (crmVehicleIndex[v.plate] || []).filter(r => r.type !== 'possible-ext').length;
    const now = crmVehicleNow(v.plate);
    return `
      <div class="veh-card${v.plate === crmSelectedPlate ? ' active' : ''}" data-plate="${escapeHtml(v.plate)}" onclick="selectVehicle('${escapeHtml(v.plate)}')">
        <div>
          <span class="plate-chip">${escapeHtml(v.plate)}</span>
          <div class="veh-card-model">${escapeHtml(v.label)} · ${escapeHtml(v.branch)}</div>
        </div>
        <div class="veh-card-side">
          <span class="veh-status ${now.status.key}">${now.status.label}</span>
          <div style="margin-top: 6px;">${count} booking${count === 1 ? '' : 's'}</div>
          ${crmSpareKeyMini(v.plate)}
        </div>
      </div>`;
  }).join('');

  // Busca que bate com uma única placa: abre direto
  if (vehicles.length === 1 && plateTerm.length >= 5) selectVehicle(vehicles[0].plate);
}

// Abre o histórico de um veículo (também usado pelos links de placa)
function crmOpenVehicle(plate) {
  crmSetMode('vehicles', plate);
  selectVehicle(plate);
}

function selectVehicle(plate) {
  const v = fleetGetVehicle(plate);
  if (!v) return;
  crmSelectedPlate = plate;
  crmSelectedEmail = null;
  document.querySelectorAll('.veh-card').forEach(el => el.classList.toggle('active', el.dataset.plate === plate));
  const cat = fleetGetCategory(v.categoryId);
  const list = crmVehicleIndex[plate] || [];
  const rentals = list.filter(r => !['maintenance', 'possible-ext', 'cancelled'].includes(r.type));
  const days = rentals.reduce((s, r) => s + Math.max(1, Math.ceil((r.end - r.start) / FLEET_DAY_MS)), 0);
  const now = crmVehicleNow(plate);
  const nowMs = Date.now();

  const rows = list.map(r => {
    const isNow = r.type !== 'cancelled' && r.start <= nowMs && r.end > nowMs;
    const daysTxt = r.type === 'maintenance' || r.type === 'possible-ext' ? '—' : Math.max(1, Math.ceil((r.end - r.start) / FLEET_DAY_MS));
    const actions = r.plannerId ? `<button class="crm-btn" onclick="crmOpenBooking('${escapeHtml(r.plannerId)}')">Open</button>` : '';
    // Nome do cliente abre a ficha dele (aba Customers)
    const who = r.type === 'maintenance' || r.type === 'possible-ext'
      ? `<strong>${escapeHtml(r.customer)}</strong>`
      : (r.email ? `<button type="button" class="crm-name-link" title="Open customer" onclick="crmOpenCustomer('${escapeHtml(r.email)}')">${escapeHtml(r.customer)}</button>` : escapeHtml(r.customer));
    return `
      <tr class="${isNow ? 'now' : ''}">
        <td style="color: #3b82f6; font-weight: 700;">${escapeHtml(r.ref)}</td>
        <td>${who}</td>
        <td style="color: #cbd5e1; white-space: nowrap;">${crmFmt(r.start)}</td>
        <td style="color: #cbd5e1; white-space: nowrap;">${crmFmt(r.end)}</td>
        <td>${daysTxt}</td>
        <td>${crmStatusBadge(r.type)}</td>
        <td>${r.notes ? `${r.notes}` : '<span class="crm-muted">—</span>'}</td>
        <td>${actions || '<span class="crm-muted">—</span>'}</td>
      </tr>`;
  }).join('');

  document.getElementById('customer-details').innerHTML = `
    <div class="profile-header">
      <span class="plate-chip big">${escapeHtml(v.plate)}</span>
      <div>
        <h2 style="margin: 0 0 6px 0; font-size: 22px; color: #fff;">${escapeHtml(v.model)}</h2>
        <div style="color: #94a3b8; font-size: 13px; display: flex; gap: 15px; flex-wrap: wrap; align-items: center;">
          <span>${escapeHtml(cat.name)}</span>
          <span>📍 ${escapeHtml(FLEET_BRANCHES[v.branch])}</span>
          <span class="veh-status ${now.status.key}">${now.status.label}</span>
        </div>
      </div>
    </div>

    <div id="spare-key-box">${crmSpareKeyBox(plate)}</div>

    <div class="veh-stats">
      <div class="veh-stat"><span>Bookings</span><strong>${rentals.length}</strong><small>${list.length - rentals.length} other record(s)</small></div>
      <div class="veh-stat"><span>Rental days</span><strong>${days}</strong><small>All bookings on this rego</small></div>
      <div class="veh-stat"><span>Right now</span><strong>${now.current ? escapeHtml(now.current.ref) : '—'}</strong><small>${now.current ? escapeHtml(now.current.customer) + ' · until ' + fleetFormatDate(now.current.end) : 'Not on hire'}</small></div>
      <div class="veh-stat"><span>Next booking</span><strong>${now.next ? escapeHtml(now.next.ref) : '—'}</strong><small>${now.next ? crmFmt(now.next.start) : 'Nothing booked'}</small></div>
    </div>

    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px;">
      <div>
        <h3 style="font-size: 16px; margin: 0; color: #fff;">Booking History · ${escapeHtml(v.plate)}</h3>
        <span style="font-size: 12px; color: #64748b;">${list.length} record(s) found · newest first</span>
      </div>
      <a class="crm-btn" style="text-decoration: none;" href="gc-activity-log.html?rego=${encodeURIComponent(v.plate)}" title="Every change made on this vehicle's bookings">🕘 Activity log</a>
    </div>
    ${list.length ? `
      <div style="overflow-x: auto; border-radius: 8px;">
        <table class="booking-history-table veh-history" style="margin-top: 0;">
          <thead><tr><th>Res #</th><th>Customer</th><th>Pick-up</th><th>Drop-off</th><th>Days</th><th>Status</th><th>Notes</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<p style="color: #64748b;">No bookings on this vehicle yet.</p>'}
  `;
}

// ---------- Preferência de contato do cliente (WhatsApp ou e-mail) ----------
function crmContactHtml(email) {
  if (!email || typeof fleetContactPref !== 'function') return '';
  const p = fleetContactPref(email);
  const noWa = p.whatsapp === false;
  const when = p.updatedAt ? ` · ${fleetFormatDate(p.updatedAt)}` : '';
  const meta = noWa ? 'A WhatsApp message could not be delivered, so we use email.'
    : p.default ? 'Chosen on the booking form.' : `Set by ${escapeHtml(p.updatedBy || 'customer')}${p.source ? ' (' + escapeHtml(p.source) + ')' : ''}${when}`;
  return `
    <div class="ct-box${noWa ? ' nowa' : ''}">
      <div class="ct-main">
        <span class="ct-label">Preferred contact</span>
        <div class="ct-seg" role="group" aria-label="Preferred contact">
          <button type="button" class="${p.channel === 'whatsapp' && !noWa ? 'on' : ''}" onclick="crmSetContact('${escapeHtml(email)}', 'whatsapp')">WhatsApp</button>
          <button type="button" class="${p.channel === 'email' || noWa ? 'on' : ''}" onclick="crmSetContact('${escapeHtml(email)}', 'email')">Email</button>
        </div>
        ${noWa ? '<span class="ct-flag">Mobile not on WhatsApp</span>' : ''}
      </div>
      <span class="ct-meta">${meta} Reminders, offers and updates follow this choice.</span>
    </div>`;
}

function crmSetContact(email, channel) {
  let by = 'Agent';
  try { by = localStorage.getItem('gc_agent_name') || by; } catch (e) {}
  const cur = fleetContactPref(email);
  // Agente escolhendo WhatsApp de novo (ex.: cliente avisou que instalou): libera nova tentativa
  fleetSetContactPref(email, channel === 'whatsapp' && cur.whatsapp === false ? { channel, whatsapp: null } : { channel }, by, 'Changed by the team');
  const box = document.getElementById('crm-contact-box');
  if (box) box.innerHTML = crmContactHtml(email);
  if (typeof gcToast === 'function') gcToast(`Preferred contact set to ${channel === 'email' ? 'Email' : 'WhatsApp'}.`, 'success');
}

// ---------- Histórico de conversas (Live Chat do site/portal + WhatsApp via 3CX) ----------
// Agrupa por RA tudo o que o cliente conversou com a GC Tech, em qualquer reserva.
function crmReadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}

function crmChatHistory(customer) {
  const email = customer.email.toLowerCase();
  const groups = new Map();   // ref → { ref, booking, live: [{ session, messages }], wa: { thread, messages } }
  const group = (ref, booking) => {
    const key = ref || 'General';
    if (!groups.has(key)) groups.set(key, { ref: key, booking: booking || null, live: [], wa: null });
    const g = groups.get(key);
    if (!g.booking && booking) g.booking = booking;
    return g;
  };
  const byRef = new Map(customer.bookings.map(b => [b.ref, b]));
  const byId = new Map(customer.bookings.map(b => [b.id, b]));
  customer.bookings.forEach(b => group(b.ref, b));

  // Live Chat (gc-chat.js): uma sessão por cliente + RA
  crmReadJSON('gc_chat_sessions', []).forEach(s => {
    if (String(s.customerEmail || '').toLowerCase() !== email) return;
    const messages = crmReadJSON('gc_chat_messages_' + s.sessionId, []);
    if (!messages.length) return;
    group(s.bookingRef, byRef.get(s.bookingRef)).live.push({ session: s, messages });
  });

  // WhatsApp (gc-whatsapp.js): mensagens ligadas às reservas deste cliente
  if (typeof waThreads === 'function') {
    waThreads().forEach(t => {
      const threadIsCustomer = t.booking && String(t.booking.email || '').toLowerCase() === email;
      t.messages.forEach(m => {
        const id = m.bookingId || t.bookingId;
        const ref = m.ref || t.ref;
        const booking = byId.get(id) || byRef.get(ref);
        if (!booking && !threadIsCustomer) return;
        const g = group(booking ? booking.ref : ref, booking);
        if (!g.wa) g.wa = { thread: t, messages: [] };
        g.wa.messages.push(m);
      });
    });
  }

  const lastAt = g => Math.max(0,
    ...g.live.map(l => (l.messages[l.messages.length - 1] || {}).timestamp || 0),
    ...(g.wa ? g.wa.messages.map(m => m.at) : []));
  return Array.from(groups.values())
    .map(g => ({ ...g, liveCount: g.live.reduce((s, l) => s + l.messages.filter(m => m.sender !== 'system').length, 0), waCount: g.wa ? g.wa.messages.length : 0, lastAt: lastAt(g) }))
    .sort((a, b) => (b.lastAt > 0) - (a.lastAt > 0) || b.lastAt - a.lastAt);
}

function crmChatHistoryButton(customer) {
  const n = crmChatHistory(customer).filter(g => g.lastAt > 0).length;
  return `<button type="button" class="crm-chat-link" onclick="crmOpenChatHistory('${escapeHtml(customer.email)}')">💬 Open Chat History${n ? ` <span class="crm-chat-count">${n} RA${n === 1 ? '' : 's'}</span>` : ''}</button>`;
}

let crmChatState = null;   // { email, ref, channel }

function crmOpenChatHistory(email, ref) {
  const customer = allCustomers.find(c => c.email === email);
  if (!customer) return;
  const groups = crmChatHistory(customer);
  const first = groups.find(g => g.lastAt > 0);
  crmChatState = { email, ref: ref || (first ? first.ref : null), channel: null };
  let overlay = document.getElementById('crm-chat-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'crm-chat-overlay';
    overlay.className = 'crm-chat-overlay';
    overlay.addEventListener('click', e => { if (e.target === overlay) crmCloseChatHistory(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && crmChatState) crmCloseChatHistory(); });
  }
  crmRenderChatHistory();
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function crmCloseChatHistory() {
  const overlay = document.getElementById('crm-chat-overlay');
  if (overlay) overlay.classList.remove('open');
  crmChatState = null;
}

function crmChatPick(ref) {
  crmChatState.ref = ref;
  crmChatState.channel = null;
  crmRenderChatHistory();
}

function crmChatChannel(channel) {
  crmChatState.channel = channel;
  crmRenderChatHistory();
}

function crmChatTime(ms) {
  return `${fleetFormatDate(ms)} ${fleetFormatTime(ms)}`;
}

function crmRenderChatHistory() {
  const overlay = document.getElementById('crm-chat-overlay');
  if (!overlay || !crmChatState) return;
  const customer = allCustomers.find(c => c.email === crmChatState.email);
  if (!customer) return;
  const groups = crmChatHistory(customer);
  const sel = groups.find(g => g.ref === crmChatState.ref) || null;
  const displayName = `${customer.fname} ${customer.lname}`.trim();

  const list = groups.map(g => {
    const b = g.booking;
    const empty = g.lastAt === 0;
    return `
      <button type="button" class="cch-ra${sel && g.ref === sel.ref ? ' active' : ''}${empty ? ' empty' : ''}" ${empty ? 'disabled' : ''} onclick="crmChatPick('${escapeHtml(g.ref)}')">
        <span class="cch-ra-top"><strong>${escapeHtml(g.ref)}</strong>${g.lastAt ? `<small>${fleetFormatDate(g.lastAt)}</small>` : ''}</span>
        <span class="cch-ra-sub">${escapeHtml(b ? b.vehicle : 'No booking linked')}${b && b.plate ? ' · ' + escapeHtml(b.plate) : ''}</span>
        <span class="cch-ra-tags">
          ${g.liveCount ? `<span class="cch-tag live">💬 Live chat · ${g.liveCount}</span>` : ''}
          ${g.waCount ? `<span class="cch-tag wa">WhatsApp · ${g.waCount}</span>` : ''}
          ${empty ? '<span class="cch-tag none">No messages</span>' : ''}
        </span>
      </button>`;
  }).join('');

  let body = '<div class="cch-placeholder">This customer has no chat or WhatsApp messages yet.</div>';
  if (sel && sel.lastAt) {
    const channels = [sel.liveCount || sel.live.length ? 'live' : null, sel.waCount ? 'wa' : null].filter(Boolean);
    const channel = channels.includes(crmChatState.channel) ? crmChatState.channel : channels[0];
    const b = sel.booking;
    const tabs = channels.length > 1 ? `
      <div class="cch-tabs">
        <button type="button" class="${channel === 'live' ? 'on' : ''}" onclick="crmChatChannel('live')">💬 Live chat (${sel.liveCount})</button>
        <button type="button" class="${channel === 'wa' ? 'on' : ''}" onclick="crmChatChannel('wa')">WhatsApp (${sel.waCount})</button>
      </div>` : '';
    body = `
      <div class="cch-conv-head">
        <div>
          <div class="cch-conv-title">${escapeHtml(sel.ref)}${b ? ` · ${escapeHtml(b.vehicle)}` : ''}</div>
          <div class="cch-conv-sub">${b ? `Pick-up ${escapeHtml(b.pickup)} · ` : ''}${channel === 'wa' ? `WhatsApp ${escapeHtml(sel.wa.thread.phone)} · via 3CX` : 'Live chat on the website / customer portal'}</div>
        </div>
        ${channel === 'wa'
          ? `<button type="button" class="crm-btn cch-open-wa" onclick="waOpenInInbox('${escapeHtml(sel.wa.thread.phone)}', '${escapeHtml(sel.wa.thread.bookingId || (b && b.id) || '')}')">Open in WhatsApp inbox ↗</button>`
          : `<a class="crm-btn" style="text-decoration: none;" href="agent-dashboard.html#module-livechat" target="gc-livechat">Open Live Chat ↗</a>`}
      </div>
      ${tabs}
      <div class="cch-thread${channel === 'wa' ? ' wa-thread' : ''}" id="cch-thread">
        ${channel === 'wa' ? waBubblesHtml(sel.wa.thread, sel.wa.messages.slice().sort((x, y) => x.at - y.at), customer.fname) : crmLiveChatHtml(sel.live)}
      </div>`;
  }

  overlay.innerHTML = `
    <div class="cch-dialog" role="dialog" aria-modal="true" aria-label="Chat history">
      <div class="cch-head">
        <div>
          <div class="cch-label">Chat history</div>
          <div class="cch-name">${escapeHtml(displayName)} <span>${escapeHtml(customer.email)}</span></div>
        </div>
        <button type="button" class="cch-close" title="Close (Esc)" onclick="crmCloseChatHistory()">✕</button>
      </div>
      <div class="cch-body">
        <div class="cch-list">
          <div class="cch-list-label">Choose an RA</div>
          ${list || '<div class="cch-placeholder">No bookings.</div>'}
        </div>
        <div class="cch-conv">${body}</div>
      </div>
    </div>`;
  const th = document.getElementById('cch-thread');
  if (th) th.scrollTop = th.scrollHeight;
}

// Conversa do Live Chat: cliente à esquerda, GC Tech à direita, avisos do sistema no meio
function crmLiveChatHtml(live) {
  return live.slice().sort((a, b) => (a.messages[0].timestamp || 0) - (b.messages[0].timestamp || 0)).map(({ session, messages }) => {
    const head = `<div class="cch-session">Chat started ${crmChatTime(messages[0].timestamp)}${session.agentName ? ` · answered by ${escapeHtml(session.agentName)}` : ''} · <span class="cch-status ${escapeHtml(session.status)}">${escapeHtml(session.status)}</span></div>`;
    return head + messages.map(m => {
      if (m.sender === 'system') return `<div class="cch-sys">${escapeHtml(m.text)} · ${crmChatTime(m.timestamp)}</div>`;
      const mine = m.sender !== 'customer';
      // Sem quebras de linha dentro do balão (white-space: pre-wrap mostraria a indentação)
      return `<div class="cch-msg ${mine ? 'out' : 'in'}"><span class="cch-who">${escapeHtml(m.senderName || (mine ? 'GC Tech' : 'Customer'))}</span>${escapeHtml(m.text)}<span class="cch-time">${crmChatTime(m.timestamp)}</span></div>`;
    }).join('');
  }).join('');
}

// ---------- Bond em hold (cliente pediu para guardarmos o bond) ----------
// Bookings devolvidos deste cliente que ainda têm bond (gc-bonds.js)
function crmBondRecords(customer) {
  if (typeof bondAllRecords !== 'function') return [];
  const ids = new Set(customer.bookings.map(b => b.id));
  return bondAllRecords().filter(r => String(r.email || '').toLowerCase() === customer.email || ids.has(r.id));
}

// Quadro em destaque no topo do perfil: some quando o bond é devolvido (refund)
function crmBondHeldHtml(bondRecs) {
  const held = bondRecs.filter(bondIsHeld);
  if (!held.length) return '';
  const total = held.reduce((s, r) => s + bondHeldAmount(r), 0);
  // "Sem bond no próximo aluguel" só vale para o hold com motivo "Next booking"
  const nextHire = held.filter(bondHoldIsNextHire).reduce((s, r) => s + bondHeldAmount(r), 0);
  const rows = held.map(r => {
    const cat = fleetGetCategory(r.categoryId);
    const reason = bondHoldReason(r);
    return `
      <li>
        <span class="bh-ref">#${escapeHtml(r.ref)}</span>
        <span>${escapeHtml(cat ? cat.model : 'Vehicle')}${r.plate ? ' · ' + escapeHtml(r.plate) : ''} · returned ${fleetFormatDate(r.dropoffMs)}</span>
        <strong>${feeMoney(bondHeldAmount(r))}</strong>
        <span class="bh-reason${reason.id === 'next-hire' ? ' next' : ''}">${escapeHtml(reason.label)}</span>${r.hold.note ? `<span class="bh-note">“${escapeHtml(r.hold.note)}”</span>` : ''}
        ${bondRefundRequest(r) ? `<span class="bh-req">📩 Customer asked for the refund by ${escapeHtml(bondRefundRequest(r).channel)} · ${fleetFormatDate(bondRefundRequest(r).at)}</span>` : ''}
        <span class="bh-meta">Held by ${escapeHtml(r.hold.by || 'Agent')} · ${fleetFormatDate(r.hold.atMs)} · <a href="agent-dashboard.html#bond:${encodeURIComponent(r.id)}">Refund in Bond Refunds →</a></span>
      </li>`;
  }).join('');
  const title = nextHire
    ? `${feeMoney(total)} held · ${nextHire === total ? 'no new bond needed on the next hire' : `${feeMoney(nextHire)} covers the next hire's bond`}`
    : `${feeMoney(total)} held`;
  const sub = nextHire === total ? 'The customer asked us to keep the bond instead of refunding it.'
    : nextHire ? 'Part of the bond is kept for the next hire; the rest is held for the reason shown.'
    : 'The bond stays out of the refund queue until the reason below is sorted. A new bond is still charged on the next hire.';
  return `
    <div class="bond-held-box">
      <div class="bh-head">
        <div class="bh-icon">🔒</div>
        <div>
          <div class="bh-label">Bond on hold</div>
          <div class="bh-title">${title}</div>
          <div class="bh-sub">${sub}</div>
        </div>
      </div>
      <ul class="bh-list">${rows}</ul>
    </div>`;
}

async function crmBondHold(id, hold) {
  const rec = bondGetRecord(id);
  if (!rec) return;
  let by = 'Agent';
  try { by = localStorage.getItem('gc_agent_name') || by; } catch (e) {}
  const amount = feeMoney(-bondBalance(rec));
  if (hold) {
    // Motivo obrigatório (a janela só fecha com um motivo válido)
    const choice = await crmBondHoldDialog(rec, amount);
    if (!choice) return;
    const res = bondSetHold(id, by, choice.reason, choice.note);
    if (res.error) { gcToast(res.error, 'warning'); return; }
    gcToast(`Bond of ${amount} from #${rec.ref} is on hold\n\n${bondHoldLabel(res.rec)}`, 'success');
    crmRefresh();
    return;
  }
  const ok = await gcConfirm({ title: `Remove the hold on #${rec.ref}?`, message: `The ${amount} bond goes back to the Bond Refunds queue.`, confirmText: 'Remove hold' });
  if (!ok) return;
  const res = bondClearHold(id, by);
  if (res.error) { gcToast(res.error, 'warning'); return; }
  gcToast(`Hold removed — #${rec.ref} is back in the refund queue.`, 'success');
  crmRefresh();
}

// Janela "Why are we holding this bond?" → { reason, note } ou null (cancelou)
function crmBondHoldDialog(rec, amount) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'bhd-overlay';
    overlay.innerHTML = `
      <div class="bhd-dialog" role="dialog" aria-modal="true" aria-labelledby="bhd-title">
        <h3 id="bhd-title">🔒 Hold the ${escapeHtml(amount)} bond from #${escapeHtml(rec.ref)}</h3>
        <p class="bhd-sub">Why are we holding this bond? <strong>Required</strong> — it shows on the customer's profile and in Bond Refunds.</p>
        <div class="bhd-reasons">
          ${BOND_HOLD_REASONS.map(r => `
            <label class="bhd-reason">
              <input type="radio" name="bhd-reason" value="${r.id}">
              <span><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(r.hint)}</small></span>
            </label>`).join('')}
        </div>
        <label class="bhd-note-label" for="bhd-note">Note <span id="bhd-note-req">(optional)</span></label>
        <textarea id="bhd-note" rows="2" maxlength="200" placeholder="e.g. Quote requested from Smash Repairs on 14 Oct · Linkt account pending"></textarea>
        <div class="bhd-error" id="bhd-error"></div>
        <div class="bhd-actions">
          <button type="button" class="crm-btn" data-bhd="cancel">Cancel</button>
          <button type="button" class="crm-btn bhd-save" data-bhd="save">Hold bond</button>
        </div>
      </div>`;
    const reasonOf = () => (overlay.querySelector('input[name="bhd-reason"]:checked') || {}).value || '';
    const sync = () => {
      const r = BOND_HOLD_REASONS.find(x => x.id === reasonOf());
      overlay.querySelector('#bhd-note-req').textContent = r && r.needsNote ? '(required)' : '(optional)';
      overlay.querySelector('#bhd-error').textContent = '';
    };
    const finish = value => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const save = () => {
      const reason = reasonOf();
      const note = overlay.querySelector('#bhd-note').value.trim();
      const r = BOND_HOLD_REASONS.find(x => x.id === reason);
      const err = overlay.querySelector('#bhd-error');
      if (!r) { err.textContent = 'Choose why the bond is being held.'; return; }
      if (r.needsNote && !note) { err.textContent = 'Write the reason in the note.'; overlay.querySelector('#bhd-note').focus(); return; }
      finish({ reason, note });
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    overlay.addEventListener('change', sync);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.dataset.bhd === 'cancel') finish(null);
      else if (e.target.dataset.bhd === 'save') save();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
  });
}

// ---------- Chave reserva ----------
function crmSpareKeyMini(plate) {
  const k = fleetSpareKey(plate);
  if (!k) return '';
  return `<div class="sk-mini${k.away ? ' away' : ''}" title="Spare key: ${escapeHtml(FLEET_BRANCHES[k.branch])}">🔑 ${escapeHtml(k.branch)}</div>`;
}

function crmSpareKeyBox(plate, editing) {
  const k = fleetSpareKey(plate);
  if (!k) return '';
  const when = k.at ? `${fleetFormatDate(k.at)}` : '';
  const branchName = FLEET_BRANCHES[k.branch];
  const hist = (k.history || []).filter(h => h.branch).slice(0, 4).map(h =>
    `<li><strong>${escapeHtml(h.branch)}</strong> · ${escapeHtml(h.by || '')}${h.at ? ' · ' + fleetFormatDate(h.at) : ''}${h.note ? ' · ' + escapeHtml(h.note) : ''}</li>`).join('');

  if (editing) {
    const opts = Object.keys(FLEET_BRANCHES).map(c =>
      `<option value="${c}"${c === k.branch ? ' selected' : ''}>${escapeHtml(FLEET_BRANCHES[c])}${c === k.home ? ' (home branch)' : ''}</option>`).join('');
    return `
      <div class="sk-box editing">
        <div class="sk-icon">🔑</div>
        <div class="sk-body">
          <div class="sk-label">Spare key location</div>
          <div class="sk-form">
            <select id="sk-branch">${opts}</select>
            <input type="text" id="sk-note" maxlength="80" placeholder="Where exactly? e.g. Key cabinet, hook 14" value="${escapeHtml(k.note || '')}">
            <button class="crm-btn sk-save" onclick="crmSaveSpareKey('${escapeHtml(plate)}')">Save</button>
            <button class="crm-btn" onclick="crmEditSpareKey('${escapeHtml(plate)}', false)">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="sk-box${k.away ? ' away' : ''}">
      <div class="sk-icon">🔑</div>
      <div class="sk-body">
        <div class="sk-label">Spare key location</div>
        <div class="sk-where">${escapeHtml(branchName)}${k.note ? ` <span class="sk-note">· ${escapeHtml(k.note)}</span>` : ''}</div>
        <div class="sk-meta">${k.away ? `<span class="sk-flag">Not at home branch (${escapeHtml(k.home)})</span> ` : ''}Updated ${escapeHtml(when)}${k.by ? ' by ' + escapeHtml(k.by) : ''}</div>
        ${hist ? `<details class="sk-history"><summary>Previous locations</summary><ul>${hist}</ul></details>` : ''}
      </div>
      <button class="crm-btn" onclick="crmEditSpareKey('${escapeHtml(plate)}', true)">Update</button>
    </div>`;
}

function crmEditSpareKey(plate, editing) {
  const box = document.getElementById('spare-key-box');
  if (!box) return;
  box.innerHTML = crmSpareKeyBox(plate, editing);
  if (editing) document.getElementById('sk-note').focus();
}

function crmSaveSpareKey(plate) {
  const branch = document.getElementById('sk-branch').value;
  const note = document.getElementById('sk-note').value;
  let by = 'Agent';
  try { by = localStorage.getItem('gc_agent_name') || by; } catch (e) {}
  const k = fleetSetSpareKey(plate, branch, note, by);
  if (!k) return;
  crmEditSpareKey(plate, false);
  const card = document.querySelector(`.veh-card[data-plate="${CSS.escape(plate)}"] .sk-mini`);
  if (card) card.outerHTML = crmSpareKeyMini(plate);
  if (typeof gcToast === 'function') gcToast(`Spare key for ${plate} is now at ${FLEET_BRANCHES[branch]}.`, 'success');
}

function crmStatusBadge(type) {
  const map = {
    reservation: ['RESERVATION', 'rgba(249, 115, 22, 0.2)', '#fb923c'],
    confirmed: ['CONFIRMED', 'rgba(16, 185, 129, 0.2)', '#10b981'],
    hired: ['HIRED', 'rgba(59, 130, 246, 0.2)', '#60a5fa'],
    returned: ['RETURNED', 'rgba(148, 163, 184, 0.2)', '#cbd5e1'],
    maintenance: ['MAINTENANCE', 'rgba(132, 204, 22, 0.15)', '#a3e635'],
    'possible-ext': ['POSSIBLE EXT.', 'rgba(148, 163, 184, 0.15)', '#94a3b8'],
    cancelled: ['CANCELLED', 'rgba(239, 68, 68, 0.2)', '#ef4444']
  };
  const [label, bg, color] = map[type] || [String(type || '').toUpperCase(), 'rgba(245, 158, 11, 0.2)', '#f59e0b'];
  return `<span style="background: ${bg}; color: ${color}; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap;">${label}</span>`;
}

// Abre o cliente (aba Customers) a partir de uma reserva do veículo
function crmOpenCustomer(email) {
  crmSetMode('customers', email);
  const card = document.querySelector(`.customer-card[data-email="${CSS.escape(email)}"]`);
  selectCustomer(email, card);
}

// Abre a reserva na mesma janela de edição usada pelo Daily Activity
function crmOpenBooking(id) {
  const w = Math.min(1180, screen.availWidth - 40), h = Math.min(860, screen.availHeight - 60);
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - h) / 2);
  const win = window.open('gc-fleet-planner.html?popup=1&open=' + encodeURIComponent(id), 'gcBooking_' + id.replace(/\W/g, '_'),
    `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`);
  if (!win) gcToast('The browser blocked the pop-up window\n\nAllow pop-ups for this page and try again.', 'warning');
  else win.focus();
}

// Voltou para esta aba (ex.: fechou a janela da reserva): recarrega os dados e a tela aberta
function crmRefresh() {
  // Não apaga a edição da chave reserva em andamento
  if (document.querySelector('.sk-box.editing')) return;
  loadCustomersFromStorage();
  if (crmChatState) crmRenderChatHistory();
  buildVehicleIndex();
  const input = document.getElementById('crm-search');
  if (crmMode === 'vehicles') {
    renderVehicleList(input.value);
    if (crmSelectedPlate) selectVehicle(crmSelectedPlate);
  } else {
    renderCustomerList(input.value);
    if (crmSelectedEmail) selectCustomer(crmSelectedEmail, document.querySelector(`.customer-card[data-email="${CSS.escape(crmSelectedEmail)}"]`));
  }
}

// 3. EXIBIR O PERFIL COMPLETO (Ecrã da Direita)
function selectCustomer(email, cardElement, term = '') {
  document.querySelectorAll('.customer-card').forEach(el => el.classList.remove('active'));
  if (cardElement) cardElement.classList.add('active');

  const customer = allCustomers.find(c => c.email === email);
  if (!customer) return;
  crmSelectedEmail = email;
  crmSelectedPlate = null;

  const detailsEl = document.getElementById('customer-details');
  
  // Gera as iniciais de forma segura mesmo se só tiver um nome
  const initials = (customer.fname.charAt(0) + (customer.lname ? customer.lname.charAt(0) : '')).toUpperCase();
  const displayName = `${customer.fname} ${customer.lname}`.trim();

  const hits = matchingBookings(customer, term);
  const bondRecs = crmBondRecords(customer);
  let bookingsHtml = '';
  if (customer.bookings.length === 0) {
    bookingsHtml = `<p style="color: #64748b;">No booking history found.</p>`;
  } else {
    bookingsHtml = `
      <table class="booking-history-table">
        <thead>
          <tr>
            <th>Booking Ref</th>
            <th>Vehicle</th>
            <th>Pick-up Schedule</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    // Mais recentes primeiro; numa busca por RA, o booking encontrado vai para o topo
    const ordered = customer.bookings.slice().reverse();
    ordered.sort((a, b) => hits.includes(b) - hits.includes(a));
    ordered.forEach(b => {
      let statusBadge = '';
      if (b.status === 'confirmed') statusBadge = '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;">CONFIRMED</span>';
      else if (b.status === 'cancelled') statusBadge = '<span style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;">CANCELLED</span>';
      else if (b.status === 'returned') statusBadge = '<span style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;">RETURNED</span>';
      else if (b.status === 'updated') statusBadge = '<span style="background: rgba(59, 130, 246, 0.2); color: #3b82f6; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;">UPDATED</span>';
      else statusBadge = `<span style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700;">${b.status.toUpperCase()}</span>`;

      // Bond deste booking (devolvido com bond a devolver): etiqueta de hold e botão para segurar/soltar
      const bond = bondRecs.find(r => r.id === b.id || r.ref === b.ref);
      const held = bond && bondIsHeld(bond);
      const bondOwed = bond && !held && bondBalance(bond) < 0;
      if (held) statusBadge += `<br><span class="bond-held-tag" title="${escapeHtml(bondHoldLabel(bond))}">🔒 BOND HELD ${feeMoney(bondHeldAmount(bond))}</span><br><span class="bond-held-why">${escapeHtml(bondHoldReason(bond).label)}</span>`;
      const bondBtn = held
        ? `<button class="crm-btn" onclick="crmBondHold('${escapeHtml(bond.id)}', false)">Remove hold</button>`
        : bondOwed ? `<button class="crm-btn bond-hold-btn" title="Keep the bond instead of refunding it (a reason is required)" onclick="crmBondHold('${escapeHtml(bond.id)}', true)">🔒 Hold bond</button>` : '';

      bookingsHtml += `
        <tr class="${hits.includes(b) ? 'ref-match' : ''}${held ? ' bond-held-row' : ''}">
          <td style="color: #3b82f6; font-weight: 700;">${escapeHtml(b.ref)}${b.referenceNo ? `<br><small style="color: #94a3b8; font-weight: 500;">Ref: ${escapeHtml(b.referenceNo)}</small>` : ''}</td>
          <td style="font-weight: 500;">${escapeHtml(b.vehicle)}${b.plate && fleetGetVehicle(b.plate) ? `<br><button type="button" class="plate-link" title="Show every booking on this vehicle" onclick="crmOpenVehicle('${escapeHtml(b.plate)}')"><span class="plate-chip" style="margin-top: 5px;">${escapeHtml(b.plate)}</span></button>` : ''}</td>
          <td style="color: #cbd5e1;">${escapeHtml(b.pickup)}</td>
          <td>${statusBadge}</td>
          <td style="white-space: nowrap;">${b.plannerId
            ? `<button class="crm-btn" onclick="crmOpenBooking('${escapeHtml(b.plannerId)}')">Open</button>`
            : `<button class="crm-btn" onclick="window.location.href='gc-fleet-planner.html'">View in Planner</button>`}${bondBtn}</td>
        </tr>
      `;
    });
    bookingsHtml += `</tbody></table>`;
  }

  detailsEl.innerHTML = `
    <div class="profile-header">
      <div class="avatar">${initials}</div>
      <div>
        <h2 style="margin: 0 0 8px 0; font-size: 24px; color: #fff;">${displayName}</h2>
        <div style="color: #94a3b8; font-size: 13px; display: flex; gap: 15px; flex-wrap: wrap;">
          <span>📧 ${customer.email}</span>
          <span>📞 ${customer.phone}</span>
          ${crmChatHistoryButton(customer)}
        </div>
      </div>
    </div>
    ${crmBondHeldHtml(bondRecs)}
    <div id="crm-contact-box">${crmContactHtml(customer.email)}</div>

    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px;">
      <div>
        <h3 style="font-size: 16px; margin: 0; color: #fff;">Booking History</h3>
        <span style="font-size: 12px; color: #64748b;">${customer.bookings.length} record(s) found</span>
      </div>
      <button class="btn btn-submit" style="padding: 8px 16px; font-size: 12px; background: #3b82f6;" onclick="window.location.href='gc-add-booking.html?${escapeHtml(new URLSearchParams({ fname: customer.fname || '', lname: customer.lname || '', email: customer.email || '', phone: customer.phone || '' }).toString())}'">➕ New Booking</button>
    </div>
    
    ${bookingsHtml}
  `;
}

// 4. INICIALIZAÇÃO
window.addEventListener('DOMContentLoaded', () => {
  loadCustomersFromStorage();
  buildVehicleIndex();
  const params = new URLSearchParams(window.location.search);
  // ?rego=<placa> abre o histórico do veículo (link da placa no Daily Activity)
  const rego = params.get('rego');
  if (rego && fleetGetVehicle(rego)) { crmOpenVehicle(rego); return; }
  // ?search=<RA> abre o cliente da reserva (botão Customer do Daily Activity)
  const search = params.get('search');
  if (search) document.getElementById('crm-search').value = search;
  renderCustomerList(search || '');
});

window.addEventListener('focus', crmRefresh);
// Mensagem nova (WhatsApp ou Live Chat) com o histórico aberto: atualiza a conversa
if (typeof waOnChange === 'function') waOnChange(() => { if (crmChatState) crmRenderChatHistory(); });
window.addEventListener('storage', e => {
  if (crmChatState && e.key && (e.key === 'gc_chat_sessions' || e.key.startsWith('gc_chat_messages_') || e.key === 'gc_whatsapp_msgs')) crmRenderChatHistory();
});