// ==========================================
// GC TECH FEES DATA — CATÁLOGO DE COBRANÇAS DO BOOKING (igual ao "Booking Fees" do RCM)
// Usado por: Fleet Planner (aba Booking Fees) e, depois, pelo relatório de refund dos bonds.
// Prefixo fee/FEE_ para não colidir com os outros scripts no escopo global.
//
// kind: 'daily'   → amount × qty × dias do booking
//       'fixed'   → amount × qty
//       'percent' → amount % sobre (hire + extras); Discount entra negativo
// bond: true   → cobrança caução que precisa ser devolvida (entra no relatório de refund)
// refund: true → linha de devolução (valor negativo)
// ==========================================

const FEE_ITEMS = [
  { id: 'car-seat-4plus',     kind: 'daily',   name: 'Car Seat - 4 years +',                         amount: 6.00 },
  { id: 'car-seat-6m-4y',     kind: 'daily',   name: 'Car Seat - 6 Months to 4 Years',               amount: 6.00 },

  { id: 'debit-bond',         kind: 'fixed',   name: 'Visa/MC Debit Bond (5-7 Working Days Return)', amount: 404.00, bond: true },
  { id: 'debit-bond-refund',  kind: 'fixed',   name: 'Visa/MC Debit Bond Refund',                    amount: -400.00, refund: true },
  { id: 'snow-fee',           kind: 'fixed',   name: 'One off Snow Fee (Minimum 3 day rental)',      amount: 45.00 },
  { id: 'accessories',        kind: 'fixed',   name: 'Acessories',                                   amount: 0 },
  { id: 'admin-fee',          kind: 'fixed',   name: 'Admin Fee',                                    amount: 95.00 },
  { id: 'amex-recovery',      kind: 'fixed',   name: 'Amex Recovery (Before 1st October 2026)',      amount: 0 },
  { id: 'assessment-fee',     kind: 'fixed',   name: 'Assessment Fee',                               amount: 175.00 },
  { id: 'bad-debt',           kind: 'fixed',   name: 'Bad Debt Written Off',                         amount: 0 },
  { id: 'battery',            kind: 'fixed',   name: 'Battery Replacement',                          amount: 220.00 },
  { id: 'call-out',           kind: 'fixed',   name: 'Call Out Fee',                                 amount: 49.00 },
  { id: 'cancellation',       kind: 'fixed',   name: 'Cancellation Fee',                             amount: 0 },
  { id: 'card-decline',       kind: 'fixed',   name: 'Card Decline Fee',                             amount: 1.50 },
  { id: 'charge-back',        kind: 'fixed',   name: 'Charge Back',                                  amount: 0 },
  { id: 'cleaning',           kind: 'fixed',   name: 'Cleaning Fee',                                 amount: 250.00 },
  { id: 'damage-ext',         kind: 'fixed',   name: 'Damage Recovery Exterior',                     amount: 0 },
  { id: 'damage-int',         kind: 'fixed',   name: 'Damage Recovery Interior',                     amount: 0 },
  { id: 'damage-admin',       kind: 'fixed',   name: 'Damage repairs administration fee',            amount: 95.00 },
  { id: 'deposit',            kind: 'fixed',   name: 'Deposit',                                      amount: 900.00, bond: true },
  { id: 'deposit-spare-key',  kind: 'fixed',   name: 'Deposit for Spare Key',                        amount: 500.00, bond: true },
  { id: 'deposit-refund',     kind: 'fixed',   name: 'Deposit Refund',                               amount: 0, refund: true },
  { id: 'drop-off',           kind: 'fixed',   name: 'Drop Off Fee',                                 amount: 25.00 },
  { id: 'enforcement',        kind: 'fixed',   name: 'Enforcement Order',                            amount: 0 },
  { id: 'fuel',               kind: 'fixed',   name: 'Fuel',                                         amount: 0.80 },
  { id: 'infringement',       kind: 'fixed',   name: 'Infringement Handling Fee Fine',               amount: 30.00 },
  { id: 'insurance-adj',      kind: 'fixed',   name: 'Insurance Adjustment',                         amount: 0 },
  { id: 'interest-charge',    kind: 'fixed',   name: 'Interest Charge',                              amount: 0 },
  { id: 'lease-insurance',    kind: 'fixed',   name: 'Lease Insurance',                              amount: 65.00 },
  { id: 'lease-balloon',      kind: 'fixed',   name: 'Lease Purchase Plan Balloon',                  amount: 0 },
  { id: 'lease-deposit',      kind: 'fixed',   name: 'Lease Purchase Plan Deposit',                  amount: 0 },
  { id: 'legal',              kind: 'fixed',   name: 'Legal Fees',                                   amount: 0 },
  { id: 'loss-revenue',       kind: 'fixed',   name: 'Loss of Revenue',                              amount: 0 },
  { id: 'mercantile-comm',    kind: 'fixed',   name: 'Mercantile Commission Fees',                   amount: 0 },
  { id: 'mercantile-exp',     kind: 'fixed',   name: 'Mercantile expense recovery',                  amount: 0 },
  { id: 'merchant-cb',        kind: 'fixed',   name: 'Merchant Chargeback',                          amount: 0 },
  { id: 'interstate',         kind: 'fixed',   name: 'One off inter state charge: SA QLD VIC',       amount: 89.00 },
  { id: 'overdue-interest',   kind: 'fixed',   name: 'Overdue interest expense',                     amount: 0 },
  { id: 'payment-overdue',    kind: 'fixed',   name: 'Payment Overdue Fee',                          amount: 4.00 },
  { id: 'pre-quote-deposit',  kind: 'fixed',   name: 'Pre quotation damage deposit',                 amount: 0 },
  { id: 'recovery-comm',      kind: 'fixed',   name: 'Recovery Commission Incurred',                 amount: 0 },
  { id: 'refund',             kind: 'fixed',   name: 'Refund',                                       amount: 0, refund: true },
  { id: 'registration',       kind: 'fixed',   name: 'Registration',                                 amount: 0 },
  { id: 'relocation',         kind: 'fixed',   name: 'Relocation Fee',                               amount: 35.00 },
  { id: 'remote-bond',        kind: 'fixed',   name: 'Remote Location Bond',                         amount: 1200.00, bond: true },
  { id: 'replacement',        kind: 'fixed',   name: 'Replacement Vehicle',                          amount: 0 },
  { id: 'roof-racks',         kind: 'fixed',   name: 'Roof Racks',                                   amount: 35.00 },
  { id: 'rubbish',            kind: 'fixed',   name: 'Rubbish Removal Fee',                          amount: 55.00 },
  { id: 'service',            kind: 'fixed',   name: 'Service',                                      amount: 0 },
  { id: 'signage',            kind: 'fixed',   name: 'Signage',                                      amount: 0 },
  { id: 'smoking',            kind: 'fixed',   name: 'Smoking Fee',                                  amount: 300.00 },
  { id: 'stamp-duty',         kind: 'fixed',   name: 'Stamp Duty',                                   amount: 0 },
  { id: 'termination',        kind: 'fixed',   name: 'Termination Fee',                              amount: 0 },
  { id: 'toll-handling',      kind: 'fixed',   name: 'Toll Charge Handling Fee',                     amount: 7.50 },
  { id: 'toll-inc-handling',  kind: 'fixed',   name: 'Toll Charge Inc Handling Fee',                 amount: 5.50 },
  { id: 'towing',             kind: 'fixed',   name: 'Towing',                                       amount: 0 },
  { id: 'trolley-lost',       kind: 'fixed',   name: 'Trolley Lost',                                 amount: 220.00 },
  { id: 'tyre',               kind: 'fixed',   name: 'Tyre',                                         amount: 0 },
  { id: 'repossession',       kind: 'fixed',   name: 'Vehicle Repossesion Fee',                      amount: 400.00 },
  { id: 'windscreen',         kind: 'fixed',   name: 'windscreen repair',                            amount: 0 },

  { id: 'pct-discount',       kind: 'percent', name: 'Discount',                                     amount: 10.00, negative: true },
  { id: 'pct-interest',       kind: 'percent', name: 'Interest',                                     amount: 8.00 },
  { id: 'pct-amex',           kind: 'percent', name: 'Commission Recovery Amex',                     amount: 3.00 }
];

const FEE_GROUPS = [
  { kind: 'daily', label: 'Daily' },
  { kind: 'fixed', label: 'Fixed' },
  { kind: 'percent', label: 'Percentage' }
];

// Bond → linha de devolução lançada automaticamente quando o booking é marcado como Returned
// (o Visa/MC Debit Bond retém $4.00 de taxa do cartão; os depósitos voltam inteiros)
const FEE_BOND_REFUNDS = {
  'debit-bond':        { refundId: 'debit-bond-refund', amount: -400.00 },
  'deposit':           { refundId: 'deposit-refund',    amount: -900.00 },
  'deposit-spare-key': { refundId: 'deposit-refund',    amount: -500.00 },
  'remote-bond':       { refundId: 'deposit-refund',    amount: -1200.00 }
};

// pct: desconto sobre o valor do hire (rate × dias)
const FEE_DISCOUNTS = [
  { id: 'repeat-5',    name: 'Repeat Customer 5%',  pct: 5 },
  { id: 'corporate-10', name: 'Corporate 10%',      pct: 10 },
  { id: 'long-term-15', name: 'Long Term (28+ days) 15%', pct: 15 }
];

// ------------------------------------------
// POLÍTICA DE KMS (veículos comerciais). Carros e people movers: ilimitado.
//   Caminhão (Pantech): 1–3 dias = 120 kms/dia · 4+ dias = 250 kms/dia · excedente $0.32/km
//   Hiace 1T Van: 160 kms/dia · $0.29/km     Hiace 1.5T Van: 120 kms/dia · $0.31/km
//   Ute (Hilux): 120 kms/dia · $0.29/km
// Todo booking segue a política da categoria; o agente pode trocar na aba Booking Fees (kmsManual).
// O excedente é calculado pelas leituras do odômetro (Kms Out / Kms In) e gravado em fees.kmsCharge.
// ------------------------------------------
const FEE_KMS = [
  { id: 'unlimited', name: 'Unlimited kms', freePerDay: null, perKm: 0 },
  { id: 'truck',     name: 'Truck: 120 kms free per day (1-3 days), 250 kms per day (4+ days), additional per kms $0.32', perKm: 0.32,
    tiers: [{ maxDays: 3, freePerDay: 120 }, { maxDays: Infinity, freePerDay: 250 }] },
  { id: 'van-1t',    name: '160 kms free per day, additional per kms $0.29', freePerDay: 160, perKm: 0.29 },
  { id: 'van-15t',   name: '120 kms free per day, additional per kms $0.31', freePerDay: 120, perKm: 0.31 },
  { id: 'ute',       name: '120 kms free per day, additional per kms $0.29', freePerDay: 120, perKm: 0.29 },
  // Opções antigas (bookings gravados antes da política): só aparecem se já estiverem no booking
  { id: '250-day',   name: '250 kms free per day, additional per kms $0.30', freePerDay: 250, perKm: 0.30, legacy: true },
  { id: '100-day',   name: '100 kms free per day, additional per kms $0.30', freePerDay: 100, perKm: 0.30, legacy: true }
];

const FEE_KMS_BY_CATEGORY = { 'pantech': 'truck', 'hiace-1t': 'van-1t', 'hiace-15t': 'van-15t', 'hilux-auto': 'ute', 'hilux-diesel': 'ute' };

function feeKmsDefault(cat) {
  return (cat && FEE_KMS_BY_CATEGORY[cat.id]) || 'unlimited';
}

// Opção em vigor: a escolhida pelo agente, ou a da política da categoria
function feeKmsOption(fees, cat) {
  const id = fees && fees.kmsManual && fees.kms ? fees.kms : feeKmsDefault(cat);
  return FEE_KMS.find(k => k.id === id) || FEE_KMS[0];
}

function feeKmsFreePerDay(opt, days) {
  if (opt.tiers) return opt.tiers.find(t => days <= t.maxDays).freePerDay;
  return opt.freePerDay;
}

// Kms livres no booking inteiro (Infinity = ilimitado)
function feeKmsAllowance(opt, days) {
  const per = feeKmsFreePerDay(opt, days);
  return per == null ? Infinity : per * days;
}

// "120 kms free per day, additional per kms $0.31" para os dias do booking (o caminhão muda com os dias)
function feeKmsLabel(opt, days) {
  if (opt.freePerDay === null && !opt.tiers) return opt.name;
  return `${feeKmsFreePerDay(opt, days)} kms free per day, additional per kms ${feeMoney(opt.perKm)}`;
}

// Excedente pelas leituras do odômetro → { out, in, distance, allowance, extra, rate, amount } ou null
function feeKmsCharge(opt, days, kmsOut, kmsIn) {
  if (kmsOut === '' || kmsIn === '' || kmsOut == null || kmsIn == null) return null;
  const out = Number(kmsOut), inn = Number(kmsIn);
  if (!Number.isFinite(out) || !Number.isFinite(inn) || inn < out) return null;
  const distance = inn - out;
  const allowance = feeKmsAllowance(opt, days);
  const extra = Number.isFinite(allowance) ? Math.max(0, distance - allowance) : 0;
  return { out, in: inn, distance, allowance: Number.isFinite(allowance) ? allowance : null, extra,
           rate: opt.perKm, amount: Math.round(extra * opt.perKm * 100) / 100 };
}

const feeMoney = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);

function feeGetItem(id) {
  return FEE_ITEMS.find(f => f.id === id);
}

// Excess: as mesmas duas opções do checkout do Customer Portal (FLEET_EXCESS_TIERS por categoria).
// id 'standard' | 'reduced' — igual ao bk.excessOption gravado pelo checkout.
function feeExcessOptions(cat) {
  const t = (cat && cat.excess) || FLEET_EXCESS_TIERS.smallCar;
  return [
    { id: 'standard', name: `Standard Excess $${t.standard}`, daily: 0 },
    { id: 'reduced',  name: `Excess Reduction $${t.reduced}`, daily: t.reducedPerDay }
  ];
}

// Extras escolhidos no checkout do site → itens do Booking Fees
// (motorista adicional não é cobrado pela GC Tech: não vira taxa)
const FEE_CHECKOUT_EXTRAS = { childSeat: 'car-seat-6m-4y', booster: 'car-seat-4plus' };

// Cobranças padrão de um booking que ainda não passou pela aba Booking Fees:
// diária da categoria + excess escolhido no portal + extras do site + Visa/MC Debit Bond (cobrado em todo booking)
function feeDefaults(cat, excessOption, extras) {
  const items = [];
  Object.keys(FEE_CHECKOUT_EXTRAS).forEach(k => {
    const qty = Number((extras || {})[k]) || 0;
    if (qty > 0) items.push({ id: FEE_CHECKOUT_EXTRAS[k], qty, amount: feeGetItem(FEE_CHECKOUT_EXTRAS[k]).amount });
  });
  items.push({ id: 'debit-bond', qty: 1, amount: feeGetItem('debit-bond').amount });
  return {
    rate: cat ? cat.rate : 0,
    discount: '',
    insurance: excessOption === 'reduced' ? 'reduced' : 'standard',
    kms: feeKmsDefault(cat),
    items
  };
}

// Parcelas pagas de Payment Plans da reserva (mesmo Res #): abatem o saldo, como pagamentos.
// Limite: o valor de dano lançado no Booking Fees (um plano cujo dano não está na reserva não cria
// crédito falso para o cliente). Lido direto do localStorage para funcionar em qualquer tela.
const FEE_DAMAGE_IDS = ['damage-ext', 'damage-int', 'damage-admin', 'windscreen', 'tyre', 'towing', 'cleaning', 'smoking'];
function feePlanPayments(ref, fees) {
  if (!ref) return [];
  let plans = [];
  try { plans = JSON.parse(localStorage.getItem('gc_payment_plans') || '[]') || []; } catch (e) { return []; }
  const key = String(ref).toUpperCase();
  const mine = plans.filter(p => String(p.bookingRef || '').toUpperCase() === key && p.status !== 'cancelled');
  if (!mine.length) return [];
  let cap = ((fees && fees.items) || []).filter(i => FEE_DAMAGE_IDS.includes(i.id))
    .reduce((s, i) => s + (Number(i.amount) || 0) * (Number(i.qty) || 1), 0);
  const out = [];
  mine.forEach(p => (p.installments || []).filter(i => i.status === 'paid')
    .sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))
    .forEach(i => {
      const amt = Math.min(Number(i.amount) || 0, cap);
      if (amt <= 0.004) return;
      cap -= amt;
      out.push({ id: `plan-${p.id}-${i.n}`, type: 'Payment', method: 'card', dateMs: Date.parse(i.paidAt) || Date.now(),
        reference: `Payment plan instalment #${i.n}${i.method ? ' · ' + i.method : ''}`, amount: Math.round(amt * 100) / 100, merchantFee: 0, extra: true, plan: true });
    }));
  return out;
}

// Valor e pagamento de uma reserva gravada, igual à aba Payments do Planner.
// Lê os dois formatos: RCM (fees + paidSnapshot) e site antigo (priceTotal/extras + paymentStatus).
// Regra da GC Tech: nada é cobrado antes do pick-up; o agente cobra na loja, só cartão (sem dinheiro
// nem transferência). Sem pagamento registrado: antes do pick-up = nada pago; retirada/devolvida = paga.
// Soma também as cobranças de saldo/extensão/devolução feitas pelo PowerBoard.
function feeBookingMoney(b, cat) {
  const r = fleetBookingRange(b);
  const days = Math.max(1, Math.ceil((r.end - r.start) / FLEET_DAY_MS));
  cat = cat || fleetFindCategoryByModel(b.vehicle);
  const fees = b.fees || feeDefaults(cat, b.excessOption, b.extras);
  const grand = b.fees && b.fees.grandTotal != null ? Number(b.fees.grandTotal) : feeCalc(fees, cat, days).grand;
  const signed = p => (p.type === 'Refund' ? -1 : 1) * Math.abs(Number(p.amount) || 0);
  let paid;
  if (Array.isArray(b.paidSnapshot)) paid = b.paidSnapshot.reduce((s, p) => s + signed(p), 0);
  else if (['hired', 'returned'].includes(b.plannerType) && !['not_charged', 'pay_at_pickup'].includes(b.paymentStatus)) paid = grand;
  else paid = 0;
  try {
    const charges = (JSON.parse(localStorage.getItem('gc_pb_charges') || '{}') || {})[String(b.id)] || [];
    // Mesma regra do pbLedgerPayments: manual abate o saldo até o que era devido
    charges.filter(c => c.status === 'complete').forEach(c => {
      if (c.kind === 'refund') paid -= Math.abs(c.amount);
      else if (['balance', 'extension'].includes(c.kind)) paid += Number(c.amount) || 0;
      else if (c.kind === 'manual') paid += Number(c.applied != null ? c.applied : c.amount) || 0;
    });
  } catch (e) {}
  paid += feePlanPayments(b.ref, fees).reduce((s, p) => s + p.amount, 0);
  return { grand, paid: Math.round(paid * 100) / 100, balance: Math.round((grand - paid) * 100) / 100, days, fees };
}

// Calcula as linhas no formato do extrato do RCM ("Rate and Fees") e os totais.
// Percentuais incidem sobre (hire com desconto + extras); Discount entra negativo.
function feeCalc(fees, cat, days) {
  const rate = Number(fees.rate) || 0;
  const hire = rate * days;
  const discount = FEE_DISCOUNTS.find(x => x.id === fees.discount);
  const discountAmt = discount ? hire * discount.pct / 100 : 0;
  const excessOpts = feeExcessOptions(cat);
  const excess = excessOpts.find(x => x.id === fees.insurance) || excessOpts[0];
  const kms = feeKmsOption(fees, cat);

  const lines = [{ label: 'Rate', days, qty: null, rate, total: hire }];
  if (discount) lines.push({ label: discount.name, days: null, qty: null, rate: null, total: -discountAmt });
  lines.push({ label: feeKmsLabel(kms, days), days, qty: null, rate: 0, total: 0, extra: true });
  // Kms além da franquia (leituras do odômetro), como no extrato do RCM
  const kc = fees.kmsCharge;
  if (kc && Number(kc.amount) > 0) {
    const read = kc.out !== '' && kc.out != null;
    lines.push({ id: 'kms-charge', label: read ? `Additional Kms Charge (Out: ${kc.out}, In: ${kc.in})` : 'Additional Kms Charge',
                 note: read ? `- Total Distance Travelled ${kc.distance}` : '',
                 days: null, qty: read ? kc.extra : null, rate: read ? kc.rate : null, total: Number(kc.amount), extra: true });
  }
  lines.push({ label: excess.name, days, qty: null, rate: excess.daily, total: excess.daily * days, extra: true });

  const items = (fees.items || []).map(i => ({ ...i, item: feeGetItem(i.id) })).filter(i => i.item);
  items.filter(i => i.item.kind !== 'percent').forEach(i => {
    const daily = i.item.kind === 'daily';
    lines.push({ id: i.id, label: i.item.name, days: daily ? days : null, qty: i.qty, rate: i.amount,
                 total: i.amount * i.qty * (daily ? days : 1), extra: true, refund: !!i.item.refund });
  });
  const base = lines.reduce((s, l) => s + l.total, 0);
  items.filter(i => i.item.kind === 'percent').forEach(i => {
    lines.push({ id: i.id, label: `${i.item.name} ${i.amount}%`, days: null, qty: i.qty, rate: null,
                 total: base * i.amount / 100 * i.qty * (i.item.negative ? -1 : 1), extra: true });
  });

  const total = hire - discountAmt;
  const grand = lines.reduce((s, l) => s + l.total, 0);
  return { lines, hire, total, extras: grand - total, grand, excess, kms, discount };
}

// Marcado como Returned: lança a devolução de cada bond que ainda não tem a sua
function feeAddBondRefunds(fees) {
  const items = (fees.items || []).slice();
  const refunds = {};
  items.forEach(i => {
    const map = FEE_BOND_REFUNDS[i.id];
    if (map) refunds[map.refundId] = (refunds[map.refundId] || 0) + map.amount * i.qty;
  });
  Object.keys(refunds).forEach(refundId => {
    if (!items.some(i => i.id === refundId)) items.push({ id: refundId, qty: 1, amount: refunds[refundId] });
  });
  return { ...fees, items };
}
