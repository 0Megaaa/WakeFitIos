import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

public final class WakeFitPoseCameraView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onPoseFrame = EventDispatcher()
  let onCameraError = EventDispatcher()

  public var cameraFacing: String = "front" {
    didSet {
      let normalized = cameraFacing == "back" ? "back" : "front"
      if normalized == oldValue { return }
      cameraFacingValue = normalized
      if window != nil {
        restartCamera()
      }
    }
  }

  private let sessionQueue = DispatchQueue(label: "wakefit.camera.session")
  private let visionQueue = DispatchQueue(label: "wakefit.camera.vision")
  private let overlayView = WakeFitPoseOverlayView()
  private let confidenceThreshold: Float32 = 0.55

  // Camera lifecycle state - all tracked together
  private var captureSession: AVCaptureSession?
  private var videoOutput: AVCaptureVideoDataOutput?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var cameraGeneration: Int = 0
  private var cameraFacingValue: String = "front"
  private var activeFacing: String = "front"
  private var isProcessingFrame: Bool = false
  private var isAttached: Bool = false

  // Logging
  private var loggedFirstFrame: Bool = false
  private var loggedFirstPose: Bool = false
  private var emittedVisionUnavailable: Bool = false

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

    isAttached = window != nil

    if window == nil {
      stopCamera()
    } else {
      maybeStartCamera()
    }
  }

  private func maybeStartCamera() {
    guard isAttached, captureSession == nil else {
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
    guard isAttached, captureSession == nil else {
      return
    }

    let generation = cameraGeneration + 1
    cameraGeneration = generation
    let requestedFacing = cameraFacing
    activeFacing = requestedFacing
    cameraFacingValue = requestedFacing
    NSLog("WakeFitCamera starting iOS facing=%@ generation=%d", requestedFacing, generation)

    sessionQueue.async { [weak self] in
      guard let self else { return }

      do {
        let session = try self.configureSession(facing: requestedFacing, generation: generation)
        // Re-verify state before assigning
        guard self.cameraGeneration == generation,
              self.isAttached,
              self.cameraFacingValue == requestedFacing else {
          NSLog("WakeFitCamera abort session: state changed during config")
          return
        }

        self.captureSession = session
        self.videoOutput = session.outputs.first as? AVCaptureVideoDataOutput

        if !session.isRunning {
          session.startRunning()
        }

        // Verify again before installing preview
        guard self.cameraGeneration == generation,
              self.isAttached,
              self.captureSession === session else {
          NSLog("WakeFitCamera abort preview: state changed after start")
          session.stopRunning()
          return
        }

        DispatchQueue.main.async {
          self.installPreviewLayer()
        }
      } catch {
        DispatchQueue.main.async { [weak self] in
          guard let self, self.cameraGeneration == generation else { return }
          self.emitCameraError(error.localizedDescription)
        }
      }
    }
  }

  private func stopCamera() {
    let generation = cameraGeneration + 1
    cameraGeneration = generation

    let session = captureSession
    let output = videoOutput
    captureSession = nil
    videoOutput = nil
    isProcessingFrame = false
    loggedFirstFrame = false
    loggedFirstPose = false
    emittedVisionUnavailable = false

    overlayView.clearPose()

    DispatchQueue.main.async { [weak self] in
      self?.previewLayer?.removeFromSuperlayer()
      self?.previewLayer = nil
    }

    sessionQueue.async {
      session?.stopRunning()
    }

    NSLog("WakeFitCamera stopped generation=%d", generation)
  }

  private func configureSession(facing: String, generation: Int) throws -> AVCaptureSession {
    let session = AVCaptureSession()

    session.beginConfiguration()
    defer { session.commitConfiguration() }

    if session.canSetSessionPreset(.vga640x480) {
      session.sessionPreset = .vga640x480
    } else {
      session.sessionPreset = .medium
    }

    let position: AVCaptureDevice.Position = facing == "back" ? .back : .front
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
      throw WakeFitCameraError("CAMERA_FACING_NOT_AVAILABLE")
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

    if let connection = output.connection(with: .video) {
      configureVideoOutputConnection(connection)
    }

    return session
  }

  private func installPreviewLayer() {
    guard let session = captureSession else { return }

    if previewLayer == nil {
      let layer = AVCaptureVideoPreviewLayer(session: session)
      layer.videoGravity = .resizeAspectFill
      self.layer.insertSublayer(layer, at: 0)
      previewLayer = layer
    }

    previewLayer?.frame = bounds
    if let connection = previewLayer?.connection {
      configurePreviewConnection(connection, facing: activeFacing)
    }
  }

  private func configurePreviewConnection(_ connection: AVCaptureConnection, facing: String) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = facing != "back"
    }
  }

  private func configureVideoOutputConnection(_ connection: AVCaptureConnection) {
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = .portrait
    }
    if connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = false
    }
  }

  // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

  public func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    // Verify this frame comes from the current active output
    guard output === videoOutput else {
      NSLog("WakeFitCamera discard frame from old output")
      return
    }

    if isProcessingFrame {
      return
    }

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }

    if !loggedFirstFrame {
      loggedFirstFrame = true
      NSLog("WakeFitCamera first iOS frame %dx%d", CVPixelBufferGetWidth(pixelBuffer), CVPixelBufferGetHeight(pixelBuffer))
    }

    guard #available(iOS 14.0, *) else {
      if !emittedVisionUnavailable {
        emittedVisionUnavailable = true
        emitCameraError("IOS_14_REQUIRED_FOR_POSE_DETECTION")
      }
      return
    }

    // Capture state at this moment for validation after async detection
    let currentGeneration = cameraGeneration
    let currentFacing = activeFacing
    let currentSession = captureSession
    let currentOutput = videoOutput

    isProcessingFrame = true
    detectPose(in: pixelBuffer, generation: currentGeneration, facing: currentFacing, session: currentSession, output: currentOutput)
  }

  @available(iOS 14.0, *)
  private func detectPose(
    in pixelBuffer: CVPixelBuffer,
    generation: Int,
    facing: String,
    session: AVCaptureSession?,
    output: AVCaptureVideoDataOutput?
  ) {
    let request = VNDetectHumanBodyPoseRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])

    do {
      try handler.perform([request])

      // Validate: generation, session, facing, output must still match
      guard cameraGeneration == generation,
            captureSession === session,
            videoOutput === output,
            activeFacing == facing,
            isAttached,
            captureSession != nil else {
        NSLog("WakeFitCamera discard stale Vision result gen=%d current=%d facing=%@ active=%@",
              generation, cameraGeneration, facing, activeFacing)
        isProcessingFrame = false
        return
      }

      guard let observation = request.results?.first else {
        DispatchQueue.main.async { [weak self] in
          guard let self, self.cameraGeneration == generation else { return }
          self.overlayView.clearPose()
        }
        isProcessingFrame = false
        return
      }

      let points = try collectPosePoints(from: observation, pixelBuffer: pixelBuffer)

      if !loggedFirstPose, !points.isEmpty {
        loggedFirstPose = true
        NSLog("WakeFitCamera first iOS pose landmarks=%d", points.count)
      }

      let imageWidth = CVPixelBufferGetWidth(pixelBuffer)
      let imageHeight = CVPixelBufferGetHeight(pixelBuffer)
      let isMirrored = facing != "back"

      DispatchQueue.main.async { [weak self] in
        guard let self,
              self.cameraGeneration == generation,
              self.activeFacing == facing,
              self.captureSession === session else { return }

        self.overlayView.updatePose(
          points: points,
          imageWidth: imageWidth,
          imageHeight: imageHeight,
          isMirrored: isMirrored
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
        guard let self, self.cameraGeneration == generation else { return }
        self.emitCameraError(error.localizedDescription)
      }
    }

    isProcessingFrame = false
  }

  @available(iOS 14.0, *)
  private func collectPosePoints(
    from observation: VNHumanBodyPoseObservation,
    pixelBuffer: CVPixelBuffer
  ) throws -> [WakeFitPosePoint] {
    let recognizedPoints = try observation.recognizedPoints(.all)
    return jointMappings.compactMap { mapping in
      // Keep all points with confidence, let downstream decide what to do with low confidence
      guard let point = recognizedPoints[mapping.joint] else {
        return nil
      }

      let imageWidth = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
      let imageHeight = CGFloat(CVPixelBufferGetHeight(pixelBuffer))

      // Vision coordinates: normalized [0,1] with origin at bottom-left
      // Transform to upright-top-left-unmirrored pixel coordinates
      let x = point.location.x * imageWidth
      let y = (1 - point.location.y) * imageHeight

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
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
