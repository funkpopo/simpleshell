import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { findNativeHost } = require("./nativeHost");

// Production code resolves the host through this variable as well.
const binary = findNativeHost();
if (binary) process.env.SIMPLESHELL_NATIVE_SERVICES_PATH = binary;
