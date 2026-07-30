// Type declarations for the vendored, esbuild-bundled Sentry renderer SDK.
// Re-exports the REAL, official types from the npm package (@sentry/electron/renderer)
// so TypeScript checks our usage against Sentry's actual documented API, not a guess.
// The runtime code is the bundled sentry.electron.renderer.esm.js sitting next to this file.
//
// The bundled JS wraps the (internally CommonJS) Sentry SDK as a single DEFAULT export
// object rather than individual named exports (confirmed by inspecting the actual bundle:
// `exports.init = sdk.init;` etc. inside a CJS-interop shim, then `export default require_index();`).
// So this declaration must match that real shape: a default export whose properties are
// everything the real package exports as named members.
import * as SentryTypes from '@sentry/electron/renderer';
declare const SentryDefault: typeof SentryTypes;
export default SentryDefault;
