import {
  TERMINAL_THEME_PRESETS,
  getTerminalThemePresetLabel,
} from "../../../shared/settings/terminalThemePresets.js";

export { TERMINAL_THEME_PRESETS };

export const COMMAND_PALETTE_MRU_STORAGE_KEY =
  "simpleshell.commandPalette.mru.v1";
export const MAX_COMMAND_PALETTE_MRU = 20;

export const COMMAND_PALETTE_CATEGORIES = [
  "all",
  "tabs",
  "connections",
  "shells",
  "panels",
  "snippets",
  "actions",
];

const IPV4_OR_HOST_RE =
  /^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/;

/**
 * Parses an inline Quick Connect target (`user@host[:port]`, `ssh://...`,
 * `telnet://...`, `[ipv6]:port`, or `host:port`). Returns null if the query
 * does not represent a valid remote target.
 */
export function parseQuickConnectTarget(rawInput) {
  if (typeof rawInput !== "string") return null;
  const trimmed = rawInput.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let protocol = "ssh";
  let rest = trimmed;
  let explicitScheme = false;

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.+)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "ssh" && scheme !== "telnet") {
      return null;
    }
    protocol = scheme;
    rest = schemeMatch[2];
    explicitScheme = true;
  } else if (trimmed.includes("://")) {
    return null;
  }

  // Strip trailing slash if scheme URL had one
  rest = rest.replace(/\/+$/, "");
  if (!rest) return null;

  let username = "";
  const atIndex = rest.lastIndexOf("@");
  if (atIndex >= 0) {
    username = rest.slice(0, atIndex).trim();
    rest = rest.slice(atIndex + 1).trim();
    if (!username || !rest) return null;
  }

  let host = rest;
  let port = protocol === "telnet" ? 23 : 22;
  let hasPort = false;

  if (rest.startsWith("[")) {
    const closeBracket = rest.indexOf("]");
    if (closeBracket <= 1) return null;
    host = rest.slice(1, closeBracket);
    const trailing = rest.slice(closeBracket + 1);
    if (trailing) {
      if (!trailing.startsWith(":")) return null;
      const parsedPort = Number(trailing.slice(1));
      if (
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        return null;
      }
      port = parsedPort;
      hasPort = true;
    }
    if (!/^[0-9a-fA-F:]+$/.test(host) || !host.includes(":")) {
      return null;
    }
  } else {
    const colonCount = (rest.match(/:/g) || []).length;
    if (colonCount > 1) return null;
    if (colonCount === 1) {
      const colonIdx = rest.indexOf(":");
      host = rest.slice(0, colonIdx);
      const portStr = rest.slice(colonIdx + 1);
      if (!/^\d+$/.test(portStr)) return null;
      const parsedPort = Number(portStr);
      if (
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        return null;
      }
      port = parsedPort;
      hasPort = true;
    }
    if (!host || !IPV4_OR_HOST_RE.test(host)) {
      return null;
    }
  }

  // Require at least one connection indicator (scheme, username@, or explicit :port)
  // so regular palette action words like "settings" do not show Quick Connect.
  if (!explicitScheme && !username && !hasPort) {
    return null;
  }

  const hostDisplay = host.includes(":") ? `[${host}]` : host;
  const label = `${username ? `${username}@` : ""}${hostDisplay}:${port}`;
  return {
    raw: trimmed,
    protocol,
    username,
    host,
    port,
    label,
  };
}

/**
 * Computes a deterministic fuzzy match score (>0 on match, -1 on mismatch).
 */
export function fuzzyScoreText(query, target) {
  if (!query) return 0;
  if (!target) return -1;

  const q = String(query).toLowerCase();
  const text = String(target).toLowerCase();

  if (text === q) return 1000;
  if (text.startsWith(q)) return 820 - Math.min(100, text.length - q.length);

  const subIndex = text.indexOf(q);
  if (subIndex >= 0) {
    const prev = text[subIndex - 1];
    const boundary = subIndex === 0 || /[\s/_:.-]/.test(prev) ? 140 : 0;
    return 540 + boundary - Math.min(120, subIndex * 2);
  }

  // Fuzzy subsequence matching
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ti = 0; ti < text.length && qi < q.length; ti += 1) {
    if (text[ti] === q[qi]) {
      consecutive += 1;
      const isBoundary = ti === 0 || /[\s/_:.-]/.test(text[ti - 1]);
      score += 18 + consecutive * 12 + (isBoundary ? 24 : 0);
      qi += 1;
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) {
    return -1;
  }
  return Math.max(10, score - Math.min(80, text.length - q.length));
}

export function scoreCommandItem(query, item) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return 0;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const fields = [
    { text: item.title || "", weight: 1.0 },
    { text: item.subtitle || "", weight: 0.72 },
    {
      text: Array.isArray(item.keywords)
        ? item.keywords.join(" ")
        : item.keywords || "",
      weight: 0.68,
    },
    { text: item.categoryLabel || item.category || "", weight: 0.5 },
  ];

  let totalScore = 0;
  for (const token of tokens) {
    let bestTokenScore = -1;
    for (const field of fields) {
      const raw = fuzzyScoreText(token, field.text);
      if (raw >= 0) {
        bestTokenScore = Math.max(bestTokenScore, raw * field.weight);
      }
    }
    if (bestTokenScore < 0) {
      return -1;
    }
    totalScore += bestTokenScore;
  }

  return Math.round(totalScore / tokens.length);
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadPaletteMru(storage = null) {
  const target = resolveStorage(storage);
  if (!target?.getItem) return [];
  try {
    const raw = target.getItem(COMMAND_PALETTE_MRU_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === "string" && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function recordPaletteMru(
  itemId,
  storage = null,
  maxItems = MAX_COMMAND_PALETTE_MRU,
) {
  if (!itemId || typeof itemId !== "string") return [];
  const current = loadPaletteMru(storage);
  const next = [itemId, ...current.filter((id) => id !== itemId)].slice(
    0,
    maxItems,
  );
  const target = resolveStorage(storage);
  try {
    target?.setItem?.(COMMAND_PALETTE_MRU_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

function flattenSavedConnections(items, parentPath = [], out = []) {
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (!item) continue;
    if (item.type === "connection") {
      out.push({
        connection: item,
        groupPath: parentPath.join(" / "),
      });
    } else if (item.type === "group" && Array.isArray(item.items)) {
      const nextPath = item.name ? [...parentPath, item.name] : parentPath;
      flattenSavedConnections(item.items, nextPath, out);
    }
  }
  return out;
}

const identityT = (key) => key;

/**
 * Builds the complete list of Command Palette actions from current app state.
 */
export function buildCommandPaletteItems({
  t = identityT,
  tabs = [],
  panes = {},
  splitLayouts = {},
  connections = [],
  localTerminals = [],
  shortcutCommands = [],
  activeSession = null,
  broadcastBarOpen = false,
  darkMode = true,
  canMonitorCurrentSession = false,
  isSshConnected = false,
  closedTabsCount = 0,
} = {}) {
  const items = [];
  const activeTab = activeSession?.parentTabId || null;
  const activeLayout = activeTab ? splitLayouts?.[activeTab] : null;
  const activePaneCount = activeLayout?.panes?.length || 1;
  const sessionTabs = Array.isArray(tabs)
    ? tabs.filter((tab) => tab && tab.id !== "welcome")
    : [];

  // 1. Open Tabs & Split Panes
  sessionTabs.forEach((tab, idx) => {
    const layout = splitLayouts?.[tab.id];
    const tabLabel = tab.customTitle || tab.label || tab.id;
    items.push({
      id: `tab:${tab.id}`,
      category: "tabs",
      categoryLabel: t("commandPalette.categories.tabs"),
      title: tabLabel,
      subtitle:
        layout?.panes?.length > 1
          ? `${tab.type?.toUpperCase() || "SESSION"} · ${layout.panes.length} panes`
          : `${tab.type?.toUpperCase() || "SESSION"}`,
      keywords: [tab.type || "", tab.id, "tab", "switch"],
      shortcut: idx < 8 ? `Ctrl+${idx + 2}` : undefined,
      priority: 80,
      payload: { kind: "focusTab", tabId: tab.id },
    });

    if (layout?.panes?.length > 1) {
      layout.panes.forEach((paneId, paneIndex) => {
        const paneInfo = panes?.[paneId];
        const paneLabel =
          paneId === tab.id
            ? tabLabel
            : paneInfo?.label || paneInfo?.tab?.label || paneId;
        items.push({
          id: `pane:${tab.id}:${paneId}`,
          category: "tabs",
          categoryLabel: t("commandPalette.categories.tabs"),
          title: `${tabLabel} › ${paneLabel}`,
          subtitle: t("commandPalette.paneSubtitle", {
            n: paneIndex + 1,
          }),
          keywords: ["pane", "focus", "split", paneLabel, tabLabel],
          priority: 75,
          payload: { kind: "focusPane", tabId: tab.id, paneId },
        });
      });
    }
  });

  // 2. Saved Connections (with group path + tags)
  for (const { connection, groupPath } of flattenSavedConnections(
    connections,
  )) {
    const protocol = (connection.protocol || "ssh").toUpperCase();
    const endpoint = connection.host
      ? `${connection.username ? `${connection.username}@` : ""}${connection.host}${connection.port ? `:${connection.port}` : ""}`
      : "";
    const tagList = Array.isArray(connection.tags) ? connection.tags : [];
    const subtitleParts = [groupPath, endpoint, protocol].filter(Boolean);
    if (tagList.length > 0) {
      subtitleParts.push(tagList.map((tag) => `#${tag}`).join(" "));
    }
    items.push({
      id: `conn:${connection.id}`,
      category: "connections",
      categoryLabel: t("commandPalette.categories.connections"),
      title: connection.name || endpoint || connection.id,
      subtitle: subtitleParts.join(" · "),
      keywords: [
        connection.host || "",
        connection.username || "",
        protocol,
        groupPath,
        ...tagList,
        ...(connection.pinned
          ? [
              "pinned",
              "favorite",
              "star",
              t("commandPalette.pinnedBadge"),
              t("connections.pinned.filterLabel"),
            ]
          : []),
      ],
      badge: connection.pinned ? t("commandPalette.pinnedBadge") : undefined,
      priority: connection.pinned ? 92 : 70,
      payload: { kind: "openConnection", connection },
    });
  }

  // 3. Local Shells
  items.push({
    id: "shell:default",
    category: "shells",
    categoryLabel: t("commandPalette.categories.shells"),
    title: t("commandPalette.items.newLocalTerminal"),
    subtitle: t("sidebar.localTerminal"),
    keywords: ["local", "shell", "terminal", "bash", "powershell", "cmd"],
    priority: 68,
    payload: {
      kind: "openLocalTerminal",
      terminalConfig: { useDefaultShell: true },
    },
  });

  if (Array.isArray(localTerminals)) {
    localTerminals.forEach((shell) => {
      if (!shell) return;
      const shellKey = shell.id || shell.executable || shell.name;
      items.push({
        id: `shell:${shellKey}`,
        category: "shells",
        categoryLabel: t("commandPalette.categories.shells"),
        title: shell.name || shell.executable || shellKey,
        subtitle: shell.description || shell.executablePath || shell.type || "",
        keywords: [
          "local",
          "shell",
          shell.type || "",
          shell.executable || "",
          shell.distribution || "",
        ],
        priority: 62,
        payload: { kind: "openLocalTerminal", terminalConfig: shell },
      });
    });
  }

  // 4. All 9 Sidebar Panels + Broadcast Bar + AI + Settings
  const panelDefs = [
    {
      id: "panel:connection",
      title: t("sidebar.connections"),
      keywords: ["connections", "hosts", "sidebar"],
      panel: "connection",
    },
    {
      id: "panel:file",
      title: t("sidebar.files"),
      keywords: ["sftp", "files", "explorer", "sidebar"],
      panel: "file",
      disabled: !isSshConnected,
    },
    {
      id: "panel:shortcut",
      title: t("sidebar.shortcutCommands"),
      keywords: ["snippets", "shortcut", "commands", "sidebar"],
      panel: "shortcut",
      disabled: !activeSession,
    },
    {
      id: "panel:history",
      title: t("sidebar.history"),
      keywords: ["history", "commands", "sidebar"],
      panel: "history",
    },
    {
      id: "panel:resource",
      title: t("sidebar.monitor"),
      keywords: ["monitor", "cpu", "memory", "resources", "sidebar"],
      panel: "resource",
      disabled: !canMonitorCurrentSession,
    },
    {
      id: "panel:ipquery",
      title: t("sidebar.ipQuery"),
      keywords: ["ip", "geo", "lookup", "sidebar"],
      panel: "ipquery",
    },
    {
      id: "panel:password",
      title: t("sidebar.securityTool"),
      keywords: ["security", "password", "keygen", "tools", "sidebar"],
      panel: "password",
    },
    {
      id: "panel:forwarding",
      title: t("sidebar.portForwarding"),
      keywords: ["port", "forwarding", "tunnel", "socks", "sidebar"],
      panel: "forwarding",
    },
    {
      id: "panel:localTerminal",
      title: t("sidebar.localTerminal"),
      keywords: ["local", "terminal", "wsl", "powershell", "sidebar"],
      panel: "localTerminal",
    },
    {
      id: "panel:transfer",
      title: t("commandPalette.items.toggleTransfers"),
      keywords: ["transfer", "upload", "download", "sftp"],
      panel: "transfer",
    },
    {
      id: "panel:ai",
      title: t("sidebar.ai"),
      keywords: ["ai", "assistant", "chat"],
      shortcut: "Alt+F1",
      panel: "ai",
    },
    {
      id: "panel:broadcast",
      title: broadcastBarOpen ? t("broadcastBar.hide") : t("broadcastBar.show"),
      keywords: ["broadcast", "multi", "sync", "send", "command"],
      panel: "broadcast",
    },
    {
      id: "panel:settings",
      title: t("settings.title"),
      keywords: ["settings", "preferences", "config"],
      shortcut: "Ctrl+,",
      panel: "settings",
    },
  ];

  panelDefs.forEach((def) => {
    items.push({
      id: def.id,
      category: "panels",
      categoryLabel: t("commandPalette.categories.panels"),
      title: def.title,
      subtitle: t("commandPalette.panelSubtitle"),
      keywords: def.keywords,
      shortcut: def.shortcut,
      disabled: Boolean(def.disabled),
      priority: 55,
      payload: { kind: "togglePanel", panel: def.panel },
    });
  });

  // 5. Shortcut Commands (Snippets)
  if (Array.isArray(shortcutCommands)) {
    shortcutCommands.forEach((cmd) => {
      if (!cmd || !cmd.command) return;
      items.push({
        id: `snippet:${cmd.id || cmd.name}`,
        category: "snippets",
        categoryLabel: t("commandPalette.categories.snippets"),
        title: cmd.name || cmd.command,
        subtitle: cmd.command,
        keywords: [
          cmd.name || "",
          cmd.command || "",
          ...(Array.isArray(cmd.tags) ? cmd.tags : []),
          "snippet",
          "shortcut",
        ],
        disabled: !activeSession,
        priority: 50,
        payload: {
          kind: "runSnippet",
          command: cmd.command,
          name: cmd.name || "",
          id: cmd.id || "",
        },
      });
    });
  }

  // 6. Workspace & Terminal Actions
  const hasActiveSessionTab = Boolean(activeTab && activeTab !== "welcome");
  const canSplit = hasActiveSessionTab && activePaneCount < 4;

  const actionDefs = [
    {
      id: "action:splitRight",
      title: t("terminal.pane.splitRight"),
      shortcut: "Ctrl+Shift+E",
      keywords: ["split", "right", "horizontal", "pane"],
      disabled: !canSplit,
      payload: { kind: "splitPane", direction: "right", mode: "duplicate" },
    },
    {
      id: "action:splitBottom",
      title: t("terminal.pane.splitBottom"),
      shortcut: "Ctrl+Shift+H",
      keywords: ["split", "down", "bottom", "vertical", "pane"],
      disabled: !canSplit,
      payload: { kind: "splitPane", direction: "bottom", mode: "duplicate" },
    },
    {
      id: "action:splitLocalRight",
      title: t("commandPalette.items.splitLocalRight"),
      keywords: ["split", "right", "local", "shell", "pane"],
      disabled: !canSplit,
      payload: { kind: "splitPane", direction: "right", mode: "local" },
    },
    {
      id: "action:unsplit",
      title: t("tabMenu.unsplit"),
      keywords: ["unsplit", "restore", "tabs", "pane"],
      disabled: !hasActiveSessionTab || activePaneCount <= 1,
      payload: { kind: "unsplitTab", tabId: activeTab },
    },
    {
      id: "action:duplicateTab",
      title: t("tabs.duplicate"),
      keywords: ["duplicate", "clone", "tab"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "duplicateTab", tabId: activeTab },
    },
    {
      id: "action:renameTab",
      title: t("tabs.rename"),
      keywords: ["rename", "title", "tab"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "renameTab", tabId: activeTab },
    },
    {
      id: "action:closeTab",
      title: t("tabMenu.close"),
      shortcut: "Ctrl+Shift+W",
      keywords: ["close", "pane", "tab"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "closeActivePane" },
    },
    {
      id: "action:closeOtherTabs",
      title: t("tabs.closeOthers"),
      keywords: ["close", "others", "tabs"],
      disabled: !hasActiveSessionTab || sessionTabs.length <= 1,
      payload: { kind: "closeOtherTabs", tabId: activeTab },
    },
    {
      id: "action:reopenClosedTab",
      title: t("tabs.reopenClosed"),
      shortcut: "Ctrl+Shift+T",
      keywords: ["reopen", "closed", "undo", "tab"],
      disabled: closedTabsCount <= 0,
      payload: { kind: "reopenClosedTab" },
    },
    {
      id: "action:exportScrollback",
      title: t("commandPalette.items.exportScrollback"),
      keywords: ["export", "scrollback", "save", "log", "transcript"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "exportScrollback", action: "export" },
    },
    {
      id: "action:copyAllOutput",
      title: t("commandPalette.items.copyAllOutput"),
      keywords: ["copy", "all", "output", "scrollback"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "exportScrollback", action: "copyAll" },
    },
    {
      id: "action:zoomIn",
      title: t("commandPalette.items.zoomIn"),
      shortcut: "Ctrl+=",
      keywords: ["zoom", "in", "font", "size", "increase"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "terminalZoom", action: "in" },
    },
    {
      id: "action:zoomOut",
      title: t("commandPalette.items.zoomOut"),
      shortcut: "Ctrl+-",
      keywords: ["zoom", "out", "font", "size", "decrease"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "terminalZoom", action: "out" },
    },
    {
      id: "action:zoomReset",
      title: t("commandPalette.items.zoomReset"),
      shortcut: "Ctrl+0",
      keywords: ["zoom", "reset", "font", "size", "default"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "terminalZoom", action: "reset" },
    },
    {
      id: "action:selectAll",
      title: t("webTerminal.contextMenu.selectAll"),
      keywords: ["select", "all", "terminal"],
      disabled: !hasActiveSessionTab,
      payload: { kind: "terminalZoom", action: "selectAll" },
    },
    {
      id: "action:toggleDarkMode",
      title: darkMode
        ? t("commandPalette.items.switchToLightMode")
        : t("commandPalette.items.switchToDarkMode"),
      keywords: ["theme", "dark", "light", "mode", "appearance"],
      payload: { kind: "toggleDarkMode" },
    },
  ];

  actionDefs.forEach((def) => {
    items.push({
      id: def.id,
      category: "actions",
      categoryLabel: t("commandPalette.categories.actions"),
      title: def.title,
      subtitle: t("commandPalette.actionSubtitle"),
      keywords: def.keywords,
      shortcut: def.shortcut,
      disabled: Boolean(def.disabled),
      priority: 45,
      payload: def.payload,
    });
  });

  // Terminal Color Scheme Presets (cross-track integration via simpleshell:setTerminalTheme)
  TERMINAL_THEME_PRESETS.forEach((preset) => {
    const label = getTerminalThemePresetLabel(t, preset.id);
    items.push({
      id: `theme:${preset.id}`,
      category: "actions",
      categoryLabel: t("commandPalette.categories.actions"),
      title: `${t("commandPalette.items.terminalThemePrefix")}: ${label}`,
      subtitle: t("commandPalette.themeSubtitle"),
      keywords: [
        "terminal",
        "theme",
        "color",
        "scheme",
        "preset",
        preset.id,
        label,
      ],
      priority: 30,
      payload: { kind: "setTerminalTheme", themeId: preset.id },
    });
  });

  return items;
}

/**
 * Filters and ranks Command Palette items by fuzzy query, category filter, MRU
 * recency, and inline Quick Connect detection.
 */
export function rankCommandPaletteItems(
  items = [],
  { query = "", category = "all", mruIds = [], t = identityT } = {},
) {
  const mruRank = new Map(mruIds.map((id, idx) => [id, idx]));
  const trimmedQuery = String(query || "").trim();

  const filteredByCategory =
    category && category !== "all"
      ? items.filter((item) => item.category === category)
      : items;

  const quickParsed =
    category === "all" || category === "connections"
      ? parseQuickConnectTarget(trimmedQuery)
      : null;

  const results = [];

  if (quickParsed) {
    results.push({
      id: `quick-connect:${quickParsed.label}`,
      category: "connections",
      categoryLabel: t("commandPalette.categories.connections"),
      title: `${t("commandPalette.quickConnectPrefix")}: ${quickParsed.label}`,
      subtitle: `${quickParsed.protocol.toUpperCase()} · ${t("commandPalette.quickConnectHint")}`,
      badge: quickParsed.protocol.toUpperCase(),
      disabled: false,
      _score: 2500,
      payload: { kind: "quickConnect", parsed: quickParsed },
    });
  }

  if (!trimmedQuery) {
    const scored = filteredByCategory.map((item) => {
      const mruIdx = mruRank.has(item.id) ? mruRank.get(item.id) : -1;
      const mruBonus = mruIdx >= 0 ? 10000 - mruIdx * 50 : 0;
      const enabledBonus = item.disabled ? -500 : 0;
      return {
        ...item,
        _score: mruBonus + enabledBonus + (item.priority || 0),
      };
    });
    scored.sort((a, b) => b._score - a._score);
    return [...results, ...scored];
  }

  for (const item of filteredByCategory) {
    const score = scoreCommandItem(trimmedQuery, item);
    if (score < 0) continue;
    const mruIdx = mruRank.has(item.id) ? mruRank.get(item.id) : -1;
    const mruBonus = mruIdx >= 0 ? Math.max(5, 45 - mruIdx * 2) : 0;
    const enabledPenalty = item.disabled ? -200 : 0;
    results.push({
      ...item,
      _score: score + mruBonus + enabledPenalty,
    });
  }

  results.sort((a, b) => b._score - a._score);
  return results;
}
