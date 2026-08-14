const STANDARD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const DECODE_TABLE = new Int16Array(128);
DECODE_TABLE.fill(-1);
for (let index = 0; index < STANDARD_ALPHABET.length; index += 1) {
  DECODE_TABLE[STANDARD_ALPHABET.charCodeAt(index)] = index;
}

export class Base64DecodeError extends Error {
  constructor() {
    super("Invalid standard base64");
    this.name = "Base64DecodeError";
  }
}

function sextetAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code >= DECODE_TABLE.length) {
    throw new Base64DecodeError();
  }
  const sextet = DECODE_TABLE[code];
  if (sextet === undefined || sextet < 0) {
    throw new Base64DecodeError();
  }
  return sextet;
}

export function base64DecodedLength(text: string): number {
  let firstPadding = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index);
    if (character === 61) {
      firstPadding = Math.min(firstPadding, index);
      continue;
    }
    if (firstPadding !== text.length) {
      throw new Base64DecodeError();
    }
    sextetAt(text, index);
  }

  const padding = text.length - firstPadding;
  if (padding > 2) {
    throw new Base64DecodeError();
  }

  const nonPaddingLength = firstPadding;
  const remainder = nonPaddingLength % 4;
  if (remainder === 1) {
    throw new Base64DecodeError();
  }
  if (
    padding > 0 &&
    (text.length % 4 !== 0 ||
      padding !== (remainder === 2 ? 2 : remainder === 3 ? 1 : 0))
  ) {
    throw new Base64DecodeError();
  }

  if (remainder === 2 && (sextetAt(text, nonPaddingLength - 1) & 0x0f) !== 0) {
    throw new Base64DecodeError();
  }
  if (remainder === 3 && (sextetAt(text, nonPaddingLength - 1) & 0x03) !== 0) {
    throw new Base64DecodeError();
  }

  return Math.floor((nonPaddingLength * 6) / 8);
}

export function decodeStandardBase64(text: string): Uint8Array {
  const output = new Uint8Array(base64DecodedLength(text));
  const nonPaddingLength =
    text.indexOf("=") === -1 ? text.length : text.indexOf("=");
  let outputIndex = 0;

  for (let inputIndex = 0; inputIndex < nonPaddingLength; inputIndex += 4) {
    const first = sextetAt(text, inputIndex);
    const second = sextetAt(text, inputIndex + 1);
    output[outputIndex] = (first << 2) | (second >> 4);
    outputIndex += 1;

    if (inputIndex + 2 < nonPaddingLength) {
      const third = sextetAt(text, inputIndex + 2);
      output[outputIndex] = ((second & 0x0f) << 4) | (third >> 2);
      outputIndex += 1;

      if (inputIndex + 3 < nonPaddingLength) {
        const fourth = sextetAt(text, inputIndex + 3);
        output[outputIndex] = ((third & 0x03) << 6) | fourth;
        outputIndex += 1;
      }
    }
  }

  return output;
}

export function encodeStandardBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1]! : 0;
    const third = hasThird ? bytes[index + 2]! : 0;

    chunk += STANDARD_ALPHABET[first >> 2];
    chunk += STANDARD_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    chunk += hasSecond
      ? STANDARD_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]
      : "=";
    chunk += hasThird ? STANDARD_ALPHABET[third & 0x3f] : "=";

    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = "";
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks.join("");
}
