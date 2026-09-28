// The worker client (migration plan §1.7). call(op, args, bytes?) sends one request
// of the JSON API (packages/web_api/API.md) to the core worker and resolves
// with its `result`; latest(key) drops answers overtaken by a newer call of
// the same key; every call is measured as performance entry `egg:<op>`.
// No user-visible text lives here: the status strings come from the page.

export const STALE = Symbol('stale');

export class ApiError extends Error {
  constructor(error) {
    super(error.message);
    this.code = error.code;
  }
}

// A fixed "today" (devToday), or null.
let fixed = null;
export const fixedToday = () => fixed;

// Today in the visitor's time zone, as core expects it (YYYY-MM-DD).
export function today() {
  if (fixed) return fixed;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createClient(url, lang) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  const seq = new Map();

  function start() {
    if (worker) return;
    worker = new Worker(url);
    worker.onmessage = (e) => {
      let res;
      try {
        res = JSON.parse(e.data.json);
      } catch {
        return;
      }
      const p = pending.get(res.id);
      if (!p) return;
      pending.delete(res.id);
      try {
        performance.measure(`egg:${p.op}`, p.mark);
        performance.clearMarks(p.mark);
      } catch {
        // measuring is best effort
      }
      // P7: the bytes of a paid op's PDF arrive beside the JSON.
      if (res.ok) p.resolve(e.data.bytes ? { ...res.result, bytes: e.data.bytes } : res.result);
      else p.reject(new ApiError(res.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const p of pending.values()) p.reject(new ApiError({ code: 'internal', message: '' }));
      pending.clear();
    };
  }

  // bytes (P7, forms.check): an ArrayBuffer sent along, transferred.
  function call(op, args = {}, bytes = null) {
    start();
    const id = nextId++;
    const mark = `egg:${op}:${id}`;
    performance.mark(mark);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, op, mark });
      const json = JSON.stringify({ v: 1, id, op, lang, today: today(), args });
      if (bytes) worker.postMessage({ json, bytes }, [bytes]);
      else worker.postMessage({ json });
    });
  }

  // A caller whose answers count only while no newer call of `key` was made.
  function latest(key) {
    return (op, args) => {
      const n = (seq.get(key) ?? 0) + 1;
      seq.set(key, n);
      return call(op, args).then(
        (r) => (seq.get(key) === n ? r : STALE),
        (e) => {
          if (seq.get(key) === n) throw e;
          return STALE;
        },
      );
    };
  }

  return { start, call, latest };
}

// fn after `ms` of quiet; .cancel() drops a pending run.
export function debounce(fn, ms) {
  let t = 0;
  const run = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  run.cancel = () => clearTimeout(t);
  return run;
}

// The aria-live status line ([data-calc-status]) and its strings
// ([data-calc-strings] > [data-string]).
export function createStatus(root) {
  const el = root.querySelector('[data-calc-status]');
  const strings = {};
  for (const s of root.querySelectorAll('[data-string]')) strings[s.dataset.string] = s.textContent;
  return {
    strings,
    say(name) {
      el.textContent = '';
      requestAnimationFrame(() => {
        el.textContent = strings[name] ?? '';
      });
    },
    clear() {
      el.textContent = '';
    },
  };
}

// --dev builds only (the fake payment provider; migration plan §4 P5):
// ?today=YYYY-MM-DD in the address fixes "today" for every call, so the
// browser tests can reproduce a dated card. A release build ignores it.
export async function devToday(client) {
  const t = new URLSearchParams(location.search).get('today');
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return;
  try {
    if ((await client.call('meta')).payment === 'fake') fixed = t;
  } catch {
    // not a dev build's worker: the real date
  }
}
