import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const executable =
  process.platform === "win32"
    ? "simpleshell-native-services.exe"
    : "simpleshell-native-services";
const candidates = [
  "native-services/desktop-host/target/debug",
  "native-services/desktop-host/target/release",
  `native-services/bin/${process.platform}-${process.arch}`,
];
if (!process.env.SIMPLESHELL_NATIVE_SERVICES_PATH) {
  const binary = candidates
    .map((directory) => path.join(root, directory, executable))
    .find((filename) => fs.existsSync(filename));
  if (binary) process.env.SIMPLESHELL_NATIVE_SERVICES_PATH = binary;
}
