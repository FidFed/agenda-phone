// Gruppi (studi, aziende, associazioni, compagnie): elenco con ricerca e dettaglio in sola lettura.
import { html, useMemo, useState } from '../html.js';
import { onLock, useStore } from '../store.js';
import { href, personHref } from '../router.js';
import { displayName, groupMembers, listGroups, personSubtitle } from '../pc/domain.js';
import { plural } from '../pc/format.js';
import { searchGroups } from '../pc/search.js';
import { Photo } from '../photos.js';
import {
  DocumentsNote, EmptyState, Icon, PhotoStrip, Row, SearchBox, Section, TagList, TopBar, useIncremental, useScrollMemory,
} from '../ui.js';

let savedFilter = '';
onLock(() => { savedFilter = ''; });

export function GroupsScreen() {
  const archive = useStore((s) => s.archive);
  const [filter, setFilterState] = useState(savedFilter);
  const setFilter = (v) => { savedFilter = v; setFilterState(v); };
  const all = useMemo(() => listGroups(archive), [archive.groups]);
  const shown = useMemo(() => (filter.trim() ? searchGroups(archive, filter).map((r) => r.group) : all), [archive, all, filter]);
  const { limit, sentinelRef } = useIncremental(shown.length, filter, 60);
  useScrollMemory('gruppi');

  return html`<div class="screen">
    <${TopBar} title="Gruppi" subtitle=${all.length ? plural(all.length, 'gruppo', 'gruppi') : ''}>
      ${all.length > 0 && html`<div class="topbar-tools"><${SearchBox} value=${filter} onInput=${setFilter}
        placeholder="Cerca: nome, tipo, membri…" label="Cerca tra i gruppi" /></div>`}
    </${TopBar}>
    <div class="content">
      ${!all.length
        ? html`<${EmptyState} icon="building" title="Nessun gruppo" text="Studi, aziende, associazioni e compagnie si aggiungono dal PC." />`
        : !shown.length
          ? html`<${EmptyState} icon="search" title=${`Nessun gruppo corrisponde a «${filter.trim()}»`} />`
          : html`<ul class="list" aria-label="Gruppi">
              ${shown.slice(0, limit).map((g) => html`<li key=${g.id}>
                <${Row} href=${`#/gruppo/${encodeURIComponent(g.id)}`} leading=${html`<${Photo} group=${g} size=${48} />`}
                  title=${g.name || '(gruppo senza nome)'}
                  sub=${[g.kind, plural((g.members || []).length, 'membro', 'membri')].filter(Boolean).join(' · ')} />
              </li>`)}
            </ul>
            ${limit < shown.length && html`<div class="more" ref=${sentinelRef}>Carico gli altri gruppi…</div>`}`}
    </div>
  </div>`;
}

export function GroupScreen({ params }) {
  const archive = useStore((s) => s.archive);
  const group = archive.groups?.[params[0]];
  useScrollMemory(`gruppo|${params[0]}`);
  const members = useMemo(() => (group ? groupMembers(archive, group) : []), [archive.people, group]);
  if (!group) {
    return html`<div class="screen">
      <${TopBar} title="Gruppo" back="#/gruppi" />
      <div class="content"><${EmptyState} icon="building" title="Questo gruppo non c'è nel pacchetto" /></div>
    </div>`;
  }
  return html`<div class="screen">
    <${TopBar} title="Gruppo" back="#/gruppi" />
    <div class="content">
      <header class="detail-head">
        <${Photo} group=${group} size=${64} />
        <div class="detail-titles">
          <h1 class="detail-title" data-testid="nome-gruppo">${group.name || '(gruppo senza nome)'}</h1>
          <p class="detail-sub">${[group.kind, plural(members.length, 'membro', 'membri')].filter(Boolean).join(' · ')}</p>
        </div>
      </header>
      <${TagList} archive=${archive} tags=${group.tags} />
      ${group.description && html`<${Section} title="Descrizione" icon="note"><p class="prewrap">${group.description}</p></${Section}>`}
      <${Section} title="Membri" icon="users" count=${members.length}
        action=${members.length > 0 && html`<a class="btn btn-secondary btn-s" href=${href('/ripasso', { gruppo: group.id })}><${Icon} name="cards" size=${16} />Ripassa</a>`}>
        ${members.length
          ? html`<ul class="list list-inset">${members.map(({ person, role }) => html`<li key=${person.id}>
              <${Row} href=${personHref(person.id)} leading=${html`<${Photo} person=${person} size=${44} round />`}
                title=${displayName(person)} sub=${[role, personSubtitle(archive, person)].filter(Boolean).join(' · ')} />
            </li>`)}</ul>`
          : html`<p class="muted">Nessun membro.</p>`}
      </${Section}>
      ${(group.photos || []).length > 0 && html`<${Section} title="Foto" icon="image" count=${group.photos.length}>
        <${PhotoStrip} photos=${group.photos} label="Foto del gruppo" />
      </${Section}>`}
      <${DocumentsNote} count=${(group.documents || []).length} />
    </div>
  </div>`;
}
