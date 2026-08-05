import type { ChallengeSnapshot } from '../../domain/challenge/types.ts';
import type { ExerciseType } from '../../domain/exercise/types.ts';
import type { PoseFrame, PoseLandmarkName } from '../../domain/exercise/types.ts';
import { createChallengeFlow } from '../../domain/challenge/challengeFlow.ts';

type ChallengeFlow = ReturnType<typeof createChallengeFlow>;

export function driveOneSimulatedPushUp(
  flow: ChallengeFlow,
  startTimestampMs = Date.now(),
): ChallengeSnapshot {
  return driveOneSimulatedExercise(flow, 'push_up', startTimestampMs);
}

export function driveOneSimulatedExercise(
  flow: ChallengeFlow,
  exerciseType: ExerciseType,
  startTimestampMs = Date.now(),
): ChallengeSnapshot {
  let snapshot = flow.getSnapshot();

  const frames = exerciseType === 'squat'
    ? createSimulatedSquatFrames(startTimestampMs)
    : createSimulatedPushUpFrames(startTimestampMs);

  for (const frame of frames) {
    snapshot = flow.handlePoseFrame(frame);
  }

  return snapshot;
}

export function createSimulatedPushUpFrames(startTimestampMs = Date.now()): PoseFrame[] {
  return [
    createPushUpFrame('up', startTimestampMs),
    createPushUpFrame('up', startTimestampMs + 100),
    createPushUpFrame('down', startTimestampMs + 1000),
    createPushUpFrame('down', startTimestampMs + 1100),
    createPushUpFrame('up', startTimestampMs + 2000),
    createPushUpFrame('up', startTimestampMs + 2100),
  ];
}

export function createSimulatedSquatFrames(startTimestampMs = Date.now()): PoseFrame[] {
  return [
    createSquatFrame('standing', startTimestampMs),
    createSquatFrame('standing', startTimestampMs + 100),
    createSquatFrame('squatting', startTimestampMs + 1000),
    createSquatFrame('squatting', startTimestampMs + 1100),
    createSquatFrame('standing', startTimestampMs + 2000),
    createSquatFrame('standing', startTimestampMs + 2100),
  ];
}

function createPushUpFrame(angle: 'up' | 'down', timestampMs: number): PoseFrame {
  const wrist = angle === 'up' ? { x: 1, y: 0 } : { x: -0.2, y: -1 };

  return {
    timestampMs,
    landmarks: [
      landmark('leftShoulder', -1, 0),
      landmark('leftElbow', 0, 0),
      landmark('leftWrist', wrist.x, wrist.y),
      landmark('leftHip', -1.1, 1),
    ],
  };
}

function createSquatFrame(pose: 'standing' | 'squatting', timestampMs: number): PoseFrame {
  const lowerBody = pose === 'standing'
    ? {
        leftHip: { x: 110, y: 240 },
        rightHip: { x: 190, y: 240 },
        leftKnee: { x: 115, y: 400 },
        rightKnee: { x: 185, y: 400 },
        leftAnkle: { x: 120, y: 560 },
        rightAnkle: { x: 180, y: 560 },
      }
    : {
        leftHip: { x: 115, y: 330 },
        rightHip: { x: 185, y: 330 },
        leftKnee: { x: 85, y: 410 },
        rightKnee: { x: 215, y: 410 },
        leftAnkle: { x: 120, y: 560 },
        rightAnkle: { x: 180, y: 560 },
      };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    landmarks: [
      landmark('leftShoulder', 90, pose === 'standing' ? 100 : 130),
      landmark('rightShoulder', 210, pose === 'standing' ? 100 : 130),
      landmark('leftHip', lowerBody.leftHip.x, lowerBody.leftHip.y),
      landmark('rightHip', lowerBody.rightHip.x, lowerBody.rightHip.y),
      landmark('leftKnee', lowerBody.leftKnee.x, lowerBody.leftKnee.y),
      landmark('rightKnee', lowerBody.rightKnee.x, lowerBody.rightKnee.y),
      landmark('leftAnkle', lowerBody.leftAnkle.x, lowerBody.leftAnkle.y),
      landmark('rightAnkle', lowerBody.rightAnkle.x, lowerBody.rightAnkle.y),
    ],
  };
}

function landmark(name: PoseLandmarkName, x: number, y: number) {
  return { name, x, y, confidence: 0.95 };
}
