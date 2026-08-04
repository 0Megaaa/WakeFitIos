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

  private let captureSession = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "wakefit.camera.session")
  private let visionQueue = DispatchQueue(label: "wakefit.camera.vision")
  private let videoOutput = AVCaptureVideoDataOutput()
  private let overlayView = WakeFitPoseOverlayView()

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
        try self.configureSession(facing: requestedFacing)
        if !self.captureSession.isRunning {
          self.captureSession.startRunning()
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
    guard cameraStarted else {
      overlayView.clearPose()
      return
    }

    cameraStarted = false
    loggedFirstFrame = false
    loggedFirstPose = false
    emittedVisionUnavailable = false
    overlayView.clearPose()
    previewLayer?.removeFromSuperlayer()
    previewLayer = nil

    sessionQueue.async { [weak self] in
      guard let self else {
        return
      }

      if self.captureSession.isRunning {
        self.captureSession.stopRunning()
      }
      self.videoOutput.setSampleBufferDelegate(nil, queue: nil)
      self.captureSession.beginConfiguration()
      self.captureSession.inputs.forEach { self.captureSession.removeInput($0) }
      self.captureSession.outputs.forEach { self.captureSession.removeOutput($0) }
      self.captureSession.commitConfiguration()
    }
  }

  private func configureSession(facing: String) throws {
    captureSession.beginConfiguration()
    defer {
      captureSession.commitConfiguration()
    }

    if captureSession.canSetSessionPreset(.vga640x480) {
      captureSession.sessionPreset = .vga640x480
    } else {
      captureSession.sessionPreset = .medium
    }

    captureSession.inputs.forEach { captureSession.removeInput($0) }
    captureSession.outputs.forEach { captureSession.removeOutput($0) }

    let position: AVCaptureDevice.Position = facing == "back" ? .back : .front
    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
        ?? AVCaptureDevice.default(for: .video)
    else {
      throw WakeFitCameraError("CAMERA_DEVICE_NOT_FOUND")
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard captureSession.canAddInput(input) else {
      throw WakeFitCameraError("CAMERA_INPUT_NOT_SUPPORTED")
    }
    captureSession.addInput(input)

    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    videoOutput.setSampleBufferDelegate(self, queue: visionQueue)

    guard captureSession.canAddOutput(videoOutput) else {
      throw WakeFitCameraError("CAMERA_OUTPUT_NOT_SUPPORTED")
    }
    captureSession.addOutput(videoOutput)

    if let connection = videoOutput.connection(with: .video) {
      configureConnection(connection, facing: facing)
    }

    activeFacing = facing
  }

  private func installPreviewLayer() {
    guard cameraStarted else {
      return
    }

    if previewLayer == nil {
      let layer = AVCaptureVideoPreviewLayer(session: captureSession)
      layer.videoGravity = .resizeAspectFill
      self.layer.insertSublayer(layer, at: 0)
      previewLayer = layer
    }

    previewLayer?.frame = bounds
    if let connection = previewLayer?.connection {
      configureConnection(connection, facing: activeFacing)
    }
  }

  private func configureConnection(_ connection: AVCaptureConnection, facing: String) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = facing != "back"
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
    let orientation = imageOrientation(facing: facing)
    let imageSize = orientedImageSize(
      pixelWidth: CVPixelBufferGetWidth(pixelBuffer),
      pixelHeight: CVPixelBufferGetHeight(pixelBuffer),
      orientation: orientation
    )
    let request = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])

    do {
      try handler.perform([request])
      guard let observation = request.results?.first else {
        DispatchQueue.main.async { [weak self] in
          self?.overlayView.clearPose()
        }
        isProcessingFrame = false
        return
      }

      let points = try collectPosePoints(from: observation, imageSize: imageSize)
      if !loggedFirstPose, !points.isEmpty {
        loggedFirstPose = true
        NSLog("WakeFitCamera first iOS pose landmarks=%d", points.count)
      }

      DispatchQueue.main.async { [weak self] in
        guard let self else {
          return
        }

        self.overlayView.updatePose(
          points: points,
          imageWidth: imageSize.width,
          imageHeight: imageSize.height
        )
        self.onPoseFrame([
          "timestampMs": Date().timeIntervalSince1970 * 1000,
          "imageWidth": Double(imageSize.width),
          "imageHeight": Double(imageSize.height),
          "landmarks": points.map { self.toEventLandmark($0) }
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
    imageSize: CGSize
  ) throws -> [WakeFitPosePoint] {
    let recognizedPoints = try observation.recognizedPoints(.all)
    return jointMappings.compactMap { mapping in
      guard let point = recognizedPoints[mapping.joint], point.confidence > 0 else {
        return nil
      }

      return WakeFitPosePoint(
        name: mapping.name,
        x: point.location.x * imageSize.width,
        y: (1 - point.location.y) * imageSize.height,
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

  private func imageOrientation(facing: String) -> CGImagePropertyOrientation {
    return facing == "back" ? .right : .leftMirrored
  }

  private func orientedImageSize(
    pixelWidth: Int,
    pixelHeight: Int,
    orientation: CGImagePropertyOrientation
  ) -> CGSize {
    switch orientation {
    case .left, .leftMirrored, .right, .rightMirrored:
      return CGSize(width: pixelHeight, height: pixelWidth)
    default:
      return CGSize(width: pixelWidth, height: pixelHeight)
    }
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
