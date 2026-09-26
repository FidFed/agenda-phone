// Formattazione in italiano: date parziali, tempi relativi, dimensioni, plurali.
// Funzioni pure, senza dipendenze. Documentazione: docs/frontend.md
//
// Una "data parziale" è una stringa "AAAA", "AAAA-MM", "AAAA-MM-GG" oppure "--MM-GG" (giorno e mese senza anno,
// notazione ISO 8601: usata soprattutto per i compleanni); "" = data ignota.
// Le date senza anno non stanno su una linea del tempo: parsePartialDate le accetta solo con { allowNoYear: true },
// relativeTime non le descrive e negli ordinamenti vengono dopo le date con l'anno.

export const MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];
export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const PARTIAL_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const NO_YEAR_RE = /^--(\d{2})-(\d{2})$/;
// Giorni massimi per mese quando l'anno non è noto (il 29 febbraio è ammesso).
const MAX_DAYS_NO_YEAR = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad2 = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Scompone una data parziale. Accetta anche timestamp ISO completi (usa la parte data).
 * Le date senza anno ("--MM-GG") sono accettate solo con `{ allowNoYear: true }`: in quel caso year = null e
 * precision = "monthday". Senza l'opzione restituisce null, così chi lavora su una linea del tempo (ordinamenti,
 * "ultima volta visto", raggruppamenti per anno) le tratta come date non collocabili.
 * @param {string} s
 * @param {{allowNoYear?: boolean}} [opts]
 * @returns {{year:number|null, month:number|null, day:number|null, precision:'year'|'month'|'day'|'monthday'}|null}
 */
export function parsePartialDate(s, { allowNoYear = false } = {}) {
  if (typeof s !== 'string') return null;
  let str = s.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) str = str.slice(0, 10);
  const nm = NO_YEAR_RE.exec(str);
  if (nm) {
    if (!allowNoYear) return null;
    const month = Number(nm[1]);
    const day = Number(nm[2]);
    if (month < 1 || month > 12 || day < 1 || day > MAX_DAYS_NO_YEAR[month - 1]) return null;
    return { year: null, month, day, precision: 'monthday' };
  }
  const m = PARTIAL_RE.exec(str);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1) return null;
  const month = m[2] ? Number(m[2]) : null;
  const day = m[3] ? Number(m[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && (day < 1 || day > daysInMonth(year, month))) return null;
  return { year, month, day, precision: day !== null ? 'day' : month !== null ? 'month' : 'year' };
}

/**
 * true se `s` è una data parziale valida: "AAAA", "AAAA-MM", "AAAA-MM-GG" o "--MM-GG" (mese 01-12, giorno valido
 * per il mese; "--02-29" ammesso). La stringa vuota NON è valida.
 */
export function isValidPartialDate(s) {
  if (typeof s !== 'string' || /T/.test(s)) return false;
  return parsePartialDate(s, { allowNoYear: true }) !== null;
}

/** true se `s` è una data valida con giorno e mese ma senza anno ("--MM-GG"). */
export function isNoYearDate(s) {
  return parsePartialDate(typeof s === 'string' ? s : '', { allowNoYear: true })?.precision === 'monthday';
}

/**
 * Costruisce una data parziale dalle parti (month/day opzionali). Restituisce "" se le parti non sono valide.
 * Con `{ allowNoYear: true }` e l'anno vuoto, giorno e mese validi danno "--MM-GG".
 */
export function partialDateFromParts(year, month, day, { allowNoYear = false } = {}) {
  if (allowNoYear && (year === '' || year == null)) {
    const mo = month === '' || month == null ? NaN : Number(month);
    const d = day === '' || day == null ? NaN : Number(day);
    if (!Number.isInteger(mo) || mo < 1 || mo > 12 || !Number.isInteger(d) || d < 1 || d > MAX_DAYS_NO_YEAR[mo - 1]) return '';
    return `--${pad2(mo)}-${pad2(d)}`;
  }
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1 || y > 9999) return '';
  let out = String(y).padStart(4, '0');
  const mo = month === '' || month == null ? null : Number(month);
  if (mo === null) return out;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return out;
  out += '-' + pad2(mo);
  const d = day === '' || day == null ? null : Number(day);
  if (d === null) return out;
  if (!Number.isInteger(d) || d < 1 || d > daysInMonth(y, mo)) return out;
  return out + '-' + pad2(d);
}

/**
 * Formatta una data parziale in italiano.
 *   style "short" (default): "12 mag 2019" | "maggio 2019" | "2019" | "12 mar" (senza anno)
 *   style "long":            "12 maggio 2019" | "maggio 2019" | "2019" | "12 marzo" (senza anno)
 *   style "weekday":         "sabato 12 maggio 2019" (solo date complete; altrimenti come "long")
 * Input non valido: restituito così com'è (mai eccezioni); "" → "".
 */
export function formatDate(partial, { style = 'short' } = {}) {
  if (partial == null || partial === '') return '';
  const p = parsePartialDate(String(partial), { allowNoYear: true });
  if (!p) return String(partial);
  if (p.precision === 'monthday') return `${p.day} ${style === 'short' ? MONTHS_SHORT[p.month - 1] : MONTHS[p.month - 1]}`;
  if (p.precision === 'year') return String(p.year);
  if (p.precision === 'month') return `${MONTHS[p.month - 1]} ${p.year}`;
  const month = style === 'short' ? MONTHS_SHORT[p.month - 1] : MONTHS[p.month - 1];
  const base = `${p.day} ${month} ${p.year}`;
  if (style === 'weekday') {
    const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return `${WEEKDAYS[wd]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
  }
  return base;
}

/** Formatta un timestamp ISO completo: "12 mag 2019, 14:30". Input non valido → "". */
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Data di oggi (ora locale) come "AAAA-MM-GG". */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Somma `n` giorni (anche negativi) a una data "AAAA-MM-GG". Input non valido → oggi + n. */
export function addDays(iso, n) {
  const p = parsePartialDate(iso);
  const base = p && p.precision === 'day'
    ? Date.UTC(p.year, p.month - 1, p.day)
    : (() => { const t = new Date(); return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()); })();
  const d = new Date(base + Math.round(Number(n) || 0) * 86400000);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Giorni interi tra due date "AAAA-MM-GG" (b - a). */
export function daysBetween(a, b) {
  const pa = parsePartialDate(a);
  const pb = parsePartialDate(b);
  if (!pa || !pb) return NaN;
  const ta = Date.UTC(pa.year, (pa.month || 1) - 1, pa.day || 1);
  const tb = Date.UTC(pb.year, (pb.month || 1) - 1, pb.day || 1);
  return Math.round((tb - ta) / 86400000);
}

// Chiave di ordinamento [gruppo, testo]: gruppo 0 = data con l'anno, 1 = senza anno ("--MM-GG": per mese e
// giorno), 2 = vuota o non valida.
function dateSortKey(s) {
  if (typeof s !== 'string' || !s) return [2, ''];
  const p = parsePartialDate(s, { allowNoYear: true });
  if (!p) return [2, ''];
  return [p.precision === 'monthday' ? 1 : 0, s.trim()];
}

/**
 * Confronto tra date parziali per ordinamenti (crescente).
 * "2019" < "2019-05" < "2019-05-12" (a parità di prefisso la più precisa viene dopo); le date senza anno vengono dopo
 * tutte quelle con l'anno (ordinate per mese e giorno); le date vuote/non valide vanno in fondo.
 */
export function compareDates(a, b) {
  const [ga, ka] = dateSortKey(a);
  const [gb, kb] = dateSortKey(b);
  if (ga !== gb) return ga - gb;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Tempo relativo in italiano rispetto a oggi, alla precisione della data:
 *   giorno: "oggi", "ieri", "domani", "3 giorni fa", "2 settimane fa", "3 mesi fa", "2 anni fa", "tra 5 giorni"
 *   mese:   "questo mese", "il mese scorso", "4 mesi fa", "l'anno scorso"...
 *   anno:   "quest'anno", "l'anno scorso", "3 anni fa", "l'anno prossimo"
 * Accetta anche timestamp ISO completi. Input non valido, o data senza anno ("--MM-GG": non collocabile nel tempo) → "".
 */
export function relativeTime(partial, today = todayISO()) {
  const p = parsePartialDate(typeof partial === 'string' ? partial : '');
  const t = parsePartialDate(today);
  if (!p || !t) return '';

  const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
  const years = t.year - p.year;

  if (p.precision === 'year') {
    if (years === 0) return "quest'anno";
    if (years === 1) return "l'anno scorso";
    if (years === -1) return "l'anno prossimo";
    return years > 0 ? `${years} anni fa` : `tra ${-years} anni`;
  }

  const months = years * 12 + (t.month - p.month);
  if (p.precision === 'month') {
    if (months === 0) return 'questo mese';
    if (months === 1) return 'il mese scorso';
    if (months === -1) return 'il mese prossimo';
    if (months > 0) return months < 12 ? `${months} mesi fa` : yearsAgo(months);
    return -months < 12 ? `tra ${-months} mesi` : `tra ${plural(Math.floor(-months / 12), 'un anno', 'anni')}`;
  }

  const days = daysBetween(`${p.year}-${pad2(p.month)}-${pad2(p.day)}`, today);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days === -1) return 'domani';
  if (days < 0) {
    const f = -days;
    if (f < 14) return `tra ${f} giorni`;
    if (f < 60) return `tra ${Math.round(f / 7)} settimane`;
    if (f < 365) return `tra ${Math.round(f / 30.44)} mesi`;
    return `tra ${plural(Math.floor(f / 365.25), 'un anno', 'anni')}`;
  }
  if (days < 14) return `${days} giorni fa`;
  if (days < 60) return `${Math.round(days / 7)} settimane fa`;
  if (days < 365) {
    const m = Math.max(2, Math.round(days / 30.44));
    return m >= 12 ? 'un anno fa' : `${m} mesi fa`;
  }
  return yearsAgo(Math.floor(days / 30.44));

  function yearsAgo(totalMonths) {
    const y = Math.floor(totalMonths / 12);
    return y <= 1 ? 'un anno fa' : `${y} anni fa`;
  }
}

/** Dimensione leggibile: "0 B", "512 B", "1,2 KB", "3,4 MB", "1,1 GB". */
export function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  const digits = i === 0 || x >= 100 ? 0 : 1;
  return `${x.toLocaleString('it-IT', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${units[i]}`;
}

/** Numero con separatori italiani: 12345.6 → "12.345,6" (in italiano i numeri di 4 cifre non hanno separatore). */
export function formatNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('it-IT') : '';
}

/** Plurale semplice: plural(1, 'persona', 'persone') → "1 persona"; plural(3, ...) → "3 persone". */
export function plural(n, one, many) {
  const v = Number(n) || 0;
  return `${v.toLocaleString('it-IT')} ${v === 1 ? one : many}`;
}

/**
 * Interpreta una data scritta a mano: "25/09/2024", "25-9-24", "9/2024", "2024", "2024-09-25", "25 settembre 2024",
 * "settembre 2024". Restituisce la data parziale oppure null se non riconosciuta.
 */
export function parseUserDate(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (isValidPartialDate(s)) return s;

  const fixYear = (y) => {
    const n = Number(y);
    if (y.length <= 2) {
      const now = new Date().getFullYear();
      const century = Math.floor(now / 100) * 100;
      return n + century > now + 5 ? n + century - 100 : n + century;
    }
    return n;
  };

  let m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const out = partialDateFromParts(fixYear(m[3]), m[2], m[1]);
    return out && out.length === 10 ? out : null;
  }
  m = /^(\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (m) {
    const out = partialDateFromParts(m[2], m[1]);
    return out && out.length === 7 ? out : null;
  }
  const monthIndex = (word) => {
    const w = word.replace(/\.$/, '');
    let i = MONTHS.indexOf(w);
    if (i < 0) i = MONTHS_SHORT.indexOf(w.slice(0, 3));
    return i;
  };
  m = /^(\d{1,2}) ([a-zì]+\.?) (\d{4})$/.exec(s);
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi < 0) return null;
    const out = partialDateFromParts(m[3], mi + 1, m[1]);
    return out && out.length === 10 ? out : null;
  }
  m = /^([a-zì]+\.?) (\d{4})$/.exec(s);
  if (m) {
    const mi = monthIndex(m[1]);
    return mi < 0 ? null : partialDateFromParts(m[2], mi + 1);
  }
  return null;
}
