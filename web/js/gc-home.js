// ==========================================
// GC TECH HOME — site público do cliente
// Depende de: gc-fleet-data.js (frota/filiais/disponibilidade),
//             gc-chat.js (openCustomerChat) e flatpickr (CDN).
// Funções com prefixo "home" para não colidir com os outros scripts.
// ==========================================

// Abas, rótulos de filial e horários vêm de gc-fleet-data.js (compartilhados com Search Results)
const HOME_TABS = FLEET_WEB_TABS;

let homeActiveTab = 'Cars';
let homeFleetFilter = 'All';
let homePickupPicker = null;
let homeDropoffPicker = null;

// ---------- Helpers ----------
function homeIsLoggedIn() {
  return sessionStorage.getItem('gc_auth_poc') === 'true';
}

function homeGetProfile() {
  try { return JSON.parse(localStorage.getItem('gc_user_profile')); } catch (e) { return null; }
}

// ---------- Widget ----------
function homeRenderTabs() {
  document.getElementById('widget-tabs').innerHTML = HOME_TABS.map(t => `
    <button type="button" class="w-tab ${t.id === homeActiveTab ? 'active' : ''}" onclick="homeSelectTab('${t.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      ${t.id}
    </button>
  `).join('');
}

function homeSelectTab(tabId) {
  homeActiveTab = tabId;
  homeRenderTabs();
}

function homeInitWidget() {
  homeRenderTabs();

  const branchOptions = Object.values(FLEET_BRANCHES)
    .map(name => `<option value="${name}">${fleetBranchLabel(name)}</option>`).join('');
  document.getElementById('hw-pickup-loc').innerHTML = branchOptions;
  document.getElementById('hw-pickup-loc').value = 'Sydney - Mascot';
  document.getElementById('hw-dropoff-loc').innerHTML = `<option value="Same as Pick up"></option>` + branchOptions;
  homeSyncDropoffLabel();

  document.getElementById('hw-pickup-time').innerHTML = fleetTimeOptions('08:30 AM');
  document.getElementById('hw-dropoff-time').innerHTML = fleetTimeOptions('08:30 AM');

  // Padrão: amanhã → depois de amanhã (evita já abrir com "pick-up must be in the future")
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);

  const common = { dateFormat: 'd M Y', minDate: 'today', disableMobile: true };
  homePickupPicker = flatpickr('#hw-pickup-date', {
    ...common,
    defaultDate: tomorrow,
    onChange: (dates) => {
      if (!dates[0]) return;
      homeDropoffPicker.set('minDate', dates[0]);
      if (homeDropoffPicker.selectedDates[0] && homeDropoffPicker.selectedDates[0] < dates[0]) {
        const next = new Date(dates[0]); next.setDate(next.getDate() + 1);
        homeDropoffPicker.setDate(next);
      }
      homeUpdateDuration();
    }
  });
  homeDropoffPicker = flatpickr('#hw-dropoff-date', { ...common, defaultDate: dayAfter, onChange: homeUpdateDuration });

  ['hw-pickup-time', 'hw-dropoff-time'].forEach(id => document.getElementById(id).addEventListener('change', homeUpdateDuration));
  homeUpdateDuration();
}

// A opção "mesmo local" mostra o nome da filial de retirada, como no site oficial
function homeSyncDropoffLabel() {
  const pickup = document.getElementById('hw-pickup-loc').value;
  document.querySelector('#hw-dropoff-loc option[value="Same as Pick up"]').textContent = fleetBranchLabel(pickup);
  // Sem one-way entre Sydney e Brisbane: filiais da outra cidade ficam indisponíveis
  fleetRestrictDropoffSelect(document.getElementById('hw-dropoff-loc'), pickup);
}

// Botão ⇄: troca retirada e devolução (ou abre a lista de devolução se ainda for "mesmo local")
function homeToggleDifferentReturn() {
  const pickup = document.getElementById('hw-pickup-loc');
  const dropoff = document.getElementById('hw-dropoff-loc');
  if (dropoff.value === 'Same as Pick up') {
    dropoff.focus();
    if (dropoff.showPicker) { try { dropoff.showPicker(); } catch (e) {} }
    return;
  }
  const tmp = pickup.value;
  pickup.value = dropoff.value;
  homeSyncDropoffLabel(); // libera as opções da nova cidade antes de trocar
  dropoff.value = tmp === dropoff.value ? 'Same as Pick up' : tmp;
  homeSyncDropoffLabel();
}

function homeReadRange() {
  const start = fleetParseDate(`${document.getElementById('hw-pickup-date').value} ${document.getElementById('hw-pickup-time').value}`);
  const end = fleetParseDate(`${document.getElementById('hw-dropoff-date').value} ${document.getElementById('hw-dropoff-time').value}`);
  return { start, end };
}

function homeUpdateDuration() {
  const { start, end } = homeReadRange();
  const el = document.getElementById('hw-duration');
  if (isNaN(start) || isNaN(end) || end <= start) { el.textContent = ''; return; }
  const days = Math.ceil((end - start) / FLEET_DAY_MS);
  el.textContent = `${days} day${days > 1 ? 's' : ''} hire`;
}

function homeSubmitSearch() {
  const errorEl = document.getElementById('hw-error');
  document.querySelectorAll('.of-field.invalid').forEach(f => f.classList.remove('invalid'));
  errorEl.textContent = '';

  const { start, end } = homeReadRange();
  const markInvalid = ids => ids.forEach(id => document.getElementById(id).closest('.of-field').classList.add('invalid'));

  if (isNaN(start) || start <= Date.now()) {
    markInvalid(['hw-pickup-date', 'hw-pickup-time']);
    errorEl.textContent = 'Pick-up time must be in the future.';
    return;
  }
  if (isNaN(end) || end <= start) {
    markInvalid(['hw-dropoff-date', 'hw-dropoff-time']);
    errorEl.textContent = 'Drop-off must be after pick-up.';
    return;
  }
  if (!fleetOneWayAllowed(document.getElementById('hw-pickup-loc').value, document.getElementById('hw-dropoff-loc').value)) {
    markInvalid(['hw-dropoff-loc']);
    errorEl.textContent = FLEET_ONE_WAY_MESSAGE;
    return;
  }

  // Mesmo formato que search-results.html e customer-portal.html já leem
  localStorage.setItem('gc_pending_search', JSON.stringify({
    vehicle: homeActiveTab,
    loc: document.getElementById('hw-pickup-loc').value,
    dropoff: document.getElementById('hw-dropoff-loc').value,
    date: document.getElementById('hw-pickup-date').value,
    time: document.getElementById('hw-pickup-time').value,
    dropoffDate: document.getElementById('hw-dropoff-date').value,
    dropoffTime: document.getElementById('hw-dropoff-time').value
  }));
  window.location.href = 'search-results.html';
}

function homeScrollToWidget() {
  document.getElementById('booking-widget').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- Frota ----------
function homeRenderFleetFilters() {
  const filters = ['All', ...HOME_TABS.map(t => t.id), 'Hybrid'];
  document.getElementById('fleet-filters').innerHTML = filters.map(f =>
    `<button class="chip ${f === homeFleetFilter ? 'active' : ''}" onclick="homeFilterFleet('${f}')">${f === 'Hybrid' ? '🌿 Hybrid' : f}</button>`
  ).join('');
}

function homeFilterFleet(filter) {
  homeFleetFilter = filter;
  homeRenderFleetFilters();
  homeRenderFleet();
}

function homeRenderFleet() {
  // Disponibilidade REAL das próximas 24h, a partir da mesma ocupação que o Fleet Planner usa
  const occ = fleetGetOccupancy();
  const now = Date.now();
  const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  const cats = FLEET_CATEGORIES.filter(c =>
    homeFleetFilter === 'All' || c.tab === homeFleetFilter || (homeFleetFilter === 'Hybrid' && c.fuel === 'Hybrid'));

  document.getElementById('fleet-grid').innerHTML = cats.map(c => {
    const vehicles = FLEET_VEHICLES.filter(v => v.categoryId === c.id);
    const free = vehicles.filter(v => fleetIsPlateFree(v.plate, now, now + FLEET_DAY_MS, null, occ)).length;
    const availTag = free === 0 ? `<span class="avail-tag none">Booked out today</span>`
                   : free <= 2 ? `<span class="avail-tag">Only ${free} left today</span>` : '';
    return `
      <article class="fleet-card">
        <div class="fleet-img">
          <span class="fuel-tag ${c.fuel === 'Hybrid' ? 'hybrid' : ''}">${c.fuel}</span>
          ${availTag}
          <img src="../assets/img/${c.img}" alt="${c.model}" loading="lazy">
        </div>
        <div class="fleet-body">
          <span class="fleet-type">${titleCase(c.name)}</span>
          <span class="fleet-name">${c.model}</span>
          <span class="fleet-desc">${c.desc}</span>
          <div class="fleet-meta"><span>👤 ${c.seats} seats</span><span>⚙️ Auto</span></div>
          <div class="fleet-foot">
            <span class="fleet-price">From <strong>$${c.rate.toFixed(2)}</strong>/day</span>
            <button class="btn-brand" onclick="homeBookCategory('${c.tab}')">Book</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function homeBookCategory(tab) {
  homeSelectTab(tab);
  homeScrollToWidget();
}

// ---------- Filiais ----------
function homeRenderLocations() {
  document.getElementById('locations-grid').innerHTML = Object.entries(FLEET_BRANCHES).map(([code, name]) => {
    const [city, suburb] = name.split(' - ');
    const count = FLEET_VEHICLES.filter(v => v.branch === code).length;
    return `
      <div class="location-card">
        <span class="location-city">${city}</span>
        <span class="location-name">${suburb}</span>
        <span class="location-meta">${count} vehicles based here</span>
        <button onclick="homePickBranch('${name}')">Book from ${suburb} →</button>
      </div>
    `;
  }).join('');
}

function homePickBranch(name) {
  document.getElementById('hw-pickup-loc').value = name;
  homeSyncDropoffLabel();
  homeScrollToWidget();
}

// ---------- Menus do header ----------
function homeRenderNavMenus() {
  document.getElementById('nav-vehicles-menu').innerHTML = HOME_TABS.map(t => {
    const n = FLEET_CATEGORIES.filter(c => c.tab === t.id).length;
    return `<a href="#fleet" onclick="homeFilterFleet('${t.id}')">${t.id} <small>${n} model${n > 1 ? 's' : ''}</small></a>`;
  }).join('') + `<a href="#fleet" onclick="homeFilterFleet('Hybrid')">🌿 Hybrid range</a>`;

  document.getElementById('nav-locations-menu').innerHTML = Object.values(FLEET_BRANCHES).map(name =>
    `<a href="#" onclick="event.preventDefault(); homePickBranch('${name}')">${fleetBranchLabel(name)}</a>`
  ).join('');
}

function homeRenderAccountButton() {
  const profile = homeGetProfile();
  const btn = document.getElementById('header-account-btn');
  if (homeIsLoggedIn() && profile && profile.name) {
    btn.textContent = `👤 ${profile.name.split(' ')[0]} · My Bookings`;
  }
}

// ---------- Chat ----------
// Logado → seleção de reservas; visitante → modal de nome/e-mail (gc-chat.js)
function homeOpenChat() {
  openCustomerChatWithPrompt();
}

// ---------- Init ----------
window.addEventListener('scroll', () => {
  document.getElementById('site-header').classList.toggle('scrolled', window.scrollY > 40);
});

window.addEventListener('DOMContentLoaded', () => {
  homeInitWidget();
  homeRenderFleetFilters();
  homeRenderFleet();
  homeRenderLocations();
  homeRenderNavMenus();
  homeRenderAccountButton();
  document.getElementById('footer-year').textContent = new Date().getFullYear();
});
