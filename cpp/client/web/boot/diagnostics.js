// System check: what this browser supports, whether the game's server answers, and how fast the game downloads and compiles -- a report to copy into a bug report, without starting the game.
//
// Everything the client needs from a browser is checked against the browser
// it is about to run in: WebAssembly with SIMD (the client is built with it,
// and will not load without it), the decompression the page uses for the
// download, the canvas, storage and the font. The connection test opens a
// socket to the address the game would dial and closes it again, and the
// download test fetches the game itself and compiles it, which is the whole
// of a first visit's wait. Nothing is sent to anyone else.
//
// A boot script (client/web/boot.h): the page runs it in place of the game,
// and Module.flixBoot is how it reaches the page.

(() => {
  'use strict';

  const boot = Module.flixBoot;
  const offline = !boot.prefix.startsWith('flowrix/') || location.protocol === 'file:';

  /** Rows of the report, by section, in the order they are shown. */
  const sections = [];
  const section = (title) => {
    const entry = { title, rows: [], element: null };
    sections.push(entry);
    return entry;
  };
  /** One finding. `status` is 'ok', 'warn', 'bad' or 'info'. */
  const report = (where, label, value, status = 'info') => {
    const entry = { label, value: String(value), status };
    where.rows.push(entry);
    draw();
    return entry;
  };
  const update = (entry, value, status) => {
    entry.value = String(value);
    if (status) entry.status = status;
    draw();
  };

  // --- the page -------------------------------------------------------------

  const make = (tag, style, text) => {
    const element = document.createElement(tag);
    element.style.cssText = style || '';
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (label, colour, onClick) => {
    const element = make('button', 'font:700 13px Ubuntu,sans-serif;color:#fff;border:0;border-radius:4px;' +
      'padding:6px 12px;cursor:pointer;background:' + colour, label);
    element.addEventListener('click', onClick);
    return element;
  };
  const page = make('div', 'position:fixed;inset:0;z-index:1000;overflow:auto;background:#16191c;' +
    'color:#e6e6e6;font:14px Ubuntu,sans-serif;padding:24px');
  const column = make('div', 'max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:14px');
  page.append(column);
  for (const type of ['keydown', 'keyup', 'keypress']) page.addEventListener(type, (e) => e.stopPropagation());

  const heading = make('div', 'background:#22272c;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px');
  heading.append(make('div', 'font:700 22px Ubuntu,sans-serif', 'System check'));
  heading.append(make('div', 'color:#aab6b4', 'This page ran ' + boot.path + ' instead of the game.'));
  const note = make('div', 'min-height:18px;color:#b9f6a6');
  const buttons = make('div', 'display:flex;gap:8px;flex-wrap:wrap');
  buttons.append(
    button('Copy the report', '#3e7c74', () => {
      const text = plainReport();
      const done = () => { note.textContent = 'Copied.'; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    }),
    button('Start the game', '#4caf50', () => { page.remove(); boot.startGame(); }),
    button('Start the game from now on', '#3e7c74', () => { boot.clear(); location.reload(); }));
  heading.append(buttons, note);
  column.append(heading);
  const body = make('div', 'display:flex;flex-direction:column;gap:14px');
  column.append(body);

  const kColour = { ok: '#b9f6a6', warn: '#ffd27a', bad: '#ff8a80', info: '#e6e6e6' };
  const kMark = { ok: '✓ ', warn: '! ', bad: '✗ ', info: '' };
  let drawPending = false;
  const draw = () => {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => {
      drawPending = false;
      body.replaceChildren(...sections.map((entry) => {
        const box = make('div', 'background:#22272c;border-radius:8px;padding:12px 16px');
        box.append(make('div', 'font:700 15px Ubuntu,sans-serif;margin-bottom:6px', entry.title));
        for (const row of entry.rows) {
          const line = make('div', 'display:flex;gap:12px;padding:3px 0;border-top:1px solid rgba(255,255,255,0.05)');
          line.append(make('div', 'flex:0 0 230px;color:#aab6b4', row.label),
                      make('div', 'flex:1;word-break:break-word;color:' + kColour[row.status], kMark[row.status] + row.value));
          box.append(line);
        }
        if (entry.extra) box.append(entry.extra);
        return box;
      }));
    });
  };
  const plainReport = () => {
    const lines = ['System check (' + new Date().toISOString() + ')', location.href, ''];
    for (const entry of sections) {
      lines.push('## ' + entry.title);
      for (const row of entry.rows) lines.push(row.label + ': ' + kMark[row.status] + row.value);
      lines.push('');
    }
    return lines.join('\n');
  };
  const fallbackCopy = (text, done) => {
    const area = make('textarea', 'position:fixed;left:-9999px');
    area.value = text;
    document.body.append(area);
    area.select();
    try { document.execCommand('copy'); done(); } catch (e) { note.textContent = 'Select the report and copy it by hand.'; }
    area.remove();
  };

  // --- the browser ----------------------------------------------------------

  const browser = section('Browser');
  report(browser, 'User agent', navigator.userAgent);
  report(browser, 'Platform', (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'unknown');
  report(browser, 'Language', navigator.language || 'unknown');
  report(browser, 'Online', navigator.onLine ? 'yes' : 'no', navigator.onLine ? 'ok' : 'warn');
  report(browser, 'Page', location.protocol + '//' + location.host + location.pathname);

  const screenSection = section('Screen and input');
  report(screenSection, 'Screen', screen.width + ' x ' + screen.height + ' at ' + (window.devicePixelRatio || 1) + 'x');
  report(screenSection, 'Window', window.innerWidth + ' x ' + window.innerHeight);
  report(screenSection, 'Touch points', navigator.maxTouchPoints || 0);
  report(screenSection, 'Pointer', matchMedia('(pointer: coarse)').matches ? 'coarse (touch)' : 'fine (mouse)');
  report(screenSection, 'Processor threads', navigator.hardwareConcurrency || 'unknown');
  if (navigator.deviceMemory) report(screenSection, 'Memory (approximate)', navigator.deviceMemory + ' GB');

  // --- what the client needs ------------------------------------------------

  const needs = section('What the game needs');
  const wasm = typeof WebAssembly === 'object';
  report(needs, 'WebAssembly', wasm ? 'yes' : 'no: the game cannot run here (try the offline asm.js page)', wasm ? 'ok' : 'bad');
  if (wasm) {
    // The smallest module with a SIMD instruction in it (wasm-feature-detect's).
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
      2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    report(needs, 'WebAssembly SIMD', simd ? 'yes' : 'no: the game is built with it and will not load', simd ? 'ok' : 'bad');
    report(needs, 'Streaming compile', typeof WebAssembly.compileStreaming === 'function' ? 'yes' : 'no (slower first load)',
           typeof WebAssembly.compileStreaming === 'function' ? 'ok' : 'warn');
  }
  let inflate = false;
  try { new DecompressionStream('deflate-raw'); inflate = true; } catch (e) { inflate = false; }
  report(needs, 'Compressed download', inflate ? 'yes (deflate-raw)' : 'no: the page downloads the uncompressed game, about five times the size',
         inflate ? 'ok' : 'warn');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  report(needs, 'Canvas 2D', context ? 'yes' : 'no', context ? 'ok' : 'bad');
  report(needs, 'OffscreenCanvas', typeof OffscreenCanvas === 'function' ? 'yes' : 'no (text and art cost more to draw)',
         typeof OffscreenCanvas === 'function' ? 'ok' : 'warn');
  try {
    const low = document.createElement('canvas').getContext('2d', { desynchronized: true });
    const attributes = low && low.getContextAttributes ? low.getContextAttributes() : null;
    report(needs, 'Low-latency canvas', attributes && attributes.desynchronized ? 'yes' : 'no', 'info');
  } catch (e) {
    report(needs, 'Low-latency canvas', 'no', 'info');
  }
  report(needs, 'WebTransport', typeof WebTransport === 'function' ? 'yes' : 'no (WebSocket only)', 'info');
  report(needs, 'Clipboard', navigator.clipboard ? 'yes' : 'no (copy and paste are limited)', navigator.clipboard ? 'ok' : 'warn');

  const font = report(needs, 'Ubuntu font', 'checking…');
  if (document.fonts && document.fonts.load) {
    Promise.race([
      document.fonts.load('bold 16px Ubuntu').then(() => document.fonts.check('bold 16px Ubuntu')),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]).then((ready) => update(font, ready ? 'loaded' : 'not loaded: text falls back to another face, and may not fit its boxes',
                              ready ? 'ok' : 'warn'),
            () => update(font, 'could not be loaded', 'warn'));
  } else {
    update(font, 'cannot tell (no font loading API)', 'info');
  }

  // --- storage --------------------------------------------------------------

  const store = section('Storage');
  let storageOk = false;
  let used = 0;
  let kept = 0;
  try {
    localStorage.setItem('flowrix-probe', '1');
    localStorage.removeItem('flowrix-probe');
    storageOk = true;
    for (let i = 0; i < localStorage.length; ++i) {
      const key = localStorage.key(i);
      used += (key.length + (localStorage.getItem(key) || '').length) * 2;
      if (key.startsWith(boot.prefix)) kept += 1;
    }
  } catch (e) {
    storageOk = false;
  }
  report(store, 'Browser storage', storageOk ? 'yes' : 'no: settings and the session are forgotten on every reload',
         storageOk ? 'ok' : 'bad');
  if (storageOk) {
    report(store, 'Kept by this site', (used / 1024).toFixed(1) + ' KB, ' + kept + ' client files');
    report(store, 'Boot script', boot.path + ' (this page)');
  }
  if (navigator.storage && navigator.storage.estimate) {
    const quota = report(store, 'Quota', 'checking…');
    navigator.storage.estimate().then((estimate) => {
      const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
      update(quota, mb(estimate.usage || 0) + ' used of ' + mb(estimate.quota || 0));
    }, () => update(quota, 'unknown'));
  }

  // --- the network ----------------------------------------------------------

  const network = section('Network');
  if (offline) {
    report(network, 'Server', 'in this page (the offline build): nothing to dial');
  } else {
    // The address the page hands the game: the shell puts it in the
    // arguments main() is given.
    const argument = (name) => {
      const args = boot.arguments || [];
      const at = args.indexOf(name);
      return at >= 0 ? args[at + 1] : null;
    };
    const host = argument('--host') || location.hostname;
    const port = argument('--port') || location.port;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + host + ':' + port + '/ws';
    const socketRow = report(network, 'Game server', 'connecting to ' + url + '…');
    const started = performance.now();
    try {
      const socket = new WebSocket(url, 'binary');
      const timer = setTimeout(() => {
        update(socketRow, url + ': no answer in 8 s', 'bad');
        try { socket.close(); } catch (e) { }
      }, 8000);
      socket.onopen = () => {
        clearTimeout(timer);
        update(socketRow, url + ': answered in ' + Math.round(performance.now() - started) + ' ms', 'ok');
        socket.close();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        update(socketRow, url + ': could not connect (blocked, down, or a certificate it will not accept)', 'bad');
      };
    } catch (error) {
      update(socketRow, url + ': ' + error.message, 'bad');
    }

    const download = report(network, 'Download and compile', 'not run: it fetches the whole game (about a megabyte)', 'info');
    network.extra = button('Run the download test', '#3e7c74', async () => {
      network.extra = null;
      update(download, 'downloading…');
      try {
        const t0 = performance.now();
        let response = inflate ? await fetch('bundle.wasm.bin', { cache: 'no-store' }) : null;
        const packed = !!(response && response.ok);
        if (!packed) response = await fetch('bundle.wasm', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const raw = await response.arrayBuffer();
        const t1 = performance.now();
        const bytes = packed
          ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()
          : raw;
        const t2 = performance.now();
        await WebAssembly.compile(bytes);
        const t3 = performance.now();
        const seconds = (t1 - t0) / 1000;
        update(download, (raw.byteLength / 1048576).toFixed(2) + ' MB in ' + seconds.toFixed(2) + ' s (' +
          (raw.byteLength / 1048576 / Math.max(seconds, 0.001)).toFixed(2) + ' MB/s)' +
          (packed ? ', inflated in ' + Math.round(t2 - t1) + ' ms' : '') +
          ', compiled in ' + Math.round(t3 - t2) + ' ms', 'ok');
      } catch (error) {
        update(download, 'failed: ' + error.message, 'bad');
      }
    });
  }

  document.body.append(page);
  draw();
  console.info('[diagnostics] running in place of the game; Start the game is on the page');
})();
