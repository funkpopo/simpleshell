/**
 * Frame protocol between the main process and `simpleshell-core`.
 * Mirrors `native-services/crates/core-protocol` (frame.rs / control.rs).
 *
 *   [len u32 LE = 5 + payload][kind u8][stream u32 LE][payload]
 *
 * Control frames (kind 1, stream 0) carry one JSON object with `schemaVersion`
 * and `op`. Data frames (kind 2, stream >= 1) carry opaque bytes.
 */
const CORE_SCHEMA_VERSION = 1;
const FRAME_KIND = Object.freeze({ CONTROL: 1, DATA: 2 });
const FRAME_META_BYTES = 5;
const FRAME_HEADER_BYTES = 4 + FRAME_META_BYTES;
const MAX_FRAME_PAYLOAD = 16 * 1024 * 1024;
// Outgoing data is split well below the hard limit to keep frames interleavable.
const DATA_CHUNK_BYTES = 1024 * 1024;

function encodeFrame(kind, stream, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length > MAX_FRAME_PAYLOAD) {
    throw new RangeError(
      `frame payload ${body.length} exceeds ${MAX_FRAME_PAYLOAD}`,
    );
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length);
  frame.writeUInt32LE(FRAME_META_BYTES + body.length, 0);
  frame.writeUInt8(kind, 4);
  frame.writeUInt32LE(stream >>> 0, 5);
  body.copy(frame, FRAME_HEADER_BYTES);
  return frame;
}

function encodeControl(message) {
  return encodeFrame(
    FRAME_KIND.CONTROL,
    0,
    Buffer.from(
      JSON.stringify({ schemaVersion: CORE_SCHEMA_VERSION, ...message }),
      "utf8",
    ),
  );
}

/** Splits `payload` into as many data frames as needed. */
function encodeData(stream, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (body.length <= DATA_CHUNK_BYTES)
    return [encodeFrame(FRAME_KIND.DATA, stream, body)];
  const frames = [];
  for (let offset = 0; offset < body.length; offset += DATA_CHUNK_BYTES) {
    frames.push(
      encodeFrame(
        FRAME_KIND.DATA,
        stream,
        body.subarray(offset, offset + DATA_CHUNK_BYTES),
      ),
    );
  }
  return frames;
}

/**
 * Incremental decoder; `push` returns every complete frame. Chunks are only
 * joined once a whole frame is available, so large frames arriving in small
 * pipe reads are copied once.
 */
class FrameDecoder {
  constructor() {
    this.chunks = [];
    this.length = 0;
    this.frameLength = null;
  }

  _take(count) {
    const first = this.chunks[0];
    let bytes;
    if (first.length >= count) {
      bytes = first.subarray(0, count);
      if (first.length === count) this.chunks.shift();
      else this.chunks[0] = first.subarray(count);
    } else {
      bytes = Buffer.allocUnsafe(count);
      let copied = 0;
      while (copied < count) {
        const chunk = this.chunks[0];
        const used = Math.min(chunk.length, count - copied);
        chunk.copy(bytes, copied, 0, used);
        copied += used;
        if (used === chunk.length) this.chunks.shift();
        else this.chunks[0] = chunk.subarray(used);
      }
    }
    this.length -= count;
    return bytes;
  }

  push(chunk) {
    if (chunk.length) {
      this.chunks.push(chunk);
      this.length += chunk.length;
    }
    const frames = [];
    for (;;) {
      if (this.frameLength === null) {
        if (this.length < 4) break;
        const length = this._take(4).readUInt32LE(0);
        if (length < FRAME_META_BYTES)
          throw new Error("frame length shorter than header");
        if (length - FRAME_META_BYTES > MAX_FRAME_PAYLOAD) {
          throw new Error(
            `frame payload ${length - FRAME_META_BYTES} exceeds ${MAX_FRAME_PAYLOAD}`,
          );
        }
        this.frameLength = length;
      }
      if (this.length < this.frameLength) break;
      const body = this._take(this.frameLength);
      this.frameLength = null;
      const kind = body.readUInt8(0);
      if (kind !== FRAME_KIND.CONTROL && kind !== FRAME_KIND.DATA) {
        throw new Error(`unknown frame kind ${kind}`);
      }
      frames.push({
        kind,
        stream: body.readUInt32LE(1),
        payload: body.subarray(FRAME_META_BYTES),
      });
    }
    return frames;
  }
}

function parseControl(payload) {
  const message = JSON.parse(payload.toString("utf8"));
  if (message?.schemaVersion !== CORE_SCHEMA_VERSION) {
    throw new Error(`unsupported core schemaVersion ${message?.schemaVersion}`);
  }
  return message;
}

module.exports = {
  CORE_SCHEMA_VERSION,
  FRAME_KIND,
  FRAME_HEADER_BYTES,
  MAX_FRAME_PAYLOAD,
  DATA_CHUNK_BYTES,
  encodeFrame,
  encodeControl,
  encodeData,
  FrameDecoder,
  parseControl,
};
