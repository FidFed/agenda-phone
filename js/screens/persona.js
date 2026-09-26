// Profilo di una persona, in sola lettura: foto (decifrata quando serve), Da ricordare / Da non dire, compleanno,
// primo incontro (con l'evento da cui deriva), ultima volta, campi della struttura, gruppi, cronologia di diario ed
// eventi, chi la cita. I documenti restano sul PC.
import { html, useEffect, useMemo, useRef, useState } from '../html.js';
import { useStore } from '../store.js';
import { eventHref, groupHref, personHref } from '../router.js';
import {
  backlinks, displayName, eventsOfPerson, fieldByRole, fieldValueText, fieldsOfSection, firstMeetingEvent, firstMet,
  groupsOfPerson, isEmptyValue, lastSeen, personSubtitle,
} from '../pc/domain.js';
import { compareDates, formatDate, formatNumber, parsePartialDate, relativeTime, todayISO } from '../pc/format.js';
import { Photo } from '../photos.js';
import {
  Callout, DocumentsNote, EmptyState, Icon, PhotoStrip, PhotoViewer, Row, Section, TagList, TopBar, useScrollMemory,
} from '../ui.js';
import { birthdayCountdown, birthdayInfo, birthdayLabel } from '../birthday.js';
import { latestDiaryNote, oneLine } from '../fatti.js';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// ---------------------------------------------------------------------------
// Valori dei campi
// ---------------------------------------------------------------------------

function refList(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.filter((r) => r && typeof r === 'object' && (r.personId || str(r.text).trim()));
}

function PersonRef({ archive, value }) {
  if (value.personId) {
    const p = archive.people?.[value.personId];
    if (!p) return html`<span class="faint">(persona eliminata)</span>`;
    return html`<a class="person-ref" href=${personHref(p.id)}><${Photo} person=${p} size=${24} round lazy=${false} /><span>${displayName(p)}</span></a>`;
  }
  return html`<span class="person-ref person-ref-text">${str(value.text).trim()}</span>`;
}

function safeUrl(v) {
  try {
    const u = new URL(str(v).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

export function FieldValue({ archive, field, value }) {
  if (!field || isEmptyValue(value)) return null;
  switch (field.type) {
    case 'longtext':
      return html`<div class="prewrap">${str(value)}</div>`;
    case 'date': {
      if (field.role === 'birthday') {
        const label = birthdayLabel(str(value));
        if (label) {
          const when = birthdayCountdown(str(value));
          return html`<span>${label}${when && html` <span class="badge badge-accent">${when}</span>`}</span>`;
        }
      }
      const rel = parsePartialDate(str(value)) ? relativeTime(str(value)) : '';
      return html`<span>${formatDate(str(value), { style: 'long' })}${rel && html`<span class="faint"> · ${rel}</span>`}</span>`;
    }
    case 'multichoice':
      return html`<span class="chips">${(Array.isArray(value) ? value : [value]).map(str).filter(Boolean).map((v) => html`<span key=${v} class="chip">${v}</span>`)}</span>`;
    case 'person':
    case 'people': {
      const refs = refList(value);
      return refs.length ? html`<span class="person-refs">${refs.map((r, i) => html`<${PersonRef} key=${r.personId || `t${i}`} archive=${archive} value=${r} />`)}</span>` : null;
    }
    case 'url': {
      const u = safeUrl(value);
      return u
        ? html`<a class="link break" href=${u} target="_blank" rel="noopener noreferrer">${str(value).replace(/^https?:\/\/(www\.)?/, '')}</a>`
        : html`<span class="break">${str(value)}</span>`;
    }
    default:
      return html`<span class="break">${fieldValueText(archive, field, value)}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Cronologia: diario + eventi, per anno
// ---------------------------------------------------------------------------

function Timeline({ archive, person, events }) {
  const items = useMemo(() => {
    const list = [];
    for (const d of person.diary || []) {
      if (!str(d?.text).trim()) continue;
      list.push({ kind: 'diary', key: `d:${d.id}`, date: str(d.date).trim(), created: str(d.createdAt), text: str(d.text) });
    }
    for (const { event, note } of events) {
      list.push({ kind: 'event', key: `e:${event.id}`, date: str(event.date).trim(), created: str(event.createdAt), event, note });
    }
    const valid = (d) => (parsePartialDate(d) ? d : '');
    list.sort((a, b) => {
      const da = valid(a.date);
      const db = valid(b.date);
      if (da && !db) return -1;
      if (!da && db) return 1;
      const c = compareDates(db, da);
      return c || b.created.localeCompare(a.created);
    });
    const groups = [];
    for (const it of list) {
      const p = parsePartialDate(it.date);
      const label = p ? String(p.year) : 'Senza data';
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(it);
    }
    return groups;
  }, [person.diary, events]);

  if (!items.length) return null;
  const count = items.reduce((n, g) => n + g.items.length, 0);
  return html`<${Section} title="Cronologia" icon="history" count=${count} className="timeline-section">
    ${items.map((g) => html`<div key=${g.label} class="tl-year">
      <h3 class="tl-year-label">${g.label}</h3>
      <ol class="timeline">
        ${g.items.map((it) => (it.kind === 'diary'
          ? html`<li key=${it.key} class="tl-item tl-diary">
              <span class="tl-dot" aria-hidden="true"><${Icon} name="note" size=${14} /></span>
              <div class="tl-body">
                <p class="tl-date">${it.date ? formatDate(it.date, { style: 'long' }) : 'Nota senza data'}</p>
                <p class="tl-text prewrap">${it.text}</p>
              </div>
            </li>`
          : html`<li key=${it.key} class="tl-item tl-event">
              <span class="tl-dot tl-dot-event" aria-hidden="true"><${Icon} name="calendar" size=${14} /></span>
              <div class="tl-body">
                <p class="tl-date">${it.date ? formatDate(it.date, { style: 'long' }) : 'Evento senza data'}</p>
                <a class="tl-title" href=${eventHref(it.event.id)}>${oneLine(it.event.title) || 'Evento senza titolo'}</a>
                ${it.event.place && html`<p class="tl-sub">${it.event.place}</p>`}
                ${it.note && html`<p class="tl-text prewrap">${it.note}</p>`}
              </div>
            </li>`))}
      </ol>
    </div>`)}
  </${Section}>`;
}

// ---------------------------------------------------------------------------
// Schermata
// ---------------------------------------------------------------------------

const TRAILING = new Set(['a', 'ad', 'al', 'alla', 'da', 'dal', 'dalla', 'di', 'del', 'della', 'in', 'con', 'su', 'per', 'tra', 'fra', 'tramite']);
function backlinkText(field, name) {
  const label = oneLine(field?.label) || 'Campo';
  if (field?.role === 'introducedBy') return html`Ha presentato <strong>${name}</strong>`;
  if (TRAILING.has(label.split(' ').pop().toLocaleLowerCase('it'))) return html`«${label}» nella scheda di <strong>${name}</strong>`;
  return html`${label} di <strong>${name}</strong>`;
}

export function PersonScreen({ params }) {
  const archive = useStore((s) => s.archive);
  const person = archive.people?.[params[0]];
  if (!person) {
    return html`<div class="screen">
      <${TopBar} title="Persona" back="#/persone" />
      <div class="content"><${EmptyState} icon="user" title="Questa persona non c'è nel pacchetto"
        text="Forse è stata eliminata sul PC, oppure il pacchetto è più vecchio del collegamento." /></div>
    </div>`;
  }
  return html`<${Profile} key=${person.id} archive=${archive} person=${person} />`;
}

function Profile({ archive, person }) {
  const schema = archive.schema;
  const name = displayName(person);
  const nick = oneLine(person.nickname);
  const subtitle = personSubtitle(archive, person);
  const photos = (person.photos || []).filter((p) => p && (p.fileId || p.thumbId));
  const [viewer, setViewer] = useState(null);
  const today = todayISO();

  const events = useMemo(() => eventsOfPerson(archive, person.id), [archive.events, person.id]);
  const groups = useMemo(() => groupsOfPerson(archive, person.id), [archive.groups, person.id]);
  const cited = useMemo(() => backlinks(archive, person.id, { hideReciprocal: true }), [archive.people, schema, person.id]);
  const seen = useMemo(() => lastSeen(archive, person.id, today), [events, today]);
  const met = useMemo(() => firstMet(archive, person), [person, schema, archive.events]);
  const metEvent = useMemo(() => firstMeetingEvent(archive, person) || (met.fromEvent ? met.event : null), [person, schema, archive.events, met]);
  const lastNote = useMemo(() => latestDiaryNote(person.diary, today), [person.diary, today]);

  const rememberField = fieldByRole(schema, 'remember');
  const avoidField = fieldByRole(schema, 'avoid');
  const remember = rememberField ? person.fields?.[rememberField.id] : undefined;
  const avoid = avoidField ? person.fields?.[avoidField.id] : undefined;
  const bField = fieldByRole(schema, 'birthday');
  const birthday = bField && bField.type === 'date' ? str(person.fields?.[bField.id]) : '';
  const bInfo = birthdayInfo(birthday, today);
  const bWhen = bInfo ? birthdayCountdown(birthday, { today }) : '';

  const sections = useMemo(() => (schema.sections || []).map((section) => ({
    section,
    fields: fieldsOfSection(schema, section.id).filter((f) => f.role !== 'remember' && f.role !== 'avoid' && !isEmptyValue(person.fields?.[f.id])),
  })).filter((s) => s.fields.length), [schema, person]);

  // Nome nella barra in alto solo quando l'intestazione è uscita dallo schermo.
  useScrollMemory(`persona|${person.id}`);
  const heroRef = useRef(null);
  const [heroOut, setHeroOut] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(([e]) => setHeroOut(!e.isIntersecting), { rootMargin: '-60px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const metDate = parsePartialDate(str(met.date)) ? formatDate(str(met.date), { style: 'long' }) : oneLine(met.date);
  const metContext = oneLine(met.context);
  const metTitle = metEvent ? oneLine(metEvent.title) : '';
  const metParts = [metDate, oneLine(met.place)].filter(Boolean);
  const contextIsEvent = !!metEvent && metContext && metContext === metTitle;
  const showNote = !!lastNote && (!seen || (lastNote.date && lastNote.date > str(seen.date)));

  const facts = [];
  if (bInfo) {
    facts.push(html`<li key="b" class="fact"><${Icon} name="star" size=${17} />
      <span><span class="fact-key">Compleanno</span> ${birthdayLabel(birthday, { today })}${bWhen && html` <span class="badge badge-accent">${bWhen}</span>`}</span></li>`);
  }
  if (metParts.length || metContext || metEvent || met.introducedBy) {
    facts.push(html`<li key="m" class="fact" data-testid="primo-incontro"><${Icon} name="history" size=${17} />
      <span><span class="fact-key">Primo incontro</span> ${[
        ...metParts,
        metContext && (contextIsEvent ? html`<a href=${eventHref(metEvent.id)}>${metContext}</a>` : metContext),
        metEvent && !contextIsEvent ? html`<a href=${eventHref(metEvent.id)}>${metTitle || 'evento senza titolo'}</a>` : null,
      ].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))}
      ${met.introducedBy && html`<span class="fact-extra"> · presentato da <${PersonRef} archive=${archive} value=${met.introducedBy} /></span>`}</span></li>`);
  }
  if (seen) {
    facts.push(html`<li key="s" class="fact"><${Icon} name="clock" size=${17} />
      <span><span class="fact-key">Ultima volta</span> ${formatDate(seen.date)} (${relativeTime(seen.date, today)}) · <a
        href=${eventHref(seen.event.id)}>${oneLine(seen.event.title) || 'evento'}</a></span></li>`);
  }
  if (showNote) {
    facts.push(html`<li key="n" class="fact"><${Icon} name="note" size=${17} />
      <span><span class="fact-key">Ultima nota${lastNote.date ? `, ${formatDate(lastNote.date)}` : ''}</span> <span class="clamp-3">${lastNote.text}</span></span></li>`);
  }

  return html`<div class="screen profile">
    <${TopBar} title=${html`<span class=${`topbar-name ${heroOut ? 'is-on' : ''}`}>${name}</span>`} back="#/persone" />
    <div class="content">
      <header class="hero" ref=${heroRef}>
        ${photos.length
          ? html`<button type="button" class="hero-photo" onClick=${() => setViewer(0)} aria-label="Apri la foto a tutto schermo">
              <${Photo} person=${person} big lazy=${false} size=${null} alt=${`Foto di ${name}`} />
            </button>`
          : html`<div class="hero-photo hero-photo-empty"><${Photo} person=${person} size=${null} lazy=${false} /></div>`}
        <h1 class="hero-name" data-testid="nome-persona">${name}</h1>
        ${nick && nick !== name && html`<p class="hero-nick">«${nick}»</p>`}
        ${subtitle && html`<p class="hero-sub">${subtitle}</p>`}
        <${TagList} archive=${archive} tags=${person.tags} />
      </header>

      ${!isEmptyValue(remember) && html`<${Callout} kind="accent" icon="star" title="Da ricordare" className="callout-remember">
        <${FieldValue} archive=${archive} field=${rememberField} value=${remember} />
      </${Callout}>`}
      ${!isEmptyValue(avoid) && html`<${Callout} kind="danger" icon="alert" title="Da non dire" className="callout-avoid">
        <${FieldValue} archive=${archive} field=${avoidField} value=${avoid} />
      </${Callout}>`}

      ${facts.length > 0 && html`<ul class="facts">${facts}</ul>`}

      ${sections.map(({ section, fields }) => html`<${Section} key=${section.id} title=${section.label}>
        <dl class="kv">
          ${fields.map((f) => html`<div key=${f.id} class="kv-row" data-field=${f.id}>
            <dt>${f.label}</dt>
            <dd>${f.role === 'firstMeetingContext' && contextIsEvent
              ? html`<a class="link" href=${eventHref(metEvent.id)}>${metContext}</a>`
              : html`<${FieldValue} archive=${archive} field=${f} value=${person.fields[f.id]} />`}</dd>
          </div>`)}
        </dl>
      </${Section}>`)}

      ${groups.length > 0 && html`<${Section} title="Gruppi" icon="building" count=${groups.length}>
        <ul class="list list-inset">${groups.map(({ group, role }) => html`<li key=${group.id}>
          <${Row} href=${groupHref(group.id)} leading=${html`<${Photo} group=${group} size=${40} />`}
            title=${group.name || '(gruppo senza nome)'} sub=${[role, group.kind].filter(Boolean).join(' · ')} />
        </li>`)}</ul>
      </${Section}>`}

      <${Timeline} archive=${archive} person=${person} events=${events} />

      ${cited.length > 0 && html`<${Section} title="Citata da" icon="link" count=${cited.length}>
        <ul class="list list-inset">${cited.map(({ person: other, field }) => html`<li key=${`${other.id}:${field.id}`}>
          <${Row} href=${personHref(other.id)} leading=${html`<${Photo} person=${other} size=${40} round />`}
            title=${backlinkText(field, displayName(other))} sub=${personSubtitle(archive, other)} />
        </li>`)}</ul>
      </${Section}>`}

      ${photos.length > 1 && html`<${Section} title="Foto" icon="image" count=${photos.length}>
        <${PhotoStrip} photos=${photos} label=${`Foto di ${name}`} />
      </${Section}>`}

      <${DocumentsNote} count=${(person.documents || []).length} />
      ${!sections.length && isEmptyValue(remember) && isEmptyValue(avoid) && !events.length && !(person.diary || []).length
        && html`<p class="muted small center">Il profilo è ancora quasi vuoto: completalo dal PC.</p>`}
      <p class="stamp">${events.length ? `${formatNumber(events.length)} ${events.length === 1 ? 'evento' : 'eventi'} insieme · ` : ''}sola lettura: le modifiche si fanno sul PC</p>
    </div>
    ${viewer !== null && html`<${PhotoViewer} photos=${photos} index=${viewer} label=${`Foto di ${name}`} onClose=${() => setViewer(null)} />`}
  </div>`;
}

