import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { ipcRenderer } from "electron";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../src/shared/locales/en-US.json";
import { createUnifiedTheme } from "../../src/renderer/theme/index.js";
import {
  getThemeTokens,
  installThemeVariables,
} from "../../src/shared/themeTokens.js";
import { NotificationProvider } from "../../src/renderer/shared/notifications/NotificationContext.jsx";
import AIChatWindow from "../../src/renderer/features/ai/AIChatWindow.jsx";
import { aiClassName } from "../../src/renderer/features/ai/lib/aiClassName.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const longToken = "service_" + "abcdef0123456789".repeat(24);
const inlineCommand = `ssh ${longToken}`;
const commands = [
  [
    `printf '%s\\n' "中文 & <tag>"`,
    `\tcurl --url https://example.test/${longToken} \\`,
    "  --header 'X-Test: original spacing'",
  ].join("\n"),
  "printf 'unlabelled code block'",
  "printf 'indented code block'",
];
const taggedCommand = `printf '%s\\n' '${longToken}'`;
const responseContent = [
  `<think>检查长路径：${longToken}</think>`,
  `长链接：https://example.test/${longToken}`,
  `行内命令：[\`${inlineCommand}\`](https://example.test/manual)`,
  "```bash\n" + commands[0] + "\n```",
  "```\n" + commands[1] + "\n```",
  "    " + commands[2],
  [
    "| " + Array(8).fill("Column with a long heading").join(" | ") + " |",
    "| " + Array(8).fill("---").join(" | ") + " |",
    "| " + Array(8).fill(longToken).join(" | ") + " |",
  ].join("\n"),
  `<cmd risk="safe">${taggedCommand}</cmd>`,
].join("\n\n");
const api = {
  id: "layout-fixture",
  apiUrl: "https://example.test/v1/chat/completions",
  hasApiKey: true,
  model: "fixture",
  streamEnabled: false,
};
const streamHandlers = {};
let clipboardContent = "";
let failCopy = false;
let openedLinks = 0;
window.clipboardAPI = {
  writeText: async (content) => {
    if (failCopy) throw new Error("Clipboard unavailable in fixture");
    clipboardContent = content;
    return true;
  },
};
window.terminalAPI = {
  loadAISettings: async () => ({ configs: [api], current: api }),
  saveAISettings: async () => true,
  openExternal: async () => {
    openedLinks++;
  },
  loadMemory: async () => "",
  onAIStreamChunk: (callback) => {
    streamHandlers.chunk = callback;
    return () => delete streamHandlers.chunk;
  },
  onAIStreamEnd: (callback) => {
    streamHandlers.end = callback;
    return () => delete streamHandlers.end;
  },
  onAIStreamError: () => () => {},
  sendAPIRequest: async (request, stream) => {
    if (!stream) return { content: responseContent };
    const split = responseContent.indexOf(commands[0]) + 50;
    streamHandlers.chunk(null, {
      sessionId: request.sessionId,
      chunk: responseContent.slice(0, split),
    });
    await delay(50);
    streamHandlers.chunk(null, {
      sessionId: request.sessionId,
      chunk: responseContent.slice(split),
    });
    streamHandlers.end(null, { sessionId: request.sessionId });
    return { success: true };
  },
};
window.addEventListener("error", (event) =>
  ipcRenderer.send("theme-result", {
    success: false,
    error: event.error?.stack || event.message,
  }),
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const selector = (name) => "." + CSS.escape(aiClassName(name));
async function waitFor(check, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(message);
}
async function checkMessageLayout(paper) {
  const messages = paper.querySelector(selector("ai-chat-messages"));
  assert(
    messages.scrollWidth <= messages.clientWidth + 1,
    `Messages overflow at width ${paper.clientWidth}: ${messages.scrollWidth} > ${messages.clientWidth}`,
  );
  const bounds = messages.getBoundingClientRect();
  for (const element of paper.querySelectorAll(
    ["ai-message-bubble", "ai-code-block", "ai-markdown-table"]
      .map(selector)
      .join(","),
  )) {
    const rect = element.getBoundingClientRect();
    assert(
      rect.left >= bounds.left && rect.right <= bounds.right,
      "Message content must fit inside the visible conversation",
    );
  }
  const firstBlock = paper.querySelector(selector("ai-code-block"));
  const codeScroller = [
    firstBlock.querySelector("pre"),
    firstBlock.querySelector("code"),
  ].find((element) => element.scrollWidth > element.clientWidth);
  assert(codeScroller, "Long command must have its own horizontal scroll area");
  codeScroller.scrollLeft = codeScroller.scrollWidth;
  assert(codeScroller.scrollLeft > 0, "Long command must remain scrollable");
  const copyBounds = firstBlock.querySelector("button").getBoundingClientRect();
  assert(
    copyBounds.left >= bounds.left && copyBounds.right <= bounds.right,
    "Copy control must remain visible when the command is scrolled",
  );
  const table = paper.querySelector(selector("ai-markdown-table"));
  table.scrollLeft = table.scrollWidth;
  assert(table.scrollLeft > 0, "Wide table must remain scrollable");
}
async function exerciseMessages(paper) {
  paper.querySelector('button[aria-label="Send Message"]').click();
  await waitFor(
    () =>
      paper.querySelectorAll(selector("ai-code-block")).length === 3 &&
      paper.querySelector(selector("ai-exec-command")) &&
      !paper.querySelector('button[aria-label="Stop Generating"]'),
    "Markdown and tagged commands did not finish rendering",
  );
  paper.querySelector(selector("ai-think-toggle")).click();
  await delay(450);
  const blocks = paper.querySelectorAll(selector("ai-code-block"));
  for (const [index, block] of [...blocks].entries()) {
    assert(
      block.querySelector("code").textContent === commands[index],
      "Code text must preserve original whitespace",
    );
    block.querySelector("button").click();
    await waitFor(
      () => clipboardContent === commands[index],
      "Code copy must exclude Markdown fences and toolbar labels",
    );
    await waitFor(
      () =>
        block.querySelector("button").getAttribute("aria-label") === "Copied",
      "Copy must show success feedback",
    );
  }
  const inline = paper.querySelector(selector("ai-inline-code"));
  inline.querySelector("button").click();
  await waitFor(
    () => clipboardContent === inlineCommand,
    "Inline command must copy without backticks",
  );
  assert(openedLinks === 0, "Copying linked code must not open the link");
  const tagged = paper.querySelector(selector("ai-exec-command"));
  assert(
    tagged.querySelector('button[aria-label="Execute command"]').disabled,
    "Fixture must cover copying without an active terminal",
  );
  tagged.querySelector(selector("ai-copy-command")).click();
  await waitFor(
    () => clipboardContent === taggedCommand,
    "Tagged command must remain copyable without a terminal",
  );
  failCopy = true;
  blocks[0].querySelector("button").click();
  await waitFor(
    () =>
      blocks[0].querySelector("button").getAttribute("aria-label") ===
      "Copy failed, please try again",
    "Clipboard errors must show failure feedback",
  );
  failCopy = false;
  blocks[0].querySelector("button").click();
  await waitFor(
    () =>
      blocks[0].querySelector("button").getAttribute("aria-label") === "Copied",
    "Copy must recover after a clipboard error",
  );

  const handle = [...paper.children].find(
    (element) => getComputedStyle(element).cursor === "ew-resize",
  );
  for (const width of [360, 800, 400]) {
    const previousWidth = paper.getBoundingClientRect().width;
    handle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 0 }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: previousWidth - width,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await waitFor(
      () => Math.abs(paper.getBoundingClientRect().width - width) <= 1,
      `AI resize handle must reach width ${width}, got ${paper.getBoundingClientRect().width}; viewport ${window.innerWidth}, CSS width ${getComputedStyle(paper).width}`,
    );
    await checkMessageLayout(paper);
  }
  const narrowWidth = await ipcRenderer.invoke("theme-resize", 380);
  await waitFor(
    () => window.innerWidth === narrowWidth,
    "Narrow viewport did not finish resizing",
  );
  await delay(50);
  await checkMessageLayout(paper);
  const wideWidth = await ipcRenderer.invoke("theme-resize", 1200);
  await waitFor(
    () => window.innerWidth === wideWidth,
    "Wide viewport did not finish resizing",
  );
  await delay(50);
  paper.querySelector(selector("ai-chat-messages")).scrollTop = 0;
}
async function run() {
  await i18next.init({
    lng: "en-US",
    resources: { "en-US": en },
    interpolation: { escapeValue: false },
  });
  installThemeVariables(document);
  const root = createRoot(document.getElementById("root"));
  for (const dark of [false, true]) {
    api.streamEnabled = dark;
    document.body.classList.toggle("dark-theme", dark);
    document.body.classList.toggle("light-theme", !dark);
    document.body.setAttribute(
      "data-mui-color-scheme",
      dark ? "dark" : "light",
    );
    document.body.style.backgroundColor =
      getThemeTokens(dark)["--color-bg-default"];
    root.render(
      <I18nextProvider i18n={i18next}>
        <ThemeProvider theme={createUnifiedTheme(dark)}>
          <CssBaseline />
          <NotificationProvider>
            <AIChatWindow
              key={String(dark)}
              windowState="visible"
              commandEnabled={false}
              presetInput={`检查长命令 ${longToken}`}
              onInputPresetUsed={() => {}}
              onClose={() => {}}
              onMinimize={() => {}}
            />
          </NotificationProvider>
        </ThemeProvider>
      </I18nextProvider>,
    );
    let title;
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(20);
      title = document.querySelector(
        "." + CSS.escape(aiClassName("ai-chat-title")),
      );
      if (title) break;
    }
    assert(title, "AI chat title did not mount");
    await delay(250);
    const tokens = getThemeTokens(dark);
    const paper = document.querySelector(
      "." + CSS.escape(aiClassName("ai-chat-paper")),
    );
    const titleStyle = getComputedStyle(title),
      paperStyle = getComputedStyle(paper);
    const reference = document.createElement("span");
    reference.style.color = tokens["--color-text-primary"];
    document.body.append(reference);
    assert(
      titleStyle.fontSize === "13px",
      "AI title size must override MUI without !important: " +
        JSON.stringify({
          fontSize: titleStyle.fontSize,
          className: title.className,
          rules: [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .filter((rule) =>
              rule.selectorText?.includes(aiClassName("ai-chat-title")),
            )
            .map((rule) => rule.cssText),
        }),
    );
    assert(
      titleStyle.color === getComputedStyle(reference).color,
      "AI text must use the active theme token",
    );
    reference.style.backgroundColor = tokens["--color-bg-elevated"];
    assert(
      paperStyle.backgroundColor ===
        getComputedStyle(reference).backgroundColor,
      "AI paper must use the active elevated surface token",
    );
    assert(
      paperStyle.display === "flex" && paperStyle.overflow === "visible",
      "AI paper must retain its layout and resize handles",
    );
    reference.remove();
    await exerciseMessages(paper);
    await ipcRenderer.invoke("theme-capture", dark ? "dark" : "light");
  }
  root.unmount();
  ipcRenderer.send("theme-result", { success: true });
}
run().catch((error) =>
  ipcRenderer.send("theme-result", { success: false, error: error.stack }),
);
