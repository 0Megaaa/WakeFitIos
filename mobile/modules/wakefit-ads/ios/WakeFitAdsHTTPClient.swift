import Foundation

public protocol WakeFitAdsHTTPClientProtocol: AnyObject {
  func get(_ url: URL, query: [String: String], headers: [String: String]) async throws -> WakeFitHTTPResponse
  func post(_ url: URL, json: [String: Any], headers: [String: String]) async throws -> WakeFitHTTPResponse
  func postForm(_ url: URL, fields: [String: String], headers: [String: String]) async throws -> WakeFitHTTPResponse
}

public struct WakeFitHTTPResponse {
  public let data: Data
  public let statusCode: Int

  public init(data: Data, statusCode: Int) {
    self.data = data
    self.statusCode = statusCode
  }
}

public enum WakeFitHTTPError: LocalizedError {
  case invalidURL
  case networkError(Error)
  case invalidResponse
  case httpError(Int)
  case decodingError(Error)

  public var errorDescription: String? {
    switch self {
    case .invalidURL:
      return "Invalid URL"
    case .networkError(let error):
      return "Network error: \(error.localizedDescription)"
    case .invalidResponse:
      return "Invalid server response"
    case .httpError(let code):
      return "HTTP error: \(code)"
    case .decodingError(let error):
      return "Decoding error: \(error.localizedDescription)"
    }
  }
}

public final class WakeFitAdsHTTPClient: WakeFitAdsHTTPClientProtocol {
  private let session: URLSession
  private var currentToken: String?

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func setToken(_ token: String?) {
    self.currentToken = token
  }

  public func get(_ url: URL, query: [String: String] = [:], headers: [String: String] = [:]) async throws -> WakeFitHTTPResponse {
    var components = URLComponents(url: url, resolvingAgainstBaseURL: true)
    if !query.isEmpty {
      components?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    }

    guard let finalURL = components?.url else {
      throw WakeFitHTTPError.invalidURL
    }

    var request = URLRequest(url: finalURL)
    request.httpMethod = "GET"
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    var allHeaders = headers
    if let token = currentToken, !token.isEmpty {
      allHeaders["Authorization"] = "Bearer \(token)"
    }
    for (key, value) in allHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        throw WakeFitHTTPError.invalidResponse
      }
      return WakeFitHTTPResponse(data: data, statusCode: httpResponse.statusCode)
    } catch let error as WakeFitHTTPError {
      throw error
    } catch {
      throw WakeFitHTTPError.networkError(error)
    }
  }

  public func post(_ url: URL, json: [String: Any] = [:], headers: [String: String] = [:]) async throws -> WakeFitHTTPResponse {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    var allHeaders = headers
    if let token = currentToken, !token.isEmpty {
      allHeaders["Authorization"] = "Bearer \(token)"
    }
    for (key, value) in allHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }

    do {
      request.httpBody = try JSONSerialization.data(withJSONObject: json)
    } catch {
      throw WakeFitHTTPError.decodingError(error)
    }

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        throw WakeFitHTTPError.invalidResponse
      }
      return WakeFitHTTPResponse(data: data, statusCode: httpResponse.statusCode)
    } catch let error as WakeFitHTTPError {
      throw error
    } catch {
      throw WakeFitHTTPError.networkError(error)
    }
  }

  public func postForm(_ url: URL, fields: [String: String] = [:], headers: [String: String] = [:]) async throws -> WakeFitHTTPResponse {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    var allHeaders = headers
    if let token = currentToken, !token.isEmpty {
      allHeaders["Authorization"] = "Bearer \(token)"
    }
    for (key, value) in allHeaders {
      request.setValue(value, forHTTPHeaderField: key)
    }

    let body = fields.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
      .joined(separator: "&")
    request.httpBody = body.data(using: .utf8)

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        throw WakeFitHTTPError.invalidResponse
      }
      return WakeFitHTTPResponse(data: data, statusCode: httpResponse.statusCode)
    } catch let error as WakeFitHTTPError {
      throw error
    } catch {
      throw WakeFitHTTPError.networkError(error)
    }
  }
}
