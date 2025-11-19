// Action Types
export const ActionTypes = {
  // Tab Management
  SET_TABS: "SET_TABS",
  ADD_TAB: "ADD_TAB",
  REMOVE_TAB: "REMOVE_TAB",
  UPDATE_TAB: "UPDATE_TAB",
  SET_CURRENT_TAB: "SET_CURRENT_TAB",

  // Drag & Drop
  SET_DRAGGED_TAB: "SET_DRAGGED_TAB",
  SET_DRAG_OVER_TAB: "SET_DRAG_OVER_TAB",
  SET_DRAG_INSERT_POSITION: "SET_DRAG_INSERT_POSITION",
  RESET_DRAG_STATE: "RESET_DRAG_STATE",
  PUSH_TAB_ORDER_SNAPSHOT: "PUSH_TAB_ORDER_SNAPSHOT",
  UNDO_LAST_TAB_CHANGE: "UNDO_LAST_TAB_CHANGE",

  // Sidebar Management
  SET_CONNECTION_MANAGER_OPEN: "SET_CONNECTION_MANAGER_OPEN",
  SET_RESOURCE_MONITOR_OPEN: "SET_RESOURCE_MONITOR_OPEN",
  SET_FILE_MANAGER_OPEN: "SET_FILE_MANAGER_OPEN",
  SET_IP_ADDRESS_QUERY_OPEN: "SET_IP_ADDRESS_QUERY_OPEN",
  SET_SECURITY_TOOLS_OPEN: "SET_SECURITY_TOOLS_OPEN",
  SET_SHORTCUT_COMMANDS_OPEN: "SET_SHORTCUT_COMMANDS_OPEN",
  SET_COMMAND_HISTORY_OPEN: "SET_COMMAND_HISTORY_OPEN",
  SET_ACTIVE_SIDEBAR_MARGIN: "SET_ACTIVE_SIDEBAR_MARGIN",
  SET_LAST_OPENED_SIDEBAR: "SET_LAST_OPENED_SIDEBAR",

  // Dialog Management
  SET_ABOUT_DIALOG_OPEN: "SET_ABOUT_DIALOG_OPEN",
  SET_SETTINGS_DIALOG_OPEN: "SET_SETTINGS_DIALOG_OPEN",
  SET_TAB_CONTEXT_MENU: "SET_TAB_CONTEXT_MENU",

  // Theme
  SET_DARK_MODE: "SET_DARK_MODE",
  SET_THEME_LOADING: "SET_THEME_LOADING",

  // Terminal
  SET_TERMINAL_INSTANCES: "SET_TERMINAL_INSTANCES",
  UPDATE_TERMINAL_INSTANCE: "UPDATE_TERMINAL_INSTANCE",

  // Connections
  SET_CONNECTIONS: "SET_CONNECTIONS",
  SET_TOP_CONNECTIONS: "SET_TOP_CONNECTIONS",

  // File Manager
  SET_FILE_MANAGER_PATHS: "SET_FILE_MANAGER_PATHS",
  UPDATE_FILE_MANAGER_PATH: "UPDATE_FILE_MANAGER_PATH",

  // Process Cache
  SET_PROCESS_CACHE: "SET_PROCESS_CACHE",
  UPDATE_PROCESS_CACHE: "UPDATE_PROCESS_CACHE",

  // AI Chat
  SET_AI_CHAT_STATUS: "SET_AI_CHAT_STATUS",
  SET_AI_INPUT_PRESET: "SET_AI_INPUT_PRESET",

  // Menu
  SET_ANCHOR_EL: "SET_ANCHOR_EL",
};

// Initial State
export const initialState = {
  // Tab Management
  tabs: [
    {
      id: "welcome",
      label: "Welcome",
      type: "welcome",
    },
  ],
  currentTab: 0,

  // Drag & Drop State
  draggedTabIndex: null,
  dragOverTabIndex: null,
  dragInsertPosition: null,
  tabHistoryStack: [],

  // Sidebar State
  connectionManagerOpen: false,
  resourceMonitorOpen: false,
  fileManagerOpen: false,
  ipAddressQueryOpen: false,
  securityToolsOpen: false,
  shortcutCommandsOpen: false,
  commandHistoryOpen: false,
  activeSidebarMargin: 0,
  lastOpenedSidebar: null,

  // Dialog State
  aboutDialogOpen: false,
  settingsDialogOpen: false,
  tabContextMenu: {
    mouseX: null,
    mouseY: null,
    tabIndex: null,
  },

  // Theme State
  darkMode: true,
  themeLoading: true,

  // Terminal State
  terminalInstances: {},

  // Connection State
  connections: [],
  topConnections: [],

  // File Manager State
  fileManagerPaths: {},

  // Process Cache
  processCache: {},

  // AI Chat State
  aiChatStatus: "closed",
  aiInputPreset: "",

  // Menu State
  anchorEl: null,
};

// Reducer Function
export function appReducer(state = initialState, action) {
  switch (action.type) {
    // Tab Management Actions
    case ActionTypes.SET_TABS:
      return { ...state, tabs: action.payload };

    case ActionTypes.ADD_TAB:
      return { ...state, tabs: [...state.tabs, action.payload] };

    case ActionTypes.REMOVE_TAB:
      const newTabs = state.tabs.filter((_, index) => index !== action.payload);
      return { ...state, tabs: newTabs };

    case ActionTypes.UPDATE_TAB:
      const updatedTabs = [...state.tabs];
      updatedTabs[action.payload.index] = action.payload.tab;
      return { ...state, tabs: updatedTabs };

    case ActionTypes.SET_CURRENT_TAB:
      return { ...state, currentTab: action.payload };

    // Drag & Drop Actions
    case ActionTypes.SET_DRAGGED_TAB:
      return { ...state, draggedTabIndex: action.payload };

    case ActionTypes.SET_DRAG_OVER_TAB:
      return { ...state, dragOverTabIndex: action.payload };

    case ActionTypes.SET_DRAG_INSERT_POSITION:
      return { ...state, dragInsertPosition: action.payload };

    case ActionTypes.RESET_DRAG_STATE:
      return {
        ...state,
        draggedTabIndex: null,
        dragOverTabIndex: null,
        dragInsertPosition: null,
      };

    case ActionTypes.PUSH_TAB_ORDER_SNAPSHOT: {
      const snapshot = action.payload || {
        tabs: state.tabs,
        currentTab: state.currentTab,
      };
      const stack = [snapshot, ...(state.tabHistoryStack || [])].slice(0, 20);
      return { ...state, tabHistoryStack: stack };
    }

    case ActionTypes.UNDO_LAST_TAB_CHANGE: {
      const stack = state.tabHistoryStack || [];
      if (stack.length === 0) return state;
      const [snap, ...rest] = stack;
      return {
        ...state,
        tabs: snap.tabs,
        currentTab: snap.currentTab,
        tabHistoryStack: rest,
      };
    }

    // Sidebar Actions
    case ActionTypes.SET_CONNECTION_MANAGER_OPEN:
      return { ...state, connectionManagerOpen: action.payload };

    case ActionTypes.SET_RESOURCE_MONITOR_OPEN:
      return { ...state, resourceMonitorOpen: action.payload };

    case ActionTypes.SET_FILE_MANAGER_OPEN:
      return { ...state, fileManagerOpen: action.payload };

    case ActionTypes.SET_IP_ADDRESS_QUERY_OPEN:
      return { ...state, ipAddressQueryOpen: action.payload };

    case ActionTypes.SET_SECURITY_TOOLS_OPEN:
      return { ...state, securityToolsOpen: action.payload };

    case ActionTypes.SET_SHORTCUT_COMMANDS_OPEN:
      return { ...state, shortcutCommandsOpen: action.payload };

    case ActionTypes.SET_COMMAND_HISTORY_OPEN:
      return { ...state, commandHistoryOpen: action.payload };

    case ActionTypes.SET_ACTIVE_SIDEBAR_MARGIN:
      return { ...state, activeSidebarMargin: action.payload };

    case ActionTypes.SET_LAST_OPENED_SIDEBAR:
      return { ...state, lastOpenedSidebar: action.payload };

    // Dialog Actions
    case ActionTypes.SET_ABOUT_DIALOG_OPEN:
      return { ...state, aboutDialogOpen: action.payload };

    case ActionTypes.SET_SETTINGS_DIALOG_OPEN:
      return { ...state, settingsDialogOpen: action.payload };

    case ActionTypes.SET_TAB_CONTEXT_MENU:
      return { ...state, tabContextMenu: action.payload };

    // Theme Actions
    case ActionTypes.SET_DARK_MODE:
      return { ...state, darkMode: action.payload };

    case ActionTypes.SET_THEME_LOADING:
      return { ...state, themeLoading: action.payload };

    // Terminal Actions
    case ActionTypes.SET_TERMINAL_INSTANCES:
      return { ...state, terminalInstances: action.payload };

    case ActionTypes.UPDATE_TERMINAL_INSTANCE:
      return {
        ...state,
        terminalInstances: {
          ...state.terminalInstances,
          [action.payload.id]: action.payload.instance,
        },
      };

    // Connection Actions
    case ActionTypes.SET_CONNECTIONS:
      return { ...state, connections: action.payload };

    case ActionTypes.SET_TOP_CONNECTIONS:
      return { ...state, topConnections: action.payload };

    // File Manager Actions
    case ActionTypes.SET_FILE_MANAGER_PATHS:
      return { ...state, fileManagerPaths: action.payload };

    case ActionTypes.UPDATE_FILE_MANAGER_PATH:
      return {
        ...state,
        fileManagerPaths: {
          ...state.fileManagerPaths,
          [action.payload.tabId]: action.payload.path,
        },
      };

    // Process Cache Actions
    case ActionTypes.SET_PROCESS_CACHE:
      return { ...state, processCache: action.payload };

    case ActionTypes.UPDATE_PROCESS_CACHE:
      return {
        ...state,
        processCache: {
          ...state.processCache,
          [action.payload.sessionId]: action.payload.processId,
        },
      };

    // AI Chat Actions
    case ActionTypes.SET_AI_CHAT_STATUS:
      return { ...state, aiChatStatus: action.payload };

    case ActionTypes.SET_AI_INPUT_PRESET:
      return { ...state, aiInputPreset: action.payload };

    // Menu Actions
    case ActionTypes.SET_ANCHOR_EL:
      return { ...state, anchorEl: action.payload };

    default:
      return state;
  }
}

// Action Creators
export const actions = {
  // Tab Actions
  setTabs: (tabs) => ({ type: ActionTypes.SET_TABS, payload: tabs }),
  addTab: (tab) => ({ type: ActionTypes.ADD_TAB, payload: tab }),
  removeTab: (index) => ({ type: ActionTypes.REMOVE_TAB, payload: index }),
  updateTab: (index, tab) => ({
    type: ActionTypes.UPDATE_TAB,
    payload: { index, tab },
  }),
  setCurrentTab: (index) => ({
    type: ActionTypes.SET_CURRENT_TAB,
    payload: index,
  }),

  // Drag Actions
  setDraggedTab: (index) => ({
    type: ActionTypes.SET_DRAGGED_TAB,
    payload: index,
  }),
  setDragOverTab: (index) => ({
    type: ActionTypes.SET_DRAG_OVER_TAB,
    payload: index,
  }),
  setDragInsertPosition: (position) => ({
    type: ActionTypes.SET_DRAG_INSERT_POSITION,
    payload: position,
  }),
  resetDragState: () => ({ type: ActionTypes.RESET_DRAG_STATE }),
  pushTabOrderSnapshot: (snapshot) => ({
    type: ActionTypes.PUSH_TAB_ORDER_SNAPSHOT,
    payload: snapshot,
  }),
  undoLastTabChange: () => ({ type: ActionTypes.UNDO_LAST_TAB_CHANGE }),

  // Sidebar Actions
  setConnectionManagerOpen: (open) => ({
    type: ActionTypes.SET_CONNECTION_MANAGER_OPEN,
    payload: open,
  }),
  setResourceMonitorOpen: (open) => ({
    type: ActionTypes.SET_RESOURCE_MONITOR_OPEN,
    payload: open,
  }),
  setFileManagerOpen: (open) => ({
    type: ActionTypes.SET_FILE_MANAGER_OPEN,
    payload: open,
  }),
  setIpAddressQueryOpen: (open) => ({
    type: ActionTypes.SET_IP_ADDRESS_QUERY_OPEN,
    payload: open,
  }),
  setSecurityToolsOpen: (open) => ({
    type: ActionTypes.SET_SECURITY_TOOLS_OPEN,
    payload: open,
  }),
  setShortcutCommandsOpen: (open) => ({
    type: ActionTypes.SET_SHORTCUT_COMMANDS_OPEN,
    payload: open,
  }),
  setCommandHistoryOpen: (open) => ({
    type: ActionTypes.SET_COMMAND_HISTORY_OPEN,
    payload: open,
  }),
  setActiveSidebarMargin: (margin) => ({
    type: ActionTypes.SET_ACTIVE_SIDEBAR_MARGIN,
    payload: margin,
  }),
  setLastOpenedSidebar: (sidebar) => ({
    type: ActionTypes.SET_LAST_OPENED_SIDEBAR,
    payload: sidebar,
  }),

  // Dialog Actions
  setAboutDialogOpen: (open) => ({
    type: ActionTypes.SET_ABOUT_DIALOG_OPEN,
    payload: open,
  }),
  setSettingsDialogOpen: (open) => ({
    type: ActionTypes.SET_SETTINGS_DIALOG_OPEN,
    payload: open,
  }),
  setTabContextMenu: (menu) => ({
    type: ActionTypes.SET_TAB_CONTEXT_MENU,
    payload: menu,
  }),

  // Theme Actions
  setDarkMode: (darkMode) => ({
    type: ActionTypes.SET_DARK_MODE,
    payload: darkMode,
  }),
  setThemeLoading: (loading) => ({
    type: ActionTypes.SET_THEME_LOADING,
    payload: loading,
  }),

  // Terminal Actions
  setTerminalInstances: (instances) => ({
    type: ActionTypes.SET_TERMINAL_INSTANCES,
    payload: instances,
  }),
  updateTerminalInstance: (id, instance) => ({
    type: ActionTypes.UPDATE_TERMINAL_INSTANCE,
    payload: { id, instance },
  }),

  // Connection Actions
  setConnections: (connections) => ({
    type: ActionTypes.SET_CONNECTIONS,
    payload: connections,
  }),
  setTopConnections: (connections) => ({
    type: ActionTypes.SET_TOP_CONNECTIONS,
    payload: connections,
  }),

  // File Manager Actions
  setFileManagerPaths: (paths) => ({
    type: ActionTypes.SET_FILE_MANAGER_PATHS,
    payload: paths,
  }),
  updateFileManagerPath: (tabId, path) => ({
    type: ActionTypes.UPDATE_FILE_MANAGER_PATH,
    payload: { tabId, path },
  }),

  // Process Cache Actions
  setProcessCache: (cache) => ({
    type: ActionTypes.SET_PROCESS_CACHE,
    payload: cache,
  }),
  updateProcessCache: (sessionId, processId) => ({
    type: ActionTypes.UPDATE_PROCESS_CACHE,
    payload: { sessionId, processId },
  }),

  // AI Chat Actions
  setAiChatStatus: (status) => ({
    type: ActionTypes.SET_AI_CHAT_STATUS,
    payload: status,
  }),
  setAiInputPreset: (preset) => ({
    type: ActionTypes.SET_AI_INPUT_PRESET,
    payload: preset,
  }),

  // Menu Actions
  setAnchorEl: (el) => ({ type: ActionTypes.SET_ANCHOR_EL, payload: el }),
};
