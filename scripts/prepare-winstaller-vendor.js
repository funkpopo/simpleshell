const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

function log(message) {
  process.stdout.write(`[prepare-winstaller-vendor] ${message}\n`);
}

function getElectronWinstallerRoot() {
  try {
    return path.dirname(require.resolve("electron-winstaller/package.json"));
  } catch (error) {
    throw new Error(
      "electron-winstaller is required to make Windows Squirrel installers",
    );
  }
}

function copyVendorFile(vendorDir, extension) {
  const sourcePath = path.join(vendorDir, `7z-${process.arch}.${extension}`);
  const targetPath = path.join(vendorDir, `7z.${extension}`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `missing ${path.relative(projectRoot, sourcePath)} for host architecture ${process.arch}`,
    );
  }

  fs.copyFileSync(sourcePath, targetPath);
  return path.relative(projectRoot, targetPath);
}

function main() {
  if (process.platform !== "win32") {
    return;
  }

  const winstallerRoot = getElectronWinstallerRoot();
  const vendorDir = path.join(winstallerRoot, "vendor");

  if (!fs.existsSync(vendorDir)) {
    throw new Error(
      `missing electron-winstaller vendor directory: ${path.relative(
        projectRoot,
        vendorDir,
      )}`,
    );
  }

  const exePath = copyVendorFile(vendorDir, "exe");
  const dllPath = copyVendorFile(vendorDir, "dll");
  log(`prepared ${exePath} and ${dllPath}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[prepare-winstaller-vendor] ${error.message || String(error)}\n`,
  );
  process.exit(1);
}
