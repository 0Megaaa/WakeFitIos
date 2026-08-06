import type { PoseFrame, PoseLandmarkName } from '../../domain/exercise/types.ts';

export type NativePoseLandmark = {
  name: string;
  x: number;
  y: number;
  confidence?: number;
  inFrameConfidence?: number;
};

export type NativePoseFrameEvent = {
  timestampMs?: number;
  imageWidth?: number;
  imageHeight?: number;
  landmarks?: NativePoseLandmark[];
  cameraFacing?: 'front' | 'back';
  source?: 'apple-vision' | 'mlkit';
  coordinateSpace?: string;
};

const supportedLandmarkNames = new Map<string, PoseLandmarkName>([
  ['leftshoulder', 'leftShoulder'],
  ['leftelbow', 'leftElbow'],
  ['leftwrist', 'leftWrist'],
  ['lefthip', 'leftHip'],
  ['leftknee', 'leftKnee'],
  ['leftankle', 'leftAnkle'],
  ['rightshoulder', 'rightShoulder'],
  ['rightelbow', 'rightElbow'],
  ['rightwrist', 'rightWrist'],
  ['righthip', 'rightHip'],
  ['rightknee', 'rightKnee'],
  ['rightankle', 'rightAnkle'],
]);

export function nativePoseEventToFrame(event: NativePoseFrameEvent): PoseFrame | null {
  // Validate mandatory fields
  const imageWidth = Number(event.imageWidth);
  const imageHeight = Number(event.imageHeight);

  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
    return null;
  }
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }

  const cameraFacing = event.cameraFacing;
  if (cameraFacing !== 'front' && cameraFacing !== 'back') {
    return null;
  }

  const source = event.source;
  if (source !== 'apple-vision' && source !== 'mlkit') {
    return null;
  }

  const coordinateSpace = event.coordinateSpace;
  if (coordinateSpace !== 'upright-top-left-unmirrored') {
    return null;
  }

  const timestampMs = Number.isFinite(event.timestampMs) ? Number(event.timestampMs) : Date.now();

  // Validate landmarks
  const landmarks = (event.landmarks ?? [])
    .map((item) => {
      const name = normalizeLandmarkName(item.name);
      if (!name) {
        return null;
      }

      const x = Number(item.x);
      const y = Number(item.y);
      const confidence = item.confidence ?? item.inFrameConfidence ?? 0;

      // Must have finite coordinates and confidence
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(confidence)) {
        return null;
      }

      // Confidence must be in valid range [0, 1]
      if (confidence < 0 || confidence > 1) {
        return null;
      }

      // Coordinates must be non-negative
      if (x < 0 || y < 0) {
        return null;
      }

      // Coordinates must be within image bounds
      if (x > imageWidth || y > imageHeight) {
        return null;
      }

      return {
        name,
        x,
        y,
        confidence,
      } as { name: PoseLandmarkName; x: number; y: number; confidence: number };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (landmarks.length === 0) {
    return null;
  }

  return {
    timestampMs,
    imageWidth,
    imageHeight,
    landmarks,
    cameraFacing,
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
  };
}

function normalizeLandmarkName(name: string): PoseLandmarkName | null {
  const normalized = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return supportedLandmarkNames.get(normalized) ?? null;
}
