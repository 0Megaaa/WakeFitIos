import AVFoundation
import ExpoModulesCore
import ImageIO
import UIKit
import Vision

public final class WakeFitPoseCameraView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onPoseFrame = EventDispatcher()
  let onCameraError = EventDispatcher()

  public var cameraFacing: String = "front" {
    didSet {
      if oldValue != cameraFacing, window != nil {
        restartCamera()
      }
    }
  }

  private let sessionQueue = DispatchQueue(label: "wakefit.camera.session")
  private let visionQueue = DispatchQueue(label: "wakefit.camera.vision")
  private let videoOutput = AVCaptureVideoDataOutput()
  private let overlayView = WakeFitPoseOverlayView()
  private let confidenceThreshold: Float32 = 0.55

  private var captureSession: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var cameraStarted = false
  private var isProcessingFrame = false
  private var loggedFirstFrame = false
  private var loggedFirstPose = false
  private var emittedVisionUnavailable = false
  private var activeFacing = "front"

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    overlayView.isUserInteractionEnabled = false
    addSubview(overlayView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
    overlayView.frame = bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    if window == nil {
      stopCamera()
    } else {
      maybeStartCamera()
    }
  }

  private func maybeStartCamera() {
    guard !cameraStarted else {
      return
    }

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      startCamera()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          if granted {
            self?.startCamera()
          } else {
            self?.emitCameraError("CAMERA_PERMISSION_NOT_GRANTED")
          }
        }
      }
    default:
      emitCameraError("CAMERA_PERMISSION_NOT_GRANTED")
    }
  }

  private func restartCamera() {
    stopCamera()
    maybeStartCamera()
  }

  private func startCamera() {
    guard !cameraStarted else {
      return
    }

    cameraStarted = true
    let requestedFacing = cameraFacing
    NSLog("WakeFitCamera starting iOS camera facing=%@", requestedFacing)

    sessionQueue.async { [weak self] in
      guard let self else {
        return
      }

      do {
        let session = try self.configureSession(facing: requestedFacing)
        self.captureSession = session

        if !session.isRunning {
          session.startRunning()
        }

        DispatchQueue.main.async {
          self.installPreviewLayer()
        }
      } catch {
        DispatchQueue.main.async {
          self.cameraStarted = false
          self.emitCameraError(error.localizedDescription)
        }
      }
    }
  }

  private func stopCamera() {
    guard cameraStarted, let session = captureSession else {
      overlayView.clearPose()
      return
    }

    cameraStarted = false
    loggedFirstFrame = false
    loggedFirstPose = false
    emittedVisionUnavailable = false
    overlayView.clearPose()

    DispatchQueue.main.async { [weak self] in
      self?.previewLayer?.removeFromSuperlayer()
      self?.previewLayer = nil
    }

    sessionQueue.async {
      if session.isRunning {
        session.stopRunning()
      }
    }
  }

  private func configureSession(facing: String) throws -> AVCaptureSession {
    let session = AVCaptureSession()

    session.beginConfiguration()
    defer {
      session.commitConfiguration()
    }

    if session.canSetSessionPreset(.vga640x480) {
      session.sessionPreset = .vga640x480
    } else {
      session.sessionPreset = .medium
    }

    let position: AVCaptureDevice.Position = facing == "back" ? .back : .front
    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        ?? AVCaptureDevice.default(for: .video)
    else {
      throw WakeFitCameraError("CAMERA_DEVICE_NOT_FOUND")
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw WakeFitCameraError("CAMERA_INPUT_NOT_SUPPORTED")
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    output.setSampleBufferDelegate(self, queue: visionQueue)

    guard session.canAddOutput(output) else {
      throw WakeFitCameraError("CAMERA_OUTPUT_NOT_SUPPORTED")
    }
    session.addOutput(output)

    // Configure video output connection: never mirror the raw pixel buffer
    // Vision needs consistent orientation to interpret landmarks correctly
    if let connection = output.connection(with: .video) {
      configureVideoOutputConnection(connection, facing: facing)
    }

    activeFacing = facing
    return session
  }

  private func installPreviewLayer() {
    guard cameraStarted, let session = captureSession else {
      return
    }

    if previewLayer == nil {
      let layer = AVCaptureVideoPreviewLayer(session: session)
      layer.videoGravity = .resizeAspectFill
      self.layer.insertSubview(layer, at: 0)
      previewLayer = layer
    }

    previewLayer?.frame = bounds
    if let connection = previewLayer?.connection {
      configurePreviewConnection(connection, facing: activeFacing)
    }
  }

  /// Preview connection: mirror for front camera (user expectation)
  private func configurePreviewConnection(_ connection: AVCaptureConnection, facing: String) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = facing != "back"
    }
  }

  /// Video output connection: NEVER mirror the raw pixel buffer
  /// Vision processes raw pixels with a consistent coordinate system
  private func configureVideoOutputConnection(_ connection: AVCaptureConnection, facing: String) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      // IMPORTANT: Never mirror the video output - Vision needs raw pixel coordinates
      connection.isVideoMirrored = false
    }
  }

  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if isProcessingFrame {
      return
    }

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }

    if !loggedFirstFrame {
      loggedFirstFrame = true
      NSLog(
        "WakeFitCamera first iOS frame %dx%d",
        CVPixelBufferGetWidth(pixelBuffer),
        CVPixelBufferGetHeight(pixelBuffer)
      )
    }

    guard #available(iOS 14.0, *) else {
      if !emittedVisionUnavailable {
        emittedVisionUnavailable = true
        emitCameraError("IOS_14_REQUIRED_FOR_POSE_DETECTION")
      }
      return
    }

    isProcessingFrame = true
    detectPose(in: pixelBuffer, facing: activeFacing)
  }

  @available(iOS 14.0, *)
  private func detectPose(in pixelBuffer: CVPixelBuffer, facing: String) {
    let request = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])

    do {
      try handler.perform([request])
      guard let observation = request.results?.first else {
        DispatchQueue.main.async { [weak self] in
          self?.overlayView.clearPose()
        }
        isProcessingFrame = false
        return
      }

      let points = try collectPosePoints(from: observation, pixelBuffer: pixelBuffer, facing: facing)
      if !loggedFirstPose, !points.isEmpty {
        loggedFirstPose = true
        NSLog("WakeFitCamera first iOS pose landmarks=%d", points.count)
      }

      DispatchQueue.main.async { [weak self] in
        guard let self else {
          return
        }

        let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
        let imageHeight = CVPixelBufferGetHeight(pixelBuffer)

        self.overlayView.updatePose(
          points: points,
          imageWidth: imageWidth,
          imageHeight: imageHeight
        )

        self.onPoseFrame([
          "timestampMs": Date().timeIntervalSince1970 * 1000,
          "imageWidth": Double(imageWidth),
          "imageHeight": Double(imageHeight),
          "landmarks": points.map { self.toEventLandmark($0) },
          "cameraFacing": facing,
          "source": "apple-vision",
          "coordinateSpace": "upright-top-left-unmirrored"
        ])
      }
    } catch {
      DispatchQueue.main.async { [weak self] in
        self?.emitCameraError(error.localizedDescription)
      }
    }

    isProcessingFrame = false
  }

  @available(iOS 14.0, *)
  private func collectPosePoints(
    from observation: VNHumanBodyPoseObservation,
    pixelBuffer: CVPixelBuffer,
    facing: String
  ) throws -> [WakeFitPosePoint] {
    let recognizedPoints = try observation.recognizedPoints(.all)
    return jointMappings.compactMap { mapping in
      guard let point = recognizedPoints[mapping.joint], point.confidence > self.confidenceThreshold else {
        return nil
      }

      // Vision coordinates are normalized [0,1] with origin at bottom-left
      // Convert to upright-top-left-unmirrored coordinate space
      let x = point.location.x * CGFloat(CVPixelBufferGetWidth(pixelBuffer))
      let y = (1 - point.location.y) * CGFloat(CVPixelBufferGetHeight(pixelBuffer))

      return WakeFitPosePoint(
        name: mapping.name,
        x: x,
        y: y,
        confidence: point.confidence
      )
    }
  }

  private func toEventLandmark(_ point: WakeFitPosePoint) -> [String: Any] {
    return [
      "name": point.name,
      "x": Double(point.x),
      "y": Double(point.y),
      "confidence": Double(point.confidence)
    ]
  }

  private func emitCameraError(_ message: String) {
    NSLog("WakeFitCamera %@", message)
    onCameraError(["message": message])
  }

  @available(iOS 14.0, *)
  private var jointMappings: [(joint: VNHumanBodyPoseObservation.JointName, name: String)] {
    [
      (.leftShoulder, "leftShoulder"),
      (.leftElbow, "leftElbow"),
      (.leftWrist, "leftWrist"),
      (.leftHip, "leftHip"),
      (.leftKnee, "leftKnee"),
      (.leftAnkle, "leftAnkle"),
      (.rightShoulder, "rightShoulder"),
      (.rightElbow, "rightElbow"),
      (.rightWrist, "rightWrist"),
      (.rightHip, "rightHip"),
      (.rightKnee, "rightKnee"),
      (.rightAnkle, "rightAnkle")
    ]
  }
}

private struct WakeFitCameraError: LocalizedError {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? {
    message
  }
}
