/**
 * CodeMirror language ids for file preview - loaded on demand via dynamic import()
 * so the main renderer chunk does not pull every @codemirror/lang-* package at startup.
 * Bundled by webpack into async chunks; safe for packaged Electron (no Node.js on user PC).
 */

const getFileExtension = (filename) =>
  filename
    .slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2)
    .toLowerCase();

/**
 * @param {string} filename
 * @returns {string|null} language id for loaders map, or null for plain text
 */
export function getCodemirrorLanguageIdFromFilename(filename) {
  if (!filename || typeof filename !== "string") {
    return null;
  }

  const ext = getFileExtension(filename);
  const baseName = filename.toLowerCase();

  const langMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "javascript",
    tsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    vue: "javascript",
    html: "html",
    htm: "html",
    xhtml: "html",
    css: "css",
    scss: "css",
    sass: "css",
    less: "css",
    styl: "css",
    stylus: "css",
    json: "json",
    jsonc: "json",
    json5: "json",
    geojson: "json",
    py: "python",
    pyw: "python",
    pyi: "python",
    pyx: "python",
    ipynb: "json",
    java: "java",
    kt: "java",
    kts: "java",
    scala: "java",
    sc: "java",
    c: "cpp",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    c__: "cpp",
    h: "cpp",
    hpp: "cpp",
    hxx: "cpp",
    hh: "cpp",
    php: "php",
    phtml: "php",
    php3: "php",
    php4: "php",
    php5: "php",
    php7: "php",
    phps: "php",
    go: "go",
    mod: "go",
    rs: "rust",
    rlib: "rust",
    sql: "sql",
    mysql: "sql",
    pgsql: "sql",
    sqlite: "sql",
    plsql: "sql",
    xml: "xml",
    svg: "xml",
    xsl: "xml",
    xslt: "xml",
    xsd: "xml",
    dtd: "xml",
    plist: "xml",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    markdown: "markdown",
    mdown: "markdown",
    mkd: "markdown",
    mdx: "markdown",
    rst: "markdown",
    adoc: "markdown",
  };

  if (langMap[ext]) {
    return langMap[ext];
  }

  if (
    baseName === "package.json" ||
    baseName === "composer.json" ||
    baseName === "bower.json"
  ) {
    return "json";
  }

  if (
    baseName.endsWith(".eslintrc.js") ||
    baseName.endsWith(".prettierrc.js") ||
    baseName.endsWith(".babelrc.js")
  ) {
    return "javascript";
  }

  if (
    baseName === ".editorconfig" ||
    baseName === ".eslintrc" ||
    baseName === ".prettierrc" ||
    baseName === ".babelrc"
  ) {
    return "json";
  }

  return null;
}

const loaders = {
  javascript: () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
};

const extensionCache = new Map();

/**
 * @param {string|null} languageId
 * @returns {Promise<import('@codemirror/state').Extension|null>}
 */
export async function loadCodemirrorLanguageExtension(languageId) {
  if (!languageId || typeof languageId !== "string") {
    return null;
  }
  const loader = loaders[languageId];
  if (!loader) {
    throw new Error(`Unsupported CodeMirror language "${languageId}"`);
  }

  if (!extensionCache.has(languageId)) {
    extensionCache.set(
      languageId,
      loader().catch((error) => {
        extensionCache.delete(languageId);
        throw new Error(
          `Failed to load CodeMirror language "${languageId}": ${
            error?.message || "unknown error"
          }`,
        );
      }),
    );
  }

  return extensionCache.get(languageId);
}
