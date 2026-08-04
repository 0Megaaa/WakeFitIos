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
  const landmarks = (event.landmarks ?? [])
    .map((item) => {
      const name = normalizeLandmarkName(item.name);
      const confidence = item.confidence ?? item.inFrameConfidence ?? 0;
      if (!name || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(confidence)) {
        return null;
      }

      return {
        name,
        x: item.x,
        y: item.y,
        confidence,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (landmarks.length === 0) {
    return null;
  }

  return {
    timestampMs,
    imageWidth: Number.isFinite(event.imageWidth) ? Number(event.imageWidth) : undefined,
    imageHeight: Number.isFinite(event.imageHeight) ? Number(event.imageHeight) : undefined,
    landmarks,
  };
}

function normalizeLandmarkName(name: string): PoseLandmarkName | null {
  const normalized = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return supportedLandmarkNames.get(normalized) ?? null;
}
