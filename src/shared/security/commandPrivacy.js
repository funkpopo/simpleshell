// @ts-check

// Deliberately omit the whole command: redacted commands can still leak data
// and are unsafe to offer as executable history suggestions.
/**
 * @param {unknown} command
 * @returns {boolean}
 */
function isSensitiveCommand(command) {
  if (typeof command !== "string") return true;
  return (
    /(?:password|passwd|passphrase|passcode|token|secret|api[_-]?key|authorization|credential|private[_-]?key)/i.test(
      command,
    ) ||
    /\b(?:sshpass|chpasswd)\b/i.test(command) ||
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/]*:[^\s/]*@/i.test(command) ||
    /(?:^|\s)(?:-p\S+|--?(?:user|proxy-user)\s+\S*:\S+|-u\s*\S*:\S+)/.test(
      command,
    ) ||
    /\b(?:mysql|mariadb|redis-cli)\b.*(?:^|\s)-[pa](?:\s+|\S)/i.test(command)
  );
}

/**
 * @template {{ command?: unknown }} T
 * @param {readonly T[] | null | undefined} history
 * @returns {T[]}
 */
function filterCommandHistory(history) {
  return Array.isArray(history)
    ? history.filter(
        (item) =>
          item &&
          typeof item.command === "string" &&
          !isSensitiveCommand(item.command),
      )
    : [];
}

module.exports = { isSensitiveCommand, filterCommandHistory };
