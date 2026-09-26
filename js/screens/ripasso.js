// Ripasso a flashcard come sul PC (foto → nome, indizi → nome) con ripetizione spaziata Leitner (domain.nextReview).
// I progressi restano sul telefono, cifrati (store.saveReview), e partono dallo stato del PC contenuto nel pacchetto.
//   #/ripasso  (?tag=<codice del tag, tagroute.js> | ?gruppo=<id> | ?evento=<id>)
// Indizi: mai il nome, e mai quello che è uguale per tutto il mazzo (il tag, il gruppo, l'evento del mazzo).
import { html, useEffect, useMemo, useRef, useState } from '../html.js';
import { onLock, saveReview, useStore } from '../store.js';
import { navigate, personHref } from '../router.js';
import { tagFromToken, tagToken } from '../tagroute.js';
import {
  allTags, compareText, displayName, fieldByRole, fieldValueText, fullName, hasTag, isEmptyValue, isNewForReview,
  linkedFirstMeetingEvent, listEvents, listGroups, nextReview, personRefText, personSubtitle, reviewDue, sameTag,
} from '../pc/domain.js';
import { compareDates, formatDate, parsePartialDate, plural, todayISO } from '../pc/format.js';
import { Photo, fileUrl, pickFile } from '../photos.js';
import { Callout, EmptyState, Icon, Segmented, TagChip, TopBar, useScrollMemory } from '../ui.js';
import { groupsIndex, hasPhoto, oneLine } from '../fatti.js';

const PREFS_KEY = 'agenda-telefono:ripasso';
const MODES = [
  { value: 'auto', label: 'Automatico', hint: 'La foto, se c\'è; altrimenti gli indizi.' },
  { value: 'photo', label: 'Foto', hint: 'Riconosci il volto: solo le persone con una foto.' },
  { value: 'clues', label: 'Indizi', hint: 'Lavoro, città, aspetto, primo incontro, tag e gruppi. Mai il nome.' },
];
const SIZES = [{ value: '10', label: '10' }, { value: '20', label: '20' }, { value: '50', label: '50' }, { value: 'all', label: 'Tutte' }];
const GRADES = [
  { value: 'no', label: 'Non ricordavo', icon: 'x' },
  { value: 'quasi', label: 'Quasi', icon: 'minus' },
  { value: 'si', label: 'Sì', icon: 'check' },
];

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Sessione in corso tenuta fuori dal componente: aprire un profilo e tornare indietro non la perde. Via al blocco.
let current = null;
onLock(() => { current = null; });

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      mode: MODES.some((m) => m.value === p.mode) ? p.mode : 'auto',
      size: SIZES.some((s) => s.value === p.size) ? p.size : '20',
    };
  } catch {
    return { mode: 'auto', size: '20' };
  }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignora */ }
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deckFromQuery(query) {
  if (query.tag) {
    const name = tagFromToken(query.tag);
    return name ? { kind: 'tag', value: name } : null;
  }
  if (query.gruppo) return { kind: 'group', value: query.gruppo };
  if (query.evento) return { kind: 'event', value: query.evento };
  return null;
}

function defaultDeck(archive, today) {
  const people = Object.values(archive.people || {});
  if (people.some((p) => p && reviewDue(archive, p.id, today))) return { kind: 'due' };
  if (people.some((p) => p && isNewForReview(archive, p.id))) return { kind: 'new' };
  return { kind: 'all' };
}

function deckPeople(archive, deck, today) {
  const people = archive.people || {};
  const all = () => Object.values(people).filter(Boolean);
  const byIds = (ids) => Array.from(new Set(ids.filter((id) => id && people[id]))).map((id) => people[id]);
  switch (deck?.kind) {
    case 'due': return all().filter((p) => reviewDue(archive, p.id, today));
    case 'new': return all().filter((p) => isNewForReview(archive, p.id));
    case 'tag': return all().filter((p) => hasTag(p.tags, deck.value));
    case 'group': return byIds((archive.groups?.[deck.value]?.members || []).map((m) => m?.personId));
    case 'event': return byIds((archive.events?.[deck.value]?.participants || []).map((m) => m?.personId));
    case 'errors': return byIds(deck.ids || []);
    default: return all();
  }
}

function deckTitle(archive, deck) {
  switch (deck?.kind) {
    case 'due': return 'Da ripassare oggi';
    case 'new': return 'Mai ripassate';
    case 'tag': return `Tag «${deck.value}»`;
    case 'group': return `Gruppo «${archive.groups?.[deck.value]?.name || 'senza nome'}»`;
    case 'event': return `Evento «${archive.events?.[deck.value]?.title || 'senza titolo'}»`;
    case 'errors': return 'Errori da ripassare';
    default: return 'Tutte le persone';
  }
}

/** Evento datato più vecchio a cui ciascuno ha partecipato (come firstMet per le schede senza evento collegato). */
const oldestCache = new WeakMap();
function oldestIndex(archive) {
  const events = archive.events || {};
  let map = oldestCache.get(events);
  if (map) return map;
  map = new Map();
  for (const event of Object.values(events)) {
    const d = str(event?.date);
    if (!event || !parsePartialDate(d)) continue;
    for (const part of event.participants || []) {
      const id = part?.personId;
      if (!id) continue;
      const cur = map.get(id);
      const c = cur ? compareDates(d, str(cur.date)) : -1;
      if (c < 0 || (c === 0 && cur !== event && str(event.createdAt) < str(cur.createdAt))) map.set(id, event);
    }
  }
  oldestCache.set(events, map);
  return map;
}

function firstMetIndexed(archive, person) {
  const schema = archive.schema;
  const val = (role) => {
    const f = fieldByRole(schema, role);
    return f ? person?.fields?.[f.id] : undefined;
  };
  const intro = val('introducedBy');
  const res = {
    date: str(val('firstMeetingDate')), place: str(val('firstMeetingPlace')), context: str(val('firstMeetingContext')),
    introducedBy: Array.isArray(intro) ? (intro.find((r) => !isEmptyValue(r)) || null) : (isEmptyValue(intro) ? null : intro),
    event: null, from: { date: false, place: false, context: false },
  };
  if (res.date && res.place && res.context) return res;
  const linked = linkedFirstMeetingEvent(archive, person);
  const ev = linked || (typeof person.firstMeetingEventId === 'string' ? null : oldestIndex(archive).get(person.id));
  if (ev) {
    res.event = ev;
    if (!res.date && ev.date) { res.date = ev.date; res.from.date = true; }
    if (!res.place && ev.place) { res.place = ev.place; res.from.place = true; }
    if (!res.context && ev.title) { res.context = ev.title; res.from.context = true; }
  }
  return res;
}

const norm = (s) => oneLine(s).toLocaleLowerCase('it');

function sameAsDeckEvent(archive, deck, met, part) {
  if (deck?.kind !== 'event') return false;
  const ev = archive.events?.[deck.value];
  if (!ev) return false;
  const fromEv = !!met.event && met.event.id === ev.id;
  if (fromEv && met.from[part]) return true;
  const isDeckMeeting = (fromEv && (met.from.context || met.from.place || met.from.date))
    || (!!norm(ev.title) && norm(met.context) === norm(ev.title))
    || (!norm(met.context) && !!ev.date && str(met.date) === str(ev.date));
  if (!isDeckMeeting) return false;
  const evValue = { context: ev.title, place: ev.place, date: ev.date }[part];
  const value = { context: met.context, place: met.place, date: met.date }[part];
  return !!norm(value) && norm(value) === norm(evValue);
}

/** Indizi (mai il nome): lavoro, città, aspetto, primo incontro, presentato da, gruppi, tag. */
function cluesOf(archive, person, deck) {
  const schema = archive.schema;
  const out = [];
  const roleClue = (role, icon, fallback) => {
    const f = fieldByRole(schema, role);
    if (!f) return;
    const text = str(fieldValueText(archive, f, person.fields?.[f.id])).trim();
    if (text) out.push({ id: role, icon, label: f.label || fallback, text });
  };
  roleClue('job', 'user', 'Lavoro');
  roleClue('city', 'map-pin', 'Città');
  roleClue('appearance', 'eye', 'Segni particolari');
  const met = firstMetIndexed(archive, person);
  const metParts = [['context', met.context], ['place', met.place], ['date', met.date ? formatDate(met.date, { style: 'long' }) : '']]
    .filter(([part]) => !sameAsDeckEvent(archive, deck, met, part))
    .map(([, s]) => oneLine(s))
    .filter(Boolean);
  if (metParts.length) out.push({ id: 'firstMet', icon: 'calendar', label: 'Primo incontro', text: metParts.join(' · ') });
  if (met.introducedBy) {
    const who = personRefText(archive, met.introducedBy);
    if (who) out.push({ id: 'introducedBy', icon: 'user-plus', label: 'Presentato da', text: who });
  }
  const mine = groupsIndex(archive).get(person.id) || [];
  const deckGroup = deck?.kind === 'group' ? deck.value : null;
  const deckRole = deckGroup ? oneLine(mine.find((x) => x.group.id === deckGroup)?.role) : '';
  if (deckRole) out.push({ id: 'deckRole', icon: 'building', label: 'Ruolo nel gruppo', text: deckRole });
  const groups = mine.filter((x) => x.group.id !== deckGroup).map(({ group, role }) => (role ? `${group.name} (${role})` : group.name)).filter((s) => oneLine(s));
  if (groups.length) out.push({ id: 'groups', icon: 'building', label: groups.length === 1 ? 'Gruppo' : 'Gruppi', text: groups.join(' · ') });
  const deckTag = deck?.kind === 'tag' ? deck.value : null;
  const tags = (person.tags || []).filter((t) => oneLine(t) && !(deckTag && sameTag(t, deckTag)));
  if (tags.length) out.push({ id: 'tags', icon: 'tag', label: 'Tag', tags });
  return out;
}

/** "photo" | "clues" | null (non ripassabile in questa modalità). */
function cardKind(archive, person, mode, deck) {
  const photo = hasPhoto(person) && !!pickFile(person.photos.find((p) => p && (p.fileId || p.thumbId)), true);
  if (mode === 'photo') return photo ? 'photo' : null;
  if (mode !== 'clues' && photo) return 'photo';
  return cluesOf(archive, person, deck).length ? 'clues' : null;
}

function buildQueue(archive, people, size, today) {
  const review = archive.review || {};
  const rank = (p) => (reviewDue(archive, p.id, today) ? 0 : isNewForReview(archive, p.id) ? 1 : 2);
  const ordered = shuffle(people)
    .map((p, i) => ({ p, i, r: rank(p), due: str(review[p.id]?.due) }))
    .sort((a, b) => a.r - b.r || (a.r !== 1 && a.due !== b.due ? (a.due < b.due ? -1 : 1) : 0) || a.i - b.i)
    .map((x) => x.p.id);
  const n = size === 'all' ? ordered.length : Math.max(1, Number(size) || 20);
  return shuffle(ordered.slice(0, n));
}

// ---------------------------------------------------------------------------
// Pannello iniziale
// ---------------------------------------------------------------------------

function StartPanel({ archive, deck, setDeck, mode, setMode, size, setSize, today, onStart }) {
  const people = useMemo(() => Object.values(archive.people || {}).filter(Boolean), [archive.people]);
  const counts = useMemo(() => {
    let due = 0;
    let fresh = 0;
    for (const p of people) {
      if (reviewDue(archive, p.id, today)) due++;
      else if (isNewForReview(archive, p.id)) fresh++;
    }
    return { due, fresh, all: people.length };
  }, [people, archive.review, today]);
  const tagOptions = useMemo(() => allTags(archive).filter((t) => t.peopleCount > 0), [archive.people]);
  const groupOptions = useMemo(() => listGroups(archive).filter((g) => (g.members || []).some((m) => archive.people?.[m?.personId])), [archive.groups, archive.people]);
  const eventOptions = useMemo(() => listEvents(archive).filter((e) => (e.participants || []).some((m) => archive.people?.[m?.personId])), [archive.events, archive.people]);

  const inDeck = useMemo(() => deckPeople(archive, deck, today), [archive.people, archive.review, archive.groups, archive.events, deck, today]);
  const eligible = useMemo(() => inDeck.filter((p) => cardKind(archive, p, mode, deck)), [inDeck, mode, deck, archive.schema]);
  const excluded = inDeck.length - eligible.length;
  const sessionCount = size === 'all' ? eligible.length : Math.min(eligible.length, Number(size));
  const pick = (kind) => {
    setDeck({ kind });
    navigate('#/ripasso', { replace: true });
  };
  const pickFilter = (kind, value) => {
    const param = { tag: 'tag', group: 'gruppo', event: 'evento' }[kind];
    const v = kind === 'tag' ? tagToken(value) : value; // mai il nome del tag nell'indirizzo
    if (v) navigate(`#/ripasso?${param}=${encodeURIComponent(v)}`, { replace: true });
    else pick(counts.due ? 'due' : counts.fresh ? 'new' : 'all');
  };

  const deckBtn = ({ kind, icon, title, count, desc }) => html`<button key=${kind} type="button" role="radio"
    aria-checked=${deck.kind === kind ? 'true' : 'false'} class=${`deck ${deck.kind === kind ? 'is-on' : ''}`} onClick=${() => pick(kind)}>
    <span class="deck-icon" aria-hidden="true"><${Icon} name=${icon} size=${18} /></span>
    <span class="deck-text"><span class="deck-title">${title}</span><span class="deck-desc">${desc}</span></span>
    <span class="deck-count">${count}</span>
  </button>`;

  let empty = null;
  if (!inDeck.length) {
    empty = deck.kind === 'due'
      ? html`<${Callout} kind="success" title="Oggi non c'è nessuno da ripassare">Se vuoi allenarti comunque, scegli «Mai ripassate» o «Tutte».</${Callout}>`
      : deck.kind === 'new'
        ? html`<${Callout} kind="success" title="Hai già ripassato tutte le persone almeno una volta">Scegli «Da ripassare oggi» o «Tutte».</${Callout}>`
        : html`<${Callout} kind="info" title="Nessuna persona in questo mazzo">Scegline un altro.</${Callout}>`;
  } else if (!eligible.length) {
    empty = mode === 'photo'
      ? html`<${Callout} kind="warning" title="Nessuna di queste persone ha una foto nel pacchetto">Prova con gli indizi.</${Callout}>`
      : html`<${Callout} kind="warning" title="Non ci sono abbastanza informazioni">Per queste persone non ho né foto né indizi.</${Callout}>`;
  }

  return html`<div class="review-setup">
    <section class="step">
      <h2 class="step-title">Chi vuoi ripassare?</h2>
      <div class="decks" role="radiogroup" aria-label="Mazzo">
        ${deckBtn({ kind: 'due', icon: 'clock', title: 'Da ripassare oggi', count: counts.due, desc: 'Chi è ora di rivedere' })}
        ${deckBtn({ kind: 'new', icon: 'sparkles', title: 'Mai ripassate', count: counts.fresh, desc: 'Chi non hai ancora provato' })}
        ${deckBtn({ kind: 'all', icon: 'users', title: 'Tutte', count: counts.all, desc: 'Tutte le persone' })}
      </div>
      <div class="selects">
        ${tagOptions.length > 0 && html`<label class="select-field"><span>Per tag</span>
          <select value=${deck.kind === 'tag' ? deck.value : ''} onChange=${(e) => pickFilter('tag', e.currentTarget.value)}>
            <option value="">Scegli un tag…</option>
            ${tagOptions.map((t) => html`<option key=${t.name} value=${t.name}>${t.name} (${t.peopleCount})</option>`)}
          </select></label>`}
        ${groupOptions.length > 0 && html`<label class="select-field"><span>Per gruppo</span>
          <select value=${deck.kind === 'group' ? deck.value : ''} onChange=${(e) => pickFilter('group', e.currentTarget.value)}>
            <option value="">Scegli un gruppo…</option>
            ${groupOptions.map((g) => html`<option key=${g.id} value=${g.id}>${g.name || 'Gruppo senza nome'}</option>`)}
          </select></label>`}
        ${eventOptions.length > 0 && html`<label class="select-field"><span>Per evento</span>
          <select value=${deck.kind === 'event' ? deck.value : ''} onChange=${(e) => pickFilter('event', e.currentTarget.value)}>
            <option value="">Scegli un evento…</option>
            ${eventOptions.map((e) => html`<option key=${e.id} value=${e.id}>${e.title || 'Evento senza titolo'}${e.date ? ` · ${formatDate(e.date)}` : ''}</option>`)}
          </select></label>`}
      </div>
    </section>
    <section class="step">
      <h2 class="step-title">Come vuoi riconoscerle?</h2>
      <${Segmented} label="Modalità" value=${mode} onChange=${setMode} options=${MODES} className="segmented-full" />
      <p class="step-hint">${MODES.find((m) => m.value === mode)?.hint}</p>
    </section>
    <section class="step">
      <h2 class="step-title">Quante per volta?</h2>
      <${Segmented} label="Schede per sessione" value=${size} onChange=${setSize} options=${SIZES} className="segmented-full" />
    </section>
    <div class="review-start">
      ${empty || html`<p class="review-summary-line" data-testid="riepilogo-mazzo"><strong>${plural(sessionCount, 'scheda', 'schede')}</strong>
        <span class="muted"> · ${deckTitle(archive, deck)}</span>
        ${excluded > 0 && html`<span class="muted small"> · ${plural(excluded, 'esclusa', 'escluse')} (${mode === 'photo' ? 'senza foto' : 'senza foto né indizi'})</span>`}</p>`}
      <button type="button" class="btn btn-primary btn-block btn-l" disabled=${!eligible.length}
        onClick=${() => onStart(eligible.map((p) => p.id))}><${Icon} name="cards" size=${20} />Inizia</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Scheda, sessione, riepilogo
// ---------------------------------------------------------------------------

function Clues({ archive, clues }) {
  return html`<ul class="clues">
    ${clues.map((c) => html`<li key=${c.id} class="clue">
      <span class="clue-icon" aria-hidden="true"><${Icon} name=${c.icon} size=${17} /></span>
      <span class="clue-body">
        <span class="clue-label">${c.label}</span>
        ${c.tags ? html`<span class="tag-list">${c.tags.map((t) => html`<${TagChip} key=${t} archive=${archive} name=${t} size="s" />`)}</span>`
          : html`<span class="clue-text prewrap">${c.text}</span>`}
      </span>
    </li>`)}
  </ul>`;
}

function Card({ archive, person, kind, deck, revealed, onReveal, onGrade }) {
  const clues = useMemo(() => cluesOf(archive, person, deck), [archive, person, deck]);
  const remember = (() => { const f = fieldByRole(archive.schema, 'remember'); return f ? str(fieldValueText(archive, f, person.fields?.[f.id])).trim() : ''; })();
  const avoid = (() => { const f = fieldByRole(archive.schema, 'avoid'); return f ? str(fieldValueText(archive, f, person.fields?.[f.id])).trim() : ''; })();
  const subtitle = personSubtitle(archive, person);
  const revealRef = useRef(null);
  const gradesRef = useRef(null);
  useEffect(() => {
    if (!revealed) revealRef.current?.focus({ preventScroll: true });
    else gradesRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [revealed, person.id]);
  return html`<article class=${`card-review ${revealed ? 'is-revealed' : ''}`} data-testid="scheda-ripasso">
    <div class="card-front">
      ${kind === 'photo'
        ? html`<div class="card-photo"><${Photo} person=${person} big lazy=${false} size=${null} alt="Foto della persona da riconoscere" /></div>`
        : revealed
          // dopo la risposta gli indizi si chiudono: nome, avvisi e voti restano nello schermo
          ? html`<details class="card-more"><summary>Indizi</summary><${Clues} archive=${archive} clues=${clues} /></details>`
          : html`<${Clues} archive=${archive} clues=${clues} />`}
    </div>
    ${!revealed
      ? html`<div class="card-question">
          <p class="card-q">Chi è?</p>
          <button type="button" ref=${revealRef} class="btn btn-primary btn-block btn-l" onClick=${onReveal}><${Icon} name="eye" size=${20} />Mostra</button>
        </div>`
      : html`<div class="card-answer" aria-live="polite">
          <div class="card-answer-head">
            ${kind !== 'photo' && html`<${Photo} person=${person} size=${56} round lazy=${false} />`}
            <div>
              <h2 class="card-name" data-testid="nome-ripasso">${fullName(person)}</h2>
              ${subtitle && html`<p class="muted">${subtitle}</p>`}
            </div>
          </div>
          ${kind === 'photo' && clues.length > 0 && html`<details class="card-more"><summary>Altri indizi</summary><${Clues} archive=${archive} clues=${clues} /></details>`}
          ${remember && html`<${Callout} kind="accent" title="Da ricordare"><span class="prewrap">${remember}</span></${Callout}>`}
          ${avoid && html`<${Callout} kind="danger" title="Da non dire"><span class="prewrap">${avoid}</span></${Callout}>`}
          <a class="link card-open" href=${personHref(person.id)}><${Icon} name="user" size=${15} /> Apri il profilo</a>
          <p class="grades-title">Te lo ricordavi?</p>
          <div class="grades" ref=${gradesRef} role="group" aria-label="Ti ricordavi di questa persona?">
            ${GRADES.map((g) => html`<button key=${g.value} type="button" class=${`grade grade-${g.value}`} onClick=${() => onGrade(g.value)}>
              <${Icon} name=${g.icon} size=${20} /><span>${g.label}</span></button>`)}
          </div>
        </div>`}
  </article>`;
}

function Summary({ archive, s, onRetry, onFinish }) {
  const entries = Object.entries(s.results);
  const tally = { si: 0, quasi: 0, no: 0 };
  for (const [, r] of entries) tally[r.first] = (tally[r.first] || 0) + 1;
  const toReview = entries.filter(([, r]) => r.first !== 'si').map(([id, r]) => ({ person: archive.people?.[id], first: r.first }))
    .filter((x) => x.person)
    .sort((a, b) => (a.first === b.first ? compareText(displayName(a.person), displayName(b.person)) : a.first === 'no' ? -1 : 1));
  const errors = entries.filter(([id, r]) => r.first === 'no' && archive.people?.[id]).map(([id]) => id);
  const total = entries.length;
  const message = !total ? 'Non hai risposto a nessuna scheda.'
    : !tally.no && !tally.quasi ? 'Perfetto: hai riconosciuto tutte le persone.'
      : tally.si >= total / 2 ? 'Buon lavoro. Dai un\'occhiata a chi non ricordavi.'
        : 'Ci vuole un po\' di pratica: ripassa chi non ricordavi.';
  return html`<div class="review-summary" data-testid="riepilogo-ripasso">
    <h2 class="h2">Sessione finita</h2>
    <p class="muted">${message}</p>
    <div class="tally">
      <div class="tally-item tally-si"><span class="tally-num" data-testid="conteggio-si">${tally.si}</span><span>Sì</span></div>
      <div class="tally-item tally-quasi"><span class="tally-num">${tally.quasi}</span><span>Quasi</span></div>
      <div class="tally-item tally-no"><span class="tally-num" data-testid="conteggio-no">${tally.no}</span><span>Non ricordavo</span></div>
    </div>
    ${toReview.length > 0 && html`<ul class="list list-inset">${toReview.map(({ person, first }) => html`<li key=${person.id}>
      <a class="row" href=${personHref(person.id)}>
        <span class="row-lead"><${Photo} person=${person} size=${40} round /></span>
        <span class="row-main"><span class="row-title">${fullName(person)}</span><span class="row-sub">${personSubtitle(archive, person)}</span></span>
        <span class=${`badge ${first === 'no' ? 'badge-danger' : 'badge-warning'}`}>${first === 'no' ? 'Non ricordavo' : 'Quasi'}</span>
      </a></li>`)}</ul>`}
    <p class="muted small">I progressi restano su questo telefono.</p>
    <div class="summary-actions">
      ${errors.length > 0 && html`<button type="button" class="btn btn-secondary btn-block" onClick=${() => onRetry(errors)}><${Icon} name="refresh" size=${18} />Ripassa gli errori (${errors.length})</button>`}
      <button type="button" class="btn btn-primary btn-block" onClick=${onFinish}><${Icon} name="check" size=${18} />Fine</button>
    </div>
  </div>`;
}

export function ReviewScreen({ query }) {
  const archive = useStore((s) => s.archive);
  const today = todayISO();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [deck, setDeck] = useState(() => deckFromQuery(query) || current?.deckChoice || defaultDeck(archive, today));
  const [s, setS] = useState(current);
  const setSession = (fn) => setS((prev) => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    current = next;
    return next;
  });
  const graded = useRef('');
  useScrollMemory('ripasso');

  const queryKey = `${query.tag || ''}|${query.gruppo || ''}|${query.evento || ''}`;
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    const d = deckFromQuery(query);
    if (d) { setDeck(d); setSession(null); }
  }, [queryKey]);

  const setMode = (mode) => { const p = { ...prefs, mode }; setPrefs(p); savePrefs(p); };
  const setSize = (size) => { const p = { ...prefs, size }; setPrefs(p); savePrefs(p); };

  const start = (ids, { all = false, fromDeck = deck, title = deckTitle(archive, deck) } = {}) => {
    const people = ids.map((id) => archive.people?.[id]).filter(Boolean);
    const queue = all ? shuffle(people.map((p) => p.id)) : buildQueue(archive, people, prefs.size, today);
    if (!queue.length) return;
    setSession({ sid: Date.now(), phase: 'session', queue, pos: 0, revealed: false, results: {}, requeued: [], mode: prefs.mode, deck: fromDeck, title, deckChoice: deck });
    window.scrollTo(0, 0);
  };

  const grade = (g) => {
    if (!s || s.phase !== 'session' || !s.revealed) return;
    const key = `${s.sid}:${s.pos}`;
    if (graded.current === key) return;
    graded.current = key;
    const id = s.queue[s.pos];
    if (archive.people?.[id]) saveReview(id, nextReview(archive.review?.[id] || null, g, todayISO()));
    setSession((cur) => {
      if (!cur || cur.queue[cur.pos] !== id) return cur;
      const results = { ...cur.results };
      const r = results[id];
      results[id] = { first: r ? r.first : g, last: g };
      let { queue, requeued } = cur;
      if (g === 'no' && !requeued.includes(id)) { queue = [...queue, id]; requeued = [...requeued, id]; }
      const pos = cur.pos + 1;
      return { ...cur, results, queue, requeued, pos, revealed: false, phase: pos >= queue.length ? 'summary' : 'session' };
    });
    window.scrollTo(0, 0);
  };

  // Precarica la foto della prossima scheda
  useEffect(() => {
    if (s?.phase !== 'session') return;
    const next = archive.people?.[s.queue[s.pos + 1]];
    const ref = next?.photos?.find((p) => p && (p.fileId || p.thumbId));
    const id = pickFile(ref, true);
    if (id) fileUrl(id);
  }, [s?.pos, s?.phase]);

  const peopleCount = Object.keys(archive.people || {}).length;
  let body;
  if (!peopleCount) {
    body = html`<${EmptyState} icon="cards" title="Non c'è ancora nessuno da ripassare" />`;
  } else if (s?.phase === 'session') {
    const id = s.queue[s.pos];
    const person = archive.people?.[id];
    const kind = person ? cardKind(archive, person, s.mode, s.deck) || (hasPhoto(person) ? 'photo' : 'clues') : null;
    body = html`<div class="session">
      <div class="progress-row">
        <span class="progress-count" data-testid="contatore-ripasso">${Math.min(s.pos + 1, s.queue.length)} di ${s.queue.length}</span>
        <span class="muted small grow truncate">${s.title}</span>
        <button type="button" class="btn btn-ghost btn-s" onClick=${() => setSession((cur) => (Object.keys(cur.results).length ? { ...cur, phase: 'summary' } : null))}>
          <${Icon} name="x" size=${16} />Termina</button>
      </div>
      <div class="progress" role="progressbar" aria-label="Avanzamento" aria-valuemin="0" aria-valuemax=${s.queue.length} aria-valuenow=${s.pos}>
        <span style=${`width:${(s.pos / s.queue.length) * 100}%`}></span>
      </div>
      ${person
        ? html`<${Card} key=${`${id}-${s.pos}`} archive=${archive} person=${person} kind=${kind} deck=${s.deck} revealed=${s.revealed}
            onReveal=${() => setSession((cur) => ({ ...cur, revealed: true }))} onGrade=${grade} />`
        : html`<${EmptyState} icon="user" title="Questa persona non c'è più" />`}
    </div>`;
  } else if (s?.phase === 'summary') {
    body = html`<${Summary} archive=${archive} s=${s}
      onRetry=${(ids) => start(ids, { all: true, fromDeck: s.deck, title: deckTitle(archive, { kind: 'errors' }) })}
      onFinish=${() => setSession(null)} />`;
  } else {
    body = html`<${StartPanel} archive=${archive} deck=${deck} setDeck=${setDeck} mode=${prefs.mode} setMode=${setMode}
      size=${prefs.size} setSize=${setSize} today=${today} onStart=${(ids) => start(ids)} />`;
  }

  return html`<div class="screen">
    <${TopBar} title="Ripasso" subtitle=${s?.phase === 'session' ? '' : 'Guarda la foto o gli indizi e prova a ricordare chi è'} />
    <div class="content">${body}</div>
  </div>`;
}
