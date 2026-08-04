import Foundation
import UserNotifications

final class WakeFitAlarmScheduler {
  static let shared = WakeFitAlarmScheduler()

  private init() {}

  func schedule(
    alarmId: String,
    fireAtMillis: Double,
    label: String,
    timeOfDay: String,
    targetCount: Int,
    exerciseType: String,
    completion: @escaping (String?) -> Void
  ) {
    let center = UNUserNotificationCenter.current()

    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
      if let error {
        completion(error.localizedDescription)
        return
      }
      if !granted {
        completion("NOTIFICATION_PERMISSION_DENIED")
        return
      }

      let content = UNMutableNotificationContent()
      content.title = label.isEmpty ? "WakeFit" : label
      content.body = "Finish the exercise challenge to dismiss the alarm."
      content.sound = .default
      content.categoryIdentifier = "WAKEFIT_ALARM"
      content.userInfo = WakeFitAlarmPayloadStore.payload(
        alarmId: alarmId,
        fireAtMillis: fireAtMillis,
        label: label,
        timeOfDay: timeOfDay,
        targetCount: max(1, min(100, targetCount)),
        exerciseType: exerciseType
      )

      let fireDate = Date(timeIntervalSince1970: fireAtMillis / 1000)
      let interval = max(1, fireDate.timeIntervalSinceNow)
      let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
      let request = UNNotificationRequest(identifier: alarmId, content: content, trigger: trigger)

      center.removePendingNotificationRequests(withIdentifiers: [alarmId])
      center.add(request) { addError in
        completion(addError?.localizedDescription)
      }
    }
  }

  func cancel(alarmId: String) {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [alarmId])
    center.removeDeliveredNotifications(withIdentifiers: [alarmId])
  }
}
