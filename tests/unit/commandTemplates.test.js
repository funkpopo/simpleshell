// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import ShortcutCommands from "../../src/renderer/features/terminal/ShortcutCommands.jsx";
import {
  buildSessionTemplateContext,
  collectAllCommandTags,
  formatTagsInput,
  normalizeCommandTags,
  parseCommandTemplate,
  prepareCommandExecution,
  resolveCommandTemplate,
} from "../../src/renderer/features/terminal/model/commandTemplates.js";
import {
  clearWorkingDirectorySession,
  setTerminalWorkingDirectory,
} from "../../src/renderer/shared/state/workingDirectoryStore.js";

const { translate, notification } = vi.hoisted(() => ({
  translate: (key, params) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  notification: {
    showNotification: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
}));

vi.mock(
  "../../src/renderer/shared/notifications/NotificationContext.jsx",
  () => ({
    useNotification: () => notification,
  }),
);

describe("commandTemplates pure utilities", () => {
  it("parses {{var}} and {{var=default}} tokens, deduplicates repeats, and classifies built-ins", () => {
    const parsed = parseCommandTemplate(
      "ssh -p {{port=22}} {{user}}@{{host}} 'systemctl restart {{service}} && systemctl status {{service}} && tail -n {{lines=100}} {{flag=}}'",
    );

    expect(parsed.hasVariables).toBe(true);
    expect(parsed.variables.map((v) => v.name)).toEqual([
      "port",
      "user",
      "host",
      "service",
      "lines",
      "flag",
    ]);
    expect(parsed.builtinVariables.map((v) => v.name)).toEqual([
      "port",
      "user",
      "host",
    ]);
    expect(parsed.customVariables.map((v) => v.name)).toEqual([
      "service",
      "lines",
      "flag",
    ]);
    expect(parsed.variables.find((v) => v.name === "service")).toMatchObject({
      required: true,
      hasDefault: false,
      occurrences: 2,
    });
    expect(parsed.variables.find((v) => v.name === "lines")).toMatchObject({
      required: false,
      hasDefault: true,
      defaultValue: "100",
    });
    expect(parsed.variables.find((v) => v.name === "flag")).toMatchObject({
      required: false,
      hasDefault: true,
      defaultValue: "",
    });
  });

  it("adopts default value when a duplicate occurrence supplies one later", () => {
    const parsed = parseCommandTemplate(
      "echo {{env}} && deploy --env {{env=staging}}",
    );
    expect(parsed.variables).toHaveLength(1);
    expect(parsed.variables[0]).toMatchObject({
      name: "env",
      hasDefault: true,
      defaultValue: "staging",
      required: false,
      occurrences: 2,
    });
  });

  it("extracts session context from activeSession config or formatted sidebar context", () => {
    expect(
      buildSessionTemplateContext({
        activeSession: {
          type: "ssh",
          config: { host: "10.0.0.15", username: "deploy", port: 2222 },
        },
        cwd: "/var/www/app",
      }),
    ).toEqual({
      host: "10.0.0.15",
      user: "deploy",
      port: "2222",
      cwd: "/var/www/app",
    });

    expect(
      buildSessionTemplateContext({
        sessionContext: {
          protocol: "SSH",
          host: "alice@[2001:db8::1]:2200",
        },
        cwd: "/etc/nginx",
      }),
    ).toEqual({
      host: "2001:db8::1",
      user: "alice",
      port: "2200",
      cwd: "/etc/nginx",
    });

    expect(
      buildSessionTemplateContext({
        activeSession: { type: "local", label: "PowerShell" },
        cwd: "/home/dev",
      }),
    ).toEqual({
      host: "",
      user: "",
      port: "",
      cwd: "/home/dev",
    });
  });

  it("substitutes built-in context, applies defaults, prevents double-expansion, and reports missing required vars", () => {
    const sessionCtx = {
      host: "prod.internal",
      user: "ops",
      port: "2222",
      cwd: "/srv/app",
    };

    const resolved = resolveCommandTemplate(
      "rsync -e 'ssh -p {{port}}' {{cwd}}/dist {{user}}@{{host}}:{{dest}} --tag {{tag=latest}}",
      { dest: "/opt/{{host}}" },
      sessionCtx,
    );
    expect(resolved.valid).toBe(true);
    expect(resolved.missingVariables).toEqual([]);
    // Single-pass replacement must not re-expand `{{host}}` inside `dest` value.
    expect(resolved.resolved).toBe(
      "rsync -e 'ssh -p 2222' /srv/app/dist ops@prod.internal:/opt/{{host}} --tag latest",
    );

    const invalid = resolveCommandTemplate(
      "kubectl -n {{ns}} logs {{pod}} --tail={{lines=50}}",
      { ns: "   ", pod: "" },
      sessionCtx,
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.missingVariables).toEqual(["ns", "pod"]);
  });

  it("distinguishes immediate execution vs interactive prompt via prepareCommandExecution", () => {
    const sessionCtx = {
      host: "web-01",
      user: "root",
      port: "22",
      cwd: "/var/log",
    };

    const staticPrep = prepareCommandExecution("df -h", sessionCtx);
    expect(staticPrep.needsPrompt).toBe(false);
    expect(staticPrep.preview.resolved).toBe("df -h");

    const builtinReady = prepareCommandExecution(
      "ls -la {{cwd}} && echo {{host}}",
      sessionCtx,
    );
    expect(builtinReady.needsPrompt).toBe(false);
    expect(builtinReady.preview.resolved).toBe(
      "ls -la /var/log && echo web-01",
    );

    const builtinMissing = prepareCommandExecution("cd {{cwd}}", {
      host: "web-01",
      user: "root",
      port: "22",
      cwd: "",
    });
    expect(builtinMissing.needsPrompt).toBe(true);
    expect(builtinMissing.promptVariables.map((v) => v.name)).toEqual(["cwd"]);

    const customPrep = prepareCommandExecution(
      "docker logs {{container}} --tail {{lines=200}}",
      sessionCtx,
    );
    expect(customPrep.needsPrompt).toBe(true);
    expect(customPrep.promptVariables.map((v) => v.name)).toEqual([
      "container",
      "lines",
    ]);
    expect(customPrep.initialValues.lines).toBe("200");
  });

  it("normalizes, formats, and collects unique command tags", () => {
    expect(
      normalizeCommandTags(" docker, Logs, docker , ,PROD, logs "),
    ).toEqual(["docker", "Logs", "PROD"]);
    expect(formatTagsInput(["k8s", "K8S", "ops"])).toBe("k8s, ops");
    expect(
      collectAllCommandTags([
        { tags: ["systemd", "ops"] },
        { tags: ["OPS", "docker"] },
      ]),
    ).toEqual(["docker", "ops", "systemd"]);
  });
});

describe("ShortcutCommands parameterized & tag UX", () => {
  let root = null;
  let host = null;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    host?.remove();
    root = null;
    host = null;
    document.body.innerHTML = "";
    delete window.terminalAPI;
    clearWorkingDirectorySession("sess-1");
    vi.clearAllMocks();
  });

  const renderPanel = async (props = {}) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(ShortcutCommands, {
          open: true,
          onClose: vi.fn(),
          onSendCommand: vi.fn(() => ({ success: true })),
          ...props,
        }),
      );
    });
    await act(async () => {});
    return host;
  };

  it("executes static and built-in-only commands immediately and prompts for custom vars with Run/Insert mode", async () => {
    setTerminalWorkingDirectory("sess-1", "/srv/api");
    const onSendCommand = vi.fn(() => ({ success: true }));
    window.terminalAPI = {
      getShortcutCommands: vi.fn(async () => ({
        success: true,
        data: {
          commands: [
            { id: "c1", name: "Disk", command: "df -h", tags: ["system"] },
            {
              id: "c2",
              name: "Show CWD",
              command: "ls -la {{cwd}} # {{host}}",
              tags: ["files"],
            },
            {
              id: "c3",
              name: "Restart Service",
              command: "systemctl restart {{service}} -n {{lines=25}}",
              tags: ["systemd"],
            },
          ],
          categories: [],
        },
      })),
      saveShortcutCommands: vi.fn(async () => ({ success: true })),
    };

    const container = await renderPanel({
      sessionKey: "sess-1",
      activeSession: {
        type: "ssh",
        config: { host: "api-01", username: "root", port: 22 },
      },
      onSendCommand,
    });

    // Tag filter pills filter down to matching commands
    const systemdChip = [...container.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent === "systemd",
    );
    expect(systemdChip).toBeTruthy();
    await act(async () => {
      systemdChip.focus();
      systemdChip.click();
    });
    expect(container.textContent).toContain("Restart Service");
    expect(container.textContent).not.toContain("Disk");

    // Reset filter to All
    const allChip = [...container.querySelectorAll('[role="button"]')].find(
      (el) => el.textContent === "shortcutCommands.tagsAll",
    );
    await act(async () => {
      allChip.focus();
      allChip.click();
    });
    expect(container.textContent).toContain("Disk");
    expect(container.textContent).toContain("Show CWD");

    // Built-in {{cwd}} + {{host}} command runs in 1 click
    const sendButtons = container.querySelectorAll(
      'button[aria-label="shortcutCommands.sendAndExecute"]',
    );
    await act(async () => {
      sendButtons[1].focus();
      sendButtons[1].click();
    });
    expect(onSendCommand).toHaveBeenCalledWith("ls -la /srv/api # api-01", {
      execute: true,
    });

    // Custom parameterized command clicked on row opens prompt in Insert mode
    onSendCommand.mockClear();
    const restartRow = [
      ...container.querySelectorAll('[data-shortcut-menu-type="command"]'),
    ].find((el) => el.textContent.includes("Restart Service"));
    await act(async () => {
      restartRow.focus();
      restartRow.click();
    });

    const serviceInput = [...document.querySelectorAll("input")].find(
      (input) => {
        const label = input
          .closest(".MuiFormControl-root")
          ?.querySelector("label");
        return label?.textContent?.includes("service");
      },
    );
    expect(serviceInput).toBeTruthy();

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(serviceInput, "nginx");
      serviceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(
      "systemctl restart nginx -n 25",
    );

    const confirmInsertBtn = [...document.querySelectorAll("button")].find(
      (btn) => btn.textContent === "shortcutCommands.templateConfirmInsert",
    );
    expect(confirmInsertBtn).toBeTruthy();
    await act(async () => {
      confirmInsertBtn.focus();
      confirmInsertBtn.click();
    });
    expect(onSendCommand).toHaveBeenCalledWith(
      "systemctl restart nginx -n 25",
      { execute: false },
    );

    // Reopen via Send icon -> defaults to Run (Enter) mode
    onSendCommand.mockClear();
    await act(async () => {
      sendButtons[2].focus();
      sendButtons[2].click();
    });
    const serviceInput2 = [...document.querySelectorAll("input")].find(
      (input) =>
        input
          .closest(".MuiFormControl-root")
          ?.querySelector("label")
          ?.textContent?.includes("service"),
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(serviceInput2, "redis");
      serviceInput2.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmRunBtn = [...document.querySelectorAll("button")].find(
      (btn) => btn.textContent === "shortcutCommands.templateConfirmRun",
    );
    expect(confirmRunBtn).toBeTruthy();
    await act(async () => {
      confirmRunBtn.focus();
      confirmRunBtn.click();
    });
    expect(onSendCommand).toHaveBeenCalledWith(
      "systemctl restart redis -n 25",
      { execute: true },
    );
  });
});
