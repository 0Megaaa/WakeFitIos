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
import androidx.camera.core.UseCaseGroup
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.camera.view.transform.ImageProxyTransformFactory
import androidx.camera.view.transform.CoordinateTransform
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
 * 1. UseCaseGroup with ViewPort ensures Preview and ImageAnalysis share the same view crop
 * 2. ImageProxyTransformFactory creates transformation from analysis to PreviewView
 * 3. ML Kit processes rotated image via InputImage.fromMediaImage(rotationDegrees)
 * 4. ML Kit returns pixel coordinates in canonical upright image space
 * 5. Emit canonical PoseFrame to JS (upright-top-left-unmirrored)
 * 6. Overlay uses CoordinateTransform for accurate display positioning
 */
class WakeFitPoseCameraView(
  context: android.content.Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val previewView = PreviewView(context)
  private val poseOverlayView = WakeFitPoseOverlayView(context)
  private var analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private var detector = PoseDetection.getClient(
    AccuratePoseDetectorOptions.Builder()
      .setDetectorMode(AccuratePoseDetectorOptions.STREAM_MODE)
      .build(),
  )

  // Camera lifecycle state
  private var cameraProvider: ProcessCameraProvider? = null
  private var cameraStartToken = 0
  private var cameraFacingValue = "front"
  private var pendingBind = false

  // Frame processing state - token-bound to prevent stale frame processing
  private var processingToken = -1
  private var loggedFirstFrame = false
  private var loggedFirstPose = false

  private val onPoseFrame by EventDispatcher()
  private val onCameraError by EventDispatcher()

  var cameraFacing: String = "front"
    set(value) {
      val normalized = if (value == "back") "back" else "front"
      if (field == normalized) return
      field = normalized
      cameraFacingValue = normalized
      if (isAttachedToWindow) {
        restartCamera()
      }
    }

  init {
    setClipChildren(false)
    setClipToPadding(false)
    previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
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
    super.onDetachedFromWindow()
  }

  override fun onViewRemoved(child: android.view.View?) {
    super.onViewRemoved(child)
    // Final cleanup when view is removed from hierarchy
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

    // Wait for ViewPort to be available before binding
    if (previewView.viewPort == null) {
      pendingBind = true
      Log.i(TAG, "waiting for ViewPort to be available")
      // Post to wait for next layout pass when ViewPort will be ready
      post {
        if (pendingBind && previewView.viewPort != null) {
          pendingBind = false
          startCamera()
        }
      }
      return
    }

    pendingBind = false
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
      Runnable {
        try {
          val provider = cameraProviderFuture.get()

          val selector = getCameraSelector()
          if (!provider.hasCamera(selector)) {
            emitCameraError("CAMERA_FACING_NOT_AVAILABLE")
            return@Runnable
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
    if (cameraStartToken != startToken || !isAttachedToWindow) {
      Log.i(TAG, "skip stale camera bind token=$startToken current=$cameraStartToken")
      return
    }

    // Verify ViewPort is available
    val viewPort = previewView.viewPort
    if (viewPort == null) {
      Log.i(TAG, "ViewPort not ready, retrying on next layout")
      pendingBind = true
      return
    }

    cameraProvider = provider

    try {
      val targetRotation = display?.rotation ?: Surface.ROTATION_0
      Log.i(TAG, "binding camera facing=$cameraFacingValue rotation=$targetRotation")

      // Preview - PreviewView handles display transformation
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

      // Use ViewPort to ensure Preview and ImageAnalysis share the same crop
      val useCaseGroup = UseCaseGroup.Builder()
        .addUseCase(preview)
        .addUseCase(analysis)
        .setViewPort(viewPort)
        .build()

      provider.unbindAll()
      provider.bindToLifecycle(
        lifecycleOwner,
        getCameraSelector(),
        useCaseGroup,
      )

      Log.i(TAG, "camera bind success")
    } catch (error: Exception) {
      cameraProvider = null
      emitCameraError(error.message ?: "CAMERA_BIND_FAILED")
    }
  }

  private fun stopCamera() {
    processingToken = -1
    cameraStartToken += 1
    loggedFirstFrame = false
    loggedFirstPose = false
    cameraProvider?.unbindAll()
    cameraProvider = null
    pendingBind = false
    poseOverlayView.clearPose()
    Log.i(TAG, "camera stopped token=$cameraStartToken")
  }

  /**
   * Final cleanup - called when the view is permanently destroyed.
   * This is the proper place to release detector and executor resources.
   */
  fun destroyResources() {
    Log.i(TAG, "destroying resources detector and executor")
    detector.close()
    analysisExecutor.shutdown()
  }

  /**
   * Analyze a single image frame.
   * Token parameter ensures stale frames from previous camera session are discarded.
   */
  private fun analyzeImage(imageProxy: ImageProxy, bindToken: Int) {
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
      // Only clear token if it's still for THIS frame
      if (processingToken == bindToken) {
        processingToken = -1
      }
      imageProxy.close()
      return
    }

    // Capture frame metadata BEFORE async operation
    val frameToken = bindToken
    val frameFacing = cameraFacingValue
    val frameGeneration = cameraStartToken
    val frameWidth = imageProxy.width
    val frameHeight = imageProxy.height
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val isFrontCamera = frameFacing == "front"

    val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

    detector.process(inputImage)
      .addOnSuccessListener { pose: Pose ->
        // Validate ALL tokens match
        if (processingToken != frameToken || cameraStartToken != frameGeneration) {
          Log.i(TAG, "discard stale detection token=$frameToken gen=$frameGeneration")
          return@addOnSuccessListener
        }
        if (!isAttachedToWindow) {
          return@addOnSuccessListener
        }
        emitPoseFrame(pose, frameToken, frameFacing, frameWidth, frameHeight, imageProxy)
      }
      .addOnFailureListener { error: Exception ->
        if (processingToken == frameToken && cameraStartToken == frameGeneration && isAttachedToWindow) {
          emitCameraError(error.message ?: "POSE_DETECTION_FAILED")
        }
      }
      .addOnCompleteListener {
        // ONLY clear processingToken if it matches THIS frame
        if (processingToken == frameToken) {
          processingToken = -1
        }
        imageProxy.close()
      }
  }

  /**
   * Emit pose data to JS and update overlay.
   */
  private fun emitPoseFrame(
    pose: Pose,
    frameToken: Int,
    frameFacing: String,
    sourceWidth: Int,
    sourceHeight: Int,
    imageProxy: ImageProxy,
  ) {
    // Final validation before emitting
    if (cameraStartToken != frameToken || !isAttachedToWindow || cameraFacingValue != frameFacing) {
      Log.i(TAG, "discard frame before emit token=$frameToken facing=$frameFacing")
      return
    }

    // ML Kit coordinates are in rotated (upright) image space
    val (uprightWidth, uprightHeight) = getUprightDimensions(sourceWidth, sourceHeight, imageProxy.imageInfo.rotationDegrees)

    val landmarks = collectAllPosePoints(pose, uprightWidth, uprightHeight)

    if (!loggedFirstPose && landmarks.isNotEmpty()) {
      loggedFirstPose = true
      Log.i(TAG, "first pose landmarks=${landmarks.size} canonical=${uprightWidth}x${uprightHeight}")
    }

    // Compute overlay transformation using CameraX official API
    val overlayMatrix = computeOverlayTransform(imageProxy)

    // Update overlay - pass null matrix if transform not available
    poseOverlayView.post {
      if (cameraStartToken != frameToken || !isAttachedToWindow || cameraFacingValue != frameFacing) {
        return@post
      }
      poseOverlayView.updatePose(landmarks, overlayMatrix)
    }

    // Emit canonical PoseFrame to JS (even if overlay transform is not ready)
    onPoseFrame(
      mapOf(
        "timestampMs" to System.currentTimeMillis().toDouble(),
        "imageWidth" to uprightWidth,
        "imageHeight" to uprightHeight,
        "landmarks" to landmarks.map { toEventLandmark(it) },
        "cameraFacing" to frameFacing,
        "source" to "mlkit",
        "coordinateSpace" to "upright-top-left-unmirrored",
      ),
    )
  }

  /**
   * Compute transformation matrix for overlay using CameraX official API.
   *
   * Uses ImageProxyTransformFactory + PreviewView.outputTransform + CoordinateTransform
   * to properly map from analysis image coordinates to view coordinates.
   *
   * Returns null if transforms are not available, in which case the overlay
   * will not be drawn but canonical PoseFrame will still be sent to JS.
   */
  private fun computeOverlayTransform(imageProxy: ImageProxy): Matrix? {
    // Get target transformation (PreviewView)
    val targetTransform = previewView.outputTransform ?: return null

    // Create source transformation from ImageProxy
    val factory = ImageProxyTransformFactory()
    factory.setUsingCropRect(true)
    factory.setUsingRotationDegrees(true)

    val sourceTransform = factory.getOutputTransform(imageProxy)

    // Create coordinate transform from source to target
    val coordinateTransform = CoordinateTransform(sourceTransform, targetTransform)

    // Apply the transformation
    val resultMatrix = Matrix()
    coordinateTransform.transform(resultMatrix)

    return resultMatrix
  }

  private fun getUprightDimensions(sourceWidth: Int, sourceHeight: Int, rotationDegrees: Int): Pair<Int, Int> {
    return when (rotationDegrees) {
      90, 270 -> Pair(sourceHeight, sourceWidth)
      else -> Pair(sourceWidth, sourceHeight)
    }
  }

  /**
   * Collect ALL 12 pose landmarks in canonical upright-top-left-unmirrored pixel coordinates.
   */
  private fun collectAllPosePoints(pose: Pose, imageWidth: Int, imageHeight: Int): List<WakeFitPosePoint> {
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
