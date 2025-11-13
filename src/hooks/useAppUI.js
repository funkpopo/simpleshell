import { useReducer, useTransition } from 'react';

const initialState = {
  sidebars: {
    connectionManager: false,
    resourceMonitor: false,
    fileManager: false,
    ipAddressQuery: false,
    securityTools: false,
    localTerminal: false,
    shortcutCommands: false,
    commandHistory: false,
    lastOpened: null,
  },
  dialogs: {
    settings: false,
    about: false,
  },
  menus: {
    anchorEl: null,
    tabContext: { mouseX: null, mouseY: null, tabIndex: null, tabId: null },
  },
  aiChat: {
    windowState: 'closed',
    inputPreset: '',
  },
  errors: {
    current: null,
    notificationOpen: false,
  },
};

const uiReducer = (state, action) => {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return {
        ...state,
        sidebars: {
          ...state.sidebars,
          [action.sidebar]: action.value ?? !state.sidebars[action.sidebar],
          lastOpened: action.value !== false ? action.sidebar : state.sidebars.lastOpened,
        },
      };

    case 'CLOSE_ALL_SIDEBARS':
      return {
        ...state,
        sidebars: {
          ...initialState.sidebars,
          lastOpened: null,
        },
      };

    case 'TOGGLE_DIALOG':
      return {
        ...state,
        dialogs: {
          ...state.dialogs,
          [action.dialog]: action.value ?? !state.dialogs[action.dialog],
        },
      };

    case 'SET_MENU_ANCHOR':
      return {
        ...state,
        menus: {
          ...state.menus,
          anchorEl: action.value,
        },
      };

    case 'SET_TAB_CONTEXT_MENU':
      return {
        ...state,
        menus: {
          ...state.menus,
          tabContext: action.value,
        },
      };

    case 'SET_AI_CHAT_STATE':
      return {
        ...state,
        aiChat: {
          ...state.aiChat,
          windowState: action.value,
        },
      };

    case 'SET_AI_INPUT_PRESET':
      return {
        ...state,
        aiChat: {
          ...state.aiChat,
          inputPreset: action.value,
        },
      };

    case 'SET_ERROR':
      return {
        ...state,
        errors: {
          current: action.error,
          notificationOpen: true,
        },
      };

    case 'CLOSE_ERROR_NOTIFICATION':
      return {
        ...state,
        errors: {
          ...state.errors,
          notificationOpen: false,
        },
      };

    default:
      return state;
  }
};

export function useAppUI(initial = initialState) {
  const [state, dispatch] = useReducer(uiReducer, initial);
  const [isPending, startTransition] = useTransition();

  const actions = {
    toggleSidebar: (sidebar, value) => {
      startTransition(() => {
        dispatch({ type: 'TOGGLE_SIDEBAR', sidebar, value });
      });
    },
    closeAllSidebars: () => {
      startTransition(() => {
        dispatch({ type: 'CLOSE_ALL_SIDEBARS' });
      });
    },
    toggleDialog: (dialog, value) => {
      dispatch({ type: 'TOGGLE_DIALOG', dialog, value });
    },
    setMenuAnchor: (value) => {
      dispatch({ type: 'SET_MENU_ANCHOR', value });
    },
    setTabContextMenu: (value) => {
      dispatch({ type: 'SET_TAB_CONTEXT_MENU', value });
    },
    setAiChatState: (value) => {
      dispatch({ type: 'SET_AI_CHAT_STATE', value });
    },
    setAiInputPreset: (value) => {
      dispatch({ type: 'SET_AI_INPUT_PRESET', value });
    },
    setError: (error) => {
      dispatch({ type: 'SET_ERROR', error });
    },
    closeErrorNotification: () => {
      dispatch({ type: 'CLOSE_ERROR_NOTIFICATION' });
    },
  };

  return { state, actions, isPending };
}
