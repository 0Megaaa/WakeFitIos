package com.wakefit.posedetector

/**
 * Pure coordinate-mapping utility for the Android pose pipeline.
 *
 * COORDINATE-SPACE CONTRACT (proved by tests in [PoseCoordinateMapperTest]):
 *
 * 1. ML Kit returns `PoseLandmark.position` in the **rotated-upright** image
 *    space (because we called
 *    `InputImage.fromMediaImage(mediaImage, rotationDegrees)`).
 *    Upright width and height are derived from the raw buffer dimensions via
 *    [uprightDimensions] — axes are swapped when rotationDegrees is 90/270,
 *    unchanged when 0/180.
 *
 * 2. The canonical contract exposed to JS is **upright-top-left-unmirrored**.
 *    Front and back cameras produce identical canonical coordinates.
 *    The `coordinateSpace` string `upright-top-left-unmirrored` guarantees that
 *    JS consumers (the squat / push-up classifiers) see the same point values
 *    regardless of which camera is active.
 *
 * 3. Front-camera mirroring is the **sole responsibility of the CameraX
 *    Preview/OutputTransform layer**. It does NOT happen here.
 *    CameraX applies the mirror automatically when
 *    `setUsingRotationDegrees(true)` + front-facing output connection
 *    is used. The JS consumer is responsible for treating the canonical
 *    unmirrored coords according to its own display logic.
 *
 * 4. The overlay Matrix (ImageProxyTransformFactory + PreviewView.outputTransform
 *    + CoordinateTransform) receives the **raw ML Kit upright points** directly.
 *    CameraX handles all rotation, crop, and front-camera mirroring internally.
 *    We must NOT pre-mirror the points before handing them to the matrix,
 *    otherwise mirroring would happen twice.
 *
 * 5. cropRect is a CameraX concept (UseCaseGroup / ViewPort) that describes the
 *    sensor-buffer region the analyzer receives. ML Kit coordinates are already
 *    expressed in the upright image space where cropRect origin is (0, 0), so the
 *    mapper does NOT subtract cropRect values.
 */
object PoseCoordinateMapper {

  /**
   * Output of a single mapping.
   *
   * - `canonicalX` / `canonicalY`: point in **upright-top-left-unmirrored**
   *   space. Front and back cameras produce identical values.
   *
   * - `overlaySourceX` / `overlaySourceY`: the same ML Kit upright point
   *   handed to the CameraX overlay Matrix without any pre-transformation.
   *   CameraX applies its own rotation, crop, and mirroring internally.
   */
  data class MappedPoint(
    val canonicalX: Float,
    val canonicalY: Float,
    val overlaySourceX: Float,
    val overlaySourceY: Float,
  )

  /**
   * Map a single ML Kit landmark into the canonical and overlay-source spaces.
   *
   * `canonicalX` is always equal to `pointX` — no mirroring, ever.
   * `canonicalY` is always equal to `pointY`.
   * `overlaySourceX/Y` are also equal to `pointX/Y` — the raw ML Kit point
   * goes straight into the CameraX matrix, which handles mirroring independently.
   *
   * @param pointX ML Kit landmark X in rotated-upright pixel space.
   * @param pointY ML Kit landmark Y in rotated-upright pixel space.
   * @param rawWidth Raw buffer width in sensor orientation (>= 1).
   * @param rawHeight Raw buffer height in sensor orientation (>= 1).
   * @param rotationDegrees Buffer rotation (0/90/180/270) passed to
   *        `InputImage.fromMediaImage`. Other values are treated as 0.
   */
  fun mapPoint(
    pointX: Float,
    pointY: Float,
    rawWidth: Int,
    rawHeight: Int,
    rotationDegrees: Int,
  ): MappedPoint {
    val (uprightWidth, uprightHeight) = uprightDimensions(
      rawWidth = rawWidth,
      rawHeight = rawHeight,
      rotationDegrees = normalizeRotation(rotationDegrees),
    )

    return MappedPoint(
      canonicalX = pointX,
      canonicalY = pointY,
      // Raw ML Kit upright point goes to the CameraX overlay Matrix.
      // CameraX applies its own rotation, crop and front-mirror internally.
      overlaySourceX = pointX,
      overlaySourceY = pointY,
    ).also {
      require(uprightWidth >= 1 && uprightHeight >= 1) {
        "upright dimensions must be positive (was $uprightWidth x $uprightHeight)"
      }
      require(rawWidth >= 1 && rawHeight >= 1) {
        "raw buffer must be >= 1 in both dimensions"
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
}
