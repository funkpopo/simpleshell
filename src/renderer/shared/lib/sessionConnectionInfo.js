export const getSessionConnectionInfo = (session) =>
  session
    ? {
        sessionKey: session.sessionKey,
        host: session.config?.host ?? session.label,
        port: session.config?.port,
        username: session.config?.username,
        type: session.type.toUpperCase(),
      }
    : null;
