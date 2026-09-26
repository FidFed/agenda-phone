// Funzioni pure per "ricordarsi chi è": indici veloci (ultima volta visto, gruppi per persona), primo incontro in
// breve, ultima nota del diario, campi "di cosa parlare". Stesse regole delle schermate del PC (people.js, tags.js).
import {
  compareText, fieldByRole, fieldValueText, fieldsOfSection, personRefText, listGroups,
} from './pc/domain.js';
import { compareDates, formatDate, parsePartialDate, relativeTime, todayISO } from './pc/format.js';
import { normalizeText } from './pc/search.js';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const oneLine = (v) => str(v).replace(/\s+/g, ' ').trim();

const lastSeenCache = new WeakMap(); // archive.events → { today, map }
const groupsCache = new WeakMap(); // archive.groups → Map

/** Map(personId → { date, event }): evento più recente con data non futura (come lastSeen di domain.js). */
export function lastSeenIndex(archive, today = todayISO()) {
  const events = archive?.events || {};
  const hit = lastSeenCache.get(events);
  if (hit && hit.today === today) return hit.map;
  const map = new Map();
  for (const event of Object.values(events)) {
    const d = str(event?.date);
    if (!event || !parsePartialDate(d)) continue;
    if (d.slice(0, Math.min(d.length, 10)) > today.slice(0, d.length)) continue;
    for (const p of event.participants || []) {
      if (!p?.personId) continue;
      const cur = map.get(p.personId);
      const c = cur ? compareDates(d, cur.date) : 1;
      if (c > 0 || (c === 0 && str(event.createdAt) > str(cur.event.createdAt))) map.set(p.personId, { date: d, event });
    }
  }
  lastSeenCache.set(events, { today, map });
  return map;
}

/** Map(personId → [{ group, role }]) in ordine di nome del gruppo. */
export function groupsIndex(archive) {
  const groups = archive?.groups || {};
  let map = groupsCache.get(groups);
  if (map) return map;
  map = new Map();
  for (const group of listGroups(archive)) {
    const seen = new Set();
    for (const m of group.members || []) {
      if (!m?.personId || seen.has(m.personId)) continue;
      seen.add(m.personId);
      if (!map.has(m.personId)) map.set(m.personId, []);
      map.get(m.personId).push({ group, role: oneLine(m.role) });
    }
  }
  groupsCache.set(groups, map);
  return map;
}

/** "cena da Marco · Milano · mag 2019 · tramite Luca Bianchi" (primo incontro in breve, da firstMet). */
export function meetingText(archive, fm) {
  const parts = [];
  const ctx = oneLine(fm?.context);
  const place = oneLine(fm?.place);
  if (ctx) parts.push(ctx);
  if (place && !normalizeText(ctx).includes(normalizeText(place))) parts.push(place);
  if (parsePartialDate(str(fm?.date))) parts.push(formatDate(fm.date));
  const intro = fm?.introducedBy ? personRefText(archive, fm.introducedBy) : '';
  if (intro) parts.push(`tramite ${intro}`);
  return parts.join(' · ');
}

/** "6 set 2026 (3 settimane fa) · Cena da Marco" */
export function lastSeenText(last, today = todayISO()) {
  if (!last?.date) return '';
  const rel = relativeTime(last.date, today);
  return [`${formatDate(last.date)}${rel ? ` (${rel})` : ''}`, oneLine(last.event?.title)].filter(Boolean).join(' · ');
}

/** Nota del diario più recente con testo: { date, text } o null (una data non futura vince su quelle senza data). */
export function latestDiaryNote(diary, today = todayISO()) {
  let best = null;
  for (const d of Array.isArray(diary) ? diary : []) {
    const text = oneLine(d?.text);
    if (!text) continue;
    const raw = str(d.date).trim();
    const date = parsePartialDate(raw) ? raw : '';
    if (date && date.slice(0, 10) > today.slice(0, date.length)) continue;
    const cand = { date, text, created: str(d.createdAt) };
    if (!best) { best = cand; continue; }
    const byDate = cand.date && !best.date ? 1 : !cand.date && best.date ? -1 : compareDates(cand.date, best.date);
    if (byDate > 0 || (byDate === 0 && cand.created > best.created)) best = cand;
  }
  return best && { date: best.date, text: best.text };
}

const TOPIC_TYPES = new Set(['text', 'longtext', 'choice', 'multichoice']);

/** Campi "di cosa parlare": gli altri campi di testo senza ruolo nella sezione di "Da ricordare" (max 3). */
export function topicFields(schema, remember, avoid) {
  if (!remember?.sectionId) return [];
  return fieldsOfSection(schema, remember.sectionId)
    .filter((f) => f !== remember && f !== avoid && !f.role && TOPIC_TYPES.has(f.type || 'text'))
    .slice(0, 3);
}

/** «Interessi / di cosa parlare» → «Interessi». */
export function shortLabel(label) {
  const s = oneLine(label);
  return s.split(/\s+\/\s+|\s*\(/)[0].trim() || s;
}

/** Testo del campo con quel ruolo per la persona ("" se manca). */
export function roleValue(archive, person, role) {
  const f = fieldByRole(archive?.schema, role);
  return f ? oneLine(fieldValueText(archive, f, person?.fields?.[f.id])) : '';
}

/** Testo lungo del campo con quel ruolo (a capo preservati). */
export function roleLongValue(archive, person, role) {
  const f = fieldByRole(archive?.schema, role);
  return f ? str(fieldValueText(archive, f, person?.fields?.[f.id])).trim() : '';
}

export function hasPhoto(entity) {
  return Array.isArray(entity?.photos) && entity.photos.some((p) => p && (p.fileId || p.thumbId));
}

export const byName = (a, b) => compareText(a, b);
