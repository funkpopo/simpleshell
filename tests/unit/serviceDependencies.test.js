import { describe, it, expect, vi } from "vitest";
import serviceDependencies from "../../src/main/utils/serviceDependencies.js";

describe("service dependency boundaries", () => {
  it("uses the current command and binds it to the state owner", () => {
    const owner = {
      count: 1,
      command(amount) {
        this.count += amount;
        return this.count;
      },
    };
    const dependencies = serviceDependencies(owner, { methods: ["command"] });
    const command = dependencies.command;
    expect(command(2)).toBe(3);
    owner.command = vi.fn(() => 42);
    expect(command(9)).toBe(42);
    expect(owner.command).toHaveBeenCalledExactlyOnceWith(9);
  });
  it("keeps event callback identity while state can be replaced", () => {
    const listener = vi.fn();
    const owner = { listener, sessions: new Map() };
    const dependencies = serviceDependencies(owner, {
      fields: ["listener", "sessions"],
    });
    expect(dependencies.listener).toBe(listener);
    expect(dependencies.listener).toBe(dependencies.listener);
    const replacement = new Map([["ssh-a", {}]]);
    owner.sessions = replacement;
    expect(dependencies.sessions).toBe(replacement);
    dependencies.listener = null;
    expect(owner.listener).toBeNull();
    expect(Object.keys(dependencies)).toEqual(["listener", "sessions"]);
  });
});
