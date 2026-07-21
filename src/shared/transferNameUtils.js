// 传输条目显示名工具：主进程与渲染进程共用的纯字符串逻辑（零依赖）

function normalizeTransferName(name) {
  return typeof name === "string" ? name.trim() : "";
}

/**
 * 由条目名列表构建传输显示名。
 * 多条目时优先使用 formatMultipleName({firstName, count}) 回调
 * （渲染进程传 i18n 模板、主进程传中文模板），未提供时回退 "name (count)"。
 */
function buildTransferDisplayName(names, formatMultipleName) {
  const normalizedNames = Array.from(
    new Set((names || []).map(normalizeTransferName).filter(Boolean)),
  );

  if (normalizedNames.length === 0) {
    return "";
  }

  if (normalizedNames.length === 1) {
    return normalizedNames[0];
  }

  if (typeof formatMultipleName === "function") {
    return formatMultipleName({
      firstName: normalizedNames[0],
      count: normalizedNames.length,
    });
  }

  return `${normalizedNames[0]} (${normalizedNames.length})`;
}

function getTopLevelTransferItemName(targetPath) {
  const normalizedPath = String(targetPath || "")
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+/, "");

  if (!normalizedPath) {
    return "";
  }

  const [firstSegment] = normalizedPath.split("/").filter(Boolean);
  return firstSegment || "";
}

module.exports = {
  normalizeTransferName,
  buildTransferDisplayName,
  getTopLevelTransferItemName,
};
