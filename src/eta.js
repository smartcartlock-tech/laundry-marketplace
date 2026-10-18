// T106 (צוות J): חישוב צפי החזרה (ETA) להזמנה — מתוך חלונות ההחזרה של המכבסה
// וזמן העבודה המוצהר שלה (turnaround_hours). הכל באזור זמן Asia/Jerusalem.
// הלקוח רואה תווית אחידה: "צפי החזרה: יום ג׳ עד 19:00" (או היום/מחר).

const TZ = 'Asia/Jerusalem';
const WD_HE = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'יום שבת'];
const WD_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

function jrParts(date) {
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour) % 24, mm: Number(p.minute),
    weekday: WD_EN[p.weekday],
  };
}

function tzOffsetMs(date) {
  const p = jrParts(date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, 0);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// זמן קיר בירושלים -> Date (UTC) עם תיקון כפול לגבול שעון קיץ
function wallToUtc(y, m, d, hh, mm) {
  const utc = Date.UTC(y, m - 1, d, hh, mm);
  let guess = utc - tzOffsetMs(new Date(utc));
  const off2 = tzOffsetMs(new Date(guess));
  if (off2 !== utc - guess) guess = utc - off2;
  return new Date(guess);
}

function addDays(parts, n) {
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + n, 12));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    weekday: dt.getUTCDay() };
}

// סוף חלון ההחזרה הקרוב (kind) שמסתיים אחרי from. מדלג על שבת כמו בצ'ק-אאוט.
function nextWindowEnd(windows, kind, from, maxDays = 14) {
  let best = null;
  const base = jrParts(from);
  for (const w of windows || []) {
    if (w.kind !== kind || w.weekday === 6) continue;
    const [eh, em] = String(w.end_time).slice(0, 5).split(':').map(Number);
    if (Number.isNaN(eh) || Number.isNaN(em)) continue;
    for (let off = 0; off <= maxDays; off++) {
      const day = addDays(base, off);
      if (day.weekday !== Number(w.weekday)) continue;
      const endUtc = wallToUtc(day.y, day.m, day.d, eh, em);
      if (endUtc > from && (!best || endUtc < best)) best = endUtc;
      break;
    }
  }
  return best;
}

// צפי החזרה להזמנה. delivery_at מפורש (בחירת לקוח) גובר. בלי חלונות החזרה — null.
// order: { pickup_at, delivery_at, status }
function computeReturnEta({ turnaroundHours = 24, windows = [], order = {}, now = new Date() }) {
  if (order.status === 'cancelled') return null;
  if (order.delivery_at) {
    const at = new Date(order.delivery_at);
    if (at > now || order.status !== 'delivered') return at;
  }
  if (order.status === 'delivered') return null; // הוחזרה בפועל — מוצג מהאירועים
  const pickup = order.pickup_at ? new Date(order.pickup_at) : null;
  const base = pickup && pickup > now ? pickup : now;
  const earliest = new Date(base.getTime() + Math.max(1, Number(turnaroundHours) || 24) * 3600e3);
  return nextWindowEnd(windows, 'delivery', earliest);
}

// "יום ג׳ עד 19:00" / "היום עד 19:00" / "מחר עד 19:00"
function etaLabel(at, now = new Date()) {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  const a = jrParts(d), n = jrParts(now);
  const dayA = Date.UTC(a.y, a.m - 1, a.d), dayN = Date.UTC(n.y, n.m - 1, n.d);
  const diff = Math.round((dayA - dayN) / 86400e3);
  const dayTxt = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : WD_HE[a.weekday];
  const hm = `${String(a.hh).padStart(2, '0')}:${String(a.mm).padStart(2, '0')}`;
  return `${dayTxt} עד ${hm}`;
}

module.exports = { computeReturnEta, nextWindowEnd, etaLabel, wallToUtc, jrParts, WD_HE };
