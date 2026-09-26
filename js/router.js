// Rotte hash minime (funzionano anche sotto una sottocartella e con il tasto Indietro di Android).
//   #/persone (?tag=<codici>)  #/persona/:id  #/tag  #/tag/:codice  #/eventi  #/evento/:id  #/gruppi  #/gruppo/:id
//   #/ripasso (?tag=<codice> | ?gruppo= | ?evento=)  #/impostazioni
// Nell'indirizzo (che resta nella cronologia di Chrome anche dopo il blocco) finiscono solo id casuali, codici opachi
// dei tag (tagroute.js) e opzioni di vista: MAI nomi di tag né il testo cercato (restano in memoria).
import { useEffect, useState } from './html.js';
import { tagToken } from './tagroute.js';

let seq = 0;

function parse(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '') || '/persone';
  const [p, qs = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const query = {};
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  return { path: `/${parts.join('/')}`, parts, query, hash: `#${raw}` };
}

/** Rotta corrente (non reattiva). */
export const getRoute = () => parse();

/** Hook: rotta corrente, aggiornata a ogni cambio di hash. */
export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Numera le voci della cronologia create dall'app, per sapere se "Indietro" resta dentro l'app. */
function stamp() {
  if (!history.state || typeof history.state.agenda !== 'number') {
    try { history.replaceState({ agenda: ++seq }, ''); } catch { /* ignora */ }
  } else {
    seq = Math.max(seq, history.state.agenda);
  }
}
window.addEventListener('hashchange', stamp);
stamp();

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (target === location.hash) return;
  if (replace) {
    history.replaceState({ agenda: history.state?.agenda ?? ++seq }, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}

/** Indietro nella cronologia dell'app, oppure alla schermata indicata. */
export function goBack(fallback = '#/persone') {
  if ((history.state?.agenda || 0) > 1) history.back();
  else navigate(fallback, { replace: true });
}

/** "#/percorso?a=1&b=2" (parametri vuoti omessi). */
export function href(path, query = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  const s = qs.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export const personHref = (id) => `#/persona/${encodeURIComponent(id)}`;
export const eventHref = (id) => `#/evento/${encodeURIComponent(id)}`;
export const groupHref = (id) => `#/gruppo/${encodeURIComponent(id)}`;
/** Pagina del tag: nell'indirizzo il codice opaco, mai il nome. */
export const tagHref = (name, query = {}) => href(`/tag/${tagToken(name)}`, query);
