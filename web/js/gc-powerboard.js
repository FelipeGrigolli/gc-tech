// ==========================================
// PAGAMENTOS VIA POWERBOARD — cartões salvos (vault tokens), cobranças e link para o cliente
// ⚠️ SIMULADO: no protótipo nada é cobrado. Na versão real cada ação chama a API do PowerBoard:
//   • o cartão é digitado no formulário seguro do PowerBoard e vira um "vault token"
//     (o número do cartão nunca passa pelo servidor da GC Tech);
//   • cobrança = charge no token; caução = cobrança real de $505.50 e refund depois da devolução.
// Hoje isso é feito num sistema separado (site da GC Tech → admin/agent/bookings). Aqui vira
// parte da aba Payments do booking.
// Depende de: gc-fleet-data.js, gc-fees-data.js, gc-bonds.js, gc-ui.js
// ==========================================

const PB_CARDS_KEY = 'gc_pb_cards';        // { email: [{ id, brand, last4, holder, expMonth, expYear, addedBy, addedAt }] }
const PB_SELECTED_KEY = 'gc_pb_selected';  // { bookingId: cardId }
const PB_CHARGES_KEY = 'gc_pb_charges';    // { bookingId: [{ id, kind, amount, dateMs, cardId, brand, last4, status, threeDS, by, reason }] }

function pbEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pbRead(key) { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; } }
function pbWrite(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
function pbMoney(n) { return (n < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toFixed(2); }
function pbAgent() { try { return localStorage.getItem('gc_agent_name') || 'Agent'; } catch (e) { return 'Agent'; } }
function pbDate(ms) { return `${new Date(ms).getDate()} ${FLEET_MONTHS[new Date(ms).getMonth()]} ${new Date(ms).getFullYear()}`; }
function pbBrandLabel(b) { return { visa: 'VISA', mastercard: 'MASTERCARD', amex: 'AMEX' }[b] || String(b || 'CARD').toUpperCase(); }

// ---------- Reserva por id (Planner, site/portal, GC-8832 e devolvidas antigas do Bond Refunds) ----------
function pbBookingInfo(id) {
  id = String(id || '');
  if (!id) return null;
  const stored = fleetFindStoredBooking(id);
  if (stored) {
    const r = fleetBookingRange(stored.b);
    return { id, ref: stored.b.ref || ('OR-' + id.slice(-6)), fname: stored.b.fname || '', lname: stored.b.lname || '', email: stored.email,
      plate: fleetIsVirtualPlate(stored.b.plate) ? stored.b.virtualFrom : stored.b.plate, start: r.start, end: r.end, phone: stored.b.phone || '' };
  }
  if (id.startsWith('main-')) {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(FLEET_MAIN_PREFIX + id.slice(5)) || '{}'); } catch (e) {}
    const r = fleetMainBookingRange(state);
    return { id, ref: 'GC-8832', fname: 'Felipe', lname: 'Grigolli', email: id.slice(5), plate: FLEET_MAIN_BOOKING_PLATE, start: r.start, end: r.end };
  }
  const s = fleetSeedBookings().find(x => x.id === id);
  if (s && s.type !== 'maintenance') return { id, ref: s.ref, fname: s.fname, lname: s.lname, email: s.clientEmail, plate: s.plate, start: s.startMs, end: s.endMs };
  if (typeof bondGetRecord === 'function') {
    const b = bondGetRecord(id);
    if (b) return { id, ref: b.ref, fname: b.fname, lname: b.lname, email: b.email, plate: b.plate, start: b.pickupMs, end: b.dropoffMs };
  }
  return null;
}

// ---------- Cartões ----------
// Todo cliente com reserva já tem o cartão usado na reserva (exemplo determinístico).
// Alguns vencem logo ou já venceram, como na vida real.
function pbSeedCard(email, info) {
  const h = fleetHash('card:' + email);
  const now = new Date();
  let expYear = now.getFullYear() + 1 + (h % 3), expMonth = 1 + (h >>> 4) % 12;
  if (h % 7 === 0) { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); expYear = d.getFullYear(); expMonth = d.getMonth() + 1; }
  else if (h % 7 === 1) { expYear = now.getFullYear(); expMonth = now.getMonth() + 1; }
  const holder = info ? `${(info.lname || '').toUpperCase()} ${(info.fname || '').toUpperCase()}`.trim() : email.split('@')[0].toUpperCase();
  return { id: 'card-seed-' + (h % 100000), brand: h % 2 ? 'mastercard' : 'visa', last4: String(1000 + (h >>> 9) % 9000),
    holder, expMonth, expYear, addedBy: 'GC Tech Website', addedAt: null, seed: true };
}

function pbCardsFor(email, info) {
  if (!email) return [];
  const key = email.toLowerCase();
  const stored = pbRead(PB_CARDS_KEY)[key] || [];
  const removedSeed = stored.some(c => c.removedSeed);
  const list = stored.filter(c => !c.removedSeed);
  return removedSeed ? list : [pbSeedCard(key, info), ...list];
}

function pbCardExpired(c) {
  const now = new Date();
  return c.expYear < now.getFullYear() || (c.expYear === now.getFullYear() && c.expMonth < now.getMonth() + 1);
}
function pbCardExpiring(c) {
  const now = new Date();
  return !pbCardExpired(c) && c.expYear === now.getFullYear() && c.expMonth <= now.getMonth() + 2;
}

function pbSelectedCard(bookingId) {
  const info = pbBookingInfo(bookingId);
  if (!info) return null;
  const cards = pbCardsFor(info.email, info);
  const sel = pbRead(PB_SELECTED_KEY)[bookingId];
  return cards.find(c => c.id === sel) || cards.filter(c => !pbCardExpired(c)).slice(-1)[0] || cards[0] || null;
}

function pbSelectCard(bookingId, cardId) {
  const all = pbRead(PB_SELECTED_KEY);
  all[bookingId] = cardId;
  pbWrite(PB_SELECTED_KEY, all);
  pbRefresh(bookingId);
}

// ---------- Cobranças ----------
function pbChargesFor(bookingId) {
  return (pbRead(PB_CHARGES_KEY)[String(bookingId)] || []).slice().sort((a, b) => a.dateMs - b.dateMs);
}

// Cobrança no cartão selecionado. kind: 'balance' | 'manual' | 'toll'. Cartão vencido = recusado.
function pbCharge(bookingId, amount, kind, reason, opts) {
  opts = opts || {};
  const info = pbBookingInfo(bookingId);
  const card = opts.card || pbSelectedCard(bookingId);
  amount = Math.round(Number(amount) * 100) / 100;
  if (!info || !card || !(amount > 0)) return { error: 'Nothing to charge.' };
  const declined = pbCardExpired(card);
  const charge = { id: 'ch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, amount, dateMs: Date.now(),
    cardId: card.id, brand: card.brand, last4: card.last4, status: declined ? 'declined' : 'complete',
    threeDS: !declined && kind !== 'toll' && fleetHash(String(Date.now())) % 3 === 0, by: opts.by || pbAgent(), reason: reason || '' };
  // Cobrança manual: quanto dela abate o saldo da reserva (o resto é cobrança extra)
  if (opts.applied != null) charge.applied = Math.round(Math.max(0, Math.min(amount, opts.applied)) * 100) / 100;
  const all = pbRead(PB_CHARGES_KEY);
  (all[String(bookingId)] = all[String(bookingId)] || []).push(charge);
  pbWrite(PB_CHARGES_KEY, all);
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId, ref: info.ref, plate: info.plate, operator: charge.by, action: 'Payment',
      details: declined ? `Card declined: ${pbBrandLabel(card.brand)} ending ${card.last4} (expired ${card.expMonth}/${card.expYear}) for ${pbMoney(amount)}`
                        : `Vault token charged ${pbBrandLabel(card.brand)} ending ${card.last4}${reason ? ' · ' + reason : ''}`,
      info: `via PowerBoard · ${{ toll: 'tolls', manual: 'manual amount', extension: 'extension', balance: 'booking balance' }[kind] || kind}`, total: declined ? null : amount });
  }
  return declined ? { declined: true, charge, card } : { ok: true, charge, card };
}

// Entram no extrato do booking os pagamentos do valor da reserva: saldo, extensão, devolução de
// diferença e cobranças manuais (até o saldo que havia; o excedente é cobrança extra).
// Pedágios são cobranças à parte.
function pbLedgerAmount(c) {
  if (c.status !== 'complete') return 0;
  if (['balance', 'extension', 'refund'].includes(c.kind)) return c.amount;
  if (c.kind === 'manual') return c.applied != null ? c.applied : c.amount; // cobranças antigas: valor inteiro
  return 0;
}
function pbLedgerPayments(bookingId) {
  return pbChargesFor(bookingId).filter(c => pbLedgerAmount(c) > 0).map(c => ({
    id: c.id, type: c.kind === 'refund' ? 'Refund' : 'Payment', method: c.brand, dateMs: c.dateMs,
    reference: `${c.by} (PowerBoard)${c.kind === 'manual' && c.reason ? ' · ' + c.reason : ''}`, amount: pbLedgerAmount(c), merchantFee: 0, extra: true
  }));
}

// Devolve a diferença para o cartão (ex.: voltou do Excess Reduction para o Standard depois de cobrar)
function pbRefund(bookingId, amount, reason) {
  const info = pbBookingInfo(bookingId);
  const card = pbSelectedCard(bookingId);
  amount = Math.round(Math.abs(Number(amount)) * 100) / 100;
  if (!info || !card || !(amount > 0)) return { error: 'Nothing to refund.' };
  const charge = { id: 'rf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'refund', amount: -amount, dateMs: Date.now(),
    cardId: card.id, brand: card.brand, last4: card.last4, status: 'complete', threeDS: true, by: pbAgent(), reason: reason || 'Booking change' };
  const all = pbRead(PB_CHARGES_KEY);
  (all[String(bookingId)] = all[String(bookingId)] || []).push(charge);
  pbWrite(PB_CHARGES_KEY, all);
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId, ref: info.ref, plate: info.plate, operator: charge.by, action: 'Payment',
      details: `Refund of ${pbMoney(amount)} to ${pbBrandLabel(card.brand)} ending ${card.last4}${reason ? ' · ' + reason : ''}`, info: 'via PowerBoard · refund', total: -amount });
  }
  return { ok: true, charge, card };
}

function pbRefundCredit() {
  const { bookingId, getRecord } = pbPanelState;
  const rec = getRecord ? getRecord() : null;
  const credit = rec ? -bondBalance(rec) : 0;
  if (!(credit > 0)) return;
  const res = pbRefund(bookingId, credit, 'Booking total reduced');
  if (res.ok) gcToast(`${pbMoney(credit)} refunded to ${pbBrandLabel(res.card.brand)} ending ${res.card.last4}.`, 'success');
  pbRefresh(bookingId);
}

// ---------- Painel da aba Payments (Fleet Planner) ----------
let pbPanelState = { bookingId: null, getRecord: null };

// getRecord: função que devolve o registro do extrato (plannerBondRecord) para calcular o saldo
function pbRenderPanel(containerId, bookingId, getRecord) {
  const box = document.getElementById(containerId);
  if (!box) return;
  pbPanelState = { containerId, bookingId, getRecord };
  const info = pbBookingInfo(bookingId);
  if (!info) { box.innerHTML = ''; return; }
  const rec = getRecord ? getRecord() : null;
  const cards = pbCardsFor(info.email, info);
  const selected = pbSelectedCard(bookingId);
  const charges = pbChargesFor(bookingId);
  const calc = rec ? bondCalc(rec) : null;
  const paid = rec ? bondPaid(rec) : 0;
  const balance = rec ? bondBalance(rec) : 0;
  const bondItem = rec ? (rec.fees.items || []).find(i => (feeGetItem(i.id) || {}).bond) : null;
  const bondRefunded = rec ? (rec.fees.items || []).some(i => (feeGetItem(i.id) || {}).refund) : false;

  box.innerHTML = `
    <div class="pb-grid">
      <section class="pb-card">
        <div class="pb-head"><h3>Payment Controls</h3><span class="pb-via">via PowerBoard</span></div>
        ${calc ? `
        <div class="pb-lines">
          <div><span>Booking total</span><strong>${pbMoney(calc.grand)}</strong></div>
          <div><span>Amount paid</span><strong>${pbMoney(paid)}</strong></div>
          <div class="pb-bal ${balance > 0 ? 'due' : balance < 0 ? 'owed' : ''}"><span>${balance < 0 ? 'Owed to customer' : rec.beforePickup ? 'Due at pick-up' : 'Balance due'}</span><strong>${pbMoney(Math.abs(balance))}</strong></div>
        </div>
        ${bondItem ? `<div class="pb-bond">🔒 Bond ${pbMoney(bondItem.amount * bondItem.qty)} charged at pick-up${bondRefunded ? ' · refund released after return (Bond Refunds)' : ' · refunded to the card after the vehicle is returned'}</div>` : ''}
        <p class="pb-muted small">Payment at the branch only: credit or debit card. No cash or bank transfer. Nothing is charged before pick-up.</p>
        ${balance > 0.004 && rec.beforePickup ? `
          <p class="pb-muted">Charged at the branch when the customer picks up the vehicle. Change the booking to <b>Hired</b> at pick-up to take the payment.</p>`
        : balance > 0.004 ? `
          <button type="button" class="pb-btn primary" onclick="pbChargeBalance()" ${selected ? '' : 'disabled'}>Charge ${pbMoney(balance)} to ${selected ? pbBrandLabel(selected.brand) + ' •••• ' + selected.last4 : 'card'}</button>`
          : balance < -0.004 && !bondRefunded
            ? `<button type="button" class="pb-btn primary" onclick="pbRefundCredit()" ${selected ? '' : 'disabled'}>Refund ${pbMoney(-balance)} to ${selected ? pbBrandLabel(selected.brand) + ' •••• ' + selected.last4 : 'card'}</button>
               <p class="pb-muted small">The booking total went down after a change, so the customer paid more than the new total.</p>`
          : `<p class="pb-muted">${balance < 0 ? 'The bond is waiting to be refunded in Bond Refunds.' : 'No payment due.'}</p>`}
        ` : ''}
        <label class="pb-manual"><input type="checkbox" id="pb-manual-on" onchange="document.getElementById('pb-manual-box').hidden = !this.checked"> Charge manual amount?</label>
        <div class="pb-manual-box" id="pb-manual-box" hidden>
          <input type="number" id="pb-manual-amount" min="0" step="0.01" placeholder="Amount (AUD)">
          <input type="text" id="pb-manual-reason" placeholder="Reason, e.g. fuel, cleaning, damage">
          <button type="button" class="pb-btn" onclick="pbChargeManual()">Charge</button>
          <p class="pb-muted small">Comes off the balance due. Anything above the balance is charged as an extra.</p>
        </div>
      </section>

      <section class="pb-card">
        <div class="pb-head"><h3>Payment Methods</h3><span class="pb-muted small">${cards.length} saved</span></div>
        <div class="pb-cards">
          ${cards.map(c => {
            const expired = pbCardExpired(c), expiring = pbCardExpiring(c), isSel = selected && c.id === selected.id;
            return `
            <button type="button" class="pb-cc${isSel ? ' sel' : ''}${expired ? ' expired' : ''}" onclick="pbSelectCard('${pbEsc(bookingId)}', '${pbEsc(c.id)}')">
              <span class="pb-cc-top"><strong>${pbBrandLabel(c.brand)}</strong> <em>via PowerBoard</em>${isSel ? '<span class="pb-selected">✓ Selected</span>' : ''}</span>
              <span>Holder: <b>${pbEsc(c.holder)}</b></span>
              <span>Card number ends with: <b>${pbEsc(c.last4)}</b></span>
              <span class="${expired ? 'pb-bad' : expiring ? 'pb-warn' : 'pb-muted'}">${expired ? '⚠ Expired' : expiring ? '⚠ Expires' : 'Expires'} ${c.expMonth}/${c.expYear}</span>
            </button>`;
          }).join('')}
        </div>
        <div class="pb-actions">
          <button type="button" class="pb-btn" onclick="pbAddCardDialog('${pbEsc(bookingId)}')">＋ Add Payment Method</button>
          <button type="button" class="pb-btn ghost" onclick="pbSendRequest('${pbEsc(bookingId)}')">✉ Send Payment Method Request</button>
        </div>
      </section>
    </div>

    <section class="pb-card">
      <div class="pb-head"><h3>Payment Charges</h3><span class="pb-muted small">made from this system</span></div>
      ${charges.length ? `<div class="pb-table-wrap"><table class="pb-table">
        <thead><tr><th>Date</th><th>For</th><th>Card</th><th>By</th><th class="r">Amount</th><th>Status</th></tr></thead>
        <tbody>${charges.slice().reverse().map(c => `
          <tr><td class="nw">${pbDate(c.dateMs)} ${fleetFormatTime(c.dateMs)}</td>
            <td>${c.kind === 'toll' ? 'Tolls' : c.kind === 'balance' ? 'Booking balance' : c.kind === 'refund' ? 'Refund · ' + pbEsc(c.reason || '') : pbEsc(c.reason || 'Manual amount') +
              (c.kind === 'manual' && c.status === 'complete' ? `<small class="pb-muted"> · ${c.applied != null && c.applied < c.amount - 0.004 ? `${pbMoney(c.applied)} to balance, ${pbMoney(c.amount - c.applied)} extra` : 'to balance'}</small>` : '')}</td>
            <td class="nw">${pbBrandLabel(c.brand)} •••• ${pbEsc(c.last4)}</td><td>${pbEsc(c.by)}</td>
            <td class="r">${pbMoney(c.amount)}</td>
            <td>${c.kind === 'refund' ? '<span class="pb-st muted">refunded</span>' : c.status === 'complete' ? `<span class="pb-st ok">complete</span>${c.threeDS ? '' : ' <span class="pb-st warn" title="No 3D Secure check on this charge">No 3DS</span>'}` : '<span class="pb-st bad">declined</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="pb-muted">No charges made from this system yet. The original booking payment is in the statement below.</p>'}
    </section>`;
}

function pbRefresh(bookingId) {
  if (pbPanelState.bookingId === bookingId) pbRenderPanel(pbPanelState.containerId, bookingId, pbPanelState.getRecord);
  if (typeof pbAfterCharge === 'function') pbAfterCharge(bookingId);
}

function pbChargeBalance() {
  const { bookingId, getRecord } = pbPanelState;
  const rec = getRecord ? getRecord() : null;
  const due = rec ? bondBalance(rec) : 0;
  if (!(due > 0)) return;
  const res = pbCharge(bookingId, due, 'balance', 'Booking balance');
  pbAfterResult(res, bookingId);
}

function pbChargeManual() {
  const amount = Number(document.getElementById('pb-manual-amount').value);
  const reason = document.getElementById('pb-manual-reason').value.trim();
  if (!(amount > 0)) { gcToast('Enter the amount to charge.', 'warning'); return; }
  if (!reason) { gcToast('Enter the reason for the charge — it goes on the receipt and the Activity Log.', 'warning'); return; }
  // Abate o saldo da reserva até o valor devido; o que passar disso é cobrança extra
  const rec = pbPanelState.getRecord ? pbPanelState.getRecord() : null;
  const due = rec && typeof bondBalance === 'function' ? Math.max(0, bondBalance(rec)) : 0;
  const res = pbCharge(pbPanelState.bookingId, amount, 'manual', reason, { applied: due });
  if (res.ok && amount - due > 0.004) gcToast(`${pbMoney(Math.min(amount, due))} applied to the balance due · ${pbMoney(amount - due)} charged as an extra (${reason}).`, 'info', { duration: 6000 });
  pbAfterResult(res, pbPanelState.bookingId);
}

function pbAfterResult(res, bookingId) {
  if (res.declined) gcToast(`Card declined\n\n${pbBrandLabel(res.card.brand)} ending ${res.card.last4} expired ${res.card.expMonth}/${res.card.expYear}. Add a new card or send the customer a payment method request.`, 'error');
  else if (res.ok) gcToast(`${pbMoney(res.charge.amount)} charged to ${pbBrandLabel(res.card.brand)} ending ${res.card.last4}.`, 'success');
  pbRefresh(bookingId);
}

// Formulário do PowerBoard (simulado). Só a bandeira e os 4 últimos dígitos ficam guardados.
function pbAddCardDialog(bookingId) {
  const info = pbBookingInfo(bookingId);
  if (!info) return;
  const overlay = document.createElement('div');
  overlay.className = 'pb-overlay';
  overlay.innerHTML = `
    <div class="pb-dialog" role="dialog" aria-modal="true">
      <div class="pb-dhead"><div><h3>Add payment method</h3><p>${pbEsc(info.fname)} ${pbEsc(info.lname)} · booking ${pbEsc(info.ref)}</p></div><button type="button" class="pb-x" data-pb="close">✕</button></div>
      <div class="pb-dbody">
        <div class="pb-secure">🔒 Secure card form by <b>PowerBoard</b>. In the live system these fields are PowerBoard's own — the card number never reaches GC Tech's server; only a token is saved.</div>
        <label>Cardholder name<input type="text" data-pb="holder" value="${pbEsc(`${(info.fname || '')} ${(info.lname || '')}`.trim().toUpperCase())}"></label>
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
    const key = info.email.toLowerCase();
    (all[key] = all[key] || []).push(card);
    pbWrite(PB_CARDS_KEY, all);
    const sel = pbRead(PB_SELECTED_KEY); sel[bookingId] = card.id; pbWrite(PB_SELECTED_KEY, sel);
    if (typeof fleetLog === 'function') fleetLog({ bookingId, ref: info.ref, plate: info.plate, action: 'Payment', details: `Agent added payment method ${pbBrandLabel(card.brand)} ending ${card.last4}`, info: 'via PowerBoard · vault token' });
    close();
    gcToast(`${pbBrandLabel(card.brand)} ending ${card.last4} saved and selected for this booking.`, 'success');
    pbRefresh(bookingId);
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-pb="number"]').focus();
}

function pbSendRequest(bookingId) {
  const info = pbBookingInfo(bookingId);
  if (!info) return;
  if (typeof fleetLog === 'function') fleetLog({ bookingId, ref: info.ref, plate: info.plate, action: 'Payment', details: `Payment method request sent to ${info.email}`, info: 'Secure PowerBoard link · customer adds the card themselves' });
  gcToast(`Payment method request sent\n\n${info.email} gets a secure link to add a card. It appears here as soon as they save it.`, 'success');
}
