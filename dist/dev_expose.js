"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exposeDevGlobals = exposeDevGlobals;
const dev_build_1 = require("./dev_build");
const app_refs_1 = require("./app_refs");
const preconnect_1 = require("./net/preconnect");
const preloader_1 = require("./preloader");
const petals_1 = require("./petals");
/**
 * Debug handles on `window`, for development builds only.
 *
 * The client's singletons deliberately live in module scope (see app_refs.ts)
 * so a production page hands nothing to a console cheat. That also takes them
 * away from *us*, which is a real cost when poking at a live client or driving
 * one from CDP — so `npm run dev` puts them back.
 *
 * They are accessors, not copies, so they always read through to the live
 * value, and they are get-only: reading the client from the console is a
 * debugging aid, reassigning its singletons is not.
 *
 * `IS_DEV_BUILD` is a compile-time constant in a webpack build, so the whole
 * body below folds away and the minifier drops it from `npm run build` output.
 * Verify with: `grep -c currentGame dist/bundle.js` (production must be 0).
 */
function exposeDevGlobals() {
    if (!dev_build_1.IS_DEV_BUILD)
        return;
    const handles = {
        currentGame: app_refs_1.getCurrentGame,
        titleScreen: app_refs_1.getTitleScreen,
        preconnectedSocket: preconnect_1.getPreconnectedSocket,
        preloadedAssets: preloader_1.getPreloadedAssets,
        petalConfig: () => petals_1.PETAL_CONFIG,
    };
    for (const [name, get] of Object.entries(handles)) {
        Object.defineProperty(window, name, { get, configurable: true });
    }
    console.log(`[dev] debug handles on window: ${Object.keys(handles).join(', ')}`);
}
