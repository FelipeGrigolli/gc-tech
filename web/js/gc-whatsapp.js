// ==========================================
// WHATSAPP VIA 3CX — conversas com clientes ligadas às reservas
// ⚠️ SIMULADO: ainda não está conectado ao 3CX. As conversas de exemplo são geradas
// a partir das reservas de demonstração (relativas a hoje) e o que o agente envia
// fica gravado no navegador. As respostas dos clientes são simuladas.
//
// Regras do WhatsApp Business (Meta) respeitadas no desenho:
//  • Resposta livre só dentro de 24 h da última mensagem do cliente.
//  • Fora disso, só modelos de mensagem aprovados pela Meta (cobrados por mensagem).
// Na versão real: 3CX (WhatsApp no Team Inbox) + API do 3CX para ler/enviar a partir do RCM.
// Depende de: gc-fleet-data.js, gc-ui.js
// ==========================================

const WA_MSGS_KEY = 'gc_whatsapp_msgs';   // { digits: [{ id, dir, text, at, by, template, bookingId, ref }] }
const WA_READ_KEY = 'gc_whatsapp_read';   // { digits: lidoAté(ms) }
const WA_WINDOW_MS = 24 * 3600000;

// Modelos aprovados (categoria "Utility" na Meta)
const WA_TEMPLATES = {
  pickup_reminder: {
    name: 'Pick-up reminder',
    body: v => `Hi ${v.name}, this is GC Tech Rentals. A reminder that your ${v.vehicle} is booked for pick-up ${v.when} at ${v.time}, at our ${v.branch} branch. Please bring your driver's licence and a credit or debit card in your name: payment and the bond are taken at pick-up (no cash or bank transfer). Reply to this message if anything changes. Ref ${v.ref}.`,
    reply: v => `Confirmed, thanks! See you ${v.whenShort} 👍`
  },
  return_reminder: {
    name: 'Return reminder',
    body: v => `Hi ${v.name}, a reminder from GC Tech Rentals: your ${v.vehicle} is due back at our ${v.branch} branch on ${v.date} at ${v.endTime}. Need more time? Reply EXTEND and we'll check availability. Ref ${v.ref}.`,
    reply: () => 'EXTEND - could I keep it one more day?'
  },
  missed_call: {
    name: 'Missed call follow-up',
    body: v => `Hi${v.name ? ' ' + v.name : ''}, we missed your call to GC Tech Rentals at ${v.callTime}. Sorry about that! How can we help? Just reply here, or we'll call you back shortly.`,
    reply: () => 'Hi, I was calling to ask if you have a van available this Saturday for the day?'
  },
  no_show: {
    name: 'Missed pick-up',
    body: v => `Hi ${v.name}, your GC Tech booking ${v.ref} for a ${v.vehicle} was due for pick-up on ${v.date} at our ${v.branch} branch. Would you like to move it to another day or cancel it? Just reply to this message.`,
    reply: () => 'Sorry, something came up. Can I move it to tomorrow morning?'
  },
  vehicle_offer: {
    name: 'Alternative vehicle offer',
    body: v => `Hi ${v.name}, the ${v.requested || v.vehicle} you booked (${v.ref}) isn't available for your dates. We can offer a ${v.offer || 'similar vehicle'} instead, with no extra cost. You can accept it in My Bookings on our website, or reply here.`,
    reply: () => "That works for me, I'll accept it now. Thanks!"
  },
  // Payment Plans → lembrete de parcela (antes do débito) e de parcela atrasada
  payment_plan_reminder: {
    name: 'Payment plan reminder',
    body: v => `Hi ${v.name}, a reminder from GC Tech Rentals: your payment plan instalment of ${v.amount || 'the next amount'} for booking ${v.ref} is due on ${v.due || 'the due date'}. No need to come in: reply PAY here, or call us, and our team will take it on your credit or debit card.`,
    reply: () => 'PAY - please charge my card on file, thanks!'
  },
  payment_plan_overdue: {
    name: 'Payment plan overdue',
    body: v => `Hi ${v.name}, this is GC Tech Rentals. Your payment plan instalment of ${v.amount || 'this week'} for booking ${v.ref} is overdue. Remaining balance: ${v.balance || 'see your plan'}. Reply PAY here, or call us, and our team will take it on your credit or debit card right away.`,
    reply: () => "Sorry about that! PAY - you can charge my card now."
  },
  // Agent Requests → "✦ Message options" (opções escolhidas pelo agente entram na variável {{options}})
  vehicle_options: {
    name: 'Vehicle unavailable · options',
    body: v => `Hi ${v.name}, about your GC Tech booking ${v.ref}: the ${v.requested || v.vehicle} isn't available for your dates. Here is what we can offer: ${v.options || 'a similar vehicle, or the same vehicle on other dates'}. Reply with the option you prefer and we'll confirm it. You haven't been charged.`,
    reply: () => 'Option 1 works for me, thanks!'
  }
};

// ---------- Helpers ----------
function waEsc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function waPad(n) { return String(n).padStart(2, '0'); }
function waDigits(s) { return String(s || '').replace(/\D/g, ''); }
function waTime(ms) { const d = new Date(ms); return `${waPad(d.getHours())}:${waPad(d.getMinutes())}`; }
function waDayLabel(ms) {
  const d0 = new Date(ms); d0.setHours(0, 0, 0, 0);
  const diff = Math.round((fleetStartOfToday() - d0.getTime()) / FLEET_DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d0.getDay()]} ${d0.getDate()} ${FLEET_MONTHS[d0.getMonth()]}`;
}
function waWhen(ms) { return `${waDayLabel(ms)} ${waTime(ms)}`; }
function waAgent() {
  try { return localStorage.getItem('gc_agent_name') || 'Agent'; } catch (e) { return 'Agent'; }
}
function waReadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
}

// Mesmo celular de exemplo do Daily Activity / 3CX (por referência da reserva)
function waDemoMobile(ref) {
  const h = fleetHash('mobile:' + ref);
  return `04${waPad(h % 100)} ${String(100 + (h >>> 7) % 900)} ${String(100 + (h >>> 17) % 900)}`;
}

// ---------- Reservas e contatos ----------
// Reserva por id → { id, ref, fname, lname, phone, start, end, plate, branch, model, type }
function waFindBooking(id) {
  id = String(id || '');
  if (!id) return null;
  const stored = fleetFindStoredBooking(id);
  if (stored) {
    const b = stored.b, r = fleetBookingRange(b);
    const cat = fleetFindCategoryByModel(b.vehicle);
    return { id, ref: b.ref || ('OR-' + id.slice(-6)), fname: b.fname || '', lname: b.lname || '', email: stored.email,
      phone: b.phone || waDemoMobile(b.ref || id), start: r.start, end: r.end, plate: b.plate || '',
      branch: fleetLogBranchCode(b.loc) || 'MAS', model: cat ? cat.model : (b.vehicle || 'vehicle'),
      requested: b.vehicle, type: b.plannerType || 'reservation', status: b.status };
  }
  if (id.startsWith('main-')) {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(FLEET_MAIN_PREFIX + id.slice(5)) || '{}'); } catch (e) {}
    const r = fleetMainBookingRange(state);
    return { id, ref: 'GC-8832', fname: 'Felipe', lname: 'Grigolli', email: id.slice(5), phone: '0412 345 678',
      start: r.start, end: r.end, plate: FLEET_MAIN_BOOKING_PLATE, branch: 'MAS', model: 'Auto Pantech Truck', type: fleetMainBookingType(state) };
  }
  return waFromSeed(fleetSeedBookings().find(x => x.id === id));
}

function waFromSeed(s) {
  if (!s || s.type === 'maintenance') return null;
  const id = s.id;
  const v = fleetGetVehicle(s.plate);
  return { id, ref: s.ref, fname: s.fname, lname: s.lname, email: s.clientEmail, phone: waDemoMobile(s.ref),
    start: s.startMs, end: s.endMs, plate: s.plate, branch: v ? v.branch : 'MAS', model: v ? v.model : 'vehicle', type: s.type };
}

// Telefone → cliente (prefere a reserva atual ou a próxima)
let waContactCache = null;
function waContacts() {
  const key = Math.floor(Date.now() / 5000);
  if (waContactCache && waContactCache.key === key) return waContactCache.map;
  const now = Date.now();
  const map = new Map();
  const add = c => {
    const k = waDigits(c.phone);
    if (k.length < 8) return;
    const cur = map.get(k);
    const score = x => (x.end > now ? 0 : 1) * 1e13 + Math.abs(x.start - now);
    if (!cur || score(c) < score(cur)) map.set(k, c);
  };
  fleetSeedBookings().forEach(s => { const b = waFromSeed(s); if (b) add(b); });
  fleetForEachStoredBooking(list => list.forEach(b => {
    if (b.status === 'cancelled') return;
    const f = waFindBooking(String(b.id)); if (f) add(f);
  }));
  waContactCache = { key, map };
  return map;
}

function waContactFor(phone) {
  return waContacts().get(waDigits(phone)) || null;
}

// ---------- Variáveis dos modelos a partir de uma reserva ----------
function waVarsFor(bk, extra) {
  const d = new Date(bk.start);
  const tomorrow = fleetStartOfToday() + FLEET_DAY_MS;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const when = sameDay(bk.start, tomorrow) ? 'tomorrow' : sameDay(bk.start, Date.now()) ? 'today' : `on ${waDayLabel(bk.start)}`;
  return Object.assign({
    name: bk.fname || '', ref: bk.ref, vehicle: bk.model,
    when, whenShort: when.replace(/^on /, ''), time: waTime(bk.start), endTime: waTime(bk.end),
    date: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${FLEET_MONTHS[d.getMonth()]}`,
    branch: (FLEET_BRANCHES[bk.branch] || '').split(' - ')[1] || bk.branch
  }, extra || {});
}

// ---------- Conversas de exemplo (determinísticas, relativas a agora) ----------
let waSeedCache = null;
function waSeedThreads() {
  const key = Math.floor(Date.now() / 60000);
  if (waSeedCache && waSeedCache.key === key) return waSeedCache.threads;
  const now = Date.now();
  const today0 = fleetStartOfToday();
  const seeds = fleetSeedBookings().filter(s => s.type !== 'maintenance' && !s.keepReservation);
  const used = new Set();
  const pick = test => { const s = seeds.find(x => !used.has(x.id) && test(x)); if (s) used.add(s.id); return s; };
  const threads = [];
  const thread = (s, msgs) => {
    if (!s) return;
    const bk = waFindBooking(s.id);
    threads.push({ digits: waDigits(bk.phone), phone: bk.phone, bookingId: bk.id, ref: bk.ref,
      messages: msgs.map((m, i) => ({ id: `seed-${s.id}-${i}`, seed: true, bookingId: bk.id, ref: bk.ref, ...m })).filter(m => m.at <= now) });
  };
  const m = mins => now - mins * 60000;

  // 1) Retirada amanhã: quer adiantar o horário (aguardando resposta)
  const a = pick(x => x.type === 'reservation' && x.startMs >= today0 + FLEET_DAY_MS && x.startMs < today0 + 2 * FLEET_DAY_MS);
  if (a) thread(a, [
    { dir: 'out', template: 'pickup_reminder', by: 'Auto reminder', at: m(26 * 60), text: WA_TEMPLATES.pickup_reminder.body(waVarsFor(waFindBooking(a.id), { when: 'tomorrow' })) },
    { dir: 'in', at: m(38), text: `Hi, is it possible to pick up the car 30 minutes earlier, around ${waTime(a.startMs - 1800000)}?` }
  ]);

  // 2) Em locação: luz no painel (resolvido)
  const b = pick(x => x.type === 'hired' && x.endMs > now + FLEET_DAY_MS);
  if (b) thread(b, [
    { dir: 'in', at: m(170), text: 'Hi, the tyre pressure light just came on. Is it ok to keep driving?' },
    { dir: 'in', at: m(169), text: '📷 Photo', attachment: 'Dashboard warning light' },
    { dir: 'out', by: 'Felipe Grigolli', at: m(158), text: `Hi ${b.fname}, thanks for the photo. Please stop at the next service station and check the pressures (34 psi front and rear). If the light stays on, call us and we'll swap the vehicle.` },
    { dir: 'in', at: m(121), text: 'Done, light is off now. Thanks for the quick help! 👍', seen: true },
    { dir: 'out', by: 'Felipe Grigolli', at: m(118), text: 'Great, glad it is sorted. Enjoy the rest of your trip! 🙂' }
  ].map(x => ({ seen: true, ...x })));

  // 3) Devolução hoje/amanhã: pede extensão (aguardando resposta)
  const c = pick(x => x.type === 'hired' && x.endMs > now && x.endMs < today0 + 3 * FLEET_DAY_MS);
  if (c) thread(c, [
    { dir: 'in', at: m(14), text: `Hi there, can I keep the ${(waFindBooking(c.id) || {}).model || 'vehicle'} for 2 more days? Same card is fine for the payment.` }
  ]);

  // 4) Lembrete de ontem confirmado pelo cliente (retirada hoje)
  const d = pick(x => x.type === 'reservation' && x.startMs >= now && x.startMs < today0 + FLEET_DAY_MS);
  if (d) thread(d, [
    { dir: 'out', template: 'pickup_reminder', by: 'Auto reminder', at: m(Math.max(60, (now - today0) / 60000 + 8 * 60)), text: WA_TEMPLATES.pickup_reminder.body(waVarsFor(waFindBooking(d.id), { when: 'tomorrow', whenShort: 'tomorrow' })) },
    { dir: 'in', at: m(Math.max(50, (now - today0) / 60000 + 7.7 * 60)), text: 'Confirmed, see you tomorrow! Do you have a child seat available?' },
    { dir: 'out', by: 'Alex', at: m(Math.max(45, (now - today0) / 60000 + 7.5 * 60)), text: "Yes, we'll have a child seat fitted and ready for you. See you then!" }
  ].map(x => ({ seen: true, ...x })));

  // 5) Número desconhecido: chamada perdida há 3 dias, sem resposta (janela fechada)
  const unknown = { digits: '0438207114', phone: '0438 207 114', bookingId: '', ref: '', messages: [
    { id: 'seed-unknown-0', seed: true, dir: 'out', template: 'missed_call', by: 'Felipe Grigolli', at: m(3 * 24 * 60 + 200),
      text: WA_TEMPLATES.missed_call.body({ name: '', callTime: '10:42' }) }
  ] };
  threads.push(unknown);

  waSeedCache = { key, threads };
  return threads;
}

// ---------- Conversas (exemplo + gravadas) ----------
function waStored() { return waReadJSON(WA_MSGS_KEY, {}); }

function waThreads() {
  const now = Date.now();
  const stored = waStored();
  const byDigits = new Map();
  waSeedThreads().forEach(t => byDigits.set(t.digits, { ...t, messages: t.messages.slice() }));
  Object.keys(stored).forEach(dg => {
    const msgs = (stored[dg] || []).filter(x => x.at <= now);
    if (!msgs.length) return;
    const t = byDigits.get(dg) || { digits: dg, phone: msgs[0].phone || dg, bookingId: msgs[0].bookingId || '', ref: msgs[0].ref || '', messages: [] };
    t.messages = t.messages.concat(msgs);
    byDigits.set(dg, t);
  });
  const read = waReadJSON(WA_READ_KEY, {});
  return Array.from(byDigits.values()).map(t => {
    t.messages.sort((x, y) => x.at - y.at);
    const contact = waContactFor(t.phone);
    // Resposta automática não conta como atendimento: a conversa continua "aguardando"
    const real = t.messages.filter(x => x.by !== 'Auto-reply');
    const lastMsg = real[real.length - 1] || t.messages[t.messages.length - 1];
    const lastIn = t.messages.filter(x => x.dir === 'in').pop();
    const fromMsg = [...t.messages].reverse().find(x => x.bookingId);
    const bookingId = (fromMsg && fromMsg.bookingId) || t.bookingId || (contact ? contact.id : '');
    const bk = bookingId ? waFindBooking(bookingId) : contact;
    return {
      ...t, bookingId, booking: bk, ref: bk ? bk.ref : t.ref,
      name: bk ? `${bk.fname} ${bk.lname}`.trim() : '',
      last: lastMsg, lastIn,
      windowOpen: !!lastIn && now - lastIn.at < WA_WINDOW_MS,
      windowEnds: lastIn ? lastIn.at + WA_WINDOW_MS : 0,
      waiting: !!lastMsg && lastMsg.dir === 'in',
      unread: t.messages.filter(x => x.dir === 'in' && !x.seen && x.at > (read[t.digits] || 0)).length
    };
  }).filter(t => t.last).sort((x, y) => y.last.at - x.last.at);
}

function waThread(phone) {
  const dg = waDigits(phone);
  return waThreads().find(t => t.digits === dg) || null;
}

function waUnreadTotal() {
  return waThreads().reduce((s, t) => s + t.unread, 0);
}

function waMarkRead(phone) {
  const read = waReadJSON(WA_READ_KEY, {});
  read[waDigits(phone)] = Date.now();
  localStorage.setItem(WA_READ_KEY, JSON.stringify(read));
}

// ---------- Quem está atendendo a conversa ----------
// Uma conversa fica com o agente que começou o atendimento (respondeu ou clicou em "Take conversation").
// Os outros veem quem está atendendo e só respondem com "Take over" (registrado no Activity Log).
// Sem resposta de agente por 12 h, a conversa volta a ficar livre.
const WA_ASSIGN_KEY = 'gc_whatsapp_assign';   // { digits: { agent, at } }  agent: null = liberada
const WA_ASSIGN_TTL = 12 * 3600000;
const WA_AUTO_SENDERS = ['Auto reminder', 'Auto-reply'];

function waAssignee(phone) {
  const dg = waDigits(phone);
  const stored = waReadJSON(WA_ASSIGN_KEY, {})[dg] || null;
  // Última resposta de um agente na conversa (inclui as de exemplo)
  let lastHuman = null;
  const msgs = waSeedThreads().filter(t => t.digits === dg).flatMap(t => t.messages).concat((waStored()[dg] || []));
  msgs.forEach(m => { if (m.dir === 'out' && m.by && !WA_AUTO_SENDERS.includes(m.by) && m.at <= Date.now() && (!lastHuman || m.at > lastHuman.at)) lastHuman = { agent: m.by, at: m.at }; });
  const pick = stored && (!lastHuman || stored.at >= lastHuman.at) ? stored : lastHuman;
  if (!pick || !pick.agent) return null;
  if (Date.now() - pick.at > WA_ASSIGN_TTL) return null;
  return pick;
}

function waIsMine(phone) {
  const a = waAssignee(phone);
  return !!a && a.agent === waAgent();
}

function waLockedByOther(phone) {
  const a = waAssignee(phone);
  return a && a.agent !== waAgent() ? a : null;
}

function waSetAssignee(phone, agent, action, detail) {
  const all = waReadJSON(WA_ASSIGN_KEY, {});
  all[waDigits(phone)] = { agent, at: Date.now() };
  localStorage.setItem(WA_ASSIGN_KEY, JSON.stringify(all));
  const t = waThread(phone);
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: (t && t.bookingId) || ('wa-' + waDigits(phone)), ref: (t && t.ref) || phone, operator: waAgent(), action: 'WhatsApp',
      details: detail || `WhatsApp conversation with ${phone} ${agent ? 'taken by ' + agent : 'released'}`, info: action || '' });
  }
  waAfterChange();
}

function waTakeConversation(phone) {
  waSetAssignee(phone, waAgent(), 'Assigned', `WhatsApp conversation with ${phone} taken by ${waAgent()}`);
  if (typeof gcToast === 'function') gcToast('This conversation is now yours. Other agents can see you are handling it.', 'success');
}

function waReleaseConversation(phone) {
  waSetAssignee(phone, null, 'Released', `WhatsApp conversation with ${phone} released by ${waAgent()}`);
  if (typeof gcToast === 'function') gcToast('Conversation released. Any agent can pick it up now.', 'info');
}

// Assumir a conversa de outro agente: pede confirmação e fica registrado
async function waTakeOver(phone) {
  const a = waLockedByOther(phone);
  if (!a) { waTakeConversation(phone); return true; }
  const ok = await gcConfirm({
    title: `Take over from ${a.agent}?`,
    message: `${a.agent} has been handling this conversation since ${waWhen(a.at)}. Only take over if they are away, so the customer doesn't get two answers.`,
    confirmText: 'Take over', kind: 'warning'
  });
  if (!ok) return false;
  waSetAssignee(phone, waAgent(), 'Taken over', `WhatsApp conversation with ${phone} taken over from ${a.agent} by ${waAgent()}`);
  if (typeof gcToast === 'function') gcToast(`You are now handling this conversation instead of ${a.agent}.`, 'success');
  return true;
}

// Selo de quem está atendendo
function waAssigneeChip(phone) {
  const a = waAssignee(phone);
  if (!a) return '<span class="wa-asg free">Unassigned</span>';
  return a.agent === waAgent() ? '<span class="wa-asg me">You</span>' : `<span class="wa-asg other">🔒 ${waEsc(a.agent)}</span>`;
}

// Estado de entrega da mensagem enviada: ✓ enviado · ✓✓ entregue · ✓✓ azul lido
function waTicks(t, msg) {
  if (msg.channel === 'email') return '<span class="wa-ticks" title="Sent by email">✉</span>';
  if (msg.failed) return '<span class="wa-ticks failed" title="Not delivered — this number is not on WhatsApp">! Not delivered</span>';
  const readByReply = t.messages.some(x => x.dir === 'in' && x.at > msg.at);
  const age = Date.now() - msg.at;
  if (readByReply || (age > 10 * 60000 && fleetHash(msg.id) % 3 !== 0)) return '<span class="wa-ticks read" title="Read">✓✓</span>';
  if (age > 3000) return '<span class="wa-ticks" title="Delivered">✓✓</span>';
  return '<span class="wa-ticks" title="Sent">✓</span>';
}

// ---------- Canal: preferência do cliente e se o número tem WhatsApp ----------
// ⚠️ SIMULADO: cerca de 1 em cada 7 números de exemplo "não tem WhatsApp". Na versão real
// isso vem do status de entrega que a Meta devolve pelo 3CX.
function waOnWhatsApp(phone, email) {
  const pref = email && typeof fleetContactPref === 'function' ? fleetContactPref(email) : null;
  if (pref && pref.whatsapp === false) return false;
  if (pref && pref.whatsapp === true) return true;
  const dg = waDigits(phone);
  if (dg === '0412345678') return true; // cliente de demonstração do portal
  const t = waThread(phone);
  if (t && t.messages.some(x => x.dir === 'in')) return true; // já escreveu pelo WhatsApp
  if (dg === waDemoNoWhatsAppDigits()) return false;
  return fleetHash('wa:' + dg) % 7 !== 0;
}

// Demonstração: entre as retiradas de amanhã há sempre um cliente sem WhatsApp,
// para os lembretes em lote mostrarem o envio por e-mail no lugar
let waDemoNoWaCache = null;
function waDemoNoWhatsAppDigits() {
  const day = fleetStartOfToday();
  if (waDemoNoWaCache && waDemoNoWaCache.day === day) return waDemoNoWaCache.dg;
  const t0 = day + FLEET_DAY_MS;
  const list = fleetSeedBookings()
    .filter(s => s.type === 'reservation' && s.startMs >= t0 && s.startMs < t0 + FLEET_DAY_MS && typeof fleetContactPref === 'function' && fleetContactPref(s.clientEmail).default && fleetContactPref(s.clientEmail).channel === 'whatsapp')
    .sort((a, b) => a.startMs - b.startMs);
  const pick = list[Math.min(2, list.length - 1)];
  waDemoNoWaCache = { day, dg: pick ? waDigits(waDemoMobile(pick.ref)) : '' };
  return waDemoNoWaCache.dg;
}

// Canal que será usado para avisos (modelos): 'whatsapp' | 'email' + motivo
function waChannelFor(bk, phone) {
  const email = bk && bk.email ? bk.email : '';
  const pref = email && typeof fleetContactPref === 'function' ? fleetContactPref(email) : { channel: 'whatsapp', whatsapp: null };
  if (pref.whatsapp === false) return { channel: email ? 'email' : 'none', reason: 'no-whatsapp', email, pref };
  if (pref.channel === 'email' && email) return { channel: 'email', reason: 'prefers-email', email, pref };
  return { channel: 'whatsapp', reason: '', email, pref };
}

// "Envia" por e-mail (simulado) e guarda no histórico da conversa como e-mail
function waSendEmail(bk, phone, text, tplName, by, silent) {
  const email = bk && bk.email;
  if (!email) return null;
  const now = Date.now();
  const dg = waDigits(phone);
  const msg = { id: 'em-' + now.toString(36) + Math.random().toString(36).slice(2, 5), dir: 'out', channel: 'email', text, at: now, by,
    template: tplName || '', phone, email, bookingId: bk.id || '', ref: bk.ref || '' };
  if (dg.length >= 8) { const all = waStored(); (all[dg] = all[dg] || []).push(msg); localStorage.setItem(WA_MSGS_KEY, JSON.stringify(all)); }
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: bk.id || ('wa-' + dg), ref: bk.ref || email, plate: bk.plate || '', operator: by, action: 'Email',
      details: `Email sent to ${email}${tplName && WA_TEMPLATES[tplName] ? ` (${WA_TEMPLATES[tplName].name})` : ''}`, info: 'Customer contact preference' });
  }
  if (!silent && typeof gcToast === 'function') gcToast(`Email sent to ${email}`, 'success');
  waAfterChange();
  return msg;
}

// ---------- Envio ----------
// opts: { phone, bookingId, ref, text, template, vars, by, silent, noReply, channel: 'auto' | 'whatsapp' | 'email' }
// Avisos (modelos) seguem a preferência do cliente. Número sem WhatsApp: "não entregue" e vai por e-mail.
function waSend(opts) {
  const dg = waDigits(opts.phone);
  if (dg.length < 8) return null;
  const bk = opts.bookingId ? waFindBooking(opts.bookingId) : waContactFor(opts.phone);
  const tpl = opts.template ? WA_TEMPLATES[opts.template] : null;
  const vars = tpl ? Object.assign(bk ? waVarsFor(bk) : { name: '' }, opts.vars || {}) : null;
  const text = tpl ? tpl.body(vars) : String(opts.text || '').trim();
  if (!text) return null;
  const by = opts.by || waAgent();
  const now = Date.now();
  const email = bk && bk.email ? bk.email : '';
  const route = opts.channel || 'auto';

  // Cliente prefere e-mail (ou o agente escolheu e-mail): nem tenta o WhatsApp
  if (tpl && (route === 'email' || (route === 'auto' && waChannelFor(bk, opts.phone).channel === 'email'))) {
    const em = waSendEmail(bk, opts.phone, text, opts.template, by, opts.silent);
    if (em) return em;
  }

  const msg = { id: 'wa-' + now.toString(36) + Math.random().toString(36).slice(2, 5), dir: 'out', text, at: now, by,
    template: opts.template || '', phone: opts.phone, bookingId: bk ? bk.id : (opts.bookingId || ''), ref: bk ? bk.ref : (opts.ref || ''), channel: 'whatsapp' };

  // Número sem WhatsApp: a mensagem volta como não entregue
  if (!waOnWhatsApp(opts.phone, email)) {
    msg.failed = true;
    const all = waStored();
    (all[dg] = all[dg] || []).push(msg);
    localStorage.setItem(WA_MSGS_KEY, JSON.stringify(all));
    if (email && typeof fleetSetContactPref === 'function') fleetSetContactPref(email, { whatsapp: false }, by, 'WhatsApp not delivered');
    if (typeof fleetLog === 'function') {
      fleetLog({ bookingId: msg.bookingId || ('wa-' + dg), ref: msg.ref || opts.phone, plate: bk ? bk.plate : '', operator: by, action: 'WhatsApp',
        details: `WhatsApp not delivered to ${opts.phone}: number is not on WhatsApp`, info: email ? 'Sent by email instead' : 'No email on file — call the customer' });
    }
    const fallback = email ? waSendEmail(bk, opts.phone, text, opts.template, by, true) : null;
    if (!opts.silent && typeof gcToast === 'function') {
      gcToast(fallback
        ? `WhatsApp not delivered — sent by email instead\n\n${opts.phone} is not on WhatsApp. The message went to ${email}, and this customer is now set to email.`
        : `WhatsApp not delivered\n\n${opts.phone} is not on WhatsApp and there is no email on file. Call the customer instead.`, 'warning', { duration: 7000 });
    }
    waAfterChange();
    return fallback ? { ...fallback, fellBack: true } : { ...msg, undelivered: true };
  }

  const all = waStored();
  (all[dg] = all[dg] || []).push(msg);

  // Resposta simulada do cliente para os modelos (aparece alguns segundos depois)
  if (tpl && tpl.reply && !opts.noReply) {
    all[dg].push({ id: msg.id + '-r', dir: 'in', text: tpl.reply(vars), at: now + 7000 + fleetHash(msg.id) % 6000,
      phone: opts.phone, bookingId: msg.bookingId, ref: msg.ref, simulated: true });
  }
  localStorage.setItem(WA_MSGS_KEY, JSON.stringify(all));
  waMarkRead(opts.phone);

  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: msg.bookingId || ('wa-' + dg), ref: msg.ref || opts.phone, plate: bk ? bk.plate : '', operator: by, action: 'WhatsApp',
      details: tpl ? `WhatsApp sent (template: ${tpl.name}) to ${opts.phone}` : `WhatsApp reply to ${opts.phone}: ${text.length > 90 ? text.slice(0, 90) + '…' : text}`,
      info: 'via 3CX' + (tpl ? ' · template, charged by Meta' : ' · free reply (24 h window)') });
  }
  if (!opts.silent && typeof gcToast === 'function') gcToast(`WhatsApp sent to ${bk ? bk.fname + ' ' + bk.lname : opts.phone}${tpl ? `\n\nTemplate: ${tpl.name}` : ''}`, 'success');
  waAfterChange();
  return msg;
}

// Mensagem do cliente chegando (portal → WhatsApp do cliente → caixa do 3CX).
// Como no 3CX, a primeira mensagem do dia recebe uma resposta automática de boas-vindas.
// opts: { phone, text, bookingId, ref, name }
function waReceive(opts) {
  const dg = waDigits(opts.phone);
  const text = String(opts.text || '').trim();
  if (dg.length < 8 || !text) return null;
  const now = Date.now();
  const bk = opts.bookingId ? waFindBooking(opts.bookingId) : waContactFor(opts.phone);
  const all = waStored();
  const list = all[dg] = all[dg] || [];
  const msg = { id: 'wa-in-' + now.toString(36) + Math.random().toString(36).slice(2, 5), dir: 'in', text, at: now,
    phone: opts.phone, bookingId: bk ? bk.id : (opts.bookingId || ''), ref: bk ? bk.ref : (opts.ref || ''), fromPortal: true };
  list.push(msg);
  const t = waThread(opts.phone);
  const recentOut = (t ? t.messages : []).concat(list).some(x => x.dir === 'out' && now - x.at < 12 * 3600000);
  if (!recentOut) {
    list.push({ id: msg.id + '-auto', dir: 'out', at: now + 2500, by: 'Auto-reply', phone: opts.phone, bookingId: msg.bookingId, ref: msg.ref,
      text: "Thanks for messaging GC Tech Rentals! 👋 An agent will reply shortly. Our branches are open 8:00–17:15, 7 days." });
  }
  localStorage.setItem(WA_MSGS_KEY, JSON.stringify(all));
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: msg.bookingId || ('wa-' + dg), ref: msg.ref || opts.phone, plate: bk ? bk.plate : '', operator: 'Customer (WhatsApp)', action: 'WhatsApp',
      details: `WhatsApp received from ${opts.phone}: ${text.length > 90 ? text.slice(0, 90) + '…' : text}`, info: 'via 3CX · started from the Customer Portal' });
  }
  waAfterChange();
  return msg;
}

// Telas abertas que mostram WhatsApp se atualizam sozinhas
const waListeners = [];
function waOnChange(fn) { waListeners.push(fn); }
function waAfterChange() { waListeners.forEach(fn => { try { fn(); } catch (e) {} }); }
// Respostas simuladas "chegam" com o tempo
setInterval(() => {
  const stored = waStored();
  const now = Date.now();
  // Portal do cliente: avisa a tela quando chega resposta da GC Tech (sem toast de agente)
  if (window.WA_CUSTOMER_MODE) {
    if (Object.values(stored).some(list => (list || []).some(x => x.dir === 'out' && x.at <= now && x.at > now - 3500))) waAfterChange();
    return;
  }
  const due = Object.values(stored).some(list => (list || []).some(x => x.dir === 'in' && x.at <= now && x.at > now - 3500));
  if (due) {
    waAfterChange();
    const t = waThreads().find(x => x.lastIn && x.lastIn.at <= now && x.lastIn.at > now - 3500);
    if (t && typeof gcToast === 'function') gcToast(`💬 New WhatsApp from ${t.name || t.phone}\n\n${t.lastIn.text}`, 'info', { duration: 5000 });
  }
}, 3000);

// ---------- Janela de envio (modelo ou resposta livre) ----------
// cfg: { phone, bookingId, template, vars, title, onSent }
function waCompose(cfg) {
  waInjectStyles();
  const bk = cfg.bookingId ? waFindBooking(cfg.bookingId) : waContactFor(cfg.phone);
  const phone = cfg.phone || (bk ? bk.phone : '');
  if (!phone) { gcToast('No mobile number on this booking.', 'warning'); return; }
  // Conversa com outro agente: só envia depois de assumir (Take over)
  if (!cfg.allowLocked && waLockedByOther(phone)) {
    waTakeOver(phone).then(ok => { if (ok) waCompose({ ...cfg, allowLocked: true }); });
    return;
  }
  const t = waThread(phone);
  const windowOpen = !!(t && t.windowOpen);
  const name = bk ? `${bk.fname} ${bk.lname}`.trim() : (t && t.name) || 'Unknown customer';
  let mode = cfg.template || !windowOpen ? 'template' : 'text';
  let tplKey = cfg.template || (bk && bk.start > Date.now() ? 'pickup_reminder' : 'missed_call');

  const overlay = document.createElement('div');
  overlay.className = 'wa-overlay';
  const recent = t ? t.messages.slice(-3) : [];
  const tplOptions = () => Object.keys(WA_TEMPLATES).map(k => `<option value="${k}" ${k === tplKey ? 'selected' : ''}>${waEsc(WA_TEMPLATES[k].name)}</option>`).join('');
  const preview = () => {
    const tpl = WA_TEMPLATES[tplKey];
    const vars = Object.assign(bk ? waVarsFor(bk) : { name: '' }, cfg.vars || {});
    return tpl.body(vars);
  };
  const route = waChannelFor(bk, phone);
  const render = () => {
    const viaEmail = mode === 'template' && route.channel === 'email';
    const altLabel = mode !== 'template' || !route.email ? '' : viaEmail ? (route.pref.whatsapp === false ? '' : 'Send WhatsApp anyway') : '✉ Send by email instead';
    overlay.innerHTML = `
      <div class="wa-dialog" role="dialog" aria-modal="true">
        <div class="wa-dhead">
          <div class="wa-dhead-icon">${waIcon(20)}</div>
          <div class="wa-dhead-main">
            <h3>${waEsc(cfg.title || 'Send WhatsApp')}</h3>
            <p>${waEsc(name)} · ${waEsc(phone)}${bk ? ` · Ref ${waEsc(bk.ref)}` : ''}</p>
          </div>
          <span class="wa-via">via 3CX</span>
          <button type="button" class="wa-x" data-wa="close">✕</button>
        </div>
        <div class="wa-dbody">
          ${route.email ? `<div class="wa-route">Customer contact: ${waPrefChip(route.email)} ${viaEmail ? `<span>This message will go by email to <strong>${waEsc(route.email)}</strong>.</span>` : ''}</div>` : ''}
          <div class="wa-window ${windowOpen ? 'open' : 'closed'}">
            ${windowOpen
              ? `<strong>Free reply available</strong> · the customer wrote in the last 24 h (until ${waWhen(t.windowEnds)}).`
              : `<strong>Template only</strong> · no message from the customer in the last 24 h, so WhatsApp only allows an approved template.`}
          </div>
          ${recent.length ? `<div class="wa-recent">${recent.map(x => `<div class="wa-recent-row ${x.dir}"><span>${x.dir === 'in' ? waEsc(name.split(' ')[0] || 'Customer') : waEsc(x.by || 'GC Tech')}</span>${waEsc(x.text.length > 110 ? x.text.slice(0, 110) + '…' : x.text)}<em>${waWhen(x.at)}</em></div>`).join('')}</div>` : ''}
          <div class="wa-modes">
            <button type="button" data-wa="mode-template" class="${mode === 'template' ? 'active' : ''}">Template</button>
            <button type="button" data-wa="mode-text" class="${mode === 'text' ? 'active' : ''}" ${windowOpen ? '' : 'disabled title="Only within 24 h of the customer\'s last message"'}>Free reply</button>
          </div>
          ${mode === 'template' ? `
            <label class="wa-field"><span>Approved template</span><select data-wa="tpl">${tplOptions()}</select></label>
            <div class="wa-preview"><div class="wa-bubble out">${waEsc(preview())}<span class="wa-meta">${waTime(Date.now())} ✓</span></div></div>
            <p class="wa-note">Template messages are approved by Meta and charged per message. The customer's reply opens a 24 h window for free replies.</p>`
          : `
            <label class="wa-field"><span>Message</span><textarea data-wa="text" rows="4" placeholder="Type a reply…"></textarea></label>`}
        </div>
        <div class="wa-dfoot">
          <button type="button" class="wa-btn ghost" data-wa="close">Cancel</button>
          ${altLabel ? `<button type="button" class="wa-btn ghost" data-wa="send-alt">${altLabel}</button>` : ''}
          <button type="button" class="wa-btn primary" data-wa="send">${viaEmail ? '✉ Send by email' : waIcon(14) + ' Send WhatsApp'}</button>
        </div>
      </div>`;
    const ta = overlay.querySelector('[data-wa="text"]');
    if (ta) ta.focus();
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('change', e => { if (e.target.dataset.wa === 'tpl') { tplKey = e.target.value; render(); } });
  overlay.addEventListener('click', e => {
    const act = e.target.closest('[data-wa]') && e.target.closest('[data-wa]').dataset.wa;
    if (e.target === overlay || act === 'close') return close();
    if (act === 'mode-template') { mode = 'template'; render(); }
    if (act === 'mode-text' && windowOpen) { mode = 'text'; render(); }
    if (act === 'send' || act === 'send-alt') {
      const text = mode === 'text' ? overlay.querySelector('[data-wa="text"]').value.trim() : '';
      if (mode === 'text' && !text) { gcToast('Please type a message.', 'warning'); return; }
      const viaEmail = mode === 'template' && route.channel === 'email';
      const channel = mode !== 'template' ? 'whatsapp' : (act === 'send') === viaEmail ? 'email' : 'whatsapp';
      // Quem envia passa a atender a conversa (se ninguém estava atendendo)
      if (!waAssignee(phone)) waSetAssignee(phone, waAgent(), 'Assigned', `WhatsApp conversation with ${phone} taken by ${waAgent()}`);
      const msg = waSend({ phone, bookingId: bk ? bk.id : '', template: mode === 'template' ? tplKey : '', text, vars: cfg.vars, channel });
      if (msg) { close(); if (cfg.onSent) cfg.onSent(msg); }
    }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  render();
}

// Selo da preferência de contato do cliente
function waPrefChip(email) {
  if (!email || typeof fleetContactPref !== 'function') return '';
  const p = fleetContactPref(email);
  if (p.whatsapp === false) return '<span class="wa-pref nowa">✉ Email · no WhatsApp</span>';
  return p.channel === 'email' ? '<span class="wa-pref email">✉ Prefers email</span>' : `<span class="wa-pref">${waIcon(11)} Prefers WhatsApp</span>`;
}

// Atalho por reserva (botões do Overview, Daily Activity e Planner)
function waComposeForBooking(bookingId, template, title) {
  const bk = waFindBooking(bookingId);
  if (!bk) { gcToast('Booking not found.', 'warning'); return; }
  waCompose({ bookingId, template, title });
}

// ---------- Lembretes de retirada (Daily Activity) ----------
// list: [{ id, ref, customer, phone, start, model, branch }]
function waReminderDialog(list, dayLabel) {
  waInjectStyles();
  const sentKeys = new Set();
  const stored = waStored();
  Object.values(stored).forEach(msgs => (msgs || []).forEach(x => { if (x.template === 'pickup_reminder' && x.bookingId) sentKeys.add(x.bookingId); }));
  const rows = list.map(r => {
    const bk = waFindBooking(r.id);
    return { ...r, sent: sentKeys.has(String(r.id)), hasPhone: waDigits(r.phone).length >= 8, route: waChannelFor(bk, r.phone), email: bk ? bk.email : '' };
  });
  const ready = rows.filter(r => r.hasPhone && !r.sent);
  const first = rows.find(r => r.hasPhone) || null;
  const sample = first ? WA_TEMPLATES.pickup_reminder.body(waVarsFor(waFindBooking(first.id) || { fname: '', start: first.start, end: first.start, model: first.model, branch: first.branch, ref: first.ref })) : '';

  const overlay = document.createElement('div');
  overlay.className = 'wa-overlay';
  overlay.innerHTML = `
    <div class="wa-dialog wide" role="dialog" aria-modal="true">
      <div class="wa-dhead">
        <div class="wa-dhead-icon">${waIcon(20)}</div>
        <div class="wa-dhead-main">
          <h3>Pick-up reminders · ${waEsc(dayLabel)}</h3>
          <p>${rows.length} pick-up${rows.length === 1 ? '' : 's'} still to go out · reminder sent by WhatsApp the day before</p>
        </div>
        <span class="wa-via">via 3CX</span>
        <button type="button" class="wa-x" data-wa="close">✕</button>
      </div>
      <div class="wa-dbody">
        ${rows.length ? `
        <div class="wa-rem-table"><table>
          <thead><tr><th><input type="checkbox" data-wa="all" ${ready.length ? 'checked' : 'disabled'}></th><th>Res #</th><th>Customer</th><th>Mobile</th><th>Pick-up</th><th>Vehicle</th><th>Sent by</th><th>Status</th></tr></thead>
          <tbody>${rows.map(r => `
            <tr class="${r.sent || !r.hasPhone ? 'muted' : ''}">
              <td><input type="checkbox" data-wa-id="${waEsc(r.id)}" ${r.hasPhone && !r.sent ? 'checked' : 'disabled'}></td>
              <td><strong>${waEsc(r.ref)}</strong></td><td>${waEsc(r.customer)}</td><td class="nw">${waEsc(r.phone || '—')}</td>
              <td class="nw">${waTime(r.start)} · ${waEsc(r.branch)}</td><td>${waEsc(r.model)}</td>
              <td class="nw">${r.email ? waPrefChip(r.email) : '<span class="wa-pref">WhatsApp</span>'}</td>
              <td>${r.sent ? '<span class="wa-tag ok">Already sent</span>' : r.hasPhone ? '<span class="wa-tag">Ready</span>' : '<span class="wa-tag warn">No mobile</span>'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="wa-preview-label">Message preview (approved template)</div>
        <div class="wa-preview"><div class="wa-bubble out">${waEsc(sample)}<span class="wa-meta">✓</span></div></div>
        <p class="wa-note">Each customer gets the reminder the way they chose: WhatsApp or email. If a number turns out not to be on WhatsApp, the reminder goes by email instead and the customer is switched to email. In production this runs automatically every afternoon.</p>`
        : '<p class="wa-empty">No pick-ups left for this day.</p>'}
      </div>
      <div class="wa-dfoot">
        <button type="button" class="wa-btn ghost" data-wa="close">Close</button>
        <button type="button" class="wa-btn primary" data-wa="send" ${ready.length ? '' : 'disabled'}>${waIcon(14)} <span data-wa-label>Send ${ready.length} reminder${ready.length === 1 ? '' : 's'}</span></button>
      </div>
    </div>`;
  const checked = () => Array.from(overlay.querySelectorAll('[data-wa-id]:checked')).map(x => x.dataset.waId);
  const refresh = () => {
    const n = checked().length;
    const label = overlay.querySelector('[data-wa-label]');
    if (label) label.textContent = `Send ${n} reminder${n === 1 ? '' : 's'}`;
    const btn = overlay.querySelector('[data-wa="send"]');
    if (btn) btn.disabled = !n;
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.addEventListener('change', e => {
    if (e.target.dataset.wa === 'all') overlay.querySelectorAll('[data-wa-id]:not(:disabled)').forEach(x => { x.checked = e.target.checked; });
    refresh();
  });
  overlay.addEventListener('click', e => {
    const act = e.target.closest('[data-wa]') && e.target.closest('[data-wa]').dataset.wa;
    if (e.target === overlay || act === 'close') return close();
    if (act === 'send') {
      const ids = checked();
      let wa = 0, em = 0, fell = 0, failed = 0;
      ids.forEach((id, i) => {
        const r = rows.find(x => String(x.id) === id);
        // Só alguns clientes respondem (como na vida real)
        const res = r ? waSend({ phone: r.phone, bookingId: id, template: 'pickup_reminder', silent: true, noReply: i % 3 === 2 }) : null;
        if (!res) return;
        if (res.fellBack) fell++;
        else if (res.undelivered) failed++;
        else if (res.channel === 'email') em++;
        else wa++;
      });
      close();
      const parts = [`${wa} by WhatsApp`, `${em} by email (customer's choice)`];
      if (fell) parts.push(`${fell} not on WhatsApp — sent by email instead`);
      if (failed) parts.push(`${failed} not delivered — no email on file`);
      gcToast(`${wa + em + fell} pick-up reminder${wa + em + fell === 1 ? '' : 's'} sent\n\n${parts.join(' · ')}.`, fell || failed ? 'warning' : 'success', { duration: 7000 });
    }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
}

// ---------- Painel na aba Chat do booking (Fleet Planner) ----------
// Popup da reserva → conversa do cliente no inbox do WhatsApp (dashboard). Responde-se lá, não no popup.
function waOpenInInbox(phone, bookingId) {
  const digits = waDigits(phone);
  if (document.getElementById('module-whatsapp') && typeof switchModule === 'function') { waOpenConversation(digits, bookingId); return; }
  window.open(`agent-dashboard.html#whatsapp:${digits}:${encodeURIComponent(bookingId || '')}`, 'gc-whatsapp-inbox');
}

// Abre o módulo WhatsApp na conversa (sem conversa ainda: abre a mensagem nova para a reserva)
function waOpenConversation(digits, bookingId) {
  const link = document.querySelector(`.menu-item[onclick*="'module-whatsapp'"]`);
  if (!link || link.hidden) return false;
  switchModule('module-whatsapp', link, 'WhatsApp · via 3CX');
  const t = waThreads().find(x => x.digits === digits);
  if (t) waOpenThread(digits);
  else if (bookingId) {
    const bk = waFindBooking(bookingId);
    waComposeForBooking(bookingId, bk && bk.start > Date.now() ? 'pickup_reminder' : 'return_reminder');
  }
  return true;
}

function waRenderBookingPanel(containerId, bookingId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  waInjectStyles();
  const bk = waFindBooking(bookingId);
  if (!bk) { box.innerHTML = ''; box.dataset.booking = ''; return; }
  box.dataset.booking = bookingId;
  const t = waThread(bk.phone);
  const msgs = t ? t.messages.slice(-8) : [];
  if (t && t.unread) waMarkRead(bk.phone);
  box.innerHTML = `
    <div class="wa-panel">
      <div class="wa-panel-head">
        <div class="wa-panel-title">${waIcon(16)} WhatsApp <span class="wa-via">via 3CX</span></div>
        ${bk.email ? waPrefChip(bk.email) : ''}
        ${t ? waAssigneeChip(bk.phone) : ''}
        <span class="wa-panel-sub">${waEsc(bk.phone)} · ${t ? (t.windowOpen ? `<span class="wa-open">reply window open until ${waWhen(t.windowEnds)}</span>` : 'template only (no reply in 24 h)') : 'no messages yet'}</span>
        <button type="button" class="wa-btn primary small" title="Reply in the WhatsApp inbox (3CX), in this customer's conversation" onclick="waOpenInInbox('${waEsc(bk.phone)}', '${waEsc(bk.id)}')">${waIcon(13)} Open chat in WhatsApp ↗</button>
      </div>
      <div class="wa-thread compact">
        ${msgs.length ? waBubblesHtml(t, msgs, bk.fname) : '<p class="wa-empty">No messages with this customer yet.</p>'}
      </div>
    </div>`;
  const th = box.querySelector('.wa-thread');
  th.scrollTop = th.scrollHeight;
}
waOnChange(() => {
  const box = document.getElementById('mod-wa-panel');
  if (box && box.dataset.booking) waRenderBookingPanel('mod-wa-panel', box.dataset.booking);
});

function waBubblesHtml(t, msgs, firstName) {
  let lastDay = '';
  return msgs.map(x => {
    const day = waDayLabel(x.at);
    const sep = day !== lastDay ? `<div class="wa-day">${waEsc(day)}</div>` : '';
    lastDay = day;
    const who = x.dir === 'out' ? `<span class="wa-who">${x.channel === 'email' ? `✉ Email to ${waEsc(x.email || '')} · ` : ''}${waEsc(x.by || 'GC Tech')}${x.template ? ` · ${waEsc((WA_TEMPLATES[x.template] || {}).name || 'Template')}` : ''}</span>` : '';
    const att = x.attachment ? `<span class="wa-att">🖼 ${waEsc(x.attachment)}</span>` : '';
    return `${sep}<div class="wa-bubble ${x.dir}${x.template ? ' tpl' : ''}${x.channel === 'email' ? ' email' : ''}${x.failed ? ' failed' : ''}">${who}${att}${x.attachment ? '' : waEsc(x.text)}<span class="wa-meta">${waTime(x.at)}${x.dir === 'out' ? ' ' + waTicks(t, x) : ''}</span></div>`;
  }).join('');
}

// ---------- Caixa de conversas (Agent Dashboard → WhatsApp) ----------
let waActive = null;
let waFilter = 'all';
let waSearch = '';
let waTimer = null;

function renderWhatsAppModule() {
  const root = document.getElementById('module-whatsapp');
  if (!root) return;
  waInjectStyles();
  if (!root.dataset.ready) {
    root.innerHTML = `
      <div class="wa-head">
        <div>
          <h2>${waIcon(22)} WhatsApp <span class="wa-via big">via 3CX</span></h2>
          <p>Customer conversations from the company WhatsApp, linked to each booking.</p>
        </div>
        <div class="wa-head-actions">
          <button type="button" class="wa-btn ghost" onclick="waNewMessage()">＋ New message</button>
        </div>
      </div>
      <div class="cx-status wa-status">
        <span class="cx-pill">Demo data</span>
        <span><strong>Not connected to 3CX yet.</strong> In production the messages come from the 3CX WhatsApp inbox. Replies are free within 24 h of the customer's last message; after that only approved templates can be sent (charged by Meta per message).</span>
      </div>
      <div class="wa-kpis" id="wa-kpis"></div>
      <div class="wa-inbox">
        <aside class="wa-list-col">
          <div class="wa-list-tools">
            <input type="text" id="wa-search" placeholder="Name, mobile or Res #…" oninput="waSearch = this.value; waRenderList()">
            <div class="wa-filters">
              ${[['all', 'All'], ['mine', 'Mine'], ['unread', 'Unread'], ['waiting', 'Waiting reply']].map(([k, l]) => `<button type="button" data-f="${k}" onclick="waFilter='${k}'; waRenderList()">${l}</button>`).join('')}
            </div>
          </div>
          <div class="wa-list" id="wa-list"></div>
        </aside>
        <section class="wa-conv" id="wa-conv"></section>
      </div>`;
    root.dataset.ready = '1';
  }
  waRenderAll();
  clearInterval(waTimer);
  waTimer = setInterval(() => { if (root.classList.contains('active')) waRenderAll(true); else clearInterval(waTimer); }, 4000);
}
waOnChange(() => { const r = document.getElementById('module-whatsapp'); if (r && r.dataset.ready && r.classList.contains('active')) waRenderAll(true); });

function waRenderAll(keepInput) {
  const threads = waThreads();
  if (!waActive && threads.length) waActive = (threads.find(t => t.waiting) || threads[0]).digits;
  waRenderKpis(threads);
  waRenderList(threads);
  waRenderConv(threads, keepInput);
  waUpdateMenuCount();
}

function waRenderKpis(threads) {
  const today0 = fleetStartOfToday();
  const outToday = threads.reduce((s, t) => s + t.messages.filter(x => x.dir === 'out' && x.at >= today0).length, 0);
  const tplToday = threads.reduce((s, t) => s + t.messages.filter(x => x.dir === 'out' && x.template && x.at >= today0).length, 0);
  const inToday = threads.reduce((s, t) => s + t.messages.filter(x => x.dir === 'in' && x.at >= today0).length, 0);
  const waiting = threads.filter(t => t.waiting).length;
  const open = threads.filter(t => t.windowOpen).length;
  const el = document.getElementById('wa-kpis');
  if (!el) return;
  el.innerHTML = [
    { l: 'Waiting for a reply', v: waiting, s: waiting ? 'Customer wrote last' : 'All answered', c: waiting ? 'warn' : 'good' },
    { l: 'Received today', v: inToday, s: 'Customer messages' },
    { l: 'Sent today', v: outToday, s: `${tplToday} template${tplToday === 1 ? '' : 's'} · ${outToday - tplToday} free repl${outToday - tplToday === 1 ? 'y' : 'ies'}` },
    { l: 'Open reply windows', v: open, s: 'Free replies (24 h)' }
  ].map(k => `<div class="cx-kpi ${k.c || ''}"><span>${k.l}</span><strong>${k.v}</strong><small>${k.s}</small></div>`).join('');
}

function waRenderList(threads) {
  threads = threads || waThreads();
  const list = document.getElementById('wa-list');
  if (!list) return;
  document.querySelectorAll('.wa-filters button').forEach(b => b.classList.toggle('active', b.dataset.f === waFilter));
  const q = waSearch.trim().toLowerCase(), qd = waDigits(q);
  const shown = threads.filter(t => {
    if (waFilter === 'unread' && !t.unread) return false;
    if (waFilter === 'waiting' && !t.waiting) return false;
    if (waFilter === 'mine' && !waIsMine(t.phone)) return false;
    if (!q) return true;
    return (qd.length >= 3 && t.digits.includes(qd)) || [t.name, t.ref].join(' ').toLowerCase().includes(q);
  });
  list.innerHTML = shown.length ? shown.map(t => {
    const initials = t.name ? t.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '#';
    const prev = t.last.attachment ? '📷 Photo' : t.last.channel === 'email' ? '✉ Email · ' + t.last.text : t.last.failed ? '⚠ Not delivered · ' + t.last.text : t.last.text;
    return `
      <button type="button" class="wa-item${t.digits === waActive ? ' active' : ''}" onclick="waOpenThread('${t.digits}')">
        <span class="wa-avatar${t.name ? '' : ' unknown'}">${waEsc(initials)}</span>
        <span class="wa-item-main">
          <span class="wa-item-top"><strong>${waEsc(t.name || t.phone)}</strong><em>${waEsc(waDayLabel(t.last.at) === 'Today' ? waTime(t.last.at) : waDayLabel(t.last.at))}</em></span>
          <span class="wa-item-prev">${t.last.dir === 'out' ? '<span class="wa-you">You:</span> ' : ''}${waEsc(prev.length > 70 ? prev.slice(0, 70) + '…' : prev)}</span>
          <span class="wa-item-tags">${t.ref ? `<span class="wa-chip">${waEsc(t.ref)}</span>` : '<span class="wa-chip muted">No booking</span>'}${t.waiting ? '<span class="wa-chip warn">Waiting</span>' : ''}${waAssigneeChip(t.phone)}${t.unread ? `<span class="wa-unread">${t.unread}</span>` : ''}</span>
        </span>
      </button>`;
  }).join('') : '<p class="wa-empty">No conversations.</p>';
}

function waOpenThread(digits) {
  waActive = digits;
  waRenderAll();
}

function waRenderConv(threads, keepInput) {
  const box = document.getElementById('wa-conv');
  if (!box) return;
  const t = (threads || waThreads()).find(x => x.digits === waActive);
  if (!t) { box.innerHTML = '<p class="wa-empty pad">Select a conversation.</p>'; return; }
  if (t.unread) { waMarkRead(t.phone); t.unread = 0; }
  const prevInput = keepInput && box.dataset.digits === t.digits ? (document.getElementById('wa-reply') || {}).value : '';
  const bk = t.booking;
  const thread = box.querySelector('.wa-thread');
  const wasBottom = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
  box.dataset.digits = t.digits;
  const asg = waAssignee(t.phone);
  const lock = asg && asg.agent !== waAgent() ? asg : null;
  const mine = asg && !lock;
  const ph = waEsc(t.phone);
  box.innerHTML = `
    <div class="wa-conv-head">
      <div>
        <strong>${waEsc(t.name || 'Unknown number')}</strong>
        <span>${ph}${bk ? ` · ${waEsc(bk.model)} · ${waEsc(bk.plate || '')} · ${waEsc(fleetFormatDate(bk.start))} → ${waEsc(fleetFormatDate(bk.end))}` : ''}</span>
      </div>
      <div class="wa-conv-actions">
        ${bk ? `<button type="button" class="wa-btn ghost small" onclick="fleetOpenBookingWindow('${waEsc(bk.id)}')">Open booking ${waEsc(bk.ref)}</button>` : ''}
        ${lock ? '' : `<button type="button" class="wa-btn ghost small" onclick="waCompose({ phone: '${ph}', bookingId: '${waEsc(t.bookingId || '')}', template: '${bk && bk.start > Date.now() ? 'pickup_reminder' : 'missed_call'}', title: 'Send template' })">Templates</button>`}
      </div>
    </div>
    <div class="wa-assign ${lock ? 'lock' : mine ? 'mine' : 'free'}">
      ${lock ? `<span>🔒 <strong>${waEsc(lock.agent)}</strong> is handling this conversation · since ${waWhen(lock.at)}</span>
                <button type="button" class="wa-btn ghost small" onclick="waTakeOver('${ph}')">Take over</button>`
        : mine ? `<span>✓ <strong>You</strong> are handling this conversation. Other agents can see it and can't reply.</span>
                <button type="button" class="wa-btn ghost small" onclick="waReleaseConversation('${ph}')">Release</button>`
        : `<span>Nobody is handling this conversation yet. Replying makes it yours.</span>
                <button type="button" class="wa-btn ghost small" onclick="waTakeConversation('${ph}')">Take conversation</button>`}
    </div>
    <div class="wa-thread">${waBubblesHtml(t, t.messages, (t.name || '').split(' ')[0])}</div>
    ${lock ? `
      <div class="wa-closed locked">
        <span><strong>Replies are locked</strong> so the customer doesn't get two answers. Ask ${waEsc(lock.agent)}, or take over if they are away.</span>
      </div>`
    : t.windowOpen ? `
      <div class="wa-reply">
        <textarea id="wa-reply" rows="2" placeholder="Reply to ${waEsc((t.name || 'customer').split(' ')[0])}…" onkeydown="if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); waSendReply(); }"></textarea>
        <button type="button" class="wa-btn primary" onclick="waSendReply()">${waIcon(14)} Send</button>
      </div>
      <div class="wa-reply-note">Free reply window open until ${waWhen(t.windowEnds)}${typeof annaSuggestReply === 'function' ? ` · <button type="button" class="anna-link-btn" onclick="waAnnaSuggest()">✦ Suggest reply</button>` : ''}</div>`
    : `
      <div class="wa-closed">
        <span><strong>Reply window closed.</strong> The customer hasn't written in the last 24 h, so only an approved template can be sent.</span>
        <button type="button" class="wa-btn primary small" onclick="waCompose({ phone: '${waEsc(t.phone)}', bookingId: '${waEsc(t.bookingId || '')}', title: 'Send template' })">Send template</button>
      </div>`}`;
  const th = box.querySelector('.wa-thread');
  if (wasBottom || !keepInput) th.scrollTop = th.scrollHeight;
  const input = document.getElementById('wa-reply');
  if (input && prevInput) { input.value = prevInput; input.focus(); }
}

function waSendReply() {
  const input = document.getElementById('wa-reply');
  const t = waThreads().find(x => x.digits === waActive);
  if (!input || !t || !input.value.trim()) return;
  const lock = waLockedByOther(t.phone);
  if (lock) { gcToast(`${lock.agent} is handling this conversation\n\nTake over first if they are away.`, 'warning'); waRenderAll(); return; }
  if (!waAssignee(t.phone)) waSetAssignee(t.phone, waAgent(), 'Assigned', `WhatsApp conversation with ${t.phone} taken by ${waAgent()} (first reply)`);
  waSend({ phone: t.phone, bookingId: t.bookingId, text: input.value.trim(), silent: true });
  input.value = '';
  waRenderAll();
}

// Anna (conceito): sugere a resposta com base na última mensagem do cliente
function waAnnaSuggest() {
  const t = waThreads().find(x => x.digits === waActive);
  const input = document.getElementById('wa-reply');
  if (!t || !input || !t.lastIn) return;
  let s = '';
  try { s = annaSuggestReply({ bookingRef: t.booking ? t.booking.ref : 'General', customerName: t.name || 'there' }, t.lastIn.text) || ''; } catch (e) {}
  if (typeof s === 'object' && s) s = s.text || '';
  s = String(s).replace(/\n\n[^\n]*· GC Tech\s*$/, ''); // no WhatsApp não vai assinatura
  const first = (t.name || '').split(' ')[0];
  if (!s) {
    const txt = t.lastIn.text.toLowerCase();
    s = /keep|extend|more days|extra day/.test(txt) ? `Hi ${first}, let me check availability for the extra days on ${t.booking ? t.booking.plate : 'your vehicle'} and I'll confirm the new return time and cost in a moment. No need to come in: once you confirm, I'll charge it to your card on file.`
      : /earlier|later|time|pick up/.test(txt) ? `Hi ${first}, no problem — we've updated your pick-up time. See you then!`
      : `Hi ${first}, thanks for your message. Let me check and get back to you shortly.`;
  }
  input.value = s;
  input.focus();
}

// Nova conversa: escolhe a reserva pelo Res # ou número
async function waNewMessage() {
  waInjectStyles();
  const overlay = document.createElement('div');
  overlay.className = 'wa-overlay';
  overlay.innerHTML = `
    <div class="wa-dialog" role="dialog" aria-modal="true">
      <div class="wa-dhead"><div class="wa-dhead-icon">${waIcon(20)}</div><div class="wa-dhead-main"><h3>New WhatsApp</h3><p>Find the customer by Res #, name or mobile</p></div><button type="button" class="wa-x" data-wa="close">✕</button></div>
      <div class="wa-dbody"><label class="wa-field"><span>Customer</span><input type="text" data-wa="q" placeholder="e.g. 495101, Smith or 0412…"></label><div class="wa-pick" data-wa="results"></div></div>
    </div>`;
  const all = Array.from(waContacts().values());
  const close = () => overlay.remove();
  const results = overlay.querySelector('[data-wa="results"]');
  const draw = q => {
    q = (q || '').trim().toLowerCase();
    const qd = waDigits(q);
    const found = q ? all.filter(c => (qd.length >= 3 && waDigits(c.phone).includes(qd)) || `${c.ref} ${c.fname} ${c.lname}`.toLowerCase().includes(q)).slice(0, 8) : [];
    results.innerHTML = found.map(c => `<button type="button" class="wa-pick-row" data-id="${waEsc(c.id)}"><strong>${waEsc(c.fname)} ${waEsc(c.lname)}</strong><span>${waEsc(c.ref)} · ${waEsc(c.phone)} · ${waEsc(fleetFormatDate(c.start))}</span></button>`).join('') || (q ? '<p class="wa-empty">No customer found.</p>' : '');
  };
  overlay.addEventListener('input', e => draw(e.target.value));
  overlay.addEventListener('click', e => {
    if (e.target === overlay || (e.target.dataset && e.target.dataset.wa === 'close')) return close();
    const row = e.target.closest('.wa-pick-row');
    if (row) { close(); waComposeForBooking(row.dataset.id, '', 'New WhatsApp'); }
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-wa="q"]').focus();
}

// Contador no menu lateral
function waUpdateMenuCount() {
  const el = document.getElementById('wa-menu-count');
  if (!el) return;
  const n = waUnreadTotal();
  el.textContent = n ? String(n) : '';
}
waOnChange(waUpdateMenuCount);

// ---------- Ícone e estilos ----------
function waIcon(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>`;
}

function waInjectStyles() {
  if (document.getElementById('wa-styles')) return;
  const link = document.createElement('link');
  link.id = 'wa-styles';
  link.rel = 'stylesheet';
  link.href = '../css/gc-whatsapp.css';
  document.head.appendChild(link);
}
waInjectStyles();
document.addEventListener('DOMContentLoaded', waUpdateMenuCount);
setTimeout(waUpdateMenuCount, 300);
