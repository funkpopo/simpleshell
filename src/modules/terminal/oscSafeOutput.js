// Preserve OSC metadata across SSH chunks while transforming visible text.
// No unbounded buffering: only a possible leading ESC is retained.
const createOscSafeOutputTransform = (transformText) => {
  let inOsc = false;
  let oscEscape = false;
  let pendingEscape = "";
  return (data, final = false) => {
    data = pendingEscape + data;
    pendingEscape = "";
    const parts = [];
    while (data) {
      if (inOsc) {
        const end =
          oscEscape && data[0] === "\\"
            ? { index: 0, 0: "\\" }
            : /\x07|\x1b\\|\x9c|\x18|\x1a/.exec(data);
        oscEscape = false;
        if (!end) {
          parts.push(data);
          oscEscape = data.endsWith("\x1b");
          break;
        }
        const length = end.index + end[0].length;
        parts.push(data.slice(0, length));
        data = data.slice(length);
        inOsc = false;
      } else {
        const start = /\x1b\]|\x9d/.exec(data);
        if (!start) {
          if (!final && data.endsWith("\x1b")) {
            pendingEscape = "\x1b";
            data = data.slice(0, -1);
          }
          if (data) parts.push(transformText(data));
          break;
        }
        if (start.index) parts.push(transformText(data.slice(0, start.index)));
        parts.push(start[0]);
        data = data.slice(start.index + start[0].length);
        inOsc = true;
      }
    }
    return parts.join("");
  };
};

module.exports = { createOscSafeOutputTransform };
