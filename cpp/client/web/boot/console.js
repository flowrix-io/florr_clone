// Game with an on-screen console: every log line, warning and error, and a JavaScript prompt, over the game. F2 shows and hides it.
//
// For a device with no developer tools -- a phone, a locked-down machine -- or
// for watching the client's log while playing. It wraps console.log and the
// rest before the game starts, so it has every line the client prints from
// the first, plus uncaught errors and rejected promises; then it starts the
// game underneath itself.
//
// A boot script (client/web/boot.h): the page runs it in place of the game,
// and Module.flixBoot is how it reaches the page.

(() => {
  'use strict';

  const boot = Module.flixBoot;
  const kMaxLines = 2000;
  const kColours = { log: '#dddddd', info: '#8fd4ff', debug: '#a0a0a0', warn: '#ffd27a', error: '#ff8a80', result: '#b9f6a6', input: '#9fb3c8' };

  /** @type {{level: string, text: string, at: number}[]} */
  const lines = [];
  let filter = 'all';
  let shown = true;
  let unseenErrors = 0;

  const describe = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || String(value);
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return 'function ' + (value.name || '(anonymous)');
    try {
      const json = JSON.stringify(value, null, 1);
      if (json !== undefined) return json.length > 4000 ? json.slice(0, 4000) + '…' : json;
    } catch (e) {
      // A cycle, or a host object JSON will not take.
    }
    return String(value);
  };

  // --- the panel ------------------------------------------------------------

  const css = (element, style) => { element.style.cssText = style; return element; };
  const make = (tag, style, text) => {
    const element = css(document.createElement(tag), style || '');
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const root = make('div', 'position:fixed;left:0;right:0;bottom:0;height:38vh;min-height:160px;z-index:1000;' +
    'display:flex;flex-direction:column;background:rgba(14,16,18,0.93);color:#ddd;' +
    'font:12px ui-monospace,Menlo,Consolas,monospace;border-top:2px solid #3e7c74');
  const header = make('div', 'display:flex;align-items:center;gap:6px;padding:4px 8px;background:#1d2226;' +
    'font:700 13px Ubuntu,sans-serif;flex:none');
  const title = make('span', 'margin-right:8px', 'Console');
  header.append(title);
  const button = (label, onClick) => {
    const element = make('button', 'font:700 12px Ubuntu,sans-serif;color:#fff;background:#3e7c74;border:0;' +
      'border-radius:3px;padding:3px 9px;cursor:pointer', label);
    element.addEventListener('click', onClick);
    header.append(element);
    return element;
  };
  const filters = {};
  for (const [name, label] of [['all', 'All'], ['warn', 'Warnings'], ['error', 'Errors']]) {
    filters[name] = button(label, () => { filter = name; rebuild(); });
  }
  button('Clear', () => { lines.length = 0; rebuild(); });
  button('Copy', () => {
    const text = lines.map((line) => stamp(line.at) + ' ' + line.level.toUpperCase() + ' ' + line.text).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  });
  const spacer = make('span', 'flex:1');
  header.append(spacer);
  header.append(make('span', 'color:#8a9a98;font-weight:400', boot.path + ' · F2 hides'));
  button('Hide', () => show(false));

  const log = make('div', 'flex:1;overflow:auto;padding:4px 8px;white-space:pre-wrap;word-break:break-word');
  const promptRow = make('div', 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-top:1px solid #2c3338;flex:none');
  promptRow.append(make('span', 'color:#3e7c74;font-weight:700', '>'));
  const input = make('input', 'flex:1;background:transparent;border:0;outline:0;color:#fff;font:inherit');
  input.placeholder = 'JavaScript, run in the page';
  input.spellcheck = false;
  input.autocomplete = 'off';
  promptRow.append(input);
  root.append(header, log, promptRow);

  const toggle = make('button', 'position:fixed;right:8px;bottom:8px;z-index:1001;display:none;' +
    'font:700 12px Ubuntu,sans-serif;color:#fff;background:#3e7c74;border:0;border-radius:12px;' +
    'padding:5px 12px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4)', 'Console');
  toggle.addEventListener('click', () => show(true));

  // What happens in the panel stays there: without this the game, which
  // listens on the window, would read every key typed at the prompt and take
  // a click in the log for one aimed at the world.
  for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'wheel', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'contextmenu']) {
    root.addEventListener(type, (event) => event.stopPropagation());
    toggle.addEventListener(type, (event) => event.stopPropagation());
  }

  const stamp = (at) => {
    const date = new Date(at);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + '.' + pad(date.getMilliseconds(), 3);
  };
  const passes = (line) => filter === 'all' || line.level === filter ||
    (filter === 'warn' && line.level === 'error');
  const row = (line) => {
    const element = make('div', 'color:' + (kColours[line.level] || kColours.log) + ';padding:1px 0;border-bottom:1px solid rgba(255,255,255,0.04)');
    element.append(make('span', 'color:#5f6b72', stamp(line.at) + ' '), document.createTextNode(line.text));
    return element;
  };
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const rebuild = () => {
    for (const [name, element] of Object.entries(filters)) element.style.background = name === filter ? '#63a89e' : '#3e7c74';
    log.replaceChildren(...lines.filter(passes).map(row));
    log.scrollTop = log.scrollHeight;
  };
  const updateToggle = () => {
    toggle.textContent = unseenErrors > 0 ? 'Console (' + unseenErrors + ' new error' + (unseenErrors === 1 ? '' : 's') + ')' : 'Console';
    toggle.style.background = unseenErrors > 0 ? '#c0504d' : '#3e7c74';
  };
  const show = (on) => {
    shown = on;
    root.style.display = on ? 'flex' : 'none';
    toggle.style.display = on ? 'none' : 'block';
    if (on) {
      unseenErrors = 0;
      log.scrollTop = log.scrollHeight;
    }
    updateToggle();
  };

  const add = (level, parts) => {
    const line = { level, text: parts.map(describe).join(' '), at: Date.now() };
    lines.push(line);
    if (lines.length > kMaxLines) {
      const oldest = lines.shift();
      if (passes(oldest) && log.firstChild) log.firstChild.remove();
    }
    if (level === 'error' && !shown) {
      unseenErrors += 1;
      updateToggle();
    }
    if (!passes(line)) return;
    const follow = atBottom();
    log.append(row(line));
    if (follow) log.scrollTop = log.scrollHeight;
  };

  // --- capture --------------------------------------------------------------

  for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...parts) => {
      original(...parts);
      try { add(level, parts); } catch (e) { /* never let the log break the caller */ }
    };
  }
  window.addEventListener('error', (event) => {
    const where = event.filename ? ' (' + event.filename + ':' + event.lineno + ':' + event.colno + ')' : '';
    add('error', [(event.error && event.error.stack) || (event.message + where)]);
  });
  window.addEventListener('unhandledrejection', (event) => add('error', ['Unhandled rejection: ' + describe(event.reason)]));

  // --- the prompt -----------------------------------------------------------

  const history = [];
  let historyAt = 0;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.trim() !== '') {
      const code = input.value;
      history.push(code);
      historyAt = history.length;
      input.value = '';
      add('input', ['> ' + code]);
      try {
        // window.eval: global scope, as the developer tools' console has.
        const value = window.eval(code);
        if (value && typeof value.then === 'function') {
          value.then((settled) => add('result', ['↳ ' + describe(settled)]),
                     (error) => add('error', ['↳ ' + describe(error)]));
        } else {
          add('result', [describe(value)]);
        }
      } catch (error) {
        add('error', [describe(error)]);
      }
    } else if (event.key === 'ArrowUp' && historyAt > 0) {
      historyAt -= 1;
      input.value = history[historyAt];
      event.preventDefault();
    } else if (event.key === 'ArrowDown' && historyAt < history.length) {
      historyAt += 1;
      input.value = history[historyAt] || '';
      event.preventDefault();
    }
  });

  // F2 anywhere, at the capture phase, so the game never sees it.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F2') return;
    event.preventDefault();
    event.stopPropagation();
    show(!shown);
  }, true);

  document.body.append(root, toggle);
  rebuild();
  add('info', ['Console running (' + boot.path + '). The game is starting underneath; F2 hides this.']);
  boot.startGame();
})();
