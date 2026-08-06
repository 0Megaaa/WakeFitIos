package com.wakefit.posedetector

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.view.View
import kotlin.math.max

data class WakeFitPosePoint(
  val name: String,
  val x: Float,
  val y: Float,
  val confidence: Float,
)

/**
 * Pose overlay view for displaying skeleton overlay on camera preview.
 *
 * Receives canonical upright-top-left-unmirrored coordinates (from ML Kit via InputImage rotation).
 * Transforms to view coordinates using CameraX official transformation matrix.
 *
 * Key: canonical coordinates are already upright, so NO rotation is needed.
 * The transformation matrix handles aspect-fill scaling and front camera mirroring.
 */
class WakeFitPoseOverlayView(context: Context) : View(context) {
  private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(94, 220, 160)
    strokeWidth = 7f
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    alpha = 230
  }
  private val pointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(255, 218, 115)
    style = Paint.Style.FILL
    alpha = 245
  }
  private val pointStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(18, 24, 22)
    strokeWidth = 3f
    style = Paint.Style.STROKE
    alpha = 220
  }

  // Canonical upright coordinates (from ML Kit after InputImage rotation)
  private var points: Map<String, WakeFitPosePoint> = emptyMap()
  private var imageWidth = 0
  private var imageHeight = 0
  // Transformation matrix from canonical coordinates to view coordinates
  private var transformMatrix: Matrix = Matrix()
  private var transformValues: FloatArray = FloatArray(9) { if (it == 0 || it == 4 || it == 8) 1f else 0f }

  fun updatePose(
    nextPoints: List<WakeFitPosePoint>,
    nextImageWidth: Int,
    nextImageHeight: Int,
    overlayTransform: FloatArray,
    frontCamera: Boolean,
  ) {
    // Filter by confidence threshold
    points = nextPoints
      .filter { it.confidence >= CONFIDENCE_THRESHOLD }
      .associateBy { it.name }
    imageWidth = nextImageWidth
    imageHeight = nextImageHeight

    // Use CameraX official transformation
    transformValues = overlayTransform
    transformMatrix = Matrix().apply { setValues(overlayTransform) }

    invalidate()
  }

  fun clearPose() {
    points = emptyMap()
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0 || points.isEmpty()) {
      return
    }

    for ((startName, endName) in SKELETON_LINES) {
      val startPoint = points[startName]
      val endPoint = points[endName]
      if (startPoint == null || endPoint == null) {
        continue
      }
      val start = toViewPoint(startPoint)
      val end = toViewPoint(endPoint)
      canvas.drawLine(start.x, start.y, end.x, end.y, linePaint)
    }

    for (point in points.values) {
      val viewPoint = toViewPoint(point)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 9f, pointStrokePaint)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 7f, pointPaint)
    }
  }

  /**
   * Transform canonical upright coordinates to view coordinates using transformation matrix.
   */
  private fun toViewPoint(point: WakeFitPosePoint): PointF {
    val values = transformValues

    // Apply 3x3 transformation matrix
    // Matrix maps: [x, y, 1] → [x', y', 1]
    // x' = m[0]*x + m[3]*y + m[6]
    // y' = m[1]*x + m[4]*y + m[7]
    val viewX = values[0] * point.x + values[3] * point.y + values[6]
    val viewY = values[1] * point.x + values[4] * point.y + values[7]

    return PointF(viewX, viewY)
  }

  companion object {
    // Threshold: 0.55 for consistent quality across platforms
    private const val CONFIDENCE_THRESHOLD = 0.55f

    private val SKELETON_LINES = listOf(
      "leftShoulder" to "rightShoulder",
      "leftShoulder" to "leftElbow",
      "leftElbow" to "leftWrist",
      "rightShoulder" to "rightElbow",
      "rightElbow" to "rightWrist",
      "leftShoulder" to "leftHip",
      "rightShoulder" to "rightHip",
      "leftHip" to "rightHip",
      "leftHip" to "leftKnee",
      "leftKnee" to "leftAnkle",
      "rightHip" to "rightKnee",
      "rightKnee" to "rightAnkle",
    )
  }
}
