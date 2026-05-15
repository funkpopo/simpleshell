const IPC_REQUEST_CHANNELS = Object.freeze({
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggleMaximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_GET_STATE: "window:getState",
});

const IPC_EVENT_CHANNELS = Object.freeze({
  WINDOW_STATE: "window:state",
});

module.exports = {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
};
