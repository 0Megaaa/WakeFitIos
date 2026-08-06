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
 */
describe('PoseFrame contract consistency', () => {
  describe('nativePoseEventToFrame', () => {
    it('preserves cameraFacing from iOS apple-vision event', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 1000,
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
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
        ],
        cameraFacing: 'front',
        source: 'apple-vision',
      };

      const frame = nativePoseEventToFrame(event);
      assert.ok(frame, 'frame should not be null');
      assert.equal(frame.cameraFacing, 'front');
      assert.equal(frame.source, 'apple-vision');
      assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
      assert.equal(frame.imageWidth, 640);
      assert.equal(frame.imageHeight, 480);
      assert.ok(frame.landmarks.length >= 8, 'should have at least 8 landmarks');
    });

    it('preserves cameraFacing from Android mlkit event', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 2000,
        imageWidth: 480,
        imageHeight: 640,
        landmarks: [
          { name: 'leftShoulder', x: 140, y: 100, confidence: 0.88 },
          { name: 'rightShoulder', x: 340, y: 100, confidence: 0.88 },
          { name: 'leftHip', x: 150, y: 300, confidence: 0.82 },
          { name: 'rightHip', x: 330, y: 300, confidence: 0.82 },
          { name: 'leftKnee', x: 155, y: 420, confidence: 0.78 },
          { name: 'rightKnee', x: 325, y: 420, confidence: 0.78 },
          { name: 'leftAnkle', x: 160, y: 540, confidence: 0.72 },
          { name: 'rightAnkle', x: 320, y: 540, confidence: 0.72 },
        ],
        cameraFacing: 'back',
        source: 'mlkit',
      };

      const frame = nativePoseEventToFrame(event);
      assert.ok(frame, 'frame should not be null');
      assert.equal(frame.cameraFacing, 'back');
      assert.equal(frame.source, 'mlkit');
      assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
    });

    it('rejects landmarks with negative coordinates', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'leftShoulder', x: -10, y: 80, confidence: 0.9 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
        ],
        cameraFacing: 'front',
      };

      const frame = nativePoseEventToFrame(event);
      assert.ok(frame, 'frame should not be null');
      assert.equal(frame.landmarks.length, 1, 'negative x should be rejected');
    });

    it('normalizes landmark names (lowercase, strips non-alpha)', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'LEFT_SHOULDER', x: 150, y: 80, confidence: 0.9 },
          { name: 'RightShoulder', x: 490, y: 80, confidence: 0.9 },
          { name: 'left-hip', x: 160, y: 280, confidence: 0.85 },
        ],
      };

      const frame = nativePoseEventToFrame(event);
      assert.ok(frame, 'frame should not be null');
      assert.equal(frame.landmarks.length, 3, 'all 3 variants should map to valid landmarks');
      assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'leftShoulder'), 'should have leftShoulder');
      assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'rightShoulder'), 'should have rightShoulder');
      assert.ok(frame.landmarks.some((l: { name: string }) => l.name === 'leftHip'), 'should have leftHip');
    });

    it('returns null when no valid landmarks', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 1000,
        landmarks: [
          { name: 'unknownJoint', x: 100, y: 100, confidence: 0.9 },
        ],
      };

      const frame = nativePoseEventToFrame(event);
      assert.equal(frame, null, 'should return null when no valid landmarks');
    });

    it('sets coordinateSpace to upright-top-left-unmirrored', () => {
      const event: NativePoseFrameEvent = {
        timestampMs: 1000,
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
      };

      const frame = nativePoseEventToFrame(event);
      assert.ok(frame);
      assert.equal(frame.coordinateSpace, 'upright-top-left-unmirrored');
    });
  });

  describe('pose quality evaluation on unified PoseFrame', () => {
    it('returns ok for complete confident body in frame', () => {
      const frame = nativePoseEventToFrame({
        timestampMs: 1000,
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
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
        ],
      });

      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'ok', 'full body visible should be ok');
      assert.ok(quality.guidance.length > 0, 'should have guidance text');
    });

    it('returns partial_body for missing landmarks', () => {
      const frame = nativePoseEventToFrame({
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 80, confidence: 0.9 },
          { name: 'rightShoulder', x: 490, y: 80, confidence: 0.9 },
          { name: 'leftHip', x: 160, y: 280, confidence: 0.85 },
          { name: 'rightHip', x: 480, y: 280, confidence: 0.85 },
        ],
      });

      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'partial_body', 'missing knees and ankles');
      assert.ok(quality.metrics.visibleLandmarkCount < quality.metrics.requiredLandmarkCount);
    });

    it('returns low_confidence for low confidence landmarks', () => {
      const frame = nativePoseEventToFrame({
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
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

      assert.ok(frame);
      const quality = evaluatePoseQuality(frame, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'low_confidence', 'all landmarks below minConfidence');
    });

    it('works independently of cameraFacing', () => {
      const frameFront = nativePoseEventToFrame({
        timestampMs: 1000,
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
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
        ],
        cameraFacing: 'front',
      });

      const frameBack = nativePoseEventToFrame({
        timestampMs: 1000,
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
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
        ],
        cameraFacing: 'back',
      });

      assert.ok(frameFront);
      assert.ok(frameBack);
      const qualityFront = evaluatePoseQuality(frameFront, { exerciseType: 'squat' });
      const qualityBack = evaluatePoseQuality(frameBack, { exerciseType: 'squat' });
      assert.equal(qualityFront.issue, qualityBack.issue, 'cameraFacing should not affect quality');
    });
  });

  describe('squat classifier on unified PoseFrame', () => {
    it('classifies standing pose correctly', () => {
      const frame = nativePoseEventToFrame({
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
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
      });

      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'standing', 'straight legs should be standing');
      assert.equal(result.qualityIssue, 'ok');
    });

    it('classifies squatting pose correctly', () => {
      const frame = nativePoseEventToFrame({
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 60, confidence: 0.95 },
          { name: 'rightShoulder', x: 490, y: 60, confidence: 0.95 },
          { name: 'leftHip', x: 200, y: 250, confidence: 0.95 },
          { name: 'rightHip', x: 440, y: 250, confidence: 0.95 },
          { name: 'leftKnee', x: 80, y: 350, confidence: 0.95 },
          { name: 'rightKnee', x: 560, y: 350, confidence: 0.95 },
          { name: 'leftAnkle', x: 170, y: 460, confidence: 0.95 },
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.95 },
        ],
      });

      assert.ok(frame);
      const result = classifySquatPoseFrame(frame);
      assert.equal(result.label, 'squatting', 'knees bent forward should be squatting');
      assert.equal(result.qualityIssue, 'ok');
    });

    it('works identically for iOS and Android source', () => {
      const landmarks = [
        { name: 'leftShoulder', x: 150, y: 80, confidence: 0.95 },
        { name: 'rightShoulder', x: 490, y: 80, confidence: 0.95 },
        { name: 'leftHip', x: 160, y: 280, confidence: 0.95 },
        { name: 'rightHip', x: 480, y: 280, confidence: 0.95 },
        { name: 'leftKnee', x: 165, y: 380, confidence: 0.95 },
        { name: 'rightKnee', x: 475, y: 380, confidence: 0.95 },
        { name: 'leftAnkle', x: 170, y: 460, confidence: 0.95 },
        { name: 'rightAnkle', x: 470, y: 460, confidence: 0.95 },
      ];

      const frameIos = nativePoseEventToFrame({ timestampMs: 1000, landmarks, source: 'apple-vision' });
      const frameAndroid = nativePoseEventToFrame({ timestampMs: 1000, landmarks, source: 'mlkit' });

      assert.ok(frameIos);
      assert.ok(frameAndroid);
      const resultIos = classifySquatPoseFrame(frameIos);
      const resultAndroid = classifySquatPoseFrame(frameAndroid);
      assert.equal(resultIos.label, resultAndroid.label, 'iOS and Android should classify identically');
      assert.equal(resultIos.qualityIssue, resultAndroid.qualityIssue);
    });
  });

  describe('squat counter integration with unified PoseFrame', () => {
    function standingFrame(timestampMs: number) {
      return nativePoseEventToFrame({
        timestampMs,
        imageWidth: 640,
        imageHeight: 480,
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
      });
    }

    function squatFrame(timestampMs: number) {
      return nativePoseEventToFrame({
        timestampMs,
        imageWidth: 640,
        imageHeight: 480,
        landmarks: [
          { name: 'leftShoulder', x: 150, y: 60, confidence: 0.95 },
          { name: 'rightShoulder', x: 490, y: 60, confidence: 0.95 },
          { name: 'leftHip', x: 200, y: 250, confidence: 0.95 },
          { name: 'rightHip', x: 440, y: 250, confidence: 0.95 },
          { name: 'leftKnee', x: 80, y: 350, confidence: 0.95 },
          { name: 'rightKnee', x: 560, y: 350, confidence: 0.95 },
          { name: 'leftAnkle', x: 170, y: 460, confidence: 0.95 },
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.95 },
        ],
      });
    }

    it('counts squat when using PoseFrame from adapter', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      const f1 = standingFrame(1000);
      const f2 = standingFrame(1100);
      const f3 = squatFrame(2000);
      const f4 = squatFrame(2100);
      const f5 = standingFrame(3000);
      const f6 = standingFrame(3100);

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

    it('uses cameraFacing to provide guidance', () => {
      const frameFront = nativePoseEventToFrame({
        timestampMs: 1000,
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
          { name: 'rightAnkle', x: 470, y: 460, confidence: 0.75 },
        ],
        cameraFacing: 'front',
      });

      const quality = evaluatePoseQuality(frameFront!, { exerciseType: 'squat' });
      assert.equal(quality.issue, 'ok', 'front camera with full body should be ok');
    });
  });

  describe('resolution independence', () => {
    it('classifier produces same label regardless of image resolution', () => {
      const standing640 = nativePoseEventToFrame({
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 480,
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
      });

      const standing1280 = nativePoseEventToFrame({
        timestampMs: 1000,
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
      });

      assert.ok(standing640);
      assert.ok(standing1280);
      const result640 = classifySquatPoseFrame(standing640);
      const result1280 = classifySquatPoseFrame(standing1280);
      assert.equal(result640.label, result1280.label, 'same geometric pose at different resolutions should have same label');
    });
  });
});
