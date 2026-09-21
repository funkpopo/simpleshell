import { createContext, useContext, useState } from "react";
import { initialState } from "./appReducer.js";
import { createAppStore } from "./appStore.js";
import { createReconnectStore } from "./reconnectStore.js";
import { shallowEqual } from "./subscriptionStore.js";
import useStoreSelector from "./useStoreSelector.js";

const AppStoreContext = createContext(undefined);
const ReconnectStoreContext = createContext(undefined);
const identity = (value) => value;
const selectTheme = ({ darkMode, themeLoading }) => ({
  darkMode,
  themeLoading,
});

export function AppProvider({ children }) {
  const [store] = useState(() => {
    // Preserve the preload theme so the first frame matches the saved setting.
    const bootDarkMode = globalThis.window?.simpleshellBoot?.darkMode;
    return createAppStore(
      typeof bootDarkMode === "boolean"
        ? { ...initialState, darkMode: bootDarkMode }
        : initialState,
    );
  });
  const [reconnectStore] = useState(createReconnectStore);
  return (
    <AppStoreContext.Provider value={store}>
      <ReconnectStoreContext.Provider value={reconnectStore}>
        {children}
      </ReconnectStoreContext.Provider>
    </AppStoreContext.Provider>
  );
}

export function useAppStore() {
  const store = useContext(AppStoreContext);
  if (!store)
    throw new Error("App store hooks must be used within AppProvider");
  return store;
}

export function useAppDispatch() {
  return useAppStore().dispatch;
}

// Compatibility for consumers that deliberately need the complete snapshot.
// Prefer selectors or a domain hook for renderer subscriptions.
export function useAppState() {
  return useAppSelector(identity);
}

export function useAppSelector(selector, isEqual = Object.is) {
  return useStoreSelector(useAppStore(), selector, isEqual);
}

export function useShellState() {
  return useStoreSelector(useAppStore().shell, identity);
}

export function useDragSelector(selector, isEqual = Object.is) {
  return useStoreSelector(useAppStore().drag, selector, isEqual);
}

export function useTerminalSelector(selector, isEqual = Object.is) {
  return useStoreSelector(useAppStore().terminal, selector, isEqual);
}

export function useReconnectStore() {
  const store = useContext(ReconnectStoreContext);
  if (!store)
    throw new Error("Reconnect hooks must be used within AppProvider");
  return store;
}

export function useReconnectSelector(selector, isEqual = Object.is) {
  return useStoreSelector(useReconnectStore(), selector, isEqual);
}

export function useTheme() {
  return useAppSelector(selectTheme, shallowEqual);
}
