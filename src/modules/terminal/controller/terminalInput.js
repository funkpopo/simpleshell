export const INPUT_SEND_CHUNK_SIZE = 1024;
export const INPUT_SEND_MAX_CHUNKS_PER_FRAME = 8;
export const INPUT_SEND_FRAME_DELAY_MS = 8;
export const COMMENT_LINE_SEND_INTERVAL_MS = 12;

const LARGE_INPUT_LENGTH_THRESHOLD = 2048;
const MULTILINE_INPUT_LENGTH_THRESHOLD = 512;

export const processMultilineInput = (text, options = {}) => {
  if (!text || typeof text !== "string") return text;

  if (!text.includes("\n")) return text;

  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return text;

  const commentPatterns = [
    /^\s*\/\//,
    /^\s*#/,
    /^\s*--/,
    /^\s*;/,
    /^\s*%/,
    /^\s*\/\*/,
    /^\s*\*\//,
  ];

  const isCommentLine = (line) => {
    return commentPatterns.some((pattern) => pattern.test(line));
  };

  const hasCommentLines = lines.some((line) => isCommentLine(line));

  if (hasCommentLines && options.sendLineByLine !== false) {
    return {
      type: "multiline-with-comments",
      lines,
      isCommentLine,
    };
  }

  const lineEnding = "\n";
  let result = "";
  let isInCommentBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasComment = isCommentLine(line);

    if (line.includes("/*")) isInCommentBlock = true;
    if (line.includes("*/")) isInCommentBlock = false;

    result += line;

    if (i < lines.length - 1) {
      if (hasComment || isInCommentBlock) {
        result += lineEnding + String.fromCharCode(13);
      } else {
        result += lineEnding;
      }
    }
  }

  return result;
};

export const shouldChunkInputPayload = (input) => {
  if (!input || typeof input !== "string") {
    return false;
  }

  if (input.length >= LARGE_INPUT_LENGTH_THRESHOLD) {
    return true;
  }

  return (
    input.length >= MULTILINE_INPUT_LENGTH_THRESHOLD &&
    (input.includes("\n") || input.includes("\r"))
  );
};
