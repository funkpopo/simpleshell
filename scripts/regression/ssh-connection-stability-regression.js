const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const sshPoolSource = fs.readFileSync(
  path.join(repoRoot, "src/core/connection/ssh-pool.js"),
  "utf8",
);

const performHealthCheckMatch = sshPoolSource.match(
  /async performHealthCheck\(\) \{([\s\S]*?)\n {2}\}/,
);

assert.ok(performHealthCheckMatch, "SSHPool.performHealthCheck must exist");

const performHealthCheckBody = performHealthCheckMatch[1];

const forbiddenIntrusiveProbePatterns = [
  [/_probeActiveConnection/, "active connection probe helper"],
  [/activeHealthProbe/, "active health probe state"],
  [/主动健康探测/, "active probe log path"],
  [/client\.exec\(\s*["']true["']/, "remote exec health probe"],
];

for (const [pattern, label] of forbiddenIntrusiveProbePatterns) {
  assert.equal(
    pattern.test(sshPoolSource),
    false,
    `SSH pool source must not contain ${label}`,
  );
}

assert.match(
  performHealthCheckBody,
  /^\s*return\s+super\.performHealthCheck\(\);\s*$/m,
  "SSHPool.performHealthCheck should only delegate to BaseConnectionPool",
);

console.log("SSH connection stability regression checks passed.");
