import type { Point } from '$lib/models/types';

// One detected wall segment in working-image pixel coordinates
export interface DetectedSegment {
  axis: 'horizontal' | 'vertical';
  start: Point;
  end: Point;
}

export interface DetectedImage {
  data: Uint8ClampedArray;
  width: number;            // working width (possibly downscaled)
  height: number;
  scaleFactor: number;      // working_dim / original_dim
  originalWidth: number;
  originalHeight: number;
}

export interface WallDetectOptions {
  // Pixel intensity (0-255) below which a pixel counts as "dark" (potential wall)
  darkThreshold?: number;
  // Minimum length (working pixels) for a run to be considered as a wall candidate
  minRunLength?: number;
  // Minimum thickness (rows/cols) for a run group to count as a real wall (filters thin dim/leader lines)
  minThicknessPx?: number;
  // Max row/col gap that still keeps adjacent runs in the same wall body
  rowGapTolerance?: number;
}


// Load an image data URL into an offscreen canvas, downscaling if it is huge so detection stays fast
export async function loadImageForDetection(dataUrl: string, maxDimension = 1500): Promise<DetectedImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read background image.'));
    el.src = dataUrl;
  });

  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  let workingWidth = originalWidth;
  let workingHeight = originalHeight;
  let scaleFactor = 1;
  const longest = Math.max(originalWidth, originalHeight);
  if (longest > maxDimension) {
    scaleFactor = maxDimension / longest;
    workingWidth = Math.round(originalWidth * scaleFactor);
    workingHeight = Math.round(originalHeight * scaleFactor);
  }

  const canvas = document.createElement('canvas');
  canvas.width = workingWidth;
  canvas.height = workingHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas context for detection.');
  ctx.drawImage(img, 0, 0, workingWidth, workingHeight);

  const imageData = ctx.getImageData(0, 0, workingWidth, workingHeight);
  return {
    data: imageData.data,
    width: workingWidth,
    height: workingHeight,
    scaleFactor,
    originalWidth,
    originalHeight,
  };
}


// Detect long, thick horizontal and vertical wall segments by run-length analysis on a thresholded image
export function detectWallSegments(image: DetectedImage, options: WallDetectOptions = {}): DetectedSegment[] {
  const darkThreshold = options.darkThreshold ?? 100;
  const minRunLength = options.minRunLength ?? Math.max(30, Math.floor(Math.min(image.width, image.height) * 0.02));
  const minThicknessPx = options.minThicknessPx ?? 4;
  const rowGap = options.rowGapTolerance ?? 2;

  const mask = buildDarkMask(image.data, image.width, image.height, darkThreshold);

  const horizontalRuns = findRuns(mask, image.width, image.height, 'horizontal', minRunLength);
  const verticalRuns = findRuns(mask, image.width, image.height, 'vertical', minRunLength);

  const horizontalSegments = groupRunsIntoSegments(horizontalRuns, 'horizontal', minThicknessPx, rowGap, minRunLength);
  const verticalSegments = groupRunsIntoSegments(verticalRuns, 'vertical', minThicknessPx, rowGap, minRunLength);

  return [...horizontalSegments, ...verticalSegments];
}


// Architectural walls are usually drawn as TWO parallel lines (outer + inner side of the wall).
// This function merges nearby parallel segments into a single wall in the middle.
// `maxGap` is the maximum perpendicular distance (in working pixels) between two lines to consider them the same wall.
export function mergeParallelWalls(segments: DetectedSegment[], maxGap: number): DetectedSegment[] {
  const horizontal = segments.filter(s => s.axis === 'horizontal');
  const vertical = segments.filter(s => s.axis === 'vertical');
  return [
    ...mergeParallelAxis(horizontal, 'horizontal', maxGap),
    ...mergeParallelAxis(vertical, 'vertical', maxGap),
  ];
}


// Convert pixel coordinates (in the working/downscaled image) to world coordinates using the background image transform
export function pixelToWorld(
  px: number,
  py: number,
  scaleFactor: number,
  worldUnitsPerOriginalPixel: number,
  bgPosition: Point,
  originalWidth: number,
  originalHeight: number
): Point {
  // Map working-image pixels back to original-image pixels first
  const originalPx = px / scaleFactor;
  const originalPy = py / scaleFactor;
  // Then apply the background image transform (image is drawn centered at bgPosition)
  return {
    x: bgPosition.x + (originalPx - originalWidth / 2) * worldUnitsPerOriginalPixel,
    y: bgPosition.y + (originalPy - originalHeight / 2) * worldUnitsPerOriginalPixel,
  };
}


// --- internal helpers -------------------------------------------------------


// Convert RGBA pixel data into a flat 1/0 mask. Pixel counts as "dark" when its average channel value is below the threshold.
function buildDarkMask(data: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    mask[p] = avg < threshold ? 1 : 0;
  }
  return mask;
}


interface RawRun {
  // Horizontal: line is the row y, [a, b] is the x-range. Vertical: line is the column x, [a, b] is the y-range.
  line: number;
  a: number;
  b: number;
}


// Walk every row (or column) and emit long consecutive dark stretches
function findRuns(
  mask: Uint8Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
  minLength: number
): RawRun[] {
  const runs: RawRun[] = [];
  if (axis === 'horizontal') {
    for (let y = 0; y < height; y++) {
      let start = -1;
      for (let x = 0; x < width; x++) {
        if (mask[y * width + x]) {
          if (start === -1) start = x;
        } else if (start !== -1) {
          if (x - start >= minLength) runs.push({ line: y, a: start, b: x - 1 });
          start = -1;
        }
      }
      if (start !== -1 && width - start >= minLength) runs.push({ line: y, a: start, b: width - 1 });
    }
  } else {
    for (let x = 0; x < width; x++) {
      let start = -1;
      for (let y = 0; y < height; y++) {
        if (mask[y * width + x]) {
          if (start === -1) start = y;
        } else if (start !== -1) {
          if (y - start >= minLength) runs.push({ line: x, a: start, b: y - 1 });
          start = -1;
        }
      }
      if (start !== -1 && height - start >= minLength) runs.push({ line: x, a: start, b: height - 1 });
    }
  }
  return runs;
}


// BFS-group adjacent rows/cols whose run ranges overlap. Output only groups thick enough to be real walls.
function groupRunsIntoSegments(
  runs: RawRun[],
  axis: 'horizontal' | 'vertical',
  minThickness: number,
  gap: number,
  minRunLength: number
): DetectedSegment[] {
  runs.sort((a, b) => a.line - b.line || a.a - b.a);

  const used = new Uint8Array(runs.length);
  const segments: DetectedSegment[] = [];

  for (let i = 0; i < runs.length; i++) {
    if (used[i]) continue;

    const group: RawRun[] = [];
    const queue = [i];
    used[i] = 1;

    while (queue.length > 0) {
      const idx = queue.shift()!;
      group.push(runs[idx]);
      const cur = runs[idx];

      for (let j = 0; j < runs.length; j++) {
        if (used[j]) continue;
        const cand = runs[j];
        if (Math.abs(cand.line - cur.line) > gap) continue;
        const overlap = Math.min(cur.b, cand.b) - Math.max(cur.a, cand.a);
        if (overlap > minRunLength * 0.4) {
          used[j] = 1;
          queue.push(j);
        }
      }
    }

    const distinctLines = new Set(group.map(r => r.line));
    if (distinctLines.size < minThickness) continue;

    const lineAvg = group.reduce((s, r) => s + r.line, 0) / group.length;
    const a = Math.min(...group.map(r => r.a));
    const b = Math.max(...group.map(r => r.b));

    if (axis === 'horizontal') {
      segments.push({ axis: 'horizontal', start: { x: a, y: lineAvg }, end: { x: b, y: lineAvg } });
    } else {
      segments.push({ axis: 'vertical', start: { x: lineAvg, y: a }, end: { x: lineAvg, y: b } });
    }
  }

  return segments;
}


// Merge segments on the same axis that are parallel and close together (typical for double-line wall drawings)
function mergeParallelAxis(
  segs: DetectedSegment[],
  axis: 'horizontal' | 'vertical',
  maxGap: number
): DetectedSegment[] {
  const used = new Uint8Array(segs.length);
  const result: DetectedSegment[] = [];

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;

    const group: DetectedSegment[] = [segs[i]];
    used[i] = 1;

    // Keep absorbing nearby parallel segments until no more can be added
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const cand = segs[j];
        if (group.some(g => isParallelClose(g, cand, axis, maxGap))) {
          group.push(cand);
          used[j] = 1;
          grew = true;
        }
      }
    }

    if (axis === 'horizontal') {
      const avgY = group.reduce((s, g) => s + g.start.y, 0) / group.length;
      const minX = Math.min(...group.map(g => Math.min(g.start.x, g.end.x)));
      const maxX = Math.max(...group.map(g => Math.max(g.start.x, g.end.x)));
      result.push({ axis: 'horizontal', start: { x: minX, y: avgY }, end: { x: maxX, y: avgY } });
    } else {
      const avgX = group.reduce((s, g) => s + g.start.x, 0) / group.length;
      const minY = Math.min(...group.map(g => Math.min(g.start.y, g.end.y)));
      const maxY = Math.max(...group.map(g => Math.max(g.start.y, g.end.y)));
      result.push({ axis: 'vertical', start: { x: avgX, y: minY }, end: { x: avgX, y: maxY } });
    }
  }

  return result;
}


// Two parallel segments (same axis) are "close" if their perpendicular distance <= maxGap AND their parallel extents overlap
function isParallelClose(a: DetectedSegment, b: DetectedSegment, axis: 'horizontal' | 'vertical', maxGap: number): boolean {
  if (axis === 'horizontal') {
    if (Math.abs(a.start.y - b.start.y) > maxGap) return false;
    const aMinX = Math.min(a.start.x, a.end.x);
    const aMaxX = Math.max(a.start.x, a.end.x);
    const bMinX = Math.min(b.start.x, b.end.x);
    const bMaxX = Math.max(b.start.x, b.end.x);
    return Math.min(aMaxX, bMaxX) > Math.max(aMinX, bMinX);
  } else {
    if (Math.abs(a.start.x - b.start.x) > maxGap) return false;
    const aMinY = Math.min(a.start.y, a.end.y);
    const aMaxY = Math.max(a.start.y, a.end.y);
    const bMinY = Math.min(b.start.y, b.end.y);
    const bMaxY = Math.max(b.start.y, b.end.y);
    return Math.min(aMaxY, bMaxY) > Math.max(aMinY, bMinY);
  }
}
