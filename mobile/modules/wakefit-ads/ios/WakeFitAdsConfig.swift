import Foundation

public enum WakeFitAdsState: String {
  case notConfigured = "not_configured"
  case starting = "starting"
  case ready = "ready"
  case disabled = "disabled"
  case failed = "failed"
}

public struct WakeFitAdsConfigValues {
  public let apiBaseUrl: String
  public let matrixAppId: String
  public let appName: String
  public let takuAppId: String
  public let takuAppKey: String
  public let splashPlacementId: String
  public let bannerPlacementId: String
  public let nativePlacementId: String
  public let interstitialPlacementId: String
  public let rewardedPlacementId: String
  public let bannerFallbackInterval: Int
  public let nativeFallbackInterval: Int
  public let interstitialFallbackInterval: Int
  public let rewardFallbackInterval: Int

  public init(from info: [String: Any]) {
    self.apiBaseUrl = (info["WakeFitAdsAPIBaseURL"] as? String) ?? ""
    self.matrixAppId = (info["WakeFitAdsMatrixAppID"] as? String) ?? ""
    self.appName = (info["WakeFitAdsAppName"] as? String) ?? "WakeFit"
    self.takuAppId = (info["WakeFitTakuAppID"] as? String) ?? ""
    self.takuAppKey = (info["WakeFitTakuAppKey"] as? String) ?? ""
    self.splashPlacementId = (info["WakeFitSplashPlacementID"] as? String) ?? ""
    self.bannerPlacementId = (info["WakeFitBannerPlacementID"] as? String) ?? ""
    self.nativePlacementId = (info["WakeFitNativePlacementID"] as? String) ?? ""
    self.interstitialPlacementId = (info["WakeFitInterstitialPlacementID"] as? String) ?? ""
    self.rewardedPlacementId = (info["WakeFitRewardedPlacementID"] as? String) ?? ""

    if let bannerInterval = info["WakeFitBannerFallbackInterval"] as? Int, bannerInterval > 0 {
      self.bannerFallbackInterval = bannerInterval
    } else {
      self.bannerFallbackInterval = 30
    }

    if let nativeInterval = info["WakeFitNativeFallbackInterval"] as? Int, nativeInterval > 0 {
      self.nativeFallbackInterval = nativeInterval
    } else {
      self.nativeFallbackInterval = 30
    }

    if let interstitialInterval = info["WakeFitInterstitialFallbackInterval"] as? Int, interstitialInterval > 0 {
      self.interstitialFallbackInterval = interstitialInterval
    } else {
      self.interstitialFallbackInterval = 60
    }

    if let rewardInterval = info["WakeFitRewardFallbackInterval"] as? Int, rewardInterval > 0 {
      self.rewardFallbackInterval = rewardInterval
    } else {
      self.rewardFallbackInterval = 60
    }
  }

  public var isBootstrapConfigured: Bool {
    !apiBaseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
    !matrixAppId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
    !takuAppId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
    !takuAppKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  public var hasAnyPlacement: Bool {
    !splashPlacementId.isEmpty ||
    !bannerPlacementId.isEmpty ||
    !nativePlacementId.isEmpty ||
    !interstitialPlacementId.isEmpty ||
    !rewardedPlacementId.isEmpty
  }
}

public final class WakeFitAdsConfig {
  public static let shared = WakeFitAdsConfig()

  public private(set) var values: WakeFitAdsConfigValues
  public private(set) var status: WakeFitAdsState = .notConfigured

  private init() {
    let info = Bundle.main.infoDictionary ?? [:]
    self.values = WakeFitAdsConfigValues(from: info)
    self.status = values.isBootstrapConfigured ? .notConfigured : .notConfigured
  }

  public func reload() {
    let info = Bundle.main.infoDictionary ?? [:]
    self.values = WakeFitAdsConfigValues(from: info)
    self.status = values.isBootstrapConfigured ? .notConfigured : .notConfigured
  }

  public func updateStatus(_ newStatus: WakeFitAdsState) {
    self.status = newStatus
  }
}
