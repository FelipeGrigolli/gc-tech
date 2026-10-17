// ==========================================
// GC TECH BONDS — EXTRATO DO BOOKING E REFUND DOS BONDS (simulação)
// Usado por: Fleet Planner (aba Payments) e Agent Dashboard (módulo Bond Refunds).
// Precisa de gc-fleet-data.js e gc-fees-data.js carregados antes.
//
// Hoje as cobranças são feitas em outro software: aqui só simulamos o fluxo do RCM —
// o booking volta (Returned) com a linha "Bond Refund" → saldo fica negativo (devemos
// ao cliente) → alguém com acesso libera o bond "via API" → entra um pagamento do tipo
// Refund com o nome de quem fez → Balance Due = $0.00 e o booking sai da fila.
// ==========================================

const BOND_LEDGER_KEY = 'gc_bond_ledger';   // { [bookingId]: registro do booking devolvido + payments }
const BOND_ACCESS_KEY = 'gc_bond_access';   // ['felipe', 'alex', ...] — quem vê o Bond Refunds
const BOND_ADMINS = ['felipe', 'alex'];      // sempre têm acesso e são os únicos que liberam para outros
const BOND_API_LABEL = 'Entered by API - v3.2';

// ------------------------------------------
// ACESSO
// ------------------------------------------
function bondGetAccessList() {
  let list = null;
  try { list = JSON.parse(localStorage.getItem(BOND_ACCESS_KEY) || 'null'); } catch (e) {}
  if (!Array.isArray(list)) list = [];
  return Array.from(new Set([...BOND_ADMINS, ...list]));
}

function bondSetAccessList(usernames) {
  localStorage.setItem(BOND_ACCESS_KEY, JSON.stringify(usernames.filter(u => !BOND_ADMINS.includes(u))));
}

function bondHasAccess(username) {
  return !!username && bondGetAccessList().includes(username);
}

function bondIsAdmin(username) {
  return BOND_ADMINS.includes(username);
}

// ------------------------------------------
// BOOKINGS "ANTIGOS" JÁ DEVOLVIDOS (dados de teste da fila de refund)
// ------------------------------------------
const BOND_SEED_RETURNED = (function () {
  const debit = [{ id: 'debit-bond', qty: 1, amount: 505.50 }, { id: 'debit-bond-refund', qty: 1, amount: -500.00 }];
  const seeds = [
    { id: 'old-1', ref: '488102', cat: 'cross-suv',  idx: 2, fname: 'Marcus', lname: 'Hale',     email: 'marcus.hale@example.com',   pickup: '2026-09-24T17:00', dropoff: '2026-09-26T11:45', branch: 'PAR', card: 'visa',
      items: debit },
    { id: 'old-2', ref: '488317', cat: 'small-auto', idx: 4, fname: 'Priya', lname: 'Raman',      email: 'priya.raman@example.com',   pickup: '2026-09-22T09:00', dropoff: '2026-09-27T13:45', branch: 'BLK', card: 'mastercard', excess: 'reduced',
      items: [...debit, { id: 'car-seat-4plus', qty: 1, amount: 5.50 }] },
    { id: 'old-3', ref: '488590', cat: 'hiace-1t',   idx: 2, fname: 'Tomás', lname: 'Ortega',     email: 'tomas.ortega@example.com',  pickup: '2026-09-25T08:00', dropoff: '2026-09-28T15:15', branch: 'PAR', card: 'visa', company: 'Ortega Removals',
      items: debit },
    { id: 'old-4', ref: '488644', cat: 'full-car',   idx: 1, fname: 'Hannah', lname: 'Cole',      email: 'hannah.cole@example.com',   pickup: '2026-09-26T10:00', dropoff: '2026-09-29T12:30', branch: 'MAS', card: 'visa',
      // devolveu com cheiro de cigarro: o Smoking Fee lançado na devolução sai do bond (refund de $170)
      items: [...debit, { id: 'smoking', qty: 1, amount: 330.00, atReturn: true }] },
    { id: 'old-5', ref: '488712', cat: 'eight-seat', idx: 0, fname: 'Kenji', lname: 'Watanabe',   email: 'kenji.watanabe@example.com', pickup: '2026-09-23T08:30', dropoff: '2026-09-30T07:30', branch: 'MAS', card: 'mastercard',
      items: [{ id: 'remote-bond', qty: 1, amount: 1500.00 }, { id: 'deposit-refund', qty: 1, amount: -1500.00 }, { id: 'interstate', qty: 1, amount: 99.00 }] },
    { id: 'old-6', ref: '488790', cat: 'mid-hatch',  idx: 3, fname: 'Aisha', lname: 'Bello',      email: 'aisha.bello@example.com',   pickup: '2026-09-27T09:15', dropoff: '2026-09-30T10:20', branch: 'PAR', card: 'visa',
      // roda raspada no meio-fio: o reparo de $120 lançado na devolução sai do bond (refund de $380)
      items: [...debit, { id: 'damage-ext', qty: 1, amount: 120.00, atReturn: true }] },
    { id: 'old-7', ref: '488855', cat: 'hilux-auto', idx: 3, fname: 'Declan', lname: 'Murphy',    email: 'declan.murphy@example.com', pickup: '2026-09-28T08:00', dropoff: '2026-10-01T16:00', branch: 'EGF', card: 'visa', company: 'Murphy Landscaping',
      items: debit },
    // Cliente do Customer Portal (demo do Bond on Hold): devolveu a van, bond de $500 ainda a devolver.
    // Em Customers & Vehicles → Felipe aparece o botão "🔒 Hold bond" neste booking.
    { id: 'old-9', ref: '488905', cat: 'hiace-1t', idx: 8, fname: 'Felipe', lname: 'Grigolli', email: 'felipe@testgctech.com', pickup: '2026-10-01T09:00', dropoff: '2026-10-03T16:00', branch: 'MAS', card: 'visa',
      items: debit },
    // Já reembolsado — aparece com o filtro "Refunded" e mostra quem fez
    { id: 'old-8', ref: '487990', cat: 'mid-suv',    idx: 2, fname: 'Sofia', lname: 'Lindqvist',  email: 'sofia.lindqvist@example.com', pickup: '2026-09-20T09:00', dropoff: '2026-09-25T09:30', branch: 'NSY', card: 'visa',
      items: debit, refundedBy: 'Alex', refundedAt: '2026-09-29T10:12' }
  ];

  return seeds.map(s => {
    const cat = fleetGetCategory(s.cat);
    // Deslocadas para a data da demo, como as reservas do Planner (gc-fleet-data.js)
    const pickupMs = fleetShiftMs(new Date(s.pickup).getTime());
    const dropoffMs = fleetShiftMs(new Date(s.dropoff).getTime());
    const loc = FLEET_BRANCHES[s.branch];
    const fees = { ...feeDefaults(cat, s.excess), items: s.items };
    const rec = {
      id: s.id, ref: s.ref, fname: s.fname, lname: s.lname, email: s.email, company: s.company || '',
      plate: fleetPlateOf(s.cat, s.idx), categoryId: s.cat, loc, dropoffLoc: loc,
      pickupMs, dropoffMs, fees, card: s.card, seed: true
    };
    rec.payments = bondDefaultPayments(rec);
    if (s.refundedBy) rec.payments.push(bondRefundPayment(rec, s.refundedBy, fleetShiftMs(new Date(s.refundedAt).getTime())));
    return rec;
  });
})();

// ------------------------------------------
// EXTRATO (Rate and Fees + Payments + Balance Due)
// ------------------------------------------
function bondDays(rec) {
  return Math.max(1, Math.ceil((rec.dropoffMs - rec.pickupMs) / FLEET_DAY_MS));
}

function bondCalc(rec) {
  return feeCalc(rec.fees, fleetGetCategory(rec.categoryId), bondDays(rec));
}

// Pagamento feito no momento da reserva: tudo, exceto as devoluções do bond e
// as cobranças lançadas na devolução (atReturn), que são descontadas do bond
function bondDefaultPayments(rec) {
  const prepaid = (rec.fees.items || []).filter(i => !(feeGetItem(i.id) || {}).refund && !i.atReturn);
  const calc = bondCalc({ ...rec, fees: { ...rec.fees, items: prepaid } });
  return [{
    id: 'pay-' + rec.id, type: 'Payment', method: rec.card || 'visa', dateMs: rec.pickupMs,
    reference: 'Card at pick-up (PowerBoard)', amount: Number(calc.grand.toFixed(2)), merchantFee: 0
  }];
}

function bondRefundPayment(rec, agentName, dateMs) {
  const due = bondBalance(rec);
  return {
    id: 'ref-' + rec.id + '-' + dateMs, type: 'Refund', method: rec.card || 'visa', dateMs,
    reference: `${agentName} (${BOND_API_LABEL})`, amount: Number(due.toFixed(2)), merchantFee: 0, refundedBy: agentName
  };
}

function bondPaid(rec) {
  return (rec.payments || []).reduce((s, p) => s + p.amount, 0);
}

// Negativo = devemos ao cliente (bond a devolver)
function bondBalance(rec) {
  const v = bondCalc(rec).grand - bondPaid(rec);
  return Math.abs(v) < 0.005 ? 0 : v;
}

function bondLastRefund(rec) {
  return (rec.payments || []).filter(p => p.type === 'Refund').slice(-1)[0] || null;
}

function bondHasBond(rec) {
  return (rec.fees.items || []).some(i => (feeGetItem(i.id) || {}).bond);
}

// ------------------------------------------
// PERSISTÊNCIA
// ------------------------------------------
function bondReadLedger() {
  try { return JSON.parse(localStorage.getItem(BOND_LEDGER_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function bondWriteLedger(ledger) {
  localStorage.setItem(BOND_LEDGER_KEY, JSON.stringify(ledger));
}

// Todos os bookings devolvidos: os antigos de teste + os marcados como Returned no Fleet Planner
function bondAllRecords() {
  const ledger = bondReadLedger();
  const seeds = BOND_SEED_RETURNED.map(s => {
    const saved = ledger[s.id];
    if (!saved) return s;
    return { ...s, payments: saved.payments || s.payments, hold: saved.hold || null };
  });
  const returned = Object.values(ledger).filter(r => !r.seed && r.ref);
  // Cobranças feitas pela aba Payments (PowerBoard) também contam no saldo
  // Parcelas pagas de Payment Plan do dano também (feePlanPayments, gc-fees-data.js)
  const withCharges = r => ({ ...r, payments: [...(r.payments || []),
    ...(typeof pbLedgerPayments === 'function' ? pbLedgerPayments(r.id) : []),
    ...(typeof feePlanPayments === 'function' ? feePlanPayments(r.ref, r.fees) : [])] });
  return [...seeds, ...returned].map(withCharges).sort((a, b) => a.dropoffMs - b.dropoffMs);
}

function bondGetRecord(id) {
  return bondAllRecords().find(r => r.id === id) || null;
}

// Fleet Planner → booking marcado como Returned entra na fila (mantém os payments se já existia)
function bondUpsertReturned(rec) {
  const ledger = bondReadLedger();
  const prev = ledger[rec.id];
  const next = { ...rec, seed: false };
  // Usa o pagamento congelado da reserva (rec.payments); cobranças do PowerBoard ficam no registro delas
  next.payments = prev && prev.payments ? prev.payments
    : (rec.payments ? rec.payments.filter(p => !p.extra) : bondDefaultPayments(next));
  if (prev && prev.hold) next.hold = prev.hold;
  ledger[rec.id] = next;
  bondWriteLedger(ledger);
  return next;
}

// Voltou de Returned para outro status: sai da fila (se ninguém fez refund ainda)
function bondRemoveReturned(id) {
  const ledger = bondReadLedger();
  if (ledger[id] && !bondLastRefund(ledger[id])) {
    delete ledger[id];
    bondWriteLedger(ledger);
  }
}

// Simula a chamada à API do gateway: devolve o saldo negativo para o cartão do cliente
function bondReleaseRefund(id, agentName) {
  const rec = bondGetRecord(id);
  if (!rec) return { error: 'Booking not found.' };
  const due = bondBalance(rec);
  if (due >= 0) return { error: `Nothing to refund on #${rec.ref} — balance due is ${feeMoney(due)}.` };

  const payment = bondRefundPayment(rec, agentName, Date.now());
  const ledger = bondReadLedger();
  const base = rec.payments.filter(p => !p.extra); // cobranças do PowerBoard ficam no próprio registro delas
  ledger[id] = rec.seed ? { id, seed: true, payments: [...base, payment] } : { ...ledger[id], payments: [...base, payment] };
  delete ledger[id].hold; // bond devolvido: não fica mais guardado para o próximo aluguel
  if (typeof fleetLog === 'function') fleetLog({ bookingId: id, ref: rec.ref, plate: rec.plate, operator: agentName, action: 'Payment', details: `Bond refund of ${feeMoney(-payment.amount)} sent back to the customer's card`, info: 'via PowerBoard · refund transaction' });
  bondWriteLedger(ledger);
  return { ok: true, amount: -payment.amount, rec: bondGetRecord(id) };
}

// ------------------------------------------
// BOND EM HOLD (seguramos o bond em vez de devolver — o motivo é obrigatório)
// Fica no registro do booking devolvido: { by, atMs, reason, note }. Só vale enquanto o bond
// não foi devolvido (saldo negativo); com o refund o hold some sozinho.
// ------------------------------------------
const BOND_HOLD_REASONS = [
  { id: 'next-hire', label: 'Next booking', hint: 'Customer asked us to keep it for the next hire — no new bond needed' },
  { id: 'accident-quote', label: 'Awaiting accident / damage quote', hint: 'Repair quote not in yet — the cost may come out of the bond' },
  { id: 'tolls', label: 'Awaiting toll payments', hint: 'Tolls from the hire still to be charged' },
  { id: 'fines', label: 'Awaiting fines / infringements', hint: 'Waiting for traffic or parking notices' },
  { id: 'other', label: 'Other', hint: 'Explain the reason in the note', needsNote: true }
];

// Holds antigos (sem motivo) eram todos "para o próximo aluguel"
function bondHoldReason(rec) {
  const id = rec && rec.hold ? (rec.hold.reason || 'next-hire') : null;
  return id ? (BOND_HOLD_REASONS.find(r => r.id === id) || BOND_HOLD_REASONS[BOND_HOLD_REASONS.length - 1]) : null;
}

function bondHoldIsNextHire(rec) {
  const r = bondHoldReason(rec);
  return !!r && r.id === 'next-hire';
}

// "Awaiting toll payments · M5 and Harbour Tunnel"
function bondHoldLabel(rec) {
  const r = bondHoldReason(rec);
  if (!r) return '';
  const note = rec.hold.note ? String(rec.hold.note).trim() : '';
  return r.id === 'other' && note ? note : r.label + (note ? ' · ' + note : '');
}
function bondIsHeld(rec) {
  return !!(rec && rec.hold) && bondBalance(rec) < 0;
}

// Valor guardado = o que devemos ao cliente nesse booking
function bondHeldAmount(rec) {
  return bondIsHeld(rec) ? -bondBalance(rec) : 0;
}

function bondHeldForEmail(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return [];
  return bondAllRecords().filter(r => String(r.email || '').toLowerCase() === e && bondIsHeld(r));
}

// reason: um id de BOND_HOLD_REASONS (obrigatório); note: obrigatória quando o motivo é "Other"
function bondSetHold(id, agentName, reason, note) {
  const rec = bondGetRecord(id);
  if (!rec) return { error: 'Booking not found.' };
  if (bondBalance(rec) >= 0) return { error: `There is no bond to hold on #${rec.ref}.` };
  const r = BOND_HOLD_REASONS.find(x => x.id === reason);
  if (!r) return { error: 'Choose why the bond is being held.' };
  note = String(note || '').trim();
  if (r.needsNote && !note) return { error: 'Write the reason for holding the bond.' };
  const ledger = bondReadLedger();
  const base = ledger[id] || { id, seed: true };
  ledger[id] = { ...base, hold: { by: agentName, atMs: Date.now(), reason: r.id, note } };
  bondWriteLedger(ledger);
  const held = bondGetRecord(id);
  if (typeof fleetLog === 'function') fleetLog({ bookingId: id, ref: rec.ref, plate: rec.plate, operator: agentName, action: 'Payment', details: `Bond of ${feeMoney(-bondBalance(rec))} held · ${bondHoldLabel(held)}`, info: r.id === 'next-hire' ? 'No new bond needed on the next hire' : 'Kept out of the refund queue' });
  return { ok: true, rec: held };
}

// Motivo do hold em linguagem para o cliente (Customer Portal). A observação interna não aparece.
const BOND_HOLD_CUSTOMER_TEXT = {
  'next-hire': "You asked us to keep it for your next hire, so you won't be charged a new bond.",
  'accident-quote': "We're waiting for the repair quote. Any cost will be taken from the bond and the rest refunded.",
  'tolls': "We're waiting for toll charges from your hire to come through.",
  'fines': "We're waiting for any traffic or parking notices from your hire.",
  'other': 'Our team is holding it while we finish checking your hire.'
};

function bondHoldCustomerText(rec) {
  const r = bondHoldReason(rec);
  return r ? (BOND_HOLD_CUSTOMER_TEXT[r.id] || BOND_HOLD_CUSTOMER_TEXT.other) : '';
}

// Cliente pediu o refund do bond em hold (portal → chat, WhatsApp ou e-mail). Quem processa é um agente.
function bondRequestRefund(id, channel) {
  const ledger = bondReadLedger();
  const rec = bondGetRecord(id);
  if (!rec || !ledger[id] || !ledger[id].hold) return { error: 'This bond is not on hold.' };
  ledger[id].hold = { ...ledger[id].hold, refundRequest: { at: Date.now(), channel } };
  bondWriteLedger(ledger);
  if (typeof fleetLog === 'function') fleetLog({ bookingId: id, ref: rec.ref, plate: rec.plate, operator: 'Customer (portal)', action: 'Payment',
    details: `Customer asked for the refund of the ${feeMoney(-bondBalance(rec))} bond on hold (by ${channel})`, info: 'An agent needs to review it and release the refund in Bond Refunds' });
  return { ok: true };
}

function bondRefundRequest(rec) {
  return rec && rec.hold && rec.hold.refundRequest ? rec.hold.refundRequest : null;
}

function bondClearHold(id, agentName) {
  const ledger = bondReadLedger();
  if (!ledger[id] || !ledger[id].hold) return { error: 'This bond is not on hold.' };
  const rec = bondGetRecord(id);
  delete ledger[id].hold;
  bondWriteLedger(ledger);
  if (rec && typeof fleetLog === 'function') fleetLog({ bookingId: id, ref: rec.ref, plate: rec.plate, operator: agentName, action: 'Payment', details: 'Bond hold removed — back in the refund queue', info: '' });
  return { ok: true };
}

// ------------------------------------------
// POR QUE O REFUND NÃO É O VALOR DO BOND
// Refund = bond − cobranças lançadas na devolução (km extra, danos, taxas) ± diferença da locação
// (devolveu antes = dias pagos e não usados voltam; devolveu depois = dias extras cobrados).
// ------------------------------------------
const BOND_RETURN_CHARGE_IDS = ['damage-ext', 'damage-int', 'damage-admin', 'windscreen', 'tyre', 'towing', 'cleaning', 'smoking',
  'fuel', 'admin-fee', 'assessment-fee', 'battery', 'call-out', 'card-decline', 'infringement', 'rubbish', 'toll-handling',
  'toll-inc-handling', 'trolley-lost', 'repossession', 'loss-revenue', 'relocation', 'drop-off', 'enforcement', 'legal'];

// → { total, bond, differs, items: [{ label, short, amount }] }  (amount > 0 aumenta o refund)
function bondRefundBreakdown(rec) {
  const calc = bondCalc(rec);
  const round = n => Math.round(n * 100) / 100;
  const total = round(-bondBalance(rec));
  const bond = round(-calc.lines.filter(l => l.refund).reduce((s, l) => s + l.total, 0));
  const atReturn = new Set((rec.fees.items || []).filter(i => i.atReturn).map(i => i.id));
  const items = [];
  calc.lines.forEach(l => {
    if (!l.total) return;
    if (l.id === 'kms-charge') {
      items.push({ label: l.qty != null ? `Extra kms: ${l.qty} km over the allowance × ${feeMoney(l.rate)}` : 'Extra kms charge', short: 'Extra kms', amount: -l.total });
    } else if (l.id && !l.refund && (atReturn.has(l.id) || BOND_RETURN_CHARGE_IDS.includes(l.id))) {
      items.push({ label: `${l.label} charged at return`, short: l.label, amount: -l.total });
    }
  });
  const rest = round(total - bond - items.reduce((s, i) => s + i.amount, 0));
  if (Math.abs(rest) >= 0.005) {
    const ri = rec.returnInfo;
    const unused = ri ? ri.plannedDays - ri.actualDays : 0;
    if (rest > 0) {
      items.push(unused > 0
        ? { label: `Returned early: ${ri.actualDays} of ${ri.plannedDays} days used, ${unused} day${unused > 1 ? 's' : ''} paid and not used`, short: 'Returned early', amount: rest }
        : { label: 'Paid more than the final hire cost', short: 'Overpaid', amount: rest });
    } else {
      items.push(unused < 0
        ? { label: `Returned late: ${-unused} extra day${unused < -1 ? 's' : ''} charged`, short: 'Returned late', amount: rest }
        : { label: 'Final hire cost higher than what was paid', short: 'Balance owed', amount: rest });
    }
  }
  return { total, bond, items, differs: Math.abs(total - bond) >= 0.005 };
}

// Legenda curta (fila do Bond Refunds): "Returned early +$338.00 · Extra kms −$45.00"
function bondBreakdownShort(rec) {
  const b = bondRefundBreakdown(rec);
  if (!b.differs || b.total <= 0) return '';
  return b.items.map(i => `${i.short} ${i.amount > 0 ? '+' : '−'}${feeMoney(Math.abs(i.amount))}`).join(' · ');
}

// Quadro no extrato: cada motivo da diferença em relação ao bond
function bondBreakdownHtml(rec) {
  const b = bondRefundBreakdown(rec);
  if (!b.differs || b.total <= 0 || b.bond <= 0) return '';
  const row = (label, amount, cls) => `<li class="${cls || ''}"><span>${label}</span><b>${amount > 0 ? '+' : amount < 0 ? '−' : ''}${feeMoney(Math.abs(amount))}</b></li>`;
  return `
    <div class="bl-why">
      <div class="bl-why-title">Why the refund is ${feeMoney(b.total)} and not ${feeMoney(b.bond)}</div>
      <ul>
        ${row('Bond to give back', b.bond)}
        ${b.items.map(i => row(i.label, i.amount, i.amount > 0 ? 'plus' : 'minus')).join('')}
        ${row('Refund to the customer', b.total, 'total')}
      </ul>
    </div>`;
}

// ------------------------------------------
// HTML DO EXTRATO (igual à aba "Booking Payments" do RCM)
// ------------------------------------------
function bondFmtDateTime(ms) {
  const d = new Date(ms);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]}, ${d.getDate()} ${FLEET_MONTHS[d.getMonth()]} ${d.getFullYear()} ${fleetFormatTime(ms).replace(/^0/, '')}`;
}

function bondFmtDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${FLEET_MONTHS[d.getMonth()]}/${d.getFullYear()}`;
}

function bondLedgerHtml(rec) {
  const calc = bondCalc(rec);
  const cat = fleetGetCategory(rec.categoryId);
  const balance = bondBalance(rec);
  const gst = calc.grand / 11;
  const cell = v => (v === null || v === undefined ? '-' : v);
  const rate = v => (v === null || v === undefined ? '-' : feeMoney(v));

  return `${bondBreakdownHtml(rec)}
    <div class="bl-renter">
      <div><span>Renter's name</span><strong>${rec.fname} ${rec.lname.toUpperCase()}</strong></div>
      <div><span>Email</span>${rec.email || '-'}</div>
      <div><span>Vehicle</span>${cat ? cat.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) + ' - ' + cat.model : ''} ${rec.plate || ''}</div>
      <div><span>Pickup Date</span>${bondFmtDateTime(rec.pickupMs)} - ${fleetBranchLabel(rec.loc)}</div>
      <div><span>Dropoff Date</span>${bondFmtDateTime(rec.dropoffMs)} - ${fleetBranchLabel(rec.dropoffLoc || rec.loc)}</div>
    </div>

    <table class="bl-fees">
      <thead><tr><th>Rate and Fees</th><th class="c">Days / Nights</th><th class="c">Qty</th><th class="r">Rates</th><th class="r">Total</th></tr></thead>
      <tbody>
        ${calc.lines.map(l => `<tr class="${l.refund ? 'bl-refund-line' : ''}">
          <td>${l.label}${l.note ? `<br><small class="bl-note">${l.note}</small>` : ''}</td><td class="c">${l.label === 'Rate' ? l.days.toFixed(2) : cell(l.days)}</td><td class="c">${cell(l.qty)}</td>
          <td class="r">${rate(l.rate)}</td><td class="r">${feeMoney(l.total)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="bl-total"><span>TOTAL COST</span><span>${feeMoney(calc.grand)}<small>(incl. GST of ${feeMoney(gst)})</small></span></div>

    <table class="bl-payments">
      <thead><tr><th>Type</th><th>Date</th><th>Reference</th><th class="r">Amount</th><th class="r">Merchant Fee</th><th class="r">Paid amount</th></tr></thead>
      <tbody>
        ${(rec.payments || []).map(p => `<tr class="${p.type === 'Refund' ? 'bl-refund' : ''}">
          <td>${p.type}<br><small>${p.method}</small></td><td>${bondFmtDate(p.dateMs)}</td><td>${p.reference}</td>
          <td class="r">${feeMoney(p.amount)}</td><td class="r">${feeMoney(p.merchantFee || 0)}</td><td class="r">${feeMoney(p.amount)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="bl-balance ${balance < 0 ? 'owed' : balance > 0 ? 'due' : 'zero'}"><span>BALANCE DUE</span><span>${feeMoney(balance)}</span></div>`;
}
