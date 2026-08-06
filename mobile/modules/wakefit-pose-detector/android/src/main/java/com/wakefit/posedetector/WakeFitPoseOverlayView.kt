package com.wakefit.posedetector

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
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
 * Transforms to view coordinates:
 * 1. For front camera: mirror X (PreviewView shows mirrored preview)
 * 2. Apply aspect-fill scaling
 *
 * Key: canonical coordinates are already upright, so NO rotation is needed here.
 * The front camera mirror is because PreviewView shows mirrored output for user-familiar selfie view.
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
  // Front camera: mirror X to match PreviewView mirrored preview
  private var isFrontCamera = false

  fun updatePose(
    nextPoints: List<WakeFitPosePoint>,
    nextImageWidth: Int,
    nextImageHeight: Int,
    rotationDegrees: Int,
    frontCamera: Boolean,
  ) {
    // Filter by confidence threshold
    points = nextPoints
      .filter { it.confidence >= CONFIDENCE_THRESHOLD }
      .associateBy { it.name }
    imageWidth = nextImageWidth
    imageHeight = nextImageHeight
    // Front camera: PreviewView shows mirrored preview, so mirror overlay X
    isFrontCamera = frontCamera
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

    // Aspect-fill transformation: scale to fill view while preserving aspect ratio
    val scaleX = width.toFloat() / imageWidth
    val scaleY = height.toFloat() / imageHeight
    val scale = max(scaleX, scaleY)

    // Center the scaled image
    val renderedWidth = imageWidth * scale
    val renderedHeight = imageHeight * scale
    val offsetX = (width - renderedWidth) / 2f
    val offsetY = (height - renderedHeight) / 2f

    for ((startName, endName) in SKELETON_LINES) {
      val startPoint = points[startName]
      val endPoint = points[endName]
      if (startPoint == null || endPoint == null) {
        continue
      }
      val start = toViewPoint(startPoint, scale, offsetX, offsetY)
      val end = toViewPoint(endPoint, scale, offsetX, offsetY)
      canvas.drawLine(start.x, start.y, end.x, end.y, linePaint)
    }

    for (point in points.values) {
      val viewPoint = toViewPoint(point, scale, offsetX, offsetY)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 9f, pointStrokePaint)
      canvas.drawCircle(viewPoint.x, viewPoint.y, 7f, pointPaint)
    }
  }

  /**
   * Transform canonical upright coordinates to view coordinates.
   *
   * Canonical: upright-top-left-unmirrored
   * - Origin top-left
   * - X increases right
   * - Y increases down
   *
   * For front camera: mirror X to match PreviewView mirrored preview
   */
  private fun toViewPoint(
    point: WakeFitPosePoint,
    scale: Float,
    offsetX: Float,
    offsetY: Float,
  ): PointF {
    var viewX = point.x
    // Mirror X for front camera to match PreviewView mirrored preview
    if (isFrontCamera) {
      viewX = imageWidth - point.x
    }
    return PointF(
      viewX * scale + offsetX,
      point.y * scale + offsetY,
    )
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
