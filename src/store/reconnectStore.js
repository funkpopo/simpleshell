import { createSubscription } from "./subscriptionStore.js";

export function createReconnectStore() {
  let state = {
    connectionStatusByTabId: {},
    reconnectStateByTabId: {},
    reconnectActionTabId: null,
  };
  const store = createSubscription(() => state);
  const setter = (key) => (update) => {
    const value = typeof update === "function" ? update(state[key]) : update;
    if (Object.is(value, state[key])) return;
    state = { ...state, [key]: value };
    store.notify();
  };
  return {
    ...store,
    setConnectionStatusByTabId: setter("connectionStatusByTabId"),
    setReconnectStateByTabId: setter("reconnectStateByTabId"),
    setReconnectActionTabId: setter("reconnectActionTabId"),
  };
}
