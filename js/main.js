// Avvio della web app del telefono: service worker (solo i file dell'app), stato, rotte e navigazione in basso.
import { html, render, useEffect, useMemo } from './html.js';
import { init, onLock, useStore } from './store.js';
import { navigate, useRoute } from './router.js';
import { countReviewDue } from './pc/domain.js';
import { Icon, Overlays, clearScrollMemory, closeOverlays } from './ui.js';
import { ErrorScreen, LockScreen, WelcomeScreen } from './screens/avvio.js';
import { PeopleScreen } from './screens/persone.js';
import { PersonScreen } from './screens/persona.js';
import { TagScreen, TagsScreen } from './screens/tag.js';
import { EventScreen, EventsScreen } from './screens/eventi.js';
import { GroupScreen, GroupsScreen } from './screens/gruppi.js';
import { ReviewScreen } from './screens/ripasso.js';
import { SettingsScreen } from './screens/impostazioni.js';

const ROUTES = {
  persone: { list: PeopleScreen, tab: 'persone' },
  persona: { detail: PersonScreen, tab: 'persone' },
  tag: { list: TagsScreen, detail: TagScreen, tab: 'tag' },
  eventi: { list: EventsScreen, tab: 'eventi' },
  evento: { detail: EventScreen, tab: 'eventi' },
  gruppi: { list: GroupsScreen, tab: 'gruppi' },
  gruppo: { detail: GroupScreen, tab: 'gruppi' },
  ripasso: { list: ReviewScreen, tab: 'ripasso' },
  impostazioni: { list: SettingsScreen, tab: null },
};

const TABS = [
  { id: 'persone', href: '#/persone', icon: 'users', label: 'Persone' },
  { id: 'tag', href: '#/tag', icon: 'tag', label: 'Tag' },
  { id: 'eventi', href: '#/eventi', icon: 'calendar', label: 'Eventi' },
  { id: 'gruppi', href: '#/gruppi', icon: 'building', label: 'Gruppi' },
  { id: 'ripasso', href: '#/ripasso', icon: 'cards', label: 'Ripasso' },
];

onLock(() => {
  clearScrollMemory();
  closeOverlays();
});

function BottomNav({ tab }) {
  const archive = useStore((s) => s.archive);
  const due = useMemo(() => (archive ? countReviewDue(archive) : 0), [archive?.review, archive?.people]);
  return html`<nav class="bottomnav" aria-label="Sezioni">
    ${TABS.map((t) => html`<a key=${t.id} href=${t.href} class=${`bottomnav-item ${tab === t.id ? 'is-active' : ''}`}
      aria-current=${tab === t.id ? 'page' : undefined}>
      <span class="bottomnav-icon"><${Icon} name=${t.icon} size=${23} />
        ${t.id === 'ripasso' && due > 0 && html`<span class="bottomnav-badge" aria-label=${`${due} da ripassare`}>${due > 99 ? '99+' : due}</span>`}</span>
      <span class="bottomnav-label">${t.label}</span>
    </a>`)}
  </nav>`;
}

function Shell() {
  const route = useRoute();
  const [section, ...params] = route.parts;
  const def = ROUTES[section];
  const Screen = def ? (params.length ? def.detail : def.list) : null;
  useEffect(() => {
    if (!Screen) navigate('#/persone', { replace: true });
  }, [Screen]);
  if (!Screen) return null;
  return html`<div class="app">
    <${Screen} key=${route.path} params=${params} query=${route.query} />
    <${BottomNav} tab=${def.tab} />
  </div>`;
}

function App() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  document.documentElement.dataset.state = status;
  let body;
  if (status === 'aperto') body = html`<${Shell} />`;
  else if (status === 'bloccato') body = html`<${LockScreen} />`;
  else if (status === 'benvenuto') body = html`<${WelcomeScreen} />`;
  else if (status === 'errore') body = html`<${ErrorScreen} message=${error} />`;
  else body = html`<div class="splash" aria-hidden="true"><img src="icon-192.png" alt="" width="72" height="72" /></div>`;
  return html`${body}<${Overlays} />`;
}

// Schermata delle app recenti di Android: quando la web app passa in secondo piano il contenuto viene nascosto
// subito (Android mostra lì l'ultima immagine della pagina, e i dati restano decifrati fino al blocco, 1 minuto
// dopo). Al ritorno riappare, oppure c'è già la schermata di sblocco.
function cover() {
  document.documentElement.toggleAttribute('data-coperto', document.visibilityState === 'hidden');
}
document.addEventListener('visibilitychange', cover);
window.addEventListener('pagehide', () => document.documentElement.setAttribute('data-coperto', ''));
window.addEventListener('pageshow', cover);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* senza: funziona lo stesso, solo non offline */ });
}

render(html`<${App} />`, document.getElementById('app'));
init();
