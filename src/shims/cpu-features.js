/**
 * Shim for the optional `cpu-features` native module.
 *
 * `ssh2` uses `cpu-features` only to optimize cipher ordering. In Electron 40
 * packaging, rebuilding `cpu-features` can fail on Windows (Node 24 / V8 14.4),
 * so we skip rebuilding it and provide this safe fallback for bundling/runtime.
 *
 * `ssh2` does: `require('cpu-features')()`
 * We return `null` so `ssh2` falls back to its default ordering.
 */

module.exports = function cpuFeaturesShim() {
  return null;
};

