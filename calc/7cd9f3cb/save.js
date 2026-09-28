// Explicit save, open and delete (marketing §6.5, migration plan §0
// "Persistence"): nothing is written to this browser's storage until the
// save button is pressed. The stored string is core's saved-plan codec
// (inputs.encode / inputs.decode); storage may be unavailable (private
// modes), so every access is guarded.

const KEY = 'egg.plan.v1';

function storage(fn) {
  try {
    return fn(window.localStorage);
  } catch {
    return undefined;
  }
}

// ctx: {client, status, state, settle, visit, clean}
export function createSave(ctx) {
  const { client, status, state } = ctx;

  async function save() {
    await ctx.settle();
    let stored;
    try {
      ({ stored } = await client.call('inputs.encode', { inputs: state.inputs, now: new Date().toISOString() }));
    } catch {
      return status.say('save_failed');
    }
    const ok = storage((s) => {
      s.setItem(KEY, stored);
      return true;
    });
    if (!ok) return status.say('save_failed');
    ctx.clean();
    status.say('saved');
  }

  async function offer(panel) {
    panel.hidden = true;
    const stored = storage((s) => s.getItem(KEY));
    if (!stored) return;
    let plan;
    try {
      plan = await client.call('inputs.decode', { stored });
    } catch {
      return status.say('unreadable');
    }
    panel.querySelector('[data-calc-saved-at]').textContent = plan.savedAtText;
    panel.querySelector('[data-calc-open]').onclick = () => {
      state.inputs = plan.inputs;
      ctx.clean();
      ctx.visit(plan.open, { push: true, focus: true });
    };
    panel.querySelector('[data-calc-delete]').onclick = () => {
      storage((s) => s.removeItem(KEY));
      panel.hidden = true;
      status.say('deleted');
      panel.closest('.calc-screen')?.querySelector('h1')?.focus();
    };
    panel.hidden = false;
  }

  // Wires a freshly shown screen: its save button, or on the start screen
  // the saved plan (if any).
  return function onScreen(section) {
    const bar = section.querySelector('[data-calc-save]');
    if (bar) {
      bar.hidden = false;
      bar.querySelector('button').onclick = save;
    }
    const panel = section.querySelector('[data-calc-saved]');
    if (panel) offer(panel);
  };
}
