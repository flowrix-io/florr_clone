// Storage recovery: see, edit, export and clear what this page keeps in the browser -- the session, the settings, the boot script -- without starting the game.
//
// For a client that will not start, or starts into something wrong: settings
// that crash it, a session stuck on an account, a boot script that should
// not be there. Everything here works on the browser's own storage, so none
// of it needs the game, and the game is not downloaded until "Start the
// game" says so.
//
// The client's files are kept under a prefix (Module.flixBoot.prefix), base64
// encoded, which is how client/web/persist.cpp writes them; this decodes them
// to show and encodes them again to save. Anything else in the page's storage
// is shown as it is.
//
// A boot script (client/web/boot.h): the page runs it in place of the game,
// and Module.flixBoot is how it reaches the page.

(() => {
  'use strict';

  const boot = Module.flixBoot;
  const prefix = boot.prefix;
  const encodedPrefixes = ['flowrix/', 'flowrix-offline/'];

  // --- storage --------------------------------------------------------------

  let storage = null;
  try {
    localStorage.setItem('flowrix-probe', '1');
    localStorage.removeItem('flowrix-probe');
    storage = localStorage;
  } catch (e) {
    storage = null;
  }

  const encoded = (key) => encodedPrefixes.some((p) => key.startsWith(p));
  const toBytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const fromBytes = (bytes) => {
    let binary = '';
    for (let at = 0; at < bytes.length; at += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 8192));
    }
    return btoa(binary);
  };
  /** The value of `key` as text, or null when it is not text. */
  const readText = (key) => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (!encoded(key)) return raw;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(toBytes(raw));
    } catch (e) {
      return null;
    }
  };
  const byteSize = (key) => {
    const raw = storage.getItem(key) || '';
    if (!encoded(key)) return new TextEncoder().encode(raw).length;
    try { return toBytes(raw).length; } catch (e) { return raw.length; }
  };
  const writeText = (key, text) => {
    storage.setItem(key, encoded(key) ? fromBytes(new TextEncoder().encode(text)) : text);
  };
  const keys = () => {
    const out = [];
    for (let i = 0; i < storage.length; ++i) out.push(storage.key(i));
    return out.sort();
  };
  const kb = (bytes) => bytes < 1024 ? bytes + ' B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(2) + ' MB';

  const download = (name, text) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    link.download = name;
    document.body.append(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  };

  // --- the page -------------------------------------------------------------

  const make = (tag, style, text) => {
    const element = document.createElement(tag);
    element.style.cssText = style || '';
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const kButton = 'font:700 13px Ubuntu,sans-serif;color:#fff;border:0;border-radius:4px;' +
    'padding:6px 12px;cursor:pointer;background:';
  const button = (label, colour, onClick) => {
    const element = make('button', kButton + colour, label);
    element.addEventListener('click', onClick);
    return element;
  };
  const kTeal = '#3e7c74';
  const kRed = '#c0504d';
  const kGreen = '#4caf50';

  const page = make('div', 'position:fixed;inset:0;z-index:1000;overflow:auto;background:#16191c;' +
    'color:#e6e6e6;font:14px Ubuntu,sans-serif;padding:24px');
  const column = make('div', 'max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:14px');
  page.append(column);
  // The game is not running, but its keyboard handling may be by the time
  // "Start the game" has been pressed; nothing typed here should reach it.
  for (const type of ['keydown', 'keyup', 'keypress']) page.addEventListener(type, (e) => e.stopPropagation());

  const card = (heading) => {
    const element = make('div', 'background:#22272c;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px');
    if (heading) element.append(make('div', 'font:700 16px Ubuntu,sans-serif', heading));
    column.append(element);
    return element;
  };
  const row = (...children) => {
    const element = make('div', 'display:flex;gap:8px;flex-wrap:wrap;align-items:center');
    element.append(...children);
    return element;
  };
  const note = make('div', 'min-height:18px;color:#b9f6a6');
  const say = (text, ok = true) => {
    note.textContent = text;
    note.style.color = ok ? '#b9f6a6' : '#ffb0b0';
  };

  // Heading.
  {
    const top = card();
    top.append(make('div', 'font:700 22px Ubuntu,sans-serif', 'Storage recovery'));
    top.append(make('div', 'color:#aab6b4', 'This page ran ' + boot.path + ' instead of the game. ' +
      'Nothing below needs the game; it starts only when you say so.'));
    top.append(row(
      button('Start the game', kGreen, () => { page.remove(); boot.startGame(); }),
      button('Start the game from now on', kTeal, () => { boot.clear(); location.reload(); }),
      button('Reload', kTeal, () => location.reload())));
    top.append(note);
  }

  if (!storage) {
    card('No storage').append(make('div', '', 'This browser gives the page no storage (a private window, or ' +
      'storage blocked for the site), so there is nothing kept to recover.'));
    document.body.append(page);
    return;
  }

  // Quick actions.
  const list = make('div', 'display:flex;flex-direction:column;gap:6px');
  {
    const actions = card('Quick fixes');
    actions.append(make('div', 'color:#aab6b4', 'Each removes one thing the client keeps; the client ' +
      'starts as it would on a first visit without it.'));
    const removing = (key, done) => () => {
      storage.removeItem(prefix + key);
      say(done);
      render();
    };
    actions.append(row(
      button('Sign out', kTeal, removing('session', 'Signed out: the next start shows the login form.')),
      button('Reset settings', kTeal, removing('session-settings', 'Settings reset to the defaults.')),
      button('Forget the boot script', kTeal, () => { boot.clear(); say('The next load starts the game.'); render(); }),
      button('Export everything', kTeal, () => {
        const all = {};
        for (const key of keys()) all[key] = storage.getItem(key);
        download('flowrix-storage-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json',
                 JSON.stringify(all, null, 1));
        say('Exported ' + Object.keys(all).length + ' entries.');
      }),
      (() => {
        const picker = make('input');
        picker.type = 'file';
        picker.accept = '.json,application/json';
        picker.style.display = 'none';
        picker.addEventListener('change', async () => {
          const file = picker.files && picker.files[0];
          picker.value = '';
          if (!file) return;
          try {
            const entries = JSON.parse(await file.text());
            if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('not an export');
            const names = Object.keys(entries).filter((k) => typeof entries[k] === 'string');
            if (!confirm('Write ' + names.length + ' entries over what this page keeps?')) return;
            for (const key of names) storage.setItem(key, entries[key]);
            say('Imported ' + names.length + ' entries.');
            render();
          } catch (error) {
            say('Could not import: ' + error.message, false);
          }
        });
        const wrap = make('span');
        wrap.append(picker, button('Import…', kTeal, () => picker.click()));
        return wrap;
      })(),
      button('Clear everything', kRed, () => {
        if (!confirm('Remove everything this site keeps in this browser? The session, the settings and ' +
                     'any offline world go with it.')) return;
        storage.clear();
        say('Everything this site kept is gone.');
        render();
      })));
  }

  // The entries.
  {
    const entries = card('What this page keeps');
    entries.append(make('div', 'color:#aab6b4', 'The client’s own files are under ' + prefix +
      '. A session token is hidden until revealed: it is as good as the password while it lasts.'));
    entries.append(list);
  }

  const editor = (key, holder) => {
    const text = readText(key);
    const area = make('textarea', 'width:100%;min-height:180px;box-sizing:border-box;background:#14171a;' +
      'color:#e6e6e6;border:1px solid #3e7c74;border-radius:4px;padding:8px;font:12px ui-monospace,Menlo,Consolas,monospace');
    area.value = text === null ? '' : text;
    area.spellcheck = false;
    holder.replaceChildren(area, row(
      button('Save', kGreen, () => {
        try {
          writeText(key, area.value);
          say('Saved ' + key + '.');
          render();
        } catch (error) {
          say('Could not save ' + key + ': ' + error.message, false);
        }
      }),
      button('Cancel', kTeal, () => render())));
    area.focus();
  };

  const render = () => {
    list.replaceChildren();
    const all = keys();
    if (all.length === 0) {
      list.append(make('div', 'color:#aab6b4', 'Nothing is kept.'));
      return;
    }
    for (const key of all) {
      const entry = make('div', 'background:#1b1f23;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:6px');
      const text = readText(key);
      const secret = key.endsWith('/session');
      const head = row(make('span', 'font-weight:700;word-break:break-all', key),
                       make('span', 'color:#8a9a98', kb(byteSize(key)) + (encoded(key) ? ' · client file' : '')));
      const preview = make('pre', 'margin:0;white-space:pre-wrap;word-break:break-all;color:#b9c4c2;' +
        'font:12px ui-monospace,Menlo,Consolas,monospace;max-height:7.5em;overflow:hidden');
      const show = (reveal) => {
        if (text === null) preview.textContent = '(not text)';
        else if (text === '') preview.textContent = '(empty)';
        else if (secret && !reveal) preview.textContent = '•'.repeat(Math.min(24, text.length)) + '  (hidden)';
        else preview.textContent = text.length > 600 ? text.slice(0, 600) + '…' : text;
      };
      show(false);
      const holder = make('div');
      const actions = row();
      if (secret && text) actions.append(button('Reveal', kTeal, () => show(true)));
      if (text !== null) actions.append(button('Edit', kTeal, () => editor(key, holder)));
      actions.append(button('Download', kTeal, () => {
        const raw = storage.getItem(key) || '';
        if (encoded(key)) {
          try {
            const bytes = toBytes(raw);
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([bytes]));
            link.download = key.replace(/[\\/:]/g, '_');
            document.body.append(link);
            link.click();
            setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
            return;
          } catch (e) {
            // Not base64 after all: hand over what is there.
          }
        }
        download(key.replace(/[\\/:]/g, '_'), raw);
      }));
      actions.append(button('Delete', kRed, () => {
        if (!confirm('Delete ' + key + '?')) return;
        storage.removeItem(key);
        say('Deleted ' + key + '.');
        render();
      }));
      entry.append(head, preview, actions, holder);
      list.append(entry);
    }
  };

  document.body.append(page);
  render();
  console.info('[recovery] running in place of the game; Start the game is on the page');
})();
