// Preact + htm come sul PC, ma con percorsi relativi (niente import map: la CSP non permette script in linea).
import { h, render, Fragment } from '../vendor/preact.module.js';
import htm from '../vendor/htm.module.js';

export const html = htm.bind(h);
export { h, render, Fragment };
export {
  useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useReducer,
} from '../vendor/hooks.module.js';
