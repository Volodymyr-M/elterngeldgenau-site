// Screens in one document (migration plan §1.8). The route's own screen is
// live in [data-calc-host]; every other one is an inert
// <template data-screen>. show(key) swaps a fresh copy of a screen in and
// sets the document title; the inputs stay in memory (app.js), so moving
// between screens stores nothing. The language link carries the step, and
// the inputs in the #uebernahme= fragment, which the target removes at once.

export const CARRY = 'uebernahme';

export function createRouter(root) {
  const host = root.querySelector('[data-calc-host]');
  const templates = new Map();
  for (const t of root.querySelectorAll('template[data-screen]')) templates.set(t.dataset.screen, t);
  let live = host.querySelector('.calc-screen');
  // The live screen's untouched markup, for coming back to it later.
  const own = document.createElement('template');
  own.content.append(live.cloneNode(true));
  templates.set(live.dataset.screen, own);

  const screenOf = (key) => templates.get(key).content.querySelector('.calc-screen');
  // This language's path of every screen → its key.
  const keys = new Map([...templates.keys()].map((k) => [screenOf(k).dataset.path, k]));

  function show(key) {
    if (live.dataset.screen !== key) {
      const next = document.importNode(templates.get(key).content, true).firstElementChild;
      live.replaceWith(next);
      live = next;
    }
    document.title = live.dataset.title;
    return live;
  }

  // The same step in language `lang`, keeping ?next= (translated) — from
  // the screens' data-alternates ("en=/en/calculator/income …").
  function alternate(key, lang) {
    const alt = (k) => {
      for (const pair of screenOf(k).dataset.alternates.split(' ')) {
        const [l, p] = pair.split('=');
        if (l === lang) return p;
      }
      return null;
    };
    const path = alt(key);
    if (!path) return null;
    const next = new URLSearchParams(location.search).get('next');
    if (!next) return path;
    const nextKey = [...keys.entries()].find(([p]) => p.endsWith(`/${next}`))?.[1];
    const slug = nextKey && alt(nextKey)?.split('/').pop();
    return slug ? `${path}?next=${slug}` : path;
  }

  return {
    show,
    alternate,
    // The screen key of a same-origin calculator URL in this language.
    keyFor(url) {
      return url.origin === location.origin ? keys.get(url.pathname) ?? null : null;
    },
    get live() {
      return live;
    },
  };
}

// base64url of the inputs' JSON (UTF-8), and back; null if unreadable.
export function encodeCarry(inputs) {
  const bytes = new TextEncoder().encode(JSON.stringify(inputs));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCarry(text) {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}
