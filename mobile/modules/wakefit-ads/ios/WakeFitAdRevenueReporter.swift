import Foundation

public final class WakeFitAdRevenueReporter {
  public static let shared = WakeFitAdRevenueReporter()

  private let dateFormatter = ISO8601DateFormatter()
  private let httpClient = WakeFitAdsHTTPClient()

  private init() {}

  @discardableResult
  public func reportRevenue(
    placementID: String,
    extra: [AnyHashable: Any],
    isLoggedIn: Bool,
    token: String?,
    apiBaseUrl: String,
    deviceId: String,
    appName: String
  ) -> URLSessionDataTask? {
    print("WakeFitAds: Revenue event - PlacementID: \(placementID)")

    var payload = normalizeExtra(extra)
    payload["placementID"] = placementID

    guard let url = URL(string: apiBaseUrl + "/api/user/reportrevenue") else {
      return nil
    }

    var headers: [String: String] = [:]
    if isLoggedIn, let token = token {
      headers["Authorization"] = "Bearer \(token)"
    }

    do {
      let body = try JSONSerialization.data(withJSONObject: payload)
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")

      for (key, value) in headers {
        request.setValue(value, forHTTPHeaderField: key)
      }

      return URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
          print("WakeFitAds: Revenue report failed: \(error.localizedDescription)")
        } else if let httpResponse = response as? HTTPURLResponse {
          print("WakeFitAds: Revenue report response: \(httpResponse.statusCode)")
        }
      }
    } catch {
      print("WakeFitAds: Failed to serialize revenue payload: \(error)")
      return nil
    }
  }

  private func normalizeExtra(_ extra: [AnyHashable: Any]) -> [String: Any] {
    extra.reduce(into: [String: Any]()) { result, pair in
      let key = (pair.key as? String) ?? String(describing: pair.key)
      result[key] = jsonSafeValue(pair.value)
    }
  }

  private func jsonSafeValue(_ value: Any) -> Any {
    switch value {
    case is NSNull:
      return NSNull()
    case let value as String:
      return value
    case let value as Bool:
      return value
    case let value as Int:
      return value
    case let value as Int8:
      return Int(value)
    case let value as Int16:
      return Int(value)
    case let value as Int32:
      return Int(value)
    case let value as Int64:
      return value
    case let value as UInt:
      return value <= UInt(Int64.max) ? Int64(value) : String(value)
    case let value as UInt8:
      return Int(value)
    case let value as UInt16:
      return Int(value)
    case let value as UInt32:
      return Int64(value)
    case let value as UInt64:
      return value <= UInt64(Int64.max) ? Int64(value) : String(value)
    case let value as Float:
      return value.isFinite ? Double(value) : String(value)
    case let value as Double:
      return value.isFinite ? value : String(value)
    case let value as NSNumber:
      return value
    case let value as Date:
      return dateFormatter.string(from: value)
    case let value as URL:
      return value.absoluteString
    case let value as [AnyHashable: Any]:
      return normalizeExtra(value)
    case let value as [String: Any]:
      return normalizeExtra(value.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value })
    case let value as [Any]:
      return value.map(jsonSafeValue)
    default:
      return String(describing: value)
    }
  }
}
