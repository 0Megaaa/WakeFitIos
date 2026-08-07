import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSquatCounter, type PoseFrame, type PoseLandmarkName } from './pushupCounter.ts';
import { classifySquatPoseFrame, THRESHOLDS } from './squatPoseClassifier.ts';
import { evaluatePoseQuality } from './poseQuality.ts';

function landmark(name: PoseLandmarkName, x: number, y: number, confidence = 0.95) {
  return { name, x, y, confidence };
}

/**
 * Test fixtures for squat counter with proper geometry.
 *
 * Coordinates are in upright-top-left-unmirrored space (pixels).
 *
 * Standing pose:
 * - Shoulders at y=100, centered at x=150
 * - Hips at y=240
 * - Knees aligned with hips at x=150, y=400 (straight line)
 * - Ankles at y=560
 * - Torso size = 140px
 * - Knee angle ~180° (straight line)
 *
 * Squatting pose:
 * - Shoulders at y=160 (drop with hip)
 * - Hips at y=300
 * - Knees at x=0/300, y=400 (knees very forward)
 * - Ankles at y=560
 * - Torso size = 140px (same as standing!)
 * - Knee angle ~80° (clear squat)
 * - Hip angle ~119° (below threshold)
 * - hipDropRatio = 60/140 ≈ 0.43 > 0.05 (valid)
 * - scaleChangeRatio = 0 (torso same size)
 */
function fullBodyFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
  source: 'apple-vision' | 'mlkit' = 'mlkit',
): PoseFrame {
  const lowerBody = pose === 'standing'
    ? {
        // Standing: straight line hip(150,240) → knee(150,400) → ankle(150,560)
        leftHip: { x: 150, y: 240 },
        rightHip: { x: 150, y: 240 },
        leftKnee: { x: 150, y: 400 },
        rightKnee: { x: 150, y: 400 },
        leftAnkle: { x: 150, y: 560 },
        rightAnkle: { x: 150, y: 560 },
      }
    : {
        // Squat: shoulder drops with hip, knees very forward
        // Torso stays same size, only hip angle changes
        leftHip: { x: 150, y: 300 },
        rightHip: { x: 150, y: 300 },
        leftKnee: { x: 0, y: 400 },
        rightKnee: { x: 300, y: 400 },
        leftAnkle: { x: 150, y: 560 },
        rightAnkle: { x: 150, y: 560 },
      };

  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Standing: shoulders at y=100, Squat: shoulders at y=160 (drop with hip)
      landmark('leftShoulder', 140, pose === 'standing' ? 100 : 160, confidence),
      landmark('rightShoulder', 160, pose === 'standing' ? 100 : 160, confidence),
      landmark('leftHip', lowerBody.leftHip.x, lowerBody.leftHip.y, confidence),
      landmark('rightHip', lowerBody.rightHip.x, lowerBody.rightHip.y, confidence),
      landmark('leftKnee', lowerBody.leftKnee.x, lowerBody.leftKnee.y, confidence),
      landmark('rightKnee', lowerBody.rightKnee.x, lowerBody.rightKnee.y, confidence),
      landmark('leftAnkle', lowerBody.leftAnkle.x, lowerBody.leftAnkle.y, confidence),
      landmark('rightAnkle', lowerBody.rightAnkle.x, lowerBody.rightAnkle.y, confidence),
    ],
  };
}

/**
 * Shortcut for creating Apple Vision frames (source='apple-vision').
 */
function appleVisionFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  return fullBodyFrame(pose, timestampMs, confidence, 'apple-vision');
}

/**
 * Shortcut for creating ML Kit frames (source='mlkit').
 */
function mlkitFrame(
  pose: 'standing' | 'squatting',
  timestampMs: number,
  confidence = 0.95,
): PoseFrame {
  return fullBodyFrame(pose, timestampMs, confidence, 'mlkit');
}

/**
 * Creates a partial-body frame (only upper body landmarks).
 * Used to simulate when the user's lower body leaves the camera frame.
 */
function partialBodyFrame(timestampMs: number, confidence = 0.95, source: 'apple-vision' | 'mlkit' = 'mlkit'): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Only upper body — no hip, knee, or ankle landmarks.
      // This mimics the ML Kit output when the lower body is out of frame.
      landmark('leftShoulder', 140, 160, confidence),
      landmark('rightShoulder', 160, 160, confidence),
      landmark('leftElbow', 110, 220, confidence),
      landmark('rightElbow', 190, 220, confidence),
    ],
  };
}

/**
 * Creates a transition frame (partial squat, label = unknown).
 * The person is in a mid-motion state where the classifier cannot
 * confidently label as 'standing' or 'squatting'.
 *
 * Geometry: person is leaning with one knee forward and one knee back,
 * producing an asymmetric pose with kneeAngleDifference > MAX_KNEE_ASYMMETRY (30°).
 * This forces the classifier to return 'unknown'.
 */
function transitionFrame(timestampMs: number, progress: number, source: 'apple-vision' | 'mlkit' = 'mlkit'): PoseFrame {
  // progress: 0 = just starting, 1 = almost full squat
  // Use asymmetric knees with both knees partially bent (in transition zone 120-160°)
  const hipY = 240 + progress * 60;
  const shoulderY = 100 + progress * 60;
  // Left knee bends more (forward), right knee stays more vertical
  // Both should be in transition zone (knee angle 120-160°)
  const leftKneeOffset = 50 + progress * 30; // 50-80 forward
  const rightKneeOffset = 10 - progress * 5; // ~10 forward
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      landmark('leftShoulder', 140, shoulderY),
      landmark('rightShoulder', 160, shoulderY),
      landmark('leftHip', 150, hipY),
      landmark('rightHip', 150, hipY),
      // Asymmetric: left knee forward (bent), right knee straight
      // This forces kneeAngleDifference > MAX_KNEE_ASYMMETRY (30°)
      landmark('leftKnee', 150 - leftKneeOffset, 400 + progress * 10),
      landmark('rightKnee', 150 + rightKneeOffset, 400 + progress * 10),
      landmark('leftAnkle', 150 - 20, 560), // ankle offset matches knee
      landmark('rightAnkle', 150 + 5, 560),
    ],
  };
}

/**
 * Creates a lunge pose (asymmetric knee angles).
 */
function lungeFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Asymmetric lunge - left knee bent, right knee straight
      landmark('leftShoulder', 140, 100),
      landmark('rightShoulder', 160, 100),
      landmark('leftHip', 150, 240),
      landmark('rightHip', 150, 240),
      // Left knee bent (forward lunge), right knee straight
      landmark('leftKnee', 80, 380), // Knee bent forward
      landmark('rightKnee', 150, 400), // Knee straight
      landmark('leftAnkle', 150, 560),
      landmark('rightAnkle', 150, 560),
    ],
  };
}

/**
 * Creates a scale-change frame (camera moved, not actual squat).
 * Person walked much closer to the camera - torso is 2x larger (~280px vs 140px standing).
 * All landmarks still within image bounds, no quality issue, but the scale
 * change ratio exceeds THRESHOLDS.MAX_SCALE_CHANGE_RATIO so the classifier
 * must reject this frame as 'unknown' rather than 'squatting'.
 */
function scaleChangeFrame(timestampMs: number, source: 'apple-vision' | 'mlkit' = 'mlkit'): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Person moved much closer - torso appears 2x larger
      // Standing baseline: torso 140px (shoulder y=100, hip y=240)
      // Scale frame: torso 280px (shoulder y=50, hip y=190, hip y goes 50+140*2=330)
      // Actually hip must remain near 240 to keep the pose shape, but scale grows:
      // - shoulder y=20, hip y=300 (torso 280px = 2x standing)
      // Wait: scaleChangeRatio uses (currentScale - baselineScale)/baselineScale
      // If standing scale = 140 (torso) and current scale = 280 (torso), ratio = 1.0
      // That's >> MAX_SCALE_CHANGE_RATIO (0.30) → rejected.
      // Note: Knees must be bent to avoid passing the "standing" check first
      landmark('leftShoulder', 140, 20, 0.95),
      landmark('rightShoulder', 160, 20, 0.95),
      landmark('leftHip', 150, 300, 0.95), // Torso 280px = 2x scale
      landmark('rightHip', 150, 300, 0.95),
      // Knees bent forward to prevent standing check from passing
      landmark('leftKnee', 80, 440, 0.95), // Bent forward
      landmark('rightKnee', 220, 440, 0.95), // Bent forward
      landmark('leftAnkle', 150, 580, 0.95),
      landmark('rightAnkle', 150, 580, 0.95),
    ],
  };
}

/**
 * Creates a no-hip-drop frame (only knees bent).
 */
function noHipDropFrame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source: 'apple-vision',
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Knees bent but hip stays at same Y (no hip drop)
      landmark('leftShoulder', 140, 100),
      landmark('rightShoulder', 160, 100),
      // Hip stays at 240 (same as standing)
      landmark('leftHip', 150, 240),
      landmark('rightHip', 150, 240),
      // Knees bent forward but hip at same level
      landmark('leftKnee', 80, 380),
      landmark('rightKnee', 220, 380),
      landmark('leftAnkle', 150, 560),
      landmark('rightAnkle', 150, 560),
    ],
  };
}

/**
 * Creates a hip-drop but bad-hip-angle frame.
 */
function badHipAngleFrame(timestampMs: number, source: 'apple-vision' | 'mlkit' = 'mlkit'): PoseFrame {
  return {
    timestampMs,
    imageWidth: 300,
    imageHeight: 640,
    cameraFacing: 'front',
    source,
    coordinateSpace: 'upright-top-left-unmirrored',
    landmarks: [
      // Hip drops but angle is wrong
      landmark('leftShoulder', 140, 160), // Shoulder dropped
      landmark('rightShoulder', 160, 160),
      // Hip dropped but spread wide (bad hip angle)
      landmark('leftHip', 100, 300), // Hip spread
      landmark('rightHip', 200, 300), // Hip spread
      // Knees bent
      landmark('leftKnee', 50, 380),
      landmark('rightKnee', 250, 380),
      landmark('leftAnkle', 150, 560),
      landmark('rightAnkle', 150, 560),
    ],
  };
}

describe('squat counter', () => {
  it('starts in waiting_for_body phase', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    const result = counter.handleFrame(fullBodyFrame('standing', 1000));
    assert.equal(result.phase, 'waiting_for_body');
    assert.equal(result.count, 0);
  });

  it('moves to ready after stable standing frames (minimum 3 samples)', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // First three frames establish baseline
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    // Third frame with enough baseline samples and stable frames
    const result = counter.handleFrame(fullBodyFrame('standing', 1200));
    assert.equal(result.phase, 'ready');
    assert.equal(result.isPoseReady, true);
  });

  it('stays in waiting if not enough stable frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Only 2 standing frames - not enough baseline samples (need 3)
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    // Then squat frame arrives - should stay waiting
    const result = counter.handleFrame(fullBodyFrame('squatting', 1200));
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('does not count when starting already squatting', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Camera sees squat first
    counter.handleFrame(fullBodyFrame('squatting', 1000));
    counter.handleFrame(fullBodyFrame('squatting', 1100));
    // User returns to standing
    counter.handleFrame(fullBodyFrame('standing', 2000));
    counter.handleFrame(fullBodyFrame('standing', 2100));
    const finalResult = counter.handleFrame(fullBodyFrame('standing', 2200));
    assert.equal(finalResult.count, 0, 'should not count when starting in squat');
    assert.equal(finalResult.phase, 'ready');
  });

  it('counts after full standing → squatting → standing cycle', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Establish baseline with stable standing
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    // Move to ready
    let result = counter.handleFrame(fullBodyFrame('standing', 1300));
    assert.equal(result.phase, 'ready');

    // Squat down (need 3+ stable frames)
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('squatting', 2200));
    result = counter.handleFrame(fullBodyFrame('squatting', 2300));
    assert.equal(result.phase, 'down');

    // Return to standing (need 3+ stable frames)
    counter.handleFrame(fullBodyFrame('standing', 3000));
    counter.handleFrame(fullBodyFrame('standing', 3100));
    result = counter.handleFrame(fullBodyFrame('standing', 3200));
    assert.equal(result.count, 1, 'should count after full cycle');
    assert.equal(result.phase, 'ready');
  });

  it('does not count if squat then returns to waiting without completing', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Establish baseline
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    // Squat briefly
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    // Go back to standing
    const result = counter.handleFrame(fullBodyFrame('standing', 3000));
    assert.equal(result.count, 0, 'no count without returning to ready first');
  });

  it('counts 5 complete squats', () => {
    const counter = createSquatCounter({ targetCount: 5 });

    for (let i = 0; i < 5; i++) {
      const offset = i * 5000;
      // Establish baseline with stable standing (3 frames)
      counter.handleFrame(fullBodyFrame('standing', 1000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 1100 + offset));
      counter.handleFrame(fullBodyFrame('standing', 1200 + offset));
      // Move to ready
      counter.handleFrame(fullBodyFrame('standing', 1300 + offset));
      // Squat (3 frames for stable)
      counter.handleFrame(fullBodyFrame('squatting', 2000 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2100 + offset));
      counter.handleFrame(fullBodyFrame('squatting', 2200 + offset));
      // Return to standing (3 frames for stable)
      counter.handleFrame(fullBodyFrame('standing', 3000 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3100 + offset));
      counter.handleFrame(fullBodyFrame('standing', 3200 + offset));
    }

    const result = counter.handleFrame(fullBodyFrame('standing', 26000));
    assert.equal(result.count, 5, 'should count 5 squats');
    assert.equal(result.isComplete, true);
  });

  it('does not count single squat frame', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    counter.handleFrame(fullBodyFrame('standing', 1300));
    const result = counter.handleFrame(fullBodyFrame('squatting', 2000));
    assert.equal(result.count, 0, 'should not count single squat frame');
  });

  it('ignores partial body frames', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    const partialFrame: PoseFrame = {
      timestampMs: 1000,
      imageWidth: 300,
      imageHeight: 640,
      cameraFacing: 'front',
      source: 'apple-vision',
      coordinateSpace: 'upright-top-left-unmirrored',
      landmarks: [
        landmark('leftShoulder', 140, 100, 0.95),
        landmark('rightShoulder', 160, 100, 0.95),
        // Missing hips, knees, ankles
      ],
    };
    const result = counter.handleFrame(partialFrame);
    assert.equal(result.isPoseReady, false);
    assert.equal(result.phase, 'waiting_for_body');
  });

  it('reset clears count and phase', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Do one complete squat
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    counter.handleFrame(fullBodyFrame('standing', 1300));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('squatting', 2200));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    counter.handleFrame(fullBodyFrame('standing', 3100));
    const result = counter.handleFrame(fullBodyFrame('standing', 3200));
    assert.equal(result.count, 1);

    // Reset
    const resetResult = counter.reset();
    assert.equal(resetResult.count, 0);
    assert.equal(resetResult.phase, 'waiting_for_body');
  });

  it('resetTrackingStatePreservingCount preserves count', () => {
    const counter = createSquatCounter({ targetCount: 5 });
    // Do one complete squat
    counter.handleFrame(fullBodyFrame('standing', 1000));
    counter.handleFrame(fullBodyFrame('standing', 1100));
    counter.handleFrame(fullBodyFrame('standing', 1200));
    counter.handleFrame(fullBodyFrame('standing', 1300));
    counter.handleFrame(fullBodyFrame('squatting', 2000));
    counter.handleFrame(fullBodyFrame('squatting', 2100));
    counter.handleFrame(fullBodyFrame('squatting', 2200));
    counter.handleFrame(fullBodyFrame('standing', 3000));
    counter.handleFrame(fullBodyFrame('standing', 3100));
    const result = counter.handleFrame(fullBodyFrame('standing', 3200));
    assert.equal(result.count, 1);

    // Reset tracking state but preserve count
    const resetResult = counter.resetTrackingStatePreservingCount();
    assert.equal(resetResult.count, 1, 'count should be preserved');
    assert.equal(resetResult.phase, 'waiting_for_body', 'phase should reset');

    // Continue - need to re-establish baseline
    counter.handleFrame(fullBodyFrame('standing', 4000));
    counter.handleFrame(fullBodyFrame('standing', 4100));
    const continueResult = counter.handleFrame(fullBodyFrame('standing', 4200));
    assert.equal(continueResult.phase, 'ready', 'should be ready after baseline');
  });

  describe('transition frame handling', () => {
    it('allows transition frames without clearing baseline', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      let result = counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Transition frames should NOT clear baseline or reset to waiting
      counter.handleFrame(transitionFrame(2000, 0.3));
      counter.handleFrame(transitionFrame(2100, 0.5));
      result = counter.handleFrame(transitionFrame(2200, 0.7));

      // Should still be ready or down, not waiting_for_body
      assert.ok(result.phase === 'ready' || result.phase === 'down', 'should not reset to waiting_for_body');
      assert.equal(result.count, 0, 'should not count during transition');
    });

    it('completes squat after transition sequence', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // Transition frames
      counter.handleFrame(transitionFrame(2000, 0.3));
      counter.handleFrame(transitionFrame(2100, 0.5));
      counter.handleFrame(transitionFrame(2200, 0.7));
      counter.handleFrame(transitionFrame(2300, 0.9));

      // Squat down (need stable frames)
      counter.handleFrame(fullBodyFrame('squatting', 3000));
      counter.handleFrame(fullBodyFrame('squatting', 3100));
      let result = counter.handleFrame(fullBodyFrame('squatting', 3200));
      assert.equal(result.phase, 'down');

      // Transition back
      counter.handleFrame(transitionFrame(4000, 0.8));
      counter.handleFrame(transitionFrame(4100, 0.5));
      counter.handleFrame(transitionFrame(4200, 0.3));

      // Return to standing (3 stable frames needed)
      counter.handleFrame(fullBodyFrame('standing', 5000));
      counter.handleFrame(fullBodyFrame('standing', 5100));
      result = counter.handleFrame(fullBodyFrame('standing', 5200));
      assert.equal(result.count, 1, 'should count after full sequence with transitions');
    });

    it('times out after 2 seconds of transition without reaching valid pose', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // Transition frames spaced out over 2.5 seconds
      // These have asymmetric knee angles (lunge-like), so classifier returns 'unknown'
      counter.handleFrame(transitionFrame(2000, 0.3));
      counter.handleFrame(transitionFrame(2500, 0.4));
      counter.handleFrame(transitionFrame(3000, 0.5));
      counter.handleFrame(transitionFrame(3500, 0.6));
      counter.handleFrame(transitionFrame(4000, 0.7));
      counter.handleFrame(transitionFrame(4500, 0.8));

      // Should timeout after 2 seconds
      const result = counter.handleFrame(transitionFrame(4600, 0.9));
      assert.equal(result.phase, 'waiting_for_body', 'should timeout and reset to waiting');
      assert.equal(result.count, 0, 'count should not increase');
    });

    it('completes a 1.5-second transition squat sequence', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // 1.5 second transition down (~30 frames at 50ms)
      for (let i = 0; i < 30; i++) {
        const progress = (i + 1) / 30;
        counter.handleFrame(transitionFrame(2000 + i * 50, progress));
      }

      // 3 squatting frames
      counter.handleFrame(fullBodyFrame('squatting', 3500));
      counter.handleFrame(fullBodyFrame('squatting', 3600));
      counter.handleFrame(fullBodyFrame('squatting', 3700));

      // 1.5 second transition back up
      for (let i = 0; i < 30; i++) {
        const progress = 1 - (i + 1) / 30;
        counter.handleFrame(transitionFrame(4000 + i * 50, progress));
      }

      // 3 returned standing frames
      counter.handleFrame(fullBodyFrame('standing', 5500));
      counter.handleFrame(fullBodyFrame('standing', 5600));
      const result = counter.handleFrame(fullBodyFrame('standing', 5700));
      assert.equal(result.count, 1, 'should count after full sequence with 1.5s transitions');
    });

    it('times out after 3-second slow transition without reaching valid pose', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // 3-second slow transition (~60 frames at 50ms)
      // This exceeds MAX_TRANSITION_DURATION_MS (2000ms) - should timeout
      for (let i = 0; i < 60; i++) {
        const progress = (i + 1) / 60;
        const result = counter.handleFrame(transitionFrame(2000 + i * 50, progress));
        if (result.phase === 'waiting_for_body') {
          assert.equal(result.count, 0, 'count must remain 0 after timeout');
          return;
        }
      }
      assert.fail('3-second slow transition must trigger timeout');
    });
  });

  describe('misclassification rejection', () => {
    it('rejects lunge (asymmetric knee angles)', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // Lunge frames should not trigger down
      counter.handleFrame(lungeFrame(2000));
      counter.handleFrame(lungeFrame(2100));
      counter.handleFrame(lungeFrame(2200));
      counter.handleFrame(lungeFrame(2300));
      counter.handleFrame(lungeFrame(2400));

      const result = counter.handleFrame(lungeFrame(2500));
      assert.equal(result.count, 0, 'lunge should not be counted');
      assert.ok(result.phase === 'ready' || result.phase === 'waiting_for_body', 'should not be in down phase');
    });

    it('rejects scale change (camera movement)', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with ML Kit to use strict behavior
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(counter.handleFrame(mlkitFrame('standing', 1400)).phase, 'ready');

      // Scale change frames should not trigger down (use ML Kit for strict behavior)
      counter.handleFrame(scaleChangeFrame(2000, 'mlkit'));
      counter.handleFrame(scaleChangeFrame(2100, 'mlkit'));
      counter.handleFrame(scaleChangeFrame(2200, 'mlkit'));
      counter.handleFrame(scaleChangeFrame(2300, 'mlkit'));
      counter.handleFrame(scaleChangeFrame(2400, 'mlkit'));

      const result = counter.handleFrame(scaleChangeFrame(2500, 'mlkit'));
      assert.equal(result.count, 0, 'scale change should not be counted');
      assert.ok(result.phase === 'ready', 'should stay in ready phase');
    });

    it('scale change frame produces metrics.scaleChangeRatio > MAX_SCALE_CHANGE_RATIO', () => {
      // Establish baseline first by classifying a standing frame (ML Kit source)
      const standingFrame = mlkitFrame('standing', 1000);
      const standingResult = classifySquatPoseFrame(standingFrame);
      assert.equal(standingResult.label, 'standing', 'baseline standing frame should classify as standing');
      assert.ok(standingResult.metrics, 'baseline standing frame must have metrics');

      // Now classify the scale change frame with explicit baseline (ML Kit source)
      const scaleFrame = scaleChangeFrame(2000, 'mlkit');
      const result = classifySquatPoseFrame(scaleFrame, {
        standingBaselineHipY: standingResult.metrics!.midHipY,
        standingBaselineScale: standingResult.metrics!.poseScale,
      });
      assert.equal(result.qualityIssue, 'ok', 'scale change frame itself should not have quality issue');
      assert.ok(result.metrics, 'scale change frame should have metrics');
      assert.ok(
        result.metrics!.scaleChangeRatio > THRESHOLDS.MAX_SCALE_CHANGE_RATIO,
        `expected scaleChangeRatio > MAX_SCALE_CHANGE_RATIO (${THRESHOLDS.MAX_SCALE_CHANGE_RATIO}), got ${result.metrics!.scaleChangeRatio}`,
      );
      assert.equal(result.label, 'unknown', 'classifier must reject scale change');
    });

    it('rejects no-hip-drop pose', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // No hip drop frames should not trigger down
      counter.handleFrame(noHipDropFrame(2000));
      counter.handleFrame(noHipDropFrame(2100));
      counter.handleFrame(noHipDropFrame(2200));
      counter.handleFrame(noHipDropFrame(2300));
      counter.handleFrame(noHipDropFrame(2400));

      const result = counter.handleFrame(noHipDropFrame(2500));
      assert.equal(result.count, 0, 'no hip drop should not be counted');
      assert.ok(result.phase === 'ready', 'should stay in ready phase');
    });

    it('rejects bad hip angle despite hip drop', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with ML Kit to use strict behavior
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(counter.handleFrame(mlkitFrame('standing', 1400)).phase, 'ready');

      // Bad hip angle frames should not trigger down (use ML Kit)
      counter.handleFrame(badHipAngleFrame(2000, 'mlkit'));
      counter.handleFrame(badHipAngleFrame(2100, 'mlkit'));
      counter.handleFrame(badHipAngleFrame(2200, 'mlkit'));
      counter.handleFrame(badHipAngleFrame(2300, 'mlkit'));
      counter.handleFrame(badHipAngleFrame(2400, 'mlkit'));

      const result = counter.handleFrame(badHipAngleFrame(2500, 'mlkit'));
      assert.equal(result.count, 0, 'bad hip angle should not be counted');
    });

    it('rejects single instant squat frame', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // Single squat frame
      const result = counter.handleFrame(fullBodyFrame('squatting', 2000));
      assert.equal(result.count, 0, 'single squat frame should not be counted');
      assert.equal(result.phase, 'ready', 'should stay in ready');
    });
  });

  describe('camera switch handling', () => {
    it('preserves count when camera switches but resets baseline', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline and do one squat
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      counter.handleFrame(fullBodyFrame('squatting', 2000));
      counter.handleFrame(fullBodyFrame('squatting', 2100));
      counter.handleFrame(fullBodyFrame('squatting', 2200));
      counter.handleFrame(fullBodyFrame('standing', 3000));
      counter.handleFrame(fullBodyFrame('standing', 3100));
      let result = counter.handleFrame(fullBodyFrame('standing', 3200));
      assert.equal(result.count, 1, 'should have counted one squat');
      assert.equal(result.phase, 'ready');

      // Simulate camera switch by resetting tracking state
      counter.resetTrackingStatePreservingCount();

      // New camera session - need to re-establish baseline (3 stable frames)
      counter.handleFrame(fullBodyFrame('standing', 4000));
      counter.handleFrame(fullBodyFrame('standing', 4100));
      counter.handleFrame(fullBodyFrame('standing', 4200));
      result = counter.handleFrame(fullBodyFrame('standing', 4300));
      assert.equal(result.phase, 'ready');
      assert.equal(result.count, 1, 'count should be preserved');
    });
  });

  describe('long invalid pose timeout', () => {
    it('resets an unfinished squat after pose is invalid for more than 700ms', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Step 1: standing × 3 → enter ready
      counter.handleFrame(fullBodyFrame('standing', 1000));
      counter.handleFrame(fullBodyFrame('standing', 1100));
      counter.handleFrame(fullBodyFrame('standing', 1200));
      counter.handleFrame(fullBodyFrame('standing', 1300));
      assert.equal(counter.handleFrame(fullBodyFrame('standing', 1400)).phase, 'ready');

      // Step 2: squatting × 3 → enter down
      counter.handleFrame(fullBodyFrame('squatting', 2000));
      counter.handleFrame(fullBodyFrame('squatting', 2100));
      const afterDown = counter.handleFrame(fullBodyFrame('squatting', 2200));
      assert.equal(afterDown.phase, 'down');

      // Step 3: partial_body at t=3000 (only 800ms since last squat frame)
      counter.handleFrame(partialBodyFrame(3000));

      // Step 4: partial_body at t=3800 — 800ms gap exceeds the 700ms threshold.
      // The counter resets to waiting_for_body and clears the baseline.
      const afterTimeout = counter.handleFrame(partialBodyFrame(3800));
      assert.equal(afterTimeout.phase, 'waiting_for_body', 'should return to waiting after 700ms timeout');
      assert.equal(afterTimeout.count, 0, 'should not count an unfinished squat');

      // Step 5: standing × 4 → re-establish baseline → enter ready
      counter.handleFrame(fullBodyFrame('standing', 4000));
      counter.handleFrame(fullBodyFrame('standing', 4100));
      counter.handleFrame(fullBodyFrame('standing', 4200));
      const finalResult = counter.handleFrame(fullBodyFrame('standing', 4300));

      assert.equal(finalResult.count, 0, 'count must remain 0');
      assert.equal(finalResult.phase, 'ready', 'phase must be ready after re-establishing baseline');
    });
  });

  // ============================================================
  // APPLE VISION RELAXED RULES TESTS (Task V1.6)
  // ============================================================

  describe('apple-vision squat counting (relaxed: count on squat)', () => {
    it('does NOT count when starting already squatting', () => {
      const counter = createSquatCounter({ targetCount: 5 });
      // Camera sees squat first (no baseline established)
      counter.handleFrame(appleVisionFrame('squatting', 1000));
      counter.handleFrame(appleVisionFrame('squatting', 1100));
      // User returns to standing
      counter.handleFrame(appleVisionFrame('standing', 2000));
      counter.handleFrame(appleVisionFrame('standing', 2100));
      counter.handleFrame(appleVisionFrame('standing', 2200));
      const finalResult = counter.handleFrame(appleVisionFrame('standing', 2300));
      assert.equal(finalResult.count, 0, 'should not count when starting in squat');
      assert.equal(finalResult.phase, 'ready');
    });

    it('counts immediately when squatting is detected (not after standing)', () => {
      const counter = createSquatCounter({ targetCount: 5 });
      // Establish baseline with stable standing
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      let result = counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Squat down - Apple Vision only needs 2 frames for stable
      counter.handleFrame(appleVisionFrame('squatting', 2000));
      result = counter.handleFrame(appleVisionFrame('squatting', 2100));

      // With relaxed rules: count +1 immediately on squatting detection
      assert.equal(result.count, 1, 'should count on squat, not after standing');
      assert.equal(result.phase, 'down');
    });

    it('does NOT count repeatedly while staying in squat', () => {
      const counter = createSquatCounter({ targetCount: 5 });
      // Establish baseline
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(counter.handleFrame(appleVisionFrame('standing', 1400)).phase, 'ready');

      // Squat down
      counter.handleFrame(appleVisionFrame('squatting', 2000));
      counter.handleFrame(appleVisionFrame('squatting', 2100));
      let result = counter.handleFrame(appleVisionFrame('squatting', 2200));
      assert.equal(result.count, 1, 'first squat should count');

      // Stay in squat - count must NOT increase
      result = counter.handleFrame(appleVisionFrame('squatting', 3000));
      assert.equal(result.count, 1, 'should NOT count while staying in squat');
      result = counter.handleFrame(appleVisionFrame('squatting', 3100));
      assert.equal(result.count, 1, 'should NOT count while staying in squat');
      result = counter.handleFrame(appleVisionFrame('squatting', 3200));
      assert.equal(result.count, 1, 'should NOT count while staying in squat');
    });

    it('allows second count after re-standing', () => {
      const counter = createSquatCounter({ targetCount: 5 });
      // First squat
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      counter.handleFrame(appleVisionFrame('standing', 1300));
      counter.handleFrame(appleVisionFrame('squatting', 2000));
      counter.handleFrame(appleVisionFrame('squatting', 2100));
      let result = counter.handleFrame(appleVisionFrame('squatting', 2200));
      assert.equal(result.count, 1, 'first squat should count');

      // Return to standing - unlocks next count
      counter.handleFrame(appleVisionFrame('standing', 3000));
      result = counter.handleFrame(appleVisionFrame('standing', 3100));
      assert.equal(result.phase, 'ready', 'should be ready after standing');

      // Second squat
      counter.handleFrame(appleVisionFrame('squatting', 4000));
      result = counter.handleFrame(appleVisionFrame('squatting', 4100));
      assert.equal(result.count, 2, 'second squat should count after re-standing');
    });

    it('counts 5 squats with relaxed rules', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      for (let i = 0; i < 5; i++) {
        const offset = i * 5000;
        // Establish baseline with stable standing
        counter.handleFrame(appleVisionFrame('standing', 1000 + offset));
        counter.handleFrame(appleVisionFrame('standing', 1100 + offset));
        counter.handleFrame(appleVisionFrame('standing', 1200 + offset));
        counter.handleFrame(appleVisionFrame('standing', 1300 + offset));

        // Squat - count immediately on detection (Apple Vision 2 frames)
        counter.handleFrame(appleVisionFrame('squatting', 2000 + offset));
        let result = counter.handleFrame(appleVisionFrame('squatting', 2100 + offset));
        assert.equal(result.count, i + 1, `squat ${i + 1} should count`);

        // Return to standing - unlocks next
        counter.handleFrame(appleVisionFrame('standing', 3000 + offset));
        result = counter.handleFrame(appleVisionFrame('standing', 3100 + offset));
        assert.equal(result.phase, 'ready');
      }

      const finalResult = counter.handleFrame(appleVisionFrame('standing', 26000));
      assert.equal(finalResult.count, 5, 'should count 5 squats');
      assert.equal(finalResult.isComplete, true);
    });
  });

  describe('apple-vision bodyFillRatio squat exemption', () => {
    it('does NOT return too_far when bodyFillRatio drops below 0.32 during squat', () => {
      // Create squat frame with TRUE bodyFillRatio < 0.32
      // Using imageHeight=1200 to ensure fillRatio < 0.32
      // Standing: minY=50, maxY=430, fillRatio=380/1200=0.317
      // Squat: minY=100, maxY=350, fillRatio=250/1200=0.208 < 0.32
      const squatFrameLowFill: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 640,
        imageHeight: 1200, // Larger image height to make ratio smaller
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // minY=100 (shoulders), maxY=350 (ankles), fillRatio=250/1200=0.208 < 0.32
          landmark('leftShoulder', 300, 100, 0.95),
          landmark('rightShoulder', 340, 100, 0.95),
          landmark('leftHip', 310, 200, 0.95),
          landmark('rightHip', 330, 200, 0.95),
          landmark('leftKnee', 280, 300, 0.95),
          landmark('rightKnee', 360, 300, 0.95),
          landmark('leftAnkle', 320, 350, 0.95),
          landmark('rightAnkle', 320, 350, 0.95),
        ],
      };

      // First establish baseline with standing frame
      const standingFrame: PoseFrame = {
        timestampMs: 1000,
        imageWidth: 640,
        imageHeight: 1200,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // minY=50 (shoulders), maxY=430 (ankles), fillRatio=380/1200=0.317 < 0.32
          // This standing frame is also below threshold but should still establish baseline
          landmark('leftShoulder', 300, 50, 0.95),
          landmark('rightShoulder', 340, 50, 0.95),
          landmark('leftHip', 310, 150, 0.95),
          landmark('rightHip', 330, 150, 0.95),
          landmark('leftKnee', 310, 300, 0.95),
          landmark('rightKnee', 330, 300, 0.95),
          landmark('leftAnkle', 310, 430, 0.95),
          landmark('rightAnkle', 330, 430, 0.95),
        ],
      };

      // Verify the math: squat frame has bodyFillRatio < 0.32
      const squatQuality = evaluatePoseQuality(squatFrameLowFill, { exerciseType: 'squat' });
      assert.ok(squatQuality.metrics.bodyFillRatio !== null, 'should have bodyFillRatio');
      assert.ok(squatQuality.metrics.bodyFillRatio! < 0.32,
        `squat frame bodyFillRatio (${squatQuality.metrics.bodyFillRatio}) should be < 0.32`);

      // ML Kit should return too_far for this low fill ratio
      const mlkitFrame = { ...squatFrameLowFill, source: 'mlkit' as const };
      const mlkitQuality = evaluatePoseQuality(mlkitFrame, { exerciseType: 'squat' });
      assert.equal(mlkitQuality.issue, 'too_far',
        'ML Kit should return too_far for bodyFillRatio < 0.32');

      // Apple Vision squat should NOT return too_far
      assert.notEqual(squatQuality.issue, 'too_far',
        'Apple Vision squat should NOT return too_far');

      // Also verify through classifier
      const counter = createSquatCounter({ targetCount: 5 });
      counter.handleFrame(standingFrame);
      counter.handleFrame(standingFrame);
      counter.handleFrame(standingFrame);
      counter.handleFrame(standingFrame);
      assert.equal(counter.handleFrame(standingFrame).phase, 'ready');

      // Now test squat with low bodyFillRatio
      const classifierResult = classifySquatPoseFrame(squatFrameLowFill);
      assert.notEqual(classifierResult.qualityIssue, 'too_far',
        'Apple Vision classifier should not return too_far for squat');

      // Counter should still work (may not count due to geometry, but shouldn't reset)
      const counterResult = counter.handleFrame(squatFrameLowFill);
      assert.ok(counterResult.phase !== 'waiting_for_body' || counterResult.count === 0,
        'should not reset to waiting due to too_far');
    });
  });

  describe('apple-vision confidence relaxation', () => {
    it('accepts frame with 0.45 confidence for Apple Vision squat', () => {
      // This test verifies Apple Vision uses 0.35 threshold instead of 0.55
      const lowConfidenceFrame: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // All landmarks at 0.45 confidence - below 0.55 but above 0.35
          landmark('leftShoulder', 140, 100, 0.45),
          landmark('rightShoulder', 160, 100, 0.45),
          landmark('leftHip', 150, 240, 0.45),
          landmark('rightHip', 150, 240, 0.45),
          landmark('leftKnee', 150, 400, 0.45),
          landmark('rightKnee', 150, 400, 0.45),
          landmark('leftAnkle', 150, 560, 0.45),
          landmark('rightAnkle', 150, 560, 0.45),
        ],
      };

      // For ML Kit, this should be low_confidence
      const mlkitResult = classifySquatPoseFrame({ ...lowConfidenceFrame, source: 'mlkit' });
      assert.equal(mlkitResult.qualityIssue, 'low_confidence', 'ML Kit should reject 0.45 confidence');

      // For Apple Vision, this should be accepted (0.35 threshold)
      const appleVisionResult = classifySquatPoseFrame(lowConfidenceFrame);
      assert.notEqual(appleVisionResult.qualityIssue, 'low_confidence',
        'Apple Vision should accept 0.45 confidence');
    });
  });

  describe('apple-vision 0.45 confidence counter integration', () => {
    it('Apple Vision counter counts squat with 0.45 confidence frames', () => {
      // This test verifies the FULL counter chain works with 0.45 confidence
      // Not just the classifier directly, but through createSquatCounter
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with high confidence standing frames
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      let result = counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Now provide 2 squat frames with 0.45 confidence
      const lowConfSquatFrame1: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // All landmarks at 0.45 confidence - below 0.55 but above 0.35
          // Using squat geometry: knee angle ~80°
          landmark('leftShoulder', 140, 160, 0.45),
          landmark('rightShoulder', 160, 160, 0.45),
          landmark('leftHip', 150, 300, 0.45),
          landmark('rightHip', 150, 300, 0.45),
          landmark('leftKnee', 0, 400, 0.45),
          landmark('rightKnee', 300, 400, 0.45),
          landmark('leftAnkle', 150, 560, 0.45),
          landmark('rightAnkle', 150, 560, 0.45),
        ],
      };

      const lowConfSquatFrame2: PoseFrame = { ...lowConfSquatFrame1, timestampMs: 2100 };

      // Apple Vision should count this squat
      counter.handleFrame(lowConfSquatFrame1);
      result = counter.handleFrame(lowConfSquatFrame2);

      assert.equal(result.count, 1, 'Apple Vision should count squat with 0.45 confidence');
      assert.equal(result.phase, 'down');
    });

    it('ML Kit counter does NOT count squat with 0.45 confidence frames', () => {
      // ML Kit should maintain strict 0.55 threshold
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with ML Kit high confidence frames
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      let result = counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Provide 0.45 confidence squat frame for ML Kit
      const lowConfSquatFrame: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'mlkit',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // All landmarks at 0.45 confidence - below ML Kit 0.55 threshold
          landmark('leftShoulder', 140, 160, 0.45),
          landmark('rightShoulder', 160, 160, 0.45),
          landmark('leftHip', 150, 300, 0.45),
          landmark('rightHip', 150, 300, 0.45),
          landmark('leftKnee', 0, 400, 0.45),
          landmark('rightKnee', 300, 400, 0.45),
          landmark('leftAnkle', 150, 560, 0.45),
          landmark('rightAnkle', 150, 560, 0.45),
        ],
      };

      // ML Kit should reject this due to low confidence
      result = counter.handleFrame(lowConfSquatFrame);
      assert.equal(result.count, 0, 'ML Kit should NOT count squat with 0.45 confidence');
      // Should still be in ready or down phase, but count should be 0
    });
  });

  describe('apple-vision scaleChange relaxed counter integration', () => {
    it('Apple Vision counts squat even when scaleChangeRatio > 0.30 if knee <= 130', () => {
      // This test verifies Apple Vision relaxed fallback takes priority over scaleChange hard reject
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with high confidence standing frames
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      let result = counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Create squat frame with:
      // - knee angle <= 130 (satisfies Apple Vision relaxed fallback)
      // - scaleChangeRatio > 0.30 (would fail strict check)
      // Simulate by making torso larger (simulating forward lean / camera movement)
      const squatFrame1: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'apple-vision',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // Standing baseline: shoulder y=100, hip y=240, torso=140px
          // Squat with forward lean: shoulder y=200, hip y=340, torso=140px
          // But knees forward: x=0/300, knee angle ~80° (<=130)
          // Scale will change due to forward lean, but knee bend is obvious
          landmark('leftShoulder', 140, 200, 0.95),
          landmark('rightShoulder', 160, 200, 0.95),
          landmark('leftHip', 150, 340, 0.95),
          landmark('rightHip', 150, 340, 0.95),
          landmark('leftKnee', 0, 400, 0.95),
          landmark('rightKnee', 300, 400, 0.95),
          landmark('leftAnkle', 150, 560, 0.95),
          landmark('rightAnkle', 150, 560, 0.95),
        ],
      };

      const squatFrame2: PoseFrame = { ...squatFrame1, timestampMs: 2100 };

      // Verify scaleChangeRatio > 0.30 for strict ML Kit
      const mlkitFrame = { ...squatFrame1, source: 'mlkit' as const };
      const mlkitResult = classifySquatPoseFrame(mlkitFrame);
      // ML Kit should reject due to scaleChange
      assert.equal(mlkitResult.label, 'unknown',
        'ML Kit should reject squat with high scaleChangeRatio');

      // Apple Vision should count due to relaxed fallback
      counter.handleFrame(squatFrame1);
      result = counter.handleFrame(squatFrame2);

      assert.equal(result.count, 1, 'Apple Vision should count squat with obvious knee bend despite scaleChange');
      assert.equal(result.phase, 'down');
    });

    it('ML Kit does NOT count squat with high scaleChangeRatio', () => {
      // ML Kit should maintain strict scaleChangeRatio > 0.30 rejection
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with ML Kit
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      let result = counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(result.phase, 'ready');

      // Create squat frame with high scaleChangeRatio
      const highScaleSquatFrame: PoseFrame = {
        timestampMs: 2000,
        imageWidth: 300,
        imageHeight: 640,
        cameraFacing: 'front',
        source: 'mlkit',
        coordinateSpace: 'upright-top-left-unmirrored',
        landmarks: [
          // Same as above but with ML Kit source
          landmark('leftShoulder', 140, 200, 0.95),
          landmark('rightShoulder', 160, 200, 0.95),
          landmark('leftHip', 150, 340, 0.95),
          landmark('rightHip', 150, 340, 0.95),
          landmark('leftKnee', 0, 400, 0.95),
          landmark('rightKnee', 300, 400, 0.95),
          landmark('leftAnkle', 150, 560, 0.95),
          landmark('rightAnkle', 150, 560, 0.95),
        ],
      };

      // ML Kit should not count this
      counter.handleFrame(highScaleSquatFrame);
      result = counter.handleFrame(highScaleSquatFrame);

      assert.equal(result.count, 0, 'ML Kit should NOT count squat with high scaleChangeRatio');
    });
  });

  describe('apple-vision relaxed timeout (1500ms invalid, 3500ms transition)', () => {
    it('survives 1500ms of invalid pose', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with Apple Vision
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(counter.handleFrame(appleVisionFrame('standing', 1400)).phase, 'ready');

      // Squat with Apple Vision
      counter.handleFrame(appleVisionFrame('squatting', 2000));
      counter.handleFrame(appleVisionFrame('squatting', 2100));
      counter.handleFrame(appleVisionFrame('squatting', 2200));
      assert.equal(counter.handleFrame(appleVisionFrame('squatting', 2300)).phase, 'down');

      // Partial body at t=3000 (700ms after last squat frame)
      counter.handleFrame(partialBodyFrame(3000, 0.95, 'apple-vision'));

      // Partial body at t=4500 (2200ms since last squat frame, exceeds 1500ms)
      // Apple Vision should tolerate up to 1500ms, so this should reset
      const afterTimeout = counter.handleFrame(partialBodyFrame(4500, 0.95, 'apple-vision'));
      assert.equal(afterTimeout.phase, 'waiting_for_body',
        'should reset after 1500ms of invalid pose on Apple Vision');
    });

    it('allows 2500ms slow transition (exceeds old 2000ms limit)', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with Apple Vision
      counter.handleFrame(appleVisionFrame('standing', 1000));
      counter.handleFrame(appleVisionFrame('standing', 1100));
      counter.handleFrame(appleVisionFrame('standing', 1200));
      counter.handleFrame(appleVisionFrame('standing', 1300));
      assert.equal(counter.handleFrame(appleVisionFrame('standing', 1400)).phase, 'ready');

      // 2.5 second transition (exceeds old 2000ms limit)
      // Use transitionFrame which produces 'unknown' label
      for (let i = 0; i < 50; i++) {
        const progress = (i + 1) / 50;
        const result = counter.handleFrame(transitionFrame(2000 + i * 50, progress, 'apple-vision'));
        // Should NOT timeout - Apple Vision allows 3500ms
        assert.notEqual(result.phase, 'waiting_for_body',
          `should not timeout at frame ${i + 1} (${(i + 1) * 50}ms)`);
      }

      // Now reach squat
      counter.handleFrame(appleVisionFrame('squatting', 4500));
      const result = counter.handleFrame(appleVisionFrame('squatting', 4600));
      assert.equal(result.count, 1, 'should count after slow transition');
    });
  });

  describe('ML Kit behavior preserved (no regression)', () => {
    it('ML Kit counts only after full cycle (not on squat immediately)', () => {
      const counter = createSquatCounter({ targetCount: 5 });
      // Use ML Kit frames
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      counter.handleFrame(mlkitFrame('standing', 1300));
      let result = counter.handleFrame(mlkitFrame('standing', 1400));
      assert.equal(result.phase, 'ready');

      // ML Kit requires 3 frames for stable (not 2 like Apple Vision)
      counter.handleFrame(mlkitFrame('squatting', 2000));
      counter.handleFrame(mlkitFrame('squatting', 2100));
      result = counter.handleFrame(mlkitFrame('squatting', 2200));

      // ML Kit: should be in 'down' phase but NOT have counted yet
      // Count only happens after returning to standing
      assert.equal(result.phase, 'down');
      assert.equal(result.count, 0, 'ML Kit should NOT count on squat - only after standing');

      // Now return to standing to complete the cycle
      counter.handleFrame(mlkitFrame('standing', 3000));
      counter.handleFrame(mlkitFrame('standing', 3100));
      result = counter.handleFrame(mlkitFrame('standing', 3200));
      assert.equal(result.count, 1, 'ML Kit should count after full cycle');
      assert.equal(result.phase, 'ready');
    });

    it('ML Kit still uses 2000ms transition timeout', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline with ML Kit
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(counter.handleFrame(mlkitFrame('standing', 1400)).phase, 'ready');

      // ML Kit: need enough transition frames to exceed 2000ms timeout
      // Use 50 frames at 60ms each = 3000ms total, clearly exceeds 2000ms
      for (let i = 0; i < 50; i++) {
        const progress = (i + 1) / 50;
        const result = counter.handleFrame(transitionFrame(2000 + i * 60, progress, 'mlkit'));
        if (result.phase === 'waiting_for_body') {
          // ML Kit should have timed out
          assert.ok(true, `ML Kit should timeout at frame ${i + 1} (${(i + 1) * 60}ms)`);
          return;
        }
      }
      // If we reach here without timeout, fail
      assert.fail('ML Kit should timeout after 2000ms transition');
    });

    it('ML Kit invalid timeout is 700ms', () => {
      const counter = createSquatCounter({ targetCount: 5 });

      // Establish baseline
      counter.handleFrame(mlkitFrame('standing', 1000));
      counter.handleFrame(mlkitFrame('standing', 1100));
      counter.handleFrame(mlkitFrame('standing', 1200));
      counter.handleFrame(mlkitFrame('standing', 1300));
      assert.equal(counter.handleFrame(mlkitFrame('standing', 1400)).phase, 'ready');

      // Squat with ML Kit
      counter.handleFrame(mlkitFrame('squatting', 2000));
      counter.handleFrame(mlkitFrame('squatting', 2100));
      counter.handleFrame(mlkitFrame('squatting', 2200));
      assert.equal(counter.handleFrame(mlkitFrame('squatting', 2300)).phase, 'down');

      // ML Kit: partial body at t=3000 (700ms after last squat frame)
      counter.handleFrame(partialBodyFrame(3000, 0.95, 'mlkit'));

      // ML Kit: partial body at t=3700 (1400ms gap, exceeds 700ms)
      const afterTimeout = counter.handleFrame(partialBodyFrame(3700, 0.95, 'mlkit'));
      assert.equal(afterTimeout.phase, 'waiting_for_body',
        'ML Kit should reset after 700ms of invalid pose');
    });
  });
});
