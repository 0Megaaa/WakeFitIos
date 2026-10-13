import Foundation
import UIKit

#if canImport(AnyThinkSDK)
import AnyThinkSDK
#endif

// MARK: - Remote Config Models

public struct WakeFitRemoteAppConfig: Codable {
  public let id: Int?
  public let appName: String?
  public let bannerPlacementId: String?
  public let nativePlacementId: String?
  public let interstitialPlacementId: String?
  public let rewardedPlacementId: String?
  public let bannerAdInterval: Int?
  public let nativeAdInterval: Int?
  public let interstitialAdInterval: Int?
  public let rewardAdInterval: Int?
  public let showAd: Int?

  enum CodingKeys: String, CodingKey {
    case id
    case appName = "app_name"
    case bannerPlacementId = "banner_placementid"
    case nativePlacementId = "native_placementid"
    case interstitialPlacementId = "interstitial_placementid"
    case rewardedPlacementId = "rewarded_placementid"
    case bannerAdInterval = "banner_ad_interval"
    case nativeAdInterval = "native_ad_interval"
    case interstitialAdInterval = "interstitial_ad_interval"
    case rewardAdInterval = "reward_ad_interval"
    case showAd = "show_ad"
  }
}

// MARK: - Login Response

public struct WakeFitLoginResponse: Codable {
  public let code: Int?
  public let message: String?
  public let data: WakeFitLoginData?

  enum CodingKeys: String, CodingKey {
    case code
    case message = "msg"
    case data
  }
}

public struct WakeFitLoginData: Codable {
  public let token: String?

  enum CodingKeys: String, CodingKey {
    case token
  }
}

// MARK: - Ad Manager

@MainActor
public final class WakeFitAdsManager: NSObject {
  public static let shared = WakeFitAdsManager()

  // MARK: - State

  public private(set) var state: WakeFitAdsState = .notConfigured
  public private(set) var configLoaded = false
  public private(set) var sdkInitialized = false
  public private(set) var loggedIn = false
  public private(set) var adsEnabled = false
  public private(set) var suppressed = false

  // MARK: - Remote Config

  private var remoteConfig: WakeFitRemoteAppConfig?
  private var token: String?
  private var hasRetriedWithNewToken = false

  // MARK: - Intervals

  public var bannerInterval: Int { remoteConfig?.bannerAdInterval ?? WakeFitAdsConfig.shared.values.bannerFallbackInterval }
  public var nativeInterval: Int { remoteConfig?.nativeAdInterval ?? WakeFitAdsConfig.shared.values.nativeFallbackInterval }
  public var interstitialInterval: Int { remoteConfig?.interstitialAdInterval ?? WakeFitAdsConfig.shared.values.interstitialFallbackInterval }
  public var rewardInterval: Int { remoteConfig?.rewardAdInterval ?? WakeFitAdsConfig.shared.values.rewardFallbackInterval }

  // MARK: - Placements (with remote override)

  public var splashPlacementId: String {
    remoteConfig?.bannerPlacementId?.isEmpty == false
      ? remoteConfig!.bannerPlacementId!
      : WakeFitAdsConfig.shared.values.splashPlacementId
  }

  public var bannerPlacementId: String {
    remoteConfig?.bannerPlacementId?.isEmpty == false
      ? remoteConfig!.bannerPlacementId!
      : WakeFitAdsConfig.shared.values.bannerPlacementId
  }

  public var nativePlacementId: String {
    remoteConfig?.nativePlacementId?.isEmpty == false
      ? remoteConfig!.nativePlacementId!
      : WakeFitAdsConfig.shared.values.nativePlacementId
  }

  public var interstitialPlacementId: String {
    remoteConfig?.interstitialPlacementId?.isEmpty == false
      ? remoteConfig!.interstitialPlacementId!
      : WakeFitAdsConfig.shared.values.interstitialPlacementId
  }

  public var rewardedPlacementId: String {
    remoteConfig?.rewardedPlacementId?.isEmpty == false
      ? remoteConfig!.rewardedPlacementId!
      : WakeFitAdsConfig.shared.values.rewardedPlacementId
  }

  // MARK: - HTTP Client

  private let httpClient = WakeFitAdsHTTPClient()

  // MARK: - Interstitial Loop

  private var interstitialTimer: Timer?
  private var interstitialSceneID: String?

  // MARK: - Reward Cooldown

  private var rewardCooldownEndTime: Date?

  // MARK: - Splash

  private var splashShownInSession = false
  private var pendingSplashPlacementID: String?

  // MARK: - Initialization

  private override init() {
    super.init()
  }

  // MARK: - Start

  public func start() async {
    let config = WakeFitAdsConfig.shared

    guard config.values.isBootstrapConfigured else {
      state = .notConfigured
      print("WakeFitAds: Not configured - missing bootstrap config")
      return
    }

    state = .starting
    print("WakeFitAds: Starting...")

    // Fetch remote config
    await fetchRemoteConfig()

    // Initialize Taku SDK
    await initializeTaku()

    // Device login
    await deviceLogin()

    // Preload ads
    preloadAds()

    // Check final state
    if adsEnabled && sdkInitialized && loggedIn {
      state = .ready
      print("WakeFitAds: Ready")
    } else if !adsEnabled {
      state = .disabled
      print("WakeFitAds: Disabled by remote config")
    } else {
      state = .failed
      print("WakeFitAds: Failed to initialize")
    }
  }

  // MARK: - Remote Config

  private func fetchRemoteConfig() async {
    let config = WakeFitAdsConfig.shared.values

    guard !config.matrixAppId.isEmpty, !config.apiBaseUrl.isEmpty else {
      print("WakeFitAds: No Matrix App ID or API Base URL configured")
      return
    }

    guard let baseURL = URL(string: config.apiBaseUrl) else {
      print("WakeFitAds: Invalid API Base URL")
      return
    }

    let url = baseURL.appendingPathComponent("api/index/appconfig")
    var components = URLComponents(url: url, resolvingAgainstBaseURL: true)
    components?.queryItems = [URLQueryItem(name: "app_id", value: config.matrixAppId)]

    guard let finalURL = components?.url else { return }

    do {
      let response = try await httpClient.get(finalURL, query: [:], headers: [:])

      if response.statusCode == 401 {
        print("WakeFitAds: Unauthorized fetching remote config")
        return
      }

      let decoder = JSONDecoder()
      let appConfig = try decoder.decode(WakeFitRemoteAppConfig.self, from: response.data)

      self.remoteConfig = appConfig
      self.configLoaded = true

      // Check show_ad flag
      self.adsEnabled = (appConfig.showAd ?? 0) == 1
      print("WakeFitAds: Remote config loaded, adsEnabled: \(self.adsEnabled)")
    } catch {
      print("WakeFitAds: Failed to fetch remote config: \(error)")
    }
  }

  // MARK: - Taku SDK

  private func initializeTaku() async {
    let config = WakeFitAdsConfig.shared.values

    #if canImport(AnyThinkSDK)
    do {
      try ATAPI.sharedInstance().start(
        withAppID: config.takuAppId,
        appKey: config.takuAppKey
      )
      sdkInitialized = true
      print("WakeFitAds: Taku SDK initialized")
    } catch {
      print("WakeFitAds: Taku SDK initialization failed: \(error)")
    }
    #else
    print("WakeFitAds: AnyThinkSDK not linked")
    #endif
  }

  // MARK: - Device Login

  private func deviceLogin() async {
    let config = WakeFitAdsConfig.shared.values

    guard !config.apiBaseUrl.isEmpty else { return }
    guard let baseURL = URL(string: config.apiBaseUrl) else { return }

    let loginURL = baseURL.appendingPathComponent("api/user/login")

    let appName = remoteConfig?.appName ?? config.appName
    let idfv = WakeFitSharedDeviceUUID.getUUID()
    let device = WakeFitSharedDeviceUUID.getDeviceModel()

    let fields: [String: String] = [
      "ver": "2.0",
      "appName": appName,
      "idfv": idfv,
      "device": device
    ]

    do {
      let response = try await httpClient.postForm(loginURL, fields: fields, headers: [:])

      if response.statusCode == 401 {
        print("WakeFitAds: Login unauthorized")
        return
      }

      let decoder = JSONDecoder()
      let loginResponse = try decoder.decode(WakeFitLoginResponse.self, from: response.data)

      if loginResponse.code == 1, let data = loginResponse.data, let token = data.token {
        self.token = token
        self.httpClient.setToken(token)
        self.loggedIn = true
        print("WakeFitAds: Device logged in")
      } else {
        print("WakeFitAds: Login failed: \(loginResponse.message ?? "Unknown error")")
      }
    } catch {
      print("WakeFitAds: Login failed: \(error)")
    }
  }

  // MARK: - Preload

  private func preloadAds() {
    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()

    // Preload all ad formats
    if !bannerPlacementId.isEmpty {
      loadBanner(placementID: bannerPlacementId)
    }
    if !nativePlacementId.isEmpty {
      loadNative(placementID: nativePlacementId)
    }
    if !interstitialPlacementId.isEmpty {
      loadInterstitial(placementID: interstitialPlacementId)
    }
    if !rewardedPlacementId.isEmpty {
      loadRewarded(placementID: rewardedPlacementId)
    }
    #endif
  }

  #if canImport(AnyThinkSDK)
  private func loadBanner(placementID: String) {
    guard !placementID.isEmpty else { return }
    let extra: [String: Any] = [
      kATAdLoadingExtraBannerAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 50)),
      kATExtraInfoAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 50))
    ]
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func loadNative(placementID: String) {
    guard !placementID.isEmpty else { return }
    let extra: [String: Any] = [
      kATExtraInfoNativeAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 180))
    ]
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func loadInterstitial(placementID: String) {
    guard !placementID.isEmpty else { return }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: [:], delegate: self)
  }

  private func loadRewarded(placementID: String) {
    guard !placementID.isEmpty else { return }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: [:], delegate: self)
  }
  #endif

  // MARK: - Splash

  public func showSplashOnce() {
    guard !suppressed else {
      print("WakeFitAds: Splash suppressed")
      return
    }

    guard !splashShownInSession else {
      print("WakeFitAds: Splash already shown in this session")
      return
    }

    guard !splashPlacementId.isEmpty else {
      print("WakeFitAds: No splash placement configured")
      return
    }

    splashShownInSession = true

    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()

    if manager.splashReady(forPlacementID: splashPlacementId) {
      showSplashAd(placementID: splashPlacementId)
    } else {
      pendingSplashPlacementID = splashPlacementId
      manager.loadAD(withPlacementID: splashPlacementId, extra: [:], delegate: self, containerView: nil)
    }
    #endif
  }

  #if canImport(AnyThinkSDK)
  private func showSplashAd(placementID: String) {
    guard let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow }),
      let viewController = window.rootViewController else { return }

    let config = ATShowConfig(scene: nil, showCustomExt: nil)
    ATAdManager.shared().showSplash(
      withPlacementID: placementID,
      config: config,
      window: window,
      in: viewController,
      extra: [:],
      delegate: self
    )
  }
  #endif

  // MARK: - Interstitial Loop

  public func startInterstitialLoop(sceneID: String) {
    stopInterstitialLoop()

    interstitialSceneID = sceneID
    let interval = interstitialInterval

    // Wait full interval before first interstitial
    interstitialTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(interval), repeats: false) { [weak self] _ in
      Task { @MainActor in
        await self?.showInterstitialIfReady()
      }
    }
  }

  public func stopInterstitialLoop() {
    interstitialTimer?.invalidate()
    interstitialTimer = nil
    interstitialSceneID = nil
  }

  private func showInterstitialIfReady() async {
    guard !suppressed, adsEnabled else { return }
    guard !interstitialPlacementId.isEmpty else { return }

    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()

    if manager.interstitialReady(forPlacementID: interstitialPlacementId) {
      guard let sceneID = interstitialSceneID,
            let viewController = topViewController() else { return }

      manager.entryInterstitialScenario(withPlacementID: interstitialPlacementId, scene: sceneID)
      manager.showInterstitial(withPlacementID: interstitialPlacementId, scene: sceneID, in: viewController, delegate: self)
    } else {
      // Reload and skip this cycle
      loadInterstitial(placementID: interstitialPlacementId)
    }
    #endif

    // Schedule next interstitial
    let sceneID = interstitialSceneID
    interstitialTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(interstitialInterval), repeats: false) { [weak self] _ in
      Task { @MainActor in
        await self?.showInterstitialIfReady()
      }
    }
  }

  // MARK: - Rewarded

  public func showRewarded(sceneID: String) async -> Bool {
    guard !suppressed, adsEnabled else {
      print("WakeFitAds: Rewarded suppressed or disabled")
      return false
    }

    guard !rewardedPlacementId.isEmpty else {
      print("WakeFitAds: No rewarded placement configured")
      return false
    }

    // Check cooldown
    if let cooldownEnd = rewardCooldownEndTime, Date() < cooldownEnd {
      print("WakeFitAds: Rewarded in cooldown")
      return false
    }

    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()

    if !manager.rewardedVideoReady(forPlacementID: rewardedPlacementId) {
      print("WakeFitAds: Rewarded not ready")
      return false
    }

    guard let viewController = topViewController() else {
      print("WakeFitAds: No view controller for rewarded")
      return false
    }

    return await withCheckedContinuation { continuation in
      // Store continuation for delegate callback
      // Note: In production, this would need proper continuation management
      manager.entryRewardedVideoScenario(withPlacementID: rewardedPlacementId, scene: sceneID)
      manager.showRewardedVideo(withPlacementID: rewardedPlacementId, scene: sceneID, in: viewController, delegate: self)

      // For now, return false as we need proper async handling
      continuation.resume(returning: false)
    }
    #else
    return false
    #endif
  }

  public func getRewardCooldownRemaining() -> Int {
    guard let cooldownEnd = rewardCooldownEndTime else { return 0 }
    let remaining = cooldownEnd.timeIntervalSince(Date())
    return max(0, Int(remaining))
  }

  // MARK: - Suppression

  public func setSuppressed(_ value: Bool) {
    suppressed = value
    print("WakeFitAds: Suppressed set to \(value)")
  }

  // MARK: - Status

  public func getStatus() -> [String: Any] {
    return [
      "state": state.rawValue,
      "adsEnabled": adsEnabled,
      "suppressed": suppressed,
      "configLoaded": configLoaded,
      "sdkInitialized": sdkInitialized,
      "loggedIn": loggedIn
    ]
  }

  // MARK: - Helpers

  private func topViewController() -> UIViewController? {
    guard let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow }) else { return nil }

    var topController = window.rootViewController
    while let presented = topController?.presentedViewController {
      topController = presented
    }
    return topController
  }

  // MARK: - Revenue Reporting

  private func reportRevenue(placementID: String, extra: [AnyHashable: Any]) {
    guard let config = URL(string: WakeFitAdsConfig.shared.values.apiBaseUrl + "/api/user/reportrevenue") else { return }

    var payload: [String: Any] = [
      "placementID": placementID,
      "idfv": WakeFitSharedDeviceUUID.getUUID(),
      "appName": remoteConfig?.appName ?? WakeFitAdsConfig.shared.values.appName
    ]

    // Add revenue data from extra
    for (key, value) in extra {
      if let stringKey = key as? String {
        payload[stringKey] = value
      }
    }

    Task {
      if let token = token, !token.isEmpty {
        var headers = ["Authorization": "Bearer \(token)"]
        _ = try? await httpClient.post(config, json: payload, headers: headers)
      } else {
        _ = try? await httpClient.post(config, json: payload, headers: [:])
      }
    }
  }

  // MARK: - Report Ads Watched

  public func reportAdsWatched(adtype: String) {
    guard let config = URL(string: WakeFitAdsConfig.shared.values.apiBaseUrl + "/api/user/reportads") else { return }

    let fields: [String: String] = ["adtype": adtype]

    Task {
      if let token = token, !token.isEmpty {
        var headers = ["Authorization": "Bearer \(token)"]
        _ = try? await httpClient.postForm(config, fields: fields, headers: headers)
      }
    }
  }

  public func reportAsk() {
    guard let config = URL(string: WakeFitAdsConfig.shared.values.apiBaseUrl + "/api/user/reportask") else { return }

    Task {
      if let token = token, !token.isEmpty {
        var headers = ["Authorization": "Bearer \(token)"]
        _ = try? await httpClient.post(config, json: [:], headers: headers)
      }
    }
  }
}

// MARK: - ATAdLoadingDelegate

#if canImport(AnyThinkSDK)
extension WakeFitAdsManager: ATAdLoadingDelegate {
  public func didFinishLoadingAD(withPlacementID placementID: String) {
    print("WakeFitAds: Ad loaded: \(placementID)")

    if placementID == pendingSplashPlacementID {
      pendingSplashPlacementID = nil
      showSplashAd(placementID: placementID)
    }
  }

  public func didFailToLoadAD(withPlacementID placementID: String, error: Error) {
    print("WakeFitAds: Ad failed to load: \(placementID), error: \(error)")

    if placementID == pendingSplashPlacementID {
      pendingSplashPlacementID = nil
    }
  }

  public func didRevenue(forPlacementID placementID: String, extra: [AnyHashable: Any]) {
    reportRevenue(placementID: placementID, extra: extra)
  }
}

// MARK: - ATInterstitialDelegate

extension WakeFitAdsManager: ATInterstitialDelegate {
  public func interstitialDidShow(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func interstitialDidClick(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func interstitialDidClose(forPlacementID placementID: String, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Interstitial closed: \(placementID)")
    // Reload for next cycle
    loadInterstitial(placementID: placementID)
  }

  public func interstitialFailedToShow(forPlacementID placementID: String, error: Error, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Interstitial failed to show: \(error)")
    loadInterstitial(placementID: placementID)
  }
}

// MARK: - ATRewardedVideoDelegate

extension WakeFitAdsManager: ATRewardedVideoDelegate {
  public func rewardedVideoDidStartPlaying(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func rewardedVideoDidEndPlaying(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func rewardedVideoDidClick(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func rewardedVideoDidRewardSuccess(forPlacemenID placementID: String, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Reward success for: \(placementID)")

    // Set cooldown
    rewardCooldownEndTime = Date().addingTimeInterval(TimeInterval(rewardInterval))

    // Report watched
    reportAdsWatched(adtype: "rewardedvideo")
    reportAsk()
  }

  public func rewardedVideoDidClose(forPlacementID placementID: String, rewarded: Bool, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Rewarded closed: \(placementID), rewarded: \(rewarded)")
    loadRewarded(placementID: placementID)
  }
}

// MARK: - ATSplashDelegate

extension WakeFitAdsManager: ATSplashDelegate {
  public func splashDidShow(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func splashDidClick(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func splashDidClose(forPlacementID placementID: String, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Splash closed: \(placementID)")
  }

  public func splashDidShowFailed(forPlacementID placementID: String, error: Error, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Splash failed: \(error)")
    pendingSplashPlacementID = nil
  }
}
#endif
