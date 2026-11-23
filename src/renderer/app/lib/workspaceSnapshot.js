export const WORKSPACE_SNAPSHOT_STORAGE_KEY =
  "simpleshell.workspaceSnapshot.v1";
export const WORKSPACE_SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_TABS = 30;

const SECRET_KEYS = new Set([
  "password",
  "passphrase",
  "privatekey",
  "privatekeycontent",
  "secret",
  "token",
  "apikey",
  "credential",
  "sudopassword",
  "masterpassword",
  "haspassword",
  "haspassphrase",
  "credentialrevision",
]);

const SAFE_PROXY_FIELDS = ["enabled", "type", "host", "port", "username"];

const SAFE_CONNECTION_FIELDS = [
  "id",
  "connectionId",
  "name",
  "host",
  "port",
  "username",
  "protocol",
  "authType",
  "privateKeyPath",
  "agentPath",
  "agentForward",
  "enableCompression",
  "isTransient",
  "serialPort",
  "baudRate",
  "dataBits",
  "stopBits",
  "parity",
  "flowControl",
  "moshServerPath",
  "moshPredict",
  "moshUseWsl",
  "moshWslDistribution",
  "keepaliveInterval",
  "colorTag",
  "pinned",
];

const SAFE_LOCAL_FIELDS = [
  "id",
  "name",
  "type",
  "executable",
  "executablePath",
  "command",
  "systemCommand",
  "args",
  "launchArgs",
  "cwd",
  "distribution",
  "useDefaultShell",
];

function stripSecretFieldsDeep(value) {
  if (Array.isArray(value)) {
    return value.map(stripSecretFieldsDeep);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.has(key.toLowerCase())) {
      continue;
    }
    out[key] = stripSecretFieldsDeep(entry);
  }
  return out;
}

/**
 * Strips all secrets (passwords, passphrases, keys, tokens) and retains only
 * safe reconnection metadata for snapshot or closed-tab persistence.
 */
export function sanitizeSessionConfig(config) {
  if (!config || typeof config !== "object") {
    return null;
  }
  const sanitized = {};
  for (const field of SAFE_CONNECTION_FIELDS) {
    if (config[field] !== undefined) {
      sanitized[field] = stripSecretFieldsDeep(config[field]);
    }
  }
  if (config.proxy && typeof config.proxy === "object") {
    const safeProxy = {};
    for (const field of SAFE_PROXY_FIELDS) {
      if (config.proxy[field] !== undefined) {
        safeProxy[field] = stripSecretFieldsDeep(config.proxy[field]);
      }
    }
    if (Object.keys(safeProxy).length > 0) {
      sanitized.proxy = safeProxy;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function sanitizeLocalConfig(localConfig) {
  if (!localConfig || typeof localConfig !== "object") {
    return null;
  }
  const sanitized = {};
  for (const field of SAFE_LOCAL_FIELDS) {
    if (localConfig[field] !== undefined) {
      sanitized[field] = Array.isArray(localConfig[field])
        ? localConfig[field].map((item) => String(item))
        : stripSecretFieldsDeep(localConfig[field]);
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function findConnectionByIdInTree(items, id) {
  if (!id || !Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.type === "connection" && item.id === id) {
      return item;
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      const found = findConnectionByIdInTree(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

function buildPaneSnapshot(paneId, state, fallbackTab = null) {
  const paneEntry = state.panes?.[paneId];
  const tab = paneEntry?.tab || fallbackTab;
  const type = paneEntry?.type || tab?.type || "ssh";
  const rawConfig =
    state.terminalInstances?.[`${paneId}-config`] ||
    (type === "local" ? tab?.localConfig : tab?.config) ||
    null;

  const connectionId =
    tab?.connectionId ||
    rawConfig?.connectionId ||
    (!rawConfig?.isTransient ? rawConfig?.id : null) ||
    null;

  if (type === "local") {
    return {
      type: "local",
      label: paneEntry?.label || tab?.label || "Local",
      customTitle: tab?.customTitle || undefined,
      originalLabel: tab?.originalLabel || undefined,
      localConfig: sanitizeLocalConfig(rawConfig) || { useDefaultShell: true },
    };
  }

  return {
    type,
    label: paneEntry?.label || tab?.label || "",
    customTitle: tab?.customTitle || undefined,
    originalLabel: tab?.originalLabel || undefined,
    connectionId: connectionId || undefined,
    connectionRef: sanitizeSessionConfig(rawConfig),
  };
}

/**
 * Serializes a single tab (including any split panes) safely without secrets.
 */
export function buildTabSnapshot(tab, state = {}) {
  if (!tab || tab.id === "welcome") {
    return null;
  }
  const layout = state.splitLayouts?.[tab.id];
  const paneIds =
    Array.isArray(layout?.panes) && layout.panes.length > 1
      ? layout.panes
      : [tab.id];
  const rootSnapshot = buildPaneSnapshot(tab.id, state, tab);

  const entry = {
    ...rootSnapshot,
    customTitle: tab.customTitle || rootSnapshot.customTitle || undefined,
    originalLabel: tab.originalLabel || rootSnapshot.originalLabel || undefined,
    label: tab.label || rootSnapshot.label,
  };

  if (paneIds.length > 1) {
    const focusedIndex = Math.max(0, paneIds.indexOf(layout.focusedPaneId));
    entry.splitLayout = {
      direction: layout.direction || "row",
      pairDirection: layout.pairDirection || layout.direction || "row",
      ratios: Array.isArray(layout.ratios) ? [...layout.ratios] : [50, 50],
      focusedPaneIndex: focusedIndex,
      panes: paneIds.map((paneId) =>
        buildPaneSnapshot(paneId, state, paneId === tab.id ? tab : null),
      ),
    };
  }

  return entry;
}

/**
 * Serializes the full renderer workspace state into a secret-free snapshot.
 */
export function createWorkspaceSnapshot(state) {
  const rawTabs = Array.isArray(state?.tabs) ? state.tabs : [];
  const sessionEntries = [];
  let activeTabIndex = 0;

  rawTabs.forEach((tab, index) => {
    if (!tab || tab.id === "welcome") {
      return;
    }
    const serialized = buildTabSnapshot(tab, state);
    if (!serialized) {
      return;
    }
    if (sessionEntries.length < MAX_SNAPSHOT_TABS) {
      if (state.currentTab === index) {
        // 1-based relative to full tabs (welcome is 0)
        activeTabIndex = sessionEntries.length + 1;
      }
      sessionEntries.push(serialized);
    }
  });

  if (state?.currentTab === 0 || sessionEntries.length === 0) {
    activeTabIndex = 0;
  }

  return {
    version: WORKSPACE_SNAPSHOT_VERSION,
    savedAt: Date.now(),
    activeTabIndex,
    tabs: sessionEntries,
  };
}

function resolveSinglePaneConfig(paneSpec, connections) {
  if (!paneSpec || typeof paneSpec !== "object") {
    return null;
  }

  if (paneSpec.type === "local") {
    const localConfig = sanitizeLocalConfig(paneSpec.localConfig) || {
      useDefaultShell: true,
    };
    return {
      type: "local",
      label: paneSpec.label || localConfig.name || "Local",
      customTitle: paneSpec.customTitle,
      originalLabel: paneSpec.originalLabel,
      localConfig,
      config: localConfig,
    };
  }

  const ref = paneSpec.connectionRef;
  const connectionId = paneSpec.connectionId || ref?.connectionId || ref?.id;

  if (connectionId && !ref?.isTransient) {
    const saved = findConnectionByIdInTree(connections, connectionId);
    if (!saved) {
      return null;
    }
    const protocol = saved.protocol || paneSpec.type || "ssh";
    return {
      type: protocol,
      label: paneSpec.label || saved.name || saved.host,
      customTitle: paneSpec.customTitle,
      originalLabel: paneSpec.originalLabel,
      connectionId: saved.id,
      config: {
        ...saved,
        connectionId: saved.id,
      },
    };
  }

  if (ref?.isTransient && ref.host) {
    const cleanRef = sanitizeSessionConfig(ref);
    const protocol = cleanRef.protocol || paneSpec.type || "ssh";
    return {
      type: protocol,
      label: paneSpec.label || cleanRef.name || cleanRef.host,
      customTitle: paneSpec.customTitle,
      originalLabel: paneSpec.originalLabel,
      config: cleanRef,
    };
  }

  return null;
}

/**
 * Rehydrates a persisted workspace snapshot against currently loaded connections.
 * Deleted saved connections are dropped safely, and split layouts degrade cleanly
 * if some panes were dropped.
 */
export function resolveWorkspaceRestorePlan(
  snapshot,
  connections = [],
  { welcomeTab, idPrefix } = {},
) {
  if (
    !snapshot ||
    snapshot.version !== WORKSPACE_SNAPSHOT_VERSION ||
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length === 0
  ) {
    return null;
  }

  const baseId = idPrefix || `restore-${Date.now()}`;
  const baseWelcome = welcomeTab || {
    id: "welcome",
    label: "Welcome",
    type: "welcome",
  };
  const restoredTabs = [baseWelcome];
  const splitLayouts = {};
  const panes = {};
  const terminalInstances = {};
  const sshSessions = [];
  let mappedActiveTab = 0;

  snapshot.tabs.forEach((entry, tabOrder) => {
    const rawPaneSpecs =
      Array.isArray(entry?.splitLayout?.panes) &&
      entry.splitLayout.panes.length > 1
        ? entry.splitLayout.panes
        : [entry];

    const resolvedPanes = rawPaneSpecs
      .map((spec) => resolveSinglePaneConfig(spec, connections))
      .filter(Boolean);

    if (resolvedPanes.length === 0) {
      return;
    }

    const rootSpec = resolvedPanes[0];
    const rootTabId = `${rootSpec.type}-${baseId}-${tabOrder + 1}`;
    const rootTab = {
      id: rootTabId,
      label: entry.customTitle || entry.label || rootSpec.label,
      type: rootSpec.type,
      ...(entry.customTitle ? { customTitle: entry.customTitle } : {}),
      ...(entry.originalLabel ? { originalLabel: entry.originalLabel } : {}),
      ...(rootSpec.connectionId ? { connectionId: rootSpec.connectionId } : {}),
      ...(rootSpec.type === "local"
        ? { localConfig: { ...rootSpec.localConfig, tabId: rootTabId } }
        : {}),
    };

    const nextIndex = restoredTabs.length;
    restoredTabs.push(rootTab);

    if (snapshot.activeTabIndex === tabOrder + 1) {
      mappedActiveTab = nextIndex;
    }

    terminalInstances[rootTabId] = true;
    terminalInstances[`${rootTabId}-config`] = {
      ...rootSpec.config,
      tabId: rootTabId,
    };
    terminalInstances[`${rootTabId}-processId`] = null;

    if (rootSpec.type === "ssh") {
      sshSessions.push({ tabId: rootTabId, config: rootSpec.config });
    }

    if (resolvedPanes.length > 1) {
      const paneIds = [rootTabId];
      resolvedPanes.slice(1).forEach((paneSpec, pIndex) => {
        const paneId = `${rootTabId}::p${pIndex + 2}`;
        paneIds.push(paneId);
        const paneTab = {
          id: paneId,
          label: paneSpec.label,
          type: paneSpec.type,
          ...(paneSpec.connectionId
            ? { connectionId: paneSpec.connectionId }
            : {}),
          ...(paneSpec.type === "local"
            ? { localConfig: { ...paneSpec.localConfig, tabId: paneId } }
            : {}),
        };
        panes[paneId] = {
          id: paneId,
          parentTabId: rootTabId,
          type: paneSpec.type,
          label: paneSpec.label,
          tab: paneTab,
          adoptedFromTab: false,
          createdAt: Date.now(),
        };
        terminalInstances[paneId] = true;
        terminalInstances[`${paneId}-config`] = {
          ...paneSpec.config,
          tabId: paneId,
        };
        terminalInstances[`${paneId}-processId`] = null;
        if (paneSpec.type === "ssh") {
          sshSessions.push({ tabId: paneId, config: paneSpec.config });
        }
      });

      const savedLayout = entry.splitLayout;
      const focusedIdx = Math.min(
        paneIds.length - 1,
        Math.max(0, Number(savedLayout?.focusedPaneIndex) || 0),
      );
      const direction =
        paneIds.length > 2
          ? "grid"
          : savedLayout?.direction === "column"
            ? "column"
            : "row";
      splitLayouts[rootTabId] = {
        direction,
        pairDirection:
          savedLayout?.pairDirection === "column" ? "column" : "row",
        ratios:
          Array.isArray(savedLayout?.ratios) && savedLayout.ratios.length >= 2
            ? [...savedLayout.ratios]
            : [50, 50],
        focusedPaneId: paneIds[focusedIdx],
        panes: paneIds,
      };
    }
  });

  if (restoredTabs.length <= 1) {
    return null;
  }

  if (snapshot.activeTabIndex > 0 && mappedActiveTab === 0) {
    mappedActiveTab = Math.min(
      snapshot.activeTabIndex,
      restoredTabs.length - 1,
    );
  }

  return {
    tabs: restoredTabs,
    currentTab: mappedActiveTab,
    splitLayouts,
    panes,
    terminalInstances,
    sshSessions,
  };
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadWorkspaceSnapshot(storage = null) {
  const target = resolveStorage(storage);
  if (!target?.getItem) return null;
  try {
    const raw = target.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== WORKSPACE_SNAPSHOT_VERSION ||
      !Array.isArray(parsed.tabs)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(snapshot, storage = null) {
  const target = resolveStorage(storage);
  if (!target?.setItem) return false;
  try {
    if (
      !snapshot ||
      !Array.isArray(snapshot.tabs) ||
      snapshot.tabs.length === 0
    ) {
      target.removeItem?.(WORKSPACE_SNAPSHOT_STORAGE_KEY);
      return true;
    }
    target.setItem(WORKSPACE_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspaceSnapshot(storage = null) {
  const target = resolveStorage(storage);
  if (!target?.removeItem) return false;
  try {
    target.removeItem(WORKSPACE_SNAPSHOT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
