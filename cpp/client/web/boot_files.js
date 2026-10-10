  // --- a boot script's view of the game's files ------------------------------
  // Shared by both shells (client/web/shell.html, offline/shell.html): the
  // build writes this file into each where it says @FLIX_BOOT_FILES_JS@
  // (cpp/CMakeLists.txt), inside the shell's own function.
  //
  // A boot script sees the files the asset browser shows. While one runs, a
  // GET or HEAD -- by fetch or by XMLHttpRequest -- of a file under data/,
  // boot/ or persist/ reads the client's file system, not the web server's,
  // which has none of them: data/ and boot/ are embedded in the wasm, and
  // persist/ is the mount over browser storage (client/web/persist.h).
  //
  // Where a path points:
  //   * relative ("foo.wasm", "data/mobs.json"): beside the boot script first,
  //     then from the root. That is what lets an emscripten module run as a
  //     boot script find its .wasm (and .data) next to its .js: run by eval,
  //     the glue has no script URL to locate them by, and asks for the bare
  //     name. A relative path that names no file in either place goes to the
  //     network when it would not have been one of the game's files anyway --
  //     "bundle.wasm" stays the web server's -- and is a 404 when it would.
  //   * rooted ("/boot/x.js"), or a URL on this page's origin under this
  //     page's directory: that one path, from the root.
  // Anything else goes to the network as before.
  //
  // Only the runtime has data/ and boot/, so the first such request waits for
  // it (`runtime`, which on the online page also loads it). persist/ needs no
  // runtime: until main() has mounted it, its files are read straight out of
  // storage.
  //
  // An XMLHttpRequest that reads a file is re-opened on a blob: URL of its
  // bytes, so headers set between open() and send() are dropped. One that
  // finds no file goes to the network rather than faking a 404, and a
  // synchronous one can only be answered once the runtime is up; before that
  // it goes to the network too.
  //
  // options:
  //   path        the boot script's path, as the page was given it
  //   stored      name -> the bytes browser storage keeps for persist/<name>
  //   runtime     () -> a promise that settles when files() can be called
  //   ready       () -> whether files() can be called now
  //   files       () -> the game's FS
  //   mainCalled  () -> whether main() has run (and so mounted persist/)
  const installBootFiles = (options) => {
    const kRoots = ['/data/', '/boot/', '/persist/'];
    const kTypes = {
      js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
      tmj: 'application/json', tsj: 'application/json', wasm: 'application/wasm',
      svg: 'image/svg+xml', png: 'image/png', html: 'text/html', css: 'text/css',
      txt: 'text/plain',
    };
    const isGameFile = (path) => kRoots.some((root) => path.startsWith(root));
    const scriptDirectory = '/' + options.path.replace(/^\/+/, '').replace(/[^/]*$/, '');
    const resolve = (path, directory) => decodeURIComponent(new URL(path, 'file://' + directory).pathname);

    // Where a request may be, in the order to look, or null when it is not
    // the game's to answer. `network` says whether a request found in none of
    // them goes to the network rather than being a 404.
    const plan = (input, method) => {
      method = (method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return null;
      const text = String(input);
      let paths;
      let network = false;
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(text)) {
        const url = new URL(text, location.href);
        const page = new URL('.', location.href);
        if (url.protocol !== page.protocol || url.host !== page.host ||
            !url.pathname.startsWith(page.pathname)) return null;
        paths = [resolve('./' + url.pathname.slice(page.pathname.length), '/')];
      } else if (text.startsWith('/')) {
        paths = [resolve(text, '/')];
      } else {
        const fromRoot = resolve(text, '/');
        paths = [resolve(text, scriptDirectory), fromRoot];
        network = !isGameFile(fromRoot);
      }
      paths = paths.filter((path, i) => isGameFile(path) && paths.indexOf(path) === i);
      if (!paths.length) return null;
      return { paths, network, head: method === 'HEAD' };
    };

    const readFile = (path) => {
      if (path.startsWith('/persist/') && !options.mainCalled()) {
        return options.stored(path.slice('/persist/'.length));
      }
      try {
        // A copy: a view on the wasm heap is detached when the heap grows.
        return options.files().readFile(path).slice();
      } catch (e) {
        return null;
      }
    };
    // Whether readFile can answer `paths` without waiting for anything.
    const readableNow = (paths) => options.ready() ||
        paths.every((path) => path.startsWith('/persist/') && !options.mainCalled());
    const find = (paths) => {
      for (const path of paths) {
        const bytes = readFile(path);
        if (bytes) return { path, bytes };
      }
      return null;
    };
    const findLater = async (paths) => {
      if (!readableNow(paths)) await options.runtime();
      return find(paths);
    };
    const typeOf = (path) =>
      kTypes[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] || 'application/octet-stream';

    const networkFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      let request = null;
      try {
        const isRequest = input instanceof Request;
        request = plan(isRequest ? input.url : input,
                       (init && init.method) || (isRequest ? input.method : 'GET'));
      } catch (e) {
        // Not a path this understands; the network can say what is wrong.
      }
      if (!request) return networkFetch(input, init);
      const found = await findLater(request.paths);
      if (found) {
        return new Response(request.head ? null : found.bytes,
                            { headers: { 'Content-Type': typeOf(found.path) } });
      }
      if (request.network) return networkFetch(input, init);
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const xhr = XMLHttpRequest.prototype;
    const open = xhr.open;
    const send = xhr.send;
    xhr.open = function (method, url, ...rest) {
      try {
        this.flixRequest = plan(url, method);
      } catch (e) {
        this.flixRequest = null;
      }
      this.flixOpen = [method, url, ...rest];
      return open.call(this, method, url, ...rest);
    };
    xhr.send = function (body) {
      const request = this.flixRequest;
      if (!request) return send.call(this, body);
      this.flixRequest = null;
      const [method, , async = true, ...credentials] = this.flixOpen;
      const answer = (found) => {
        if (!found) return send.call(this, body);
        const url = URL.createObjectURL(new Blob([found.bytes], { type: typeOf(found.path) }));
        this.addEventListener('loadend', () => URL.revokeObjectURL(url), { once: true });
        open.call(this, method, url, async, ...credentials);
        return send.call(this, body);
      };
      if (readableNow(request.paths)) return answer(find(request.paths));
      if (!async) return send.call(this, body);
      findLater(request.paths).then(answer, () => send.call(this, body));
    };
  };
