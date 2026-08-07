package com.wakefit.posedetector

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.view.View

data class WakeFitPosePoint(
  val name: String,
  val x: Float,
  val y: Float,
  val confidence: Float,
)

/**
 * Pose overlay view for displaying skeleton overlay on camera preview.
 *
 * Receives canonical upright-top-left-unmirrored coordinates (from ML Kit).
 * Transforms to view coordinates using CameraX transformation Matrix.
 *
 * Coordinate pipeline:
 * - ML Kit provides points in canonical upright-top-left-unmirrored space
 * - Matrix transforms to view coordinates
 * - Front camera mirroring is handled by CameraX transformation
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

  // Canonical upright coordinates
  private var points: Map<String, WakeFitPosePoint> = emptyMap()
  // Transformation matrix from canonical coordinates to view coordinates
  // null means transform is not yet available - skip drawing but keep pose data
  private var transformMatrix: Matrix? = null

  fun updatePose(
    nextPoints: List<WakeFitPosePoint>,
    matrix: Matrix?,
  ) {
    // Filter by confidence threshold
    points = nextPoints
      .filter { it.confidence >= CONFIDENCE_THRESHOLD }
      .associateBy { it.name }

    // Store the matrix - make a copy to avoid external modification
    transformMatrix = matrix?.let { Matrix(it) }

    invalidate()
  }

  fun clearPose() {
    points = emptyMap()
    transformMatrix = null
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0 || points.isEmpty() || transformMatrix == null) {
      return
    }

    val matrix = transformMatrix!!

    for ((startName, endName) in SKELETON_LINES) {
      val startPoint = points[startName]
      val endPoint = points[endName]
      if (startPoint == null || endPoint == null) {
        continue
      }
      val start = toViewPoint(startPoint, matrix)
      val end = toViewPoint(endPoint, matrix)
      canvas.drawLine(start.x, start.y, end.x, end.y, linePaint)
    }

    for (point in points.values) {
      val viewPoint = toViewPoint(point, matrix)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 9f, pointStrokePaint)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 7f, pointPaint)
    }
  }

  /**
   * Transform canonical coordinates to view coordinates using Matrix.
   *
   * Android Matrix applies transformation as:
   * [x']   [m00 m01 m02]   [x]
   * [y'] = [m10 m11 m12] * [y]
   * [1  ]   [m20 m21 m22]   [1]
   *
   * Using mapPoints: floatArrayOf(x, y) -> {x', y'}
   */
  private fun toViewPoint(point: WakeFitPosePoint, matrix: Matrix): PointF {
    val floatCoords = floatArrayOf(point.x, point.y)
    matrix.mapPoints(floatCoords)
    return PointF(floatCoords[0], floatCoords[1])
  }

  companion object {
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
