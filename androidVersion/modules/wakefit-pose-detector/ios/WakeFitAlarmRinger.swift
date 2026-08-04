import AudioToolbox
import Foundation

final class WakeFitAlarmRinger {
  static let shared = WakeFitAlarmRinger()

  private var timer: Timer?
  private var isRunning = false

  private init() {}

  func start() {
    DispatchQueue.main.async {
      self.startOnMain()
    }
  }

  func stop() {
    DispatchQueue.main.async {
      self.stopOnMain()
    }
  }

  private func startOnMain() {
    if isRunning {
      return
    }

    isRunning = true
    playAlert()
    timer = Timer.scheduledTimer(withTimeInterval: 1.3, repeats: true) { _ in
      WakeFitAlarmRinger.shared.playAlert()
    }
  }

  private func stopOnMain() {
    isRunning = false
    timer?.invalidate()
    timer = nil
  }

  private func playAlert() {
    AudioServicesPlayAlertSound(SystemSoundID(1005))
  }
}
