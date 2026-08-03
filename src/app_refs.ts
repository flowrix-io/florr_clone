import type { Game } from './game';
import type { TitleScreen } from './title_screen';

/**
 * The two client-wide singletons — the running Game and the TitleScreen — held
 * in module scope instead of on `window`.
 *
 * These used to be `window.currentGame` / `window.titleScreen`, which handed
 * anyone with a console a live handle on the client: the socket, the local
 * player and every manager were one property access away, so trivially
 * scriptable cheats needed no tooling at all. Webpack bundles the whole client
 * into one module graph, so every real caller just imports these accessors;
 * nothing outside the bundle can reach them. Development builds re-expose
 * read-only getters on `window` for debugging — see dev_expose.ts.
 *
 * They are also cheaper to read: a `window` property is a lookup on a heavily
 * mutated, JIT-hostile object, where these are monomorphic module-scope reads
 * that V8 inlines into their callers — which matters on the per-frame paths.
 *
 * These are only references for other modules to reach the running instances.
 * They are NOT what decides who renders — the app shell's mode is
 * (see app_shell.ts).
 */
let currentGame: Game | null = null;
let titleScreen: TitleScreen | null = null;

export function setCurrentGame(game: Game | null): void {
    currentGame = game;
}

export function getCurrentGame(): Game | null {
    return currentGame;
}

export function setTitleScreen(screen: TitleScreen | null): void {
    titleScreen = screen;
}

export function getTitleScreen(): TitleScreen | null {
    return titleScreen;
}
