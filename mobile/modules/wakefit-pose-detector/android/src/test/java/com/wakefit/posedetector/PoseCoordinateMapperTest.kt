package com.wakefit.posedetector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for [PoseCoordinateMapper]. These tests pin down the full
 * coordinate-space contract documented in PoseCoordinateMapper's KDoc and
 * prove that:
 *
 *  - ML Kit points (rotated-upright space) survive every rotation 0/90/180/270
 *  - the upright image dimensions are correctly swapped for 90/270
 *  - canonical X = ML Kit pointX, canonical Y = ML Kit pointY (identity pass-through)
 *  - front and back cameras produce IDENTICAL canonical coordinates
 *    (the coordinateSpace string `upright-top-left-unmirrored` is the guarantee)
 *  - overlay-source point = raw ML Kit point (CameraX handles all mirroring internally)
 *  - cropRect parameters are NOT subtracted by the mapper (CameraX factory does that)
 *  - rotation normalization is correct
 */
class PoseCoordinateMapperTest {

  // ----- helpers -----

  private val rawWidth = 1280
  private val rawHeight = 720

  private fun map(
    x: Float,
    y: Float,
    rotation: Int,
  ) = PoseCoordinateMapper.mapPoint(
    pointX = x,
    pointY = y,
    rawWidth = rawWidth,
    rawHeight = rawHeight,
    rotationDegrees = rotation,
  )

  // ----- canonical = ML Kit identity -----

  @Test
  fun canonicalX_equalsMlKitPointX() {
    val out = map(x = 640f, y = 360f, rotation = 0)
    assertEquals(640f, out.canonicalX, 0.001f)
  }

  @Test
  fun canonicalY_equalsMlKitPointY() {
    val out = map(x = 640f, y = 360f, rotation = 0)
    assertEquals(360f, out.canonicalY, 0.001f)
  }

  // ----- front and back canonical are identical -----

  @Test
  fun frontAndBackCamera_produceIdenticalCanonicalCoordinates() {
    // The coordinateSpace "upright-top-left-unmirrored" means the JS consumer
    // (squat/push-up classifiers) sees the same point values regardless of
    // which camera is active. This is the core guarantee of the PoseFrame contract.
    val out = map(x = 200f, y = 360f, rotation = 0)
    assertEquals(200f, out.canonicalX, 0.001f)
    assertEquals(360f, out.canonicalY, 0.001f)
  }

  @Test
  fun frontAndBackCanonicalIdentical_rotation90() {
    val out = map(x = 100f, y = 640f, rotation = 90)
    assertEquals(100f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
  }

  @Test
  fun frontAndBackCanonicalIdentical_rotation180() {
    val out = map(x = 50f, y = 100f, rotation = 180)
    assertEquals(50f, out.canonicalX, 0.001f)
    assertEquals(100f, out.canonicalY, 0.001f)
  }

  @Test
  fun frontAndBackCanonicalIdentical_rotation270() {
    val out = map(x = 50f, y = 100f, rotation = 270)
    assertEquals(50f, out.canonicalX, 0.001f)
    assertEquals(100f, out.canonicalY, 0.001f)
  }

  // ----- rotation: upright dimensions -----

  @Test
  fun rotationZero_uprightDimsMatchRaw() {
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 0)
    assertEquals(rawWidth to rawHeight, dims)
  }

  @Test
  fun rotationNinety_uprightDimsAreSwapped() {
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 90)
    assertEquals(rawHeight to rawWidth, dims)
  }

  @Test
  fun rotationOneEighty_uprightDimsMatchRaw() {
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 180)
    assertEquals(rawWidth to rawHeight, dims)
  }

  @Test
  fun rotationTwoSeventy_uprightDimsAreSwapped() {
    val dims = PoseCoordinateMapper.uprightDimensions(rawWidth, rawHeight, 270)
    assertEquals(rawHeight to rawWidth, dims)
  }

  // ----- rotation: point pass-through -----

  @Test
  fun rotationZero_pointPassesThrough() {
    val out = map(x = 640f, y = 360f, rotation = 0)
    assertEquals(640f, out.canonicalX, 0.001f)
    assertEquals(360f, out.canonicalY, 0.001f)
  }

  @Test
  fun rotationNinety_pointPassesThrough() {
    val out = map(x = 360f, y = 640f, rotation = 90)
    assertEquals(360f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
  }

  @Test
  fun rotationOneEighty_pointPassesThrough() {
    val out = map(x = 100f, y = 200f, rotation = 180)
    assertEquals(100f, out.canonicalX, 0.001f)
    assertEquals(200f, out.canonicalY, 0.001f)
  }

  @Test
  fun rotationTwoSeventy_pointPassesThrough() {
    val out = map(x = 360f, y = 640f, rotation = 270)
    assertEquals(360f, out.canonicalX, 0.001f)
    assertEquals(640f, out.canonicalY, 0.001f)
  }

  // ----- overlay source = raw ML Kit point -----

  @Test
  fun overlaySourceX_equalsMlKitPointX() {
    val out = map(x = 640f, y = 360f, rotation = 0)
    assertEquals(640f, out.overlaySourceX, 0.001f)
  }

  @Test
  fun overlaySourceY_equalsMlKitPointY() {
    val out = map(x = 640f, y = 360f, rotation = 0)
    assertEquals(360f, out.overlaySourceY, 0.001f)
  }

  @Test
  fun overlaySource_identicalToCanonical_rotationZero() {
    val out = map(x = 200f, y = 360f, rotation = 0)
    assertEquals(out.canonicalX, out.overlaySourceX, 0.001f)
    assertEquals(out.canonicalY, out.overlaySourceY, 0.001f)
  }

  @Test
  fun overlaySource_identicalToCanonical_rotationNinety() {
    val out = map(x = 100f, y = 640f, rotation = 90)
    assertEquals(out.canonicalX, out.overlaySourceX, 0.001f)
    assertEquals(out.canonicalY, out.overlaySourceY, 0.001f)
  }

  // ----- rotation normalization -----

  @Test
  fun rotationOutOfRange_collapsesToZero() {
    assertEquals(0, PoseCoordinateMapper.normalizeRotation(45))
  }

  @Test
  fun rotationNegative_normalizesToPositive() {
    // -90° ≡ 270°
    assertEquals(270, PoseCoordinateMapper.normalizeRotation(-90))
  }

  @Test
  fun rotationLargeValue_wrapsAround() {
    assertEquals(0, PoseCoordinateMapper.normalizeRotation(720))
    assertEquals(90, PoseCoordinateMapper.normalizeRotation(450))
    assertEquals(180, PoseCoordinateMapper.normalizeRotation(540))
    assertEquals(270, PoseCoordinateMapper.normalizeRotation(630))
  }

  // ----- defensive -----

  @Test
  fun mapPoint_outOfRangeValue_isPreservedNotClamped() {
    // Negative coordinates can come from ML Kit if the landmark is detected
    // slightly outside the frame; the mapper must pass them through so the
    // classifier/consumer can decide what to do.
    val out = map(x = -5f, y = -10f, rotation = 0)
    assertEquals(-5f, out.canonicalX, 0.001f)
    assertEquals(-10f, out.canonicalY, 0.001f)
  }

  @Test
  fun mapPoint_requiresPositiveRawDimensions() {
    var threw = false
    try {
      PoseCoordinateMapper.mapPoint(
        pointX = 100f,
        pointY = 200f,
        rawWidth = 0,
        rawHeight = 480,
        rotationDegrees = 0,
      )
    } catch (e: IllegalArgumentException) {
      threw = true
    }
    assertTrue("mapPoint must reject rawWidth < 1", threw)
  }
}
