// Blocco automatico (SPEC §11.3): dopo 5 minuti senza usare l'app e dopo 1 minuto in secondo piano
// (un'altra app, schermo spento). Usa Date.now() e i timer normali: nei test si controllano con l'orologio finto.

export const IDLE_MS = 5 * 60 * 1000;
export const BACKGROUND_MS = 60 * 1000;
const CHECK_MS = 5000;
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input', 'scroll'];

let stopCurrent = null;

export function stopAutoLock() {
  if (stopCurrent) stopCurrent();
  stopCurrent = null;
}

/** Avvia il controllo; `onLock(motivo)` con motivo "inattivita" | "background" (una volta sola). */
export function startAutoLock(onLock) {
  stopAutoLock();
  let last = Date.now();
  let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
  let bgTimer = null;

  const fire = (reason) => {
    stopAutoLock();
    onLock(reason);
  };
  const activity = () => { last = Date.now(); };
  const check = () => {
    if (hiddenAt !== null) {
      if (Date.now() - hiddenAt >= BACKGROUND_MS) fire('background');
    } else if (Date.now() - last >= IDLE_MS) {
      fire('inattivita');
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      clearTimeout(bgTimer);
      bgTimer = setTimeout(() => fire('background'), BACKGROUND_MS);
    } else {
      clearTimeout(bgTimer);
      // I timer in secondo piano possono essere rallentati o fermi: al ritorno si controlla l'orologio.
      if (hiddenAt !== null && Date.now() - hiddenAt >= BACKGROUND_MS) {
        fire('background');
        return;
      }
      hiddenAt = null;
      last = Date.now();
    }
  };

  for (const t of ACTIVITY) window.addEventListener(t, activity, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
  const interval = setInterval(check, CHECK_MS);
  if (hiddenAt !== null) bgTimer = setTimeout(() => fire('background'), BACKGROUND_MS);

  stopCurrent = () => {
    for (const t of ACTIVITY) window.removeEventListener(t, activity, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onVisibility);
    clearInterval(interval);
    clearTimeout(bgTimer);
  };
}
