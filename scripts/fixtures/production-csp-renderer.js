window.cspProbe = { externalScriptLoaded: true, evalBlocked: false };
const inlineScript = document.createElement("script");
inlineScript.textContent = "window.cspProbe.inlineScriptRan = true";
document.head.appendChild(inlineScript);
try {
  // This must be rejected by Chromium, even for a bundled local script.
  new Function("return 1")();
} catch {
  window.cspProbe.evalBlocked = true;
}
