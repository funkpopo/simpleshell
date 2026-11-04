// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "../helpers/reactHarness.js";
import useCustomRiskRules from "../../src/renderer/features/ai/hooks/useCustomRiskRules.js";
import { describeRequestError } from "../../src/renderer/features/ai/lib/aiSettingsModel.js";
import enUS from "../../src/shared/locales/en-US.json";

let hook;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    saveCustomRiskRules: vi.fn(async () => true),
  };
});

afterEach(async () => {
  await hook?.unmount();
  hook = null;
  delete window.terminalAPI;
});

async function render() {
  hook = await renderHook(useCustomRiskRules, {
    setError: vi.fn(),
    setSuccess: vi.fn(),
  });
  return hook;
}

async function addRule(pattern) {
  await act(async () => hook.current.setNewRulePattern(pattern));
  await act(async () => hook.current.handleAddRule());
}

describe("useCustomRiskRules", () => {
  it("tracks unsaved changes until they are saved or discarded", async () => {
    await render();
    await act(async () =>
      hook.current.applyStoredRules({ high: ["rm\\s+-rf"] }),
    );
    expect(hook.current.dirty).toBe(false);

    await addRule("shutdown");
    expect(hook.current.dirty).toBe(true);

    await act(async () => hook.current.discardChanges());
    expect(hook.current.dirty).toBe(false);
    expect(hook.current.customRules.high).toEqual(["rm\\s+-rf"]);

    await addRule("reboot");
    await act(async () => hook.current.handleSaveRules());
    expect(window.terminalAPI.saveCustomRiskRules).toHaveBeenCalled();
    expect(hook.current.dirty).toBe(false);
    expect(hook.current.saving).toBe(false);
  });

  it("reports duplicates separately from invalid patterns", async () => {
    await render();
    await addRule("shutdown");
    await addRule("shutdown");
    expect(hook.current.ruleError).toBe(
      enUS.translation.aiSettings.duplicateRule,
    );

    await addRule("(a+)+");
    expect(hook.current.ruleError).toBe(
      enUS.translation.aiSettings.invalidRegex,
    );
  });
});

describe("describeRequestError", () => {
  it("never renders objects as [object Object]", () => {
    expect(describeRequestError({ code: 401 }, "unknown")).toBe('{"code":401}');
    expect(describeRequestError({ message: "bad key" }, "unknown")).toBe(
      "bad key",
    );
    expect(describeRequestError(undefined, "unknown")).toBe("unknown");
  });
});
