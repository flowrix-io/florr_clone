// Game with a network monitor: the game's connection, its messages and bytes each way every second, the busiest message types, and how the connection closed. F3 shows and hides it.
//
// It wraps the page's WebSocket before the game starts, so it sees the
// connection the client makes from the first byte -- nothing in the client
// changes, and nothing is sent that the game would not have sent. A message's
// first byte is its type on this protocol (shared/net/), which is what the
// "busiest" lists count by.
//
// A boot script (client/web/boot.h): the page runs it in place of the game,
// and Module.flixBoot is how it reaches the page.

(() => {
  'use strict';

  const boot = Module.flixBoot;
  const kHistory = 60;

  const totals = { inMessages: 0, inBytes: 0, outMessages: 0, outBytes: 0 };
  const byTypeIn = new Map();
  const byTypeOut = new Map();
  /** Per-second samples, newest last. */
  const history = [];
  /** Every socket the page opened, newest last. */
  const sockets = [];
  let webTransport = false;

  const sizeOf = (data) => {
    if (typeof data === 'string') return data.length;
    if (data && typeof data.byteLength === 'number') return data.byteLength;
    if (data && typeof data.size === 'number') return data.size;
    return 0;
  };
  const firstByte = (data) => {
    if (data instanceof ArrayBuffer) return data.byteLength > 0 ? new Uint8Array(data)[0] : -1;
    if (ArrayBuffer.isView(data)) {
      return data.byteLength > 0 ? new Uint8Array(data.buffer, data.byteOffset, 1)[0] : -1;
    }
    return -1;
  };
  const count = (map, data, bytes) => {
    const type = firstByte(data);
    if (type < 0) return;
    const entry = map.get(type) || { messages: 0, bytes: 0 };
    entry.messages += 1;
    entry.bytes += bytes;
    map.set(type, entry);
  };

  // --- the wrapper ----------------------------------------------------------

  const Native = window.WebSocket;
  class MonitoredSocket extends Native {
    constructor(url, protocols) {
      super(url, protocols);
      const record = {
        url: String(url), state: 'connecting', started: performance.now(), opened: 0, ended: 0,
        code: null, reason: '', clean: true, error: false, inBytes: 0, outBytes: 0,
      };
      sockets.push(record);
      if (sockets.length > 20) sockets.shift();
      this.flixRecord = record;
      this.addEventListener('open', () => {
        record.state = 'open';
        record.opened = performance.now();
      });
      this.addEventListener('message', (event) => {
        const bytes = sizeOf(event.data);
        totals.inMessages += 1;
        totals.inBytes += bytes;
        record.inBytes += bytes;
        count(byTypeIn, event.data, bytes);
      });
      this.addEventListener('error', () => { record.error = true; });
      this.addEventListener('close', (event) => {
        record.state = 'closed';
        record.ended = performance.now();
        record.code = event.code;
        record.reason = event.reason;
        record.clean = event.wasClean;
      });
    }

    send(data) {
      const bytes = sizeOf(data);
      totals.outMessages += 1;
      totals.outBytes += bytes;
      if (this.flixRecord) this.flixRecord.outBytes += bytes;
      count(byTypeOut, data, bytes);
      return super.send(data);
    }
  }
  window.WebSocket = MonitoredSocket;

  // The client picks WebTransport over WebSocket when a server offers it. Its
  // streams are not counted here, but the panel says it is in use rather than
  // showing a quiet connection that is not the real one.
  if (typeof window.WebTransport === 'function') {
    const NativeTransport = window.WebTransport;
    window.WebTransport = class extends NativeTransport {
      constructor(...args) {
        super(...args);
        webTransport = true;
      }
    };
  }

  // --- the panel ------------------------------------------------------------

  const make = (tag, style, text) => {
    const element = document.createElement(tag);
    element.style.cssText = style || '';
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const root = make('div', 'position:fixed;top:64px;right:8px;width:320px;z-index:1000;' +
    'background:rgba(14,16,18,0.9);color:#ddd;border:1px solid #3e7c74;border-radius:6px;' +
    'font:12px ui-monospace,Menlo,Consolas,monospace;box-shadow:0 2px 8px rgba(0,0,0,0.4)');
  const header = make('div', 'display:flex;align-items:center;justify-content:space-between;' +
    'padding:5px 8px;background:#1d2226;border-radius:6px 6px 0 0;cursor:pointer;' +
    'font:700 13px Ubuntu,sans-serif');
  header.append(make('span', '', 'Network'), make('span', 'color:#8a9a98;font-weight:400;font-size:11px', 'F3 hides · click to fold'));
  const body = make('div', 'padding:6px 8px 8px');
  const summary = make('pre', 'margin:0;white-space:pre-wrap;font:inherit');
  // Positioned explicitly: the page's stylesheet pins every canvas full-size
  // over the page, which is right for the game's and wrong for this one.
  const graph = make('canvas', 'position:static;display:block;width:100%;height:46px;margin:6px 0;' +
    'background:#1a1f23;border-radius:3px;touch-action:auto');
  graph.width = 600;
  graph.height = 92;
  const busiest = make('pre', 'margin:0;white-space:pre-wrap;font:inherit;color:#b9c4c2');
  body.append(summary, graph, busiest);
  root.append(header, body);

  let folded = false;
  header.addEventListener('click', () => {
    folded = !folded;
    body.style.display = folded ? 'none' : 'block';
  });
  for (const type of ['mousedown', 'mouseup', 'wheel', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'contextmenu']) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F3') return;
    event.preventDefault();
    event.stopPropagation();
    root.style.display = root.style.display === 'none' ? 'block' : 'none';
  }, true);

  const kb = (bytes) => bytes < 1024 ? bytes.toFixed(0) + ' B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(2) + ' MB';
  const clock = (ms) => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    return pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
  };
  const closeMeaning = (code) => ({
    1000: 'normal', 1001: 'going away', 1002: 'protocol error', 1003: 'unsupported data',
    1005: 'no status', 1006: 'abnormal: dropped without a close', 1008: 'policy violation',
    1009: 'message too big', 1011: 'server error', 1012: 'service restart', 1013: 'try again later',
  })[code] || 'application-defined';
  const top = (map, total) => [...map.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 5)
    .map(([type, entry]) => '  0x' + type.toString(16).padStart(2, '0') + '  ' +
      String(Math.round(entry.bytes * 100 / Math.max(1, total))).padStart(3) + '%  ' +
      kb(entry.bytes).padStart(9) + '  ' + entry.messages + ' msg')
    .join('\n') || '  (nothing yet)';

  let last = { ...totals };
  const sample = () => {
    const now = { ...totals };
    history.push({
      inBytes: now.inBytes - last.inBytes, outBytes: now.outBytes - last.outBytes,
      inMessages: now.inMessages - last.inMessages, outMessages: now.outMessages - last.outMessages,
    });
    if (history.length > kHistory) history.shift();
    last = now;
    render();
  };

  const render = () => {
    const rate = history[history.length - 1] || { inBytes: 0, outBytes: 0, inMessages: 0, outMessages: 0 };
    const socket = sockets[sockets.length - 1];
    const text = [];
    if (!socket) {
      text.push(webTransport ? 'WebTransport in use: its streams are not counted.' : 'No connection yet.');
    } else {
      const age = socket.state === 'open' ? clock(performance.now() - socket.opened)
        : socket.state === 'closed' ? 'after ' + clock(socket.ended - (socket.opened || socket.started)) : '';
      text.push(socket.url);
      text.push(socket.state + (age ? '  ' + age : '') + (sockets.length > 1 ? '  (' + sockets.length + ' connections so far)' : ''));
      if (socket.state === 'closed') {
        text.push('closed ' + socket.code + ' (' + closeMeaning(socket.code) + ')' +
          (socket.reason ? ': ' + socket.reason : '') + (socket.error ? ', after an error' : ''));
      }
      if (webTransport) text.push('WebTransport also in use: its streams are not counted.');
    }
    text.push('');
    text.push('↓ ' + String(rate.inMessages).padStart(4) + ' msg/s ' + kb(rate.inBytes).padStart(9) + '/s   total ' + kb(totals.inBytes));
    text.push('↑ ' + String(rate.outMessages).padStart(4) + ' msg/s ' + kb(rate.outBytes).padStart(9) + '/s   total ' + kb(totals.outBytes));
    summary.textContent = text.join('\n');
    busiest.textContent = 'Busiest in, by bytes (first byte = type)\n' + top(byTypeIn, totals.inBytes) +
      '\nBusiest out\n' + top(byTypeOut, totals.outBytes);
    drawGraph();
  };

  const drawGraph = () => {
    const context = graph.getContext('2d');
    const w = graph.width;
    const h = graph.height;
    context.clearRect(0, 0, w, h);
    const peak = Math.max(1024, ...history.map((s) => Math.max(s.inBytes, s.outBytes)));
    const line = (key, colour) => {
      context.strokeStyle = colour;
      context.lineWidth = 3;
      context.beginPath();
      history.forEach((s, i) => {
        const x = w - (history.length - 1 - i) * (w / (kHistory - 1));
        const y = h - 4 - (s[key] / peak) * (h - 8);
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    line('outBytes', '#ffb74d');
    line('inBytes', '#64b5f6');
    context.fillStyle = '#8a9a98';
    context.font = '20px monospace';
    context.fillText(kb(peak) + '/s', 8, 22);
  };

  document.body.append(root);
  render();
  setInterval(sample, 1000);
  console.info('[netlog] watching WebSocket traffic; F3 shows and hides the panel');
  boot.startGame();
})();
