// Persone: ricerca "a memoria vaga" come sul PC (search.js: parole vuote ignorate, un errore di battitura tollerato,
// "ecco i più vicini"), filtro per tag, elenco a blocchi (veloce anche con migliaia di persone).
// Il testo cercato resta in memoria (mai nell'indirizzo) e viene dimenticato al blocco.
import { html, useEffect, useMemo, useRef, useState } from '../html.js';
import { onLock, useStore } from '../store.js';
import { href, navigate } from '../router.js';
import { tagFromToken, tagToken } from '../tagroute.js';
import { personSubtitle, tagKey, allTags } from '../pc/domain.js';
import { searchPeople, highlightRanges } from '../pc/search.js';
import { formatNumber, plural, relativeTime, todayISO } from '../pc/format.js';
import { Callout, EmptyState, Icon, PersonRow, SearchBox, TagChip, TopBar, useIncremental, useScrollMemory } from '../ui.js';
import { lastSeenIndex } from '../fatti.js';

let savedQuery = '';
onLock(() => { savedQuery = ''; });

const QUICK_TAGS = 14;

/** Testo con le parti trovate evidenziate. */
export function Highlight({ text, query }) {
  const s = String(text || '');
  const ranges = query ? highlightRanges(s, query) : [];
  if (!ranges.length) return s;
  const out = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push(s.slice(at, a));
    out.push(html`<mark class="hl">${s.slice(a, b)}</mark>`);
    at = b;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

export function PeopleScreen({ query }) {
  const archive = useStore((s) => s.archive);
  const [q, setQ] = useState(savedQuery);
  const [dq, setDq] = useState(savedQuery);
  const inputRef = useRef(null);
  useEffect(() => {
    savedQuery = q;
    const t = setTimeout(() => setDq(q), 120);
    return () => clearTimeout(t);
  }, [q]);

  // Nell'indirizzo i codici dei tag (tagroute.js), mai i nomi
  const selTags = useMemo(() => String(query.tag || '').split(',').map((s) => tagFromToken(s.trim())).filter(Boolean), [query.tag]);
  const selKeys = useMemo(() => new Set(selTags.map(tagKey)), [selTags]);
  const total = useMemo(() => Object.keys(archive.people || {}).length, [archive.people]);
  const today = todayISO();
  const seen = useMemo(() => lastSeenIndex(archive, today), [archive.events, today]);

  const results = useMemo(
    () => searchPeople(archive, dq, { tags: selTags, partial: !!dq.trim() }),
    [archive, dq, selTags],
  );

  // Tag più presenti tra i risultati (quanti resterebbero aggiungendo il filtro)
  const quick = useMemo(() => {
    const counts = new Map();
    for (const { person } of results) {
      const seenKeys = new Set();
      for (const t of person.tags || []) {
        const k = tagKey(t);
        if (!k || seenKeys.has(k) || selKeys.has(k)) continue;
        seenKeys.add(k);
        const e = counts.get(k);
        if (e) e.count++;
        else counts.set(k, { name: t, count: 1 });
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'it')).slice(0, QUICK_TAGS);
  }, [results, selKeys]);
  const anyTags = useMemo(() => allTags(archive).some((t) => t.peopleCount > 0), [archive.people]);

  const toggleTag = (name) => {
    const next = selKeys.has(tagKey(name)) ? selTags.filter((t) => tagKey(t) !== tagKey(name)) : [...selTags, name];
    navigate(href('/persone', { tag: next.map(tagToken).filter(Boolean).join(',') }), { replace: true });
  };

  const { limit, sentinelRef } = useIncremental(results.length, `${dq}|${selTags.join(',')}`, 60);
  useScrollMemory(`persone|${selTags.join(',')}`);

  const filtering = !!dq.trim() || selTags.length > 0;
  const loose = results.length > 0 && (results.partial || results.approximate);
  const count = filtering ? `${formatNumber(results.length)} di ${plural(total, 'persona', 'persone')}` : plural(total, 'persona', 'persone');

  return html`<div class="screen">
    <${TopBar} title="Persone" subtitle=${html`<span data-testid="conteggio-persone">${count}</span>`}>
      <div class="topbar-tools">
        <${SearchBox} value=${q} onInput=${setQ} inputRef=${inputRef}
          placeholder="Cerca: nome, lavoro, città, un ricordo…" label="Cerca tra le persone" />
        ${anyTags && html`<div class="chip-scroller" role="group" aria-label="Filtra per tag">
          ${selTags.map((t) => html`<${TagChip} key=${`s-${t}`} archive=${archive} name=${t} active removable onClick=${toggleTag} />`)}
          ${quick.map((t) => html`<${TagChip} key=${t.name} archive=${archive} name=${t.name} count=${t.count} onClick=${toggleTag} />`)}
        </div>`}
      </div>
    </${TopBar}>

    <div class="content">
      ${loose && html`<${Callout} kind="info" icon="search"
        title=${results.partial ? 'Nessuno con tutte le parole: ecco i più vicini' : 'Nessuno scritto proprio così: ecco i più simili'}>
        ${results.partial ? 'Prima chi ha più parole in comune con la ricerca.' : 'Ho tollerato una lettera sbagliata o mancante.'}
      </${Callout}>`}

      ${!total
        ? html`<${EmptyState} icon="users" title="Nessuna persona nel pacchetto" text="Aggiungi le persone dal PC: arriveranno qui con il prossimo pacchetto." />`
        : !results.length
          ? html`<${EmptyState} icon="search" title=${dq.trim() ? `Nessuno corrisponde a «${dq.trim()}»` : 'Nessuna persona con questi tag'}
              text=${dq.trim() ? 'Prova con meno parole o con un pezzo di parola: cerco in nomi, tag, campi, diario, gruppi ed eventi.' : 'Togli qualche tag: devono esserci tutti.'} />`
          : html`<ul class="list" aria-label="Persone">
              ${results.slice(0, limit).map((r) => {
                const last = seen.get(r.person.id);
                return html`<li key=${r.person.id}>
                  <${PersonRow} archive=${archive} person=${r.person}
                    sub=${personSubtitle(archive, r.person)}
                    extra=${r.match ? html`<span class="row-match-label">${r.match.label}:</span> <${Highlight} text=${r.match.text} query=${dq} />` : null}
                    meta=${last ? relativeTime(last.date, today) : ''} />
                </li>`;
              })}
            </ul>
            ${limit < results.length && html`<div class="more" ref=${sentinelRef}>Carico le altre persone…</div>`}`}
    </div>
  </div>`;
}
