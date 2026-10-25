// AI 接口错误的简要展示：提取状态码、压缩空白并截断，避免长报文撑开消息气泡。
const API_ERROR_SUMMARY_MAX_LENGTH = 180;

const pickApiErrorMessage = (errorLike, fallback) => {
  if (typeof errorLike === "string") {
    return errorLike;
  }

  if (!errorLike || typeof errorLike !== "object") {
    return fallback;
  }

  return (
    errorLike.message ||
    errorLike.error ||
    errorLike.technicalMessage ||
    errorLike.statusText ||
    errorLike.raw?.message ||
    errorLike.raw?.error ||
    fallback
  );
};

const getApiErrorStatusCode = (errorLike) => {
  if (!errorLike || typeof errorLike !== "object") {
    const match = String(errorLike || "").match(/\b([45]\d{2})\b/);
    return match ? Number(match[1]) : null;
  }

  const candidates = [
    errorLike.statusCode,
    errorLike.status,
    errorLike.raw?.statusCode,
    errorLike.raw?.status,
    errorLike.error?.statusCode,
    errorLike.error?.status,
  ];

  for (const candidate of candidates) {
    const statusCode = Number(candidate);
    if (statusCode >= 400 && statusCode <= 599) {
      return statusCode;
    }
  }

  const text = [
    errorLike.message,
    errorLike.error,
    errorLike.technicalMessage,
    errorLike.raw?.message,
    errorLike.raw?.error,
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
};

const compactApiErrorMessage = (message) => {
  const compact = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= API_ERROR_SUMMARY_MAX_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, API_ERROR_SUMMARY_MAX_LENGTH - 3)}...`;
};

const stripStatusPrefix = (message, statusCode) =>
  message
    .replace(
      new RegExp(
        `^\\s*API\\s*(?:请求失败|request failed)?\\s*:?\\s*${statusCode}\\s*:?\\s*`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`^\\s*${statusCode}\\s*:?\\s*`, "i"), "")
    .trim();

export const formatBriefApiError = (errorLike, fallback) => {
  const statusCode = getApiErrorStatusCode(errorLike);
  const message = compactApiErrorMessage(
    pickApiErrorMessage(errorLike, fallback),
  );

  if (!statusCode) {
    return message || fallback;
  }

  return `API ${statusCode}: ${stripStatusPrefix(message, statusCode) || fallback}`;
};

export const createApiResponseError = (response, fallback) => {
  const error = new Error(pickApiErrorMessage(response, fallback));
  const statusCode = getApiErrorStatusCode(response);
  if (statusCode) {
    error.statusCode = statusCode;
  }
  error.raw = response;
  return error;
};
