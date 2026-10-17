// ==========================================
// GC TECH ANALYTICS — DADOS
// Base dos dashboards "Reports & Analytics" (analista) e "Executive Overview" (dono).
//
// ⚠️ HISTÓRICO SIMULADO: o protótipo tem poucas reservas reais, então geramos
// 12 meses de locações concluídas de forma DETERMINÍSTICA (sempre os mesmos
// números), usando a frota, preços, excess e horários reais de gc-fleet-data.js.
// Nada disso é gravado no localStorage. As reservas reais (portal, checkout,
// Add Booking, planner) são somadas por cima com live: true.
// ==========================================

const AN_MONTH_SEASON = [1.35, 1.15, 1.0, 1.05, 0.85, 0.8, 0.9, 0.85, 0.95, 1.05, 1.15, 1.4]; // verão australiano em Dez/Jan
const AN_BRANCH_WEIGHTS = { PAR: 25, MAS: 25, BLK: 14, NSY: 10, EGF: 16, WGB: 10 };
const AN_SOURCE_WEIGHTS = { 'Google Search': 34, 'Direct Website': 21, 'Repeat Customer': 18, 'Google Maps': 10, 'Word of Mouth': 9, 'Facebook / Instagram': 8 };
const AN_CATEGORY_WEIGHTS = {
  'small-auto': 14, 'small-new': 8, 'small-hybrid': 8, 'mid-hatch': 7, 'mid-sedan': 6, 'full-car': 6,
  'mid-suv': 6, 'cross-suv': 7, 'mid-7seat': 7, 'full-7seat': 4, 'eight-seat': 4,
  'hiace-1t': 7, 'hiace-15t': 4, 'pantech': 6, 'hilux-auto': 4, 'hilux-diesel': 3
};
const AN_LEAD_BANDS = [[0, 0], [1, 3], [4, 7], [8, 14], [15, 30], [31, 60]];

// Janela em que o custo de dano vem do Damage Control (o histórico simulado não inventa danos nela)
const AN_REAL_DAMAGE_DAYS = 60;

let anHistoryCache = null;

function anStartOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function anBranchCode(loc) {
  return Object.keys(FLEET_BRANCHES).find(k => FLEET_BRANCHES[k] === loc) || 'MAS';
}

function anBuildHistory() {
  if (anHistoryCache) return anHistoryCache;
  let seed = 4242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = weights => {
    const entries = Object.entries(weights);
    let r = rand() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
    return entries[entries.length - 1][0];
  };

  const today0 = anStartOfDay(Date.now());
  const records = [];
  let n = 0;
  for (let back = 365; back >= 1; back--) {
    const day = new Date(today0);
    day.setDate(day.getDate() - back);
    const dow = day.getDay();
    const factor = AN_MONTH_SEASON[day.getMonth()] * (dow === 5 || dow === 6 ? 1.12 : dow === 0 ? 0.78 : 1);
    const count = Math.max(8, Math.round(30 * factor + (rand() - 0.5) * 10));

    for (let i = 0; i < count; i++) {
      const cat = fleetGetCategory(pick(AN_CATEGORY_WEIGHTS));
      const commercial = cat.section === 'Commercial';
      const start = new Date(day);
      start.setHours(8, Math.floor(rand() * 38) * 15, 0, 0); // 08:00–17:15 a cada 15 min
      const days = commercial ? 1 + Math.floor(Math.pow(rand(), 2) * 4) : 1 + Math.floor(Math.pow(rand(), 1.6) * 9);
      const [lo, hi] = AN_LEAD_BANDS[Number(pick({ 0: 10, 1: 22, 2: 25, 3: 20, 4: 15, 5: 8 }))];
      const cancelled = rand() < 0.07;
      const excessReduction = !cancelled && rand() < (commercial ? 0.55 : 0.42);
      const extras = !cancelled && rand() < 0.15 ? 5.5 * days : 0;
      const damage = !cancelled && rand() < 0.035;
      const revenue = cancelled ? 0 : cat.rate * days + (excessReduction ? cat.excess.reducedPerDay * days : 0) + extras;

      records.push({
        ref: 'H' + (100000 + n++),
        start: start.getTime(),
        end: start.getTime() + days * FLEET_DAY_MS,
        days, categoryId: cat.id, section: cat.section,
        branch: pick(AN_BRANCH_WEIGHTS),
        source: pick(AN_SOURCE_WEIGHTS),
        revenue: Math.round(revenue * 100) / 100,
        excessReduction, extras, cancelled, damage,
        damageCost: damage ? 250 + Math.round(rand() * 2950) : 0,
        leadDays: lo + Math.floor(rand() * (hi - lo + 1)),
        live: false
      });
      // Danos dos últimos 60 dias vêm dos relatórios reais do Damage Control (anLiveRecords).
      // Os sorteios acima continuam iguais, para o resto do histórico não mudar.
      if (back <= AN_REAL_DAMAGE_DAYS) Object.assign(records[records.length - 1], { damage: false, damageCost: 0 });
    }
  }
  anHistoryCache = records;
  return records;
}

// Conta como locação (receita, reservas, utilização)? Cancelada, manutenção e pedido
// ainda sem veículo (Agent Requests / oferta enviada) ficam de fora.
function anCounts(r) {
  return !r.cancelled && !r.pending && r.type !== 'maintenance';
}

// Receita da reserva: taxas do Booking Fees quando existem (inclui extensão e extras),
// senão o total pago no site, senão diária × dias. Caução e devolução de caução não são receita.
function anRevenueOf(b, cat, days) {
  if (b.fees && typeof feeCalc === 'function') {
    try {
      const calc = feeCalc(b.fees, cat, days);
      return calc.lines.reduce((s, l) => {
        const item = l.id && typeof feeGetItem === 'function' ? feeGetItem(l.id) : null;
        return item && (item.bond || item.refund) ? s : s + l.total;
      }, 0);
    } catch (e) {}
  }
  return b.priceTotal || cat.rate * days;
}

// Reservas reais do sistema (demo do planner + portal/checkout/Add Booking + GC-8832).
// Lido na hora: reserva nova, alteração ou cancelamento entra no próximo desenho da tela.
function anLiveRecords() {
  const out = [];
  const push = (ref, start, end, categoryId, branch, source, revenue, extra) => {
    const cat = fleetGetCategory(categoryId);
    if (!cat || isNaN(start) || isNaN(end)) return;
    const days = Math.max(1, Math.ceil((end - start) / FLEET_DAY_MS));
    out.push({
      ref, start, end, days, categoryId, section: cat.section, branch, source,
      revenue: revenue == null ? cat.rate * days : revenue, excessReduction: false, extras: 0,
      cancelled: false, pending: false, damage: false, damageCost: 0, leadDays: 0, live: true,
      pickBranch: branch, dropBranch: branch, ...extra
    });
  };

  fleetSeedBookings().forEach(s => {
    const v = fleetGetVehicle(s.plate);
    if (!v) return;
    push(s.ref, s.startMs, s.endMs, v.categoryId, v.branch, 'Phone',
         s.type === 'maintenance' ? 0 : null, { id: s.id, type: s.type, plate: s.plate, name: `${s.fname} ${s.lname}`, pickBranch: s.loc ? anBranchCode(s.loc) : v.branch, dropBranch: s.dropoffLoc ? anBranchCode(s.dropoffLoc) : (s.loc ? anBranchCode(s.loc) : v.branch) });
  });
  // Reservas de demonstração canceladas pelo agente: contam na taxa de cancelamento
  const overrides = fleetReadOverrides();
  FLEET_SEED_BASE.filter(s => overrides[s.id] && overrides[s.id].cancelled && s.type !== 'maintenance').forEach(s => {
    const v = fleetGetVehicle(s.plate);
    if (v) push(s.ref, s.startMs, s.endMs, v.categoryId, v.branch, 'Phone', 0, { type: 'cancelled', cancelled: true, plate: s.plate, name: `${s.fname} ${s.lname}` });
  });

  fleetForEachStoredBooking((list, key, email) => list.forEach(b => {
    const cat = fleetFindCategoryByModel(b.vehicle);
    if (!cat) return;
    const r = fleetBookingRange(b);
    const days = Math.max(1, Math.ceil((r.end - r.start) / FLEET_DAY_MS));
    const cancelled = b.status === 'cancelled';
    const pending = ['fleet_pending', 'proposal_sent'].includes(b.status);
    push(b.ref, r.start, r.end, cat.id, anBranchCode(b.loc), b.source || 'Direct Website', cancelled ? 0 : anRevenueOf(b, cat, days), {
      type: cancelled ? 'cancelled' : pending ? 'on-request' : (b.plannerType && b.plannerType !== 'donotmove' ? b.plannerType : 'reservation'),
      cancelled, pending,
      id: String(b.id), pickBranch: anBranchCode(b.loc), dropBranch: anBranchCode(b.dropoffLoc || b.loc),
      status: b.status, plate: b.plate, name: `${b.fname || ''} ${b.lname || ''}`.trim(), email,
      excessReduction: b.excessOption === 'reduced',
      leadDays: isNaN(Number(b.id)) ? 0 : Math.max(0, Math.round((r.start - Number(b.id)) / FLEET_DAY_MS))
    });
  }));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(FLEET_MAIN_PREFIX)) continue;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
    if (!state.status || state.status === 'cancelled') continue;
    const r = fleetMainBookingRange(state);
    push('GC-8832', r.start, r.end, 'pantech', 'MAS', 'Direct Website', null,
         { id: 'main-' + key.slice(FLEET_MAIN_PREFIX.length), type: fleetMainBookingType(state), plate: FLEET_MAIN_BOOKING_PLATE, name: 'Felipe Grigolli' });
  }

  // Devolvidas antigas da fila do Bond Refunds (gc-bonds.js) também são reservas reais
  if (typeof BOND_SEED_RETURNED !== 'undefined') BOND_SEED_RETURNED.forEach(r => {
    if (out.some(x => x.ref === r.ref)) return;
    const cat = fleetGetCategory(r.categoryId);
    const days = Math.max(1, Math.ceil((r.dropoffMs - r.pickupMs) / FLEET_DAY_MS));
    push(r.ref, r.pickupMs, r.dropoffMs, r.categoryId, anBranchCode(r.loc), 'Phone', anRevenueOf({ fees: r.fees }, cat, days),
         { id: r.id, bondOnly: true, type: 'returned', plate: r.plate, name: `${r.fname} ${r.lname}`, excessReduction: r.fees.insurance === 'reduced' });
  });

  // Danos: relatórios do Damage Control, pelo Res #. Custo = o que foi cobrado na reserva
  // (ou o valor a cobrar do relatório); incidente ainda sem orçamento conta com $0.
  let reports = [];
  try { reports = JSON.parse(localStorage.getItem('gc_damage_reports') || '[]') || []; } catch (e) {}
  reports.forEach(d => {
    const ref = String(d.bookingRef || '').trim().toUpperCase();
    const rec = ref && out.find(x => String(x.ref).toUpperCase() === ref);
    if (!rec) return;
    const c = d.chargedToBooking;
    rec.damage = true;
    rec.damageCost += c && !c.removed ? Number(c.amount) || 0 : Number(d.recoverAmount) || 0;
  });
  return out;
}

function anAllRecords() {
  return anBuildHistory().concat(anLiveRecords());
}

// ---------- Períodos ----------
// Devolve [from, to) do período escolhido + o período anterior de mesmo tamanho
function anPeriod(key) {
  const today0 = anStartOfDay(Date.now());
  const tomorrow = today0 + FLEET_DAY_MS;
  let from, to = tomorrow, label;
  if (key === 'mtd') {
    const d = new Date(today0); d.setDate(1);
    from = d.getTime(); label = 'Month to date';
  } else if (key === 'ytd') {
    const d = new Date(today0); d.setMonth(0, 1);
    from = d.getTime(); label = 'Year to date';
  } else {
    const days = Number(key) || 30;
    from = tomorrow - days * FLEET_DAY_MS; label = `Last ${days} days`;
  }
  const len = to - from;
  return { from, to, prevFrom: from - len, prevTo: from, days: Math.round(len / FLEET_DAY_MS), label };
}

function anMatches(r, f) {
  if (f.branch && f.branch !== 'ALL' && r.branch !== f.branch) return false;
  if (f.section && f.section !== 'ALL' && r.section !== f.section) return false;
  if (f.categoryId && r.categoryId !== f.categoryId) return false;
  return true;
}

// Reservas que COMEÇAM no período (receita é reconhecida na retirada)
function anInPeriod(records, from, to, f) {
  return records.filter(r => r.start >= from && r.start < to && anMatches(r, f));
}

function anFleetSize(f) {
  return FLEET_VEHICLES.filter(v => {
    const cat = fleetGetCategory(v.categoryId);
    return (!f.branch || f.branch === 'ALL' || v.branch === f.branch) &&
           (!f.section || f.section === 'ALL' || cat.section === f.section) &&
           (!f.categoryId || v.categoryId === f.categoryId);
  }).length;
}

// Dias-veículo ocupados dentro do período (conta locações que cruzam as bordas)
function anBookedVehicleDays(records, from, to, f) {
  return records.reduce((s, r) => {
    if (!anCounts(r) || !anMatches(r, f)) return s;
    const overlap = Math.min(r.end, to) - Math.max(r.start, from);
    return overlap > 0 ? s + overlap / FLEET_DAY_MS : s;
  }, 0);
}

function anSummary(records, from, to, f) {
  const inP = anInPeriod(records, from, to, f);
  const done = inP.filter(anCounts);
  const cancelled = inP.filter(r => r.cancelled).length;
  const revenue = done.reduce((s, r) => s + r.revenue, 0);
  const rentalDays = done.reduce((s, r) => s + r.days, 0);
  const periodDays = (to - from) / FLEET_DAY_MS;
  const fleet = anFleetSize(f);
  const booked = anBookedVehicleDays(records, from, to, f);
  return {
    revenue,
    bookings: done.length,
    cancellations: cancelled,
    cancellationRate: done.length + cancelled ? cancelled / (done.length + cancelled) : 0,
    rentalDays,
    adr: rentalDays ? revenue / rentalDays : 0,
    avgLength: done.length ? rentalDays / done.length : 0,
    utilization: fleet && periodDays ? Math.min(1, booked / (fleet * periodDays)) : 0,
    revPerVehicleDay: fleet && periodDays ? revenue / (fleet * periodDays) : 0,
    excessUptake: done.length ? done.filter(r => r.excessReduction).length / done.length : 0,
    damageRate: done.length ? done.filter(r => r.damage).length / done.length : 0,
    damageCost: done.reduce((s, r) => s + r.damageCost, 0),
    fleet
  };
}

function anGroupSum(records, keyFn, valueFn) {
  const map = new Map();
  records.forEach(r => {
    const k = keyFn(r);
    map.set(k, (map.get(k) || 0) + valueFn(r));
  });
  return map;
}
