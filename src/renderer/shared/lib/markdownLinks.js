// Markdown 链接白名单：仅允许 http/https/mailto，并限制长度。
// AI 回复与发布说明都渲染不可信 Markdown，共用同一校验，避免两份实现漂移。
const MAX_MARKDOWN_LINK_LENGTH = 2048;
const ALLOWED_MARKDOWN_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export const normalizeSafeMarkdownHref = (href) => {
  if (typeof href !== "string") {
    return null;
  }

  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.length > MAX_MARKDOWN_LINK_LENGTH) {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(trimmedHref);
  } catch {
    return null;
  }

  const protocol = urlObj.protocol.toLowerCase();
  if (!ALLOWED_MARKDOWN_LINK_PROTOCOLS.has(protocol)) {
    return null;
  }

  return urlObj.toString();
};
