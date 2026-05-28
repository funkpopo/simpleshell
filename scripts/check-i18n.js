const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const LOCALE_DIR = path.join(SRC_DIR, "i18n", "locales");
const LOCALES = ["zh-CN", "en-US"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx"]);

const parseJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, "utf8"));

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

const isTranslationCall = (callee) => {
  if (!callee) {
    return false;
  }

  if (callee.type === "Identifier" && callee.name === "t") {
    return true;
  }

  return (
    callee.type === "MemberExpression" &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "t"
  );
};

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

        if (!key) {
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

const main = () => {
  const issues = [];
  const localeMaps = new Map();

  for (const locale of LOCALES) {
    const filePath = path.join(LOCALE_DIR, `${locale}.json`);
    const parsed = parseJson(filePath);
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

  if (issues.length > 0) {
    console.error("i18n check failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(
    `i18n check passed: ${baseKeys.size} keys, ${calls.length} translation calls, ${LOCALES.length} locales`,
  );
};

main();
