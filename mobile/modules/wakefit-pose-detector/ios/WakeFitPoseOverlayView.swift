import UIKit

struct WakeFitPosePoint {
  let name: String
  let x: CGFloat
  let y: CGFloat
  let confidence: Float
}

/**
 * iOS Pose Overlay View.
 *
 * Receives canonical upright-top-left-unmirrored pixel coordinates from Vision.
 * Transforms to view coordinates with aspect-fill scaling.
 *
 * For front camera (isMirrored=true): mirror X to match PreviewLayer mirrored preview.
 * For back camera (isMirrored=false): no mirroring.
 *
 * Mirroring formula:
 *   front:  displayX = imageWidth - canonicalX
 *   back:   displayX = canonicalX
 */
final class WakeFitPoseOverlayView: UIView {
  private var points: [WakeFitPosePoint] = []
  private var imageWidth: CGFloat = 0
  private var imageHeight: CGFloat = 0
  private var isMirrored: Bool = false

  private let confidenceThreshold: Float = 0.55

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    isOpaque = false
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func updatePose(points: [WakeFitPosePoint], imageWidth: CGFloat, imageHeight: CGFloat, isMirrored: Bool) {
    self.points = points
    self.imageWidth = imageWidth
    self.imageHeight = imageHeight
    self.isMirrored = isMirrored
    setNeedsDisplay()
  }

  func clearPose() {
    points = []
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    guard imageWidth > 0, imageHeight > 0, !points.isEmpty else {
      return
    }

    let byName = Dictionary(uniqueKeysWithValues: points.map { ($0.name, $0) })
    let transform = imageToViewTransform()

    UIColor(red: 0.16, green: 0.92, blue: 0.57, alpha: 0.95).setStroke()
    UIColor(red: 1.0, green: 0.86, blue: 0.28, alpha: 0.98).setFill()

    let skeleton = UIBezierPath()
    skeleton.lineWidth = 3
    skeleton.lineCapStyle = .round
    skeleton.lineJoinStyle = .round

    for connection in connections {
      guard
        let first = byName[connection.0],
        let second = byName[connection.1],
        first.confidence >= confidenceThreshold,
        second.confidence >= confidenceThreshold
      else {
        continue
      }

      skeleton.move(to: transform(first))
      skeleton.addLine(to: transform(second))
    }

    skeleton.stroke()

    for point in points where point.confidence >= confidenceThreshold {
      let center = transform(point)
      UIBezierPath(
        ovalIn: CGRect(x: center.x - 4, y: center.y - 4, width: 8, height: 8)
      ).fill()
    }
  }

  private func imageToViewTransform() -> (WakeFitPosePoint) -> CGPoint {
    let scale = max(bounds.width / imageWidth, bounds.height / imageHeight)
    let renderedWidth = imageWidth * scale
    let renderedHeight = imageHeight * scale
    let xOffset = (bounds.width - renderedWidth) / 2
    let yOffset = (bounds.height - renderedHeight) / 2

    // Mirror flag from camera facing
    let mirrored = self.isMirrored

    return { point in
      // Apply front camera mirroring to canonical X coordinate
      var displayX = point.x
      if mirrored {
        displayX = self.imageWidth - point.x
      }

      return CGPoint(
        x: xOffset + displayX * scale,
        y: yOffset + point.y * scale
      )
    }
  }

  private let connections: [(String, String)] = [
    ("leftShoulder", "rightShoulder"),
    ("leftShoulder", "leftElbow"),
    ("leftElbow", "leftWrist"),
    ("rightShoulder", "rightElbow"),
    ("rightElbow", "rightWrist"),
    ("leftShoulder", "leftHip"),
    ("rightShoulder", "rightHip"),
    ("leftHip", "rightHip"),
    ("leftHip", "leftKnee"),
    ("leftKnee", "leftAnkle"),
    ("rightHip", "rightKnee"),
    ("rightKnee", "rightAnkle")
  ]
}
