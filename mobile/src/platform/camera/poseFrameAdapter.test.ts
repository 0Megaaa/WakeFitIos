import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nativePoseEventToFrame } from './poseFrameAdapter.ts';

describe('native pose frame adapter', () => {
  it('converts native camera landmarks into the shared PoseFrame shape', () => {
    const frame = nativePoseEventToFrame({
      timestampMs: 1234,
      imageWidth: 640,
      imageHeight: 480,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'LEFT_SHOULDER', x: 10, y: 20, confidence: 0.9 },
        { name: 'left_elbow', x: 30, y: 40, confidence: 0.8 },
        { name: 'leftWrist', x: 50, y: 60, confidence: 0.7 },
        { name: 'LEFT_HIP', x: 70, y: 80, inFrameConfidence: 0.6 },
        { name: 'RIGHT_KNEE', x: 90, y: 100, confidence: 0.5 },
        { name: 'right_ankle', x: 110, y: 120, confidence: 0.4 },
        { name: 'nose', x: 1, y: 2, confidence: 0.9 },
      ],
    });

    assert.deepEqual(frame, {
      timestampMs: 1234,
      imageWidth: 640,
      imageHeight: 480,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        { name: 'leftShoulder', x: 10, y: 20, confidence: 0.9 },
        { name: 'leftElbow', x: 30, y: 40, confidence: 0.8 },
        { name: 'leftWrist', x: 50, y: 60, confidence: 0.7 },
        { name: 'leftHip', x: 70, y: 80, confidence: 0.6 },
        { name: 'rightKnee', x: 90, y: 100, confidence: 0.5 },
        { name: 'rightAnkle', x: 110, y: 120, confidence: 0.4 },
      ],
    });
  });

  it('drops invalid landmarks and returns null when the event has no usable body points', () => {
    assert.equal(
      nativePoseEventToFrame({
        timestampMs: 1234,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          { name: 'LEFT_SHOULDER', x: Number.NaN, y: 20, confidence: 0.9 },
          { name: 'nose', x: 1, y: 2, confidence: 0.9 },
        ],
      }),
      null,
    );
  });
});
