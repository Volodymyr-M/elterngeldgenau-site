// The Planungsmappe in the page (migration plan §4 P7), loaded with
// import() on the checkout and done screens and wherever a screen holds an
// offer ([data-dossier-offer]); paid-form.js (the details screen) uses its
// helpers. Core decides everything in the
// worker: whether a dossier can be made (offer.state), the order
// (checkout.apply, checkout.status), the official files (forms.plan,
// forms.check) and the PDFs (paid.dossier, paid.applicationForm). This
// module shows what core says, hands picked files to the worker and saves
// the PDFs the worker returns as Blob downloads. Nothing is stored; every
// text comes from core or from the page ([data-string] status lines).

import { ApiError, debounce } from './worker-client.js';
import { clearErrors, collect, render, showErrors } from './form.js';

export const PDF = 'application/pdf';
const ICS = 'text/calendar';
export const now = () => new Date().toISOString();
export const q = (root, name) => root.querySelector(`[data-p="${name}"]`);

// --- Inputs changed: whoever keeps state.inputs current (the result
// grid, the questionnaire) sets it; an offer then asks core again.
const listeners = new Set();
const watched = new WeakSet();
export function watch(state) {
  if (watched.has(state)) return;
  watched.add(state);
  let value = state.inputs;
  Object.defineProperty(state, 'inputs', {
    configurable: true,
    enumerable: true,
    get: () => value,
    set(v) {
      value = v;
      for (const f of [...listeners]) f();
    },
  });
}

// Runs `fn` now and whenever the inputs change, while `el` is in the page.
export function follow(el, fn) {
  const soon = debounce(() => (el.isConnected ? fn() : listeners.delete(soon)), 300);
  listeners.add(soon);
  return fn();
}

// A named status line of the page into `el`, or core's own message.
export function say(ctx, el, name, error) {
  if (!el) return;
  el.textContent = error instanceof ApiError && error.message ? error.message : (ctx.status.strings[name] ?? '');
}

// Saves `data` as a file: a Blob behind an <a download>.
export function save(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// TEMPORARY: a 'free' build (web_api ApiEnvironment.free) gives the
// Planungsmappe away until payment is integrated: the buy button makes it at
// once and the checkout moves on to the done page. Remove with 'free'.
const free = (ctx) => (ctx.meta ??= ctx.client.call('meta')).then((m) => m.payment === 'free');

// Nothing is counted. The free phase used to POST one word and the build
// hash to the site's own count endpoint after every dossier (spec §6
// fake-door counter), which is the only way a browser-side dossier could
// ever be measured. GitHub Pages cannot serve an endpoint, and a POST to a
// path that 404s is a console error on every dossier and a promise the site
// does not keep — so the call is gone rather than hidden behind a flag
// somebody could switch on. The endpoint itself is parked and still tested,
// under deploy/parked/. `ApiEnvironment.free` in packages/web_api carries
// this as one of the free phase's deviations and says what it costs.
//
// The path is deliberately not written out here: this file ships to the
// browser as it stands, and verify.dart fails the build if the release
// bundle names an origin path the host cannot serve — a comment included.

// The Planungsmappe itself into a file; the status line says how it went.
async function dossier(ctx, button, line) {
  button.disabled = true;
  say(ctx, line, 'dossier_working');
  try {
    const r = await ctx.client.call('paid.dossier', { inputs: ctx.state.inputs, now: now() });
    save(r.bytes, r.filename, PDF);
    say(ctx, line, 'dossier_done');
    return r;
  } catch (e) {
    say(ctx, line, 'failed', e);
  } finally {
    button.disabled = false;
  }
}

// Once per element.
export function once(el, key) {
  if (!el || el.dataset[key]) return false;
  el.dataset[key] = '1';
  return true;
}

// The free sample buttons ([data-dossier-sample]) of `root`.
function samples(ctx, root) {
  for (const b of root.querySelectorAll('[data-dossier-sample]')) {
    if (!once(b, 'bound')) continue;
    b.addEventListener('click', async () => {
      const line = b.closest('.calc-offer, [data-paid]')?.querySelector('[data-o="status"]');
      b.disabled = true;
      say(ctx, line, 'sample_working');
      try {
        const r = await ctx.client.call('paid.dossier', { inputs: ctx.state.inputs, sample: true, now: now() });
        save(r.bytes, r.filename, PDF);
        say(ctx, line, 'sample_done');
      } catch (e) {
        say(ctx, line, 'failed', e);
      }
      b.disabled = false;
    });
  }
}

// --- The offer on the result and deadline screens: every
// [data-dossier-offer="result|deadline"] gets a copy of the page's
// template[data-offer-template], filled from core's offer.state. What the
// host held ([data-offer-fallback], the static price line) is the no-JS
// content: hidden once core has answered, so the price is stated once.
// Each answer drawn marks the host data-offer-ready="shown|none" (read by
// the browser tests).
export function mountOffers(ctx, section) {
  watch(ctx.state);
  const tpl = ctx.root.querySelector('template[data-offer-template]');
  for (const host of section.querySelectorAll('[data-dossier-offer]')) {
    if (!tpl || !once(host, 'offer')) continue;
    const fallback = [...host.querySelectorAll('[data-offer-fallback]')];
    const offer = tpl.content.firstElementChild.cloneNode(true);
    offer.hidden = true;
    host.append(offer);
    const o = (name) => offer.querySelector(`[data-o="${name}"]`);
    follow(host, async () => {
      if (!ctx.state.inputs) return;
      let v;
      try {
        v = await ctx.client.call('offer.state', { inputs: ctx.state.inputs, screen: host.dataset.dossierOffer || 'result' });
      } catch {
        return;
      }
      o('line').textContent = v.priceLine ?? '';
      o('vat').textContent = v.vatNote ?? '';
      o('blocked').textContent = v.blockerText ?? '';
      o('blocked').hidden = !v.blockerText;
      o('actions').hidden = !v.available;
      for (const f of fallback) f.hidden = true;
      offer.hidden = !v.priceLine;
      host.hidden = !v.priceLine;
      host.dataset.offerReady = v.priceLine ? 'shown' : 'none';
    });
    samples(ctx, host);
    // TEMPORARY 'free': the buy button makes the dossier instead of
    // following its link to the checkout.
    free(ctx).then((yes) => {
      if (!yes) return;
      const buy = o('buy');
      buy.addEventListener('click', (e) => {
        e.preventDefault();
        dossier(ctx, buy, o('status'));
      });
    }, () => {});
  }
}

// --- The screens.
const screens = { checkout, done };

// A paid screen is drawn from core's first answers: data-paid-ready on its
// root (read by the browser tests; set once).
export function drawn(root) {
  root.dataset.paidReady = '1';
}

export function mount(ctx, section) {
  watch(ctx.state);
  const root = section.querySelector('[data-paid]');
  if (root && once(root, 'mounted')) return screens[root.dataset.paid]?.(ctx, root);
}

// Places the order from the checkout form (capture phase: before app.js's
// own submit handler, which would only validate).
async function checkout(ctx, root) {
  const { client, state } = ctx;
  // TEMPORARY 'free': no order; straight on to the dossier.
  if (await free(ctx).catch(() => false)) return ctx.visit(root.dataset.done, { replace: true, focus: true });
  const form = root.querySelector('form');
  samples(ctx, root);
  const offered = follow(root, async () => {
    const v = await client.call('offer.state', { inputs: state.inputs });
    q(root, 'blocked').hidden = v.available;
    q(root, 'ready').hidden = !v.available;
    if (v.blockerText) q(root, 'blocked-text').textContent = v.blockerText;
    q(root, 'to-result').hidden = v.blocker !== 'planInvalid';
    q(root, 'to-data').hidden = v.blocker === 'planInvalid';
  });
  const meta = await client.call('meta');
  q(root, 'unavailable').hidden = meta.payment !== 'unavailable';
  q(root, 'test').hidden = meta.payment !== 'fake';
  await offered;
  drawn(root);
  root.addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const line = q(root, 'status');
      say(ctx, line, 'order_working');
      try {
        const r = await client.call('checkout.apply', {
          inputs: state.inputs,
          fields: collect(form),
          now: now(),
          returnUrl: location.origin + location.pathname,
        });
        if (r.status === 'invalid') {
          line.textContent = '';
          render(form, r, true);
          return showErrors(form, r.errors, r.summary);
        }
        clearErrors(form);
        if (r.status === 'paid') return ctx.visit(r.navigate.url, { push: true, focus: true });
        line.textContent = r.message;
      } catch (err) {
        say(ctx, line, 'failed', err);
      }
    },
    true,
  );
}

// After the order: the receipt, the dossier and its calendar file, the
// paper-form extra.
async function done(ctx, root) {
  const { client, state } = ctx;
  const s = await client.call('checkout.status');
  q(root, 'none').hidden = s.paid;
  q(root, 'paid').hidden = !s.paid;
  if (!s.paid) return drawn(root);
  // TEMPORARY 'free': paid without a receipt, and no contract to withdraw.
  q(root, 'receipt').textContent = s.receipt?.text ?? '';
  q(root, 'email').textContent = s.receipt?.email ?? '';
  q(root, 'withdrawal').hidden = !s.receipt;
  q(root, 'test').hidden = !s.testMode;
  const line = q(root, 'status');
  let ics = null;
  const button = q(root, 'dossier');
  button.addEventListener('click', async () => {
    const r = await dossier(ctx, button, line);
    if (!r) return;
    ics = r.ics;
    q(root, 'ics').hidden = false;
  });
  q(root, 'ics').addEventListener('click', () => ics && save(ics.text, ics.filename, ICS));
  const f = await client.call('forms.plan', { inputs: state.inputs });
  q(root, 'form').hidden = !f.formLine;
  q(root, 'form-line').textContent = f.formLine ?? '';
  q(root, 'form-link').hidden = !f.extra;
  drawn(root);
}
