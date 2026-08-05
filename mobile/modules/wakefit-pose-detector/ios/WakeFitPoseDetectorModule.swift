import ExpoModulesCore
import Foundation
import AVFoundation
import UserNotifications

public class WakeFitPoseDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakeFitPoseDetector")

    AsyncFunction("isAvailable") {
      true
    }

    AsyncFunction("startAlarmTone") {
      WakeFitAlarmRinger.shared.start()
    }

    AsyncFunction("stopAlarmTone") {
      WakeFitAlarmRinger.shared.stop()
    }

    AsyncFunction("scheduleAlarm") {
      (
        alarmId: String,
        fireAtMillis: Double,
        label: String,
        timeOfDay: String,
        targetCount: Int,
        exerciseType: String,
        promise: Promise
      ) in
      WakeFitAlarmScheduler.shared.schedule(
        alarmId: alarmId,
        fireAtMillis: fireAtMillis,
        label: label,
        timeOfDay: timeOfDay,
        targetCount: targetCount,
        exerciseType: exerciseType
      ) { errorMessage in
        if let errorMessage {
          promise.reject("WAKEFIT_ALARM_SCHEDULE_FAILED", errorMessage)
          return
        }

        promise.resolve()
      }
    }

    AsyncFunction("cancelAlarm") { (alarmId: String) in
      WakeFitAlarmScheduler.shared.cancel(alarmId: alarmId)
    }

    AsyncFunction("consumePendingAlarmLaunch") { () -> [String: Any]? in
      WakeFitAlarmPayloadStore.consumePendingLaunch()
    }

    // MARK: - Camera permission bridge

    AsyncFunction("getCameraPermissionStatus") { (promise: Promise) in
      promise.resolve(Self.mapCameraStatus(AVCaptureDevice.authorizationStatus(for: .video)))
    }

    AsyncFunction("requestCameraPermission") { (promise: Promise) in
      let current = AVCaptureDevice.authorizationStatus(for: .video)
      switch current {
      case .authorized:
        promise.resolve("granted")
        return
      case .denied:
        promise.resolve("denied")
        return
      case .restricted:
        promise.resolve("blocked")
        return
      case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
          promise.resolve(granted ? "granted" : "denied")
        }
        return
      @unknown default:
        promise.resolve("unavailable")
        return
      }
    }

    // MARK: - Notification permission bridge

    AsyncFunction("getNotificationPermissionStatus") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(Self.mapNotificationStatus(settings.authorizationStatus))
      }
    }

    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(
        options: [.alert, .sound, .badge]
      ) { granted, error in
        if let error = error {
          NSLog("WakeFitPoseDetector notification authorization error: \(error)")
          promise.resolve("unavailable")
          return
        }
        promise.resolve(granted ? "granted" : "denied")
      }
    }

    View(WakeFitPoseCameraView.self) {
      Events("onPoseFrame", "onCameraError")

      Prop("cameraFacing") { (view: WakeFitPoseCameraView, cameraFacing: String) in
        view.cameraFacing = cameraFacing
      }
    }
  }

  private static func mapCameraStatus(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized:
      return "granted"
    case .denied:
      return "denied"
    case .restricted:
      return "blocked"
    case .notDetermined:
      return "not_determined"
    @unknown default:
      return "unavailable"
    }
  }

  private static func mapNotificationStatus(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized, .provisional, .ephemeral:
      return "granted"
    case .denied:
      return "denied"
    case .notDetermined:
      return "not_determined"
    @unknown default:
      return "unavailable"
    }
  }
}