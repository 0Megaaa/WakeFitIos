import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nativePoseEventToFrame, type NativePoseFrameEvent } from './poseFrameAdapter.ts';
import { classifySquatPoseFrame } from '../../domain/exercise/squatPoseClassifier.ts';
import { evaluatePoseQuality } from '../../domain/exercise/poseQuality.ts';
import { createSquatCounter } from '../../domain/exercise/pushupCounter.ts';

/**
 * Cross-platform consistency tests for the unified PoseFrame contract.
 *
 * These tests verify that:
 * 1. PoseFrame events from both iOS (apple-vision) and Android (mlkit) platforms
 *    produce consistent coordinate spaces
 * 2. Camera facing metadata is preserved through the adapter
 * 3. Source metadata is correctly set
 * 4. The squat classifier and quality evaluator work on the unified contract
 * 5. The adapter correctly validates all required fields
 */

/**
 * Helper to create a complete valid NativePoseFrameEvent for squat testing.
 * All required fields are always provided.
 */
function completeSquatEvent(overrides: Partial<NativePoseFrameEvent> = {}): NativePoseFrameEvent {
  return {
    timestampMs: 1000,
    imageWidth: 640,
    imageHeight: 480,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
      { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
      { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
      { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
      { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
      { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
      { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
      { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
    ],
    ...overrides,
  };
}

/**
 * Helper to create a complete standing pose frame for counter testing.
 */
function completeStandingEvent(timestampMs: number, overrides: Partial<NativePoseFrameEvent> = {}): NativePoseFrameEvent {
  return {
    timestampMs,
    imageWidth: 640,
    imageHeight: 480,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      { name: 'leftShoulder', x: 150, y: 80, confidence: 0.95 },
      { name: 'rightShoulder', x: 490, y: 80, confidence: 0.95 },
      { name: 'leftHip', x: 160, y: 280, confidence: 0.95 },
      { name: 'rightHip', x: 480, y: 280, confidence: 0.95 },
      { name: 'leftKnee', x: 165, y: 380, confidence: 0.95 },
      { name: 'rightKnee', x: 475, y: 380, confidence: 0.95 },
      { name: 'leftAnkle', x: 170, y: 460, confidence: 0.95 },
      { name: 'rightAnkle', x: 470, y: 460, confidence: 0.95 },
    ],
    ...overrides,
  };
}

/**
 * Helper to create a complete squat pose frame for counter testing.
 * Uses knee angles that definitely trigger squatting classification.
 */
function completeSquattingEvent(timestampMs: number, overrides: Partial<NativePoseFrameEvent> = {}): NativePoseFrameEvent {
  return {
    timestampMs,
    imageWidth: 640,
    imageHeight: 480,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Deep squat fixture for 640x480
      // Hip at y=300, knee forward at x=70/570, ankle at y=460
      // Hip angle ~100-110° (< 120° threshold = deep squat)
      { name: 'leftShoulder', x: 140, y: 80, confidence: 0.95 },
      { name: 'rightShoulder', x: 160, y: 80, confidence: 0.95 },
      { name: 'leftHip', x: 150, y: 300, confidence: 0.95 },
      { name: 'rightHip', x: 490, y: 300, confidence: 0.95 },
      { name: 'leftKnee', x: 70, y: 390, confidence: 0.95 },
      { name: 'rightKnee', x: 570, y: 390, confidence: 0.95 },
      { name: 'leftAnkle', x: 150, y: 460, confidence: 0.95 },
      { name: 'rightAnkle', x: 490, y: 460, confidence: 0.95 },
    ],
    ...overrides,
  };
}

describe('PoseFrame contract consistency', () => {
  describe('nativePoseEventToFrame adapter validation', () => {
    describe('required field validation', () => {
      it('returns null when imageWidth is missing', () => {
        const event = completeSquatEvent({ imageWidth: undefined });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'missing imageWidth should return null');
      });

      it('returns null when imageHeight is missing', () => {
        const event = completeSquatEvent({ imageHeight: undefined });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'missing imageHeight should return null');
      });

      it('returns null when cameraFacing is missing', () => {
        const event = completeSquatEvent({ cameraFacing: undefined });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'missing cameraFacing should return null');
      });

      it('returns null when source is missing', () => {
        const event = completeSquatEvent({ source: undefined });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'missing source should return null');
      });

      it('returns null when coordinateSpace is missing', () => {
        const event = completeSquatEvent({ coordinateSpace: undefined });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'missing coordinateSpace should return null');
      });

      it('returns null when coordinateSpace is wrong', () => {
        const event = completeSquatEvent({ coordinateSpace: 'mirrored-top-left' });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'wrong coordinateSpace should return null');
      });

      it('returns null when imageWidth is zero', () => {
        const event = completeSquatEvent({ imageWidth: 0 });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'zero imageWidth should return null');
      });

      it('returns null when imageHeight is negative', () => {
        const event = completeSquatEvent({ imageHeight: -100 });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'negative imageHeight should return null');
      });
    });

    describe('landmark validation', () => {
      it('rejects landmarks with x > imageWidth', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 700, y: 80, confidence: 0.9 }, // x > 640
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'x > imageWidth should return null');
      });

      it('rejects landmarks with y > imageHeight', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 150, y: 500, confidence: 0.9 }, // y > 480
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'y > imageHeight should return null');
      });

      it('rejects landmarks with negative x', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: -10, y: 80, confidence: 0.9 },
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'negative x should return null');
      });

      it('rejects landmarks with negative y', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 150, y: -5, confidence: 0.9 },
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'negative y should return null');
      });

      it('rejects landmarks with confidence < 0', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 150, y: 80, confidence: -0.1 },
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'confidence < 0 should return null');
      });

      it('rejects landmarks with confidence > 1', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 150, y: 80, confidence: 1.5 },
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'confidence > 1 should return null');
      });

      it('returns null when no valid landmarks remain after filtering', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'unknownJoint', x: 100, y: 100, confidence: 0.9 },
            { name: 'invalidPoint', x: 200, y: 200, confidence: 0.8 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.equal(frame, null, 'no valid landmarks should return null');
      });

      it('discards individual invalid points but accepts valid ones', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
            { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
            { name: 'invalidPoint', x: 999, y: 999, confidence: 0.5 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.ok(frame, 'should accept frame with some invalid points filtered out');
        assert.equal(frame.landmarks.length, 8, 'invalid point should be filtered');
      });
    });

    describe('correct transformation', () => {
      it('transforms complete iOS event correctly', () => {
        const event = completeSquatEvent({
          source: 'apple-vision',
          cameraFacing: 'front',
        });
        const frame = nativePoseEventToFrame(event);
        assert.ok(frame);
        assert.equal(frame.cameraFacing, 'front');
        assert.equal(frame.source, 'apple-vision');
        assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
        assert.equal(frame.imageWidth, 640);
        assert.equal(frame.imageHeight, 480);
      });

      it('transforms complete Android event correctly', () => {
        const event = completeSquatEvent({
          source: 'mlkit',
          cameraFacing: 'back',
        });
        const frame = nativePoseEventToFrame(event);
        assert.ok(frame);
        assert.equal(frame.cameraFacing, 'back');
        assert.equal(frame.source, 'mlkit');
        assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
      });

      it('normalizes landmark names (lowercase, strips non-alpha)', () => {
        const event = completeSquatEvent({
          landmarks: [
            { name: 'LEFT_SHOULDER', x: 150, y: 80, confidence: 0.9 },
            { name: 'RightShoulder', x: 490, y: 80, confidence: 0.9 },
            { name: 'left-hip', x: 160, y: 280, confidence: 0.85 },
            { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
            { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
            { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
            { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
            { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
          ],
        });
        const frame = nativePoseEventToFrame(event);
        assert.ok(frame);
        assert.equal(frame.landmarks.length, 8);
        assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'leftShoulder'));
        assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'rightShoulder'));
        assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'leftHip'));
      });

      it('accepts coordinateSpace=upright-top-left-unmirrored', () => {
        const event = completeSquatEvent({ coordinateSpace: 'upright-top-left-unmirrored' });
        const frame = nativePoseEventToFrame(event);
        assert.ok(frame);
        assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
      });
    });
  });

  describe('pose quality evaluation on unified PoseFrame', () => {
    it('returns ok for complete confident body in frame', () => {
      const frame = nativePoseEventToFrame(completeSquatEvent());
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'ok', 'full body visible should be ok');
      assert.ok(quality.guidance.length > 0, 'should have guidance text');
    });

    it('returns partial_body for missing landmarks', () => {
      const event = completeSquatEvent({
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'partial_body', 'missing knees and ankles');
      assert.ok(quality.metrics.visibleLandmarkCount < quality.metrics.requiredLandmarkCount);
    });

    it('returns low_confidence for low confidence landmarks', () => {
      const event = completeSquatEvent({
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.3 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.3 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.3 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.3 },
          { name: 'leftKnee', x: 165, y: 380, confidence: 0.3 },
          { name: 'rightKnee', x: 475, y: 380, confidence: 0.3 },
          { name: 'leftAnkle', x: 170, y: 460, confidence: 0.3 },
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.3 },
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'low_confidence', 'all landmarks below minConfidence');
    });

    it('returns out_of_frame when points are outside image bounds', () => {
      const event = completeSquatEvent({
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
          { name: 'leftKnee', x: 165, y: 380, confidence: 0.8 },
          { name: 'rightKnee', x: 475, y: 380, confidence: 0.8 },
          { name: 'leftAnkle', x: 170, y: 460, confidence: 0.75 },
          { name: 'rightAnkle', x: 470, y: 500, confidence: 0.75 }, // y > 480
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.equal(frame, null, 'y > imageHeight should return null from adapter');
    });

    it('works independently of cameraFacing', () => {
      const frameFront = nativePoseEventToFrame(completeSquatEvent({ cameraFacing: 'front' }));
      const frameBack = nativePoseEventToFrame(completeSquatEvent({ cameraFacing: 'back' }));
      assert.ok(frameFront);
      assert.ok(frameBack);
      const qualityFront = evaluatePoseQuality(frameFront, { exerciseType: 'squat' });
      const qualityBack = evaluatePoseQuality(frameBack, { exerciseType: 'squat' });
      assert.equal(qualityFront.issue, qualityBack.issue, 'cameraFacing should not affect quality');
    });

    it('returns ok with actual bodyFillRatio', () => {
      const frame = nativePoseEventToFrame(completeSquatEvent());
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'ok');
      assert.ok(quality.metrics.bodyFillRatio !== null, 'ok should have bodyFillRatio');
      assert.ok(quality.metrics.bodyFillRatio! > 0, 'bodyFillRatio should be positive');
    });

    it('returns exercise-specific guidance for squat', () => {
      const frame = nativePoseEventToFrame(completeSquatEvent());
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'ok');
      assert.ok(quality.guidance.includes('深蹲'), 'squat guidance should mention squat');
    });

    it('returns exercise-specific guidance for push_up', () => {
      const event = completeSquatEvent({
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.95 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.95 },
          { name: 'leftElbow', x: 200, y: 150, confidence: 0.95 },
          { name: 'rightElbow', x: 440, y: 150, confidence: 0.95 },
          { name: 'leftWrist', x: 250, y: 220, confidence: 0.95 },
          { name: 'rightWrist', x: 390, y: 220, confidence: 0.95 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.95 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.95 },
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'push_up' });
      assert.equal(quality.issue, 'ok');
      assert.ok(quality.guidance.includes('俯卧撑'), 'push_up guidance should mention push-up');
    });
  });

  describe('squat classifier on unified PoseFrame', () => {
    it('classifies standing pose correctly', () => {
      const frame = nativePoseEventToFrame(completeSquatEvent());
      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'standing', 'straight legs should be standing');
      assert.equal(result.qualityIssue, 'ok');
    });

    it('classifies squatting pose correctly', () => {
      const frame = nativePoseEventToFrame(completeSquattingEvent(1000));
      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'squatting', 'knees bent forward should be squatting');
      assert.equal(result.qualityIssue, 'ok');
    });

    it('works identically for iOS and Android source', () => {
      const standingIos = nativePoseEventToFrame(completeSquatEvent({ source: 'apple-vision' }));
      const standingAndroid = nativePoseEventToFrame(completeSquatEvent({ source: 'mlkit' }));
      assert.ok(standingIos);
      assert.ok(standingAndroid);
      const resultIos = classifySquatPoseFrame(standingIos);
      const resultAndroid = classifySquatPoseFrame(standingAndroid);
      assert.equal(resultIos.label, resultAndroid.label, 'iOS and Android should classify identically');
      assert.equal(resultIos.qualityIssue, resultAndroid.qualityIssue);
    });

    it('returns unknown for partial body', () => {
      const event = completeSquatEvent({
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'unknown', 'partial body should be unknown');
      assert.equal(result.qualityIssue, 'partial_body');
    });

    it('returns low_confidence for low confidence landmarks', () => {
      const event = completeSquatEvent({
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.3 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.3 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.3 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.3 },
          { name: 'leftKnee', x: 165, y: 380, confidence: 0.3 },
          { name: 'rightKnee', x: 475, y: 380, confidence: 0.3 },
          { name: 'leftAnkle', x: 170, y: 460, confidence: 0.3 },
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.3 },
        ],
      });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'unknown', 'low confidence should be unknown');
      assert.equal(result.qualityIssue, 'low_confidence');
    });
  });

  describe('squat counter integration with unified PoseFrame', () => {
    it('counts squat when using PoseFrame from adapter', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      const f1 = nativePoseEventToFrame(completeStandingEvent(1000));
      const f2 = nativePoseEventToFrame(completeStandingEvent(1100));
      const f3 = nativePoseEventToFrame(completeSquattingEvent(2000));
      const f4 = nativePoseEventToFrame(completeSquattingEvent(2100));
      const f5 = nativePoseEventToFrame(completeStandingEvent(3000));
      const f6 = nativePoseEventToFrame(completeStandingEvent(3100));

      assert.ok(f1 && f2 && f3 && f4 && f5 && f6);

      counter.handleFrame(f1);
      counter.handleFrame(f2);
      counter.handleFrame(f3);
      counter.handleFrame(f4);
      const result = counter.handleFrame(f5);
      assert.equal(result.count, 0, 'should not count until 2 standing frames after squat');
      const result2 = counter.handleFrame(f6);
      assert.equal(result2.count, 1, 'should count after full cycle');
    });

    it('does not count when starting already squatting', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Camera sees squat first
      const f1 = nativePoseEventToFrame(completeSquattingEvent(1000));
      const f2 = nativePoseEventToFrame(completeSquattingEvent(1100));
      // User returns to standing
      const f3 = nativePoseEventToFrame(completeStandingEvent(2000));
      const f4 = nativePoseEventToFrame(completeStandingEvent(2100));

      assert.ok(f1 && f2 && f3 && f4);

      counter.handleFrame(f1);
      counter.handleFrame(f2);
      const standingResult = counter.handleFrame(f3);
      const finalResult = counter.handleFrame(f4);

      assert.equal(standingResult.count, 0, 'should not count when starting in squat');
      assert.equal(finalResult.count, 0, 'should not count on return to standing');
      assert.equal(finalResult.phase, 'ready');
    });

    it('does not count until full standing → squatting → standing cycle', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Start already squatting
      const f1 = nativePoseEventToFrame(completeSquattingEvent(1000));
      const f2 = nativePoseEventToFrame(completeSquattingEvent(1100));
      // Return to standing
      const f3 = nativePoseEventToFrame(completeStandingEvent(2000));
      const f4 = nativePoseEventToFrame(completeStandingEvent(2100));

      assert.ok(f1 && f2 && f3 && f4);

      counter.handleFrame(f1);
      counter.handleFrame(f2);
      counter.handleFrame(f3);
      const result = counter.handleFrame(f4);
      assert.equal(result.count, 0, 'no count yet - needs full cycle');
      assert.equal(result.phase, 'ready');

      // Complete the cycle
      const f5 = nativePoseEventToFrame(completeSquattingEvent(3000));
      const f6 = nativePoseEventToFrame(completeSquattingEvent(3100));
      const f7 = nativePoseEventToFrame(completeStandingEvent(4000));
      const f8 = nativePoseEventToFrame(completeStandingEvent(4100));

      assert.ok(f5 && f6 && f7 && f8);

      counter.handleFrame(f5);
      counter.handleFrame(f6);
      counter.handleFrame(f7);
      const countResult = counter.handleFrame(f8);
      assert.equal(countResult.count, 1, 'should count after full cycle');
    });

    it('counts 5 complete squats', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      for (let i = 0; i < 5; i++) {
        const offset = i * 5000;
        const standing1 = nativePoseEventToFrame(completeStandingEvent(1000 + offset));
        const standing2 = nativePoseEventToFrame(completeStandingEvent(1100 + offset));
        const squatting1 = nativePoseEventToFrame(completeSquattingEvent(2000 + offset));
        const squatting2 = nativePoseEventToFrame(completeSquattingEvent(2100 + offset));
        const standing3 = nativePoseEventToFrame(completeStandingEvent(3000 + offset));
        const standing4 = nativePoseEventToFrame(completeStandingEvent(3100 + offset));

        assert.ok(standing1 && standing2 && squatting1 && squatting2 && standing3 && standing4);

        counter.handleFrame(standing1);
        counter.handleFrame(standing2);
        counter.handleFrame(squatting1);
        counter.handleFrame(squatting2);
        counter.handleFrame(standing3);
        counter.handleFrame(standing4);
      }

      const finalFrame = nativePoseEventToFrame(completeStandingEvent(26000));
      assert.ok(finalFrame, 'should have valid final frame');
      const result = counter.handleFrame(finalFrame);
      assert.equal(result.count, 5, 'should count 5 squats');
      assert.equal(result.isComplete, true);
    });
  });

  describe('resolution independence', () => {
    it('classifier produces same label regardless of image resolution', () => {
      // Standing at 640x480
      const standing640 = nativePoseEventToFrame(completeSquatEvent({
        imageWidth: 640,
        imageHeight: 480,
      }));

      // Same pose at 1280x960 (2x scale)
      const standing1280 = nativePoseEventToFrame(completeSquatEvent({
        imageWidth: 1280,
        imageHeight: 960,
        landmarks: [
          { name: 'leftShoulder', x: 300, y: 160, confidence: 0.95 },
          { name: 'rightShoulder', x: 980, y: 160, confidence: 0.95 },
          { name: 'leftHip', x: 320, y: 560, confidence: 0.95 },
          { name: 'rightHip', x: 960, y: 560, confidence: 0.95 },
          { name: 'leftKnee', x: 330, y: 760, confidence: 0.95 },
          { name: 'rightKnee', x: 950, y: 760, confidence: 0.95 },
          { name: 'leftAnkle', x: 340, y: 920, confidence: 0.95 },
          { name: 'rightAnkle', x: 940, y: 920, confidence: 0.95 },
        ],
      }));

      assert.ok(standing640);
      assert.ok(standing1280);
      const result640 = classifySquatPoseFrame(standing640);
      const result1280 = classifySquatPoseFrame(standing1280);
      assert.equal(result640.label, result1280.label,
        'same geometric pose at different resolutions should have same label');
    });
  });

  describe('camera facing preservation', () => {
    it('preserves front camera facing', () => {
      const event = completeSquatEvent({ cameraFacing: 'front', source: 'apple-vision' });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      assert.equal(frame.cameraFacing, 'front');
    });

    it('preserves back camera facing', () => {
      const event = completeSquatEvent({ cameraFacing: 'back', source: 'mlkit' });
      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      assert.equal(frame.cameraFacing, 'back');
    });
  });
});
