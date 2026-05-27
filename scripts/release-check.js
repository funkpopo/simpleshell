const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const packagePath = path.join(projectRoot, "package.json");
const cargoPath = path.join(
  projectRoot,
  "transfernative",
  "transfer-sidecar",
  "Cargo.toml",
);
const readmePath = path.join(projectRoot, "README.md");
const readmeZhPath = path.join(projectRoot, "README_zh.md");
const forgeConfigPath = path.join(projectRoot, "forge.config.js");
const mainPath = path.join(projectRoot, "src", "main.js");
const windowManagerPath = path.join(
  projectRoot,
  "src",
  "core",
  "window",
  "windowManager.js",
);
const indexHtmlPath = path.join(projectRoot, "src", "index.html");
const releaseWorkflowPath = path.join(
  projectRoot,
  ".github",
  "workflows",
  "release.yml",
);
const entitlementsPath = path.join(projectRoot, "entitlements.plist");
const logoIcoPath = path.join(projectRoot, "src", "assets", "logo.ico");
const logoPngPath = path.join(projectRoot, "src", "assets", "SimpleShell.png");

const sidecarName =
  process.platform === "win32" ? "transfer-sidecar.exe" : "transfer-sidecar";
const sidecarPath = path.join(
  projectRoot,
  "transfernative",
  "bin",
  `${process.platform}-${process.arch}`,
  sidecarName,
);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing file: ${path.relative(projectRoot, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    fail(
      `Invalid JSON in ${path.relative(projectRoot, filePath)}: ${error.message}`,
    );
    return {};
  }
}

function readCargoVersion(content) {
  const match = content.match(
    /\[package\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m,
  );
  return match ? match[1] : null;
}

function requireText(filePath, expected) {
  const content = readText(filePath);
  if (!content.includes(expected)) {
    fail(`${path.relative(projectRoot, filePath)} must contain: ${expected}`);
  }
}

function requireExistingFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${label} is missing: ${path.relative(projectRoot, filePath)}`);
  }
}

function main() {
  const pkg = readJson(packagePath);
  const cargoContent = readText(cargoPath);
  const cargoVersion = readCargoVersion(cargoContent);
  const forgeConfig = readText(forgeConfigPath);
  const version = typeof pkg.version === "string" ? pkg.version.trim() : "";

  if (!version) {
    fail("package.json version is missing");
  }

  if (pkg.productName !== "SimpleShell") {
    fail('package.json productName must be "SimpleShell"');
  }

  if (pkg.name !== "simpleshell") {
    fail('package.json name must remain "simpleshell" for package identity');
  }

  if (cargoVersion !== version) {
    fail(
      `transfernative/transfer-sidecar/Cargo.toml version (${cargoVersion || "missing"}) must match package.json (${version || "missing"})`,
    );
  }

  requireText(readmePath, `version-${version}-blue`);
  requireText(readmeZhPath, `版本-${version}-blue`);
  requireText(readmePath, '<h1 align="center">SimpleShell</h1>');
  requireText(readmeZhPath, '<h1 align="center">SimpleShell</h1>');
  requireText(forgeConfigPath, 'PRODUCT_NAME = "SimpleShell"');
  requireText(forgeConfigPath, 'APP_BUNDLE_ID = "com.funkpopo.simpleshell"');
  requireText(forgeConfigPath, "setupExe: `${PRODUCT_NAME}-Setup.exe`");
  requireText(mainPath, 'const PRODUCT_NAME = "SimpleShell";');
  requireText(mainPath, "app.setName(PRODUCT_NAME)");
  requireText(windowManagerPath, 'title: "SimpleShell"');
  requireText(indexHtmlPath, "<title>SimpleShell</title>");
  requireText(releaseWorkflowPath, "name: SimpleShell ${{ github.ref_name }}");
  requireText(forgeConfigPath, "win32metadata");
  requireText(forgeConfigPath, "osxSign");
  requireText(forgeConfigPath, "osxNotarize");
  requireText(forgeConfigPath, "maker-deb");
  requireText(forgeConfigPath, "maker-rpm");

  if (
    forgeConfig.includes("certificateFile") ||
    forgeConfig.includes("signWithParams")
  ) {
    fail(
      "Windows signing certificate settings must not be added to forge.config.js",
    );
  }

  requireExistingFile(logoIcoPath, "Windows ICO asset");
  requireExistingFile(logoPngPath, "Linux PNG asset");
  requireExistingFile(entitlementsPath, "macOS entitlements file");
  requireExistingFile(sidecarPath, "Current platform native sidecar");

  if (failures.length > 0) {
    console.error("Release check failed:");
    failures.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  console.log("Release check passed.");
}

main();
