// Eventi: elenco (dal più recente, con ricerca) e dettaglio in sola lettura.
import { html, useMemo, useState } from '../html.js';
import { onLock, useStore } from '../store.js';
import { href, personHref } from '../router.js';
import { displayName, eventParticipants, firstMeetingEvent, listEvents, personSubtitle } from '../pc/domain.js';
import { MONTHS_SHORT, formatDate, parsePartialDate, plural, relativeTime } from '../pc/format.js';
import { searchEvents } from '../pc/search.js';
import { Photo } from '../photos.js';
import {
  DocumentsNote, EmptyState, Icon, PhotoStrip, Row, SearchBox, Section, TagList, TopBar, useIncremental, useScrollMemory,
} from '../ui.js';

/** Data in un riquadro: "14 / nov / 2025", "nov / 2025", "2025" o "—". */
export function DateBadge({ date }) {
  const p = parsePartialDate(String(date || ''));
  if (!p) return html`<span class="date-box date-box-empty" aria-label="senza data">—</span>`;
  return html`<span class="date-box" aria-label=${formatDate(date, { style: 'long' })}>
    ${p.day ? html`<span class="date-box-day">${p.day}</span>` : null}
    ${p.month ? html`<span class="date-box-month">${MONTHS_SHORT[p.month - 1]}</span>` : null}
    <span class="date-box-year">${p.year}</span>
  </span>`;
}

let savedFilter = '';
onLock(() => { savedFilter = ''; });

export function EventsScreen() {
  const archive = useStore((s) => s.archive);
  const [filter, setFilterState] = useState(savedFilter);
  const setFilter = (v) => { savedFilter = v; setFilterState(v); };
  const all = useMemo(() => listEvents(archive), [archive.events]);
  const shown = useMemo(() => (filter.trim() ? searchEvents(archive, filter).map((r) => r.event) : all), [archive, all, filter]);
  const { limit, sentinelRef } = useIncremental(shown.length, filter, 60);
  useScrollMemory('eventi');

  return html`<div class="screen">
    <${TopBar} title="Eventi" subtitle=${all.length ? plural(all.length, 'evento', 'eventi') : ''}>
      ${all.length > 0 && html`<div class="topbar-tools"><${SearchBox} value=${filter} onInput=${setFilter}
        placeholder="Cerca: titolo, luogo, chi c'era…" label="Cerca tra gli eventi" /></div>`}
    </${TopBar}>
    <div class="content">
      ${!all.length
        ? html`<${EmptyState} icon="calendar" title="Nessun evento" text="Gli eventi (cene, convegni…) si aggiungono dal PC." />`
        : !shown.length
          ? html`<${EmptyState} icon="search" title=${`Nessun evento corrisponde a «${filter.trim()}»`} />`
          : html`<ul class="list" aria-label="Eventi">
              ${shown.slice(0, limit).map((e) => html`<li key=${e.id}>
                <${Row} href=${`#/evento/${encodeURIComponent(e.id)}`} leading=${html`<${DateBadge} date=${e.date} />`}
                  title=${e.title || '(evento senza titolo)'}
                  sub=${[e.place, plural((e.participants || []).length, 'partecipante', 'partecipanti')].filter(Boolean).join(' · ')} />
              </li>`)}
            </ul>
            ${limit < shown.length && html`<div class="more" ref=${sentinelRef}>Carico gli altri eventi…</div>`}`}
    </div>
  </div>`;
}

export function EventScreen({ params }) {
  const archive = useStore((s) => s.archive);
  const event = archive.events?.[params[0]];
  useScrollMemory(`evento|${params[0]}`);
  const participants = useMemo(() => (event ? eventParticipants(archive, event) : []), [archive.people, event]);
  if (!event) {
    return html`<div class="screen">
      <${TopBar} title="Evento" back="#/eventi" />
      <div class="content"><${EmptyState} icon="calendar" title="Questo evento non c'è nel pacchetto" /></div>
    </div>`;
  }
  const title = event.title || '(evento senza titolo)';
  const rel = parsePartialDate(String(event.date || '')) ? relativeTime(event.date) : '';
  return html`<div class="screen">
    <${TopBar} title="Evento" back="#/eventi" />
    <div class="content">
      <header class="detail-head">
        <${DateBadge} date=${event.date} />
        <div class="detail-titles">
          <h1 class="detail-title" data-testid="titolo-evento">${title}</h1>
          <p class="detail-sub">
            ${event.date ? html`<span>${formatDate(event.date, { style: 'weekday' })}${rel ? ` · ${rel}` : ''}</span>` : html`<span>Senza data</span>`}
            ${event.place && html`<span class="detail-place"><${Icon} name="map-pin" size=${15} />${event.place}</span>`}
          </p>
        </div>
      </header>
      <${TagList} archive=${archive} tags=${event.tags} />
      ${event.notes && html`<${Section} title="Note" icon="note"><p class="prewrap">${event.notes}</p></${Section}>`}

      <${Section} title="Chi c'era" icon="users" count=${participants.length}
        action=${participants.length > 0 && html`<a class="btn btn-secondary btn-s" href=${href('/ripasso', { evento: event.id })}><${Icon} name="cards" size=${16} />Ripassa</a>`}>
        ${participants.length
          ? html`<ul class="list list-inset">${participants.map(({ person, note }) => {
              const first = firstMeetingEvent(archive, person)?.id === event.id;
              return html`<li key=${person.id}>
                <${Row} href=${personHref(person.id)} leading=${html`<${Photo} person=${person} size=${44} round />`}
                  title=${displayName(person)} sub=${personSubtitle(archive, person)}
                  extra=${[note && html`<span class="prewrap">${note}</span>`, first && html`<span class="badge badge-accent">primo incontro</span>`].filter(Boolean)} />
              </li>`;
            })}</ul>`
          : html`<p class="muted">Nessun partecipante.</p>`}
      </${Section}>

      ${(event.photos || []).length > 0 && html`<${Section} title="Foto" icon="image" count=${event.photos.length}>
        <${PhotoStrip} photos=${event.photos} label="Foto dell'evento" />
      </${Section}>`}
      <${DocumentsNote} count=${(event.documents || []).length} />
    </div>
  </div>`;
}
