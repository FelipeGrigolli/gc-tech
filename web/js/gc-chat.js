// ==========================================
// GC TECH CHAT - Booking-Linked Sessions
// Sessions are now identified by: email_bookingRef
// ==========================================

const CHAT_SESSIONS_KEY = 'gc_chat_sessions';
function chatMessagesKey(sessionId) { return 'gc_chat_messages_' + sessionId; }

let currentSessionId = null;
let currentUserRole = 'customer';
let currentEmail = '';
let currentName = '';

function getChatSessions() {
  try { return JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveChatSessions(list) { localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(list)); }
function getChatMessages(sessionId) {
  try { return JSON.parse(localStorage.getItem(chatMessagesKey(sessionId)) || '[]'); }
  catch (e) { return []; }
}
function saveChatMessages(sessionId, list) { localStorage.setItem(chatMessagesKey(sessionId), JSON.stringify(list)); }

function ensureChatSession(sessionId, email, name, bookingRef, bookingDate, vehiclePlate) {
  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === sessionId);
  if (!session) {
    session = {
      sessionId: sessionId,
      customerEmail: email,
      customerName: name || 'Customer',
      bookingRef: bookingRef || 'General',
      bookingDate: bookingDate || 'N/A',
      vehiclePlate: vehiclePlate || 'N/A',
      status: 'waiting', 
      agentName: null,
      lastMessage: '',
      lastMessageAt: Date.now(),
      unreadForAgent: 0,
      unreadForCustomer: 0
    };
    sessions.unshift(session);
    saveChatSessions(sessions);
  }
  return session;
}

// opts.notice: aviso automático de outra tela (alocação, payment plan) — não conta como atendimento
function sendChatMessage(sessionId, sender, senderName, text, opts) {
  if (!text || !text.trim()) return;
  const messages = getChatMessages(sessionId);
  messages.push({
    id: Date.now() + '_' + Math.floor(Math.random() * 1000),
    sender: sender,
    senderName: senderName,
    text: text.trim(),
    timestamp: Date.now(),
    ...(opts && opts.notice ? { notice: true } : {})
  });
  saveChatMessages(sessionId, messages);

  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === sessionId);
  if(session) {
    session.lastMessage = text.trim();
    session.lastMessageAt = Date.now();
    if (sender === 'customer') {
      session.unreadForAgent = (session.unreadForAgent || 0) + 1;
      if (session.status === 'closed') session.status = 'waiting';
    } else if (sender === 'agent') {
      session.unreadForCustomer = (session.unreadForCustomer || 0) + 1;
      if (session.status === 'waiting') session.status = 'active';
      if (!session.agentName) session.agentName = senderName;
    }
    saveChatSessions(sessions);
  }
}

// ---------- Quem está atendendo o chat (mesmo modelo do WhatsApp, js/gc-whatsapp.js) ----------
// O chat fica com o agente que começou o atendimento (respondeu, clicou em Start ou em "Take conversation").
// Os outros veem quem está atendendo e só respondem com "Take over" (registrado no Activity Log).
// Sem resposta de agente por 12 h, ou com o chat encerrado, ele volta a ficar livre.
const CHAT_ASSIGN_TTL = 12 * 3600000;

function chatFindSession(sessionId) {
  return getChatSessions().find(s => s.sessionId === sessionId) || null;
}

function chatAssignee(sessionId) {
  const s = chatFindSession(sessionId);
  if (!s) return null;
  const stored = s.assignee || null;
  // Última resposta de um agente (avisos automáticos não contam)
  let lastHuman = null;
  getChatMessages(sessionId).forEach(m => {
    if (m.sender === 'agent' && !m.notice && (!lastHuman || m.timestamp > lastHuman.at)) lastHuman = { agent: m.senderName, at: m.timestamp };
  });
  const pick = stored && (!lastHuman || stored.at >= lastHuman.at) ? stored : lastHuman;
  if (!pick || !pick.agent) return null;
  if (Date.now() - pick.at > CHAT_ASSIGN_TTL) return null;
  return pick;
}

function chatLockedByOther(sessionId) {
  const a = chatAssignee(sessionId);
  return a && a.agent !== getAgentName() ? a : null;
}

function chatWhen(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `today ${time}` : `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${time}`;
}

function chatSetAssignee(sessionId, agent, action, detail) {
  const sessions = getChatSessions();
  const s = sessions.find(x => x.sessionId === sessionId);
  if (!s) return;
  s.assignee = { agent, at: Date.now() };
  saveChatSessions(sessions);
  if (typeof fleetLog === 'function') {
    fleetLog({ bookingId: 'chat-' + sessionId, ref: s.bookingRef || s.customerEmail, operator: getAgentName(), action: 'Live Chat',
      details: detail || `Live chat with ${s.customerName || s.customerEmail} ${agent ? 'taken by ' + agent : 'released'}`, info: action || '' });
  }
}

function chatTakeConversation(sessionId) {
  const s = chatFindSession(sessionId);
  chatSetAssignee(sessionId, getAgentName(), 'Assigned', `Live chat with ${s ? s.customerName : 'customer'} (${s ? s.bookingRef : ''}) taken by ${getAgentName()}`);
  if (typeof gcToast === 'function') gcToast('This chat is now yours. Other agents can see you are handling it.', 'success');
  chatAfterAssign();
}

function chatReleaseConversation(sessionId) {
  const s = chatFindSession(sessionId);
  chatSetAssignee(sessionId, null, 'Released', `Live chat with ${s ? s.customerName : 'customer'} (${s ? s.bookingRef : ''}) released by ${getAgentName()}`);
  if (typeof gcToast === 'function') gcToast('Chat released. Any agent can pick it up now.', 'info');
  chatAfterAssign();
}

// Assumir o chat de outro agente: pede confirmação e fica registrado
async function chatTakeOver(sessionId) {
  const a = chatLockedByOther(sessionId);
  if (!a) { chatTakeConversation(sessionId); return true; }
  const ok = await gcConfirm({
    title: `Take over from ${a.agent}?`,
    message: `${a.agent} has been handling this chat since ${chatWhen(a.at)}. Only take over if they are away, so the customer doesn't get two answers.`,
    confirmText: 'Take over', kind: 'warning'
  });
  if (!ok) return false;
  const s = chatFindSession(sessionId);
  chatSetAssignee(sessionId, getAgentName(), 'Taken over', `Live chat with ${s ? s.customerName : 'customer'} (${s ? s.bookingRef : ''}) taken over from ${a.agent} by ${getAgentName()}`);
  if (typeof gcToast === 'function') gcToast(`You are now handling this chat instead of ${a.agent}.`, 'success');
  chatAfterAssign();
  return true;
}

// Selo de quem está atendendo (mesmas cores do WhatsApp)
function chatAssigneeChip(sessionId) {
  const a = chatAssignee(sessionId);
  if (!a) return '<span class="chat-asg free">Unassigned</span>';
  return a.agent === getAgentName() ? '<span class="chat-asg me">You</span>' : `<span class="chat-asg other">🔒 ${escapeHtml(a.agent)}</span>`;
}

function chatAfterAssign() {
  if (document.getElementById('chat-thread') && currentSessionId) refreshChatUI();
  const module = document.getElementById('module-livechat');
  if (module && module.classList.contains('active')) renderLiveChatModule();
}

async function endCurrentChat() {
  if (currentUserRole === 'agent') {
    const lock = chatLockedByOther(currentSessionId);
    if (lock) { gcToast(`${lock.agent} is handling this chat\n\nTake over first if they are away.`, 'warning'); refreshChatUI(); return; }
  }
  const ok = await gcConfirm({ title: 'End this chat?', message: 'The conversation will be closed. It can be reopened later.', confirmText: 'End chat', danger: true });
  if (!ok) return;

  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === currentSessionId);
  if (session) {
    session.status = 'closed';
    session.assignee = { agent: null, at: Date.now() }; // chat encerrado: fica livre para quem atender a próxima
    saveChatSessions(sessions);
    
    const messages = getChatMessages(currentSessionId);
    messages.push({
      id: Date.now(),
      sender: 'system',
      senderName: 'System',
      text: '— Chat Session Ended —',
      timestamp: Date.now()
    });
    saveChatMessages(currentSessionId, messages);
    
    refreshChatUI();
  }
}

// NOVA FUNÇÃO: Reabrir o Chat
function reopenCurrentChat() {
  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === currentSessionId);
  if (session) {
    // Muda o status dependendo de quem reabriu
    if (currentUserRole === 'customer') {
      session.status = 'waiting';
      session.unreadForAgent = (session.unreadForAgent || 0) + 1;
    } else {
      session.status = 'active';
      session.unreadForCustomer = (session.unreadForCustomer || 0) + 1;
      session.assignee = { agent: getAgentName(), at: Date.now() }; // quem reabre fica com o chat
    }
    saveChatSessions(sessions);
    
    // Envia mensagem de sistema
    const messages = getChatMessages(currentSessionId);
    const reopenerName = currentUserRole === 'customer' ? 'Customer' : 'Agent';
    messages.push({
      id: Date.now(),
      sender: 'system',
      senderName: 'System',
      text: `— Chat Reopened by ${reopenerName} —`,
      timestamp: Date.now()
    });
    saveChatMessages(currentSessionId, messages);
    
    refreshChatUI();
  }
}

function getAgentName() {
  let n = localStorage.getItem('gc_agent_name');
  if (!n) { n = 'Felipe'; localStorage.setItem('gc_agent_name', n); }
  return n;
}
function setAgentName() {
  const input = document.getElementById('agent-name-input');
  if (!input || !input.value.trim()) return;
  localStorage.setItem('gc_agent_name', input.value.trim());
  gcToast('Agent name updated to "' + input.value.trim() + '".');
}

// ==========================================
// CHAT APP INIT (ROUTING)
// ==========================================
function initChatApp() {
  const params = new URLSearchParams(window.location.search);
  currentUserRole = params.get('role') || 'customer';
  currentEmail = params.get('email');
  currentName = params.get('name') || (currentUserRole === 'agent' ? 'Customer' : 'You');
  const passedSessionId = params.get('sessionId'); 

  if (!currentEmail) {
    document.body.innerHTML = '<p style="color:#fff; padding:20px;">Invalid chat session.</p>';
    return;
  }

  if (currentUserRole === 'customer' && !passedSessionId) {
    showBookingSelection(currentEmail, currentName);
  } else {
    currentSessionId = passedSessionId;
    openChatInterface();
  }
}

// ==========================================
// VIEW: BOOKING SELECTION (Customer)
// ==========================================
// Reservas do cliente (site/portal/Add Booking + GC-8832), já com datas reais e status
let chatBookingList = [];

function chatCollectBookings(email) {
  const out = [];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = Date.now();
  const kindOf = (b, start, end) => b.status === 'fleet_pending' || b.status === 'proposal_sent' ? 'pending'
    : start <= now && end >= now ? 'hire' : end < now ? 'past' : 'upcoming';
  let list = [];
  try { list = JSON.parse(localStorage.getItem('gc_multi_bookings_' + email) || '[]'); } catch (e) {}
  list.filter(b => b.status !== 'cancelled').forEach(b => {
    const r = typeof fleetBookingRange === 'function' ? fleetBookingRange(b) : { start: NaN, end: NaN };
    out.push({ ref: b.ref, start: r.start, end: r.end, vehicle: b.vehicle || 'Vehicle', plate: b.plate || 'Pending allocation',
      dateLabel: isNaN(r.start) ? (b.date || 'Unknown date') : `${fleetFormatDate(r.start)} → ${fleetFormatDate(r.end)}`, kind: kindOf(b, r.start, r.end) });
  });
  // Reserva principal do portal (GC-8832)
  if (typeof FLEET_MAIN_PREFIX !== 'undefined') {
    let state = null;
    try { state = JSON.parse(localStorage.getItem(FLEET_MAIN_PREFIX + email) || 'null'); } catch (e) {}
    if (state && Object.keys(state).length && state.status !== 'cancelled' && !out.some(x => x.ref === 'GC-8832')) {
      const r = fleetMainBookingRange(state);
      out.push({ ref: 'GC-8832', start: r.start, end: r.end, vehicle: 'Auto Pantech Truck', plate: FLEET_MAIN_BOOKING_PLATE,
        dateLabel: `${fleetFormatDate(r.start)} → ${fleetFormatDate(r.end)}`, kind: kindOf({}, r.start, r.end) });
    }
  }
  // Reservas de demonstração do mesmo cliente (ex.: GC-7716, a locação anterior com Payment Plan)
  if (typeof fleetSeedBookings === 'function') {
    fleetSeedBookings().filter(s => s.type !== 'maintenance' && String(s.clientEmail || '').toLowerCase() === String(email || '').toLowerCase() && !out.some(x => x.ref === s.ref))
      .forEach(s => {
        const cat = typeof fleetGetVehicle === 'function' && fleetGetVehicle(s.plate) ? fleetGetCategory(fleetGetVehicle(s.plate).categoryId) : null;
        out.push({ ref: s.ref, start: s.startMs, end: s.endMs, vehicle: cat ? cat.model : 'Vehicle', plate: s.plate,
          dateLabel: `${fleetFormatDate(s.startMs)} → ${fleetFormatDate(s.endMs)}`, kind: kindOf({}, s.startMs, s.endMs) });
      });
  }
  // Em andamento primeiro, depois as próximas (mais perto primeiro), depois as passadas (mais recente primeiro)
  const rank = { hire: 0, pending: 1, upcoming: 1, past: 2 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.kind === 'past' ? b.start - a.start : a.start - b.start));
  out.forEach(x => { x.refHtml = esc(x.ref); x.vehicleHtml = esc(x.vehicle); x.plateHtml = esc(x.plate); });
  return out;
}

function showBookingSelection(email, name) {
  document.getElementById('chat-interface-view').style.display = 'none';
  document.getElementById('booking-selection-view').style.display = 'block';
  document.getElementById('end-chat-btn').style.display = 'none';
  document.getElementById('back-to-bookings-btn').style.display = 'none';

  document.getElementById('chat-header-name').textContent = 'Select Booking';
  document.getElementById('chat-header-status').textContent = 'Step 1 of 2';

  chatBookingList = chatCollectBookings(email);
  renderBookingSelectList();
  const search = document.getElementById('bk-filter-text');
  if (search) search.focus();
}

// Filtro por Res # (ou veículo/placa) e por data (reservas que incluem aquele dia)
function renderBookingSelectList() {
  const container = document.getElementById('booking-list-container');
  if (!container) return;
  const text = (document.getElementById('bk-filter-text').value || '').trim().toLowerCase().replace(/^#/, '');
  const day = document.getElementById('bk-filter-date').value;
  const dayStart = day ? new Date(day + 'T00:00').getTime() : null;
  const dayEnd = day ? dayStart + 86400000 - 1 : null;
  const sessions = getChatSessions();
  // Falta responder: a última mensagem da conversa é da GC Tech (chat não encerrado)
  const awaiting = b => {
    const s = sessions.find(x => x.sessionId === `${currentEmail}_${b.ref}`);
    if (!s || s.status === 'closed') return null;
    const last = getChatMessages(s.sessionId).filter(m => m.sender !== 'system').slice(-1)[0];
    return last && last.sender === 'agent' ? last : null;
  };
  const shown = chatBookingList.map((b, i) => ({ b, i, reply: awaiting(b) })).filter(({ b }) =>
    (!text || [b.ref, b.vehicle, b.plate].some(v => String(v).toLowerCase().includes(text))) &&
    (!day || (b.start <= dayEnd && b.end >= dayStart)));
  // As que faltam responder primeiro (a mais antiga no topo); o resto na ordem de sempre
  shown.sort((x, y) => (x.reply ? 0 : 1) - (y.reply ? 0 : 1) || (x.reply && y.reply ? x.reply.timestamp - y.reply.timestamp : x.i - y.i));
  const pendingCount = shown.filter(x => x.reply).length;
  const labels = { hire: 'On hire', upcoming: 'Upcoming', past: 'Past', pending: 'Finding a vehicle' };

  document.getElementById('bk-filter-count').innerHTML = (chatBookingList.length
    ? (text || day ? `${shown.length} of ${chatBookingList.length} bookings` : `${chatBookingList.length} booking${chatBookingList.length > 1 ? 's' : ''}`) : '') +
    (pendingCount ? ` · <span class="bk-reply-count">${pendingCount} waiting for your reply</span>` : '');

  let html = '';
  if (!chatBookingList.length) {
    html = '<p style="font-size: 13px; color: #94a3b8; margin-bottom: 20px;">No active bookings found for your account.</p>';
  } else if (!shown.length) {
    html = '<p style="font-size: 13px; color: #94a3b8;">No bookings match this search.</p>';
  } else {
    const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    html = shown.map(({ b, i, reply }) => {
      const s = sessions.find(x => x.sessionId === `${currentEmail}_${b.ref}`);
      const unread = s && s.unreadForCustomer > 0 ? `<span class="b-unread">${s.unreadForCustomer}</span>` : '';
      const when = reply ? new Date(reply.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const preview = reply ? (reply.text.length > 90 ? reply.text.slice(0, 90) + '…' : reply.text) : '';
      return `
        <div class="booking-select-card${reply ? ' needs-reply' : ''}" onclick="startChatFromList(${i})">
          ${reply ? `<div class="b-reply">↩ Reply needed · ${esc(reply.senderName || 'GC Tech')} · ${esc(when)}<div class="b-reply-text">“${esc(preview)}”</div></div>` : ''}
          <div class="b-top"><div class="b-ref">Reference: ${b.refHtml}${unread}</div><span class="b-pill ${b.kind}">${labels[b.kind]}</span></div>
          <div class="b-detail">Date: ${b.dateLabel}</div>
          <div class="b-detail">Vehicle: ${b.vehicleHtml}</div>
          <div class="b-detail" style="color: #64748b; font-size: 11px; margin-top: 5px;">Plate: ${b.plateHtml}</div>
        </div>`;
    }).join('');
  }
  html += `
    <button onclick="startChatWithBooking('General', 'N/A', 'N/A')"
            style="background: transparent; border: 1px solid #475569; color: #cbd5e1; padding: 12px; border-radius: 6px; cursor: pointer; margin-top: 15px; width: 100%; font-size: 13px;">
      Talk about General Support (No Booking)
    </button>`;
  container.innerHTML = html;
}

function clearBookingFilter() {
  document.getElementById('bk-filter-text').value = '';
  document.getElementById('bk-filter-date').value = '';
  renderBookingSelectList();
}

function startChatFromList(i) {
  const b = chatBookingList[i];
  if (b) startChatWithBooking(b.ref, isNaN(b.start) ? b.dateLabel : fleetFormatDate(b.start), `${b.vehicle} - ${b.plate}`);
}

function startChatWithBooking(bookingRef, bookingDate, vehicleData) {
  const sessionId = currentEmail + '_' + bookingRef;
  ensureChatSession(sessionId, currentEmail, currentName, bookingRef, bookingDate, vehicleData);
  currentSessionId = sessionId;
  openChatInterface();
}

// Cliente volta para a lista de reservas sem fechar a janela
function backToBookingSelection() {
  currentSessionId = null;
  showBookingSelection(currentEmail, currentName);
}

// ==========================================
// VIEW: CHAT INTERFACE
// ==========================================
function openChatInterface() {
  document.getElementById('booking-selection-view').style.display = 'none';
  document.getElementById('chat-interface-view').style.display = 'flex';
  
  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === currentSessionId);
  
  const headerName = document.getElementById('chat-header-name');
  if (currentUserRole === 'agent') {
    headerName.textContent = session ? `${session.customerName} (${session.bookingRef})` : 'Customer';
  } else {
    headerName.textContent = session ? `Support: ${session.bookingRef}` : 'GC Tech Support';
  }

  // Cliente pode voltar para a lista de reservas sem fechar a janela
  document.getElementById('back-to-bookings-btn').style.display = currentUserRole === 'customer' ? '' : 'none';
  const thread = document.getElementById('chat-thread');
  if (thread) thread.innerHTML = '';

  refreshChatUI();

  const input = document.getElementById('chat-input');
  // Listeners e atualização automática uma vez só (o cliente pode trocar de reserva várias vezes)
  if (!chatInterfaceReady) {
    chatInterfaceReady = true;
    window.addEventListener('storage', (e) => {
      if (currentSessionId && (e.key === chatMessagesKey(currentSessionId) || e.key === CHAT_SESSIONS_KEY)) refreshChatUI();
    });
    setInterval(() => { if (currentSessionId) refreshChatUI(); }, 2000);

    const sendBtn = document.getElementById('chat-send-btn');
    const doSend = () => {
      const text = input.value;
      if (!text.trim() || !currentSessionId) return;
      if (currentUserRole === 'agent') {
        const lock = chatLockedByOther(currentSessionId);
        if (lock) { gcToast(`${lock.agent} is handling this chat\n\nTake over first if they are away.`, 'warning'); refreshChatUI(); return; }
        if (!chatAssignee(currentSessionId)) chatSetAssignee(currentSessionId, getAgentName(), 'Assigned', `Live chat taken by ${getAgentName()} (first reply)`);
      }
      const senderName = currentUserRole === 'agent' ? getAgentName() : currentName;
      sendChatMessage(currentSessionId, currentUserRole, senderName, text);
      input.value = '';
      refreshChatUI();
    };
    if (sendBtn) sendBtn.onclick = doSend;
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
  }
  if (input) input.focus();
}
let chatInterfaceReady = false;

function refreshChatUI() {
  const thread = document.getElementById('chat-thread');
  if (!thread) return;
  
  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === currentSessionId);
  const messages = getChatMessages(currentSessionId);

  if (session) {
    let changed = false;
    if (currentUserRole === 'customer' && session.unreadForCustomer > 0) { session.unreadForCustomer = 0; changed = true; }
    if (currentUserRole === 'agent' && session.unreadForAgent > 0) { session.unreadForAgent = 0; changed = true; }
    if (changed) saveChatSessions(sessions);
  }

  const headerStatus = document.getElementById('chat-header-status');
  const inputBar = document.getElementById('chat-input-bar');
  const endBtn = document.getElementById('end-chat-btn');
  const reopenBar = document.getElementById('chat-reopen-bar');

  // Lógica de UI baseada no Status
  if (session && session.status === 'closed') {
    if(headerStatus) headerStatus.textContent = 'Chat ended';
    if(inputBar) inputBar.style.display = 'none'; // Esconde barra de escrever
    if(endBtn) endBtn.style.display = 'none';     // Esconde botão "End Chat"
    if(reopenBar) reopenBar.style.display = 'block'; // MOSTRA o botão de Reabrir
  } else {
    if(inputBar) inputBar.style.display = 'flex'; // Mostra barra de escrever
    if(endBtn) endBtn.style.display = 'block';    // Mostra botão "End Chat"
    if(reopenBar) reopenBar.style.display = 'none'; // Esconde o botão de Reabrir
    
    if (!session || session.status === 'waiting') {
      if(headerStatus) headerStatus.textContent = currentUserRole === 'customer' ? 'Waiting for an agent...' : 'Waiting for you to reply';
    } else {
      if(headerStatus) headerStatus.textContent = 'Online';
    }
  }

  // Agente: quem está atendendo. Chat de outro agente fica só leitura (como no WhatsApp)
  const assignBar = document.getElementById('chat-assign-bar');
  if (currentUserRole === 'agent' && assignBar && session) {
    const asg = chatAssignee(currentSessionId);
    const lock = asg && asg.agent !== getAgentName() ? asg : null;
    const id = escapeHtml(currentSessionId).replace(/'/g, '&#39;');
    const html = session.status === 'closed' ? ''
      : lock ? `<div class="chat-assign lock"><span>🔒 <strong>${escapeHtml(lock.agent)}</strong> is handling this chat · since ${escapeHtml(chatWhen(lock.at))}</span><button type="button" onclick="chatTakeOver('${id}')">Take over</button></div>`
      : asg ? `<div class="chat-assign mine"><span>✓ <strong>You</strong> are handling this chat. Other agents can see it and can't reply.</span><button type="button" onclick="chatReleaseConversation('${id}')">Release</button></div>`
      : `<div class="chat-assign free"><span>Nobody is handling this chat yet. Replying makes it yours.</span><button type="button" onclick="chatTakeConversation('${id}')">Take chat</button></div>`;
    if (assignBar.dataset.html !== html) { assignBar.innerHTML = html; assignBar.dataset.html = html; }
    assignBar.style.display = html ? '' : 'none';
    const lockedNote = document.getElementById('chat-locked-note');
    if (lockedNote) {
      lockedNote.style.display = lock && session.status !== 'closed' ? '' : 'none';
      if (lock) lockedNote.innerHTML = `<strong>Replies are locked</strong> so the customer doesn't get two answers. Ask ${escapeHtml(lock.agent)}, or take over if they are away.`;
    }
    if (lock) {
      if (inputBar) inputBar.style.display = 'none';
      if (endBtn) endBtn.style.display = 'none';
    }
  }

  // Conceito "Anna inside the RCM": sugestão de resposta na janela do agente (js/gc-anna.js)
  if (typeof annaOnChatRefresh === 'function') annaOnChatRefresh(session, messages, currentUserRole);

  if (messages.length === 0) {
    thread.innerHTML = `<p style="color:#64748b; text-align:center; font-size:13px; margin-top:20px;">Send a message to start.</p>`;
    return;
  }

  const wasNearBottom = (thread.scrollHeight - thread.scrollTop - thread.clientHeight) < 40;

  thread.innerHTML = messages.map(m => {
    if (m.sender === 'system') {
      return `<div class="chat-msg-row system"><div class="chat-bubble system">${escapeHtml(m.text)}</div></div>`;
    }
    const mine = m.sender === currentUserRole;
    // Agente vendo resposta de outro agente: mostra quem escreveu
    const otherAgent = mine && currentUserRole === 'agent' && m.senderName && m.senderName !== getAgentName();
    return `
      <div class="chat-msg-row ${mine ? 'mine' : 'theirs'}">
        <div class="chat-bubble ${mine ? 'mine' : 'theirs'}">
          ${!mine || otherAgent ? `<div class="chat-sender-name">${escapeHtml(m.senderName)}</div>` : ''}
          <div>${escapeHtml(m.text)}</div>
          <div class="chat-timestamp">${new Date(m.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
    `;
  }).join('');

  if (wasNearBottom) thread.scrollTop = thread.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ==========================================
// AGENT DASHBOARD: LIVE CHAT LIST
// ==========================================
function renderLiveChatModule() {
  const container = document.getElementById('livechat-list');
  if (!container) return;

  const nameInput = document.getElementById('agent-name-input');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = getAgentName();

  const searchInput = document.getElementById('chat-search-input');
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let sessions = getChatSessions().slice().sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  if (searchTerm) {
    sessions = sessions.filter(s => 
      (s.customerEmail && s.customerEmail.toLowerCase().includes(searchTerm)) ||
      (s.bookingRef && s.bookingRef.toLowerCase().includes(searchTerm)) ||
      (s.customerName && s.customerName.toLowerCase().includes(searchTerm))
    );
  }

  if (sessions.length === 0) {
    if (searchTerm) {
      container.innerHTML = `<p style="color: var(--text-muted); font-style: italic; padding: 20px; text-align: center;">No chats found matching "${searchTerm}".</p>`;
    } else {
      container.innerHTML = `<p style="color: var(--text-muted); font-style: italic; padding: 20px; text-align: center;">No conversations found.</p>`;
    }
    return;
  }

  container.innerHTML = sessions.map(s => {
    const statusBadge = s.status === 'waiting'
      ? `<span style="background:#f59e0b; color:#000; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">WAITING</span>`
      : s.status === 'active'
      ? `<span style="background:#10b981; color:#000; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">IN PROGRESS</span>`
      : `<span style="background:#334155; color:#94a3b8; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:700;">CLOSED</span>`;

    const unread = s.unreadForAgent > 0
      ? `<span style="background:#ef4444; color:#fff; border-radius:50%; padding:2px 7px; font-size:11px; font-weight:700; margin-left:8px;">${s.unreadForAgent}</span>`
      : '';

    // Chat com outro agente: só dá para ver (responder exige "Take over" dentro do chat)
    const lock = s.status !== 'closed' ? chatLockedByOther(s.sessionId) : null;
    const asgChip = s.status !== 'closed' ? chatAssigneeChip(s.sessionId) : '';
    const actionBtn = lock
      ? `<button class="btn btn-outline" style="padding:8px 16px; font-size:12px;" title="${escapeHtml(lock.agent)} is handling this chat" onclick="startOrContinueChat('${s.sessionId}', '${s.customerEmail}', '${s.customerName}')">👁 View</button>`
      : s.status === 'waiting'
      ? `<button class="btn btn-submit" style="padding:8px 16px; font-size:12px;" onclick="startOrContinueChat('${s.sessionId}', '${s.customerEmail}', '${s.customerName}')">▶ Start</button>`
      : (s.status === 'closed' 
         ? `<button class="btn btn-outline" style="padding:8px 16px; font-size:12px;" onclick="startOrContinueChat('${s.sessionId}', '${s.customerEmail}', '${s.customerName}')">📄 View History</button>`
         : `<button class="btn btn-cancel" style="padding:8px 16px; font-size:12px;" onclick="startOrContinueChat('${s.sessionId}', '${s.customerEmail}', '${s.customerName}')">💬 Open Chat</button>`);

    const lastMsgPreview = (s.lastMessage || '').length > 50 ? s.lastMessage.slice(0, 50) + '…' : (s.lastMessage || 'No messages yet');
    
    const bookingContext = s.bookingRef === 'General' 
      ? `<span style="color:#94a3b8; font-size: 11px;">General Inquiry</span>`
      : `<span style="color:#3b82f6; font-size: 11px; font-weight: 600;">Ref: ${s.bookingRef}</span> <span style="color:#64748b; font-size: 11px;">(${s.vehiclePlate})</span>`;

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; border:1px solid #334155; border-radius:8px; padding:16px 20px; margin-bottom:12px;">
        <div>
          <div style="font-weight:700; color:#fff; font-size:14px; margin-bottom:4px;">${s.customerName || s.customerEmail} ${unread}</div>
          <div style="margin-bottom: 6px;">${bookingContext}</div>
          <div style="color:var(--text-muted); font-size:12px; margin-bottom:8px;">${lastMsgPreview}</div>
          <div style="display:flex; align-items:center; gap:8px;">${statusBadge}${asgChip}</div>
        </div>
        <div>${actionBtn}</div>
      </div>
    `;
  }).join('');
}

function startOrContinueChat(sessionId, email, name) {
  const agentName = getAgentName();
  let sessions = getChatSessions();
  let session = sessions.find(s => s.sessionId === sessionId);

  // Start: o chat fica com este agente. Se outro já está atendendo, abre só para leitura
  if (session && session.status === 'waiting' && !chatLockedByOther(sessionId)) {
    chatSetAssignee(sessionId, agentName, 'Assigned', `Live chat with ${session.customerName || email} (${session.bookingRef}) started by ${agentName}`);
    sendChatMessage(sessionId, 'agent', agentName, `Hello! My name is ${agentName} and I will be assisting you regarding your booking ${session.bookingRef}. How can I help you?`);
  }

  sessions = getChatSessions();
  session = sessions.find(s => s.sessionId === sessionId);
  if (session) { session.unreadForAgent = 0; saveChatSessions(sessions); }

  window.open(
    `gc-chat.html?role=agent&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name || '')}&sessionId=${encodeURIComponent(sessionId)}`,
    'gcChat_' + sessionId,
    'width=380,height=580'
  );
  renderLiveChatModule();
}

// ==========================================
// CUSTOMER PORTAL: FLOATING BUTTON
// ==========================================
function updateCustomerFabBadge() {
  const badge = document.getElementById('chat-fab-badge');
  if (!badge) return;
  
  let email = null;
  try {
    const profile = JSON.parse(localStorage.getItem('gc_user_profile'));
    if (profile) email = profile.email;
  } catch (e) {}
  if (!email) { badge.style.display = 'none'; return; }

  let totalUnread = 0;
  const sessions = getChatSessions().filter(s => s.customerEmail === email);
  sessions.forEach(s => { totalUnread += (s.unreadForCustomer || 0); });

  badge.textContent = totalUnread;
  badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
}

function openCustomerChat() {
  let email = 'guest@gctech.com', name = 'Customer';
  try {
    const profile = JSON.parse(localStorage.getItem('gc_user_profile'));
    if (profile) { email = profile.email || email; name = profile.name || name; }
  } catch (e) {}

  updateCustomerFabBadge();
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`,
    'gcChatCustomer',
    'width=380,height=580'
  );
}

// ==========================================
// SITE PÚBLICO: chat para visitante (Home, Search Results)
// Logado → abre direto. Visitante → modal pedindo nome/e-mail.
// O modal usa as classes .home-modal de gc-home.css.
// ==========================================
function openCustomerChatWithPrompt() {
  let profile = null;
  try { profile = JSON.parse(localStorage.getItem('gc_user_profile')); } catch (e) {}
  if (sessionStorage.getItem('gc_auth_poc') === 'true' && profile && profile.email) {
    openCustomerChat();
    return;
  }

  let modal = document.getElementById('chat-start-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chat-start-modal';
    modal.className = 'home-modal';
    modal.innerHTML = `
      <div class="home-modal-card">
        <h3>Chat with GC Tech</h3>
        <p>Tell us who you are so an agent can help you.</p>
        <label>Full name<input type="text" id="chat-start-name" placeholder="Your name"></label>
        <label>Email<input type="email" id="chat-start-email" placeholder="you@email.com"></label>
        <div class="widget-error" id="chat-start-error"></div>
        <div class="home-modal-actions">
          <button class="btn-ghost dark" onclick="closeChatStartModal()">Cancel</button>
          <button class="btn-orange" onclick="startGuestChat()">Start chat</button>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeChatStartModal(); });
    document.body.appendChild(modal);
  }

  document.getElementById('chat-start-name').value = profile ? (profile.name || '') : '';
  document.getElementById('chat-start-email').value = profile ? (profile.email || '') : '';
  document.getElementById('chat-start-error').textContent = '';
  modal.classList.add('open');
  document.getElementById('chat-start-name').focus();
}

function closeChatStartModal() {
  const modal = document.getElementById('chat-start-modal');
  if (modal) modal.classList.remove('open');
}

function startGuestChat() {
  const name = document.getElementById('chat-start-name').value.trim();
  const email = document.getElementById('chat-start-email').value.trim().toLowerCase();
  const errorEl = document.getElementById('chat-start-error');
  if (!name) { errorEl.textContent = 'Please enter your name.'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errorEl.textContent = 'Please enter a valid email.'; return; }

  closeChatStartModal();
  window.open(
    `gc-chat.html?role=customer&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`,
    'gcChatCustomer',
    'width=380,height=580'
  );
}

// ==========================================
// SYSTEM EVENTS
// ==========================================
window.addEventListener('storage', (e) => {
  if (e.key === CHAT_SESSIONS_KEY) {
    updateCustomerFabBadge();
    const module = document.getElementById('module-livechat');
    if (module && module.classList.contains('active')) renderLiveChatModule();
    // Lista de reservas do cliente aberta: atualiza o destaque "Reply needed"
    const list = document.getElementById('booking-selection-view');
    if (list && list.style.display !== 'none' && typeof chatBookingList !== 'undefined') renderBookingSelectList();
  }
});

function initGcChatOnLoad() {
  updateCustomerFabBadge();
  setInterval(updateCustomerFabBadge, 3000);
  if (document.getElementById('chat-thread')) initChatApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGcChatOnLoad);
} else {
  initGcChatOnLoad();
}