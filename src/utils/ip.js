// Simple IP utilities supporting IPv4/IPv6 validation and private/special detection
// This file is used both in renderer and main (CommonJS export).

// IPv4 validation based on strict dotted-quad with 0-255 per octet
const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Basic IPv6 validation (supports compressed forms and IPv4-mapped)
function isValidIPv6(ip) {
  if (typeof ip !== "string") return false;
  // Zone index (e.g., %eth0) not supported
  if (ip.includes("%")) return false;

  // IPv4-mapped IPv6 like ::ffff:192.168.0.1
  const lastColon = ip.lastIndexOf(":");
  if (ip.includes(".") && lastColon !== -1) {
    const v4Part = ip.slice(lastColon + 1);
    if (!ipv4Regex.test(v4Part)) return false;
    const v6Part = ip.slice(0, lastColon);
    // Allow ::ffff:0:0/96 forms
    return isValidPureIPv6(v6Part, true);
  }

  return isValidPureIPv6(ip, false);
}

function isValidPureIPv6(ip, allowTrailingEmpty) {
  // Only hex, colon, and optional leading/trailing empty from compression
  if (!/^[:0-9a-fA-F]+$/.test(ip)) return false;

  const parts = ip.split(":");
  const emptyCount = parts.filter((p) => p === "").length;
  // '::' compression allowed at most once
  if (ip.includes("::")) {
    if (ip.indexOf("::") !== ip.lastIndexOf("::")) return false;
  } else {
    if (emptyCount > 0) return false; // no empty segments without '::'
  }

  // With compression, segments must be <= 8; without compression, exactly 8
  const segCount = parts.filter((p) => p !== "").length;
  if (ip.includes("::")) {
    if (segCount > 8) return false;
  } else if (segCount !== 8) {
    return false;
  }

  // Each non-empty hextet 1..4 hex digits
  for (const seg of parts) {
    if (seg === "") continue;
    if (!/^[0-9a-fA-F]{1,4}$/.test(seg)) return false;
  }

  // Special case: all empty ("::") is valid
  if (parts.length === 1 && parts[0] === "") return true;

  // Trailing colon only allowed in compression (e.g., "::")
  if (ip.endsWith(":") && !ip.endsWith("::")) return false;

  return true;
}

function isValidIPv4(ip) {
  return ipv4Regex.test(ip);
}

function isIP(ip) {
  if (isValidIPv4(ip)) return 4;
  if (isValidIPv6(ip)) return 6;
  return 0;
}

// Private/special detection
function isPrivateOrSpecialIPv4(ip) {
  if (!isValidIPv4(ip)) return false;
  const [a, b, c, d] = ip.split(".").map((n) => parseInt(n, 10));
  // Private ranges
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  // Loopback
  if (a === 127) return true; // 127.0.0.0/8
  // Link-local
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  // Multicast
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4
  // Broadcast / unspecified
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function parseFirstHextet(ip) {
  // Normalize start; handle leading '::'
  if (ip.startsWith("::")) return 0;
  const first = ip.split(":")[0];
  if (!first) return 0;
  return parseInt(first, 16);
}

function isPrivateOrSpecialIPv6(ip) {
  if (!isValidIPv6(ip)) return false;

  // IPv4-mapped IPv6: defer to IPv4 rules
  const lastColon = ip.lastIndexOf(":");
  if (ip.includes(".") && lastColon !== -1) {
    const v4Part = ip.slice(lastColon + 1);
    if (isValidIPv4(v4Part)) return isPrivateOrSpecialIPv4(v4Part);
  }

  const hextet = parseFirstHextet(ip);
  // ::1 loopback
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  // Unspecified ::
  if (ip === "::" || ip === "0:0:0:0:0:0:0:0") return true;
  // Unique local fc00::/7 (fc00..fdff)
  if (hextet >= 0xfc00 && hextet <= 0xfdff) return true;
  // Link-local fe80::/10 (fe80..febf)
  if (hextet >= 0xfe80 && hextet <= 0xfebf) return true;
  // Multicast ff00::/8
  if (hextet >= 0xff00 && hextet <= 0xffff) return true;
  // Documentation 2001:db8::/32
  if (hextet === 0x2001 && /^2001:0?db8:/i.test(ip)) return true;
  return false;
}

function isPrivateOrSpecial(ip) {
  const v = isIP(ip);
  if (v === 4) return isPrivateOrSpecialIPv4(ip);
  if (v === 6) return isPrivateOrSpecialIPv6(ip);
  return false;
}

function parseIpType(ip) {
  const v = isIP(ip);
  if (v === 4) return "ipv4";
  if (v === 6) return "ipv6";
  return null;
}

module.exports = {
  isValidIPv4,
  isValidIPv6,
  isIP,
  parseIpType,
  isPrivateOrSpecial,
  isPrivateOrSpecialIPv4,
  isPrivateOrSpecialIPv6,
};

