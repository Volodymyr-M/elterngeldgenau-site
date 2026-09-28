// The calculator pages' entry (migration plan §1.5–§1.8), loaded as
// /calc/<hash8>/app.js. It keeps the inputs in memory, asks core (in a Web
// Worker) what each screen shows, moves between screens with pushState,
// and forwards raw form values. It decides nothing itself: validation,
// visibility, parsing, navigation targets and every text come from core
// or from the page.

import { createClient, createStatus, debounce, STALE } from './worker-client.js';
import { CARRY, createRouter, decodeCarry, encodeCarry } from './router.js';
import { clearErrors, collect, render, showErrors } from './form.js';
import { createSave } from './save.js';
import { devToday } from './worker-client.js'; // P5

const root = document.querySelector('[data-calc]');
if (root) main(root);

function main(root) {
  const client = createClient(new URL('./core.js', import.meta.url), root.dataset.lang);
  const status = createStatus(root);
  const router = createRouter(root);
  const applyLatest = client.latest('apply');
  const state = { inputs: null, fresh: '', baseline: '', screen: null, form: null, next: null };
  let leaving = false;
  let booted = false;
  // Inputs carried by the language link: taken and removed from the
  // address at once, so they stay in neither history nor storage.
  let carried = null;
  if (location.hash.startsWith(`#${CARRY}=`)) {
    carried = decodeCarry(location.hash.slice(CARRY.length + 2));
    history.replaceState(null, '', location.pathname + location.search);
  }

  const dirty = () => state.inputs !== null && JSON.stringify(state.inputs) !== state.baseline;
  const clean = () => {
    state.baseline = JSON.stringify(state.inputs);
  };

  function fail(e) {
    console.error(e);
    status.say(e?.code === 'unsupported_version' ? 'reload' : 'failed');
  }

  // Shows the screen core says `route` is (after its deep-link redirects).
  async function visit(route, { push = false, replace = false, focus = false } = {}) {
    let st;
    try {
      st = await client.call('screen.state', { inputs: state.inputs, route });
    } catch (e) {
      return fail(e);
    }
    const loc = st.redirect ?? route;
    if (push) history.pushState(null, '', loc);
    else if (replace || st.redirect) history.replaceState(null, '', loc);
    state.next = new URL(loc, location.href).searchParams.get('next');
    state.screen = st.screen;
    const section = router.show(st.screen === 'reduced' ? 'income' : st.screen);
    const h1 = section.querySelector('h1');
    if (h1 && st.title) h1.textContent = st.title;
    state.form = null;
    for (const f of section.querySelectorAll('[data-calc-form]')) {
      f.hidden = f.dataset.calcForm !== st.screen;
      if (!f.hidden) state.form = f;
    }
    if (state.form) {
      render(state.form, st);
      bind(state.form);
      state.form.querySelector('[data-calc-enable]').disabled = false;
      const back = state.form.querySelector('[data-calc-back]');
      if (back && st.back) back.href = st.back;
    }
    onScreen(section);
    mountModule(st.screen, section);
    mountOffers(section); // P7
    if (focus) h1?.focus();
    // Which screen core says this is (read by the browser tests).
    root.dataset.state = st.screen;
  }

  async function apply(action) {
    const form = state.form;
    if (!form) return;
    const args = { inputs: state.inputs, screen: state.screen, fields: collect(form), action };
    if (state.next) args.next = state.next;
    let r;
    try {
      r = await applyLatest('screen.apply', args);
    } catch (e) {
      return fail(e);
    }
    if (r === STALE || form !== state.form) return;
    state.inputs = r.inputs;
    if (action !== 'submit') {
      render(form, r, action === 'change');
      if (action !== 'change') focusRow(form, action);
      return;
    }
    render(form, r, true);
    if (r.errors.length) return showErrors(form, r.errors, r.summary);
    clearErrors(form);
    if (r.navigate) await visit(r.navigate.url, { push: true, focus: true });
  }

  // After adding a row: its first control; after removing one: the add
  // button of that group.
  function focusRow(form, action) {
    const [kind, group] = action.split(':');
    if (kind === 'add') {
      const rows = form.querySelectorAll(`[data-repeat="${group}"] > [data-row]`);
      rows[rows.length - 1]?.querySelector('input,select')?.focus();
    } else {
      form.querySelector(`[data-action="add:${group}"]`)?.focus();
    }
  }

  const changeSoon = debounce(() => apply('change'), 150);

  // Any change typed but not yet sent, sent now (before a save).
  async function settle() {
    changeSoon.cancel();
    await apply('change');
  }

  function bind(form) {
    form.addEventListener('input', (e) => {
      if (e.target.type !== 'radio' && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') changeSoon();
    });
    form.addEventListener('change', () => {
      changeSoon.cancel();
      apply('change');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      changeSoon.cancel();
      apply('submit');
    });
    form.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (button) {
        e.preventDefault();
        changeSoon.cancel();
        apply(button.dataset.action);
        return;
      }
      const link = e.target.closest('a[data-focus]');
      if (link) {
        e.preventDefault();
        const target = document.getElementById(link.dataset.focus);
        target?.focus();
        target?.scrollIntoView({ block: 'center' });
      }
    });
  }

  const onScreen = createSave({ client, status, state, settle, visit, clean });

  // --- Screen modules (plan §1.5): loaded with import() when their screen
  // is shown; each exports mount(ctx, section) and may be mounted again on
  // the same section (it re-reads core then). Add a line per screen.
  const MODULES = {
    result: './result.js', // P6
    deadline: './deadline.js', // P5
    details: './paid-form.js', // P7
    checkout: './paid.js', // P7
    done: './paid.js', // P7
  };
  const ctx = { client, status, state, visit, settle, clean, fail, root };
  async function mountModule(screen, section) {
    const path = MODULES[screen];
    if (!path) return;
    try {
      const mod = await import(path);
      if (router.live === section) await mod.mount(ctx, section);
    } catch (e) {
      fail(e);
    }
  }
  // --- end screen modules

  // --- P7 paid: the Planungsmappe offer. Any shown screen whose markup
  // holds [data-dossier-offer] loads paid.js, which fills it (the hook is
  // documented in generator/lib/calculator.dart).
  async function mountOffers(section) {
    if (!section.querySelector('[data-dossier-offer]')) return;
    try {
      const mod = await import('./paid.js');
      if (router.live === section) mod.mountOffers(ctx, section);
    } catch (e) {
      fail(e);
    }
  }
  // --- end P7 paid

  // Links to calculator screens stay in the document; the language link
  // carries the step and the inputs (#uebernahme=, removed on arrival).
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.closest('.lang-switch')) {
      const path = state.screen && router.alternate(router.live.dataset.screen, a.lang);
      if (!path) return;
      const carry = state.inputs && JSON.stringify(state.inputs) !== state.fresh;
      a.href = carry ? `${path}#${CARRY}=${encodeCarry(state.inputs)}` : path;
      leaving = true;
      return;
    }
    const url = new URL(a.href, location.href);
    if (!booted || url.hash || !router.keyFor(url)) return;
    e.preventDefault();
    visit(url.pathname + url.search, { push: true, focus: true });
  });

  addEventListener('popstate', () => {
    if (booted) visit(location.pathname + location.search, { focus: true });
  });

  addEventListener('beforeunload', (e) => {
    if (!leaving && dirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  addEventListener('pageshow', () => {
    leaving = false;
  });

  async function boot() {
    if (booted) return;
    booted = true;
    try {
      state.inputs = (await client.call('inputs.new')).inputs;
    } catch (e) {
      return fail(e);
    }
    state.fresh = JSON.stringify(state.inputs);
    clean();
    if (carried) state.inputs = carried;
    // --- P5 deadline: ?today= in --dev builds (worker-client.js); a shared
    // card (#karte=…) opens read-only, without inputs and without core's
    // deep-link rules — deadline.js reads the fragment.
    await devToday(client);
    const karte = () => location.hash.startsWith('#karte=') && router.keyFor(new URL(location.href)) === 'deadline';
    addEventListener('hashchange', () => karte() && location.reload());
    if (karte()) {
      state.screen = 'deadline';
      await mountModule('deadline', router.show('deadline'));
      root.dataset.state = 'deadline';
      return;
    }
    // --- end P5 deadline
    await visit(location.pathname + location.search);
    // Carried inputs the worker cannot read: start fresh.
    if (carried && !state.screen) {
      state.inputs = JSON.parse(state.fresh);
      await visit(location.pathname + location.search);
    }
  }

  // The worker starts after the page has loaded, or at the first
  // interaction with the calculator, whichever comes first.
  root.addEventListener('focusin', boot, { once: true });
  root.addEventListener('pointerdown', boot, { once: true });
  if (document.readyState === 'complete') boot();
  else addEventListener('load', boot, { once: true });
}
