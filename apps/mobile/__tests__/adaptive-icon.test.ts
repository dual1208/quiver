import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type { ConfigContext, ExpoConfig } from "expo/config";
import buildAppConfig from "../app.config";

type AlphaBounds = Readonly<{
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function rgbaAlphaBounds(png: Buffer): AlphaBounds {
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];

  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colourType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") {
      imageData.push(data);
    }
    offset += length + 12;
  }

  expect({ bitDepth, colourType, interlace }).toEqual({
    bitDepth: 8,
    colourType: 6,
    interlace: 0,
  });

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(rowLength * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset] ?? -1;
    sourceOffset += 1;
    const rowOffset = y * rowLength;
    const previousRowOffset = rowOffset - rowLength;

    for (let index = 0; index < rowLength; index += 1) {
      const raw = filtered[sourceOffset] ?? 0;
      sourceOffset += 1;
      const left =
        index >= bytesPerPixel
          ? (pixels[rowOffset + index - bytesPerPixel] ?? 0)
          : 0;
      const up = y > 0 ? (pixels[previousRowOffset + index] ?? 0) : 0;
      const upperLeft =
        y > 0 && index >= bytesPerPixel
          ? (pixels[previousRowOffset + index - bytesPerPixel] ?? 0)
          : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0)
        throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[rowOffset + index] = (raw + predictor) & 0xff;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[y * rowLength + x * bytesPerPixel + 3] ?? 0) === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new Error("Expected the adaptive icon layer to contain alpha pixels");
  }
  return { width, height, minX, minY, maxX, maxY };
}

function configuredAdaptiveIconPaths(): readonly string[] {
  const config = buildAppConfig({ config: {} as ExpoConfig } as ConfigContext);
  const adaptiveIcon = config.android?.adaptiveIcon;
  const paths = [adaptiveIcon?.foregroundImage, adaptiveIcon?.monochromeImage];
  if (!paths.every((value): value is string => typeof value === "string")) {
    throw new Error("Expected configured foreground and monochrome PNG paths");
  }
  return paths;
}

describe("Android adaptive icon", () => {
  it("keeps every configured foreground alpha pixel inside the central 66/108 safe zone", () => {
    const mobileRoot = path.resolve(__dirname, "..");

    for (const configuredPath of configuredAdaptiveIconPaths()) {
      const bounds = rgbaAlphaBounds(
        readFileSync(path.resolve(mobileRoot, configuredPath)),
      );
      expect(bounds.width).toBe(bounds.height);
      const safeSize = (bounds.width * 66) / 108;
      const safeMinimum = Math.ceil((bounds.width - safeSize) / 2);
      const safeMaximum = Math.floor((bounds.width + safeSize) / 2) - 1;

      expect(bounds.minX).toBeGreaterThanOrEqual(safeMinimum);
      expect(bounds.minY).toBeGreaterThanOrEqual(safeMinimum);
      expect(bounds.maxX).toBeLessThanOrEqual(safeMaximum);
      expect(bounds.maxY).toBeLessThanOrEqual(safeMaximum);
    }
  });
});
