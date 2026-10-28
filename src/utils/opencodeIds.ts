const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_ID_BODY_LENGTH = 26;
const OPENCODE_TIME_HEX_LENGTH = 12;

let lastTimestamp = 0;
let counter = 0;

function randomBase62(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += BASE62[bytes[i] % 62];
  }
  return result;
}

/** Matches OpenCode Identifier.ascending("message") shape: msg_<12 hex><14 base62>. */
export function createOpencodeMessageId(timestamp = Date.now()): string {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }
  counter += 1;

  const now = BigInt(timestamp) * BigInt(0x1000) + BigInt(counter);
  const timeBytes = new Uint8Array(6);
  for (let i = 0; i < 6; i += 1) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
  }
  const hex = Array.from(timeBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `msg_${hex}${randomBase62(OPENCODE_ID_BODY_LENGTH - OPENCODE_TIME_HEX_LENGTH)}`;
}

export function isOpencodeMessageId(id: string): boolean {
  return id.startsWith("msg_");
}
