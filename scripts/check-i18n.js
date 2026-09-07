const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const LOCALE_DIR = path.join(SRC_DIR, "i18n", "locales");
const LOCALES = ["zh-CN", "en-US"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx"]);

// Allow reporting unused keys without failing CI by default.
// Set CHECK_I18N_UNUSED=error to fail on unused keys.
const UNUSED_MODE = (process.env.CHECK_I18N_UNUSED || "warn").toLowerCase();
// Set CHECK_I18N_HARDCODED=error to fail on hardcoded UI strings.
const HARDCODED_MODE = (
  process.env.CHECK_I18N_HARDCODED || "warn"
).toLowerCase();

const TRANSLATION_IDENTIFIERS = new Set([
  "t",
  "mainT",
  "translate",
  // Project helpers that forward the first-arg key to mainT/t
  "aiText",
  "aiWorkerText",
  "fileText",
  "transferText",
  "systemInfoText",
  "latencyText",
  "ipQueryText",
  "aiManagerText",
]);
const TRANSLATION_MEMBER_PROPERTIES = new Set(["t", "current"]);

const parseJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const flatten = (value, prefix = "", output = new Map()) => {
  if (Array.isArray(value)) {
    output.set(prefix, value);
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  output.set(prefix, value);
  return output;
};

const unflattenDelete = (root, dottedKey) => {
  const parts = dottedKey.split(".");
  const stack = [{ parent: null, key: null, node: root }];
  let node = root;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!node || typeof node !== "object" || !(part in node)) {
      return false;
    }
    stack.push({ parent: node, key: part, node: node[part] });
    node = node[part];
  }

  // Delete leaf, then prune empty parents.
  for (let i = stack.length - 1; i >= 1; i -= 1) {
    const { parent, key } = stack[i];
    if (i === stack.length - 1) {
      delete parent[key];
    } else if (
      parent[key] &&
      typeof parent[key] === "object" &&
      !Array.isArray(parent[key]) &&
      Object.keys(parent[key]).length === 0
    ) {
      delete parent[key];
    } else {
      break;
    }
  }
  return true;
};

const getInterpolationNames = (value) => {
  if (typeof value !== "string") {
    return [];
  }

  const names = new Set();
  const regex = /{{\s*([A-Za-z0-9_.-]+)\s*}}/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    names.add(match[1]);
  }
  return [...names].sort();
};

const readSourceFiles = (dir, output = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".webpack" ||
        entry.name === ".webpack_cache"
      ) {
        continue;
      }
      readSourceFiles(fullPath, output);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
};

const parseSource = (filePath) =>
  parser.parse(fs.readFileSync(filePath, "utf8"), {
    sourceType: "unambiguous",
    plugins: ["jsx", "classProperties", "optionalChaining"],
    errorRecovery: true,
  });

const isStringLiteral = (node) =>
  node && (node.type === "StringLiteral" || node.type === "Literal");

const getStringLiteral = (node) => (isStringLiteral(node) ? node.value : null);

const getCalleeName = (callee) => {
  if (!callee) {
    return null;
  }

  if (callee.type === "Identifier") {
    return callee.name;
  }

  if (callee.type === "MemberExpression" && !callee.computed) {
    const objectName =
      callee.object?.type === "Identifier" ? callee.object.name : null;
    const propertyName =
      callee.property?.type === "Identifier" ? callee.property.name : null;

    if (objectName && propertyName) {
      return `${objectName}.${propertyName}`;
    }

    // Support tRef.current(...)
    if (
      callee.object?.type === "MemberExpression" &&
      callee.object.property?.type === "Identifier" &&
      propertyName
    ) {
      const nestedObject =
        callee.object.object?.type === "Identifier"
          ? callee.object.object.name
          : null;
      const nestedProp = callee.object.property.name;
      if (nestedObject) {
        return `${nestedObject}.${nestedProp}.${propertyName}`;
      }
    }

    return propertyName;
  }

  return null;
};

const isTranslationCall = (callee) => {
  const name = getCalleeName(callee);
  if (!name) {
    return false;
  }

  if (TRANSLATION_IDENTIFIERS.has(name)) {
    return true;
  }

  // i18n.t / something.t
  if (name.endsWith(".t")) {
    return true;
  }

  // tRef.current — only treat as translation when first arg looks like a key later
  if (name.endsWith(".current")) {
    return true;
  }

  if (
    callee?.type === "MemberExpression" &&
    callee.property?.type === "Identifier" &&
    TRANSLATION_MEMBER_PROPERTIES.has(callee.property.name)
  ) {
    return true;
  }

  return false;
};

const looksLikeI18nKey = (value) =>
  typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value);

const collectTranslationCalls = () => {
  const calls = [];
  const invalidDefaults = [];
  const dynamicCalls = [];

  for (const filePath of readSourceFiles(SRC_DIR)) {
    const ast = parseSource(filePath);
    traverse(ast, {
      CallExpression(callPath) {
        const { node } = callPath;
        if (!isTranslationCall(node.callee)) {
          return;
        }

        const key = getStringLiteral(node.arguments[0]);
        const loc = `${path.relative(ROOT, filePath)}:${node.loc?.start.line || 1}`;

        // tRef.current may be used for non-i18n callbacks; only count key-like strings.
        const calleeName = getCalleeName(node.callee) || "";
        if (calleeName.endsWith(".current") && key && !looksLikeI18nKey(key)) {
          return;
        }

        if (!key) {
          // Ignore clearly non-i18n dynamic calls on .current that aren't key-like
          if (calleeName.endsWith(".current")) {
            return;
          }
          dynamicCalls.push(loc);
          return;
        }

        calls.push({ key, loc });

        if (isStringLiteral(node.arguments[1])) {
          invalidDefaults.push({ key, loc });
        }
      },
    });
  }

  return { calls, dynamicCalls, invalidDefaults };
};

const compareReadmeHeadings = () => {
  const englishPath = path.join(ROOT, "README.md");
  const chinesePath = path.join(ROOT, "README_zh.md");
  if (!fs.existsSync(englishPath) || !fs.existsSync(chinesePath)) {
    return [];
  }

  const extract = (filePath) => {
    let inFence = false;
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => {
        if (/^```/.test(line.trim())) {
          inFence = !inFence;
          return false;
        }
        return !inFence && /^#{1,3}\s+/.test(line);
      })
      .map((line) => line.match(/^(#{1,3})\s+/)[1].length);
  };

  const en = extract(englishPath);
  const zh = extract(chinesePath);
  if (en.length !== zh.length) {
    return [
      `README heading count mismatch: README.md=${en.length}, README_zh.md=${zh.length}`,
    ];
  }

  const issues = [];
  for (let index = 0; index < en.length; index += 1) {
    if (en[index] !== zh[index]) {
      issues.push(
        `README heading level mismatch at heading ${index + 1}: README.md=h${en[index]}, README_zh.md=h${zh[index]}`,
      );
    }
  }
  return issues;
};

const HARDCODED_SKIP_DIRS = new Set([
  "i18n",
  "node_modules",
  ".webpack",
  ".webpack_cache",
  "assets",
]);

const HARDCODED_SKIP_FILES = new Set([
  // Locale loaders and pure log utilities may contain Chinese for matching only.
  path.normalize("shared/connectionErrorAdvice.js"),
  path.normalize("shared/errorClassification.js"),
  path.normalize("shared/mainI18n.js"),
  // Bilingual retryable/session error matcher lists (matching logic, not UI text).
  path.normalize(path.join("modules", "sftp", "sftpConfig.js")),
]);

// Renderer UI surfaces scanned for hardcoded strings (both Chinese and English).
const HARDCODED_CORE_SURFACE_DIRS = new Set([
  "components",
  "hooks",
  "contexts",
  "store",
]);
// Service-layer modules: Chinese + UI-property English literals are flagged;
// generic English sentences here are mostly internal error strings (tracked
// separately as error-message i18n work), so a blanket scan would be too noisy.
const HARDCODED_MODULE_SURFACE_DIRS = new Set(["modules"]);

const isCoreUiSurface = (parts, rel) =>
  HARDCODED_CORE_SURFACE_DIRS.has(parts[0]) ||
  rel === "app.jsx" ||
  rel === path.join("core", "utils", "formatters.js");

const isModuleUiSurface = (parts) =>
  HARDCODED_MODULE_SURFACE_DIRS.has(parts[0]);

const UI_PROP_ASSIGN =
  /\b(title|label|placeholder|helperText|aria-label|message|description|tooltip|text|header|subtitle|hint|button|caption)\s*[:=]\s*['"`]/i;

const ENGLISH_CHARSET = /^[A-Za-z0-9 ,.!?%:()'-]+$/;
const ENGLISH_WORD = /^[A-Za-z][A-Za-z'-]*$/;

// A string counts as English prose when it has 2+ purely alphabetic words and
// at least one all-lowercase word (excludes brand/protocol tokens like
// "Liberation Mono", acronyms such as "SSH2", font names, etc.).
const looksLikeEnglishProse = (value) => {
  if (value.length < 4 || !ENGLISH_CHARSET.test(value)) {
    return false;
  }
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return false;
  }
  return (
    words.every((word) => ENGLISH_WORD.test(word)) &&
    words.some((word) => /^[a-z][a-z'-]+$/.test(word))
  );
};

// Single capitalized word in a UI-property position (e.g. label: "Welcome").
const looksLikeEnglishUiWord = (value) => /^[A-Z][a-z]{2,}$/.test(value);

// JSX text between tags: >中文< or >English prose< — no braces/equals inside.
const JSX_TEXT_PATTERN = />([^<>={}]{3,})</g;

const isHardcodedJsxText = (value) =>
  /[\u4e00-\u9fff]/.test(value) || looksLikeEnglishProse(value);

const extractQuotedStrings = (line) => {
  const values = [];
  const quoted = /['"`]([^'"`\n]+)['"`]/g;
  let match;
  while ((match = quoted.exec(line)) !== null) {
    values.push(match[1]);
  }
  return values;
};

const collectHardcodedUiStrings = () => {
  const findings = [];
  const pushFinding = (filePath, lineNo, sample) => {
    const clean = sample.replace(/\s+/g, " ").trim().slice(0, 80);
    if (clean) {
      findings.push({
        loc: `${path.relative(ROOT, filePath)}:${lineNo}`,
        sample: clean,
      });
    }
  };

  for (const filePath of readSourceFiles(SRC_DIR)) {
    const rel = path.relative(SRC_DIR, filePath);
    const parts = rel.split(path.sep);
    if (parts.some((part) => HARDCODED_SKIP_DIRS.has(part))) {
      continue;
    }
    if (HARDCODED_SKIP_FILES.has(path.normalize(rel))) {
      continue;
    }

    const isCoreSurface = isCoreUiSurface(parts, rel);
    const isModuleSurface = isModuleUiSurface(parts);
    if (!isCoreSurface && !isModuleSurface) {
      continue;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      // Strip line comments so `code // 中文说明` is not flagged.
      const withoutLineComment = line.replace(/(^|[^:])\/\/.*$/, "$1");
      const trimmed = withoutLineComment.trim();
      if (
        !trimmed ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("//")
      ) {
        return;
      }
      const hasChinese = /[\u4e00-\u9fff]/.test(withoutLineComment);
      if (!hasChinese && !/['"`]/.test(withoutLineComment)) {
        return;
      }
      // Ignore import paths, log utilities, and bilingual matchers/regexes.
      const prev = index > 0 ? lines[index - 1] : "";
      if (
        /^\s*import\s+/.test(withoutLineComment) ||
        /require\s*\(/.test(withoutLineComment) ||
        /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(
          withoutLineComment,
        ) ||
        /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(prev) ||
        /\blogToFile\s*\(/.test(withoutLineComment) ||
        /\bcase\s+['"`]/.test(withoutLineComment) ||
        /\b(rel|target|className)\s*=/.test(withoutLineComment) ||
        /\b(contain|willChange|transformOrigin|preserveAspectRatio)\s*[:=]/.test(
          withoutLineComment,
        ) ||
        /\.includes\s*\(/.test(withoutLineComment) ||
        /\.test\s*\(/.test(withoutLineComment) ||
        /new\s+RegExp\s*\(/.test(withoutLineComment) ||
        /new\s+RegExp\s*\(/.test(prev) ||
        /\/[^/\n]*[\u4e00-\u9fff][^/\n]*\//.test(withoutLineComment)
      ) {
        return;
      }

      // 1) Quoted strings.
      for (const value of extractQuotedStrings(withoutLineComment)) {
        if (/\$\{/.test(value)) {
          // Interpolated templates are rarely UI literals; skip to cut noise.
          continue;
        }

        if (hasChinese) {
          // Chinese: flag quoted Chinese on a likely UI-facing line.
          const likelyUi =
            UI_PROP_ASSIGN.test(withoutLineComment) ||
            /['"`][^'"`]*[\u4e00-\u9fff][^'"`]*['"`]/.test(withoutLineComment);
          if (
            likelyUi &&
            /[\u4e00-\u9fff]/.test(value) &&
            // Quoted-string matchers (`x === "中文"`) are matching logic.
            !/===|!==/.test(withoutLineComment)
          ) {
            pushFinding(filePath, index + 1, value);
            break;
          }
          continue;
        }

        // English: heuristic detection of hardcoded UI literals.
        const isUiProp = UI_PROP_ASSIGN.test(withoutLineComment);
        if (isCoreSurface && looksLikeEnglishProse(value)) {
          // t()-mapping tables (`"Go to line": t(...)`) and context-provider
          // developer errors are not user-visible UI text.
          if (
            /\bt\s*\(/.test(withoutLineComment) ||
            /===|!==/.test(withoutLineComment) ||
            /must be used (within|with)\b/.test(value)
          ) {
            continue;
          }
          pushFinding(filePath, index + 1, value);
          break;
        }
        if (
          isUiProp &&
          (looksLikeEnglishProse(value) || looksLikeEnglishUiWord(value)) &&
          !/[\u4e00-\u9fff]/.test(value)
        ) {
          pushFinding(filePath, index + 1, value);
          break;
        }
      }

      // 2) JSX text between tags (>中文< / >English prose<) — only when the
      // line has no quoted sample already reported above.
      if (!/['"`][^'"`]*[\u4e00-\u9fff][^'"`]*['"`]/.test(withoutLineComment)) {
        JSX_TEXT_PATTERN.lastIndex = 0;
        let jsxMatch;
        while (
          (jsxMatch = JSX_TEXT_PATTERN.exec(withoutLineComment)) !== null
        ) {
          if (isHardcodedJsxText(jsxMatch[1])) {
            pushFinding(filePath, index + 1, jsxMatch[1]);
            break;
          }
        }
      }
    });
  }

  return findings;
};

const main = () => {
  const issues = [];
  const warnings = [];
  const localeMaps = new Map();
  const localeRoots = new Map();

  for (const locale of LOCALES) {
    const filePath = path.join(LOCALE_DIR, `${locale}.json`);
    const parsed = parseJson(filePath);
    localeRoots.set(locale, parsed);
    localeMaps.set(locale, flatten(parsed.translation || parsed));
  }

  const [baseLocale, ...otherLocales] = LOCALES;
  const base = localeMaps.get(baseLocale);
  const baseKeys = new Set(base.keys());

  for (const locale of otherLocales) {
    const map = localeMaps.get(locale);
    const keys = new Set(map.keys());

    for (const key of baseKeys) {
      if (!keys.has(key)) {
        issues.push(`${locale} is missing key: ${key}`);
      }
    }
    for (const key of keys) {
      if (!baseKeys.has(key)) {
        issues.push(`${locale} has extra key: ${key}`);
      }
    }
  }

  for (const key of baseKeys) {
    const values = LOCALES.map((locale) => ({
      locale,
      value: localeMaps.get(locale).get(key),
    }));

    for (const { locale, value } of values) {
      if (typeof value === "string" && value.trim().length === 0) {
        issues.push(`${locale}.${key} is an empty translation`);
      }
    }

    const interpolationSignatures = values.map(({ locale, value }) => ({
      locale,
      names: getInterpolationNames(value).join(","),
    }));
    const [first] = interpolationSignatures;
    for (const current of interpolationSignatures.slice(1)) {
      if (current.names !== first.names) {
        issues.push(
          `Interpolation mismatch for ${key}: ${first.locale}=[${first.names}], ${current.locale}=[${current.names}]`,
        );
      }
    }
  }

  const i18nConfig = fs.readFileSync(
    path.join(SRC_DIR, "i18n", "i18n.js"),
    "utf8",
  );
  if (!/fallbackLng\s*:\s*false\b/.test(i18nConfig)) {
    issues.push(
      "i18n fallbackLng must be false; translation fallback is not allowed",
    );
  }

  const { calls, invalidDefaults, dynamicCalls } = collectTranslationCalls();
  const usedKeys = new Set(calls.map((call) => call.key));

  for (const { key, loc } of calls) {
    for (const locale of LOCALES) {
      if (!localeMaps.get(locale).has(key)) {
        issues.push(`${loc} uses missing ${locale} key: ${key}`);
      }
    }
  }

  for (const { key, loc } of invalidDefaults) {
    issues.push(`${loc} uses a translation default value for ${key}`);
  }

  for (const loc of dynamicCalls) {
    issues.push(
      `${loc} uses a dynamic translation key; strict i18n requires static keys`,
    );
  }

  issues.push(...compareReadmeHeadings());

  const unusedKeys = [...baseKeys].filter((key) => !usedKeys.has(key)).sort();
  if (unusedKeys.length > 0) {
    const message = `Unused translation keys (${unusedKeys.length}): ${unusedKeys.slice(0, 20).join(", ")}${unusedKeys.length > 20 ? ", ..." : ""}`;
    if (UNUSED_MODE === "error") {
      issues.push(message);
      for (const key of unusedKeys) {
        issues.push(`unused key: ${key}`);
      }
    } else if (UNUSED_MODE !== "off") {
      warnings.push(message);
      if (process.env.CHECK_I18N_UNUSED_VERBOSE === "1") {
        for (const key of unusedKeys) {
          warnings.push(`unused key: ${key}`);
        }
      }
    }
  }

  const hardcoded = collectHardcodedUiStrings();
  if (hardcoded.length > 0) {
    const message = `Hardcoded UI strings in renderer (${hardcoded.length}): ${hardcoded
      .slice(0, 8)
      .map((item) => `${item.loc} "${item.sample}"`)
      .join("; ")}${hardcoded.length > 8 ? "; ..." : ""}`;
    if (HARDCODED_MODE === "error") {
      issues.push(message);
      for (const item of hardcoded) {
        issues.push(`hardcoded UI: ${item.loc} -> "${item.sample}"`);
      }
    } else if (HARDCODED_MODE !== "off") {
      warnings.push(message);
      if (process.env.CHECK_I18N_HARDCODED_VERBOSE === "1") {
        for (const item of hardcoded) {
          warnings.push(`hardcoded UI: ${item.loc} -> "${item.sample}"`);
        }
      }
    }
  }

  // Optional prune mode used by maintainers: CHECK_I18N_PRUNE_UNUSED=1
  if (process.env.CHECK_I18N_PRUNE_UNUSED === "1" && unusedKeys.length > 0) {
    for (const locale of LOCALES) {
      const root = localeRoots.get(locale);
      const translation = root.translation || root;
      for (const key of unusedKeys) {
        unflattenDelete(translation, key);
      }
      const filePath = path.join(LOCALE_DIR, `${locale}.json`);
      fs.writeFileSync(filePath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
    }
    console.log(`Pruned ${unusedKeys.length} unused keys from locale files.`);
  }

  if (warnings.length > 0) {
    console.warn("i18n check warnings:");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (issues.length > 0) {
    console.error("i18n check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(
    `i18n check passed: ${baseKeys.size} keys, ${calls.length} translation calls, ${LOCALES.length} locales` +
      (unusedKeys.length ? `, ${unusedKeys.length} unused (warned)` : "") +
      (hardcoded.length ? `, ${hardcoded.length} hardcoded UI (warned)` : ""),
  );
};

main();
