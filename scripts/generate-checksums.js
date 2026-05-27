/* eslint-disable no-console */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.resolve(projectRoot, process.argv[2] || "out");
const checksumsFile = "SHA256SUMS";
const manifestFile = "release-manifest.json";

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function shouldSkip(relativePath) {
  const normalized = toPosixPath(relativePath);
  return normalized === checksumsFile || normalized === manifestFile;
}

function collectFiles(dirPath, baseDir = dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(baseDir, absolutePath);

    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath, baseDir));
      continue;
    }

    if (!entry.isFile() || shouldSkip(relativePath)) {
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const content = fs.readFileSync(filePath);
  hash.update(content);
  return hash.digest("hex");
}

function main() {
  if (!fs.existsSync(outputRoot) || !fs.statSync(outputRoot).isDirectory()) {
    throw new Error(`Release artifact directory does not exist: ${outputRoot}`);
  }

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  const files = collectFiles(outputRoot)
    .map((filePath) => {
      const relativePath = toPosixPath(path.relative(outputRoot, filePath));
      const stat = fs.statSync(filePath);
      return {
        path: relativePath,
        size: stat.size,
        sha256: sha256File(filePath),
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const checksums = files
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n");
  fs.writeFileSync(
    path.join(outputRoot, checksumsFile),
    `${checksums}\n`,
    "utf8",
  );

  const manifest = {
    productName: packageJson.productName || packageJson.name,
    packageName: packageJson.name,
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    artifactRoot: path.relative(projectRoot, outputRoot) || ".",
    files,
  };

  fs.writeFileSync(
    path.join(outputRoot, manifestFile),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Generated ${checksumsFile} and ${manifestFile} for ${files.length} files.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
