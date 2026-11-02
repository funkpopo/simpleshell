const fs = require("fs");
const path = require("path");

const NATIVE_SERVICES_BASENAME =
  process.platform === "win32" ? "simpleshell-core.exe" : "simpleshell-core";

function getNativeServicesHostPath() {
  const overridePath = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  const platformArchDir = `${process.platform}-${process.arch}`;
  const candidates = [];

  if (overridePath) {
    candidates.push(path.resolve(overridePath));
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, NATIVE_SERVICES_BASENAME));
    candidates.push(
      path.join(
        process.resourcesPath,
        "bin",
        platformArchDir,
        NATIVE_SERVICES_BASENAME,
      ),
    );
  }

  candidates.push(
    path.join(
      process.cwd(),
      "native-services",
      "bin",
      platformArchDir,
      NATIVE_SERVICES_BASENAME,
    ),
  );
  candidates.push(
    path.join(
      process.cwd(),
      "native-services",
      "target",
      "release",
      NATIVE_SERVICES_BASENAME,
    ),
  );

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  NATIVE_SERVICES_BASENAME,
  getNativeServicesHostPath,
};
