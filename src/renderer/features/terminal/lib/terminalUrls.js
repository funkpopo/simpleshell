// Pure URL detection helpers used by the terminal link provider.

export const IPV4_LIKE_REGEX =
  /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/.*)?$/;

/** Global (stateful) matcher: create one per provider so lastIndex is not shared. */
export const createTerminalUrlRegex = () =>
  /(?:https?:\/\/[^\s"'`<>]+|(?:\b\d{1,3}(?:\.\d{1,3}){3}\b)(?::\d{1,5})?(?:\/[^\s"'`<>]*)?)/g;

export const normalizeExternalUrl = (value) => {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
    return value;
  }
  if (IPV4_LIKE_REGEX.test(value)) {
    return `http://${value}`;
  }
  return value;
};

export const isValidIpv4Like = (value) => {
  if (!IPV4_LIKE_REGEX.test(value)) {
    return false;
  }

  const [hostAndPort] = value.split("/");
  const [host, port] = hostAndPort.split(":");
  const octets = host.split(".");
  if (octets.length !== 4) {
    return false;
  }

  const isValidOctet = octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) {
      return false;
    }
    const numeric = Number(octet);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });

  if (!isValidOctet) {
    return false;
  }

  if (port == null || port === "") {
    return true;
  }

  if (!/^\d{1,5}$/.test(port)) {
    return false;
  }

  const numericPort = Number(port);
  return (
    Number.isInteger(numericPort) && numericPort >= 1 && numericPort <= 65535
  );
};

export const isValidExternalUrl = (originalValue, normalizedValue) => {
  if (IPV4_LIKE_REGEX.test(originalValue)) {
    return isValidIpv4Like(originalValue);
  }

  try {
    const parsed = new URL(normalizedValue);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};
