// ==========================================
// GC TECH CHECKOUT — Driver → Protection & extras → Review & pay → Confirmação
// Lê a busca de 'gc_pending_search' (gravada por search-results.html) e,
// ao pagar, cria a reserva em 'gc_multi_bookings_<email>' com a mesma regra
// anti-overbooking do resto do sistema (fleetFindFreePlate).
// Depende de: gc-fleet-data.js e gc-chat.js.
// ==========================================

// ⚠️ PREÇOS DE PROTÓTIPO (extras) — substituir pela tabela real da GC Tech.
// O excess já usa os valores reais, definidos por categoria em gc-fleet-data.js (FLEET_EXCESS_TIERS).
const CHECKOUT_EXTRAS = [
  { id: 'childSeat', icon: '🧸', name: 'Child seat (6 months – 4 years)', perDay: 5.50, max: 3 },
  { id: 'booster',   icon: '🪑', name: 'Booster seat (4 years +)',        perDay: 5.50, max: 3 }
];

const checkout = {
  search: null,
  category: null,
  start: NaN,
  end: NaN,
  days: 1,
  step: 1,
  excessId: 'standard',
  extras: { childSeat: 0, booster: 0 },
  hasVehicle: true
};

// ---------- Helpers ----------
function checkoutMoney(n) {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function checkoutBranchLabel(name) {
  return name === 'Same as Pick up' ? 'Same as pick-up' : name.replace('Sydney - ', '').replace('Brisbane - ', '') + (name.startsWith('Brisbane') ? ' (BNE)' : ' (SYD)');
}

function checkoutVal(id) {
  return document.getElementById(id).value.trim();
}

// Duas opções reais por categoria: excess padrão (incluso) ou redução de excess (custo diário)
function checkoutExcessOptions() {
  const t = checkout.category.excess;
  return [
    { id: 'standard', name: 'Standard excess', excess: t.standard, perDay: 0 },
    { id: 'reduced',  name: 'Excess reduction', excess: t.reduced, perDay: t.reducedPerDay, tag: `Save ${checkoutMoney(t.standard - t.reduced)}` }
  ];
}

function checkoutQuote() {
  const c = checkout.category;
  const lines = [{ label: `${checkout.days} day${checkout.days > 1 ? 's' : ''} × ${checkoutMoney(c.rate)}`, amount: c.rate * checkout.days }];

  const excess = checkoutExcessOptions().find(o => o.id === checkout.excessId);
  if (excess.perDay > 0) lines.push({ label: excess.name, amount: excess.perDay * checkout.days });

  CHECKOUT_EXTRAS.forEach(x => {
    const qty = checkout.extras[x.id];
    if (qty > 0) lines.push({ label: `${x.name.split(' (')[0]}${qty > 1 ? ' × ' + qty : ''}`, amount: x.perDay * qty * checkout.days });
  });

  // Caução cobrada junto com a reserva e devolvida depois da devolução do veículo (igual ao RCM / PowerBoard)
  const bond = typeof feeGetItem === 'function' ? feeGetItem('debit-bond').amount : 505.50;
  lines.push({ label: 'Security bond (refunded after return)', amount: bond, bond: true });

  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, total, excess };
}

// ---------- Resumo lateral ----------
function checkoutRenderSummary() {
  const c = checkout.category;
  const s = checkout.search;
  const q = checkoutQuote();
  const titleCase = str => str.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
  const dropoffLoc = s.dropoff && s.dropoff !== 'Same as Pick up' ? s.dropoff : s.loc;

  document.getElementById('summary-card').innerHTML = `
    <div class="summary-img"><img src="../assets/img/${c.img}" alt="${c.model}"></div>
    <div class="summary-body">
      <div class="summary-type">${titleCase(c.name)}</div>
      <div class="summary-model">${c.model}</div>
      <div class="summary-trip">
        <div><small>Pick up</small>${checkoutBranchLabel(s.loc)}<br>${fleetFormatDate(checkout.start)}, ${fleetFormatTime(checkout.start)}</div>
        <div><small>Drop off</small>${checkoutBranchLabel(dropoffLoc)}<br>${fleetFormatDate(checkout.end)}, ${fleetFormatTime(checkout.end)}</div>
      </div>
      <div class="price-lines">
        ${q.lines.map(l => `<div class="price-line"><span>${l.label}</span><span>${checkoutMoney(l.amount)}</span></div>`).join('')}
        <div class="price-line"><span>Damage excess</span><span>${checkoutMoney(q.excess.excess)}</span></div>
      </div>
      <div class="price-total"><span>Total</span><strong>${checkoutMoney(q.total)}</strong></div>
      <div class="price-gst">AUD, incl. GST · paid at pick-up by card · nothing charged now</div>
    </div>
  `;
}

// ---------- Etapas ----------
function checkoutShowStep(step) {
  checkout.step = step;
  [1, 2, 3].forEach(n => { document.getElementById('step-' + n).hidden = n !== step; });
  document.querySelectorAll('#stepper li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
    li.onclick = n < step ? () => checkoutShowStep(n) : null;
  });
  if (step === 3) checkoutRenderReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function checkoutNext(fromStep) {
  if (fromStep === 1 && !checkoutValidateDriver()) return;
  checkoutShowStep(fromStep + 1);
}

function checkoutValidateDriver() {
  const errorEl = document.getElementById('step-1-error');
  const required = [['co-fname', 'first name'], ['co-lname', 'last name'], ['co-email', 'email'], ['co-phone', 'mobile'], ['co-licence', 'licence number']];
  document.querySelectorAll('#step-1 .of-field.invalid').forEach(f => f.classList.remove('invalid'));

  const missing = required.filter(([id]) => !checkoutVal(id));
  missing.forEach(([id]) => document.getElementById(id).closest('.of-field').classList.add('invalid'));
  if (missing.length) {
    errorEl.textContent = 'Please fill in: ' + missing.map(m => m[1]).join(', ') + '.';
    return false;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(checkoutVal('co-email'))) {
    document.getElementById('co-email').closest('.of-field').classList.add('invalid');
    errorEl.textContent = 'Please enter a valid email address.';
    return false;
  }
  errorEl.textContent = '';
  return true;
}

function checkoutRenderExcess() {
  document.getElementById('excess-options').innerHTML = checkoutExcessOptions().map(o => `
    <button type="button" class="option-card ${o.id === checkout.excessId ? 'selected' : ''}" onclick="checkoutSelectExcess('${o.id}')">
      ${o.tag ? `<span class="opt-tag">${o.tag}</span>` : ''}
      <span class="opt-name">${o.name}</span>
      <span class="opt-excess">Excess ${checkoutMoney(o.excess)}</span>
      <span class="opt-price">${o.perDay ? '+' + checkoutMoney(o.perDay) + '/day' : 'Included'}</span>
    </button>
  `).join('');
}

function checkoutSelectExcess(id) {
  checkout.excessId = id;
  checkoutRenderExcess();
  checkoutRenderSummary();
}

function checkoutRenderExtras() {
  document.getElementById('extras-list').innerHTML = CHECKOUT_EXTRAS.map(x => `
    <div class="extra-row">
      <span class="extra-icon">${x.icon}</span>
      <div class="extra-info"><strong>${x.name}</strong><span>${checkoutMoney(x.perDay)} per day</span></div>
      <div class="qty">
        <button type="button" onclick="checkoutChangeExtra('${x.id}', -1)" aria-label="Remove">−</button>
        <span>${checkout.extras[x.id]}</span>
        <button type="button" onclick="checkoutChangeExtra('${x.id}', 1)" aria-label="Add">+</button>
      </div>
    </div>
  `).join('');
}

function checkoutChangeExtra(id, delta) {
  const extra = CHECKOUT_EXTRAS.find(x => x.id === id);
  checkout.extras[id] = Math.min(extra.max, Math.max(0, checkout.extras[id] + delta));
  checkoutRenderExtras();
  checkoutRenderSummary();
}

function checkoutRenderReview() {
  const s = checkout.search;
  const q = checkoutQuote();
  const extrasText = CHECKOUT_EXTRAS.filter(x => checkout.extras[x.id] > 0)
    .map(x => `${checkout.extras[x.id]} × ${x.name}`).join('<br>') || 'No extras';
  const dropoffLoc = s.dropoff && s.dropoff !== 'Same as Pick up' ? s.dropoff : s.loc;

  document.getElementById('review-grid').innerHTML = `
    <div class="review-block">
      <h4>Driver <button onclick="checkoutShowStep(1)">Edit</button></h4>
      ${checkoutVal('co-fname')} ${checkoutVal('co-lname')}<br>${checkoutVal('co-email')}<br>${checkoutVal('co-phone')}<br>
      Licence ${checkoutVal('co-licence')} (${checkoutVal('co-licence-country')})
    </div>
    <div class="review-block">
      <h4>Trip <a class="text-link" href="gc-home.html" style="font-size:12px;text-transform:none;letter-spacing:0;">Change</a></h4>
      ${checkout.category.model}<br>
      ${checkoutBranchLabel(s.loc)} · ${fleetFormatDate(checkout.start)} ${fleetFormatTime(checkout.start)}<br>
      → ${checkoutBranchLabel(dropoffLoc)} · ${fleetFormatDate(checkout.end)} ${fleetFormatTime(checkout.end)}
    </div>
    <div class="review-block">
      <h4>Protection <button onclick="checkoutShowStep(2)">Edit</button></h4>
      ${q.excess.name}<br>Excess ${checkoutMoney(q.excess.excess)}
    </div>
    <div class="review-block">
      <h4>Extras <button onclick="checkoutShowStep(2)">Edit</button></h4>
      ${extrasText}
    </div>
  `;

  // Cartão confirma a reserva, mas nada é cobrado online: o total é pago na loja, no pick-up
  const cardName = document.getElementById('co-card-name');
  if (cardName && !cardName.value) cardName.value = `${checkoutVal('co-fname')} ${checkoutVal('co-lname')}`.trim();
  const payTotal = document.getElementById('co-pay-total');
  if (payTotal) payTotal.innerHTML = `total of <strong>${checkoutMoney(q.total)}</strong>`;
  document.getElementById('co-pay-btn').textContent = checkout.hasVehicle
    ? 'Confirm booking · pay at pick-up'
    : 'Send booking request';
  checkoutRenderAltBox();
}

// ---------- Sem veículo: alternativa preferida (a mesma escolha do Customer Portal) ----------
function checkoutRenderAltBox() {
  const box = document.getElementById('co-alt-box');
  box.hidden = checkout.hasVehicle;
  if (checkout.hasVehicle || box.dataset.ready) return; // monta uma vez só: mantém o que o cliente escolheu
  box.dataset.ready = '1';
  const c = checkout.category;
  document.getElementById('co-alt-title').textContent = `If no ${c.model} is free`;
  document.getElementById('co-alt-sub').textContent = `Every ${c.model} is booked for your dates. Tell us what else would work and our team will try it first. Prices may differ and nothing changes until you accept an offer.`;
  document.getElementById('co-alt-first').innerHTML = fleetAltPreferenceOptions(c, '');
  document.getElementById('co-alt-second').innerHTML = fleetAltPreferenceOptions(c, '', 'No second choice');
  document.getElementById('co-alt-only-label').textContent = `Only the ${c.model} — please don't offer another vehicle`;
}

function checkoutAltSync() {
  const only = document.getElementById('co-alt-only').checked;
  document.getElementById('co-alt-first').disabled = only;
  document.getElementById('co-alt-second').disabled = only;
  document.getElementById('step-3-error').textContent = '';
}

// { pref } (null = não escolheu) ou { error }
function checkoutReadAlt() {
  if (checkout.hasVehicle) return { pref: null };
  return fleetReadAltPreference(checkoutVal('co-alt-first'), checkoutVal('co-alt-second'),
    document.getElementById('co-alt-only').checked, checkoutVal('co-alt-note'), false);
}

// ---------- Confirmar ----------
function checkoutConfirm() {
  const errorEl = document.getElementById('step-3-error');
  if (!document.getElementById('co-terms').checked) {
    errorEl.textContent = 'Please accept the terms & conditions to continue.';
    return;
  }
  if (!fleetOneWayAllowed(checkout.search.loc, checkout.search.dropoff)) {
    errorEl.textContent = FLEET_ONE_WAY_MESSAGE;
    return;
  }
  const alt = checkoutReadAlt();
  if (alt.error) { errorEl.textContent = alt.error; return; }
  const card = checkoutReadCard();
  if (card.error) { errorEl.textContent = card.error; return; }
  errorEl.textContent = '';
  const btn = document.getElementById('co-pay-btn');
  btn.disabled = true;
  btn.textContent = 'Processing…';
  setTimeout(checkoutCreateBooking, 900); // simula o processamento do pagamento
}

// Cartão do cliente (formulário seguro do PowerBoard no sistema real). Só valida e guarda
// bandeira + 4 últimos dígitos como token. NÃO cobra nada: o agente cobra no pick-up.
function checkoutReadCard() {
  const name = checkoutVal('co-card-name');
  const digits = checkoutVal('co-card-number').replace(/\D/g, '');
  const m = /^(\d{2})\/(\d{2})$/.exec(checkoutVal('co-card-exp'));
  const cvc = checkoutVal('co-card-cvc').replace(/\D/g, '');
  if (!name) return { error: 'Please enter the name on the card.' };
  if (digits.length < 13 || digits.length > 19) return { error: 'Please enter a valid card number.' };
  if (!m || +m[1] < 1 || +m[1] > 12) return { error: 'Please enter the card expiry as MM/YY.' };
  const expMonth = +m[1], expYear = 2000 + +m[2];
  const now = new Date();
  if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) return { error: 'This card has expired. Please use another card.' };
  if (cvc.length < 3) return { error: 'Please enter the 3 or 4 digit CVC.' };
  return { brand: digits[0] === '4' ? 'visa' : digits[0] === '3' ? 'amex' : 'mastercard', last4: digits.slice(-4), holder: name.toUpperCase(), expMonth, expYear };
}

function checkoutSaveCard(email, bookingId, card) {
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
  const saved = { id: 'card-' + Date.now().toString(36), ...card, addedBy: 'GC Tech Website', addedAt: Date.now() };
  const cards = read('gc_pb_cards');
  (cards[email] = cards[email] || []).push(saved);
  localStorage.setItem('gc_pb_cards', JSON.stringify(cards));
  const sel = read('gc_pb_selected');
  sel[String(bookingId)] = saved.id;
  localStorage.setItem('gc_pb_selected', JSON.stringify(sel));
  return saved;
}

function checkoutCardLabel(c) {
  return `${{ visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex' }[c.brand] || 'Card'} ending ${c.last4}`;
}

function checkoutCreateBooking() {
  const s = checkout.search;
  const q = checkoutQuote();
  const email = checkoutVal('co-email').toLowerCase();
  const fname = checkoutVal('co-fname');
  const lname = checkoutVal('co-lname');
  const fullName = `${fname} ${lname}`;

  const booking = {
    id: Date.now(),
    ref: 'OR-' + Math.floor(1000 + Math.random() * 9000),
    vehicle: checkout.category.model,
    plate: null,
    fname, lname,
    phone: checkoutVal('co-phone'),
    licence: checkoutVal('co-licence'),
    licenceCountry: checkoutVal('co-licence-country'),
    driverAge: checkoutVal('co-age'),
    flight: checkoutVal('co-flight'),
    loc: s.loc,
    dropoff: s.dropoff || 'Same as Pick up',
    source: 'Direct Website',
    excessOption: q.excess.id,
    extras: { ...checkout.extras },
    priceTotal: Math.round(q.total * 100) / 100,
    status: 'confirmed'
  };
  fleetApplyRange(booking, checkout.start, checkout.end);

  // Anti-overbooking na hora de pagar (alguém pode ter reservado enquanto o cliente preenchia)
  const plate = fleetFindFreePlate(booking.vehicle, checkout.start, checkout.end);
  // Nada é cobrado antes do pick-up: o agente cobra na loja (cartão via PowerBoard)
  booking.amountPaid = 0;
  if (plate) {
    booking.plate = plate;
    booking.paymentStatus = 'pay_at_pickup';
  } else {
    booking.status = 'fleet_pending';
    booking.paymentStatus = 'not_charged';
    // Alternativa que o cliente escolheu no checkout (aparece no Agent Requests e em My Bookings)
    const alt = checkoutReadAlt();
    if (alt.pref) {
      booking.altPreference = alt.pref;
      booking.notesList = [fleetAltPreferenceNote(booking.vehicle, alt.pref, 'Customer (website)')];
    }
  }

  // Mesmo formato do RCM (aba Booking Fees / Payments do Planner): diária, excess, extras e bond
  if (typeof feeDefaults === 'function') {
    const fees = feeDefaults(checkout.category, q.excess.id, checkout.extras);
    const calc = feeCalc(fees, checkout.category, checkout.days);
    booking.fees = { ...fees, days: checkout.days, total: Number(calc.total.toFixed(2)), extras: Number(calc.extras.toFixed(2)), grandTotal: Number(calc.grand.toFixed(2)) };
    booking.paidSnapshot = []; // pago no pick-up, pelo agente
  }

  // Cartão guardado para confirmar a reserva (token do PowerBoard), sem cobrança
  const card = checkoutReadCard();
  const savedCard = card.error ? null : checkoutSaveCard(email, booking.id, card);
  if (savedCard) booking.cardOnFile = { brand: savedCard.brand, last4: savedCard.last4 };

  const key = 'gc_multi_bookings_' + email;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.unshift(booking);
  localStorage.setItem(key, JSON.stringify(list));

  // Como o cliente quer ser avisado (fica no cadastro dele; a equipe vê na ficha)
  const contact = (document.querySelector('input[name="co-contact"]:checked') || {}).value || 'whatsapp';
  const prevPref = fleetContactPref(email);
  fleetSetContactPref(email, contact === 'whatsapp' && prevPref.whatsapp === false ? { channel: contact, whatsapp: null } : { channel: contact }, fullName, 'Booking form');

  // Activity Log: entrada pelo site (+ alocação e pagamento)
  {
    const code = fleetLogBranchCode(s.loc);
    const dcode = s.dropoff && s.dropoff !== 'Same as Pick up' ? fleetLogBranchCode(s.dropoff) : code;
    const days = fleetLogDays(checkout.start, checkout.end);
    fleetLog({ bookingId: booking.id, ref: booking.ref, operator: 'Online Booking', action: '',
      details: `Booking entered webApi3, ${fleetLogTripText(checkout.category.name, '', code, checkout.start, dcode, checkout.end)}, Rate = ${days} days x $${Number(checkout.category.rate).toFixed(2)}, Insurance ${q.excess.name || q.excess.id}`,
      info: plate ? 'Not charged · pay at pick-up' : 'No vehicle available, not charged', total: booking.priceTotal });
    if (plate) {
      fleetLog({ bookingId: booking.id, ref: booking.ref, plate, operator: '', action: 'Allocated', details: `Booking allocated to ${plate}`, info: `Allocated via API to ${plate}` });
    }
    if (savedCard) fleetLog({ bookingId: booking.id, ref: booking.ref, plate: plate || '', operator: 'Online Booking', action: 'Payment',
      details: `Card saved to confirm the booking: ${checkoutCardLabel(savedCard)}`, info: 'via PowerBoard · not charged, payment taken at pick-up' });
  }
  if (!plate) fleetSendToAgentRequests(booking, email, fullName);
  if (booking.altPreference) {
    fleetLog({ bookingId: booking.id, ref: booking.ref, operator: 'Online Booking', action: 'Amended',
      details: `Back-up vehicle choice: ${fleetAltPreferenceText(booking.altPreference)}`, info: booking.altPreference.note ? `Customer note: ${booking.altPreference.note}` : 'Chosen at checkout' });
  }

  // O cliente fica "logado" no portal com o e-mail da reserva
  localStorage.setItem('gc_user_profile', JSON.stringify({ name: fullName, email, mode: 'guest' }));
  sessionStorage.setItem('gc_auth_poc', 'true');
  localStorage.removeItem('gc_pending_search');

  checkoutRenderConfirmation(booking, !!plate);
}

function checkoutRenderConfirmation(booking, confirmed) {
  document.getElementById('checkout-main').hidden = true;
  document.getElementById('stepper').hidden = true;
  const el = document.getElementById('confirmation');
  el.hidden = false;
  const dropoffLoc = booking.dropoff !== 'Same as Pick up' ? booking.dropoff : booking.loc;

  el.innerHTML = `
    <div class="confirm-card">
      <div class="confirm-head ${confirmed ? '' : 'pending'}">
        <div class="confirm-icon">${confirmed ? '✅' : '⏳'}</div>
        <h1>${confirmed ? "You're booked!" : 'Request received'}</h1>
        <div class="confirm-ref">Booking reference <strong>${booking.ref}</strong></div>
      </div>
      <div class="confirm-body">
        <div><h4>Vehicle</h4>${booking.vehicle}</div>
        <div><h4>Payment</h4>${confirmed ? `${checkoutMoney(booking.priceTotal)} AUD, paid at pick-up (bond included).` : 'Not charged — our team will confirm first.'}${booking.cardOnFile ? `<br>${checkoutCardLabel(booking.cardOnFile)} saved to confirm the booking — nothing charged now.` : ''}</div>
        <div><h4>Pick up</h4>${checkoutBranchLabel(booking.loc)}<br>${booking.date}, ${booking.time}</div>
        <div><h4>Drop off</h4>${checkoutBranchLabel(dropoffLoc)}<br>${booking.dropoffDate}, ${booking.dropoffTime}</div>
        ${confirmed ? '' : `<div style="grid-column: 1 / -1; color: #9a3412;">All ${booking.vehicle} vehicles are booked for these dates. An GC Tech agent will offer you the closest alternative — you can accept it in My Bookings.${booking.altPreference
          ? `<br><strong>Your back-up choice:</strong> ${fleetAltPreferenceText(booking.altPreference)}. You can change it in My Bookings.`
          : '<br>Tip: tell us which other vehicle would suit you in My Bookings, and our team will try it first.'}</div>`}
      </div>
      <div class="confirm-email">📧 A confirmation has been sent to <strong>${checkoutVal('co-email')}</strong> (simulated in this prototype).</div>
      <div class="confirm-actions">
        <a href="customer-portal.html#upcoming" class="btn-orange">Manage my booking</a>
        <button class="btn-ghost dark" onclick="checkoutChatAboutBooking('${booking.ref}', '${booking.plate || 'Pending allocation'}')">💬 Chat about this booking</button>
        <a href="gc-home.html" class="btn-ghost dark">Back to home</a>
      </div>
    </div>
  `;
  window.scrollTo({ top: 0 });
}

// ---------- Chat ----------
function checkoutChatAboutBooking(ref, plate) {
  const email = checkoutVal('co-email').toLowerCase();
  const name = `${checkoutVal('co-fname')} ${checkoutVal('co-lname')}`;
  const sessionId = `${email}_${ref}`; // mesmo formato usado pelo Fleet Planner e pelo Live Chat
  ensureChatSession(sessionId, email, name, ref, `${fleetFormatDate(checkout.start)} ${fleetFormatTime(checkout.start)}`, plate);
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&sessionId=${encodeURIComponent(sessionId)}`,
    'gcChat_' + sessionId,
    'width=380,height=580'
  );
}

function checkoutOpenChat() {
  let email = checkoutVal('co-email').toLowerCase();
  let name = `${checkoutVal('co-fname')} ${checkoutVal('co-lname')}`.trim();
  if (!email) {
    try {
      const profile = JSON.parse(localStorage.getItem('gc_user_profile'));
      if (profile) { email = profile.email; name = name || profile.name; }
    } catch (e) {}
  }
  if (!email) {
    document.getElementById('step-1-error').textContent = 'Enter your name and email first so our agent knows who you are.';
    checkoutShowStep(1);
    return;
  }
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name || 'Customer')}`,
    'gcChatCustomer',
    'width=380,height=580'
  );
}

// ---------- Init ----------
function checkoutPrefillDriver() {
  if (sessionStorage.getItem('gc_auth_poc') !== 'true') return;
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem('gc_user_profile')); } catch (e) {}
  if (!profile) return;
  const parts = (profile.name || '').trim().split(/\s+/);
  document.getElementById('co-fname').value = parts.length > 1 ? parts.slice(0, -1).join(' ') : (parts[0] || '');
  document.getElementById('co-lname').value = parts.length > 1 ? parts[parts.length - 1] : '';
  document.getElementById('co-email').value = profile.email || '';
  document.getElementById('signin-hint').hidden = true;
  // Cliente que já tem cadastro: começa com a preferência de contato dele
  if (profile.email) {
    const pref = fleetContactPref(profile.email);
    const radio = document.getElementById(pref.channel === 'email' ? 'co-contact-email' : 'co-contact-whatsapp');
    if (radio) radio.checked = true;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  let search = null;
  try { search = JSON.parse(localStorage.getItem('gc_pending_search')); } catch (e) {}
  const category = search ? fleetFindCategoryByModel(search.vehicle) : null;

  const start = search ? fleetParseDate(`${search.date} ${search.time}`) : NaN;
  let end = search ? fleetParseDate(`${search.dropoffDate || ''} ${search.dropoffTime || ''}`) : NaN;
  if (!isNaN(start) && (isNaN(end) || end <= start)) end = start + FLEET_DAY_MS;

  // Busca inválida, ou devolução em outra cidade (sem one-way entre Sydney e Brisbane): volta para a busca
  if (!category || isNaN(start) || !fleetOneWayAllowed(search.loc, search.dropoff)) {
    document.getElementById('checkout-main').hidden = true;
    document.getElementById('stepper').hidden = true;
    document.getElementById('empty-checkout').hidden = false;
    return;
  }

  Object.assign(checkout, {
    search, category, start, end,
    days: Math.max(1, Math.ceil((end - start) / FLEET_DAY_MS)),
    hasVehicle: !!fleetFindFreePlate(category.model, start, end)
  });

  document.getElementById('availability-warning').hidden = checkout.hasVehicle;
  checkoutPrefillDriver();
  checkoutRenderExcess();
  checkoutRenderExtras();
  checkoutRenderSummary();
  checkoutShowStep(1);
});
