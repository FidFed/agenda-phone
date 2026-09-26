// Tag: elenco e pagina del tag. Caso d'uso chiave: "vado a un convegno di diritto commerciale, fammi vedere tutte
// le persone di quel mondo". Galleria con le foto, oppure "Scheda rapida": una scheda densa per persona con tutto
// quello che serve a ricordarsela (come sul PC), da scorrere in due minuti prima di entrare.
import { html, useMemo, useState } from '../html.js';
import { useStore } from '../store.js';
import { eventHref, groupHref, href, navigate, personHref, tagHref } from '../router.js';
import { tagFromToken, tagToken } from '../tagroute.js';
import {
  allTags, displayName, eventsWithTag, fieldByRole, fieldValueText, firstMet, groupsWithTag, hasTag, normalizeTag,
  personSubtitle, sortPeople, tagKey,
} from '../pc/domain.js';
import { formatDate, formatNumber, plural, todayISO } from '../pc/format.js';
import { matchText, normalizeText } from '../pc/search.js';
import { Photo } from '../photos.js';
import { EmptyState, Icon, Row, SearchBox, Section, Segmented, TopBar, useIncremental, useScrollMemory } from '../ui.js';
import {
  groupsIndex, hasPhoto, lastSeenIndex, lastSeenText, latestDiaryNote, meetingText, oneLine, shortLabel, topicFields,
} from '../fatti.js';

function countsText(t) {
  const parts = [];
  if (t.peopleCount) parts.push(plural(t.peopleCount, 'persona', 'persone'));
  if (t.groupsCount) parts.push(plural(t.groupsCount, 'gruppo', 'gruppi'));
  if (t.eventsCount) parts.push(plural(t.eventsCount, 'evento', 'eventi'));
  return parts.join(' · ') || 'non usato';
}

export function TagsScreen() {
  const archive = useStore((s) => s.archive);
  const [filter, setFilter] = useState('');
  const tags = useMemo(() => allTags(archive), [archive.people, archive.groups, archive.events, archive.tagMeta]);
  const shown = useMemo(() => {
    const nq = normalizeText(filter);
    const list = nq ? tags.filter((t) => normalizeText(t.name).includes(nq)) : tags.slice();
    return list.sort((a, b) => b.peopleCount - a.peopleCount || b.count - a.count || a.name.localeCompare(b.name, 'it'));
  }, [tags, filter]);
  useScrollMemory('tag');

  return html`<div class="screen">
    <${TopBar} title="Tag" subtitle=${tags.length ? `${plural(tags.length, 'tag', 'tag')} · apri un tag per vedere il suo mondo` : ''}>
      ${tags.length > 8 && html`<div class="topbar-tools"><${SearchBox} value=${filter} onInput=${setFilter} placeholder="Filtra i tag…" /></div>`}
    </${TopBar}>
    <div class="content">
      ${!tags.length
        ? html`<${EmptyState} icon="tag" title="Ancora nessun tag" text="I tag si aggiungono dal PC, nella scheda di una persona, di un gruppo o di un evento." />`
        : !shown.length
          ? html`<${EmptyState} icon="search" title=${`Nessun tag contiene «${filter.trim()}»`} />`
          : html`<ul class="list" aria-label="Tag">
              ${shown.map((t) => html`<li key=${tagKey(t.name)}>
                <${Row} href=${tagHref(t.name)}
                  leading=${html`<span class="tag-badge" data-color=${t.color}><${Icon} name="tag" size=${20} /></span>`}
                  title=${t.name} sub=${countsText(t)} />
              </li>`)}
            </ul>`}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Pagina di un tag
// ---------------------------------------------------------------------------

function GalleryCard({ person, d }) {
  return html`<a class="gcard" href=${personHref(person.id)} data-person-id=${person.id}>
    <${Photo} person=${person} size=${null} className="gcard-photo" />
    <span class="gcard-body">
      <span class="gcard-name">${displayName(person)}</span>
      ${d.subtitle && html`<span class="gcard-sub">${d.subtitle}</span>`}
      ${d.remember && html`<span class="gcard-remember"><${Icon} name="star" size=${12} />${d.remember}</span>`}
    </span>
  </a>`;
}

function SheetItem({ person, d }) {
  const name = displayName(person);
  const nick = oneLine(person.nickname);
  return html`<article class="sheet-item" data-person-id=${person.id}>
    <a class="sheet-item-head" href=${personHref(person.id)}>
      <${Photo} person=${person} size=${64} className="sheet-photo" />
      <span class="sheet-names">
        <span class="sheet-name">${name}</span>
        ${nick && nick !== name && html`<span class="sheet-nick">«${nick}»</span>`}
        ${d.subtitle && html`<span class="sheet-sub">${d.subtitle}</span>`}
      </span>
    </a>
    <div class="sheet-lines">
      ${d.groupsText && html`<p class="sheet-line"><${Icon} name="building" size=${14} /><span>${d.groupsText}</span></p>`}
      ${d.met && html`<p class="sheet-line"><${Icon} name="history" size=${14} /><span><b>Primo incontro:</b> ${d.met}</span></p>`}
      ${d.seen && html`<p class="sheet-line"><${Icon} name="clock" size=${14} /><span><b>Ultima volta:</b> ${d.seen}</span></p>`}
      ${d.remember && html`<p class="sheet-note sheet-remember"><span class="sheet-key">Ricorda</span>${d.remember}</p>`}
      ${d.topics.map((t) => html`<p key=${t.id} class="sheet-note sheet-topic"><span class="sheet-key">${t.key}</span>${t.text}</p>`)}
      ${d.avoid && html`<p class="sheet-note sheet-avoid"><span class="sheet-key">Da non dire</span>${d.avoid}</p>`}
      ${d.lastNote && html`<p class="sheet-note sheet-diary"><span class="sheet-key">Ultima nota</span>${d.lastNote.date ? `${formatDate(d.lastNote.date)} · ` : ''}${d.lastNote.text}</p>`}
      ${d.appearance && html`<p class="sheet-note sheet-look"><span class="sheet-key">Aspetto</span>${d.appearance}</p>`}
    </div>
  </article>`;
}

export function TagScreen({ params, query }) {
  const archive = useStore((s) => s.archive);
  const raw = normalizeTag(tagFromToken(params[0])); // nell'indirizzo c'è il codice del tag, non il nome
  const tags = useMemo(() => allTags(archive), [archive.people, archive.groups, archive.events, archive.tagMeta]);
  const tag = tags.find((t) => tagKey(t.name) === tagKey(raw)) || null;
  const tagName = tag ? tag.name : '';
  const view = query.vista === 'scheda' ? 'sheet' : 'gallery';
  const [filter, setFilter] = useState('');
  const today = todayISO();

  const people = useMemo(
    () => (tagName ? sortPeople(Object.values(archive.people || {}).filter((p) => p && hasTag(p.tags, tagName)), 'nome') : []),
    [archive.people, tagName],
  );
  const groups = useMemo(() => (tagName ? groupsWithTag(archive, tagName) : []), [archive.groups, tagName]);
  const events = useMemo(() => (tagName ? eventsWithTag(archive, tagName) : []), [archive.events, tagName]);

  const details = useMemo(() => {
    const schema = archive.schema;
    const remember = fieldByRole(schema, 'remember');
    const avoid = fieldByRole(schema, 'avoid');
    const appearance = fieldByRole(schema, 'appearance');
    const topics = topicFields(schema, remember, avoid);
    const seen = lastSeenIndex(archive, today);
    const memberships = groupsIndex(archive);
    const text = (f, p) => (f ? oneLine(fieldValueText(archive, f, p.fields?.[f.id])) : '');
    const out = new Map();
    for (const p of people) {
      const fm = firstMet(archive, p);
      const last = seen.get(p.id);
      out.set(p.id, {
        subtitle: personSubtitle(archive, p),
        remember: text(remember, p),
        avoid: text(avoid, p),
        topics: topics.map((f) => ({ id: f.id, key: shortLabel(f.label), text: text(f, p) })).filter((t) => t.text),
        appearance: hasPhoto(p) ? '' : text(appearance, p),
        lastNote: latestDiaryNote(p.diary, today),
        met: meetingText(archive, fm),
        seen: last && last.date !== fm.date ? lastSeenText(last, today) : '',
        groupsText: (memberships.get(p.id) || []).map(({ group, role }) => (role ? `${group.name} (${role})` : group.name)).filter(Boolean).join(' · '),
      });
    }
    return out;
  }, [people, archive.schema, archive.events, archive.groups, today]);

  const shown = useMemo(() => {
    if (!filter.trim()) return people;
    return people.filter((p) => {
      const d = details.get(p.id);
      return matchText([p.firstName, p.lastName, p.nickname, d.subtitle, d.groupsText, d.remember, d.avoid, d.met, d.seen,
        d.appearance, d.lastNote?.text, ...d.topics.map((t) => t.text)], filter);
    });
  }, [people, details, filter]);

  const { limit, sentinelRef } = useIncremental(shown.length, `${filter}|${view}`, 40);
  useScrollMemory(`tag|${raw}|${view}`);

  if (!tag) {
    return html`<div class="screen">
      <${TopBar} title=${raw || 'Tag'} back="#/tag" />
      <div class="content"><${EmptyState} icon="tag" title=${raw ? `Nessuno ha il tag «${raw}»` : 'Tag non trovato'}
        text="Forse è stato rinominato o eliminato sul PC." /></div>
    </div>`;
  }

  const setView = (v) => navigate(tagHref(tag.name, { vista: v === 'sheet' ? 'scheda' : '' }), { replace: true });
  const n = people.length;

  return html`<div class="screen">
    <${TopBar} title=${html`<span class="topbar-tag"><span class="tag-dot" data-color=${tag.color}></span>${tag.name}</span>`}
      subtitle=${countsText(tag)} back="#/tag" />
    <div class="content">
      ${n > 0
        ? html`
          <div class="tag-tools">
            <${Segmented} label="Vista" value=${view} onChange=${setView} options=${[
              { value: 'gallery', label: 'Galleria', icon: 'grid' },
              { value: 'sheet', label: 'Scheda rapida', icon: 'clipboard' },
            ]} />
            <a class="btn btn-secondary btn-s" href=${href('/ripasso', { tag: tagToken(tag.name) })}><${Icon} name="cards" size=${17} />Ripassa</a>
          </div>
          ${n > 6 && html`<${SearchBox} value=${filter} onInput=${setFilter} placeholder="Filtra tra queste persone…" />`}
          ${!shown.length
            ? html`<${EmptyState} icon="search" title=${`Nessuno tra queste persone corrisponde a «${filter.trim()}»`} />`
            : view === 'sheet'
              ? html`<section class="sheet-list" aria-label=${`Scheda rapida: ${tag.name}`}>
                  <p class="sheet-meta">Scheda rapida · ${plural(shown.length, 'persona', 'persone')} · ${formatDate(today, { style: 'long' })}</p>
                  ${shown.slice(0, limit).map((p) => html`<${SheetItem} key=${p.id} person=${p} d=${details.get(p.id)} />`)}
                </section>`
              : html`<section class="gallery" aria-label=${`Persone con il tag ${tag.name}`}>
                  ${shown.slice(0, limit).map((p) => html`<${GalleryCard} key=${p.id} person=${p} d=${details.get(p.id)} />`)}
                </section>`}
          ${limit < shown.length && html`<div class="more" ref=${sentinelRef}>Carico le altre persone…</div>`}`
        : html`<${EmptyState} icon="users" title="Nessuna persona ha questo tag" text=${`«${tag.name}» è usato solo da gruppi o eventi.`} />`}

      ${groups.length > 0 && html`<${Section} title="Gruppi con questo tag" icon="building" count=${groups.length}>
        <ul class="list list-inset">${groups.map((g) => html`<li key=${g.id}>
          <${Row} href=${groupHref(g.id)} leading=${html`<${Photo} group=${g} size=${40} />`} title=${g.name || '(gruppo senza nome)'}
            sub=${[g.kind, plural((g.members || []).length, 'membro', 'membri')].filter(Boolean).join(' · ')} />
        </li>`)}</ul>
      </${Section}>`}
      ${events.length > 0 && html`<${Section} title="Eventi con questo tag" icon="calendar" count=${events.length}>
        <ul class="list list-inset">${events.map((e) => html`<li key=${e.id}>
          <${Row} href=${eventHref(e.id)} leading=${html`<span class="date-badge">${e.date ? formatDate(e.date) : 'senza data'}</span>`}
            title=${e.title || '(evento senza titolo)'} sub=${[e.place, plural((e.participants || []).length, 'partecipante', 'partecipanti')].filter(Boolean).join(' · ')} />
        </li>`)}</ul>
      </${Section}>`}
      ${n > 0 && html`<p class="stamp">${formatNumber(n)} ${n === 1 ? 'persona' : 'persone'} con «${tag.name}»</p>`}
    </div>
  </div>`;
}
