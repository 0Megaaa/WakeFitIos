package com.wakefit.posedetector

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Matrix
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.TransformMetadata
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.pose.Pose
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.PoseLandmark
import com.google.mlkit.vision.pose.accurate.AccuratePoseDetectorOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Android Pose Camera implementation using CameraX and ML Kit.
 *
 * Coordinate pipeline:
 * 1. ImageProxy provides pixel buffer with rotationDegrees and cropRect
 * 2. InputImage.fromMediaImage(mediaImage, rotationDegrees) tells ML Kit to process rotated image
 * 3. ML Kit returns pixel coordinates in the rotated (canonical upright) image space
 * 4. We emit canonical PoseFrame to JS (upright-top-left-unmirrored)
 * 5. We compute PreviewView transformation for overlay using CameraX official API
 *
 * Key design decisions:
 * - ML Kit landmark positions are in pixel coordinates of the rotated image
 * - InputImage.withRotationDegrees() rotates before detection, so coordinates
 *   are relative to the rotated (canonical upright) image space
 * - PreviewView.outputTransform provides official CameraX transformation matrix
 * - Overlay uses PreviewView transformation for accurate display positioning
 */
class WakeFitPoseCameraView(
  context: android.content.Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val previewView = PreviewView(context)
  private val poseOverlayView = WakeFitPoseOverlayView(context)
  private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private val detector = PoseDetection.getClient(
    AccuratePoseDetectorOptions.Builder()
      .setDetectorMode(AccuratePoseDetectorOptions.STREAM_MODE)
      .build(),
  )

  // Camera lifecycle state
  private var cameraProvider: ProcessCameraProvider? = null
  private var cameraStartToken = 0
  private var cameraFacingValue = "front"

  // Frame processing state - token-bound to prevent stale frame processing
  private var processingToken = -1
  private var loggedFirstFrame = false
  private var loggedFirstPose = false

  private val onPoseFrame by EventDispatcher()
  private val onCameraError by EventDispatcher()

  var cameraFacing: String = "front"
    set(value) {
      // Normalize to front/back
      val normalized = if (value == "back") "back" else "front"
      if (field == normalized) return // No change
      field = normalized
      cameraFacingValue = normalized
      if (isAttachedToWindow) {
        restartCamera()
      }
    }

  init {
    setClipChildren(false)
    setClipToPadding(false)
    addView(
      previewView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    addView(
      poseOverlayView,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    previewView.layout(0, 0, right - left, bottom - top)
    poseOverlayView.layout(0, 0, right - left, bottom - top)
    if (changed) {
      Log.i(TAG, "layout ${right - left}x${bottom - top}")
    }
    maybeStartCamera()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Log.i(TAG, "attached")
    maybeStartCamera()
  }

  override fun onDetachedFromWindow() {
    stopCamera()
    releaseResources()
    super.onDetachedFromWindow()
  }

  private fun restartCamera() {
    stopCamera()
    maybeStartCamera()
  }

  private fun maybeStartCamera() {
    if (!isAttachedToWindow || cameraProvider != null) {
      return
    }
    if (width <= 0 || height <= 0) {
      Log.i(TAG, "waiting for non-zero layout width=$width height=$height")
      return
    }

    startCamera()
  }

  private fun startCamera() {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitCameraError("CAMERA_PERMISSION_NOT_GRANTED")
      return
    }

    val lifecycleOwner = appContext.activityProvider?.currentActivity as? LifecycleOwner
    if (lifecycleOwner == null) {
      emitCameraError("ACTIVITY_IS_NOT_LIFECYCLE_OWNER")
      return
    }

    val startToken = ++cameraStartToken
    Log.i(TAG, "starting camera facing=$cameraFacingValue token=$startToken")

    val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
    cameraProviderFuture.addListener(
      {
        try {
          val provider = cameraProviderFuture.get()

          // Check if requested camera is available
          val selector = getCameraSelector()
          if (!provider.hasCamera(selector)) {
            emitCameraError("CAMERA_FACING_NOT_AVAILABLE")
            return
          }

          bindCameraUseCases(provider, lifecycleOwner, startToken)
        } catch (error: Exception) {
          emitCameraError(error.message ?: "CAMERA_START_FAILED")
        }
      },
      ContextCompat.getMainExecutor(context),
    )
  }

  private fun bindCameraUseCases(
    provider: ProcessCameraProvider,
    lifecycleOwner: LifecycleOwner,
    startToken: Int,
  ) {
    // Check if this is still the current bind request
    if (cameraStartToken != startToken || !isAttachedToWindow) {
      Log.i(TAG, "skip stale camera bind token=$startToken current=$cameraStartToken")
      return
    }

    cameraProvider = provider

    try {
      val targetRotation = display?.rotation ?: Surface.ROTATION_0
      Log.i(TAG, "binding camera facing=$cameraFacingValue rotation=$targetRotation")

      // Preview - PreviewView handles display transformation internally
      val preview = Preview.Builder()
        .setTargetResolution(TARGET_RESOLUTION)
        .setTargetRotation(targetRotation)
        .build()
        .also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }

      // ImageAnalysis - for ML Kit detection
      val analysis = ImageAnalysis.Builder()
        .setTargetResolution(TARGET_RESOLUTION)
        .setTargetRotation(targetRotation)
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
        .also {
          it.setAnalyzer(analysisExecutor) { imageProxy ->
            analyzeImage(imageProxy, startToken)
          }
        }

      provider.unbindAll()
      val camera = provider.bindToLifecycle(
        lifecycleOwner,
        getCameraSelector(),
        preview,
        analysis,
      )
      camera.cameraInfo.cameraState.observe(lifecycleOwner) { state ->
        Log.i(TAG, "camera state ${state.type} error=${state.error}")
      }
      Log.i(TAG, "camera bind success")
    } catch (error: Exception) {
      cameraProvider = null
      emitCameraError(error.message ?: "CAMERA_BIND_FAILED")
    }
  }

  private fun stopCamera() {
    processingToken = -1
    cameraStartToken += 1 // Invalidate any pending frames
    loggedFirstFrame = false
    loggedFirstPose = false
    cameraProvider?.unbindAll()
    cameraProvider = null
    poseOverlayView.clearPose()
    Log.i(TAG, "camera stopped token=${cameraStartToken}")
  }

  private fun releaseResources() {
    analysisExecutor.shutdown()
    detector.close()
    Log.i(TAG, "resources released")
  }

  /**
   * Analyze a single image frame.
   * Token parameter ensures stale frames from previous camera session are discarded.
   */
  private fun analyzeImage(imageProxy: ImageProxy, bindToken: Int) {
    // Discard stale frames from previous camera bind
    if (bindToken != cameraStartToken) {
      Log.i(TAG, "discard stale frame token=$bindToken current=$cameraStartToken")
      imageProxy.close()
      return
    }

    if (!loggedFirstFrame) {
      loggedFirstFrame = true
      Log.i(TAG, "first analysis frame " +
        "rawWidth=${imageProxy.width} rawHeight=${imageProxy.height} " +
        "rotation=${imageProxy.imageInfo.rotationDegrees} " +
        "cropRect=${imageProxy.cropRect} " +
        "facing=$cameraFacingValue")
    }

    if (processingToken == bindToken) {
      imageProxy.close()
      return
    }

    processingToken = bindToken

    @androidx.camera.core.ExperimentalGetImage
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
      processingToken = -1
      imageProxy.close()
      return
    }

    // InputImage.withRotationDegrees rotates the image before ML Kit processes it.
    // ML Kit returns coordinates in the rotated (canonical upright) image space.
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

    // Capture frame metadata for overlay transformation
    val frameWidth = imageProxy.width
    val frameHeight = imageProxy.height
    val cropRect = imageProxy.cropRect
    val isFrontCamera = cameraFacingValue == "front"

    detector.process(inputImage)
      .addOnSuccessListener { pose ->
        // Check token again after async detection
        if (processingToken != bindToken || bindToken != cameraStartToken) {
          Log.i(TAG, "discard stale detection token=$bindToken current=$cameraStartToken")
          return@addOnSuccessListener
        }
        if (!isAttachedToWindow) {
          return@addOnSuccessListener
        }
        emitPoseFrame(pose, frameWidth, frameHeight, rotationDegrees, cropRect, isFrontCamera, imageProxy)
      }
      .addOnFailureListener { error ->
        if (processingToken == bindToken && bindToken == cameraStartToken && isAttachedToWindow) {
          emitCameraError(error.message ?: "POSE_DETECTION_FAILED")
        }
      }
      .addOnCompleteListener {
        processingToken = -1
        imageProxy.close()
      }
  }

  /**
   * Emit pose data to JS and update overlay.
   *
   * @param pose ML Kit detection result
   * @param sourceWidth Raw ImageProxy width
   * @param sourceHeight Raw ImageProxy height
   * @param rotationDegrees ImageProxy rotation
   * @param cropRect ImageProxy crop rect
   * @param isFrontCamera Whether front camera is active
   * @param imageProxy The image proxy for coordinate transformation
   */
  private fun emitPoseFrame(
    pose: Pose,
    sourceWidth: Int,
    sourceHeight: Int,
    rotationDegrees: Int,
    cropRect: android.graphics.Rect,
    isFrontCamera: Boolean,
    imageProxy: ImageProxy,
  ) {
    // ML Kit coordinates are already in rotated (upright) space due to InputImage.withRotationDegrees
    // Calculate upright dimensions
    val (uprightWidth, uprightHeight) = getUprightDimensions(sourceWidth, sourceHeight, rotationDegrees)

    // Collect all 12 landmarks in canonical upright-top-left-unmirrored space
    val landmarks = collectAllPosePoints(pose, uprightWidth, uprightHeight)

    if (!loggedFirstPose && landmarks.isNotEmpty()) {
      loggedFirstPose = true
      Log.i(TAG, "first pose landmarks=${landmarks.size} canonical=${uprightWidth}x${uprightHeight}")
    }

    // Compute overlay coordinates using CameraX official transformation
    val overlayTransform = computeOverlayTransform(
      imageProxy,
      uprightWidth,
      uprightHeight,
      isFrontCamera,
    )

    // Update overlay with canonical coordinates and PreviewView transformation
    poseOverlayView.post {
      poseOverlayView.updatePose(
        landmarks,
        uprightWidth,
        uprightHeight,
        overlayTransform,
        isFrontCamera,
      )
    }

    // Emit canonical PoseFrame to JS (no mirroring in JS)
    onPoseFrame(
      mapOf(
        "timestampMs" to System.currentTimeMillis().toDouble(),
        "imageWidth" to uprightWidth,
        "imageHeight" to uprightHeight,
        "landmarks" to landmarks.map { toEventLandmark(it) },
        "cameraFacing" to cameraFacingValue,
        "source" to "mlkit",
        "coordinateSpace" to "upright-top-left-unmirrored",
      ),
    )
  }

  /**
   * Compute transformation matrix for overlay using CameraX official API.
   *
   * This uses PreviewView.outputTransform which provides the official CameraX
   * transformation from analysis image coordinates to view coordinates.
   *
   * The transformation accounts for:
   * - ImageProxy rotationDegrees
   * - ImageProxy cropRect
   * - PreviewView scale type (AspectFill)
   * - Front camera mirroring
   */
  private fun computeOverlayTransform(
    imageProxy: ImageProxy,
    canonicalWidth: Int,
    canonicalHeight: Int,
    isFrontCamera: Boolean,
  ): FloatArray {
    // Get the PreviewView transformation matrix
    val viewTransform = previewView.outputTransform

    if (viewTransform != null && !viewTransform.isIdentity) {
      // Use CameraX official transformation
      // This matrix maps from analysis image coordinates to view coordinates
      return viewTransform
    }

    // Fallback: manual calculation if PreviewView transform is not available
    return computeManualTransform(
      imageProxy,
      canonicalWidth,
      canonicalHeight,
      isFrontCamera,
    )
  }

  /**
   * Manual fallback transformation calculation.
   * Used when PreviewView.outputTransform is not available.
   */
  private fun computeManualTransform(
    imageProxy: ImageProxy,
    canonicalWidth: Int,
    canonicalHeight: Int,
    isFrontCamera: Boolean,
  ): FloatArray {
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val cropRect = imageProxy.cropRect

    // Build transformation matrix
    val matrix = Matrix()

    // 1. Apply crop offset (translate to crop region)
    matrix.postTranslate(-cropRect.left.toFloat(), -cropRect.top.toFloat())

    // 2. Apply rotation for upright orientation
    when (rotationDegrees) {
      90 -> matrix.postRotate(90f, cropRect.width() / 2f, cropRect.height() / 2f)
      180 -> matrix.postRotate(180f)
      270 -> matrix.postRotate(270f, cropRect.width() / 2f, cropRect.height() / 2f)
    }

    // 3. Scale to canonical dimensions
    val scaleX = canonicalWidth.toFloat() / cropRect.width()
    val scaleY = canonicalHeight.toFloat() / cropRect.height()
    matrix.postScale(scaleX, scaleY)

    // 4. Mirror for front camera (to match PreviewView display)
    if (isFrontCamera) {
      matrix.postScale(-1f, 1f, canonicalWidth / 2f, canonicalHeight / 2f)
    }

    val values = FloatArray(9)
    matrix.getValues(values)
    return values
  }

  /**
   * Get upright image dimensions based on rotation.
   * After rotation, portrait orientation means height > width.
   */
  private fun getUprightDimensions(sourceWidth: Int, sourceHeight: Int, rotationDegrees: Int): Pair<Int, Int> {
    return when (rotationDegrees) {
      90, 270 -> Pair(sourceHeight, sourceWidth) // Rotated: swap dimensions
      else -> Pair(sourceWidth, sourceHeight)     // 0 or 180: keep as-is
    }
  }

  /**
   * Collect ALL 12 pose landmarks in canonical upright-top-left-unmirrored pixel coordinates.
   *
   * ML Kit landmarks are in pixel coordinates of the rotated image (due to InputImage rotation).
   * For canonical upright-top-left-unmirrored:
   * - Origin at top-left
   * - X increases rightward
   * - Y increases downward
   * - Portrait orientation (height > width typically)
   * - NO mirroring for front camera
   */
  private fun collectAllPosePoints(pose: Pose, imageWidth: Int, imageHeight: Int): List<WakeFitPosePoint> {
    // All 12 key landmarks for both squat and push-up recognition
    val requiredTypes = listOf(
      PoseLandmark.LEFT_SHOULDER to "leftShoulder",
      PoseLandmark.RIGHT_SHOULDER to "rightShoulder",
      PoseLandmark.LEFT_ELBOW to "leftElbow",
      PoseLandmark.RIGHT_ELBOW to "rightElbow",
      PoseLandmark.LEFT_WRIST to "leftWrist",
      PoseLandmark.RIGHT_WRIST to "rightWrist",
      PoseLandmark.LEFT_HIP to "leftHip",
      PoseLandmark.RIGHT_HIP to "rightHip",
      PoseLandmark.LEFT_KNEE to "leftKnee",
      PoseLandmark.RIGHT_KNEE to "rightKnee",
      PoseLandmark.LEFT_ANKLE to "leftAnkle",
      PoseLandmark.RIGHT_ANKLE to "rightAnkle",
    )

    return requiredTypes.mapNotNull { (type, name) ->
      val landmark = pose.getPoseLandmark(type) ?: return@mapNotNull null
      val pos = landmark.position
      WakeFitPosePoint(
        name = name,
        // ML Kit coordinates are already in rotated image space (canonical upright)
        x = pos.x,
        y = pos.y,
        confidence = landmark.inFrameLikelihood,
      )
    }
  }

  private fun toEventLandmark(point: WakeFitPosePoint): Map<String, Any> {
    return mapOf(
      "name" to point.name,
      "x" to point.x.toDouble(),
      "y" to point.y.toDouble(),
      "confidence" to point.confidence.toDouble(),
    )
  }

  private fun getCameraSelector(): CameraSelector {
    return if (cameraFacingValue == "back") {
      CameraSelector.DEFAULT_BACK_CAMERA
    } else {
      CameraSelector.DEFAULT_FRONT_CAMERA
    }
  }

  private fun emitCameraError(message: String) {
    Log.e(TAG, message)
    onCameraError(mapOf("message" to message))
  }

  companion object {
    private const val TAG = "WakeFitCamera"
    private val TARGET_RESOLUTION = Size(640, 480)
  }
}
