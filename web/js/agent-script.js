const STORAGE_KEY = 'gc_booking_poc';
const AGENT_AUTH_KEY = 'gc_agent_auth';
const AGENT_PROFILE_KEY = 'gc_agent_profile';

// access: quais áreas de gestão o usuário vê
// Todos os logins abrem no Today's Overview (DEFAULT_HOME), como a tela inicial do RCM
const DEFAULT_HOME = 'module-dashboard';
const validAgents = {
  'felipe': { password: 'gctech', name: 'Felipe Grigolli', role: 'Senior Operations Agent', access: ['analytics', 'executive'] },
  'alex': { password: 'gctech', name: 'Alex', role: 'Data Analyst', access: ['analytics', 'executive'] },
  'sam': { password: 'gctech', name: 'Sam', role: 'Owner / Managing Director', access: ['analytics', 'executive'] },
  'test': { password: 'gctech', name: 'Test Agent', role: 'Support Staff', access: [] }
};

const MODULE_TITLES = {
  'module-dashboard': "Today's Overview",
  'module-agent-requests': 'Agent Requests & Allocations',
  'module-analytics': 'Reports & Analytics',
  'module-3cx': '3CX · Calls',
  'module-whatsapp': 'WhatsApp · via 3CX',
  'module-executive': 'Executive Overview',
  'module-bonds': 'Bond Refunds',
  'module-payments': 'Payment Plans',
  'module-livechat': 'Live Chat System'
};

// Esconde do menu as áreas que o perfil não pode ver.
// 'bonds' não fica no perfil: vem da lista que Felipe/Alex editam (js/gc-bonds.js)
function applyAgentAccess(profile) {
  const access = (profile.access || []).slice();
  const username = profile.username || Object.keys(validAgents).find(u => validAgents[u].name === profile.name);
  if (bondHasAccess(username)) access.push('bonds');
  document.querySelectorAll('.menu-item[data-access]').forEach(item => {
    item.hidden = !access.includes(item.dataset.access);
  });
  // Perdeu o acesso com o módulo aberto: volta para a tela inicial
  const bonds = document.getElementById('module-bonds');
  if (bonds && bonds.classList.contains('active') && !access.includes('bonds')) {
    switchModule(DEFAULT_HOME, document.querySelector(`.menu-item[onclick*="${DEFAULT_HOME}"]`), MODULE_TITLES[DEFAULT_HOME]);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  checkAgentAuth();
});

function handleAgentAuth(e) {
  e.preventDefault();
  const user = document.getElementById('agent-username').value.toLowerCase().trim();
  const pass = document.getElementById('agent-password').value;
  const errorEl = document.getElementById('auth-error');

  if (validAgents[user] && validAgents[user].password === pass) {
    errorEl.style.display = 'none';
    const { password, ...rest } = validAgents[user]; // não grava a senha no localStorage
    const profile = { ...rest, username: user };
    
    // Save authentication state (sessionStorage: login dura só enquanto a aba estiver aberta)
    sessionStorage.setItem(AGENT_AUTH_KEY, 'true');
    localStorage.setItem(AGENT_PROFILE_KEY, JSON.stringify(profile));
    
    // CRITICAL FOR LIVE CHAT: Sync the chat agent name
    localStorage.setItem('gc_agent_name', profile.name);
    localStorage.setItem('gc_agent_role', profile.role);
    // Esta aba fica com este agente (outra aba pode ser outro agente — js/gc-ui.js)
    sessionStorage.setItem('gc_agent_name', profile.name);
    sessionStorage.setItem(AGENT_PROFILE_KEY, JSON.stringify(profile));
    
    showMainDashboard(profile);
  } else {
    errorEl.style.display = 'block';
  }
}

function checkAgentAuth() {
  if (sessionStorage.getItem(AGENT_AUTH_KEY) === 'true') {
    const profile = JSON.parse(sessionStorage.getItem(AGENT_PROFILE_KEY) || localStorage.getItem(AGENT_PROFILE_KEY));
    if (profile) {
      showMainDashboard(profile);
      return;
    }
  }
  document.getElementById('agent-auth-view').style.display = 'block';
  document.getElementById('agent-main-dashboard').style.display = 'none';
}

function showMainDashboard(profile) {
  document.getElementById('agent-auth-view').style.display = 'none';
  document.getElementById('agent-main-dashboard').style.display = 'flex';
  document.getElementById('logged-agent-name').innerText = profile.name;
  document.getElementById('logged-agent-role').innerText = profile.role;

  fleetEnsureAllocations(); // reservas antigas sem placa ganham uma (ou vão para Agent Requests)
  // Conceito "Anna inside the RCM": botão flutuante Ask Anna (js/gc-anna.js), só para agentes logados
  if (typeof annaInitAsk === 'function') annaInitAsk();
  checkUnavailableSimulation();
  loadUpcomingBookings();
  loadGlobalBookingStatus();

  // Force Live Chat to refresh with the new agent name if the module exists
  if (typeof renderLiveChatModule === 'function') {
    renderLiveChatModule();
  }

  // Perfis salvos antes desta versão não têm access: completa pelo usuário conhecido
  const known = Object.values(validAgents).find(a => a.name === profile.name);
  if (known && !profile.access) Object.assign(profile, { access: known.access });
  if (!profile.username) profile.username = Object.keys(validAgents).find(u => validAgents[u].name === profile.name);
  applyAgentAccess(profile);

  // Link vindo do Damage Control: #payments ou #payments:<planId>
  if (window.location.hash.startsWith('#payments')) {
    const link = document.querySelector('.menu-item[onclick*="module-payments"]');
    switchModule('module-payments', link, 'Payment Plans');
    const planId = window.location.hash.split(':')[1];
    if (planId && typeof ppOpenDetails === 'function') ppOpenDetails(decodeURIComponent(planId));
  } else if (window.location.hash.startsWith('#whatsapp:') && openWhatsAppFromHash()) {
    // Link do popup da reserva: conversa do cliente no inbox do WhatsApp
  } else if (window.location.hash.startsWith('#bond:') && openBondFromHash()) {
    // Link do Damage Control: extrato de uma reserva devolvida no Bond Refunds
  } else if (openModuleFromHash()) {
    // Veio do menu de outra tela do RCM (js/gc-rcm-shell.js)
  } else {
    // Todos os perfis abrem no Today's Overview (ignora "home" de perfis salvos antes)
    const link = document.querySelector(`.menu-item[onclick*="${DEFAULT_HOME}"]`);
    switchModule(DEFAULT_HOME, link, MODULE_TITLES[DEFAULT_HOME]);
  }
}

// agent-dashboard.html#whatsapp:<dígitos>:<bookingId> → WhatsApp na conversa desse cliente
function openWhatsAppFromHash() {
  const [digits, bookingId] = window.location.hash.slice('#whatsapp:'.length).split(':').map(decodeURIComponent);
  if (typeof waOpenConversation !== 'function') return false;
  if (window.history && history.replaceState) history.replaceState(null, '', window.location.pathname + window.location.search);
  return waOpenConversation(digits, bookingId);
}

// agent-dashboard.html#bond:<id> → Bond Refunds com o extrato da reserva aberto (se o perfil tem acesso)
function openBondFromHash() {
  const id = decodeURIComponent(window.location.hash.slice('#bond:'.length));
  const link = document.querySelector(`.menu-item[onclick*="'module-bonds'"]`);
  if (!link || link.hidden || typeof bnOpenLedger !== 'function') return false;
  if (window.history && history.replaceState) history.replaceState(null, '', window.location.pathname + window.location.search);
  switchModule('module-bonds', link, MODULE_TITLES['module-bonds'] || 'Bond Refunds');
  if (typeof bondGetRecord === 'function' && bondGetRecord(id)) bnOpenLedger(id);
  return true;
}

// Links do menu das telas avulsas: agent-dashboard.html#module-x ou #module-placeholder=Título
// Devolve true se abriu um módulo (e o perfil tem acesso a ele)
function openModuleFromHash() {
  const raw = window.location.hash.slice(1);
  if (!raw.startsWith('module-')) return false;
  const [moduleId, titleParam] = raw.split('=');
  if (!document.getElementById(moduleId)) return false;

  const links = Array.from(document.querySelectorAll(`.menu-item[onclick*="'${moduleId}'"]`));
  const title = titleParam ? decodeURIComponent(titleParam) : (MODULE_TITLES[moduleId] || '');
  const link = links.find(a => !titleParam || (a.getAttribute('onclick') || '').includes(`'${title.replace(/'/g, "\\'")}'`)) || links[0] || null;
  if (link && link.hidden) return false; // sem acesso (ex.: Bond Refunds)

  // Tira o hash da URL para um F5 não repetir a navegação
  if (window.history && history.replaceState) history.replaceState(null, '', window.location.pathname + window.location.search);
  switchModule(moduleId, link, title);
  return true;
}

async function agentLogout() {
  if (await gcConfirm({ title: 'Log out?', message: 'You will need to sign in again to use the dashboard.', confirmText: 'Log out', kind: 'info' })) {
    // Clear Main Dashboard Auth
    sessionStorage.removeItem(AGENT_AUTH_KEY);
    sessionStorage.removeItem(AGENT_PROFILE_KEY);
    sessionStorage.removeItem('gc_agent_name');
    localStorage.removeItem(AGENT_PROFILE_KEY);
    
    // Clear Live Chat Agent Name
    localStorage.removeItem('gc_agent_name'); 
    localStorage.removeItem('gc_agent_role');

    document.getElementById('agent-auth-view').style.display = 'block';
    document.getElementById('agent-main-dashboard').style.display = 'none';
    ['anna-fab', 'anna-panel'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });

    const loginForm = document.getElementById('agent-login-form');
    if(loginForm) loginForm.reset();
  }
}

function switchAgentTab(tab) {
  document.getElementById('tab-alerts').classList.toggle('active', tab === 'alerts');
  document.getElementById('tab-upcoming').classList.toggle('active', tab === 'upcoming');
  document.getElementById('tab-status').classList.toggle('active', tab === 'status');

  document.getElementById('view-alerts').classList.toggle('active', tab === 'alerts');
  document.getElementById('view-upcoming').classList.toggle('active', tab === 'upcoming');
  document.getElementById('view-status').classList.toggle('active', tab === 'status');

  if (tab === 'status') {
    loadGlobalBookingStatus();
  } else if (tab === 'upcoming') {
    loadUpcomingBookings();
  } else if (tab === 'alerts') {
    checkUnavailableSimulation();
  }
}

// Aba "Allocate Reservations" (antigo "Active Fleet Alerts") — js/gc-allocation.js
function checkUnavailableSimulation() {
  if (typeof renderAllocationTable === 'function') renderAllocationTable();
}

let allUpcomingBookingsCache = [];

function loadUpcomingBookings() {
  let allBookings = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (key.startsWith('gc_multi_bookings_')) {
      const email = key.replace('gc_multi_bookings_', '');
      const userBookings = JSON.parse(localStorage.getItem(key) || '[]');
      userBookings.forEach(booking => {
        allBookings.push({ ...booking, clientEmail: email, isMain: false, sortId: booking.id });
      });
    }

    if (key.startsWith('gc_booking_poc_')) {
      const email = key.replace('gc_booking_poc_', '');
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      if (state && Object.keys(state).length > 0) {
        let splitDate = '26 Sep 2026';
        let splitTime = '08:30 AM';
        if (state.pickupTime && state.pickupTime.includes(',')) {
            splitDate = state.pickupTime.split(',')[0].trim();
            splitTime = state.pickupTime.split(',')[1].trim();
        }

        allBookings.push({
          id: 'main-' + email,
          sortId: 9999999999999,
          ref: 'GC-8832',
          clientEmail: email,
          vehicle: 'Auto Pantech Truck (Long)+Lift',
          loc: 'Sydney - Mascot',
          dropoff: 'Sydney - Mascot',
          date: splitDate,
          time: splitTime,
          status: state.status,
          requestedTime: state.requestedTime, 
          isMain: true
        });
      }
    }
  }

  allBookings.sort((a, b) => b.sortId - a.sortId);
  allUpcomingBookingsCache = allBookings;
  renderUpcomingTable(allBookings);
}

function applyDateFilter() {
  const fromVal = document.getElementById('filter-date-from')?.value;
  const toVal = document.getElementById('filter-date-to')?.value;
  let filtered = allUpcomingBookingsCache;

  if (fromVal || toVal) {
    filtered = allUpcomingBookingsCache.filter(b => {
      if (!b.date) return true;
      const bDate = new Date(b.date).toISOString().split('T')[0];
      if (fromVal && bDate < fromVal) return false;
      if (toVal && bDate > toVal) return false;
      return true;
    });
  }
  renderUpcomingTable(filtered);
}

function clearDateFilter() {
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value = '';
  renderUpcomingTable(allUpcomingBookingsCache);
}

function renderUpcomingTable(allBookings) {
  const container = document.getElementById('upcoming-container');
  if (!container) return;
  container.innerHTML = '';

  if (!allBookings || allBookings.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No bookings found for this period.</p>';
    return;
  }

  let tableHTML = `
    <div class="data-table-container">
      <table class="gc-data-table">
        <thead>
          <tr>
            <th>Ref.</th>
            <th>Type</th>
            <th>Client Email</th>
            <th>Category / Vehicle</th>
            <th>Pickup Loc.</th>
            <th>Pickup Schedule</th>
            <th>Dropoff Loc.</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
  `;

  allBookings.forEach((b) => {
    const locStr = b.loc || '';
    const dropoffStr = b.dropoff && b.dropoff !== 'Same as Pick up' ? b.dropoff : locStr;
    const vehicleStr = b.vehicle || 'Standard Vehicle';
    const shortPickup = locStr.includes(' - ') ? locStr.split(' - ')[1] : locStr;
    const shortDropoff = dropoffStr.includes(' - ') ? dropoffStr.split(' - ')[1] : dropoffStr;
    const shortVehicle = vehicleStr.includes('(') ? vehicleStr.split('(')[0].trim() : vehicleStr;

    let statusBadge = '<span class="table-badge confirmed">Confirmed</span>';
    let actionBtn = '<button class="table-btn">Update</button>';
    let timeHtml = `${b.date || 'N/A'}<br><span style="font-size: 11px; color: #94a3b8;">${b.time || ''}</span>`;

    if (b.status === 'pending') {
      statusBadge = '<span class="table-badge pending">Pending</span>';
      actionBtn = `<button class="table-btn" style="background: #f59e0b;" onclick="approveTimeChange('${b.id}', '${b.clientEmail}', ${b.isMain})">Approve Change</button>`;
      
      let reqDate = b.requestedDate || b.date;
      let reqTime = b.requestedTime || '';
      
      if (b.isMain && b.requestedTime && b.requestedTime.includes(',')) {
        reqDate = b.requestedTime.split(',')[0].trim();
        reqTime = b.requestedTime.split(',')[1].trim();
      }

      timeHtml = `
        <span style="text-decoration: line-through; color: #94a3b8; font-size: 12px;">${b.date} ${b.time}</span><br>
        <span style="color: #f59e0b; font-weight: 700;">Req: ${reqDate} ${reqTime}</span>
      `;
    } 
    else if (b.status === 'fleet_pending') {
      statusBadge = '<span class="table-badge pending">Fleet Check</span>';
      actionBtn = `<button class="table-btn" style="background: #f59e0b;" onclick="switchAgentTab('alerts')">Review Alert</button>`;
    }
    else if (b.status === 'proposal_sent') {
      statusBadge = '<span class="table-badge" style="background: #fef3c7; color: #92400e;">Wait Client</span>';
    } 
    else if (b.status === 'updated') {
      statusBadge = '<span class="table-badge" style="background: #dcfce7; color: #166534;">Updated</span>';
    } 
    else if (b.status === 'cancelled') {
      statusBadge = '<span class="table-badge" style="background: #fee2e2; color: #991b1b;">Cancelled</span>';
      actionBtn = `<button class="table-btn" disabled style="background: #334155; opacity: 0.5;">Update</button>`;
    }

    tableHTML += `
      <tr>
        <td style="color: #60a5fa; font-weight: 600;">${b.ref || 'N/A'}</td>
        <td>Online</td>
        <td>${b.clientEmail || 'N/A'}</td>
        <td style="font-weight: 600;">${shortVehicle}</td>
        <td>${shortPickup || 'N/A'}</td>
        <td style="font-weight: 600; line-height: 1.4;">${timeHtml}</td>
        <td>${shortDropoff || 'N/A'}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-flex">
            ${actionBtn}
          </div>
        </td>
      </tr>
    `;
  });

  tableHTML += `
        </tbody>
      </table>
    </div>
    <div style="margin-top: 15px; font-size: 12px; color: var(--text-muted); text-align: right;">
      Showing ${allBookings.length} entries
    </div>
  `;
  container.innerHTML = tableHTML;
}

window.approveTimeChange = function(id, email, isMain) {
  const activeAgent = JSON.parse(localStorage.getItem(AGENT_PROFILE_KEY));

  if (isMain) {
    const key = 'gc_booking_poc_' + email;
    const state = JSON.parse(localStorage.getItem(key));
    if (state) {
      state.status = 'updated';
      state.pickupTime = state.requestedTime || state.pickupTime;
      state.requestedTime = null;
      state.handledBy = activeAgent ? activeAgent.name : 'Agent';
      localStorage.setItem(key, JSON.stringify(state));
    }
  } else {
    const bookingsKey = 'gc_multi_bookings_' + email;
    let bookingsArray = JSON.parse(localStorage.getItem(bookingsKey) || '[]');
    let b = bookingsArray.find(x => String(x.id) === String(id));
    if (b) {
      // Novo horário mantendo a duração; tenta a mesma placa, senão outra do mesmo modelo
      const oldRange = fleetBookingRange(b);
      const newStart = fleetParseDate(`${b.requestedDate || b.date} ${b.requestedTime || b.time}`);
      const newEnd = newStart + (oldRange.end - oldRange.start);
      const plate = fleetFindFreePlate(b.vehicle, newStart, newEnd, { preferredPlate: b.plate, ignoreId: b.id });
      if (!plate) {
        gcToast(`Cannot approve: no "${b.vehicle}" is available for ${b.requestedDate} ${b.requestedTime}.\n\nContact the customer to offer a different time or vehicle.`, 'error');
        return;
      }
      b.plate = plate;
      fleetApplyRange(b, newStart, newEnd);
      b.status = 'updated';
      b.requestedDate = null;
      b.requestedTime = null;
      b.handledBy = activeAgent ? activeAgent.name : 'Agent';
      localStorage.setItem(bookingsKey, JSON.stringify(bookingsArray));
    }
  }

  gcToast("Time change approved\n\nThe customer's My Bookings page now shows the new schedule.");
  loadUpcomingBookings();
  if (document.getElementById('tab-status').classList.contains('active')) {
    loadGlobalBookingStatus();
  }
};

// =========================================
// GESTÃO DE STATUS GLOBAL (COM FILTROS)
// =========================================

// Variável global para guardar o filtro atual
window.currentHistoryFilter = window.currentHistoryFilter || 'all';

// Função chamada quando um agente clica numa das tags de filtro
window.setHistoryFilter = function(filter) {
  window.currentHistoryFilter = filter;
  loadGlobalBookingStatus();
};

function loadGlobalBookingStatus() {
  const container = document.getElementById('history-container');
  if (!container) return;
  
  let allHistory = [];

  // Recolher todas as reservas armazenadas (Principal e Dinâmicas)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (key.startsWith('gc_booking_poc_')) {
      const email = key.replace('gc_booking_poc_', '');
      const state = JSON.parse(localStorage.getItem(key) || '{}');
      if (Object.keys(state).length > 0) {
          allHistory.push({
            isMain: true,
            email: email,
            ref: 'GC-8832',
            vehicle: 'Auto Pantech Truck (Long)+Lift',
            status: state.status,
            handledBy: state.handledBy,
            schedule: state.requestedTime || state.pickupTime || 'N/A'
          });
      }
    }

    if (key.startsWith('gc_multi_bookings_')) {
      const email = key.replace('gc_multi_bookings_', '');
      const bookingsArray = JSON.parse(localStorage.getItem(key) || '[]');
      
      bookingsArray.forEach(b => {
        allHistory.push({
          isMain: false,
          email: email,
          ref: b.ref,
          vehicle: b.vehicle,
          status: b.status,
          handledBy: b.handledBy || (b.proposal && b.proposal.handledBy ? b.proposal.handledBy : null),
          schedule: `${b.requestedDate || b.date} ${b.requestedTime || b.time}`
        });
      });
    }
  }

  // Gera o HTML da Barra de Filtros
  let html = `
    <div style="display: flex; gap: 10px; margin-bottom: 20px; overflow-x: auto; border-bottom: 1px solid #334155; padding-bottom: 15px;">
      <button class="btn ${window.currentHistoryFilter === 'all' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('all')">All Records</button>
      <button class="btn ${window.currentHistoryFilter === 'confirmed' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('confirmed')">Confirmed</button>
      <button class="btn ${window.currentHistoryFilter === 'pending' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('pending')">Pending Action</button>
      <button class="btn ${window.currentHistoryFilter === 'waiting' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('waiting')">Waiting Client ⏳</button>
      <button class="btn ${window.currentHistoryFilter === 'updated' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('updated')">Approved & Updated ✅</button>
      <button class="btn ${window.currentHistoryFilter === 'cancelled' ? 'btn-primary' : 'btn-outline'}" style="font-size: 12px; padding: 6px 14px; border-radius: 20px;" onclick="setHistoryFilter('cancelled')">Cancelled</button>
    </div>
  `;

  let cardsHtml = '';
  let visibleCount = 0;

  allHistory.sort((a, b) => (b.ref > a.ref ? 1 : -1));

  allHistory.forEach(b => {
    let group = 'confirmed';
    if (b.status === 'pending' || b.status === 'fleet_pending') group = 'pending';
    else if (b.status === 'proposal_sent') group = 'waiting';
    else if (b.status === 'updated') group = 'updated';
    else if (b.status === 'cancelled') group = 'cancelled';

    if (window.currentHistoryFilter !== 'all' && window.currentHistoryFilter !== group) {
      return; 
    }

    visibleCount++;

    let statusHtml = '';
    if (b.status === 'confirmed') statusHtml = '<span class="status-badge bg-confirmed">Confirmed</span>';
    else if (b.status === 'pending' || b.status === 'fleet_pending') statusHtml = '<span class="status-badge bg-pending">Pending Agent Action</span>';
    else if (b.status === 'proposal_sent') statusHtml = '<span class="status-badge bg-waiting">Waiting Client Response ⏳</span>';
    else if (b.status === 'updated') statusHtml = '<span class="status-badge bg-approved">Approved & Updated ✅</span>';
    else if (b.status === 'cancelled') statusHtml = '<span class="status-badge" style="background: #fee2e2; color: #991b1b;">Cancelled</span>';

    const agentHandler = group === 'pending' ? 'Pending Assignment' : (b.handledBy || (group === 'confirmed' ? 'Auto-Confirmed' : 'System'));
    const mainBadge = b.isMain ? `<span style="font-size: 10px; background: #334155; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">MAIN BOOKING</span>` : '';

    cardsHtml += `
      <div class="request-card" style="border: 1px solid #334155; margin-bottom: 12px;">
        <div class="req-header" style="background: transparent;">
          <span>Client Email: <strong>${b.email}</strong> ${mainBadge}</span>
          ${statusHtml}
        </div>
        <div class="req-body" style="background: #0f172a; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #334155;">
          <div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Ref: ${b.ref}</div>
            <div style="font-weight: 600;">${b.vehicle}</div>
            <div style="font-size: 11px; color: var(--gc-brand); margin-top: 6px; text-transform: uppercase;">Handled By: ${agentHandler}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Schedule</div>
            <div style="color: var(--success); font-weight: 600;">${b.schedule}</div>
          </div>
        </div>
      </div>
    `;
  });

  if (visibleCount === 0) {
    cardsHtml = `<p style="color: var(--text-muted); font-style: italic; padding: 10px;">No bookings found for the filter "${window.currentHistoryFilter}".</p>`;
  }

  container.innerHTML = html + cardsHtml;
}

function switchModule(moduleId, linkElement, title) {
  document.querySelectorAll('.app-module').forEach(module => {
    module.classList.remove('active');
  });
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
  });

  const targetModule = document.getElementById(moduleId);
  if (targetModule) targetModule.classList.add('active');

  if (linkElement) linkElement.classList.add('active');
  const headerTitle = document.getElementById('top-header-title');
  if (title && headerTitle) headerTitle.innerText = title;

  checkUnavailableSimulation();
  loadUpcomingBookings();
  loadGlobalBookingStatus();
  
  // Update Live Chat module automatically if it exists
  if (moduleId === 'module-livechat' && typeof renderLiveChatModule === 'function') {
    renderLiveChatModule();
  }

  // Payment Plans e Allocate Reservation precisam de mais largura para as tabelas
  const container = document.querySelector('.agent-container');
  if (container) container.classList.toggle('wide', ['module-payments', 'module-agent-requests', 'module-analytics', 'module-executive', 'module-bonds', 'module-dashboard', 'module-3cx', 'module-whatsapp'].includes(moduleId));
  if (moduleId === 'module-3cx' && typeof render3cxModule === 'function') render3cxModule();
  if (moduleId === 'module-whatsapp' && typeof renderWhatsAppModule === 'function') renderWhatsAppModule();
  if (moduleId === 'module-dashboard' && typeof renderOverviewModule === 'function') renderOverviewModule();
  if (moduleId === 'module-payments' && typeof renderPaymentsModule === 'function') {
    renderPaymentsModule();
  }
  if (moduleId === 'module-analytics' && typeof renderAnalytics === 'function') renderAnalytics();
  if (moduleId === 'module-executive' && typeof renderExecutive === 'function') renderExecutive();
  if (moduleId === 'module-bonds' && typeof renderBondsModule === 'function') renderBondsModule();
  // Módulos ainda não construídos: tela vazia só com o nome do módulo
  if (moduleId === 'module-placeholder') {
    const placeholderTitle = document.getElementById('placeholder-title');
    if (placeholderTitle) placeholderTitle.textContent = title || 'Module';
  }
}

window.addEventListener('storage', (e) => {
  if (e.key && (e.key.startsWith('gc_booking_poc') || e.key.startsWith('gc_multi_bookings') || e.key === 'gc_unavailable_requests')) {
    checkUnavailableSimulation();
    loadUpcomingBookings();
    loadGlobalBookingStatus();
  }
});
