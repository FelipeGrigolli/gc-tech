// ==========================================
// GC TECH CUSTOMER PORTAL (My Bookings)
// Chaves de localStorage (compartilhadas com Agent Dashboard / Fleet Planner):
//   gc_user_profile, gc_multi_bookings_<email>, gc_booking_poc_<email> (reserva "main" GC-8832),
//   gc_past_bookings_<email>, gc_active_proposal, gc_pending_search
// Login: sessionStorage 'gc_auth_poc' (vale só enquanto a aba estiver aberta).
// Depende de: gc-fleet-data.js, gc-chat.js e flatpickr.
// ==========================================
const AUTH_KEY = 'gc_auth_poc';
const USER_PROFILE_KEY = 'gc_user_profile';
const MAIN_BOOKING_REF = 'GC-8832';
const MAIN_BOOKING_VEHICLE = 'Auto Pantech Truck (Long)+Lift';

let editDatePicker = null;
let currentModalTarget = 'main';

// ---------- Dados ----------
function portalGetProfile() {
  try { return JSON.parse(localStorage.getItem(USER_PROFILE_KEY)); } catch (e) { return null; }
}

function getUserEmail() {
  const profile = portalGetProfile();
  return profile && profile.email ? profile.email.toLowerCase().trim() : 'default_user@testgctech.com';
}

function getMultiBookingKey() { return 'gc_multi_bookings_' + getUserEmail(); }
function getStorageKey() { return 'gc_booking_poc_' + getUserEmail(); }
function getPastBookingKey() { return 'gc_past_bookings_' + getUserEmail(); }

function portalReadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}

function getVehicleImage(vehicleName) {
  const cat = fleetFindCategoryByModel(vehicleName);
  if (cat) return '../assets/img/' + cat.img;
  const name = (vehicleName || '').toLowerCase();
  const byKeyword = [['yaris', 'fleet-photos/yaris.jpg'], ['cross', 'fleet-photos/corolla-cross.jpg'], ['sedan', 'fleet-photos/corolla-sedan.jpg'], ['corolla', 'fleet-photos/corolla-hatch.jpg'],
    ['camry', 'fleet-photos/camry.jpg'], ['asx', 'fleet-photos/asx.jpg'], ['outlander', 'fleet-photos/outlander.jpg'], ['kluger', 'fleet-photos/kluger.jpg'],
    ['staria', 'fleet-photos/staria.jpg'], ['hiace', 'fleet-photos/hiace.jpg'], ['van', 'fleet-photos/hiace.jpg'], ['hilux', 'fleet-photos/hilux.jpg'], ['ute', 'fleet-photos/hilux.jpg']];
  const hit = byKeyword.find(([k]) => name.includes(k));
  return '../assets/img/' + (hit ? hit[1] : 'fleet-photos/pantech.jpg');
}

function portalBranch(loc) {
  return loc && loc.includes(' - ') ? fleetBranchLabel(loc) : (loc || '—');
}

function portalWhen(ms) {
  return isNaN(ms) ? '—' : `${fleetFormatDate(ms)}, ${fleetFormatTime(ms)}`;
}

// Junta reservas do portal/checkout/agente + a reserva "main" num formato único, em ordem de data
function portalCollectBookings() {
  const list = [];
  portalReadJSON(getMultiBookingKey(), []).forEach(b => {
    if (b.status === 'cancelled') return;
    const r = fleetBookingRange(b);
    list.push({ key: String(b.id), isMain: false, raw: b, ref: b.ref, vehicle: b.vehicle, loc: b.loc,
                dropoff: b.dropoff, start: r.start, end: r.end, status: b.status || 'confirmed' });
  });

  const main = portalReadJSON(getStorageKey(), null);
  if (main && main.status !== 'cancelled') {
    const r = fleetMainBookingRange(main);
    list.push({ key: 'main', isMain: true, raw: main, ref: MAIN_BOOKING_REF, vehicle: main.vehicle || MAIN_BOOKING_VEHICLE,
                loc: 'Sydney - Mascot', dropoff: 'Same as Pick up', start: r.start, end: r.end, status: main.status || 'confirmed' });
  }
  return list.sort((a, b) => a.start - b.start);
}

function portalFindBooking(key) {
  return portalCollectBookings().find(b => b.key === String(key)) || null;
}

const PORTAL_STATUS = {
  confirmed:     { cls: 'ok',     label: 'Confirmed' },
  updated:       { cls: 'ok',     label: 'Updated & confirmed' },
  pending:       { cls: 'wait',   label: 'Change requested' },
  fleet_pending: { cls: 'wait',   label: 'Finding a vehicle' },
  proposal_sent: { cls: 'action', label: 'Action required' }
};

// ---------- Toast e confirmação (substituem alert/confirm do navegador) ----------
let portalToastTimer = null;
function portalToast(message, warn) {
  const el = document.getElementById('portal-toast');
  el.textContent = message;
  el.classList.toggle('warn', !!warn);
  el.classList.add('show');
  clearTimeout(portalToastTimer);
  portalToastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

function portalConfirm(title, text, confirmLabel, onYes) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  const yes = document.getElementById('confirm-yes');
  yes.textContent = confirmLabel;
  yes.onclick = () => { portalConfirmClose(); onYes(); };
  document.getElementById('confirm-modal').classList.add('open');
}

function portalConfirmClose() {
  document.getElementById('confirm-modal').classList.remove('open');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
}

// ---------- Login ----------
function switchAuthTab(tab) {
  ['signin', 'register', 'guest', 'find'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`${t}-form`).hidden = t !== tab;
  });
}

function handleAuth(e, type) {
  e.preventDefault();
  let userName, userEmail;

  if (type === 'register') {
    userName = document.getElementById('reg-name').value;
    userEmail = document.getElementById('reg-email').value;
  } else if (type === 'guest') {
    userName = document.getElementById('guest-name').value;
    userEmail = document.getElementById('guest-email').value;
  } else if (type === 'find') {
    userEmail = document.getElementById('find-email').value;
    userName = 'Guest User';
  } else {
    userEmail = document.getElementById('login-email').value;
    userName = userEmail.split('@')[0];
    userName = userName.charAt(0).toUpperCase() + userName.slice(1);
  }
  userEmail = userEmail.trim().toLowerCase();

  // Mantém telefone/CNH já salvos se for o mesmo e-mail
  const previous = portalGetProfile();
  const base = previous && previous.email === userEmail ? previous : {};
  if (type === 'signin' || type === 'find') userName = base.name || userName;

  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify({ ...base, name: userName, email: userEmail, mode: type }));
  sessionStorage.setItem(AUTH_KEY, 'true');
  showDashboard(type === 'find' ? 'upcoming' : 'overview');
}

function logout() {
  sessionStorage.removeItem(AUTH_KEY);
  document.getElementById('dashboard-view').hidden = true;
  document.getElementById('auth-view').hidden = false;
  window.scrollTo({ top: 0 });
}

function showDashboard(tab) {
  document.getElementById('auth-view').hidden = true;
  document.getElementById('dashboard-view').hidden = false;
  initDashboard();
  switchDashboardTab(tab || 'overview');
}

// ---------- Dashboard ----------
function switchDashboardTab(tab) {
  ['overview', 'upcoming', 'past', 'payments', 'profile'].forEach(t => {
    document.getElementById(`btn-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  window.scrollTo({ top: 0 });
}

function initDashboard() {
  // Dados de demonstração criados na primeira visita de cada e-mail
  if (!localStorage.getItem(getStorageKey())) {
    localStorage.setItem(getStorageKey(), JSON.stringify({ status: 'confirmed', pickupTime: fleetMainDefaultPickup(), requestedTime: null }));
  }
  if (!localStorage.getItem(getPastBookingKey())) {
    localStorage.setItem(getPastBookingKey(), JSON.stringify([{
      id: 1, ref: 'GC-6511', vehicle: 'Toyota Hiace 1T Van', loc: 'Brisbane - Woolloongabba',
      dates: '10 Aug 2026 - 12 Aug 2026', price: '$345.00'
    }]));
  }

  ppSeedIfEmpty(); // planos de pagamento de exemplo (gc-payments.js)

  const profile = portalGetProfile() || {};
  const name = profile.name || 'Customer';
  document.getElementById('display-user-name').textContent = name;
  document.getElementById('account-avatar').textContent = name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  portalFillProfile(profile);
  renderAll();
}

function renderAll() {
  renderOverview();
  renderAllNewBookings();
  renderPastBookings();
  renderPaymentPlans();
}

// ---------- Overview ----------
function renderOverview() {
  const profile = portalGetProfile() || {};
  const bookings = portalCollectBookings();
  const now = Date.now();
  const active = bookings.filter(b => isNaN(b.end) || b.end > now);
  const past = portalPastHires();
  const needsAction = bookings.filter(b => b.status === 'proposal_sent');

  document.getElementById('overview-greeting').textContent = `Welcome back, ${(profile.name || 'there').split(' ')[0]}`;
  document.getElementById('overview-sub').textContent = active.length
    ? `You have ${active.length} upcoming or active booking${active.length > 1 ? 's' : ''}.`
    : 'You have no upcoming bookings.';

  // Avisos
  const alerts = [];
  needsAction.forEach(b => alerts.push(`
    <div class="alert-bar">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
      <div><strong>Booking ${b.ref}:</strong> our team has offered you an alternative vehicle.</div>
      <button class="btn-brand btn-sm" onclick="openModal('${b.key}')">Review offer</button>
    </div>`));
  bookings.filter(b => b.status === 'fleet_pending').forEach(b => alerts.push(`
    <div class="alert-bar">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <div><strong>Booking ${b.ref}:</strong> we're finding a vehicle for your dates. You haven't been charged.</div>
    </div>`));
  portalGetPlans().forEach(p => {
    const st = ppStatus(p);
    if (st.key !== 'overdue' && st.key !== 'due') return;
    const next = ppNextInstallment(p);
    alerts.push(`
    <div class="alert-bar">
      <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
      <div><strong>Payment plan ${p.bookingRef}:</strong> ${st.key === 'overdue'
        ? `a payment of ${ppMoney(next.amount)} is overdue. Pay it by live chat, WhatsApp or phone — our team takes it on your card.`
        : `${ppMoney(next.amount)} is due today. Pay it by live chat, WhatsApp or phone — our team takes it on your card.`}</div>
      <button class="btn-brand btn-sm" onclick="switchDashboardTab('payments')">View plan</button>
    </div>`);
  });
  portalHeldBonds().forEach(r => alerts.push(`
    <div class="alert-bar">
      <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      <div><strong>Bond on hold · Booking ${r.ref}:</strong> we're holding your ${ppMoney(bondHeldAmount(r))} bond. ${bondHoldCustomerText(r)}</div>
      <button class="btn-brand btn-sm" onclick="switchDashboardTab('upcoming')">View</button>
    </div>`));
  bookings.filter(b => b.status === 'pending').forEach(b => alerts.push(`
    <div class="alert-bar">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <div><strong>Booking ${b.ref}:</strong> your change request is being reviewed.</div>
    </div>`));
  document.getElementById('overview-alerts').innerHTML = alerts.join('');

  // Próxima locação
  const next = active.find(b => b.status !== 'fleet_pending') || active[0];
  const nextEl = document.getElementById('overview-next-trip');
  if (!next) {
    nextEl.innerHTML = `
      <div class="empty-trip">
        <h3>No upcoming trips</h3>
        <p>Ready for your next hire? Cars, SUVs, vans, trucks and utes across Sydney & Brisbane.</p>
        <a href="gc-home.html" class="btn-brand">Book a vehicle</a>
      </div>`;
  } else {
    const dayDiff = Math.round((new Date(next.start).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / FLEET_DAY_MS);
    let countdown;
    if (next.start <= now) countdown = `On hire — return by ${fleetFormatDate(next.end)}`;
    else if (dayDiff === 0) countdown = `Pick-up today at ${fleetFormatTime(next.start)}`;
    else if (dayDiff === 1) countdown = `Pick-up tomorrow at ${fleetFormatTime(next.start)}`;
    else countdown = `Pick-up in ${dayDiff} days`;
    const dropoffLoc = next.dropoff && next.dropoff !== 'Same as Pick up' ? next.dropoff : next.loc;
    const suburb = (next.loc || '').split(' - ')[1] || next.loc;

    nextEl.innerHTML = `
      <div class="next-trip">
        <div class="next-trip-info">
          <span class="eyebrow">Your next trip</span>
          <div class="next-trip-countdown">${countdown}</div>
          <div class="next-trip-vehicle">${next.vehicle}</div>
          <div class="trip-legs">
            <div><small>Pick up</small>${portalBranch(next.loc)}<br>${portalWhen(next.start)}</div>
            <div><small>Drop off</small>${portalBranch(dropoffLoc)}<br>${portalWhen(next.end)}</div>
          </div>
          <div class="next-trip-actions">
            <button class="btn-brand btn-sm" onclick="switchDashboardTab('upcoming')">Manage booking</button>
            <button class="btn-ghost" onclick="portalChatAboutBooking('${next.key}')">Chat about this trip</button>
            <button class="btn-wa light" onclick="portalWhatsApp('${next.key}')">${typeof waIcon === 'function' ? waIcon(15) : ''} WhatsApp us</button>
            <a class="btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('GC Tech Car and Truck Rental ' + suburb)}">Directions</a>
          </div>
        </div>
        <div class="next-trip-visual">
          <span class="next-trip-ref">${next.ref}</span>
          <img src="${getVehicleImage(next.vehicle)}" alt="${next.vehicle}">
        </div>
      </div>`;
  }

  document.getElementById('overview-stats').innerHTML = `
    <div class="stat"><small>Upcoming bookings</small><strong>${active.length}</strong></div>
    <div class="stat"><small>Completed hires</small><strong>${past.length}</strong></div>
    <div class="stat"><small>Awaiting your action</small><strong>${needsAction.length}</strong></div>
  `;
}

// ---------- My bookings ----------
function portalBookingCard(b) {
  const st = PORTAL_STATUS[b.status] || PORTAL_STATUS.confirmed;
  const dropoffLoc = b.dropoff && b.dropoff !== 'Same as Pick up' ? b.dropoff : b.loc;
  const raw = b.raw;

  // Mesmo valor e pagamento que a equipe vê na aba Payments do Planner
  // Nada é cobrado antes do pick-up: paga-se na loja, só cartão (sem dinheiro nem transferência)
  let payment = 'Pay at pick-up · card only';
  const money = !b.isMain && typeof feeBookingMoney === 'function' ? feeBookingMoney(raw) : null;
  if (b.status === 'fleet_pending') payment = 'Not charged';
  else if (money && money.paid > 0.004) payment = money.balance > 0.004 ? `$${money.paid.toFixed(2)} paid · $${money.balance.toFixed(2)} due` : `$${money.paid.toFixed(2)} paid`;
  else if (money) payment = `$${money.grand.toFixed(2)} at pick-up · card only`;

  let note = '';
  if (b.status === 'pending') {
    const req = b.isMain ? raw.requestedTime : `${raw.requestedDate || ''}, ${raw.requestedTime || ''}`;
    note = `Requested new pick-up: <strong>${req}</strong> — awaiting approval.`;
  } else if (b.status === 'fleet_pending') {
    note = 'All vehicles of this type are booked for your dates. Our team will offer you an alternative shortly.';
    if (!b.isMain) note += portalAltPreferenceHtml(b);
  } else if (b.status === 'proposal_sent') {
    note = 'Our team has offered an alternative vehicle or time. Review it to keep your booking.';
  }

  let primary = '';
  if (b.status === 'confirmed' || b.status === 'updated') primary = `<button class="btn-brand" onclick="openModal('${b.key}')">Change pick-up time</button>`;
  else if (b.status === 'pending') primary = `<button class="btn-brand" onclick="openModal('${b.key}')">Edit request</button>`;
  else if (b.status === 'proposal_sent') primary = `<button class="btn-brand" onclick="openModal('${b.key}')">Review offer</button>`;

  return `
    <article class="bk-card ${b.status === 'proposal_sent' ? 'attention' : ''}">
      <div class="bk-head">
        <span class="bk-ref">Booking <strong>${b.ref}</strong></span>
        <span class="status-pill ${st.cls}">${st.label}</span>
      </div>
      <div class="bk-body">
        <div class="bk-img"><img src="${getVehicleImage(b.vehicle)}" alt="${b.vehicle}"></div>
        <div>
          <div class="bk-vehicle">${b.vehicle}</div>
          <div class="bk-grid">
            <div><small>Pick up</small>${portalBranch(b.loc)}<br>${portalWhen(b.start)}</div>
            <div><small>Drop off</small>${portalBranch(dropoffLoc)}<br>${portalWhen(b.end)}</div>
            <div><small>Payment</small>${payment}</div>
            ${note ? `<div class="bk-note">${note}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="bk-actions">
        <button class="link-btn danger" onclick="portalCancelBooking('${b.key}')">${b.status === 'fleet_pending' ? 'Withdraw request' : 'Cancel booking'}</button>
        <button class="btn-ghost dark" onclick="portalChatAboutBooking('${b.key}')">Chat about this booking</button>
        <button class="btn-wa" onclick="portalWhatsApp('${b.key}')">${typeof waIcon === 'function' ? waIcon(15) : ''} WhatsApp</button>
        ${primary}
      </div>
    </article>`;
}

// ---------- Preferência de veículo alternativo (reserva sem veículo disponível) ----------
// O agente decide no Agent Requests; o cliente só diz o que serviria se não houver o veículo reservado.
function portalAltPreferenceHtml(b) {
  const pref = b.raw.altPreference;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (!pref) {
    return `
      <div class="alt-pref ask">
        <div><strong>If we can't find a ${esc(b.vehicle)}, what would suit you?</strong>
        <span>Tell us your back-up choice and our team will try it first.</span></div>
        <button type="button" class="btn-brand btn-sm" onclick="portalOpenAltPreference('${b.key}')">Choose a back-up vehicle</button>
      </div>`;
  }
  const choices = fleetAltPreferenceChoices(pref);
  const text = pref.onlyThis
    ? `Only the ${esc(b.vehicle)} — we'll contact you if none is free.`
    : choices.map((c, i) => `<span class="alt-pref-choice">${i ? '2nd' : '1st'} · ${esc(c.model)}</span>`).join('');
  return `
    <div class="alt-pref set">
      <div><strong>Your back-up choice</strong>
      <span class="alt-pref-list">${text}</span>
      ${pref.note ? `<span class="alt-pref-note">“${esc(pref.note)}”</span>` : ''}</div>
      <button type="button" class="link-btn" onclick="portalOpenAltPreference('${b.key}')">Change</button>
    </div>`;
}

let portalAltKey = null;

function portalOpenAltPreference(key) {
  const b = portalFindBooking(key);
  if (!b || b.isMain) return;
  portalAltKey = key;
  const requested = fleetFindCategoryByModel(b.vehicle);
  const pref = b.raw.altPreference || {};
  document.getElementById('alt-title').textContent = `Back-up choice for ${b.ref}`;
  document.getElementById('alt-sub').textContent = `If no ${b.vehicle} is free on your dates, which vehicle would work for you? Our team checks your choices first. Prices may differ and nothing changes until you accept an offer.`;
  document.getElementById('alt-first').innerHTML = fleetAltPreferenceOptions(requested, (pref.choices || [])[0] || '');
  document.getElementById('alt-second').innerHTML = fleetAltPreferenceOptions(requested, (pref.choices || [])[1] || '', 'No second choice');
  document.getElementById('alt-only').checked = !!pref.onlyThis;
  document.getElementById('alt-only-label').textContent = `Only the ${b.vehicle} — please don't offer another vehicle`;
  document.getElementById('alt-note').value = pref.note || '';
  document.getElementById('alt-error').textContent = '';
  portalAltSync();
  document.getElementById('alt-modal').classList.add('open');
}

// "Só o veículo reservado" desliga as escolhas
function portalAltSync() {
  const only = document.getElementById('alt-only').checked;
  document.getElementById('alt-first').disabled = only;
  document.getElementById('alt-second').disabled = only;
  document.getElementById('alt-error').textContent = '';
}

function portalSaveAltPreference() {
  const b = portalFindBooking(portalAltKey);
  if (!b) return;
  const only = document.getElementById('alt-only').checked;
  const res = fleetReadAltPreference(document.getElementById('alt-first').value, document.getElementById('alt-second').value,
    only, document.getElementById('alt-note').value, true);
  if (res.error) { document.getElementById('alt-error').textContent = res.error; return; }
  const pref = res.pref;
  const note = pref.note;

  const list = portalReadJSON(getMultiBookingKey(), []);
  const target = list.find(x => String(x.id) === b.key);
  if (!target) return;
  target.altPreference = pref;
  // Nota na reserva: o agente vê no Agent Requests e no Planner
  (target.notesList = target.notesList || []).push(fleetAltPreferenceNote(b.vehicle, pref, 'Customer (portal)'));
  localStorage.setItem(getMultiBookingKey(), JSON.stringify(list));
  portalLog(b, 'Amended', `Back-up vehicle choice: ${fleetAltPreferenceText(pref)}`, note ? `Customer note: ${note}` : '');
  closeModal('alt-modal');
  renderAll();
  portalToast(only ? `Saved — we'll only look for a ${b.vehicle}.` : 'Saved — our team will try your back-up choice first.');
}

// ---------- Bond em hold (a GC Tech está segurando o bond de um booking já devolvido) ----------
function portalHeldBonds() {
  if (typeof bondAllRecords !== 'function') return [];
  const email = getUserEmail();
  return bondAllRecords().filter(r => String(r.email || '').toLowerCase() === email && bondIsHeld(r));
}

function portalRenderBondHeld() {
  const box = document.getElementById('portal-bond-held');
  if (!box) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  box.innerHTML = portalHeldBonds().map(r => {
    const cat = fleetGetCategory(r.categoryId);
    const req = bondRefundRequest(r);
    return `
      <article class="bk-card bond-card">
        <div class="bk-head">
          <span class="bk-ref">Bond on hold · Booking <strong>${esc(r.ref)}</strong></span>
          <span class="status-pill wait">Held by GC Tech</span>
        </div>
        <div class="bond-body">
          <div class="bond-amount"><small>Bond held</small><strong>${ppMoney(bondHeldAmount(r))}</strong></div>
          <div><small>Vehicle</small>${esc(cat ? cat.model : 'Vehicle')}${r.plate ? ' · ' + esc(r.plate) : ''}<br>Returned ${fleetFormatDate(r.dropoffMs)}</div>
          <div class="bond-why"><small>Why we're holding it</small>${esc(bondHoldCustomerText(r))}</div>
        </div>
        <div class="bk-actions">
          ${req ? `<span class="bond-requested">✓ Refund requested by ${esc(req.channel)} on ${fleetFormatDate(req.at)} — our team will contact you.</span>` : '<span class="bond-hint">Prefer to have it back? Ask us and a team member will refund it to your card.</span>'}
          <button class="btn-brand" onclick="portalBondRefundOpen('${esc(r.id)}')">${req ? 'Ask again' : 'Request a refund'}</button>
        </div>
      </article>`;
  }).join('');
}

let portalBondReqId = null;

// Escolha do canal: o pedido chega à equipe pelo chat, WhatsApp ou e-mail; um agente processa o refund
function portalBondRefundOpen(id) {
  const r = bondGetRecord(id);
  if (!r) return;
  portalBondReqId = id;
  let modal = document.getElementById('bond-req-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'home-modal';
    modal.id = 'bond-req-modal';
    modal.addEventListener('click', e => { if (e.target === modal) closeModal('bond-req-modal'); });
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="home-modal-card bond-req-card">
      <h3>Request your bond refund</h3>
      <p>Booking <strong>${r.ref}</strong> · ${ppMoney(bondHeldAmount(r))}. Choose how to send your request. A member of our team will check it and refund the bond to your card.</p>
      <div class="bond-req-options">
        <button type="button" class="bond-req-opt" onclick="portalBondRefundSend('Live chat')"><span>💬</span><strong>Live chat</strong><small>Talk to the team now</small></button>
        <button type="button" class="bond-req-opt wa" onclick="portalBondRefundSend('WhatsApp')"><span>${typeof waIcon === 'function' ? waIcon(20) : '🟢'}</span><strong>WhatsApp</strong><small>Message us from your phone</small></button>
        <button type="button" class="bond-req-opt" onclick="portalBondRefundSend('Email')"><span>✉️</span><strong>Email</strong><small>support@gctech-rentals.example</small></button>
      </div>
      <div class="home-modal-actions"><button class="btn-ghost dark" onclick="closeModal('bond-req-modal')">Cancel</button></div>
    </div>`;
  modal.classList.add('open');
}

function portalBondRefundText(r) {
  const cat = fleetGetCategory(r.categoryId);
  const name = ((portalGetProfile() || {}).name || '').split(' ')[0];
  return `Hi GC Tech, I'd like to request the refund of my bond of ${ppMoney(bondHeldAmount(r))} held on booking ${r.ref} (${cat ? cat.model : 'vehicle'}, returned ${fleetFormatDate(r.dropoffMs)}). Please refund it to my card.${name ? ` Thanks, ${name}` : ''}`;
}

function portalBondRefundSend(channel) {
  const r = bondGetRecord(portalBondReqId);
  if (!r) return;
  closeModal('bond-req-modal');
  const text = portalBondRefundText(r);
  const done = () => { bondRequestRefund(r.id, channel); renderAll(); };

  if (channel === 'Live chat') {
    const email = getUserEmail();
    const name = (portalGetProfile() || {}).name || 'Customer';
    const sessionId = `${email}_${r.ref}`;
    ensureChatSession(sessionId, email, name, r.ref, `Returned ${fleetFormatDate(r.dropoffMs)}`, r.plate || 'N/A');
    sendChatMessage(sessionId, 'customer', name, text);
    done();
    window.open(`gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}`,
      'gcChat_' + sessionId, 'width=380,height=580');
    portalToast('Request sent in the live chat — our team will reply there.');
  } else if (channel === 'WhatsApp') {
    // Mesma janela do botão WhatsApp, com a mensagem pronta; o pedido é registrado ao enviar
    portalWhatsApp(null);
    portalWaState.key = '';
    document.getElementById('wa-p-booking').value = '';
    const phone = document.getElementById('wa-p-phone');
    if (!phone.value) phone.value = (portalGetProfile() || {}).phone || '0412 345 678';
    document.getElementById('wa-p-text').value = text;
    portalWaState.onSent = done;
  } else {
    // E-mail (simulado no protótipo): chega na caixa de suporte; o pedido fica registrado para a equipe
    done();
    portalToast('Request emailed to support@gctech-rentals.example — our team will reply by email.');
  }
}

function renderAllNewBookings() {
  const bookings = portalCollectBookings();
  const container = document.getElementById('new-booking-container');
  portalRenderBondHeld();
  document.getElementById('nav-upcoming-count').textContent = bookings.length || '';
  container.innerHTML = bookings.length
    ? bookings.map(portalBookingCard).join('')
    : `<div class="empty-state"><h3>No bookings yet</h3><p>When you book a vehicle it will appear here.</p><a href="gc-home.html" class="btn-brand">Book a vehicle</a></div>`;
}

// Activity Log: ações feitas pelo próprio cliente no portal
function portalLog(target, action, details, info) {
  if (typeof fleetLog !== 'function') return;
  const id = target === 'main' || (target && target.isMain) ? 'main-' + getUserEmail() : String(target && target.key ? target.key : target);
  const r = typeof fleetLogRefOf === 'function' ? fleetLogRefOf(id) : { ref: '', plate: '' };
  fleetLog({ bookingId: id, ref: r.ref, plate: r.plate, operator: 'Customer (portal)', action, details, info: info || '' });
}

function portalCancelBooking(key) {
  const b = portalFindBooking(key);
  if (!b) return;
  const isRequest = b.status === 'fleet_pending';
  portalConfirm(
    isRequest ? `Withdraw request ${b.ref}?` : `Cancel booking ${b.ref}?`,
    isRequest ? 'Our team will stop looking for a vehicle for these dates.' : `Your ${b.vehicle} will be released. This can't be undone.`,
    isRequest ? 'Withdraw request' : 'Cancel booking',
    () => {
      if (b.isMain) {
        const state = portalReadJSON(getStorageKey(), {});
        state.status = 'cancelled';
        localStorage.setItem(getStorageKey(), JSON.stringify(state));
      } else {
        const list = portalReadJSON(getMultiBookingKey(), []);
        const target = list.find(x => String(x.id) === b.key);
        if (target) target.status = 'cancelled'; // mantém o registro para o Agent Dashboard
        localStorage.setItem(getMultiBookingKey(), JSON.stringify(list));
      }
      portalLog(b, 'Cancelled', isRequest ? 'Request withdrawn by the customer' : 'Booking cancelled by the customer in My Bookings');
      renderAll();
      portalToast(isRequest ? `Request ${b.ref} withdrawn.` : `Booking ${b.ref} cancelled.`);
    }
  );
}

// ---------- Alterar horário / proposta ----------
function openModal(key) {
  currentModalTarget = String(key);
  const b = portalFindBooking(currentModalTarget);
  if (!b) return;

  if (b.status === 'proposal_sent') {
    const proposal = b.isMain ? portalReadJSON('gc_active_proposal', {}) : (b.raw.proposal || {});
    document.getElementById('proposal-email-body').innerHTML = `
      Hi ${(portalGetProfile() || {}).name || 'there'},<br><br>
      Unfortunately the vehicle you requested is not available for booking <strong>${b.ref}</strong>.
      Here's what we can offer instead:
      <ul>
        <li><strong>Vehicle:</strong> ${proposal.newVehicle || '—'}</li>
        <li><strong>Pick-up:</strong> ${proposal.newTime || '—'}</li>
      </ul><br>
      Accept below to confirm your booking instantly.<br><br>
      — ${proposal.handledBy || 'GC Tech Operations'}
    `;
    document.getElementById('proposal-modal').classList.add('open');
    return;
  }

  const isPending = b.status === 'pending';
  document.getElementById('modal-title-text').textContent = isPending ? 'Edit your change request' : 'Change pick-up time';
  document.getElementById('btn-submit-request').textContent = isPending ? 'Update request' : 'Send request';
  document.getElementById('btn-withdraw').hidden = !isPending;
  document.getElementById('new-time-select').innerHTML = fleetTimeOptions(isNaN(b.start) ? '08:30 AM' : fleetFormatTime(b.start));
  if (!isNaN(b.start)) editDatePicker.setDate(new Date(Math.max(b.start, Date.now())));
  document.getElementById('change-modal').classList.add('open');
}

function submitRequest() {
  const newDate = document.getElementById('new-date-select').value;
  const newTime = document.getElementById('new-time-select').value;
  if (!newDate) { portalToast('Please choose a new pick-up date.', true); return; }

  if (currentModalTarget === 'main') {
    const state = portalReadJSON(getStorageKey(), {});
    state.status = 'pending';
    state.requestedTime = `${newDate}, ${newTime}`;
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } else {
    const list = portalReadJSON(getMultiBookingKey(), []);
    const b = list.find(x => String(x.id) === currentModalTarget);
    if (b) {
      b.status = 'pending';
      b.requestedDate = newDate;
      b.requestedTime = newTime;
      localStorage.setItem(getMultiBookingKey(), JSON.stringify(list));
    }
  }
  portalLog(currentModalTarget, 'Request', `Customer asked to change pick-up to ${newDate}, ${newTime}`, 'Waiting for approval');
  closeModal('change-modal');
  renderAll();
  portalToast("Request sent — we'll update your booking as soon as it's approved.");
}

function withdrawRequest() {
  if (currentModalTarget === 'main') {
    const state = portalReadJSON(getStorageKey(), {});
    state.status = 'confirmed';
    state.requestedTime = null;
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } else {
    const list = portalReadJSON(getMultiBookingKey(), []);
    const b = list.find(x => String(x.id) === currentModalTarget);
    if (b) {
      b.status = 'confirmed';
      b.requestedDate = null;
      b.requestedTime = null;
      localStorage.setItem(getMultiBookingKey(), JSON.stringify(list));
    }
  }
  portalLog(currentModalTarget, 'Request', 'Customer withdrew the change request');
  closeModal('change-modal');
  renderAll();
  portalToast('Change request withdrawn.');
}

function acceptProposal() {
  if (currentModalTarget === 'main') {
    const proposal = portalReadJSON('gc_active_proposal', {});
    const state = portalReadJSON(getStorageKey(), {});
    state.status = 'updated';
    if (proposal.newVehicle) state.vehicle = proposal.newVehicle;
    if (proposal.newTime) state.pickupTime = proposal.newTime.replace(' at ', ', ');
    state.handledBy = proposal.handledBy || 'Agent';
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
    portalLog('main', 'Allocated', `Customer accepted the offer: ${proposal.newVehicle || ''} ${proposal.newTime || ''}`.trim(), 'Booking confirmed');
  } else {
    const key = getMultiBookingKey();
    const list = portalReadJSON(key, []);
    const b = list.find(x => String(x.id) === currentModalTarget);
    if (b && b.proposal) {
      // Nova data proposta mantendo a mesma duração da reserva original
      const oldRange = fleetBookingRange(b);
      let newStart = fleetParseDate(b.proposal.newTime);
      if (isNaN(newStart)) newStart = oldRange.start;
      // Oferta do Availability Engine pode trazer a devolução; senão mantém a duração original
      const offeredEnd = b.proposal.newDropoffISO ? new Date(b.proposal.newDropoffISO).getTime() : NaN;
      const newEnd = offeredEnd > newStart ? offeredEnd : newStart + (oldRange.end - oldRange.start);
      const newVehicle = b.proposal.newVehicle || b.vehicle;

      const plate = fleetFindFreePlate(newVehicle, newStart, newEnd, { ignoreId: b.id });
      b.vehicle = newVehicle;
      fleetApplyRange(b, newStart, newEnd);
      b.handledBy = b.proposal.handledBy || 'Agent';
      b.proposal = null;

      if (plate) {
        b.status = 'updated';
        b.plate = plate;
      } else {
        // O veículo oferecido foi ocupado nesse meio tempo → volta para o agente
        b.status = 'fleet_pending';
        b.plate = null;
        fleetSendToAgentRequests(b, getUserEmail(), null, 'Offered vehicle no longer available — please send a new proposal');
      }
      localStorage.setItem(key, JSON.stringify(list));
      portalLog(currentModalTarget, plate ? 'Allocated' : 'On Request',
        plate ? `Customer accepted the offer: ${newVehicle} (${plate}) ${fleetNoteDateStr(newStart)} to ${fleetNoteDateStr(newEnd)}` : 'Customer accepted the offer, but the vehicle was taken in the meantime',
        plate ? 'Booking confirmed' : 'Back to Agent Requests');

      if (!plate) {
        closeModal('proposal-modal');
        renderAll();
        portalToast('Sorry, that vehicle was just booked. Our team will send you a new option.', true);
        return;
      }
    }
  }
  closeModal('proposal-modal');
  renderAll();
  portalToast('Offer accepted — your booking is confirmed.');
}

// ---------- Past hires ----------
// Locações passadas: as do histórico do portal + as devolvidas do cliente (mesmos dados do Bond Refunds),
// com a situação do bond. Mais recentes primeiro; sem repetir a mesma referência.
function portalPastHires() {
  const stored = portalReadJSON(getPastBookingKey(), []);
  if (typeof bondAllRecords !== 'function') return stored;
  const email = getUserEmail();
  const refs = new Set(stored.map(b => String(b.ref)));
  const returned = bondAllRecords()
    .filter(r => String(r.email || '').toLowerCase() === email && !refs.has(String(r.ref)))
    .sort((a, b) => b.dropoffMs - a.dropoffMs)
    .map(r => {
      const cat = fleetGetCategory(r.categoryId);
      const paid = (r.payments || []).filter(p => p.type !== 'Refund').reduce((s, p) => s + p.amount, 0);
      const refund = bondLastRefund(r);
      const bond = bondIsHeld(r) ? { cls: 'wait', text: `Bond of ${ppMoney(bondHeldAmount(r))} on hold`, action: true }
        : refund ? { cls: 'ok', text: `Bond refunded ${fleetFormatDate(refund.dateMs)}` }
        : bondBalance(r) < 0 ? { cls: 'wait', text: `Bond refund of ${ppMoney(-bondBalance(r))} being processed` } : null;
      return { ref: r.ref, vehicle: cat ? cat.model : 'Vehicle', loc: r.loc,
               dates: `${fleetFormatDate(r.pickupMs)} – ${fleetFormatDate(r.dropoffMs)}`, price: ppMoney(paid), bond };
    });
  return returned.concat(stored);
}

function renderPastBookings() {
  const past = portalPastHires();
  const container = document.getElementById('past-bookings-container');
  if (!past.length) {
    container.innerHTML = `<div class="empty-state"><h3>No past hires</h3><p>Completed rentals will appear here.</p></div>`;
    return;
  }
  container.innerHTML = past.map(b => `
    <article class="bk-card">
      <div class="bk-head">
        <span class="bk-ref">Booking <strong>${b.ref}</strong></span>
        <span class="status-pill done">Completed</span>
      </div>
      <div class="bk-body">
        <div class="bk-img past"><img src="${getVehicleImage(b.vehicle)}" alt="${b.vehicle}"></div>
        <div>
          <div class="bk-vehicle">${b.vehicle}</div>
          <div class="bk-grid">
            <div><small>Location</small>${portalBranch(b.loc)}</div>
            <div><small>Dates</small>${b.dates}</div>
            <div><small>Total paid</small>${b.price}</div>
            ${b.bond ? `<div class="bk-note past-bond ${b.bond.cls}">${b.bond.text}${b.bond.action ? ` · <button type="button" class="link-btn" onclick="switchDashboardTab('upcoming')">See details</button>` : ''}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="bk-actions">
        <button class="btn-ghost dark" onclick="portalToast('Invoice download is simulated in this prototype.')">Download invoice</button>
        <button class="btn-brand" onclick="bookAgain('${b.vehicle}', '${b.loc}')">Book again</button>
      </div>
    </article>`).join('');
}

// Reabre a busca com o mesmo veículo e filial
function bookAgain(vehicle, location) {
  localStorage.setItem('gc_pending_search', JSON.stringify({ vehicle, loc: location, dropoff: 'Same as Pick up' }));
  window.location.href = 'search-results.html';
}

// Helper do protótipo: cria uma locação passada aleatória
function simulatePastBooking() {
  const past = portalReadJSON(getPastBookingKey(), []);
  const vehicles = ['Mitsubishi ASX', 'Toyota Corolla Cross', 'Hybrid Toyota Kluger', 'Toyota Yaris', 'Toyota Camry', 'Toyota Hilux Utility Auto', 'Auto Pantech Truck', 'Hyundai Staria'];
  const locations = Object.values(FLEET_BRANCHES);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const m = pick(months);
  const d1 = Math.floor(Math.random() * 15) + 1;
  const d2 = d1 + Math.floor(Math.random() * 5) + 1;

  past.unshift({
    id: Date.now(),
    ref: 'OR-' + Math.floor(1000 + Math.random() * 9000),
    vehicle: pick(vehicles),
    loc: pick(locations),
    dates: `${d1} ${m} 2026 - ${d2} ${m} 2026`,
    price: '$' + (Math.floor(Math.random() * 300) + 150) + '.00'
  });
  localStorage.setItem(getPastBookingKey(), JSON.stringify(past));
  renderAll();
}

// ---------- Payments (planos de pagamento — dados em gc-payments.js) ----------
const PORTAL_PLAN_STATUS = {
  ok: 'On track', soon: 'Payment due soon', due: 'Payment due today', overdue: 'Payment overdue',
  paused: 'Paused', completed: 'Paid in full', cancelled: 'Cancelled'
};
const PORTAL_PLAN_PILL = { ok: 'ok', soon: 'ok', due: 'wait', overdue: 'action', paused: 'done', completed: 'done', cancelled: 'done' };

function portalGetPlans() {
  const email = getUserEmail();
  return ppLoad().filter(p => p.email === email && p.status !== 'cancelled');
}

function renderPaymentPlans() {
  const plans = portalGetPlans();
  const navBtn = document.getElementById('btn-tab-payments');
  navBtn.hidden = plans.length === 0;
  const attention = plans.filter(p => ['overdue', 'due'].includes(ppStatus(p).key)).length;
  document.getElementById('nav-payments-count').textContent = attention || '';

  const container = document.getElementById('payment-plans-container');
  if (!plans.length) {
    container.innerHTML = `<div class="empty-state"><h3>No payment plans</h3><p>You don't have any payment plans with GC Tech.</p></div>`;
    return;
  }

  const today = ppToday();
  container.innerHTML = plans.map(p => {
    const st = ppStatus(p);
    const paid = ppPaid(p);
    const remaining = p.totalAmount - paid;
    const pct = Math.min(100, Math.round((paid / p.totalAmount) * 100));
    const next = ppNextInstallment(p);
    const last = p.installments[p.installments.length - 1];
    const paidCount = p.installments.filter(i => i.status === 'paid').length;

    let note = '';
    if (st.key === 'overdue') {
      const missed = p.installments.find(i => i.status !== 'paid' && (i.status === 'failed' || i.dueDate < today));
      note = `<div class="plan-note warn">A payment of <strong>${ppMoney(missed.amount)}</strong> due on ${ppFormat(missed.dueDate)} ${missed.status === 'failed' ? 'was declined' : 'was missed'}. Send us a message to pay it now — our team will take it on your card or another card you choose.</div>`;
    } else if (st.key === 'paused') {
      note = `<div class="plan-note">Your plan is currently paused — no payments are due. Chat with us to resume it.</div>`;
    } else if (st.key === 'completed') {
      note = `<div class="plan-note ok">This plan is paid in full. Thank you!</div>`;
    }

    const schedule = p.installments.map(i => {
      const late = i.status !== 'paid' && (i.status === 'failed' || i.dueDate < today);
      const label = i.status === 'paid' ? 'Paid' : i.status === 'failed' ? 'Declined' : late ? 'Missed' : i.dueDate === today ? 'Due today' : 'Upcoming';
      const cls = i.status === 'paid' ? 'ok' : late ? 'action' : i.dueDate === today ? 'wait' : 'done';
      return `<div class="plan-sched-row"><span>#${i.n}</span><span>${ppFormat(i.dueDate, true)}</span><span>${ppMoney(i.amount)}</span><span class="status-pill ${cls}">${label}</span></div>`;
    }).join('');

    return `
      <article class="bk-card plan-card ${st.key === 'overdue' ? 'attention' : ''}">
        <div class="bk-head">
          <span class="bk-ref">Payment plan · Booking <strong>${p.bookingRef}</strong></span>
          <span class="status-pill ${PORTAL_PLAN_PILL[st.key]}">${PORTAL_PLAN_STATUS[st.key]}</span>
        </div>
        <div class="plan-body">
          <div class="plan-reason">${p.reason}</div>
          <div class="plan-figures">
            <div class="plan-balance"><small>Balance remaining</small><strong>${ppMoney(remaining)}</strong></div>
            <div><small>Paid so far</small>${ppMoney(paid)} of ${ppMoney(p.totalAmount)}</div>
            <div><small>Weekly payment</small>${ppMoney(p.weeklyAmount)}</div>
            <div><small>Next payment</small>${next && st.key !== 'completed' ? `${ppFormat(next.dueDate, true)}<br>${ppMoney(next.amount)}` : '—'}</div>
            <div><small>Final payment</small>${ppFormat(last.dueDate)}</div>
          </div>
          <div class="plan-progress"><div style="width: ${pct}%"></div></div>
          <div class="plan-progress-label">${paidCount} of ${p.installments.length} payments made · ${pct}%</div>
          ${note}
          <details class="plan-schedule"><summary>Payment schedule</summary>${schedule}</details>
          <div class="plan-card-line">
            <span>Pay each instalment on or before its date by live chat, WhatsApp or phone — no need to come in. Our team processes the payment on your credit or debit card (you can also pay at any branch). We don't accept cash or bank transfer.</span>
          </div>
        </div>
        ${st.key !== 'completed' ? `
        <div class="bk-actions">
          <button class="btn-ghost dark" onclick="portalChatAboutPlan('${p.id}')">Chat about this plan</button>
          ${(st.key === 'due' || st.key === 'overdue') && next ? `<button class="btn-brand" onclick="portalPayInstalment('${p.id}')">Pay ${ppMoney(next.amount)} now</button>` : ''}
        </div>` : ''}
      </article>`;
  }).join('');
}

// Parcelas são pagas só na loja, cobradas pelo agente (sem pagamento online pelo portal)

function portalChatAboutPlan(planId) {
  const plan = ppLoad().find(p => p.id === planId);
  if (!plan) return;
  const email = getUserEmail();
  const name = (portalGetProfile() || {}).name || plan.customerName;
  const sessionId = `${email}_${plan.bookingRef}`; // mesma conversa do booking — o agente vê o histórico todo
  ensureChatSession(sessionId, email, name, plan.bookingRef, 'Payment plan', plan.plate || 'N/A');
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}`,
    'gcChat_' + sessionId,
    'width=380,height=580'
  );
}

// Pagar a parcela sem ir à loja: abre o chat do plano com o pedido de pagamento já enviado.
// Quem cobra é a equipe (Payment Plans → Charge / Record), no cartão do cliente.
function portalPayInstalment(planId) {
  const plan = ppLoad().find(p => p.id === planId);
  if (!plan) return;
  const next = ppNextInstallment(plan);
  const email = getUserEmail();
  const name = (portalGetProfile() || {}).name || plan.customerName;
  const sessionId = `${email}_${plan.bookingRef}`;
  ensureChatSession(sessionId, email, name, plan.bookingRef, 'Payment plan', plan.plate || 'N/A');
  const text = `Hi, I'd like to pay my payment plan instalment of ${ppMoney(next.amount)} for booking ${plan.bookingRef} (due ${ppFormat(next.dueDate, true)}). Please charge my card on file, or let me know if you need another card.`;
  // Não repete o pedido se o cliente clicar de novo logo em seguida
  const last = getChatMessages(sessionId).filter(m => m.sender === 'customer').slice(-1)[0];
  if (!last || last.text !== text || Date.now() - last.timestamp > 10 * 60000) sendChatMessage(sessionId, 'customer', name, text);
  if (typeof fleetLog === 'function') fleetLog({ bookingId: 'pp-' + plan.bookingRef, ref: plan.bookingRef, plate: plan.plate || '', operator: 'Customer (portal)', action: 'Payment',
    details: `Customer asked to pay payment plan instalment #${next.n} (${ppMoney(next.amount)}) by live chat`, info: 'To be processed by the team' });
  portalChatAboutPlan(planId);
  portalToast('Request sent — our team will take the payment and confirm in the chat.');
}

// ---------- Profile ----------
function portalFillProfile(profile) {
  document.getElementById('profile-edit-name').value = profile.name || '';
  document.getElementById('profile-edit-email').value = profile.email || '';
  document.getElementById('profile-edit-phone').value = profile.phone || '';
  document.getElementById('profile-edit-dob').value = profile.dob || '';
  document.getElementById('profile-edit-licence').value = profile.licence || '';
  document.getElementById('profile-edit-licence-country').value = profile.licenceCountry || 'Australia';
  // Preferência de contato: a mesma que a equipe vê na ficha do cliente
  const pref = fleetContactPref(profile.email || getUserEmail());
  const radio = document.getElementById(pref.channel === 'email' ? 'profile-contact-email' : 'profile-contact-whatsapp');
  if (radio) radio.checked = true;
  const note = document.getElementById('profile-contact-note');
  if (note) note.textContent = pref.whatsapp === false
    ? "We couldn't reach your mobile on WhatsApp, so we're using email. If you've set up WhatsApp since, choose it again and save."
    : '';
}

function saveProfileChanges() {
  const profile = portalGetProfile() || {};
  const name = document.getElementById('profile-edit-name').value.trim();
  if (!name) { portalToast('Please enter your name.', true); return; }

  Object.assign(profile, {
    name,
    phone: document.getElementById('profile-edit-phone').value.trim(),
    dob: document.getElementById('profile-edit-dob').value,
    licence: document.getElementById('profile-edit-licence').value.trim(),
    licenceCountry: document.getElementById('profile-edit-licence-country').value
  });
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));

  // Preferência de contato (cliente escolhendo WhatsApp de novo libera a tentativa por WhatsApp)
  const chosen = (document.querySelector('input[name="profile-contact"]:checked') || {}).value;
  if (chosen) {
    const cur = fleetContactPref(profile.email || getUserEmail());
    const patch = { channel: chosen };
    if (chosen === 'whatsapp' && cur.whatsapp === false) patch.whatsapp = null;
    fleetSetContactPref(profile.email || getUserEmail(), patch, `${profile.name || 'Customer'} (portal)`, 'Customer portal');
  }
  initDashboard();
  portalToast('Profile saved.');
}

// ---------- Chat ----------
function portalChatAboutBooking(key) {
  const b = portalFindBooking(key);
  if (!b) return;
  const email = getUserEmail();
  const name = (portalGetProfile() || {}).name || 'Customer';
  const sessionId = `${email}_${b.ref}`; // mesmo formato do Fleet Planner e do Live Chat
  ensureChatSession(sessionId, email, name, b.ref, portalWhen(b.start), b.raw.plate || (b.isMain ? FLEET_MAIN_BOOKING_PLATE : 'Pending allocation'));
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}`,
    'gcChat_' + sessionId,
    'width=380,height=580'
  );
}

// ---------- WhatsApp (via 3CX) ----------
// Na versão real o botão abre o WhatsApp do cliente (link wa.me para o número da GC Tech) com a
// mensagem e a referência da reserva já preenchidas; a mensagem chega na caixa do 3CX.
// No protótipo a "conversa" é simulada aqui e aparece na caixa WhatsApp do Agent Dashboard.
let portalWaState = null; // { key, bookingId, ref, phone, sent }

function portalWaBookingId(b) {
  return b ? (b.isMain ? 'main-' + getUserEmail() : String(b.key)) : '';
}

function portalWaPhone(b) {
  const profile = portalGetProfile() || {};
  if (b && b.raw && b.raw.phone) return b.raw.phone;
  if (b && b.isMain) return '0412 345 678';
  return profile.phone || '';
}

function portalWaDefaultText(b) {
  const name = ((portalGetProfile() || {}).name || '').split(' ')[0];
  if (!b) return `Hi GC Tech, this is ${name || 'a customer'}. I have a question about hiring a vehicle.`;
  return `Hi GC Tech, this is ${name || 'a customer'} about booking ${b.ref} (${b.vehicle}, pick-up ${portalWhen(b.start)}). `;
}

function portalWhatsApp(key) {
  const bookings = portalCollectBookings().filter(b => isNaN(b.end) || b.end > Date.now());
  const b = key ? portalFindBooking(key) : (bookings[0] || null);
  portalWaState = { key: b ? b.key : '', sent: false };
  let modal = document.getElementById('wa-portal-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'home-modal';
    modal.id = 'wa-portal-modal';
    modal.addEventListener('click', e => { if (e.target === modal) portalWaClose(); });
    document.body.appendChild(modal);
  }
  portalWaRender(true);
  modal.classList.add('open');
}

function portalWaClose() {
  const modal = document.getElementById('wa-portal-modal');
  if (modal) modal.classList.remove('open');
  portalWaState = null;
}

function portalWaRender(resetText) {
  const modal = document.getElementById('wa-portal-modal');
  if (!modal || !portalWaState) return;
  const bookings = portalCollectBookings();
  const b = portalWaState.key ? portalFindBooking(portalWaState.key) : null;
  const phoneInput = document.getElementById('wa-p-phone');
  const phone = phoneInput && !resetText ? phoneInput.value : portalWaPhone(b);
  const textInput = document.getElementById('wa-p-text');
  const text = textInput && !resetText ? textInput.value : portalWaDefaultText(b);
  const esc = portalWaEsc;

  modal.innerHTML = `
    <div class="home-modal-card wide wa-cust">
      <div class="wa-cust-head">
        <span class="wa-cust-logo">${typeof waIcon === 'function' ? waIcon(22) : ''}</span>
        <div>
          <h3>Message us on WhatsApp</h3>
          <p>GC Tech Rentals · usually replies within minutes, 8:00–17:15</p>
        </div>
        <button type="button" class="wa-cust-x" onclick="portalWaClose()" aria-label="Close">✕</button>
      </div>
      <div class="wa-cust-grid">
        <div class="wa-cust-form">
          <div class="of-field"><label>About</label>
            <select id="wa-p-booking" onchange="portalWaState.key = this.value; portalWaRender(true)">
              <option value="">General question</option>
              ${bookings.map(x => `<option value="${esc(x.key)}" ${b && x.key === b.key ? 'selected' : ''}>Booking ${esc(x.ref)} · ${esc(x.vehicle)}</option>`).join('')}
            </select>
          </div>
          <div class="of-field"><label>Your WhatsApp number</label>
            <input type="tel" id="wa-p-phone" value="${esc(phone)}" placeholder="04xx xxx xxx" oninput="clearTimeout(window._waPhoneT); window._waPhoneT = setTimeout(portalWaRefreshChat, 400)">
          </div>
          <div class="of-field"><label>Message</label>
            <textarea id="wa-p-text" rows="5">${esc(text)}</textarea>
          </div>
          <button type="button" class="wa-cust-send" onclick="portalWaSend()">${typeof waIcon === 'function' ? waIcon(16) : ''} Send on WhatsApp</button>
          <p class="wa-cust-note">On your phone this opens WhatsApp with the message ready to send, including your booking number, so our team can find it straight away.
            <span class="wa-cust-proto">Prototype: the message is delivered to the GC Tech team's WhatsApp inbox (via 3CX) without leaving this page.</span></p>
        </div>
        <div class="wa-cust-phone">
          <div class="wa-cust-phone-top"><span class="wa-cust-avatar">O</span><div><strong>GC Tech Rentals</strong><small>Business account</small></div></div>
          <div class="wa-cust-chat" id="wa-p-chat"></div>
        </div>
      </div>
    </div>`;
  portalWaRefreshChat();
}

function portalWaEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Só a conversa (lado direito, "celular do cliente") — não mexe no que está sendo digitado
function portalWaRefreshChat() {
  const chat = document.getElementById('wa-p-chat');
  const input = document.getElementById('wa-p-phone');
  if (!chat || !input) return;
  const phone = input.value.trim();
  const thread = phone.replace(/\D/g, '').length >= 8 && typeof waThread === 'function' ? waThread(phone) : null;
  const msgs = thread ? thread.messages.slice(-12) : [];
  chat.innerHTML = msgs.length ? msgs.map(m => `
    <div class="wa-cust-bubble ${m.dir === 'in' ? 'me' : 'them'}">${m.attachment ? '📷 Photo' : portalWaEsc(m.text)}<span>${fleetFormatTime(m.at)}${m.dir === 'in' ? ' ✓✓' : ''}</span></div>`).join('')
    : '<p class="wa-cust-empty">Your conversation with GC Tech will appear here.</p>';
  chat.scrollTop = chat.scrollHeight;
}

function portalWaSend() {
  if (!portalWaState || typeof waReceive !== 'function') return;
  const phone = document.getElementById('wa-p-phone').value.trim();
  const text = document.getElementById('wa-p-text').value.trim();
  if (phone.replace(/\D/g, '').length < 8) { portalToast('Please enter your WhatsApp number.', true); return; }
  if (!text) { portalToast('Please type a message.', true); return; }
  const b = portalWaState.key ? portalFindBooking(portalWaState.key) : null;
  waReceive({ phone, text, bookingId: portalWaBookingId(b), ref: b ? b.ref : '' });
  // Guarda o número no perfil para as próximas vezes
  const profile = portalGetProfile() || {};
  if (!profile.phone) { profile.phone = phone; localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile)); }
  portalWaState.sent = true;
  if (typeof portalWaState.onSent === 'function') { portalWaState.onSent(); portalWaState.onSent = null; }
  document.getElementById('wa-p-text').value = '';
  portalWaRefreshChat();
  portalToast('Message sent on WhatsApp — our team will reply there.');
}

// Resposta da GC Tech chegou: atualiza a conversa aberta
if (typeof waOnChange === 'function') waOnChange(() => { if (portalWaState) portalWaRefreshChat(); });

// ---------- Init ----------
window.addEventListener('DOMContentLoaded', () => {
  editDatePicker = flatpickr('#new-date-select', { dateFormat: 'd M Y', minDate: 'today', disableMobile: true });
  flatpickr('#profile-edit-dob', { dateFormat: 'd M Y', maxDate: 'today', disableMobile: true });

  ['change-modal', 'proposal-modal', 'confirm-modal'].forEach(id => {
    const modal = document.getElementById(id);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  });

  if (window.location.hash === '#find') switchAuthTab('find');

  if (sessionStorage.getItem(AUTH_KEY) === 'true') {
    showDashboard(window.location.hash === '#upcoming' ? 'upcoming' : 'overview');
  }
});

// Agente aprovou/propôs algo em outra aba → atualiza a tela
window.addEventListener('storage', (e) => {
  if (sessionStorage.getItem(AUTH_KEY) !== 'true') return;
  if (!e.key || e.key === getStorageKey() || e.key === getMultiBookingKey() || e.key === getPastBookingKey() || e.key === 'gc_active_proposal' || e.key === PAYMENT_PLANS_KEY ||
      (typeof BOND_LEDGER_KEY !== 'undefined' && e.key === BOND_LEDGER_KEY)) { // bond em hold / refund feito pela equipe
    renderAll();
  }
});
