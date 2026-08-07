package com.wakefit.posedetector

/**
 * Pure coordinate-mapping utility for the Android pose pipeline.
 *
 * COORDINATE-SPACE CONTRACT (proved by tests in [PoseCoordinateMapperTest]):
 *
 * 1. The raw camera buffer arrives at the analyzer as [rawWidth] x [rawHeight]
 *    in sensor orientation. The active crop is described by
 *    [cropLeft], [cropTop], [cropRight], [cropBottom] in raw-buffer pixels.
 *
 * 2. The frame needs to be presented upright to ML Kit. We call
 *    [com.google.mlkit.vision.common.InputImage.fromMediaImage] with the
 *    buffer's [rotationDegrees] (0/90/180/270). ML Kit then returns
 *    `PoseLandmark.position` in the **rotated-upright** image space whose
 *    width and height are [uprightWidth] x [uprightHeight] (axes are swapped
 *    when rotationDegrees is 90/270, unchanged when 0/180).
 *
 * 3. The canonical contract exposed to JS is **upright-top-left-unmirrored**.
 *    When the camera is FRONT-facing, the user expects a natural mirror image
 *    on screen, so we mirror the X axis exactly once here (see [isFrontCamera]).
 *    The back camera is *not* mirrored.
 *
 * 4. The overlay's `Matrix` (returned by
 *    `androidx.camera.view.transform.ImageProxyTransformFactory` paired with
 *    `PreviewView.outputTransform`) already includes any rotation, crop and
 *    front-camera mirroring required to land on the view. Therefore the
 *    canonical point produced by [toCanonical] can be pushed straight through
 *    that matrix without any additional transformation. The
 *    [overlaySourcePoint] returned here is identity-equivalent to the
 *    canonical point: it is exposed only so callers can document the
 *    decision and tests can assert the no-extra-mirror invariant.
 *
 * 5. cropRect boundaries are treated as already inside the upright view:
 *    when `setUsingCropRect(true)` is set on the factory the factory itself
 *    subtracts `cropLeft, cropTop` before mapping, so the mapper never
 *    subtracts cropRect from the canonical point.
 */
object PoseCoordinateMapper {

  /**
   * Output of a single mapping: the canonical point consumed by React Native
   * (`upright-top-left-unmirrored`) and the point expected by the overlay
   * Matrix (which today happens to be identical to the canonical point —
   * both layers are derived from the same upright unmirrored frame).
   */
  data class MappedPoint(
    val canonicalX: Float,
    val canonicalY: Float,
    val overlaySourceX: Float,
    val overlaySourceY: Float,
  )

  /**
   * Map a single ML Kit landmark into the canonical and overlay-source
   * spaces. All inputs are required; this function never reads state and
   * never throws on out-of-range inputs (out-of-range values are simply
   * preserved, mirroring ML Kit's own behaviour).
   *
   * @param pointX ML Kit landmark X in rotated-upright pixel space.
   * @param pointY ML Kit landmark Y in rotated-upright pixel space.
   * @param rawWidth Raw buffer width in sensor orientation (>= 1).
   * @param rawHeight Raw buffer height in sensor orientation (>= 1).
   * @param cropLeft Crop rectangle left in raw-buffer pixels.
   * @param cropTop Crop rectangle top in raw-buffer pixels.
   * @param cropRight Crop rectangle right in raw-buffer pixels.
   * @param cropBottom Crop rectangle bottom in raw-buffer pixels.
   * @param rotationDegrees Buffer rotation (0/90/180/270) passed to
   *        `InputImage.fromMediaImage`. Other values are treated as 0.
   * @param isFrontCamera When true, mirror X around the upright image
   *        centerline so the JS consumer observes the same view the user
   *        sees in the mirrored preview. The overlay Matrix handles its
   *        own mirroring, so the overlay-source point is left untouched.
   */
  fun mapPoint(
    pointX: Float,
    pointY: Float,
    rawWidth: Int,
    rawHeight: Int,
    cropLeft: Int,
    cropTop: Int,
    cropRight: Int,
    cropBottom: Int,
    rotationDegrees: Int,
    isFrontCamera: Boolean,
  ): MappedPoint {
    val (uprightWidth, uprightHeight) = uprightDimensions(
      rawWidth = rawWidth,
      rawHeight = rawHeight,
      rotationDegrees = normalizeRotation(rotationDegrees),
    )

    // The factory subtracts cropRect itself when setUsingCropRect(true).
    // ML Kit already returns upright coords, so we do NOT subtract cropRect
    // here; we only mirror for front camera.
    val mirroredX = if (isFrontCamera) {
      mirrorAroundCenter(pointX, uprightWidth)
    } else {
      pointX
    }

    return MappedPoint(
      canonicalX = mirroredX,
      canonicalY = pointY,
      // The overlay Matrix is built from the same ImageProxy + OutputTransform
      // pipeline and already encodes rotation + crop + front-camera mirror,
      // so the source point we hand it is the raw ML Kit point with NO
      // extra mirroring applied. This guarantees mirroring happens exactly
      // once across the whole stack.
      overlaySourceX = pointX,
      overlaySourceY = pointY,
    ).also {
      // Reference the upright/crop dimensions so static analysis keeps the
      // signature honest about which spaces the function depends on.
      checkCropRectInsideRawBuffer(
        rawWidth = rawWidth,
        rawHeight = rawHeight,
        cropLeft = cropLeft,
        cropTop = cropTop,
        cropRight = cropRight,
        cropBottom = cropBottom,
      )
      check(uprightWidth >= 1 && uprightHeight >= 1) {
        "upright dimensions must be positive (was $uprightWidth x $uprightHeight)"
      }
    }
  }

  /**
   * Compute the upright image dimensions from raw buffer dimensions and the
   * rotation that was applied to ML Kit.
   */
  fun uprightDimensions(rawWidth: Int, rawHeight: Int, rotationDegrees: Int): Pair<Int, Int> {
    return when (normalizeRotation(rotationDegrees)) {
      90, 270 -> Pair(rawHeight, rawWidth)
      else -> Pair(rawWidth, rawHeight)
    }
  }

  /**
   * Mirror `x` around the centerline of an image of the given width. Mirroring
   * is the only place where the front-camera effect is introduced; everything
   * downstream reuses the same canonical frame.
   */
  fun mirrorAroundCenter(x: Float, width: Int): Float {
    require(width > 0) { "width must be > 0 (was $width)" }
    return width - 1f - x
  }

  /**
   * Normalize a rotation value to one of {0, 90, 180, 270}. Anything else
   * (e.g. 45, -1) collapses to 0 so callers can never end up in an undefined
   * coordinate space.
   */
  fun normalizeRotation(rotationDegrees: Int): Int {
    val mod = ((rotationDegrees % 360) + 360) % 360
    return when (mod) {
      90 -> 90
      180 -> 180
      270 -> 270
      else -> 0
    }
  }

  private fun checkCropRectInsideRawBuffer(
    rawWidth: Int,
    rawHeight: Int,
    cropLeft: Int,
    cropTop: Int,
    cropRight: Int,
    cropBottom: Int,
  ) {
    require(rawWidth >= 1 && rawHeight >= 1) { "raw buffer must be >= 1 in both dimensions" }
    require(cropLeft >= 0 && cropTop >= 0) { "cropRect origin must be >= 0" }
    require(cropRight > cropLeft && cropBottom > cropTop) { "cropRect must be non-empty" }
    require(cropRight <= rawWidth && cropBottom <= rawHeight) {
      "cropRect must lie inside the raw buffer"
    }
  }
}