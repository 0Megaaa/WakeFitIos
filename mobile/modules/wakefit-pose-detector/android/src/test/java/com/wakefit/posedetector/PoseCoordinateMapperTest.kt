package com.wakefit.posedetector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for [PoseCoordinateMapper]. These tests pin down the full
 * coordinate-space contract documented in PoseCoordinateMapper's KDoc and
 * prove that:
 *
 *  - ML Kit points (rotated-upright space) survive every rotation 0/90/180/270
 *  - the upright image dimensions are correctly swapped for 90/270
 *  - cropRect is not subtracted by the mapper (the CameraX factory does that)
 *  - front-camera mirroring happens exactly once
 *  - back-camera coordinates are passed through unchanged
 *  - cropRect boundary points stay inside the upright frame
 *  - the overlay-source point is identity-equivalent to the raw ML Kit point
 *    so the overlay Matrix never applies a second mirror
 */
class PoseCoordinateMapperTest {

  // ----- helpers -----

  private val rawWidth = 1280
  private val rawHeight = 720
  private val cropLeft = 80
  private val cropTop = 40
  private val cropRight = 1120
  private val cropBottom = 680

  private fun backMap(
    x: Float,
    y: Float,
    rotation: Int,
  ) = PoseCoordinateMapper.mapPoint(
    pointX = x,
    pointY = y,
    rawWidth = rawWidth,
    rawHeight = rawHeight,
    cropLeft = cropLeft,
    cropTop = cropTop,
    cropRight = cropRight,
    cropBottom = cropBottom,
    rotationDegrees = rotation,
    isFrontCamera = false,
  )

  private fun frontMap(
    x: Float,
    y: Float,
    rotation: Int,
  ) = PoseCoordinateMapper.mapPoint(
    pointX = x,
    pointY = y,
    rawWidth = rawWidth,
    rawHeight = rawHeight,
    cropLeft = cropLeft,
    cropTop = cropTop,
    cropRight = cropRight,
    cropBottom = cropBottom,
    rotationDegrees = rotation,
    isFrontCamera = true,
  )

  // ----- rotation 0 -----

  @Test
  fun rotationZero_backCamera_passesPointThrough() {
    // rawWidth x rawHeight == uprightWidth x uprightHeight for 0/180
    val out = backMap(x = 640f, y = 360f, rotation = 0)
    assertEquals(640f, out.canonicalX, 0.001f)
    assertEquals(360f, out.canonicalY, 0.001f)
    assertEquals(640f, out.overlaySourceX, 0.001f)
    assertEquals(360f, out.overlaySourceY, 0.001f)
  }

  @Test
  fun rotationZero_frontCamera_mirrorsExactlyOnce() {
    val out = frontMap(x = 200f, y = 360f, rotation = 0)
    // uprightWidth = rawWidth = 1280
    // mirrored x = (1280 - 1) - 200 = 1079
    assertEquals(1079f, out.canonicalX, 0.001f)
    assertEquals(360f, out.canonicalY, 0.001f)
    // overlay source is NOT mirrored (overlay matrix handles front mirror)
    assertEquals(200f, out.overlaySourceX, 0.001f)
    assertEquals(360f, out.overlaySourceY, 0.001f)
  }

  // ----- rotation 90 -----

  @Test
  fun rotationNinety_backCamera_swapsAxes() {
    // uprightWidth = rawHeight = 720, uprightHeight = rawWidth = 1280
    val out = backMap(x = 360f, y = 640f, rotation = 90)
    assertEquals(360f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
    // upright dims sanity check via public API
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 90)
    assertEquals(720 to 1280, dims)
  }

  @Test
  fun rotationNinety_frontCamera_mirrorsAcrossSwappedWidth() {
    val out = frontMap(x = 100f, y = 640f, rotation = 90)
    // uprightWidth = 720
    // mirrored x = (720 - 1) - 100 = 619
    assertEquals(619f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
    // overlay source = raw ML Kit point (no extra mirror)
    assertEquals(100f, out.overlaySourceX, 0.001f)
  }

  // ----- rotation 180 -----

  @Test
  fun rotationOneEighty_backCamera_passesPointThrough() {
    val out = backMap(x = 100f, y = 200f, rotation = 180)
    // uprightWidth = rawWidth = 1280
    assertEquals(100f, out.canonicalX, 0.001f)
    assertEquals(200f, out.canonicalY, 0.001f)
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 180)
    assertEquals(1280 to 720, dims)
  }

  @Test
  fun rotationOneEighty_frontCamera_mirrorsAcrossOriginalWidth() {
    val out = frontMap(x = 50f, y = 100f, rotation = 180)
    // mirrored x = 1279 - 50 = 1229
    assertEquals(1229f, out.canonicalX, 0.001f)
    assertEquals(100f, out.canonicalY, 0.001f)
  }

  // ----- rotation 270 -----

  @Test
  fun rotationTwoSeventy_backCamera_swapsAxes() {
    val out = backMap(x = 360f, y = 640f, rotation = 270)
    assertEquals(360f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 270)
    assertEquals(720 to 1280, dims)
  }

  @Test
  fun rotationTwoSeventy_frontCamera_mirrorsAcrossSwappedWidth() {
    val out = frontMap(x = 50f, y = 100f, rotation = 270)
    // uprightWidth = 720
    assertEquals(669f, out.canonicalX, 0.001f)
    assertEquals(100f, out.canonicalY, 0.001f)
  }

  // ----- cropRect variants -----

  @Test
  fun cropRectLeftZero_topZero_isStillInsideRawBuffer() {
    val out = PoseCoordinateMapper.mapPoint(
      pointX = 100f,
      pointY = 200f,
      rawWidth = 640,
      rawHeight = 480,
      cropLeft = 0,
      cropTop = 0,
      cropRight = 640,
      cropBottom = 480,
      rotationDegrees = 0,
      isFrontCamera = false,
    )
    assertEquals(100f, out.canonicalX, 0.001f)
    assertEquals(200f, out.canonicalY, 0.001f)
  }

  @Test
  fun cropRectNonZeroOrigin_doesNotShiftTheMapper() {
    // The mapper must NOT subtract cropRect from the ML Kit point because
    // CameraX's ImageProxyTransformFactory (with setUsingCropRect(true))
    // already subtracts cropRect when building its transform.
    val out = PoseCoordinateMapper.mapPoint(
      pointX = 100f,
      pointY = 200f,
      rawWidth = rawWidth,
      rawHeight = rawHeight,
      cropLeft = 200,
      cropTop = 100,
      cropRight = 1080,
      cropBottom = 620,
      rotationDegrees = 0,
      isFrontCamera = false,
    )
    assertEquals(100f, out.canonicalX, 0.001f)
    assertEquals(200f, out.canonicalY, 0.001f)
  }

  // ----- boundary points -----

  @Test
  fun cropRectCornerPoint_isPreservedInsideUprightFrame() {
    // cropRect is (0,0)-(640,480). Top-left corner of upright frame.
    val out = backMap(x = 0f, y = 0f, rotation = 0)
    assertEquals(0f, out.canonicalX, 0.001f)
    assertEquals(0f, out.canonicalY, 0.001f)

    // Bottom-right corner of upright frame (1280x720 because rotation 0).
    val out2 = backMap(x = 1279f, y = 719f, rotation = 0)
    assertEquals(1279f, out2.canonicalX, 0.001f)
    assertEquals(719f, out2.canonicalY, 0.001f)
  }

  @Test
  fun uprightImageCenterPoint_isItsOwnMirror() {
    // width=1280 → center=639.5
    val centerX = 639.5f
    val backCenter = backMap(x = centerX, y = 360f, rotation = 0)
    assertEquals(centerX, backCenter.canonicalX, 0.001f)

    val frontCenter = frontMap(x = centerX, y = 360f, rotation = 0)
    // The pixel exactly in the middle of a 1280-wide image lands back on
    // itself after mirroring because both sides are equidistant.
    assertEquals(centerX, frontCenter.canonicalX, 0.001f)
  }

  // ----- mirror invariant -----

  @Test
  fun mirroringHappensExactlyOnce() {
    // The canonical (JS-facing) point is mirrored; the overlay-source point
    // is NOT. This proves that no second mirror is applied downstream and
    // that the overlay Matrix never sees a pre-mirrored point.
    val out = frontMap(x = 100f, y = 200f, rotation = 0)
    val expectedCanonical = PoseCoordinateMapper.mirrorAroundCenter(100f, rawWidth)
    assertEquals(expectedCanonical, out.canonicalX, 0.001f)
    assertNotEquals("overlay source must NOT be mirrored", out.canonicalX, out.overlaySourceX)
    assertEquals(100f, out.overlaySourceX, 0.001f)
  }

  // ----- rotation normalization -----

  @Test
  fun rotationOutOfRange_collapsesToZero() {
    // 45° and -90° (which is 270 mod 360) are out of the supported set.
    // -90 should normalize to 270.
    val normal = PoseCoordinateMapper.normalizeRotation(45)
    assertEquals(0, normal)

    val neg = PoseCoordinateMapper.normalizeRotation(-90)
    assertEquals(270, neg)

    val big = PoseCoordinateMapper.normalizeRotation(720)
    assertEquals(0, big)

    val bigPos = PoseCoordinateMapper.normalizeRotation(450)
    assertEquals(90, bigPos)
  }

  // ----- defensive -----

  @Test(expected = IllegalArgumentException::class)
  fun mirrorRejectsZeroWidth() {
    PoseCoordinateMapper.mirrorAroundCenter(0f, 0)
  }

  @Test
  fun mapPoint_outOfRangeValue_isPreservedNotClamped() {
    // Negative coordinates can come from ML Kit if the landmark is detected
    // slightly outside the frame; the mapper must pass them through so the
    // classifier/consumer can decide what to do.
    val out = backMap(x = -5f, y = -10f, rotation = 0)
    assertEquals(-5f, out.canonicalX, 0.001f)
    assertEquals(-10f, out.canonicalY, 0.001f)
  }

  @Test
  fun canonicalY_isNeverMirrored() {
    // Vertical axis is NEVER mirrored on the front camera (only X is).
    val back = backMap(x = 100f, y = 360f, rotation = 0)
    val front = frontMap(x = 100f, y = 360f, rotation = 0)
    assertEquals(back.canonicalY, front.canonicalY, 0.001f)
    assertTrue(front.canonicalX != back.canonicalX)
  }
}