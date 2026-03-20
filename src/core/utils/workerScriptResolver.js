const fs = require("fs");
const path = require("path");

function appendCandidate(candidates, candidatePath) {
  if (!candidatePath) {
    return;
  }

  const resolvedPath = path.resolve(candidatePath);

  if (!candidates.includes(resolvedPath)) {
    candidates.push(resolvedPath);
  }
}

function appendWorkerCandidate(candidates, baseDir, workerBasename) {
  if (!baseDir || !workerBasename) {
    return;
  }

  appendCandidate(candidates, path.join(baseDir, "workers", workerBasename));
}

function appendWebpackMainCandidates(candidates, baseDir, workerBasename) {
  if (!baseDir) {
    return;
  }

  appendWorkerCandidate(
    candidates,
    path.join(baseDir, ".webpack", "main"),
    workerBasename,
  );
  appendWorkerCandidate(
    candidates,
    path.join(baseDir, ".webpack", process.arch, "main"),
    workerBasename,
  );
  appendWorkerCandidate(
    candidates,
    path.join(baseDir, ".webpack", "x64", "main"),
    workerBasename,
  );
}

function resolveWorkerScriptPath(workerBasename, options = {}) {
  const { runtimeDir = null, envVar = null } = options;
  const candidates = [];

  if (envVar && process.env[envVar]) {
    appendCandidate(candidates, process.env[envVar]);
  }

  if (process.resourcesPath) {
    appendWorkerCandidate(
      candidates,
      path.join(process.resourcesPath, "app.asar.unpacked", ".webpack", "main"),
      workerBasename,
    );
    appendWorkerCandidate(
      candidates,
      path.join(process.resourcesPath, "app.asar", ".webpack", "main"),
      workerBasename,
    );
    appendWebpackMainCandidates(candidates, process.resourcesPath, workerBasename);
    appendWorkerCandidate(
      candidates,
      path.join(process.resourcesPath, "app.asar.unpacked"),
      workerBasename,
    );
    appendWorkerCandidate(
      candidates,
      path.join(process.resourcesPath, "app.asar"),
      workerBasename,
    );
    appendWorkerCandidate(candidates, process.resourcesPath, workerBasename);
    appendCandidate(
      candidates,
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "src",
        "workers",
        workerBasename,
      ),
    );
    appendCandidate(
      candidates,
      path.join(process.resourcesPath, "src", "workers", workerBasename),
    );
  }

  if (runtimeDir) {
    appendWorkerCandidate(candidates, runtimeDir, workerBasename);
    appendCandidate(
      candidates,
      path.join(runtimeDir, "..", "..", "workers", workerBasename),
    );
    appendCandidate(
      candidates,
      path.join(runtimeDir, "..", "..", "..", "src", "workers", workerBasename),
    );
  }

  if (process.cwd()) {
    appendWebpackMainCandidates(candidates, process.cwd(), workerBasename);
    appendCandidate(
      candidates,
      path.join(process.cwd(), "src", "workers", workerBasename),
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const error = new Error(
    `Unable to locate ${workerBasename}. Checked: ${candidates.join(", ")}`,
  );
  error.candidates = candidates;
  throw error;
}

module.exports = {
  resolveWorkerScriptPath,
};
