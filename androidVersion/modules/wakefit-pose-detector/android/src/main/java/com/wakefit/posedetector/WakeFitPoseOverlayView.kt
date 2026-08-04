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

  private var points: Map<String, WakeFitPosePoint> = emptyMap()
  private var imageWidth = 0
  private var imageHeight = 0
  private var rotationDegrees = 0
  private var mirror = true

  fun updatePose(
    nextPoints: List<WakeFitPosePoint>,
    nextImageWidth: Int,
    nextImageHeight: Int,
    nextRotationDegrees: Int,
    nextMirror: Boolean,
  ) {
    points = nextPoints
      .filter { it.confidence >= MIN_CONFIDENCE }
      .associateBy { it.name }
    imageWidth = nextImageWidth
    imageHeight = nextImageHeight
    rotationDegrees = nextRotationDegrees
    mirror = nextMirror
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

  private fun toViewPoint(point: WakeFitPosePoint): PointF {
    val rotated = rotatePoint(point.x, point.y)
    val sourceWidth = rotatedImageWidth().toFloat()
    val sourceHeight = rotatedImageHeight().toFloat()
    val mappedX = if (mirror) sourceWidth - rotated.x else rotated.x
    val scale = max(width / sourceWidth, height / sourceHeight)
    val offsetX = (width - sourceWidth * scale) / 2f
    val offsetY = (height - sourceHeight * scale) / 2f

    return PointF(
      mappedX * scale + offsetX,
      rotated.y * scale + offsetY,
    )
  }

  private fun rotatePoint(x: Float, y: Float): PointF {
    return when (((rotationDegrees % 360) + 360) % 360) {
      90 -> PointF(imageHeight - y, x)
      180 -> PointF(imageWidth - x, imageHeight - y)
      270 -> PointF(y, imageWidth - x)
      else -> PointF(x, y)
    }
  }

  private fun rotatedImageWidth(): Int {
    val normalizedRotation = ((rotationDegrees % 360) + 360) % 360
    return if (normalizedRotation == 90 || normalizedRotation == 270) imageHeight else imageWidth
  }

  private fun rotatedImageHeight(): Int {
    val normalizedRotation = ((rotationDegrees % 360) + 360) % 360
    return if (normalizedRotation == 90 || normalizedRotation == 270) imageWidth else imageHeight
  }

  companion object {
    private const val MIN_CONFIDENCE = 0.35f
    private val SKELETON_LINES = listOf(
      "leftEar" to "leftEye",
      "leftEye" to "nose",
      "nose" to "rightEye",
      "rightEye" to "rightEar",
      "nose" to "leftShoulder",
      "nose" to "rightShoulder",
      "leftShoulder" to "rightShoulder",
      "leftHip" to "rightHip",
      "leftShoulder" to "leftElbow",
      "leftElbow" to "leftWrist",
      "rightShoulder" to "rightElbow",
      "rightElbow" to "rightWrist",
      "leftShoulder" to "leftHip",
      "rightShoulder" to "rightHip",
      "leftHip" to "leftKnee",
      "leftKnee" to "leftAnkle",
      "rightHip" to "rightKnee",
      "rightKnee" to "rightAnkle",
    )
  }
}
