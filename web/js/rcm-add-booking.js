// A frota (modelos, placas, disponibilidade) vem de js/gc-fleet-data.js,
// carregado antes deste arquivo — a mesma fonte usada pelo Fleet Planner.

// Guarda a placa vinda do Fleet Planner (se houver) para uso em submitBooking()
let incomingPlate = null;

function switchTab(tabId, element) {
  document.querySelectorAll('.rcm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.rcm-tab-content').forEach(c => c.classList.remove('active'));

  if (!element) element = Array.from(document.querySelectorAll('.rcm-tab')).find(t => (t.getAttribute('onclick') || '').includes(`'${tabId}'`));
  if (element) element.classList.add('active');
  const targetTab = document.getElementById('tab-' + tabId);
  if (targetTab) targetTab.classList.add('active');
  if (tabId === 'payments') abPayRender();
}

function updateVehicleModels() {
  const categorySelect = document.getElementById('rcm-category');
  const vehicleSelect = document.getElementById('rcm-vehicle');
  if (!categorySelect || !vehicleSelect) return;

  const selectedSection = categorySelect.value; // 'Passenger' | 'Commercial'
  vehicleSelect.innerHTML = FLEET_CATEGORIES
    .filter(c => c.section === selectedSection)
    .map(c => `<option value="${c.model}">${c.model} — ${c.name}</option>`)
    .join('');
}

// ==========================================
// ABA BOOKING FEES — mesmo catálogo e cálculo da aba Booking Fees do Fleet Planner
// (js/gc-fees-data.js). Gravado em booking.fees no mesmo formato, então a reserva
// abre no Planner com as mesmas linhas, totais e saldo.
// ==========================================
function abVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function abCategory() {
  const sel = document.getElementById('rcm-vehicle');
  return sel ? fleetFindCategoryByModel(sel.value) : null;
}

// Dias cobrados pelas datas da aba Booking Details (mínimo 1), como no Planner
function abDays() {
  const { s, e } = abReadRange();
  if (isNaN(s) || isNaN(e) || e <= s) return 1;
  return Math.max(1, Math.ceil((e - s) / FLEET_DAY_MS));
}

function abFeInit() {
  const opts = list => list.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  document.getElementById('ab-fe-discount').innerHTML = '<option value="">Please select...</option>' + opts(FEE_DISCOUNTS);
  // Kms: segue a política da categoria; se o agente trocar, vale a escolha dele
  const kmsSel = document.getElementById('ab-fe-kms');
  kmsSel.innerHTML = opts(FEE_KMS.filter(k => !k.legacy));
  kmsSel.addEventListener('change', () => { kmsSel.dataset.manual = '1'; });

  // Padrão de todo booking novo: diária da categoria, Standard Excess e o Visa/MC Debit Bond
  const defaults = feeDefaults(abCategory(), 'standard');
  const selected = {};
  defaults.items.forEach(i => { selected[i.id] = i; });
  document.getElementById('ab-fe-items').innerHTML = FEE_GROUPS.map(g =>
    `<tr class="fe-group"><td colspan="5">${g.label}</td></tr>` +
    FEE_ITEMS.filter(i => i.kind === g.kind).map(i => {
      const sel = selected[i.id];
      return `<tr data-fee="${i.id}" class="${sel ? 'on' : ''}">
        <td>${i.name}${i.bond ? ' <span class="fe-tag">BOND</span>' : ''}</td>
        <td class="c"><input type="checkbox" class="fe-sel" ${sel ? 'checked' : ''} onchange="abFeRecalc()"></td>
        <td class="c"><input type="number" class="fe-qty" min="1" step="1" value="${sel ? sel.qty : 1}" oninput="abFeRecalc()"></td>
        <td class="r"><input type="number" class="fe-amt" step="0.01" value="${i.amount.toFixed(2)}" oninput="abFeRecalc()">${i.kind === 'percent' ? ' %' : ''}</td>
        <td class="r fe-line">—</td>
      </tr>`;
    }).join('')
  ).join('');
  abFeSyncCategory();
}

// Trocou o modelo: diária e opções de excess da categoria nova (mantém Standard/Reduction escolhido)
function abFeSyncCategory() {
  const cat = abCategory();
  const ins = document.getElementById('ab-fe-insurance');
  if (!ins) return;
  const keep = ins.value || 'standard';
  ins.innerHTML = feeExcessOptions(cat).map(o => `<option value="${o.id}">${o.name}, ${feeMoney(o.daily)} Daily</option>`).join('');
  ins.value = keep;
  const kmsSel = document.getElementById('ab-fe-kms');
  if (kmsSel && kmsSel.dataset.manual !== '1') kmsSel.value = feeKmsDefault(cat);
  document.getElementById('ab-fe-rate').value = Number(cat ? cat.rate : 0).toFixed(2);
  abFeSyncDays();
}

function abFeSyncDays() {
  const el = document.getElementById('ab-fe-days');
  if (!el) return;
  el.value = abDays();
  abFeRecalc();
}

function abFeCompute() {
  const days = Math.max(1, Math.floor(Number(document.getElementById('ab-fe-days').value) || 1));
  const rows = Array.from(document.querySelectorAll('#ab-fe-items tr[data-fee]')).map(tr => ({
    tr,
    item: feeGetItem(tr.dataset.fee),
    on: tr.querySelector('.fe-sel').checked,
    qty: Number(tr.querySelector('.fe-qty').value),
    amount: Number(tr.querySelector('.fe-amt').value) || 0
  }));
  const fees = {
    days,
    rate: Number(document.getElementById('ab-fe-rate').value) || 0,
    discount: document.getElementById('ab-fe-discount').value,
    insurance: document.getElementById('ab-fe-insurance').value,
    kms: document.getElementById('ab-fe-kms').value,
    kmsManual: document.getElementById('ab-fe-kms').dataset.manual === '1',
    items: rows.filter(r => r.on).map(r => ({ id: r.item.id, qty: r.qty, amount: r.amount }))
  };
  return { fees, rows, calc: feeCalc(fees, abCategory(), days) };
}

function abFeRecalc() {
  const { rows, calc } = abFeCompute();
  rows.forEach(r => {
    const line = calc.lines.find(l => l.id === r.item.id);
    r.tr.classList.toggle('on', r.on);
    r.tr.querySelector('.fe-line').textContent = r.on && line ? feeMoney(line.total) : '—';
  });
  document.getElementById('ab-fe-hire-total').textContent = feeMoney(calc.hire);
  document.getElementById('ab-fe-sum-total').textContent = feeMoney(calc.total);
  document.getElementById('ab-fe-sum-extras').textContent = feeMoney(calc.extras);
  document.getElementById('ab-fe-sum-grand').textContent = feeMoney(calc.grand);
  if (document.getElementById('tab-payments').classList.contains('active')) abPayRender();
}

function abFeRead() {
  const { fees, rows, calc } = abFeCompute();
  if (fees.rate < 0) return { error: 'The daily rate can\'t be negative.' };
  const bad = rows.find(r => r.on && (!Number.isInteger(r.qty) || r.qty < 1));
  if (bad) return { error: `Quantity for "${bad.item.name}" must be a whole number of 1 or more.` };
  return { data: { ...fees, total: Number(calc.total.toFixed(2)), extras: Number(calc.extras.toFixed(2)), grandTotal: Number(calc.grand.toFixed(2)) } };
}

// ==========================================
// ABA PAYMENTS — mesmo painel PowerBoard da aba Payments do Planner.
// Regra da GC Tech: nada é cobrado antes do pick-up. O agente cobra na loja, no pick-up, só cartão
// de crédito ou débito (sem dinheiro nem transferência). Aqui só se escolhe o cartão que será usado.
// ==========================================
let abPay = { cardId: null };

function abPayCustomer() {
  const v = id => (document.getElementById(id) || {}).value || '';
  return { email: v('rcm-email').trim().toLowerCase(), fname: v('rcm-firstname').trim(), lname: v('rcm-lastname').trim() };
}

function abPayCards() {
  const c = abPayCustomer();
  return c.email ? pbCardsFor(c.email, c) : [];
}

function abPaySelectedCard() {
  const cards = abPayCards();
  return cards.find(c => c.id === abPay.cardId) || cards.filter(c => !pbCardExpired(c)).slice(-1)[0] || null;
}

function abPaySelect(cardId) { abPay.cardId = cardId; abPayRender(); }

function abPayRender() {
  const box = document.getElementById('ab-pay-panel');
  if (!box) return;
  const cust = abPayCustomer();
  const cards = abPayCards();
  const selected = abPaySelectedCard();
  const { calc, fees } = abFeCompute();
  const bondItem = fees.items.find(i => (feeGetItem(i.id) || {}).bond);
  box.innerHTML = `
    <div class="pb-grid">
      <section class="pb-card">
        <div class="pb-head"><h3>Payment Controls</h3><span class="pb-via">via PowerBoard</span></div>
        <div class="pb-lines">
          <div><span>Booking total</span><strong>${pbMoney(calc.grand)}</strong></div>
          <div><span>Amount paid</span><strong>${pbMoney(0)}</strong></div>
          <div class="pb-bal ${calc.grand > 0 ? 'due' : ''}"><span>Due at pick-up</span><strong>${pbMoney(calc.grand)}</strong></div>
        </div>
        ${bondItem ? `<div class="pb-bond">🔒 Bond ${pbMoney(bondItem.amount * bondItem.qty)} charged at pick-up · refunded to the card after the vehicle is returned</div>` : ''}
        <ul class="ab-pay-rules">
          <li><b>Nothing is charged now.</b> The total is charged at the branch, at pick-up, in the booking's Payments tab.</li>
          <li>Credit or debit card in the main driver's name only.</li>
          <li>No cash or bank transfer.</li>
        </ul>
      </section>

      <section class="pb-card">
        <div class="pb-head"><h3>Payment Methods</h3><span class="pb-muted small">${cards.length} saved · card to use at pick-up</span></div>
        ${cust.email ? `<div class="pb-cards">
          ${cards.map(c => {
            const expired = pbCardExpired(c), expiring = pbCardExpiring(c), isSel = selected && c.id === selected.id;
            return `
            <button type="button" class="pb-cc${isSel ? ' sel' : ''}${expired ? ' expired' : ''}" onclick="abPaySelect('${pbEsc(c.id)}')">
              <span class="pb-cc-top"><strong>${pbBrandLabel(c.brand)}</strong> <em>via PowerBoard</em>${isSel ? '<span class="pb-selected">✓ Selected</span>' : ''}</span>
              <span>Holder: <b>${pbEsc(c.holder)}</b></span>
              <span>Card number ends with: <b>${pbEsc(c.last4)}</b></span>
              <span class="${expired ? 'pb-bad' : expiring ? 'pb-warn' : 'pb-muted'}">${expired ? '⚠ Expired' : expiring ? '⚠ Expires' : 'Expires'} ${c.expMonth}/${c.expYear}</span>
            </button>`;
          }).join('')}
        </div>` : '<p class="pb-muted">Enter the customer\'s email in Drivers Details to see their saved cards.</p>'}
        <div class="pb-actions">
          <button type="button" class="pb-btn" onclick="abPayAddCard()" ${cust.email ? '' : 'disabled'}>＋ Add Payment Method</button>
        </div>
      </section>
    </div>

    <section class="pb-card">
      <div class="pb-head"><h3>Payment Charges</h3><span class="pb-muted small">made from this system</span></div>
      <p class="pb-muted">Nothing is charged when the booking is created. ${pbMoney(calc.grand)} is charged at pick-up${selected ? ` to ${pbBrandLabel(selected.brand)} •••• ${pbEsc(selected.last4)} (or the card the customer brings)` : ''}.</p>
    </section>`;
}

// Formulário seguro do PowerBoard (simulado), igual ao do Planner. Só bandeira e 4 últimos dígitos ficam guardados.
function abPayAddCard() {
  const cust = abPayCustomer();
  if (!cust.email) return;
  const overlay = document.createElement('div');
  overlay.className = 'pb-overlay';
  overlay.innerHTML = `
    <div class="pb-dialog" role="dialog" aria-modal="true">
      <div class="pb-dhead"><div><h3>Add payment method</h3><p>${pbEsc(cust.fname)} ${pbEsc(cust.lname)} · new booking</p></div><button type="button" class="pb-x" data-pb="close">✕</button></div>
      <div class="pb-dbody">
        <div class="pb-secure">🔒 Secure card form by <b>PowerBoard</b>. In the live system these fields are PowerBoard's own — the card number never reaches GC Tech's server; only a token is saved.</div>
        <label>Cardholder name<input type="text" data-pb="holder" value="${pbEsc(`${cust.fname} ${cust.lname}`.trim().toUpperCase())}"></label>
        <label>Card number<input type="text" data-pb="number" inputmode="numeric" maxlength="23" placeholder="4111 1111 1111 1111" autocomplete="off"></label>
        <div class="pb-two">
          <label>Expiry<input type="text" data-pb="exp" placeholder="MM/YY" maxlength="5" autocomplete="off"></label>
          <label>CVV<input type="password" data-pb="cvv" placeholder="•••" maxlength="4" autocomplete="off"></label>
        </div>
      </div>
      <div class="pb-dfoot"><button type="button" class="pb-btn ghost" data-pb="close">Cancel</button><button type="button" class="pb-btn primary" data-pb="save">Save card</button></div>
    </div>`;
  const val = k => overlay.querySelector(`[data-pb="${k}"]`).value.trim();
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => {
    const act = e.target.dataset && e.target.dataset.pb;
    if (e.target === overlay || act === 'close') return close();
    if (act !== 'save') return;
    const digits = val('number').replace(/\D/g, '');
    const m = /^(\d{2})\/(\d{2})$/.exec(val('exp'));
    if (!val('holder')) { gcToast('Enter the cardholder name.', 'warning'); return; }
    if (digits.length < 13 || digits.length > 19) { gcToast('Card number must have 13 to 19 digits.', 'warning'); return; }
    if (!m || +m[1] < 1 || +m[1] > 12) { gcToast('Expiry must be MM/YY, e.g. 08/28.', 'warning'); return; }
    if (val('cvv').replace(/\D/g, '').length < 3) { gcToast('Enter the 3 or 4 digit CVV.', 'warning'); return; }
    const card = { id: 'card-' + Date.now().toString(36), brand: digits[0] === '4' ? 'visa' : digits[0] === '3' ? 'amex' : 'mastercard',
      last4: digits.slice(-4), holder: val('holder').toUpperCase(), expMonth: +m[1], expYear: 2000 + +m[2], addedBy: pbAgent(), addedAt: Date.now() };
    if (pbCardExpired(card)) { gcToast('This card has already expired.', 'warning'); return; }
    const all = pbRead(PB_CARDS_KEY);
    (all[cust.email] = all[cust.email] || []).push(card);
    pbWrite(PB_CARDS_KEY, all);
    abPay = { cardId: card.id };
    close();
    gcToast(`${pbBrandLabel(card.brand)} ending ${card.last4} saved and selected for this booking.`, 'success');
    abPayRender();
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-pb="number"]').focus();
}

// ---------- Repeat weekly (js/gc-repeat.js) ----------
function abReadRange() {
  const s = new Date(`${document.getElementById('rcm-date').value} ${document.getElementById('rcm-time').value}`).getTime();
  const e = new Date(`${document.getElementById('rcm-dropoff-date').value} ${document.getElementById('rcm-dropoff-time').value}`).getTime();
  return { s, e };
}

// Frase do padrão ("Every Thursday 07:00 → Thursday 17:00 (1 day) at Parramatta (SYD)")
function abRepeatUpdate() {
  const on = document.getElementById('rcm-repeat').checked;
  document.getElementById('rcm-repeat-detail').hidden = !on;
  if (!on) return;
  const { s, e } = abReadRange();
  const branch = repeatBranchCode(document.getElementById('rcm-loc').value);
  const text = document.getElementById('rcm-repeat-text');
  if (isNaN(s) || isNaN(e) || e <= s || !branch) { text.textContent = 'Choose the pick-up and drop-off first.'; return; }
  if (e - s >= 7 * FLEET_DAY_MS) { text.textContent = 'A weekly repeat needs a booking shorter than 7 days.'; return; }
  text.textContent = repeatPatternText({ start: s, end: e, branch });
}

async function submitBooking() {
  const vehicleInput = document.getElementById('rcm-vehicle');
  const locInput = document.getElementById('rcm-loc');
  const dropoffInput = document.getElementById('rcm-dropoff-loc');
  const pickupDateInput = document.getElementById('rcm-date');
  const pickupTimeInput = document.getElementById('rcm-time');
  const dropoffDateInput = document.getElementById('rcm-dropoff-date');
  const dropoffTimeInput = document.getElementById('rcm-dropoff-time');
  const sourceInput = document.getElementById('rcm-source');
  const firstNameInput = document.getElementById('rcm-firstname'); // NOVO
  const lastNameInput = document.getElementById('rcm-lastname');   // NOVO
  
  const revBookingRadio = document.querySelector('input[name="rev_booking"]:checked');

  if (!vehicleInput || !locInput || !pickupDateInput || !dropoffDateInput) return;

  // 1. Preparar as Datas Solicitadas
  const pickupFullStr = `${pickupDateInput.value} ${pickupTimeInput.value}`;
  const dropoffFullStr = `${dropoffDateInput.value} ${dropoffTimeInput.value}`;
  
  const reqStartMs = new Date(pickupFullStr).getTime();
  const reqEndMs = new Date(dropoffFullStr).getTime();

  if (isNaN(reqStartMs) || isNaN(reqEndMs)) {
      gcToast("Please enter valid pick-up and drop-off dates.", 'error');
      return;
  }

  if (reqEndMs <= reqStartMs) {
      gcToast("The drop-off date and time must be after the pick-up.", 'error');
      return;
  }

  if (!fleetIsValidBookingTime(reqStartMs) || !fleetIsValidBookingTime(reqEndMs)) {
      gcToast("Outside opening hours\n\n" + FLEET_HOURS_MESSAGE, 'error');
      return;
  }

  if (!fleetOneWayAllowed(locInput.value, dropoffInput ? dropoffInput.value : '')) {
      gcToast("One-way not available\n\n" + FLEET_ONE_WAY_MESSAGE, 'error');
      return;
  }

  const emailInput = document.getElementById('rcm-email');
  const userEmail = emailInput ? emailInput.value.trim().toLowerCase() : '';
  if (!userEmail) {
      gcToast("Please enter the customer's email address.", 'error');
      return;
  }

  // Booking Fees e Payments: mesmo formato do Planner
  const feesRes = abFeRead();
  if (feesRes.error) { switchTab('fees'); gcToast(feesRes.error, 'error'); return; }
  // Cartão para o pick-up (opcional, nada é cobrado agora). Cartão vencido não fica marcado.
  const payCard = abPaySelectedCard();
  const pickupCard = payCard && !pbCardExpired(payCard) ? payCard : null;

  const selectedVehicle = vehicleInput.value;
  const fname = firstNameInput ? firstNameInput.value.trim() : '';
  const lname = lastNameInput ? lastNameInput.value.trim() : '';

  const phoneInput = document.getElementById('rcm-phone');
  const newBooking = {
    id: Date.now(),
    ref: 'OR-' + Math.floor(1000 + Math.random() * 9000),
    vehicle: selectedVehicle,
    plate: null,
    fname: fname,
    lname: lname,
    phone: phoneInput ? phoneInput.value.trim() : '',
    // Mesmos campos da aba Drivers Details do Planner (antes eram digitados e descartados)
    licence: abVal('rcm-license'),
    driver: { address: abVal('rcm-address'), city: abVal('rcm-city'), state: abVal('rcm-state'), postcode: abVal('rcm-postcode'), country: abVal('rcm-country') || 'Australia' },
    loc: locInput.value,
    dropoff: dropoffInput ? dropoffInput.value : 'Same as Pick up',
    source: sourceInput ? sourceInput.value : 'Google Search',
    revBooking: revBookingRadio ? revBookingRadio.value : 'Yes',
    fees: feesRes.data,
    excessOption: feesRes.data.insurance,
    status: 'confirmed'
  };
  fleetApplyRange(newBooking, reqStartMs, reqEndMs);

  // Repeat weekly: todas as datas (inclusive esta) só com veículos da filial de retirada
  const repeatOn = document.getElementById('rcm-repeat') && document.getElementById('rcm-repeat').checked;
  const branch = repeatBranchCode(locInput.value);

  // 🔴 ANTI-OVERBOOKING: aloca uma placa livre do modelo (preferindo a clicada no Planner).
  // Considera TODAS as reservas (fixas, manutenção, Do Not Move, portal e agente).
  const plate = fleetFindFreePlate(selectedVehicle, reqStartMs, reqEndMs, repeatOn ? { preferredPlate: incomingPlate, branch } : { preferredPlate: incomingPlate });
  if (plate) {
    newBooking.plate = plate;
  } else {
    newBooking.status = 'fleet_pending';
  }

  // Pagamento: nada é cobrado antes do pick-up. O total fica como saldo e o agente cobra na loja.
  const grand = feesRes.data.grandTotal;
  newBooking.paidSnapshot = [];
  newBooking.paymentStatus = plate ? 'pay_at_pickup' : 'not_charged';

  // Prévia da série antes de gravar qualquer coisa (cancelar a prévia = nada é criado)
  let repeat = null;
  if (repeatOn) {
    const cat = fleetFindCategoryByModel(selectedVehicle);
    const src = {
      start: reqStartMs, end: reqEndMs, model: cat ? cat.model : selectedVehicle, cat, branch, loc: locInput.value,
      dropoff: newBooking.dropoff, email: userEmail, fname, lname, phone: newBooking.phone,
      source: 'Repeat Customer', originRef: newBooking.ref,
      agent: (typeof getAgentName === 'function' ? getAgentName() : localStorage.getItem('gc_agent_name')) || 'Agent',
      extraOcc: plate ? [{ id: String(newBooking.id), plate, start: reqStartMs, end: reqEndMs }] : []
    };
    const problem = repeatValidate(src);
    if (problem) { gcToast(problem, 'warning'); return; }
    const result = await repeatDialog(src, { months: Number(document.getElementById('rcm-repeat-months').value), subtitle: `New booking ${newBooking.ref} · ${fname} ${lname}` });
    if (!result) return;
    src.seriesId = repeatNewSeriesId();
    newBooking.seriesId = src.seriesId;
    newBooking.branchOnly = true;
    repeat = { src, plan: result.plan };
  }

  const multiKey = 'gc_multi_bookings_' + userEmail;
  let bookings = JSON.parse(localStorage.getItem(multiKey) || '[]');
  bookings.unshift(newBooking);
  localStorage.setItem(multiKey, JSON.stringify(bookings));

  // Activity Log: reserva criada pelo agente (+ alocação)
  {
    const lcat = fleetFindCategoryByModel(selectedVehicle);
    const lcode = fleetLogBranchCode(locInput.value);
    const ldrop = newBooking.dropoff && newBooking.dropoff !== 'Same as Pick up' ? fleetLogBranchCode(newBooking.dropoff) : lcode;
    const ldays = fleetLogDays(reqStartMs, reqEndMs);
    const lrate = lcat ? lcat.rate : 0;
    fleetLog({ bookingId: newBooking.id, ref: newBooking.ref, action: '',
      details: `Booking entered by agent, ${fleetLogTripText(lcat ? lcat.name : selectedVehicle, '', lcode, reqStartMs, ldrop, reqEndMs)}, Rate = ${ldays} days x $${lrate.toFixed(2)}`,
      info: `${fname} ${lname}`.trim() + (repeatOn ? ' · repeat weekly series' : ''), total: Math.round(ldays * lrate * 100) / 100 });
    if (plate) fleetLog({ bookingId: newBooking.id, ref: newBooking.ref, plate, operator: '', action: 'Allocated', details: `Booking allocated to ${plate}`, info: `Allocated automatically to ${plate}` });
  }
  if (pickupCard) { const sel = pbRead(PB_SELECTED_KEY); sel[String(newBooking.id)] = pickupCard.id; pbWrite(PB_SELECTED_KEY, sel); }
  const payMsg = `\n\nNothing charged now: ${pbMoney(grand)} is paid at pick-up by credit or debit card.`;

  let firstMsg, kind;
  if (!plate) {
    fleetSendToAgentRequests(newBooking, userEmail, `${fname} ${lname}`.trim());
    firstMsg = `No "${selectedVehicle}" available for these dates\n\nBooking ${newBooking.ref} was sent to Agent Requests so an alternative can be offered to the customer.`;
    kind = 'warning';
  } else {
    const veh = fleetGetVehicle(plate);
    firstMsg = `Booking ${newBooking.ref} confirmed\n\nVehicle allocated: ${veh.label} · ${plate} (${FLEET_BRANCHES[veh.branch]})`;
    kind = 'success';
  }

  if (repeat) {
    const res = repeatCreate(repeat.src, repeat.plan);
    const total = res.total + 1, confirmed = res.confirmed + (plate ? 1 : 0), pending = total - confirmed;
    gcFlash(`${total} weekly bookings created for ${fname} ${lname}\n\n${confirmed} confirmed` +
      (pending ? ` · ${pending} sent to Agent Requests (no vehicle free at the branch)` : '') + `. First: ${newBooking.ref}.`, pending ? 'warning' : 'success');
  } else {
    gcFlash(firstMsg + payMsg, kind);
  }

  window.dispatchEvent(new Event('storage'));
  window.location.href = 'agent-dashboard.html';
}

// === HELPERS DE DATA E HORA === //
function formatTimeToAMPM(dateObj) {
    let hours = dateObj.getHours();
    let minutes = dateObj.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return hours.toString().padStart(2, '0') + ':' + minutes + ' ' + ampm;
}

function ensureSelectOption(selectId, value) {
    const selectEl = document.getElementById(selectId);
    if(!selectEl || !value) return;
    let exists = Array.from(selectEl.options).some(opt => opt.value === value);
    if(!exists) {
        selectEl.add(new Option(value, value));
    }
    selectEl.value = value;
}

// === INICIALIZAÇÃO DA PÁGINA === //
window.addEventListener('DOMContentLoaded', () => {
  // Horários permitidos: 08:00–17:15 a cada 15 min (gc-fleet-data.js)
  document.getElementById('rcm-time').innerHTML = fleetTimeOptions('08:30 AM');
  document.getElementById('rcm-dropoff-time').innerHTML = fleetTimeOptions('08:30 AM');

  const urlParams = new URLSearchParams(window.location.search);

  // Vindo do "New Booking" de Customers & Vehicles: preenche o motorista principal
  [['fname', 'rcm-firstname'], ['lname', 'rcm-lastname'], ['email', 'rcm-email'], ['phone', 'rcm-phone']].forEach(([param, id]) => {
    const value = urlParams.get(param);
    const input = document.getElementById(id);
    if (value !== null && input) input.value = value;
  });

  const rawPickup = urlParams.get('pickup') || localStorage.getItem("gc_qa_pickup");
  const rawDropoff = urlParams.get('dropoff') || localStorage.getItem("gc_qa_dropoff");
  const rawPlate = urlParams.get('plate') || localStorage.getItem("gc_qa_plate"); // NOVO

  let pickupDateStr = new Date(); // CORRIGIDO: era a string literal "today", que o Flatpickr não parseia
  let dropoffDateStr = new Date().fp_incr(2);
  let pickupTimeStr = null;
  let dropoffTimeStr = null;

  if (rawPickup) {
      const pDate = new Date(rawPickup);
      if (!isNaN(pDate)) {
          pickupDateStr = pDate;
          pickupTimeStr = formatTimeToAMPM(pDate);
      }
  }

  if (rawDropoff) {
      const dDate = new Date(rawDropoff);
      if (!isNaN(dDate)) {
          dropoffDateStr = dDate;
          dropoffTimeStr = formatTimeToAMPM(dDate);
      }
  }

  if (document.getElementById('rcm-date')) {
    flatpickr("#rcm-date", { 
      dateFormat: "d M Y", 
      defaultDate: pickupDateStr, 
      disableMobile: "true" 
    });
  }
  
  if (pickupTimeStr) ensureSelectOption('rcm-time', pickupTimeStr);

  if (document.getElementById('rcm-dropoff-date')) {
    flatpickr("#rcm-dropoff-date", { 
      dateFormat: "d M Y", 
      defaultDate: dropoffDateStr, 
      disableMobile: "true" 
    });
  }
  
  if (dropoffTimeStr) ensureSelectOption('rcm-dropoff-time', dropoffTimeStr);

  localStorage.removeItem("gc_qa_pickup");
  localStorage.removeItem("gc_qa_dropoff");
  localStorage.removeItem("gc_qa_plate");

  // Repeat weekly: a frase do padrão acompanha datas, horários e filial
  ['rcm-date', 'rcm-time', 'rcm-dropoff-date', 'rcm-dropoff-time', 'rcm-loc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', abRepeatUpdate); el.addEventListener('input', abRepeatUpdate); }
  });

  // NOVO: sincroniza categoria/veículo com a placa que originou o clique no Fleet Planner
  // (antes, este valor era lido para o localStorage.removeItem acima e depois descartado)
  const incomingVehicle = rawPlate ? fleetGetVehicle(rawPlate) : null;
  if (incomingVehicle) {
    incomingPlate = rawPlate;
    const categorySelect = document.getElementById('rcm-category');
    if (categorySelect) categorySelect.value = fleetGetCategory(incomingVehicle.categoryId).section;
  }

  updateVehicleModels();

  if (incomingVehicle) {
    ensureSelectOption('rcm-vehicle', incomingVehicle.model);
  }

  // Sem one-way entre Sydney e Brisbane: a devolução só oferece filiais da mesma cidade
  const locSel = document.getElementById('rcm-loc');
  const restrictDropoff = () => fleetRestrictDropoffSelect(document.getElementById('rcm-dropoff-loc'), locSel.value);
  if (locSel) { locSel.addEventListener('change', restrictDropoff); restrictDropoff(); }

  // Booking Fees acompanha o modelo (diária e excess da categoria) e as datas (quantidade de dias)
  abFeInit();
  const vehSel = document.getElementById('rcm-vehicle');
  if (vehSel) vehSel.addEventListener('change', abFeSyncCategory);
  const catSel = document.getElementById('rcm-category');
  if (catSel) catSel.addEventListener('change', abFeSyncCategory);
  ['rcm-date', 'rcm-time', 'rcm-dropoff-date', 'rcm-dropoff-time'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', abFeSyncDays);
  });
});