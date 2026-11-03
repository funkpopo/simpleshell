/**
 * Local machine metrics from `simpleshell-core`'s `system-metrics` service
 * (aux core). Rates are measured since the previous request of any caller.
 *
 * @param {"sample" | "processes" | "cpu" | "disks"} op
 */
const { execCoreService } = require("./coreSupervisor");

const REQUEST_TIMEOUT_MS = 15000;

async function querySystemMetrics(op) {
  const { stdout } = await execCoreService("system-metrics", [], {
    input: JSON.stringify({ op }),
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return JSON.parse(stdout);
}

module.exports = { querySystemMetrics };
