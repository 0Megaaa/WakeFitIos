package com.wakefit.posedetector

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
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
  private var cameraProvider: ProcessCameraProvider? = null
  private var processingFrame = false
  private var cameraStarted = false
  private var loggedFirstFrame = false
  private var loggedFirstPose = false
  private var cameraStartToken = 0

  private val onPoseFrame by EventDispatcher()
  private val onCameraError by EventDispatcher()

  var cameraFacing: String = "front"
    set(value) {
      field = value
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
    super.onDetachedFromWindow()
  }

  private fun restartCamera() {
    stopCamera()
    maybeStartCamera()
  }

  private fun maybeStartCamera() {
    if (!isAttachedToWindow || cameraStarted) {
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

    cameraStarted = true
    val startToken = ++cameraStartToken
    Log.i(TAG, "starting camera facing=$cameraFacing view=${width}x${height}")

    val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
    cameraProviderFuture.addListener(
      {
        try {
          val provider = cameraProviderFuture.get()
          cameraProvider = provider
          bindCameraUseCases(provider, lifecycleOwner, startToken)
        } catch (error: Exception) {
          cameraStarted = false
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
    if (!cameraStarted || cameraStartToken != startToken || !isAttachedToWindow) {
      Log.i(TAG, "skip stale camera bind token=$startToken current=$cameraStartToken")
      return
    }

    try {
      val targetRotation = display?.rotation ?: Surface.ROTATION_0
      Log.i(TAG, "binding camera target=${TARGET_RESOLUTION.width}x${TARGET_RESOLUTION.height} rotation=$targetRotation")

      // Preview use case for live camera feed
      val preview = Preview.Builder()
        .setTargetResolution(TARGET_RESOLUTION)
        .setTargetRotation(targetRotation)
        .build()
        .also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }

      // ImageAnalysis for ML Kit pose detection
      val analysis = ImageAnalysis.Builder()
        .setTargetResolution(TARGET_RESOLUTION)
        .setTargetRotation(targetRotation)
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .build()
        .also {
          it.setAnalyzer(analysisExecutor) { imageProxy ->
            analyzeImage(imageProxy)
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
      Log.i(TAG, "camera bind success preview+analysis")
    } catch (error: Exception) {
      cameraStarted = false
      emitCameraError(error.message ?: "CAMERA_START_FAILED")
    }
  }

  private fun stopCamera() {
    processingFrame = false
    cameraStarted = false
    cameraStartToken += 1
    loggedFirstFrame = false
    loggedFirstPose = false
    cameraProvider?.unbindAll()
    poseOverlayView.clearPose()
    Log.i(TAG, "camera stopped")
  }

  private fun analyzeImage(imageProxy: ImageProxy) {
    if (!loggedFirstFrame) {
      loggedFirstFrame = true
      Log.i(TAG, "first analysis frame ${imageProxy.width}x${imageProxy.height} rotation=${imageProxy.imageInfo.rotationDegrees}")
    }

    if (processingFrame) {
      imageProxy.close()
      return
    }

    processingFrame = true

    @androidx.camera.core.ExperimentalGetImage
    val mediaImage = imageProxy.image
    if (mediaImage == null) {
      processingFrame = false
      imageProxy.close()
      return
    }

    // Use InputImage.fromMediaImage for efficient direct access (no JPEG compression)
    val inputImage = InputImage.fromMediaImage(
      mediaImage,
      imageProxy.imageInfo.rotationDegrees,
    )

    // Mirror coordinates for front camera
    val isFrontCamera = cameraFacing != "back"
    val imageWidth = imageProxy.width
    val imageHeight = imageProxy.height

    detector.process(inputImage)
      .addOnSuccessListener { pose ->
        emitPoseFrame(pose, imageWidth, imageHeight, isFrontCamera)
      }
      .addOnFailureListener { error ->
        emitCameraError(error.message ?: "POSE_DETECTION_FAILED")
      }
      .addOnCompleteListener {
        processingFrame = false
        imageProxy.close()
      }
  }

  private fun emitPoseFrame(pose: Pose, frameWidth: Int, frameHeight: Int, mirrorFront: Boolean) {
    val landmarks = collectPosePoints(pose, frameWidth, frameHeight, mirrorFront)
    if (!loggedFirstPose && landmarks.isNotEmpty()) {
      loggedFirstPose = true
      Log.i(TAG, "first pose landmarks=${landmarks.size} display=${frameWidth}x${frameHeight}")
    }
    poseOverlayView.post {
      poseOverlayView.updatePose(
        landmarks,
        frameWidth,
        frameHeight,
        0,
        mirrorFront,
      )
    }

    onPoseFrame(
      mapOf(
        "timestampMs" to System.currentTimeMillis().toDouble(),
        "imageWidth" to frameWidth,
        "imageHeight" to frameHeight,
        "landmarks" to landmarks.map { toEventLandmark(it) },
        "cameraFacing" to cameraFacing,
        "source" to "mlkit",
        "coordinateSpace" to "upright-top-left-unmirrored",
      ),
    )
  }

  private fun collectPosePoints(pose: Pose, imageWidth: Int, imageHeight: Int, mirror: Boolean): List<WakeFitPosePoint> {
    val isPortrait = imageWidth < imageHeight
    val effectiveWidth = if (isPortrait) imageHeight else imageWidth
    val effectiveHeight = if (isPortrait) imageWidth else imageHeight

    return listOfNotNull(
      toPosePoint(pose, PoseLandmark.LEFT_SHOULDER, "leftShoulder", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.LEFT_ELBOW, "leftElbow", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.LEFT_WRIST, "leftWrist", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.LEFT_HIP, "leftHip", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.LEFT_KNEE, "leftKnee", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.LEFT_ANKLE, "leftAnkle", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_SHOULDER, "rightShoulder", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_ELBOW, "rightElbow", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_WRIST, "rightWrist", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_HIP, "rightHip", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_KNEE, "rightKnee", effectiveWidth, effectiveHeight, mirror, isPortrait),
      toPosePoint(pose, PoseLandmark.RIGHT_ANKLE, "rightAnkle", effectiveWidth, effectiveHeight, mirror, isPortrait),
    )
  }

  private fun toPosePoint(
    pose: Pose,
    type: Int,
    name: String,
    imageWidth: Int,
    imageHeight: Int,
    mirror: Boolean,
    isPortrait: Boolean,
  ): WakeFitPosePoint? {
    val landmark = pose.getPoseLandmark(type) ?: return null
    val position = landmark.position

    // MLKit returns normalized [0,1] coordinates with origin at top-left
    // Convert to upright-top-left-unmirrored coordinate space
    var x = position.x * imageWidth
    var y = position.y * imageHeight

    // Handle rotation: MLKit coordinates are in image space, need to rotate to view space
    if (isPortrait) {
      val tempX = x
      x = y
      y = imageWidth - tempX
    }

    // Mirror left/right for front camera to match the upright-top-left-unmirrored contract
    if (mirror) {
      x = imageHeight - x
    }

    return WakeFitPosePoint(
      name,
      x,
      y,
      landmark.inFrameLikelihood,
    )
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
    return if (cameraFacing == "back") {
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
