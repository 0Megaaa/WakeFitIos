import ExpoModulesCore
import Foundation

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

    View(WakeFitPoseCameraView.self) {
      Events("onPoseFrame", "onCameraError")

      Prop("cameraFacing") { (view: WakeFitPoseCameraView, cameraFacing: String) in
        view.cameraFacing = cameraFacing
      }
    }
  }
}
