import Foundation

enum WakeFitAlarmPayloadStore {
  private static let pendingLaunchKey = "wakefit.pendingAlarmLaunch"

  static func payload(
    alarmId: String,
    fireAtMillis: Double,
    label: String,
    timeOfDay: String,
    targetCount: Int,
    exerciseType: String
  ) -> [String: Any] {
    return [
      "alarmId": alarmId,
      "firedAt": isoInstant(fromMillis: fireAtMillis),
      "label": label,
      "timeOfDay": timeOfDay,
      "targetCount": targetCount,
      "exerciseType": exerciseType.isEmpty ? "squat" : exerciseType
    ]
  }

  static func savePendingLaunch(from userInfo: [AnyHashable: Any]) {
    guard let alarmId = userInfo["alarmId"] as? String, !alarmId.isEmpty else {
      return
    }

    let payload: [String: Any] = [
      "alarmId": alarmId,
      "firedAt": userInfo["firedAt"] as? String ?? isoInstant(fromMillis: Date().timeIntervalSince1970 * 1000),
      "label": userInfo["label"] as? String ?? "",
      "timeOfDay": userInfo["timeOfDay"] as? String ?? "",
      "targetCount": userInfo["targetCount"] as? Int ?? 5,
      "exerciseType": userInfo["exerciseType"] as? String ?? "squat"
    ]

    UserDefaults.standard.set(payload, forKey: pendingLaunchKey)
  }

  static func consumePendingLaunch() -> [String: Any]? {
    guard let payload = UserDefaults.standard.dictionary(forKey: pendingLaunchKey) else {
      return nil
    }

    UserDefaults.standard.removeObject(forKey: pendingLaunchKey)
    return payload
  }

  private static func isoInstant(fromMillis millis: Double) -> String {
    let date = Date(timeIntervalSince1970: millis / 1000)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }
}
