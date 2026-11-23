export {
  QUICK_CONNECT_PROTOCOLS,
  DEFAULT_PORT_BY_PROTOCOL,
  parseQuickConnectTarget,
  formatQuickConnectLabel,
  buildTransientQuickConnectConnection,
  resolveQuickConnectDetail,
  buildQuickConnectIdentityKey,
  collectSavedConnectionKeys,
} from "../../../../shared/domain/quickConnect.js";
export {
  recordTransientQuickConnect,
  getTransientQuickConnects,
  dismissTransientQuickConnect,
  clearTransientQuickConnects,
  getQuickConnectErrorText,
} from "../../../shared/lib/quickConnectSession.js";
