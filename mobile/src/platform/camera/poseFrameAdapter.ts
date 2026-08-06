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
  const timestampMs = Number.isFinite(event.timestampMs) ? Number(event.timestampMs) : Date.now();

  // Validate image dimensions
  const imageWidth = Number.isFinite(event.imageWidth) && Number(event.imageWidth) > 0 ? Number(event.imageWidth) : undefined;
  const imageHeight = Number.isFinite(event.imageHeight) && Number(event.imageHeight) > 0 ? Number(event.imageHeight) : undefined;

  const landmarks = (event.landmarks ?? [])
    .map((item) => {
      const name = normalizeLandmarkName(item.name);
      const confidence = item.confidence ?? item.inFrameConfidence ?? 0;
      // Validate: must have finite coordinates and confidence
      if (!name || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(confidence)) {
        return null;
      }

      // Validate: coordinates must be within valid range for the coordinate space
      // upright-top-left-unmirrored: x >= 0, y >= 0
      if (item.x < 0 || item.y < 0) {
        return null;
      }

      return {
        name,
        x: item.x,
        y: item.y,
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
    cameraFacing: event.cameraFacing,
    source: event.source,
    coordinateSpace: 'upright-top-left-unmirrored',
  };
}

function normalizeLandmarkName(name: string): PoseLandmarkName | null {
  const normalized = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return supportedLandmarkNames.get(normalized) ?? null;
}
