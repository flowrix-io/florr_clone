/**
 * Is this a development build?
 *
 * `__DEV__` is baked in by webpack's DefinePlugin from the build mode (see
 * webpack.config.js): `true` for `npm run dev`, `false` for `npm run build`.
 * The `typeof` guard keeps this safe under plain `tsc` (npm run build:server
 * compiles the client modules too), where the define never happens.
 *
 * Anything gated on this is *removed* from a production bundle by the
 * minifier, so it is the right switch for debug affordances that must not
 * ship — see dev_expose.ts.
 */
declare const __DEV__: boolean;

export const IS_DEV_BUILD: boolean = typeof __DEV__ !== 'undefined' && __DEV__ === true;
