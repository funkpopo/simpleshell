// 语义化版本解析与比较（更新检查与安装包版本识别共用）
const VERSION_TOKEN_REGEX = /v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i;

function normalizeVersionInput(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function parseSemanticVersion(value) {
  const normalized = normalizeVersionInput(value);
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1] || "0", 10),
    minor: Number.parseInt(match[2] || "0", 10),
    patch: Number.parseInt(match[3] || "0", 10),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    const leftNumber = Number.parseInt(left, 10);
    const rightNumber = Number.parseInt(right, 10);
    if (leftNumber > rightNumber) return 1;
    if (leftNumber < rightNumber) return -1;
    return 0;
  }

  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;

  return left.localeCompare(right, "en", { sensitivity: "case" });
}

function compareVersions(version1, version2) {
  const parsed1 = parseSemanticVersion(version1);
  const parsed2 = parseSemanticVersion(version2);

  if (!parsed1 || !parsed2) {
    const normalized1 = normalizeVersionInput(version1);
    const normalized2 = normalizeVersionInput(version2);
    return normalized1.localeCompare(normalized2, "en", {
      numeric: true,
      sensitivity: "case",
    });
  }

  for (const key of ["major", "minor", "patch"]) {
    if (parsed1[key] > parsed2[key]) return 1;
    if (parsed1[key] < parsed2[key]) return -1;
  }

  if (parsed1.prerelease.length === 0 && parsed2.prerelease.length > 0) {
    return 1;
  }
  if (parsed1.prerelease.length > 0 && parsed2.prerelease.length === 0) {
    return -1;
  }

  const maxPrereleaseLength = Math.max(
    parsed1.prerelease.length,
    parsed2.prerelease.length,
  );
  for (let i = 0; i < maxPrereleaseLength; i += 1) {
    const left = parsed1.prerelease[i];
    const right = parsed2.prerelease[i];
    if (left === undefined && right !== undefined) return -1;
    if (left !== undefined && right === undefined) return 1;

    const prereleaseResult = comparePrereleaseIdentifiers(left, right);
    if (prereleaseResult > 0) return 1;
    if (prereleaseResult < 0) return -1;
  }

  return 0;
}

/**
 * 从文本中提取语义化版本号
 * @param {string} value
 * @returns {string|null}
 */
function extractVersionFromText(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const match = value.trim().match(VERSION_TOKEN_REGEX);
  return match ? match[1] : null;
}

module.exports = {
  compareVersions,
  extractVersionFromText,
  normalizeVersionInput,
  parseSemanticVersion,
};
