// The deadline card (migration plan §4 P5; spec §3.5, marketing §4.2/§4.3),
// loaded when its screen is shown. Core composes every sentence
// (deadline.card, deadline.shared: DeadlineCardView in
// packages/web_api/API.md); this module fills the slots of
// templates/partials/calc/deadline.html, downloads the calendar file as a
// Blob, shares the card's link (Web Share API, else the clipboard, else a
// field to copy from), and shows a shared card (#karte=…) read-only,
// without inputs. The links point at this page's own origin.

import { fixedToday, STALE } from './worker-client.js';

const KARTE = '#karte=';

const slot = (root, key) => root.querySelector(`[data-dl="${key}"]`);

// Shows `el` with `text`, or hides it when there is none.
function put(el, text) {
  el.hidden = !text;
  if (text) el.textContent = text;
  return el;
}

export async function mount(ctx, section) {
  const { client, state } = ctx;
  const shared = location.hash.startsWith(KARTE);
  const $ = (key) => slot(section, key);
  const strings = {};
  for (const s of section.querySelectorAll('[data-dl-strings] [data-s]')) strings[s.dataset.s] = s.textContent;
  let interimEnd = null;
  let card = null;
  const latest = client.latest('deadline');

  for (const f of section.querySelectorAll('form[data-calc-local]')) {
    f.querySelector('[data-calc-enable]').disabled = false;
    f.onsubmit = (e) => e.preventDefault();
  }

  // The status under the buttons: cleared, then set, so it is announced
  // again when the same thing happens twice.
  function say(name) {
    const el = $('status');
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = strings[name] ?? '';
    });
  }

  function hideAll() {
    for (const key of ['stop', 'married', 'draftReform', 'card']) $(key).hidden = true;
  }

  function stop(message, toInputs) {
    hideAll();
    const panel = $('stop');
    panel.hidden = false;
    panel.firstElementChild.textContent = message;
    panel.querySelector('[data-dl-inputs]').hidden = !toInputs;
  }

  function render(c) {
    card = c;
    hideAll();
    const reform = $('draftReform');
    reform.hidden = !c.draftReform;
    if (c.draftReform) {
      reform.querySelector('h2').textContent = c.draftReform.title;
      reform.querySelector('p').textContent = c.draftReform.body;
    }
    const box = $('card');
    box.dataset.outcome = c.outcome;
    put($('headline'), c.headline);
    put($('body'), c.body);
    put($('switchLine'), c.switchLine);
    put($('earlierBirth'), c.earlierBirth?.text);
    put($('basis'), c.basis);

    const interim = $('interim');
    interim.hidden = !c.interim;
    if (c.interim) {
      const [period, together, estimate] = interim.querySelectorAll('p');
      interim.querySelector('h3').textContent = c.interim.heading;
      period.textContent = `${c.interim.period}:`;
      interim.querySelector('ul').replaceChildren(
        ...c.interim.perParent.map((t) => Object.assign(document.createElement('li'), { textContent: t })),
      );
      together.textContent = `${c.interim.together} ${c.interim.evensOut}`;
      put(estimate, c.interim.estimate);
    }

    const rule = $('ruleOfThumb');
    rule.hidden = !c.ruleOfThumb;
    if (c.ruleOfThumb) {
      const [label, text, law] = rule.querySelectorAll('p');
      label.firstElementChild.textContent = c.ruleOfThumb.label;
      text.textContent = c.ruleOfThumb.text;
      Object.assign(law.firstElementChild, { textContent: c.ruleOfThumb.citation, href: c.ruleOfThumb.url });
    }

    const missed = $('missedButton');
    missed.hidden = !c.missedButton;
    if (c.missedButton) missed.firstElementChild.textContent = c.missedButton;

    // The interim-end choice (live card only).
    const end = $('interimEnd');
    end.hidden = !c.interimEnd;
    if (c.interimEnd) {
      end.querySelector('label').textContent = c.interimEnd.label;
      const select = end.querySelector('select');
      select.replaceChildren(...c.interimEnd.options.map((o) => new Option(o.label, o.value ?? '')));
      select.value = c.interimEnd.value ?? '';
      select.onchange = () => {
        interimEnd = select.value || null;
        load();
      };
    }

    // The buttons (live card only).
    const actions = $('actions');
    actions.hidden = !c.actions;
    if (c.actions) {
      const a = c.actions;
      put($('calendar'), a.calendar?.label).onclick = () => download(c.ics);
      put($('calendarNote'), a.calendar?.note);
      put($('share'), a.share?.label).onclick = () => share(c.share);
      put($('shareNote'), a.share?.note);
      put($('full'), a.fullCalculation);
    }
    $('controls').hidden = !c.interimEnd && !c.actions;
    box.hidden = false;
  }

  function download(ics) {
    const url = URL.createObjectURL(new Blob([ics.text], { type: 'text/calendar;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: ics.filename, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    say('calendarDone');
  }

  async function share(s) {
    const data = { title: s.title, text: s.text, url: s.url };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(s.url);
      say('shareCopied');
    } catch {
      // No clipboard either: the link in a field to copy from.
      const box = $('link');
      box.hidden = false;
      const input = box.querySelector('input');
      input.value = s.url;
      input.focus();
      input.select();
    }
  }

  async function load() {
    let r;
    try {
      r = shared
        ? await latest('deadline.shared', { fragment: location.hash })
        : await latest('deadline.card', {
            inputs: state.inputs,
            interimEnd,
            origin: location.origin,
            // A fixed today (dev builds) stamps the file with that day.
            now: fixedToday() ? undefined : new Date().toISOString(),
          });
    } catch (e) {
      if (shared && e.code === 'bad_request') {
        stop(e.message, false);
        section.dataset.dlReady = 'invalid';
        return;
      }
      return ctx.fail(e);
    }
    if (r === STALE) return;
    if (r.card) {
      render(r.card);
      put($('shared'), r.card.shared?.note);
    } else if (r.askMarried) {
      hideAll();
      $('married').hidden = false;
    } else if (r.notComputable) stop(r.notComputable.message, r.notComputable.reason === 'incomplete');
    section.dataset.dlReady = r.card ? r.card.outcome : r.askMarried ? 'askMarried' : 'stop';
  }

  // "Married?" (older saved plans): the answer goes into the inputs the
  // way the household form writes it, then the card.
  $('married').onsubmit = async (e) => {
    e.preventDefault();
    const picked = section.querySelector('[data-dl="married"] input:checked');
    if (!picked) return section.querySelector('[data-dl="married"] input')?.focus();
    try {
      const r = await client.call('screen.apply', {
        inputs: state.inputs,
        screen: 'household',
        fields: { married: picked.value },
        action: 'change',
      });
      state.inputs = r.inputs;
    } catch (err) {
      return ctx.fail(err);
    }
    await load();
    if (card) $('headline').focus();
  };

  // Read-only: the note, the card, "calculate your own"; nothing to save
  // or buy. Live: progress in planning mode, the way on to the split.
  $('own').hidden = !shared;
  $('live').hidden = shared;
  section.querySelector('[data-dl-progress]').hidden = shared || state.inputs?.mode !== 'planning';
  $('continue').hidden = shared || state.inputs?.mode !== 'planning';
  await load();
}
