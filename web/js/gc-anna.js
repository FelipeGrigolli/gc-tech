// ==========================================
// ANNA INSIDE THE RCM — CONCEITO (só no RCM interno, nada aparece para o público)
// Mostra como o assistente "Anna" da GC Tech poderia funcionar DENTRO do sistema de reservas,
// com o contexto da reserva. ⚠️ Não há IA conectada: as respostas são montadas a partir dos
// dados reais do protótipo (frota, diárias, franquias, taxas, horários, reservas, notas).
// Todos os painéis mostram o selo "Concept".
//
// Pontos de contato:
//   1. Ask Anna (botão flutuante no Agent Dashboard)      → annaInitAsk()
//   2. Sugestão de resposta no chat do agente             → annaOnChatRefresh()
//   3. Rascunho de mensagem para reserva vencida (no-show) → annaDraftNoShow()
//   4. Resumo da reserva no modal do Fleet Planner          → annaSummariseBooking()
//   5. Reserva sem veículo (Agent Requests): opções + mensagem → annaDraftNoVehicle()
// Depende de: gc-fleet-data.js (e gc-fees-data.js quando existir na página)
// ==========================================

const ANNA_CONCEPT = 'Concept · how Anna could work inside the RCM · simulated, no AI connected';
const ANNA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function annaEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function annaMoney(n) { return '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function annaTime(ms) { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function annaDate(ms) { const d = new Date(ms); return `${ANNA_DAYS[d.getDay()]} ${d.getDate()} ${FLEET_MONTHS[d.getMonth()]}`; }
function annaBranchName(code) { const full = FLEET_BRANCHES[code] || ''; return full.split(' - ')[1] || full; }
function annaAgentName() {
  return (typeof getAgentName === 'function' ? getAgentName() : localStorage.getItem('gc_agent_name')) || 'the GC Tech team';
}

// ---------- Dados ----------
// Reserva por referência, de qualquer origem (demonstração, site/portal/Add Booking, GC-8832)
function annaFindBooking(ref) {
  if (!ref) return null;
  const norm = String(ref).toUpperCase().replace(/^#/, '');
  const build = (o) => {
    const v = o.plate ? fleetGetVehicle(o.plate) : null;
    const cat = o.cat || (v ? fleetGetCategory(v.categoryId) : null);
    const branch = o.branch || (v ? v.branch : '');
    return { ...o, vehicle: v, cat, branch, days: Math.max(1, Math.ceil((o.end - o.start) / FLEET_DAY_MS)) };
  };
  let found = null;
  fleetForEachStoredBooking((list, key, email) => {
    if (found) return;
    const b = list.find(x => String(x.ref).toUpperCase() === norm);
    if (b) {
      const r = fleetBookingRange(b);
      found = build({ id: String(b.id), ref: b.ref, fname: b.fname || '', lname: b.lname || '', email, phone: b.phone || '',
        start: r.start, end: r.end, plate: b.plate, cat: fleetFindCategoryByModel(b.vehicle), status: b.status,
        type: b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation',
        branch: Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === b.loc) || '', notes: b.notesList || [],
        extras: b.extras || {}, excessOption: (b.fees && b.fees.insurance) || b.excessOption, priceTotal: b.priceTotal, amountPaid: b.amountPaid, seriesId: b.seriesId,
        money: typeof feeBookingMoney === 'function' ? feeBookingMoney(b) : null });
    }
  });
  if (found) return found;
  const s = fleetSeedBookings().find(x => String(x.ref).toUpperCase() === norm);
  if (s) return build({ id: s.id, ref: s.ref, fname: s.fname, lname: s.lname, email: s.clientEmail, phone: '', start: s.startMs, end: s.endMs,
    plate: s.plate, type: s.type, notes: s.notesList || [], seriesId: s.seriesId, maintenance: s.type === 'maintenance', holdName: s.name });
  if (norm === 'GC-8832') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
      let state = {};
      try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
      const r = fleetMainBookingRange(state);
      return build({ id: 'main-' + key.slice(FLEET_MAIN_PREFIX.length), ref: 'GC-8832', fname: 'Felipe', lname: 'Grigolli', email: key.slice(FLEET_MAIN_PREFIX.length),
        start: r.start, end: r.end, plate: FLEET_MAIN_BOOKING_PLATE, type: fleetMainBookingType(state), branch: 'MAS', notes: fleetBookingNotes('main-' + key.slice(FLEET_MAIN_PREFIX.length)) });
    }
  }
  return null;
}

// Categoria citada na pergunta ("pantech", "hiace 1.5", "7 seater", "yaris hybrid"…)
function annaFindCategory(text) {
  const t = ' ' + String(text).toLowerCase().replace(/[^a-z0-9. ]/g, ' ') + ' ';
  const synonyms = { truck: 'pantech', pantech: 'pantech', 'tail lift': 'pantech', ute: 'hilux-auto', hilux: 'hilux-auto', '4x4': 'hilux-diesel',
    'people mover': 'eight-seat', '8 seater': 'eight-seat', staria: 'eight-seat', kluger: 'full-7seat', outlander: 'mid-7seat', '7 seater': 'mid-7seat',
    camry: 'full-car', asx: 'mid-suv', cross: 'cross-suv', sedan: 'mid-sedan', hatch: 'mid-hatch', corolla: 'mid-hatch', yaris: 'small-auto', van: 'hiace-1t', hiace: 'hiace-1t' };
  let best = null, bestScore = 0;
  FLEET_CATEGORIES.forEach(c => {
    const words = `${c.name} ${c.model} ${c.label}`.toLowerCase().split(/[^a-z0-9.]+/).filter(w => w.length > 2);
    const score = words.reduce((s, w) => s + (t.includes(' ' + w + ' ') ? 1 : 0), 0);
    if (score > bestScore) { best = c; bestScore = score; }
  });
  if (bestScore >= 2) return best;
  if (/1\.5/.test(t) && /hiace|van/.test(t)) return fleetGetCategory('hiace-15t');
  if (/hybrid/.test(t) && /yaris/.test(t)) return fleetGetCategory('small-hybrid');
  // Palavra inteira ("ute" não pode casar com "minute")
  for (const k of Object.keys(synonyms)) if (t.includes(' ' + k + ' ') || t.includes(' ' + k + 's ')) return fleetGetCategory(synonyms[k]);
  return best;
}

function annaFindBranch(text) {
  const t = String(text).toLowerCase();
  return Object.keys(FLEET_BRANCHES).find(code => t.includes(annaBranchName(code).toLowerCase())) || null;
}

function annaFee(id) { return typeof FEE_ITEMS !== 'undefined' ? FEE_ITEMS.find(f => f.id === id) : null; }

// Veículos livres de uma categoria num dia (09:00–17:00), por filial
function annaAvailability(cat, dayMs) {
  const s = new Date(dayMs); s.setHours(9, 0, 0, 0);
  const e = new Date(dayMs); e.setHours(17, 0, 0, 0);
  const occ = fleetGetOccupancy();
  const byBranch = {};
  FLEET_VEHICLES.filter(v => v.categoryId === cat.id).forEach(v => {
    if (fleetIsPlateFree(v.plate, s.getTime(), e.getTime(), null, occ)) byBranch[v.branch] = (byBranch[v.branch] || 0) + 1;
  });
  return byBranch;
}

// ---------- 1. Ask Anna: perguntas rápidas respondidas com os dados do sistema ----------
// "Posso devolver em Brisbane?", "one way Sydney to Brisbane", "drop off in Queensland"...
// Pergunta sobre como/quando pagar (não sobre bond, que tem resposta própria)
function annaIsPaymentQuestion(t) {
  return /\b(cash|bank transfer|transfer the money|eftpos|afterpay|upfront|in advance|pay (now|online|later|in person|at the (branch|counter|desk))|when (do|will|should) i (pay|be charged)|how (do|can|should) i pay|payment methods?|accept (cards?|credit|debit|visa|mastercard|amex|payments?)|charged (now|today|before)|deposit now)\b/.test(t);
}

function annaIsOneWayQuestion(t) {
  if (/one[\s-]?way/.test(t)) return true;
  const qld = /(brisbane|queensland|\bqld\b|gold coast)/.test(t);
  const nsw = /(sydney|\bnsw\b|new south wales)/.test(t);
  if (qld && nsw) return true;                                   // "Sydney to Brisbane"
  const returning = /(return|drop[\s-]?off|leave the (car|van|truck|vehicle)|end the hire)/.test(t);
  return returning && (qld || /(interstate|another (city|state)|different (city|state)|other (city|state))/.test(t));
}

function annaAnswer(question) {
  const q = String(question || '').trim();
  const t = q.toLowerCase();
  const cat = annaFindCategory(q);
  const refMatch = q.match(/\b(OR-\d{3,6}|\d{6})\b/i);

  // Reserva específica
  if (refMatch) {
    const b = annaFindBooking(refMatch[1]);
    if (b) return { html: annaBookingSummaryHtml(b), source: 'Planner bookings' };
    return { html: `I couldn't find booking <strong>${annaEsc(refMatch[1])}</strong>. Check the reference in Daily Activity or Customers &amp; Vehicles.`, source: 'Planner bookings' };
  }

  // Forma de pagamento: só cartão, na loja, no pick-up (nada antes)
  if (annaIsPaymentQuestion(t)) {
    return { html: `<ul>
      <li><strong>Nothing is charged before pick-up.</strong> Bookings made online or by phone are not charged in advance.</li>
      <li>Payment is taken <strong>at the branch, at pick-up, by the agent</strong>: the rental total plus the <strong>${annaMoney(404)} bond</strong>.</li>
      <li><strong>Extensions and payment plan instalments</strong> don't need a branch visit: the customer pays by phone, live chat or WhatsApp and the agent processes it on the card.</li>
      <li><strong>Credit or debit card only</strong>, in the main driver's name.</li>
      <li><strong>No cash and no bank transfer.</strong></li></ul>`, source: 'GC Tech payment policy' };
  }

  // One-way entre cidades: não existe (Sydney ↔ Brisbane)
  if (annaIsOneWayQuestion(t)) {
    return { html: `<strong>No one-way hires between Sydney and Brisbane.</strong> The vehicle must be returned to a branch in the same city it was picked up from.<ul>
      <li>Sydney: Parramatta, Mascot, Blacktown, North Sydney</li>
      <li>Brisbane: Eagle Farm, Woolloongabba</li></ul>
      <span class="anna-muted">Returning to another branch in the same city is fine.</span>`, source: 'Rental rules · one-way' };
  }

  // Disponibilidade ("any pantech free tomorrow?")
  if (/(availab|free|have any|spare)/.test(t) && cat) {
    const day = new Date(); day.setHours(0, 0, 0, 0);
    if (/tomorrow/.test(t)) day.setDate(day.getDate() + 1);
    ANNA_DAYS.forEach((d, i) => { if (t.includes(d.toLowerCase())) { while (day.getDay() !== i) day.setDate(day.getDate() + 1); } });
    const by = annaAvailability(cat, day.getTime());
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const list = Object.entries(by).map(([b, n]) => `<li>${annaEsc(annaBranchName(b))}: <strong>${n}</strong></li>`).join('');
    return {
      html: total
        ? `<strong>${total} ${annaEsc(cat.model)}</strong> free on ${annaDate(day.getTime())} (09:00–17:00):<ul>${list}</ul>`
        : `No <strong>${annaEsc(cat.model)}</strong> is free all day on ${annaDate(day.getTime())}. Offer an alternative category or check the Fleet Planner for part-day gaps.`,
      source: 'Fleet Planner availability'
    };
  }

  // Franquia / seguro
  if (/(excess|insurance|cover|damage liability)/.test(t)) {
    if (cat && cat.excess) {
      return { html: `<strong>${annaEsc(cat.model)}</strong> (${annaEsc(cat.name)}):<ul>
        <li>Standard excess: <strong>${annaMoney(cat.excess.standard)}</strong></li>
        <li>Excess reduction: <strong>${annaMoney(cat.excess.reducedPerDay)}/day</strong>, reduces the excess to <strong>${annaMoney(cat.excess.reduced)}</strong></li></ul>`,
        source: 'Fleet data · excess tiers' };
    }
    return { html: `Excess depends on the vehicle. Ask me with a model, e.g. <em>"excess for a Pantech"</em> or <em>"excess for a Kluger"</em>.`, source: 'Fleet data · excess tiers' };
  }

  // Diária / preço
  if (/(rate|price|cost|how much|per day|daily)/.test(t) && cat) {
    const days = Number((t.match(/(\d+)\s*(day|days|night)/) || [])[1]) || 0;
    return { html: `<strong>${annaEsc(cat.model)}</strong>: ${annaMoney(cat.rate)} per day` +
      (days ? `<br>${days} days ≈ <strong>${annaMoney(cat.rate * days)}</strong> before extras and excess reduction.` : '') +
      `<br><span class="anna-muted">Excess reduction adds ${annaMoney(cat.excess.reducedPerDay)}/day.</span>`, source: 'Fleet data · daily rates' };
  }

  // Bond / caução
  if (/(bond|deposit|refund)/.test(t)) {
    const bond = annaFee('debit-bond'), refund = annaFee('debit-bond-refund'), remote = annaFee('remote-bond');
    return { html: `<ul>
      <li>Visa/MC bond: <strong>${annaMoney(bond ? bond.amount : 404)}</strong>, charged at pick-up (never before), of which <strong>${annaMoney(Math.abs(refund ? refund.amount : 400))}</strong> is refunded after return (5–7 working days).</li>
      <li>Remote location bond: <strong>${annaMoney(remote ? remote.amount : 1200)}</strong>, refunded in full.</li>
      <li>Fees charged at return (e.g. cleaning, smoking) come out of the bond first.</li></ul>`, source: 'Fees catalogue · bonds' };
  }

  // Horários
  if (/(open|opening|hours|close|closing|what time|after hours)/.test(t)) {
    return { html: `Pick-ups and returns are <strong>08:00 to 17:15</strong>, in 15-minute slots, at all branches.<br><span class="anna-muted">After-hours returns need to be arranged with the branch.</span>`, source: 'Booking rules · opening hours' };
  }

  // Filiais
  if (/(branch|branches|location|locations|where)/.test(t)) {
    return { html: `GC Tech has ${Object.keys(FLEET_BRANCHES).length} branches:<ul>${Object.values(FLEET_BRANCHES).map(b => `<li>${annaEsc(b)}</li>`).join('')}</ul>`, source: 'Fleet data · branches' };
  }

  // Animais: não são permitidos; se acontecer, cobra-se a mesma taxa da limpeza
  if (/\b(pets?|dogs?|cats?|puppy|animals?)\b/.test(t)) {
    const fee = annaFee('cleaning');
    return { html: `<strong>Pets and animals are not allowed</strong> in GC Tech vehicles.<br>If a vehicle comes back with signs of an animal (hair, smell or marks), a <strong>${annaMoney(fee ? fee.amount : 330)}</strong> fee applies, the same as the cleaning fee. It is charged at return and taken from the bond first.`, source: 'Rental rules · fees catalogue' };
  }

  // Fumo e limpeza: $330 cada
  if (/(smok|cigar|vape|clean|dirty|vomit|mess)/.test(t)) {
    const smoking = annaFee('smoking'), cleaning = annaFee('cleaning');
    return { html: `<ul>
      <li><strong>Smoking fee:</strong> ${annaMoney(smoking ? smoking.amount : 330)}. Smoking and vaping are not allowed in any vehicle.</li>
      <li><strong>Cleaning fee:</strong> ${annaMoney(cleaning ? cleaning.amount : 330)}, when the vehicle comes back dirty and needs extra cleaning.</li></ul>
      <span class="anna-muted">Both are charged at return and taken from the bond first.</span>`, source: 'Fees catalogue' };
  }

  // Taxas específicas
  if (typeof FEE_ITEMS !== 'undefined') {
    const fee = FEE_ITEMS.filter(f => f.amount > 0 && !f.refund).find(f => f.name.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3).some(w => t.includes(w)));
    if (fee && /(fee|charge|cost|how much|price|penalty|fine)/.test(t)) {
      return { html: `<strong>${annaEsc(fee.name)}</strong>: ${annaMoney(fee.amount)}${fee.kind === 'daily' ? ' per day' : ''}.`, source: 'Fees catalogue' };
    }
  }

  return {
    html: `In this concept I can answer from GC Tech's own data: <strong>excess</strong>, <strong>daily rates</strong>, <strong>bonds</strong>, <strong>fees</strong>, <strong>opening hours</strong>, <strong>branches</strong>, <strong>availability</strong> and any <strong>booking reference</strong>.<br><span class="anna-muted">The full version would also read GC Tech's policy documents and procedures.</span>`,
    source: 'Concept'
  };
}

// ---------- 4. Resumo da reserva ----------
function annaBookingSummaryHtml(b) {
  const now = Date.now();
  const typeLabel = { reservation: 'Reservation', hired: 'On hire', returned: 'Returned', maintenance: 'Maintenance', 'possible-ext': 'Hold' }[b.type] || b.type;
  const stale = b.type === 'reservation' && b.start < fleetStartOfToday();
  const overdue = b.type === 'hired' && b.end < now;
  const otherBookings = [];
  if (b.email) {
    fleetSeedBookings().forEach(s => { if (s.clientEmail === b.email && s.ref !== b.ref) otherBookings.push(s.ref); });
    fleetForEachStoredBooking((list, key, email) => { if (email === b.email) list.forEach(x => { if (x.ref !== b.ref) otherBookings.push(x.ref); }); });
  }
  // Mesmo valor e pagamento da aba Payments do Planner
  const value = b.money ? b.money.grand : b.priceTotal != null ? Number(b.priceTotal) : (b.cat ? b.cat.rate * b.days : 0);
  const paid = b.money ? b.money.paid : Number(b.amountPaid) || 0;
  const flags = [
    stale ? `<li class="anna-flag">Pick-up was ${annaDate(b.start)} and it is still a Reservation — move it or cancel it.</li>` : '',
    overdue ? `<li class="anna-flag">Vehicle was due back ${annaDate(b.end)} ${annaTime(b.end)} and is not returned yet.</li>` : '',
    b.seriesId ? '<li>Part of a weekly series (regular customer).</li>' : ''
  ].join('');
  const latest = (b.notes || []).slice(-2).reverse().map(n => `<li>“${annaEsc(n.text)}” <span class="anna-muted">— ${annaEsc(n.author || '')}${n.dateStr ? ', ' + annaEsc(n.dateStr) : ''}</span></li>`).join('');
  if (b.maintenance) {
    return `<p><strong>${annaEsc(b.holdName || 'Maintenance')}</strong> on ${annaEsc(b.plate)} (${annaEsc(b.cat ? b.cat.model : '')}) from ${annaDate(b.start)} ${annaTime(b.start)} to ${annaDate(b.end)} ${annaTime(b.end)}.</p>${latest ? `<p class="anna-sub">Latest notes</p><ul>${latest}</ul>` : ''}`;
  }
  return `
    <p><strong>${annaEsc(b.ref)} · ${annaEsc(`${b.fname} ${b.lname}`.trim())}</strong> — ${annaEsc(typeLabel)}</p>
    <ul>
      <li>${annaEsc(b.cat ? b.cat.model : 'Vehicle')}${b.plate ? ` · <strong>${annaEsc(b.plate)}</strong>` : ' · not allocated yet'} at ${annaEsc(annaBranchName(b.branch))}</li>
      <li>${annaDate(b.start)} ${annaTime(b.start)} → ${annaDate(b.end)} ${annaTime(b.end)} (${b.days} day${b.days > 1 ? 's' : ''})</li>
      <li>Rental value ${annaMoney(value)}${paid ? `, paid ${annaMoney(paid)}` : ''}${b.money && b.money.balance > 0.004 ? `, <strong>balance due ${annaMoney(b.money.balance)}</strong>` : ''}${b.excessOption === 'reduced' ? ' · excess reduction taken' : ''}</li>
      <li>${otherBookings.length ? `Repeat customer — ${otherBookings.length} other booking${otherBookings.length > 1 ? 's' : ''}` : 'First booking with GC Tech'}${b.email ? ` · ${annaEsc(b.email)}` : ''}</li>
      ${flags}
    </ul>
    ${latest ? `<p class="anna-sub">Latest notes</p><ul>${latest}</ul>` : '<p class="anna-muted">No notes on this booking.</p>'}`;
}

function annaSummariseBooking(ref) {
  const b = annaFindBooking(ref);
  annaShowModal({
    title: `Summary · ${ref}`,
    bodyHtml: b ? annaBookingSummaryHtml(b) : `<p>Booking ${annaEsc(ref)} could not be found.</p>`,
    source: 'Booking, notes and customer history'
  });
}

// ---------- 3. Rascunho para reserva vencida (no-show) ----------
function annaNoShowText(r) {
  const first = (r.customer || '').split(' ')[0] || 'there';
  return `Hi ${first},\n\nWe had your ${r.model || 'vehicle'} ready for pick-up at our ${annaBranchName(r.branch)} branch on ${annaDate(r.start)} at ${annaTime(r.start)} (booking ${r.ref}), but we didn't see you.\n\n` +
         `Would you like us to move your booking to another day? Reply with a new date and time (we're open 08:00–17:15) and we'll check the vehicle for you. ` +
         `If you no longer need it, just let us know and we'll cancel it.\n\nKind regards,\n${annaAgentName()}\nGC Tech Rentals`;
}

function annaDraftNoShow(id) {
  const r = (typeof fleetStaleReservations === 'function' ? fleetStaleReservations() : []).find(x => x.id === id);
  if (!r) return;
  const text = annaNoShowText(r);
  const canChat = typeof ensureChatSession === 'function' && typeof sendChatMessage === 'function' && r.email;
  annaShowModal({
    title: `Message for ${r.customer} · ${r.ref}`,
    bodyHtml: `<p class="anna-sub">Anna drafted this from the booking: missed pick-up, vehicle, branch and opening hours.</p>
               <textarea class="anna-draft" id="anna-draft-text" rows="11">${annaEsc(text)}</textarea>`,
    source: 'Booking details · booking rules',
    actions: [
      { label: 'Copy', kind: 'ghost', run: () => annaCopy(document.getElementById('anna-draft-text').value) },
      canChat ? { label: 'Send in booking chat', kind: 'primary', run: (close) => {
        const sessionId = `${r.email}_${r.ref}`;
        ensureChatSession(sessionId, r.email, r.customer, r.ref, annaDate(r.start), r.plate || 'N/A');
        // Chat com outro agente: não manda uma segunda resposta ao cliente
        const lock = typeof chatLockedByOther === 'function' ? chatLockedByOther(sessionId) : null;
        if (lock) {
          if (typeof gcToast === 'function') gcToast(`${lock.agent} is handling ${r.ref}'s chat\n\nAsk them, or take over the chat in Live Chat first.`, 'warning');
          return;
        }
        sendChatMessage(sessionId, 'agent', annaAgentName(), document.getElementById('anna-draft-text').value);
        close();
        if (typeof gcToast === 'function') gcToast(`Message sent in ${r.ref}'s booking chat.`);
      } } : null
    ].filter(Boolean)
  });
}

// ---------- 5. Reserva sem veículo (Agent Requests): opções reais + rascunho ----------
// A Anna procura na frota o que dá para oferecer (sempre na mesma cidade: não há one-way SYD↔BNE):
//   • mesma categoria em outra filial, mesmas datas
//   • mesma categoria em datas próximas (±1 a 7 dias, mesma duração)
//   • outras categorias da mesma linha (Passenger/Commercial), mesmas datas
// O agente escolhe o que oferecer; a Anna escreve a mensagem e ela sai por WhatsApp ou e-mail
// conforme a preferência do cliente.
function annaLoadStored(email, id) {
  const key = FLEET_MULTI_PREFIX + email;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  return { key, list, b: list.find(x => String(x.id) === String(id)) || null };
}

function annaNoVehicleOptions(b) {
  const r = fleetBookingRange(b);
  const len = r.end - r.start;
  const cat = fleetFindCategoryByModel(b.vehicle);
  const pickup = Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === b.loc) || '';
  const city = fleetBranchCity(b.loc);
  const occ = fleetGetOccupancy().filter(o => o.id !== String(b.id));
  const sameCity = code => fleetBranchCity(code) === city;
  const free = (catId, s, e, branchOk) => FLEET_VEHICLES
    .filter(v => v.categoryId === catId && sameCity(v.branch) && (!branchOk || branchOk(v.branch)) && fleetIsPlateFree(v.plate, s, e, null, occ))
    .sort((a, c) => (c.branch === pickup) - (a.branch === pickup));
  const where = code => code === pickup ? '' : ` from our ${annaBranchName(code)} branch`;
  const opts = [];
  if (cat) {
    // Outra filial, mesmas datas
    const seen = new Set();
    free(cat.id, r.start, r.end, code => code !== pickup).forEach(v => {
      if (seen.has(v.branch) || seen.size >= 2) return;
      seen.add(v.branch);
      opts.push({ id: 'loc-' + v.branch, group: 'Same vehicle, another branch', plate: v.plate,
        label: `${cat.model} at ${annaBranchName(v.branch)} · same dates`,
        text: `the same ${cat.model} on the same dates, picked up from our ${annaBranchName(v.branch)} branch instead` });
    });
    // Datas próximas
    let n = 0;
    for (const d of [1, -1, 2, -2, 3, -3, 4, 5, 6, 7]) {
      if (n >= 2) break;
      const s = r.start + d * FLEET_DAY_MS, e = s + len;
      if (s < Date.now() || !fleetIsValidBookingTime(s) || !fleetIsValidBookingTime(e)) continue;
      const v = free(cat.id, s, e)[0];
      if (!v) continue;
      n++;
      opts.push({ id: 'date-' + d, group: 'Same vehicle, other dates', plate: v.plate,
        label: `${cat.model} · ${annaDate(s)} ${annaTime(s)} → ${annaDate(e)} ${annaTime(e)}${v.branch !== pickup ? ` · ${annaBranchName(v.branch)}` : ''}`,
        text: `the ${cat.model} from ${annaDate(s)} at ${annaTime(s)} to ${annaDate(e)} at ${annaTime(e)}${where(v.branch)}` });
    }
  }
  // Outras categorias da mesma linha, mesmas datas (diária mais parecida primeiro)
  FLEET_CATEGORIES
    .filter(c => !cat || (c.section === cat.section && c.id !== cat.id))
    .map(c => ({ c, v: free(c.id, r.start, r.end)[0] }))
    .filter(x => x.v)
    .sort((a, c) => Math.abs(a.c.rate - (cat ? cat.rate : 0)) - Math.abs(c.c.rate - (cat ? cat.rate : 0)))
    .slice(0, 3)
    .forEach(x => {
      const diff = cat ? x.c.rate - cat.rate : 0;
      opts.push({ id: 'cat-' + x.c.id, group: 'Another vehicle, same dates', plate: x.v.plate, diff,
        label: `${x.c.model} · ${annaMoney(x.c.rate)}/day${diff > 0 ? ` · +${annaMoney(diff)}/day` : diff < 0 ? ` · ${annaMoney(-diff)}/day less` : ' · same rate'}${x.v.branch !== pickup ? ` · ${annaBranchName(x.v.branch)}` : ''}`,
        text: `a ${x.c.model} on the same dates${where(x.v.branch)}`,
        price: diff > 0 ? `${annaMoney(diff)} more per day` : diff < 0 ? `${annaMoney(-diff)} less per day` : 'at the same daily rate' });
    });
  return { r, cat, pickup, opts };
}

function annaNoVehicleText(b, info, picked, keepPrice, channel) {
  const first = (b.fname || '').trim() || 'there';
  const model = info.cat ? info.cat.model : b.vehicle;
  const line = o => o.text + (o.price ? (keepPrice && o.diff > 0 ? ', at no extra cost' : `, ${o.price}`) : '');
  if (channel === 'template') {
    return picked.map((o, i) => `${i + 1}) ${line(o)}`).join('; ');
  }
  const list = picked.length ? picked.map((o, i) => `${i + 1}. ${line(o).charAt(0).toUpperCase() + line(o).slice(1)}`).join('\n') : '[tick at least one option above]';
  const short = channel === 'whatsapp';
  return `Hi ${first},\n\n` +
    `${short ? '' : 'Thanks for booking with GC Tech. '}Unfortunately the ${model} you booked (${b.ref}) isn't available for ${annaDate(info.r.start)} ${annaTime(info.r.start)} to ${annaDate(info.r.end)} ${annaTime(info.r.end)} at our ${annaBranchName(info.pickup)} branch.\n\n` +
    `Here is what we can offer instead:\n${list}\n\n` +
    `Reply with the option that suits you best and I'll confirm it straight away. If none of these work, just let us know and we'll close the request. You haven't been charged.` +
    (short ? `\n\n${annaAgentName()} · GC Tech` : `\n\nKind regards,\n${annaAgentName()}\nGC Tech Rentals`);
}

function annaDraftNoVehicle(email, id) {
  const { key, list, b } = annaLoadStored(email, id);
  if (!b) return;
  const info = annaNoVehicleOptions(b);
  const bk = typeof waFindBooking === 'function' ? waFindBooking(String(b.id)) : null;
  const phone = (bk && bk.phone) || b.phone || '';
  const route = typeof waChannelFor === 'function' ? waChannelFor(bk || { email }, phone) : { channel: 'email', email };
  const thread = typeof waThread === 'function' && phone ? waThread(phone) : null;
  const windowOpen = !!(thread && thread.windowOpen);
  const state = {
    picked: new Set(info.opts.filter((o, i, all) => all.findIndex(x => x.group === o.group) === i).map(o => o.id)), // o 1º de cada grupo
    keepPrice: false,
    channel: route.channel === 'whatsapp' && phone ? 'whatsapp' : 'email',
    edited: false
  };
  const model = info.cat ? info.cat.model : b.vehicle;
  const groups = [...new Set(info.opts.map(o => o.group))];

  annaShowModal({
    title: `Options for ${`${b.fname || ''} ${b.lname || ''}`.trim() || email} · ${b.ref}`,
    bodyHtml: `
      <p class="anna-sub">No ${annaEsc(model)} free for ${annaDate(info.r.start)} ${annaTime(info.r.start)} → ${annaDate(info.r.end)} ${annaTime(info.r.end)} at ${annaEsc(annaBranchName(info.pickup))}</p>
      <p>Anna checked the fleet for what you can offer. Tick what you want to send — you decide, Anna writes it.</p>
      ${info.opts.length ? groups.map(g => `
        <div class="anv-group"><div class="anv-group-title">${annaEsc(g)}</div>
          ${info.opts.filter(o => o.group === g).map(o => `
            <label class="anv-opt"><input type="checkbox" data-anv-opt="${annaEsc(o.id)}" ${state.picked.has(o.id) ? 'checked' : ''}> <span>${annaEsc(o.label)}</span></label>`).join('')}
        </div>`).join('') : '<p class="anna-flag">Nothing free in the same city within a week. Consider declining the request or calling the customer.</p>'}
      ${info.opts.some(o => o.diff > 0) ? `<label class="anv-opt anv-keep"><input type="checkbox" data-anv="keep"> <span>Offer the dearer vehicles at the original price (no extra cost)</span></label>` : ''}
      <div class="anv-channel">
        <span>Send by</span>
        <button type="button" data-anv-ch="whatsapp" ${phone ? '' : 'disabled title="No mobile on this booking"'}>WhatsApp</button>
        <button type="button" data-anv-ch="email" ${route.email ? '' : 'disabled title="No email on this booking"'}>Email</button>
        ${typeof waPrefChip === 'function' && route.email ? waPrefChip(route.email) : ''}
      </div>
      <p class="anna-muted" id="anv-note"></p>
      <textarea class="anna-draft" id="anv-text" rows="12"></textarea>`,
    source: 'Fleet availability · booking · contact preference',
    actions: [
      { label: 'Copy', kind: 'ghost', run: () => annaCopy(document.getElementById('anv-text').value) },
      { label: 'Send to customer', kind: 'primary', run: (close) => {
        const picked = info.opts.filter(o => state.picked.has(o.id));
        if (!picked.length) { gcToast('Tick at least one option to offer.', 'warning'); return; }
        const text = document.getElementById('anv-text').value.trim();
        if (!text) { gcToast('The message is empty.', 'warning'); return; }
        const send = () => {
          let msg = null;
          if (state.channel === 'email') {
            msg = waSendEmail(bk || { id: String(b.id), ref: b.ref, email, plate: '' }, phone, text, 'vehicle_options', annaAgentName());
          } else {
            if (!waAssignee(phone)) waSetAssignee(phone, waAgent(), 'Assigned', `WhatsApp conversation with ${phone} taken by ${waAgent()}`);
            msg = windowOpen
              ? waSend({ phone, bookingId: String(b.id), text, channel: 'whatsapp' })
              : waSend({ phone, bookingId: String(b.id), template: 'vehicle_options', vars: { requested: model, options: annaNoVehicleText(b, info, picked, state.keepPrice, 'template') }, channel: 'whatsapp' });
          }
          if (!msg) return;
          // Guarda na reserva: aparece em Agent Requests e nas notas
          const fresh = annaLoadStored(email, id);
          if (fresh.b) {
            const sentBy = msg.channel === 'email' ? 'email' : 'WhatsApp';
            fresh.b.optionsSent = { at: Date.now(), by: annaAgentName(), channel: sentBy, options: picked.map(o => o.label) };
            (fresh.b.notesList = fresh.b.notesList || []).push({ id: Date.now(), priority: 'Medium', status: 'Active', subject: 'Options sent',
              text: `Options sent by ${sentBy}: ${picked.map(o => o.label).join(' | ')}`, dateStr: fleetNoteDateStr(Date.now()), author: annaAgentName() });
            localStorage.setItem(fresh.key, JSON.stringify(fresh.list));
          }
          if (typeof fleetLog === 'function') fleetLog({ bookingId: String(b.id), ref: b.ref, operator: annaAgentName(), action: 'Offer',
            details: `Options sent to the customer (${picked.length}): ${picked.map(o => o.label).join(' | ')}`, info: `Drafted with Anna · sent by ${msg.channel === 'email' ? 'email' : 'WhatsApp'}` });
          close();
          if (typeof renderAllocationTable === 'function') renderAllocationTable();
        };
        if (state.channel === 'whatsapp' && typeof waLockedByOther === 'function' && waLockedByOther(phone)) {
          waTakeOver(phone).then(ok => { if (ok) send(); });
        } else send();
      } }
    ]
  });

  const box = document.querySelector('.anna-overlay:last-of-type');
  const ta = box.querySelector('#anv-text');
  const note = box.querySelector('#anv-note');
  const render = () => {
    const picked = info.opts.filter(o => state.picked.has(o.id));
    const template = state.channel === 'whatsapp' && !windowOpen;
    box.querySelectorAll('[data-anv-ch]').forEach(btn => btn.classList.toggle('on', btn.dataset.anvCh === state.channel));
    note.textContent = state.channel === 'email'
      ? `Goes by email to ${route.email}. Edit anything before sending.`
      : template
        ? 'No message from the customer in the last 24 h, so WhatsApp only allows an approved template. The options you ticked fill the template; once the customer replies you can write freely.'
        : 'The customer wrote in the last 24 h: this goes as a free WhatsApp reply. Edit anything before sending.';
    ta.readOnly = template;
    if (template) {
      ta.value = WA_TEMPLATES.vehicle_options.body(Object.assign(bk ? waVarsFor(bk) : { name: b.fname || '', ref: b.ref }, { requested: model, options: annaNoVehicleText(b, info, picked, state.keepPrice, 'template') || '[tick at least one option]' }));
    } else if (!state.edited) {
      ta.value = annaNoVehicleText(b, info, picked, state.keepPrice, state.channel);
    }
  };
  box.addEventListener('change', e => {
    const opt = e.target.dataset && e.target.dataset.anvOpt;
    if (opt) { e.target.checked ? state.picked.add(opt) : state.picked.delete(opt); state.edited = false; render(); }
    if (e.target.dataset && e.target.dataset.anv === 'keep') { state.keepPrice = e.target.checked; state.edited = false; render(); }
  });
  box.addEventListener('click', e => {
    const ch = e.target.closest('[data-anv-ch]');
    if (ch && !ch.disabled) { state.channel = ch.dataset.anvCh; state.edited = false; render(); }
  });
  ta.addEventListener('input', () => { state.edited = true; });
  render();
}

// ---------- 2. Sugestão de resposta no chat do agente ----------
function annaSuggestReply(session, customerText) {
  const t = String(customerText || '').toLowerCase();
  const b = session && session.bookingRef && session.bookingRef !== 'General' ? annaFindBooking(session.bookingRef) : null;
  const first = (session && session.customerName ? session.customerName : 'there').split(' ')[0];
  const sign = `\n\n${annaAgentName()} · GC Tech`;
  const when = b ? `${annaDate(b.start)} at ${annaTime(b.start)}` : '';
  const where = b ? annaBranchName(b.branch) : '';

  // Regras da locação primeiro: "posso levar meu cachorro na retirada?" é sobre animais, não sobre horário
  if (annaIsPaymentQuestion(t)) {
    return { why: 'Payment question', text: `Hi ${first}, nothing is charged before pick-up. You pay at the branch when you collect the vehicle${b ? ` (booking ${b.ref})` : ''}: the rental total plus the ${annaMoney(404)} bond, which is refunded after the return. We take credit or debit cards in the main driver's name only — we don't accept cash or bank transfer.${sign}` };
  }
  if (annaIsOneWayQuestion(t)) {
    return { why: 'One-way question', text: `Hi ${first}, unfortunately we don't do one-way hires between Sydney and Brisbane, so the vehicle needs to be returned to a branch in the same city it was picked up from. Within the same city you can return it to any of our branches.${sign}` };
  }
  if (/\b(pets?|dogs?|cats?|puppy|animals?)\b/.test(t)) {
    return { why: 'Pets question', text: `Hi ${first}, unfortunately pets and animals are not allowed in our vehicles. If a vehicle is returned with signs of an animal, a ${annaMoney(330)} fee applies, the same as our cleaning fee. Let me know if you have any other questions.${sign}` };
  }
  if (/(smok|cigar|vape|clean|dirty)/.test(t)) {
    return { why: 'Smoking / cleaning fee', text: `Hi ${first}, smoking and vaping are not allowed in our vehicles. A ${annaMoney(330)} smoking fee applies if the vehicle is smoked in, and a ${annaMoney(330)} cleaning fee applies if it comes back needing extra cleaning. Both are taken from the bond first.${sign}` };
  }

  if (/(cancel)/.test(t)) {
    return { why: 'Customer wants to cancel', text: b
      ? `Hi ${first}, no problem. I can cancel booking ${b.ref} (${b.cat ? b.cat.model : 'vehicle'}, ${when}) for you. Can you confirm you'd like to go ahead? If it's a change of plans, I can also move it to another date instead.${sign}`
      : `Hi ${first}, I can help with that. Could you send me your booking reference so I can find it?${sign}` };
  }
  if (/(early|earlier|later|change|move|reschedul|time|pick ?up|collect)/.test(t)) {
    // Retirada já perdida (reserva vencida): reconhece e propõe a nova data
    if (b && b.type === 'reservation' && b.start < fleetStartOfToday()) {
      const wantsTomorrow = /tomorrow/.test(t);
      return { why: 'Missed pick-up · rebook', text: `Hi ${first}, no problem at all. Your ${b.cat ? b.cat.model : 'vehicle'} booking ${b.ref} was for ${when} at our ${where} branch, so I'll move it for you. ` +
        `${wantsTomorrow ? 'Tomorrow works — ' : ''}what time would you like to collect it? We're open 08:00 to 17:15, and I'll confirm the vehicle as soon as you reply.${sign}` };
    }
    return { why: 'Pick-up time change', text: b
      ? `Hi ${first}, thanks for letting us know. Your ${b.cat ? b.cat.model : 'vehicle'} (${b.ref}) is booked for pick-up on ${when} at our ${where} branch. We can change it to any time between 08:00 and 17:15. What time suits you? I'll check the vehicle and confirm straight away.${sign}`
      : `Hi ${first}, we can change pick-up times between 08:00 and 17:15. Could you send me your booking reference and the time you'd prefer?${sign}` };
  }
  if (/(extend|longer|keep|late return|return later|extra day)/.test(t)) {
    const free = b && b.plate ? fleetIsPlateFree(b.plate, b.end, b.end + FLEET_DAY_MS, b.id) : null;
    return { why: 'Extension request', text: b
      ? `Hi ${first}, your ${b.cat ? b.cat.model : 'vehicle'} is due back on ${annaDate(b.end)} at ${annaTime(b.end)}. ` +
        (free ? `Good news, the vehicle is free for an extra day, so I can extend it at ${annaMoney(b.cat ? b.cat.rate : 0)} per day. How many extra days would you like? No need to come in: once you confirm, I'll charge the extra days to your card on file and send you the new return time.` : `The vehicle has another booking straight after, so let me check what we can offer and come back to you shortly.`) + sign
      : `Hi ${first}, happy to look at an extension. What's your booking reference and the new return date?${sign}` };
  }
  if (/(excess|insurance|damage|accident|scratch)/.test(t)) {
    const c = b && b.cat;
    return { why: 'Excess / damage question', text: c
      ? `Hi ${first}, for the ${c.model} the standard excess is ${annaMoney(c.excess.standard)}. With excess reduction (${annaMoney(c.excess.reducedPerDay)}/day) it goes down to ${annaMoney(c.excess.reduced)}. Would you like me to add it to booking ${b.ref}?${sign}`
      : `Hi ${first}, the excess depends on the vehicle. If you send me your booking reference I'll give you the exact amount and the excess reduction option.${sign}` };
  }
  if (/(bond|deposit|refund|money back)/.test(t)) {
    return { why: 'Bond question', text: `Hi ${first}, the bond is ${annaMoney(404)}, charged at pick-up to a Visa/Mastercard credit or debit card in the driver's name. After the vehicle is returned, ${annaMoney(400)} is refunded to the same card, which usually takes 5–7 working days depending on your bank.${sign}` };
  }
  if (/(where|address|location|branch|directions)/.test(t)) {
    return { why: 'Branch / location', text: b
      ? `Hi ${first}, your pick-up is at our ${where} branch (${FLEET_BRANCHES[b.branch] || ''}) on ${when}. We're open 08:00–17:15. Please bring your driver's licence and a credit or debit card in your name: payment and the bond are taken at pick-up (we don't accept cash or bank transfer).${sign}`
      : `Hi ${first}, we have branches in Sydney (Parramatta, Mascot, Blacktown, North Sydney) and Brisbane (Eagle Farm, Woolloongabba). Which one is closest to you?${sign}` };
  }
  return { why: 'General reply', text: b
    ? `Hi ${first}, thanks for your message about booking ${b.ref} (${b.cat ? b.cat.model : 'vehicle'}, pick-up ${when} at ${where}). How can I help?${sign}`
    : `Hi ${first}, thanks for getting in touch with GC Tech. How can I help you today?${sign}` };
}

// Chamado pelo gc-chat.js a cada atualização (só na janela do agente)
let annaLastSuggestedFor = null;
function annaOnChatRefresh(session, messages, role) {
  if (role !== 'agent') return;
  const inputBar = document.getElementById('chat-input-bar');
  if (!inputBar) return;
  let bar = document.getElementById('anna-chat-bar');
  const lastCustomer = (messages || []).filter(m => m.sender === 'customer').slice(-1)[0];
  const lastMsg = (messages || []).slice(-1)[0];
  // Só sugere quando a última mensagem é do cliente (ainda sem resposta)
  // Chat de outro agente (js/gc-chat.js): só leitura, sem sugestão
  const lockedByOther = session && typeof chatLockedByOther === 'function' && chatLockedByOther(session.sessionId);
  if (!lastCustomer || !lastMsg || lastMsg.sender !== 'customer' || (session && session.status === 'closed') || lockedByOther) {
    if (bar) bar.remove();
    annaLastSuggestedFor = null;
    return;
  }
  if (bar && annaLastSuggestedFor === lastCustomer.id) return;
  annaLastSuggestedFor = lastCustomer.id;
  const s = annaSuggestReply(session, lastCustomer.text);
  annaInjectStyles();
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'anna-chat-bar';
    inputBar.parentNode.insertBefore(bar, inputBar);
  }
  bar.className = 'anna-chat-bar';
  bar.innerHTML = `
    <div class="anna-chat-head"><span class="anna-mark">✦ Anna suggests</span><span class="anna-why">${annaEsc(s.why)}</span><span class="anna-concept-pill" title="${annaEsc(ANNA_CONCEPT)}">Concept</span></div>
    <div class="anna-chat-text">${annaEsc(s.text).replace(/\n/g, '<br>')}</div>
    <div class="anna-chat-actions">
      <button type="button" class="anna-btn primary" id="anna-use">Use reply</button>
      <button type="button" class="anna-btn ghost" id="anna-dismiss">Dismiss</button>
    </div>`;
  bar.querySelector('#anna-use').onclick = () => {
    const input = document.getElementById('chat-input');
    if (input) { input.value = s.text.replace(/\n+/g, ' '); input.focus(); }
    bar.remove();
  };
  bar.querySelector('#anna-dismiss').onclick = () => bar.remove();
}

// ---------- Ask Anna (botão flutuante no Agent Dashboard) ----------
const ANNA_EXAMPLES = ['Excess for a Pantech?', 'Any Hiace 1T Van free tomorrow?', 'How does the bond work?', 'Smoking fee?', 'Are pets allowed?', 'Can I pay cash?', 'Daily rate for a Kluger, 5 days'];

function annaInitAsk() {
  if (document.getElementById('anna-fab')) return;
  annaInjectStyles();
  const fab = document.createElement('button');
  fab.id = 'anna-fab';
  fab.type = 'button';
  fab.className = 'anna-fab';
  fab.innerHTML = '✦ Ask Anna <span>concept</span>';
  fab.onclick = annaToggleAsk;
  document.body.appendChild(fab);

  const panel = document.createElement('aside');
  panel.id = 'anna-panel';
  panel.className = 'anna-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="anna-panel-head">
      <div><strong>✦ Anna</strong><span>GC Tech assistant · inside the RCM</span></div>
      <button type="button" class="anna-x" onclick="annaToggleAsk()">✕</button>
    </div>
    <div class="anna-concept">${annaEsc(ANNA_CONCEPT)}. Answers come from the prototype's own fleet, rates, fees and bookings.</div>
    <div class="anna-thread" id="anna-thread">
      <div class="anna-msg anna">Hi ${annaEsc(annaAgentName().split(' ')[0])}! Ask me about a booking reference, availability, excess, rates, fees, bonds or opening hours.</div>
    </div>
    <div class="anna-examples">${ANNA_EXAMPLES.map(e => `<button type="button" onclick="annaAsk(this.textContent)">${annaEsc(e)}</button>`).join('')}</div>
    <form class="anna-form" onsubmit="event.preventDefault(); annaAsk(this.q.value); this.q.value='';">
      <input name="q" type="text" placeholder="Ask Anna… e.g. excess for a Kluger" autocomplete="off">
      <button type="submit" class="anna-btn primary">Ask</button>
    </form>`;
  document.body.appendChild(panel);
}

function annaToggleAsk() {
  const panel = document.getElementById('anna-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) panel.querySelector('input').focus();
}

function annaAsk(question) {
  const q = String(question || '').trim();
  if (!q) return;
  const thread = document.getElementById('anna-thread');
  const a = annaAnswer(q);
  thread.insertAdjacentHTML('beforeend', `
    <div class="anna-msg me">${annaEsc(q)}</div>
    <div class="anna-msg anna">${a.html}<div class="anna-source">Source: ${annaEsc(a.source)}</div></div>`);
  thread.scrollTop = thread.scrollHeight;
}

// ---------- Modal genérico ----------
function annaShowModal({ title, bodyHtml, source, actions }) {
  annaInjectStyles();
  const overlay = document.createElement('div');
  overlay.className = 'anna-overlay';
  overlay.innerHTML = `
    <div class="anna-modal" role="dialog" aria-modal="true">
      <div class="anna-modal-head">
        <div><span class="anna-mark">✦ Anna</span><h3>${annaEsc(title)}</h3></div>
        <button type="button" class="anna-x" data-anna="close">✕</button>
      </div>
      <div class="anna-concept">${annaEsc(ANNA_CONCEPT)}</div>
      <div class="anna-modal-body">${bodyHtml}${source ? `<div class="anna-source">Based on: ${annaEsc(source)}</div>` : ''}</div>
      <div class="anna-modal-foot"></div>
    </div>`;
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const foot = overlay.querySelector('.anna-modal-foot');
  (actions || []).forEach(a => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `anna-btn ${a.kind || 'ghost'}`;
    btn.textContent = a.label;
    btn.onclick = () => a.run(close);
    foot.appendChild(btn);
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'anna-btn ghost';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = close;
  foot.appendChild(closeBtn);
  overlay.addEventListener('click', e => { if (e.target === overlay || (e.target.dataset && e.target.dataset.anna === 'close')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
}

function annaCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); if (typeof gcToast === 'function') gcToast('Copied to the clipboard.'); } catch (e) {}
  ta.remove();
}

// ---------- Estilo ----------
function annaInjectStyles() {
  if (document.getElementById('anna-styles')) return;
  const s = document.createElement('style');
  s.id = 'anna-styles';
  s.textContent = `
    .anna-mark { color: #c4b5fd; font-weight: 700; font-size: 12px; letter-spacing: .3px; }
    .anna-muted { color: #94a3b8; font-size: 12px; }
    .anna-sub { color: #94a3b8; font-size: 12px; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: .4px; font-weight: 600; }
    .anna-source { margin-top: 8px; font-size: 11px; color: #a78bfa; }
    .anna-concept { background: rgba(139, 92, 246, .1); border-bottom: 1px solid rgba(139, 92, 246, .35); color: #ddd6fe; font-size: 11px; padding: 7px 16px; }
    .anna-concept-pill { margin-left: auto; background: rgba(139, 92, 246, .18); color: #ddd6fe; border: 1px solid rgba(139, 92, 246, .5); border-radius: 999px; padding: 1px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .anna-btn { border-radius: 6px; padding: 7px 13px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
    .anna-btn.primary { background: #7c3aed; color: #fff; }
    .anna-btn.primary:hover { background: #6d28d9; }
    .anna-btn.ghost { background: transparent; color: #e2e8f0; border-color: #475569; }
    .anna-btn.ghost:hover { background: rgba(255,255,255,.06); }
    .anna-x { background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; }
    .anna-flag { color: #fca5a5; }

    .anna-fab { position: fixed; right: 22px; bottom: 22px; z-index: 900; display: inline-flex; align-items: center; gap: 8px; background: #7c3aed; color: #fff; border: none; border-radius: 999px; padding: 11px 18px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 30px rgba(124, 58, 237, .45); font-family: inherit; }
    .anna-fab span { background: rgba(255,255,255,.18); border-radius: 999px; padding: 1px 7px; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
    .anna-fab:hover { background: #6d28d9; }
    .anna-panel { position: fixed; right: 22px; bottom: 76px; z-index: 901; width: 400px; max-width: calc(calc(100vw / var(--fit-zoom, 1)) - 32px); height: 560px; max-height: calc(calc(100vh / var(--fit-zoom, 1)) - 110px); display: flex; flex-direction: column; background: #0f172a; border: 1px solid #4c1d95; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.55); overflow: hidden; color: #e2e8f0; font-family: inherit; }
    .anna-panel[hidden] { display: none; }
    .anna-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #1e1b4b; }
    .anna-panel-head strong { display: block; color: #fff; font-size: 15px; }
    .anna-panel-head span { font-size: 11px; color: #c4b5fd; }
    .anna-thread { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; line-height: 1.5; }
    .anna-msg { max-width: 92%; padding: 9px 12px; border-radius: 10px; }
    .anna-msg.anna { background: #1e293b; border: 1px solid #334155; align-self: flex-start; }
    .anna-msg.me { background: #7c3aed; color: #fff; align-self: flex-end; }
    .anna-msg ul { margin: 6px 0 0 18px; padding: 0; }
    .anna-examples { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 14px; border-top: 1px solid #1e293b; }
    .anna-examples button { background: #1e293b; color: #c4b5fd; border: 1px solid #4c1d95; border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-family: inherit; }
    .anna-examples button:hover { background: #2e1065; }
    .anna-form { display: flex; gap: 8px; padding: 10px 14px 14px; }
    .anna-form input { flex: 1; min-width: 0; background: #1e293b; color: #fff; border: 1px solid #475569; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; }
    .anna-form input:focus { border-color: #8b5cf6; }

    .anna-overlay { position: fixed; inset: 0; z-index: 100003; background: rgba(2, 6, 23, .7); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .anna-modal { width: 100%; max-width: 620px; max-height: calc(90vh / var(--fit-zoom, 1)); display: flex; flex-direction: column; background: #0f172a; color: #e2e8f0; border: 1px solid #4c1d95; border-radius: 12px; box-shadow: 0 25px 60px rgba(0,0,0,.55); overflow: hidden; font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .anna-modal-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 18px; background: #1e1b4b; }
    .anna-modal-head h3 { margin: 3px 0 0; font-size: 16px; color: #fff; }
    .anna-modal-body { padding: 14px 18px; overflow-y: auto; font-size: 13px; line-height: 1.55; }
    .anna-modal-body ul { margin: 6px 0 0 18px; padding: 0; }
    .anna-modal-body p { margin: 0 0 6px; }
    .anna-draft { width: 100%; box-sizing: border-box; background: #1e293b; color: #f1f5f9; border: 1px solid #475569; border-radius: 6px; padding: 10px 12px; font: 13px/1.5 'Inter', -apple-system, 'Segoe UI', sans-serif; resize: vertical; }
    .anna-modal-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid #1e293b; }

    .anna-chat-bar { background: #1e1b4b; border-top: 1px solid #4c1d95; padding: 10px 12px; font-size: 12px; color: #e2e8f0; }
    .anna-chat-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .anna-why { color: #a5b4fc; font-size: 11px; }
    .anna-chat-text { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 8px 10px; line-height: 1.5; max-height: 130px; overflow-y: auto; }
    .anna-chat-actions { display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end; }
    .anna-link-btn { background: transparent; border: 1px solid rgba(139, 92, 246, .6); color: #c4b5fd; border-radius: 4px; padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .anna-link-btn:hover { background: rgba(139, 92, 246, .15); color: #fff; }
    .al-anna-btn { margin-top: 6px; padding: 3px 8px; font-size: 11px; white-space: nowrap; }
    .al-options-sent { color: #34d399 !important; }
    .anv-group { margin: 10px 0 4px; }
    .anv-group-title { font-size: 11px; font-weight: 700; color: #a5b4fc; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
    .anv-opt { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .anv-opt:hover { background: rgba(139, 92, 246, .1); }
    .anv-opt input { accent-color: #7c3aed; margin-top: 3px; }
    .anv-keep { margin-top: 6px; color: #fcd34d; }
    .anv-channel { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0 4px; font-size: 12px; color: #94a3b8; }
    .anv-channel button { background: transparent; border: 1px solid #475569; color: #e2e8f0; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .anv-channel button.on { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    .anv-channel button:disabled { opacity: .4; cursor: not-allowed; }
    #anv-text[readonly] { opacity: .85; }
  `;
  document.head.appendChild(s);
}

// Estilo disponível desde o carregamento (botões '✦' aparecem em avisos antes de abrir qualquer painel)
annaInjectStyles();
