const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const sidecarsSourceDirectory = path.join(
  ROOT,
  "native-services",
  "desktop-host",
  "src",
  "sidecars",
);
const aiSidecarSourceDirectory = path.join(sidecarsSourceDirectory, "ai");
const fileManagementSidecarSourceDirectory = path.join(
  sidecarsSourceDirectory,
  "file_management",
);
const executable = path.join(
  ROOT,
  "native-services",
  "desktop-host",
  "target",
  "debug",
  process.platform === "win32"
    ? "simpleshell-native-services.exe"
    : "simpleshell-native-services",
);
assert.ok(
  fs.existsSync(executable),
  "Build the Rust sidecar before running this check",
);
assert.ok(
  fs.existsSync(path.join(sidecarsSourceDirectory, "README.md")),
  "Sidecar root must document the shared layout",
);
assert.ok(
  fs.existsSync(path.join(aiSidecarSourceDirectory, "mod.rs")),
  "AI sidecar implementation must live in src/sidecars/ai/mod.rs",
);
assert.ok(
  fs.existsSync(path.join(aiSidecarSourceDirectory, "README.md")),
  "AI sidecar module must document its boundary and protocol",
);
assert.ok(
  fs.existsSync(path.join(fileManagementSidecarSourceDirectory, "mod.rs")),
  "File-management sidecar implementation must live in src/sidecars/file_management/mod.rs",
);
assert.ok(
  fs.existsSync(path.join(fileManagementSidecarSourceDirectory, "README.md")),
  "File-management sidecar module must document its boundary and protocol",
);
assert.equal(
  fs.existsSync(
    path.join(ROOT, "native-services", "desktop-host", "src", "ai.rs"),
  ),
  false,
  "Legacy flat AI sidecar source must not remain",
);
assert.equal(
  fs.existsSync(
    path.join(ROOT, "native-services", "desktop-host", "src", "ai_sidecar"),
  ),
  false,
  "Legacy AI sidecar directory must not remain",
);

const requests = [];
const readBody = (request) =>
  new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body ? JSON.parse(body) : null));
  });
const writeJson = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
  const body = await readBody(request);
  requests.push({
    url: request.url,
    method: request.method,
    headers: request.headers,
    body,
  });
  if (
    request.url.startsWith("/open/chat/completions") ||
    request.url.endsWith("/open/chat/completions")
  ) {
    if (body.model === "error-model")
      return writeJson(response, 429, { error: { message: "rate limited" } });
    if (!body.stream)
      return writeJson(response, 200, {
        choices: [{ message: { role: "assistant", content: "openai result" } }],
        usage: { total_tokens: 3 },
      });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"open"}}]}\n');
    setTimeout(
      () =>
        response.write(
          'data: {"choices":[{"delta":{"content":" stream"}}]}\n\ndata: [DONE]\n',
        ),
      5,
    );
    return setTimeout(() => response.end(), 10);
  }
  if (request.url.startsWith("/cancel/chat/completions")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n');
    return setTimeout(() => response.end(), 500);
  }
  if (request.url.startsWith("/slow/chat/completions")) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"held"}}]}\n');
    return setTimeout(() => response.end(), 1_000);
  }
  if (request.url.startsWith("/anth/v1/messages")) {
    if (!body.stream)
      return writeJson(response, 200, {
        content: [{ type: "text", text: "anthropic result" }],
        usage: { input_tokens: 2, output_tokens: 4 },
      });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      'data: {"type":"content_block_delta","delta":{"text":"anthropic stream"}}\n\ndata: {"type":"message_stop"}\n',
    );
    return;
  }
  if (
    request.url.startsWith("/gem/v1beta/models") &&
    request.url.includes(":generateContent")
  )
    return writeJson(response, 200, {
      candidates: [{ content: { parts: [{ text: "gemini result" }] } }],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 3,
        totalTokenCount: 5,
      },
    });
  if (
    request.url.startsWith("/gem/v1beta/models") &&
    request.url.includes(":streamGenerateContent")
  ) {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('[{"candidates":[{"content":{"parts":[{"text":"gemini');
    setTimeout(() => response.end(' stream"}]}}]}]\n'), 5);
    return;
  }
  if (request.url.startsWith("/gem/v1beta/models"))
    return writeJson(response, 200, {
      models: [
        {
          name: "models/gemini-test",
          supportedGenerationMethods: ["generateContent"],
        },
        { name: "models/ignored", supportedGenerationMethods: [] },
      ],
    });
  return writeJson(response, 404, {
    error: { message: `unhandled ${request.url}` },
  });
});

function startSidecar() {
  const child = spawn(executable, ["ai-serve"], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const events = [];
  const waiters = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line);
      events.push(event);
      for (const waiter of [...waiters])
        if (waiter(event)) waiters.splice(waiters.indexOf(waiter), 1);
    }
  });
  const waitFor = (predicate, label) =>
    new Promise((resolve, reject) => {
      const existing = events.find(predicate);
      if (existing) return resolve(existing);
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${label}`)),
        5_000,
      );
      waiters.push((event) => {
        if (!predicate(event)) return false;
        clearTimeout(timer);
        resolve(event);
        return true;
      });
    });
  const send = (command) =>
    child.stdin.write(`${JSON.stringify({ schemaVersion: 1, ...command })}\n`);
  return { child, events, send, waitFor };
}

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sidecar = startSidecar();
  await sidecar.waitFor((event) => event.kind === "ready", "ready");
  const sendRequest = (requestId, payload) =>
    sidecar.send({ kind: "request", requestId, payload });
  const resultFor = (id) =>
    sidecar.waitFor(
      (event) => event.kind === "result" && event.requestId === id,
      `result ${id}`,
    );

  sendRequest("open", {
    url: `${base}/open`,
    apiKey: "open-key",
    provider: "openai",
    model: "gpt-test",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ],
  });
  assert.equal(
    (await resultFor("open")).result.choices[0].message.content,
    "openai result",
  );
  sendRequest("anth", {
    url: `${base}/anth`,
    apiKey: "anth-key",
    provider: "anthropic",
    model: "claude-test",
    messages: [
      { role: "system", content: "anth system" },
      { role: "user", content: "hello" },
    ],
  });
  assert.equal(
    (await resultFor("anth")).result.choices[0].message.content,
    "anthropic result",
  );
  sendRequest("gem", {
    url: `${base}/gem`,
    apiKey: "gem-key",
    provider: "gemini",
    model: "gemini-test",
    messages: [
      { role: "system", content: "gem system" },
      { role: "user", content: "hello" },
    ],
  });
  assert.equal(
    (await resultFor("gem")).result.choices[0].message.content,
    "gemini result",
  );
  sendRequest("models", {
    url: `${base}/gem`,
    apiKey: "gem-key",
    provider: "gemini",
    type: "models",
  });
  assert.deepEqual((await resultFor("models")).result.models, ["gemini-test"]);

  for (const [id, provider, url, model, expected] of [
    ["open-stream", "openai", `${base}/open`, "gpt-test", "open stream"],
    [
      "anth-stream",
      "anthropic",
      `${base}/anth`,
      "claude-test",
      "anthropic stream",
    ],
    ["gem-stream", "gemini", `${base}/gem`, "gemini-test", "gemini stream"],
  ]) {
    sendRequest(id, {
      url,
      apiKey: "stream-key",
      provider,
      model,
      isStream: true,
      sessionId: id,
      messages: [{ role: "user", content: "stream" }],
    });
    await sidecar.waitFor(
      (event) => event.kind === "streamEnd" && event.requestId === id,
      `${id} end`,
    );
    assert.equal(
      sidecar.events
        .filter(
          (event) => event.kind === "streamChunk" && event.requestId === id,
        )
        .map((event) => event.chunk)
        .join(""),
      expected,
    );
  }
  sendRequest("error", {
    url: `${base}/open`,
    apiKey: "key",
    provider: "openai",
    model: "error-model",
    messages: [{ role: "user", content: "error" }],
  });
  const error = await sidecar.waitFor(
    (event) => event.kind === "error" && event.requestId === "error",
    "429 error",
  );
  assert.equal(error.error.statusCode, 429);
  assert.equal(error.error.message, "rate limited");
  sidecar.send({
    kind: "proxyUpdate",
    requestId: "proxy-on",
    proxy: { type: "http", host: "[IP]", port: server.address().port },
  });
  assert.equal((await resultFor("proxy-on")).result.success, true);
  sidecar.send({ kind: "proxyUpdate", requestId: "proxy-off", proxy: null });
  assert.equal((await resultFor("proxy-off")).result.success, true);
  sendRequest("cancelled", {
    url: `${base}/cancel`,
    apiKey: "key",
    provider: "openai",
    model: "gpt-test",
    isStream: true,
    sessionId: "cancel-session",
    messages: [{ role: "user", content: "cancel" }],
  });
  await sidecar.waitFor(
    (event) => event.kind === "streamChunk" && event.requestId === "cancelled",
    "cancel stream chunk",
  );
  sidecar.send({
    kind: "cancel",
    requestId: "cancel-command",
    sessionId: "cancel-session",
  });
  assert.equal(
    (
      await sidecar.waitFor(
        (event) =>
          event.kind === "streamEnd" && event.requestId === "cancelled",
        "cancelled end",
      )
    ).result.aborted,
    true,
  );
  for (let index = 0; index < 10; index += 1) {
    sendRequest(`parallel-${index}`, {
      url: `${base}/slow`,
      apiKey: "key",
      provider: "openai",
      model: "gpt-test",
      isStream: true,
      sessionId: `parallel-session-${index}`,
      messages: [{ role: "user", content: "parallel" }],
    });
  }
  await sidecar.waitFor(
    (event) => event.kind === "streamChunk" && event.requestId === "parallel-9",
    "ten active streams",
  );
  sendRequest("parallel-overload", {
    url: `${base}/slow`,
    apiKey: "key",
    provider: "openai",
    model: "gpt-test",
    isStream: true,
    sessionId: "parallel-overload-session",
    messages: [{ role: "user", content: "overload" }],
  });
  assert.match(
    (
      await sidecar.waitFor(
        (event) =>
          event.kind === "error" && event.requestId === "parallel-overload",
        "stream overload",
      )
    ).error.message,
    /too many active streams/,
  );
  sendRequest("duplicate-session", {
    url: `${base}/slow`,
    apiKey: "key",
    provider: "openai",
    model: "gpt-test",
    isStream: true,
    sessionId: "parallel-session-0",
    messages: [{ role: "user", content: "duplicate" }],
  });
  assert.match(
    (
      await sidecar.waitFor(
        (event) =>
          event.kind === "error" && event.requestId === "duplicate-session",
        "duplicate stream session",
      )
    ).error.message,
    /too many active streams|session already has an active request/,
  );
  for (let index = 0; index < 10; index += 1)
    sidecar.send({
      kind: "cancel",
      requestId: `cancel-parallel-${index}`,
      sessionId: `parallel-session-${index}`,
    });
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      sidecar.waitFor(
        (event) =>
          event.kind === "streamEnd" && event.requestId === `parallel-${index}`,
        `parallel ${index} cancelled`,
      ),
    ),
  );
  assert.ok(
    requests.some(
      (request) =>
        request.url.startsWith("/open/chat/completions") &&
        request.headers.authorization === "Bearer open-key",
    ),
  );
  const anthRequest = requests.find(
    (request) =>
      request.url.startsWith("/anth/v1/messages") && !request.body.stream,
  );
  assert.equal(anthRequest.headers["x-api-key"], "anth-key");
  assert.equal(anthRequest.body.system, "anth system");
  assert.equal(anthRequest.body.messages[0].role, "user");
  sidecar.child.stdin.end();
  await new Promise((resolve, reject) =>
    sidecar.child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`sidecar exit ${code}`)),
    ),
  );
  await new Promise((resolve) => server.close(resolve));
  console.log("PASS check-ai-sidecar");
}

run().catch((error) => {
  server.close();
  process.nextTick(() => {
    throw error;
  });
});
