package com.wakefit.posedetector

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.View.MeasureSpec
import android.view.ViewGroup
import android.widget.ImageView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
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
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class WakeFitPoseCameraView(
  context: android.content.Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val previewImageView = ImageView(context)
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
  private var lastPreviewFrameAtMillis = 0L

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
    previewImageView.scaleType = ImageView.ScaleType.CENTER_CROP
    previewImageView.setBackgroundColor(Color.TRANSPARENT)
    addView(
      previewImageView,
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

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val measuredWidth = MeasureSpec.getSize(widthMeasureSpec)
    val measuredHeight = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredHeight)
    previewImageView.measure(
      MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY),
    )
    poseOverlayView.measure(
      MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    previewImageView.layout(0, 0, right - left, bottom - top)
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
          previewImageView.postDelayed(
            {
              bindCameraUseCases(provider, lifecycleOwner, startToken)
            },
            CAMERA_BIND_DELAY_MS,
          )
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
      Log.i(TAG, "binding analysis target=${TARGET_RESOLUTION.width}x${TARGET_RESOLUTION.height} rotation=$targetRotation")
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
        analysis,
      )
      camera.cameraInfo.cameraState.observe(lifecycleOwner) { state ->
        Log.i(TAG, "camera state ${state.type} error=${state.error}")
      }
      Log.i(TAG, "analysis-only bind success")
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
    lastPreviewFrameAtMillis = 0L
    cameraProvider?.unbindAll()
    previewImageView.setImageDrawable(null)
    poseOverlayView.clearPose()
    Log.i(TAG, "camera stopped")
  }

  private fun analyzeImage(imageProxy: ImageProxy) {
    if (!loggedFirstFrame) {
      loggedFirstFrame = true
      Log.i(TAG, "first analysis frame ${imageProxy.width}x${imageProxy.height} rotation=${imageProxy.imageInfo.rotationDegrees}")
    }

    val mediaImage = imageProxy.image
    if (mediaImage == null) {
      imageProxy.close()
      return
    }
    if (processingFrame) {
      imageProxy.close()
      return
    }

    processingFrame = true
    val displayBitmap = createDisplayBitmap(mediaImage, imageProxy.imageInfo.rotationDegrees)
    if (displayBitmap == null) {
      processingFrame = false
      imageProxy.close()
      return
    }

    renderPreviewFrame(displayBitmap)

    val inputImage = InputImage.fromBitmap(displayBitmap, 0)
    detector.process(inputImage)
      .addOnSuccessListener { pose ->
        emitPoseFrame(pose, displayBitmap.width, displayBitmap.height)
      }
      .addOnFailureListener { error ->
        emitCameraError(error.message ?: "POSE_DETECTION_FAILED")
      }
      .addOnCompleteListener {
        processingFrame = false
        imageProxy.close()
      }
  }

  private fun createDisplayBitmap(image: Image, rotationDegrees: Int): Bitmap? {
    return try {
      val nv21 = yuv420ToNv21(image)
      val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
      val outputStream = ByteArrayOutputStream()
      yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), PREVIEW_JPEG_QUALITY, outputStream)
      val jpegBytes = outputStream.toByteArray()
      val rawBitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size) ?: return null
      val matrix = Matrix().apply {
        postRotate(rotationDegrees.toFloat())
        if (cameraFacing != "back") {
          postScale(-1f, 1f)
        }
      }
      Bitmap.createBitmap(rawBitmap, 0, 0, rawBitmap.width, rawBitmap.height, matrix, true)
    } catch (error: RuntimeException) {
      Log.e(TAG, "display bitmap conversion failed", error)
      null
    }
  }

  private fun renderPreviewFrame(displayBitmap: Bitmap) {
    val now = System.currentTimeMillis()
    if (now - lastPreviewFrameAtMillis < PREVIEW_FRAME_INTERVAL_MS) {
      return
    }
    lastPreviewFrameAtMillis = now

    previewImageView.post {
      previewImageView.setImageBitmap(displayBitmap)
    }
  }

  private fun yuv420ToNv21(image: Image): ByteArray {
    val width = image.width
    val height = image.height
    val ySize = width * height
    val uvSize = width * height / 4
    val output = ByteArray(ySize + uvSize * 2)

    copyPlane(image.planes[0], width, height, output, 0, 1)
    copyPlane(image.planes[2], width / 2, height / 2, output, ySize, 2)
    copyPlane(image.planes[1], width / 2, height / 2, output, ySize + 1, 2)

    return output
  }

  private fun copyPlane(
    plane: Image.Plane,
    width: Int,
    height: Int,
    output: ByteArray,
    outputOffset: Int,
    outputPixelStride: Int,
  ) {
    val buffer = plane.buffer.duplicate()
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    var outputIndex = outputOffset

    for (row in 0 until height) {
      val rowOffset = row * rowStride
      for (col in 0 until width) {
        val inputIndex = rowOffset + col * pixelStride
        if (inputIndex < buffer.limit() && outputIndex < output.size) {
          output[outputIndex] = buffer.get(inputIndex)
        }
        outputIndex += outputPixelStride
      }
    }
  }

  private fun emitPoseFrame(pose: Pose, frameWidth: Int, frameHeight: Int) {
    val landmarks = collectPosePoints(pose)
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
        false,
      )
    }

    onPoseFrame(
      mapOf(
        "timestampMs" to System.currentTimeMillis().toDouble(),
        "imageWidth" to frameWidth,
        "imageHeight" to frameHeight,
        "landmarks" to landmarks.map { toEventLandmark(it) },
      ),
    )
  }

  private fun collectPosePoints(pose: Pose): List<WakeFitPosePoint> {
    return listOfNotNull(
      toPosePoint(pose, PoseLandmark.NOSE, "nose"),
      toPosePoint(pose, PoseLandmark.LEFT_EYE, "leftEye"),
      toPosePoint(pose, PoseLandmark.RIGHT_EYE, "rightEye"),
      toPosePoint(pose, PoseLandmark.LEFT_EAR, "leftEar"),
      toPosePoint(pose, PoseLandmark.RIGHT_EAR, "rightEar"),
      toPosePoint(pose, PoseLandmark.LEFT_SHOULDER, "leftShoulder"),
      toPosePoint(pose, PoseLandmark.LEFT_ELBOW, "leftElbow"),
      toPosePoint(pose, PoseLandmark.LEFT_WRIST, "leftWrist"),
      toPosePoint(pose, PoseLandmark.LEFT_HIP, "leftHip"),
      toPosePoint(pose, PoseLandmark.LEFT_KNEE, "leftKnee"),
      toPosePoint(pose, PoseLandmark.LEFT_ANKLE, "leftAnkle"),
      toPosePoint(pose, PoseLandmark.RIGHT_SHOULDER, "rightShoulder"),
      toPosePoint(pose, PoseLandmark.RIGHT_ELBOW, "rightElbow"),
      toPosePoint(pose, PoseLandmark.RIGHT_WRIST, "rightWrist"),
      toPosePoint(pose, PoseLandmark.RIGHT_HIP, "rightHip"),
      toPosePoint(pose, PoseLandmark.RIGHT_KNEE, "rightKnee"),
      toPosePoint(pose, PoseLandmark.RIGHT_ANKLE, "rightAnkle"),
    )
  }

  private fun toPosePoint(pose: Pose, type: Int, name: String): WakeFitPosePoint? {
    val landmark = pose.getPoseLandmark(type) ?: return null
    val position = landmark.position
    return WakeFitPosePoint(
      name,
      position.x,
      position.y,
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
    private const val CAMERA_BIND_DELAY_MS = 150L
    private const val PREVIEW_FRAME_INTERVAL_MS = 180L
    private const val PREVIEW_JPEG_QUALITY = 55
    private val TARGET_RESOLUTION = Size(640, 480)
  }
}
