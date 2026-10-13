import Foundation
import Network
import UIKit

#if canImport(AnyThinkSDK)
import AnyThinkSDK
#endif

// MARK: - Remote Config Models

/// Matrix `/api/index/appconfig` payload.
///
/// Contract fields:
/// - placements: snake_case `*_placementid`
/// - global: snake_case `app_name`, `show_ad`
/// - intervals: **camelCase** (`bannerAdInterval`, `nativeAdInterval`,
///   `interstitialAdInterval`, `rewardAdInterval`).
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
    case bannerAdInterval = "bannerAdInterval"
    case nativeAdInterval = "nativeAdInterval"
    case interstitialAdInterval = "interstitialAdInterval"
    case rewardAdInterval = "rewardAdInterval"
    case showAd = "show_ad"
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.id = WakeFitJSONValue.int(from: container, .id)
    self.appName = try? container.decode(String.self, forKey: .appName)
    self.bannerPlacementId = try? container.decode(String.self, forKey: .bannerPlacementId)
    self.nativePlacementId = try? container.decode(String.self, forKey: .nativePlacementId)
    self.interstitialPlacementId = try? container.decode(String.self, forKey: .interstitialPlacementId)
    self.rewardedPlacementId = try? container.decode(String.self, forKey: .rewardedPlacementId)
    self.bannerAdInterval = WakeFitJSONValue.int(from: container, .bannerAdInterval)
    self.nativeAdInterval = WakeFitJSONValue.int(from: container, .nativeAdInterval)
    self.interstitialAdInterval = WakeFitJSONValue.int(from: container, .interstitialAdInterval)
    self.rewardAdInterval = WakeFitJSONValue.int(from: container, .rewardAdInterval)
    self.showAd = WakeFitJSONValue.int(from: container, .showAd)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(id, forKey: .id)
    try container.encodeIfPresent(appName, forKey: .appName)
    try container.encodeIfPresent(bannerPlacementId, forKey: .bannerPlacementId)
    try container.encodeIfPresent(nativePlacementId, forKey: .nativePlacementId)
    try container.encodeIfPresent(interstitialPlacementId, forKey: .interstitialPlacementId)
    try container.encodeIfPresent(rewardedPlacementId, forKey: .rewardedPlacementId)
    try container.encodeIfPresent(bannerAdInterval, forKey: .bannerAdInterval)
    try container.encodeIfPresent(nativeAdInterval, forKey: .nativeAdInterval)
    try container.encodeIfPresent(interstitialAdInterval, forKey: .interstitialAdInterval)
    try container.encodeIfPresent(rewardAdInterval, forKey: .rewardAdInterval)
    try container.encodeIfPresent(showAd, forKey: .showAd)
  }
}

// MARK: - Login Response

public struct WakeFitLoginResponse: Codable {
  public let code: WakeFitBusinessCode?
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

// MARK: - JSON Helpers

/// Read an int field that may be encoded as JSON number or numeric string.
enum WakeFitJSONValue {
  static func int(from container: KeyedDecodingContainer<WakeFitRemoteAppConfig.CodingKeys>,
                  _ key: WakeFitRemoteAppConfig.CodingKeys) -> Int? {
    if let n = try? container.decode(Int.self, forKey: key) {
      return n
    }
    if let s = try? container.decode(String.self, forKey: key), let n = Int(s) {
      return n
    }
    return nil
  }
}

/// Business code accepted as either JSON number or numeric string.
public enum WakeFitBusinessCode: Codable, Equatable {
  case number(Int)
  case string(String)

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let n = try? container.decode(Int.self) {
      self = .number(n)
    } else if let s = try? container.decode(String.self) {
      self = .string(s)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "code is not a number or numeric string")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .number(let n):
      try container.encode(n)
    case .string(let s):
      try container.encode(s)
    }
  }

  public var intValue: Int? {
    switch self {
    case .number(let n):
      return n
    case .string(let s):
      return Int(s)
    }
  }

  public var isSuccess: Bool {
    return intValue == 1
  }

  public var isUnauthorized: Bool {
    return intValue == 401
  }
}

/// Tiny helper that pulls a `code` field out of arbitrary JSON and checks
/// whether the response should be treated as a business success.
enum WakeFitBusinessResult {
  static func isSuccess(data: Data) -> Bool {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return false
    }
    return matchesSuccess(json["code"])
  }

  static func isUnauthorized(data: Data) -> Bool {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return false
    }
    return matchesUnauthorized(json["code"])
  }

  private static func matchesSuccess(_ raw: Any?) -> Bool {
    if let n = raw as? Int { return n == 1 }
    if let s = raw as? String { return s == "1" }
    return false
  }

  private static func matchesUnauthorized(_ raw: Any?) -> Bool {
    if let n = raw as? Int { return n == 401 }
    if let s = raw as? String { return s == "401" }
    return false
  }
}

// MARK: - Notifications

public extension Notification.Name {
  /// Posted whenever the manager's readiness or suppression flips. Mounted ad
  /// views listen for this and proactively clear or restart themselves so they
  /// never leak an ad into a suppressed state.
  static let wakeFitAdsStateChanged = Notification.Name("WakeFitAdsStateChanged")
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

  /// True only when the manager is fully ready and may present ads.
  /// Final gate for every show/render path.
  public var canPresentAds: Bool {
    return state == .ready
      && adsEnabled
      && sdkInitialized
      && loggedIn
  }

  // MARK: - Remote Config

  private var remoteConfig: WakeFitRemoteAppConfig?
  private var token: String?

  // MARK: - Intervals

  public var bannerInterval: Int {
    if let n = remoteConfig?.bannerAdInterval, n > 0 { return n }
    return WakeFitAdsConfig.shared.values.bannerFallbackInterval
  }
  public var nativeInterval: Int {
    if let n = remoteConfig?.nativeAdInterval, n > 0 { return n }
    return WakeFitAdsConfig.shared.values.nativeFallbackInterval
  }
  public var interstitialInterval: Int {
    if let n = remoteConfig?.interstitialAdInterval, n > 0 { return n }
    return WakeFitAdsConfig.shared.values.interstitialFallbackInterval
  }
  public var rewardInterval: Int {
    if let n = remoteConfig?.rewardAdInterval, n > 0 { return n }
    return WakeFitAdsConfig.shared.values.rewardFallbackInterval
  }

  // MARK: - Placements

  /// Splash placement comes exclusively from local config. Matrix never
  /// supplies a splash placement; falling back to the banner placement is
  /// incorrect.
  public var splashPlacementId: String {
    return WakeFitAdsConfig.shared.values.splashPlacementId
  }

  public var bannerPlacementId: String {
    if let v = remoteConfig?.bannerPlacementId, !v.isEmpty { return v }
    return WakeFitAdsConfig.shared.values.bannerPlacementId
  }

  public var nativePlacementId: String {
    if let v = remoteConfig?.nativePlacementId, !v.isEmpty { return v }
    return WakeFitAdsConfig.shared.values.nativePlacementId
  }

  public var interstitialPlacementId: String {
    if let v = remoteConfig?.interstitialPlacementId, !v.isEmpty { return v }
    return WakeFitAdsConfig.shared.values.interstitialPlacementId
  }

  public var rewardedPlacementId: String {
    if let v = remoteConfig?.rewardedPlacementId, !v.isEmpty { return v }
    return WakeFitAdsConfig.shared.values.rewardedPlacementId
  }

  /// Resolved app name used for backend payloads. Prefers remote non-empty.
  public var effectiveAppName: String {
    if let v = remoteConfig?.appName, !v.isEmpty { return v }
    return WakeFitAdsConfig.shared.values.appName
  }

  // MARK: - HTTP Client

  private let httpClient = WakeFitAdsHTTPClient()

  // MARK: - Network Gate

  private var pathMonitor: NWPathMonitor?
  private var pathMonitorQueue = DispatchQueue(label: "com.wakefit.ads.network")
  private var networkContinuation: CheckedContinuation<Bool, Never>?
  private var startupInFlight: Task<Void, Never>?

  // MARK: - Interstitial Loop

  private var interstitialTimer: Timer?
  private var interstitialSceneID: String?

  // MARK: - Reward Cooldown

  private var rewardCooldownEndTime: Date?

  // MARK: - Splash

  // `splashShownInSession` flips to true ONLY after the Taku runtime
  // confirms a real `splashDidShow`. `splashPresentationInFlight` guards
  // against a double call between `showSplashAd` and the runtime
  // callback. `pendingSplashPlacementID` is set when we needed to load
  // the splash first; it is cleared by every terminal splash callback
  // (didShow / didShowFailed) AND by the suppressed branch of
  // `didFinishLoadingAD`.
  private var splashShownInSession = false
  private var splashPresentationInFlight = false
  private var pendingSplashPlacementID: String?

  // MARK: - Rewarded Continuation

  private var pendingRewardedContinuation: CheckedContinuation<Bool, Never>?
  private var pendingRewardedPlacement: String?
  private var pendingRewardedSceneID: String?
  private var pendingRewardedHasSuccess: Bool = false

  // MARK: - Initialization

  private override init() {
    super.init()
  }

  // MARK: - Start

  /// Async and truly idempotent. Resolves only after the current startup
  /// has reached a terminal state (`.ready`, `.disabled`, `.failed`,
  /// `.notConfigured`). A second call while a startup is in flight awaits
  /// the **same** task — never spawns a duplicate fetch / Taku init /
  /// login / preload. Once the manager is `.ready` or `.disabled`,
  /// `start()` is a hard no-op and does NOT re-initialize anything.
  public func start() async {
    if state == .ready || state == .disabled {
      return
    }

    if let task = startupInFlight {
      await task.value
      return
    }

    let task = Task<Void, Never> { @MainActor [weak self] in
      guard let self else { return }
      await self.runStartup()
    }
    startupInFlight = task
    await task.value
    startupInFlight = nil
  }

  private func runStartup() async {
    let config = WakeFitAdsConfig.shared.values

    guard config.isBootstrapConfigured else {
      state = .notConfigured
      print("WakeFitAds: Not configured - missing bootstrap config")
      return
    }

    state = .starting
    print("WakeFitAds: Starting...")

    // 1. wait for network
    let networkOK = await waitForNetworkAvailability()
    guard networkOK else {
      state = .failed
      print("WakeFitAds: Network unavailable, marking failed")
      return
    }

    // 2. fetch appconfig
    let configResult = await fetchRemoteConfig()
    guard configResult else {
      state = .failed
      print("WakeFitAds: Appconfig unavailable, marking failed")
      notifyStateChanged()
      return
    }

    // 3. show_ad gate
    guard adsEnabled else {
      state = .disabled
      print("WakeFitAds: Disabled by remote show_ad")
      notifyStateChanged()
      return
    }

    // 4. Taku initialize
    let takuOK = await initializeTaku()
    guard takuOK else {
      state = .failed
      print("WakeFitAds: Taku initialize failed")
      notifyStateChanged()
      return
    }

    // 5. device login
    let loginOK = await deviceLogin()
    guard loginOK else {
      state = .failed
      print("WakeFitAds: Device login failed")
      notifyStateChanged()
      return
    }

    // 6. preload
    preloadAds()

    // 7. ready
    state = .ready
    print("WakeFitAds: Ready")
    notifyStateChanged()
  }

  // MARK: - Network Gate

  private func waitForNetworkAvailability() async -> Bool {
    return await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      let monitor = NWPathMonitor()
      self.pathMonitor = monitor
      self.networkContinuation = continuation

      monitor.pathUpdateHandler = { [weak self] path in
        DispatchQueue.main.async {
          guard let self else { return }
          if path.status == .satisfied {
            self.pathMonitor?.cancel()
            self.pathMonitor = nil
            let cont = self.networkContinuation
            self.networkContinuation = nil
            cont?.resume(returning: true)
          }
        }
      }
      monitor.start(queue: pathMonitorQueue)
    }
  }

  // MARK: - Remote Config

  private func fetchRemoteConfig() async -> Bool {
    let config = WakeFitAdsConfig.shared.values

    guard !config.matrixAppId.isEmpty, !config.apiBaseUrl.isEmpty else {
      print("WakeFitAds: No Matrix App ID or API Base URL configured")
      return false
    }

    guard let baseURL = URL(string: config.apiBaseUrl) else {
      print("WakeFitAds: Invalid API Base URL")
      return false
    }

    let url = baseURL.appendingPathComponent("api/index/appconfig")

    do {
      let response = try await httpClient.get(url, query: ["app_id": config.matrixAppId], headers: [:])
      guard (200...299).contains(response.statusCode) else {
        print("WakeFitAds: appconfig HTTP status \(response.statusCode)")
        return false
      }

      let decoder = JSONDecoder()
      var appConfig: WakeFitRemoteAppConfig?

      // 1. { "data": { ... } } wrapper MUST be tried first. A direct decode
      //    of the wrapped form also "succeeds" (every config field is
      //    optional), which would short-circuit show_ad=1 detection. Trying
      //    the wrapper first lets us correctly recover a wrapped response
      //    without depending on a direct-decode throw.
      if let wrapper = try? decoder.decode(WakeFitRemoteAppConfigWrapper.self, from: response.data),
         let inner = wrapper.data {
        appConfig = inner
      }

      // 2. Direct decode fallback for the unwrapped top-level form.
      if appConfig == nil,
         let decoded = try? decoder.decode(WakeFitRemoteAppConfig.self, from: response.data) {
        appConfig = decoded
      }

      guard let resolved = appConfig else {
        print("WakeFitAds: appconfig decode failed")
        return false
      }

      self.remoteConfig = resolved
      self.configLoaded = true
      self.adsEnabled = (resolved.showAd ?? 0) == 1
      print("WakeFitAds: appconfig loaded, adsEnabled: \(self.adsEnabled)")
      return true
    } catch {
      print("WakeFitAds: Failed to fetch appconfig: \(error)")
      return false
    }
  }

  // MARK: - Taku SDK

  private func initializeTaku() async -> Bool {
    let config = WakeFitAdsConfig.shared.values

    #if canImport(AnyThinkSDK)
    do {
      try ATAPI.sharedInstance().start(
        withAppID: config.takuAppId,
        appKey: config.takuAppKey
      )
      sdkInitialized = true
      print("WakeFitAds: Taku SDK initialized")
      return true
    } catch {
      print("WakeFitAds: Taku SDK initialization failed: \(error)")
      return false
    }
    #else
    print("WakeFitAds: AnyThinkSDK not linked")
    return false
    #endif
  }

  // MARK: - Device Login

  private func deviceLogin() async -> Bool {
    let config = WakeFitAdsConfig.shared.values

    guard !config.apiBaseUrl.isEmpty,
          let baseURL = URL(string: config.apiBaseUrl) else {
      return false
    }

    let loginURL = baseURL.appendingPathComponent("api/user/login")

    let appName = effectiveAppName
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
      guard (200...299).contains(response.statusCode),
            WakeFitBusinessResult.isSuccess(data: response.data) else {
        print("WakeFitAds: Login not successful")
        return false
      }

      let decoder = JSONDecoder()
      let loginResponse = try decoder.decode(WakeFitLoginResponse.self, from: response.data)
      guard let data = loginResponse.data, let token = data.token, !token.isEmpty else {
        print("WakeFitAds: Login response missing token")
        return false
      }

      self.token = token
      self.httpClient.setToken(token)
      self.loggedIn = true
      print("WakeFitAds: Device logged in")
      return true
    } catch {
      print("WakeFitAds: Login failed: \(error)")
      return false
    }
  }

  // MARK: - Preload

  /// All four display formats are preloaded before the manager reports
  /// `.ready`. Skipping Native here means the first render in
  /// `WakeFitAdsAdView` is always a "not ready, please load" path and the
  /// native ad appears noticeably later than banner / interstitial /
  /// rewarded. Preloading keeps the first impression in sync with the
  /// remote config that was just fetched.
  private func preloadAds() {
    #if canImport(AnyThinkSDK)
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
    var extra: [String: Any] = [
      kATAdLoadingExtraBannerAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 50)),
      kATExtraInfoAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 50))
    ]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func loadNative(placementID: String) {
    guard !placementID.isEmpty else { return }
    var extra: [String: Any] = [
      kATExtraInfoNativeAdSizeKey: NSValue(cgSize: CGSize(width: 320, height: 180))
    ]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func loadInterstitial(placementID: String) {
    guard !placementID.isEmpty else { return }
    var extra: [String: Any] = [:]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func loadRewarded(placementID: String) {
    guard !placementID.isEmpty else { return }
    var extra: [String: Any] = [:]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }
  #endif

  // MARK: - Splash

  public func showSplashOnce() {
    guard canPresentAds else {
      print("WakeFitAds: Splash blocked, canPresentAds=false")
      return
    }
    guard !suppressed else {
      print("WakeFitAds: Splash suppressed")
      return
    }
    guard !splashShownInSession else {
      print("WakeFitAds: Splash already shown in this session")
      return
    }
    guard !splashPresentationInFlight else {
      print("WakeFitAds: Splash presentation already in flight")
      return
    }
    guard pendingSplashPlacementID == nil else {
      print("WakeFitAds: Splash load already pending")
      return
    }
    let placement = splashPlacementId
    guard !placement.isEmpty else {
      print("WakeFitAds: No splash placement configured")
      return
    }

    // CRITICAL: do NOT set splashShownInSession here. The session-once
    // contract is owned by the runtime callback (splashDidShow), so a
    // failed load or a no-window show still leaves the session eligible
    // for a retry.
    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()
    if manager.splashReady(forPlacementID: placement) {
      if showSplashAd(placementID: placement) {
        splashPresentationInFlight = true
      }
    } else {
      pendingSplashPlacementID = placement
      manager.loadAD(withPlacementID: placement, extra: [:], delegate: self, containerView: nil)
    }
    #endif
  }

  #if canImport(AnyThinkSDK)
  /// Returns true ONLY if a real `showSplash` was dispatched against a
  /// key window + root view controller. Returns false (no state change)
  /// when the app has no usable window yet — in that case neither
  /// `splashShownInSession` nor `splashPresentationInFlight` are touched
  /// and the caller is free to retry on a later RootScreen effect tick.
  private func showSplashAd(placementID: String) -> Bool {
    guard let window = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap(\.windows)
      .first(where: { $0.isKeyWindow }),
      let viewController = window.rootViewController else {
      return false
    }

    let config = ATShowConfig(scene: nil, showCustomExt: nil)
    ATAdManager.shared().showSplash(
      withPlacementID: placementID,
      config: config,
      window: window,
      in: viewController,
      extra: [:],
      delegate: self
    )
    return true
  }
  #endif

  // MARK: - Interstitial Loop

  public func startInterstitialLoop(sceneID: String) {
    stopInterstitialLoop()
    interstitialSceneID = sceneID
    scheduleNextInterstitialCycle(initialWait: true)
  }

  public func stopInterstitialLoop() {
    interstitialTimer?.invalidate()
    interstitialTimer = nil
    interstitialSceneID = nil
  }

  /// Always schedules the next cycle as long as the loop is still active.
  /// Suppression, missing readiness, missing view controller, and show
  /// failures must NOT permanently kill the loop — the next tick still runs.
  private func scheduleNextInterstitialCycle(initialWait: Bool = false) {
    guard interstitialSceneID != nil else { return }
    let interval = max(1, interstitialInterval)

    if initialWait {
      // First interstitial appears after a full interval.
      interstitialTimer?.invalidate()
      interstitialTimer = Timer.scheduledTimer(
        withTimeInterval: TimeInterval(interval),
        repeats: false
      ) { [weak self] _ in
        Task { @MainActor in
          await self?.handleInterstitialTick()
        }
      }
      return
    }

    interstitialTimer?.invalidate()
    interstitialTimer = Timer.scheduledTimer(
      withTimeInterval: TimeInterval(interval),
      repeats: false
    ) { [weak self] _ in
      Task { @MainActor in
        await self?.handleInterstitialTick()
      }
    }
  }

  private func handleInterstitialTick() async {
    // Make sure the loop is still active before we attempt anything.
    guard interstitialSceneID != nil else { return }

    defer {
      // Whatever happened this tick, the loop keeps going until
      // stopInterstitialLoop explicitly clears the sceneID.
      if interstitialSceneID != nil {
        scheduleNextInterstitialCycle(initialWait: false)
      }
    }

    guard canPresentAds else { return }
    guard !suppressed else { return }

    let placement = interstitialPlacementId
    guard !placement.isEmpty else { return }

    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()
    guard manager.interstitialReady(forPlacementID: placement) else {
      // Not ready this tick — reload for next time, but still keep cycling.
      loadInterstitial(placementID: placement)
      return
    }

    guard let sceneID = interstitialSceneID,
          let viewController = topViewController() else { return }

    manager.entryInterstitialScenario(withPlacementID: placement, scene: sceneID)
    manager.showInterstitial(
      withPlacementID: placement,
      scene: sceneID,
      in: viewController,
      delegate: self
    )
    #endif
  }

  // MARK: - Rewarded

  public func showRewarded(sceneID: String) async -> Bool {
    guard canPresentAds else {
      print("WakeFitAds: Rewarded blocked, canPresentAds=false")
      return false
    }
    guard !suppressed else {
      print("WakeFitAds: Rewarded suppressed")
      return false
    }
    guard pendingRewardedContinuation == nil else {
      print("WakeFitAds: Rewarded request already in flight")
      return false
    }

    if let cooldownEnd = rewardCooldownEndTime, Date() < cooldownEnd {
      print("WakeFitAds: Rewarded in cooldown")
      return false
    }

    let placement = rewardedPlacementId
    guard !placement.isEmpty else {
      print("WakeFitAds: No rewarded placement configured")
      return false
    }

    #if canImport(AnyThinkSDK)
    let manager = ATAdManager.shared()
    guard manager.rewardedVideoReady(forPlacementID: placement) else {
      print("WakeFitAds: Rewarded not ready")
      return false
    }

    guard let viewController = topViewController() else {
      print("WakeFitAds: No view controller for rewarded")
      return false
    }

    pendingRewardedHasSuccess = false
    pendingRewardedPlacement = placement
    pendingRewardedSceneID = sceneID

    return await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
      self.pendingRewardedContinuation = continuation
      manager.entryRewardedVideoScenario(withPlacementID: placement, scene: sceneID)
      manager.showRewardedVideo(
        withPlacementID: placement,
        scene: sceneID,
        in: viewController,
        delegate: self
      )
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

  /// Resolves any in-flight rewarded continuation as `false`. Used when the
  /// ad fails to play so the JS Promise never hangs.
  private func resolvePendingRewarded(_ result: Bool) {
    let continuation = pendingRewardedContinuation
    pendingRewardedContinuation = nil
    pendingRewardedPlacement = nil
    pendingRewardedSceneID = nil
    pendingRewardedHasSuccess = false
    continuation?.resume(returning: result)
  }

  // MARK: - Reward Backend Chain

  /// Strict order: reportads -> reportask -> cooldown -> resolve(true).
  /// No `/api/user/reportreward`. No coins. No红包. No fire-and-forget.
  /// Returns true only if BOTH backend calls succeed.
  private func completeRewardBackendChain() async -> Bool {
    let adsOK = await performAuthorizedBackendCall(
      path: "/api/user/reportads",
      body: ["adtype": "rewardedvideo"],
      useJSON: true
    )
    guard adsOK else {
      print("WakeFitAds: Reward chain stopped: reportads failed")
      return false
    }

    let askOK = await performAuthorizedBackendCall(
      path: "/api/user/reportask",
      body: [:],
      useJSON: true
    )
    guard askOK else {
      print("WakeFitAds: Reward chain stopped: reportask failed")
      return false
    }
    return true
  }

  // MARK: - Authorized Backend Helper

  /// Performs a single authorized backend call. On HTTP 401 or business 401,
  /// clears token + relogin and retries **exactly once**.
  ///
  /// Returns true only if HTTP is 2xx AND business code == 1.
  private func performAuthorizedBackendCall(
    path: String,
    body: [String: Any],
    useJSON: Bool
  ) async -> Bool {
    let firstResult = await performAuthorizedBackendAttempt(path: path, body: body, useJSON: useJSON)
    switch firstResult {
    case .success:
      return true
    case .unauthorized:
      let reLoggedIn = await clearAuthAndRelogin()
      guard reLoggedIn else { return false }
      let secondResult = await performAuthorizedBackendAttempt(path: path, body: body, useJSON: useJSON)
      switch secondResult {
      case .success:
        return true
      case .unauthorized, .failed:
        return false
      }
    case .failed:
      return false
    }
  }

  private enum AuthorizedAttemptResult {
    case success
    case unauthorized
    case failed
  }

  private func performAuthorizedBackendAttempt(
    path: String,
    body: [String: Any],
    useJSON: Bool
  ) async -> AuthorizedAttemptResult {
    guard !WakeFitAdsConfig.shared.values.apiBaseUrl.isEmpty,
          let baseURL = URL(string: WakeFitAdsConfig.shared.values.apiBaseUrl) else {
      return .failed
    }
    let url = baseURL.appendingPathComponent(path)
    let headers: [String: String] = [:]

    do {
      let response: WakeFitHTTPResponse
      if useJSON {
        response = try await httpClient.post(url, json: body, headers: headers)
      } else {
        let fields = body.reduce(into: [String: String]()) { acc, pair in
          acc[pair.key] = String(describing: pair.value)
        }
        response = try await httpClient.postForm(url, fields: fields, headers: headers)
      }

      // HTTP 401 -> relogin path
      if response.statusCode == 401 {
        return .unauthorized
      }

      guard (200...299).contains(response.statusCode) else {
        return .failed
      }

      // Business 401 -> relogin path
      if WakeFitBusinessResult.isUnauthorized(data: response.data) {
        return .unauthorized
      }

      // Business 1 -> success
      if WakeFitBusinessResult.isSuccess(data: response.data) {
        return .success
      }

      return .failed
    } catch {
      print("WakeFitAds: authorized backend call failed: \(error)")
      return .failed
    }
  }

  /// Clears auth state and re-runs `deviceLogin()`. Returns true only if
  /// the new login was a business success with a usable token.
  private func clearAuthAndRelogin() async -> Bool {
    self.token = nil
    self.httpClient.setToken(nil)
    self.loggedIn = false
    return await deviceLogin()
  }

  // MARK: - Suppression

  public func setSuppressed(_ value: Bool) {
    if suppressed == value { return }
    suppressed = value
    print("WakeFitAds: Suppressed set to \(value)")
    notifyStateChanged()
  }

  // MARK: - Status

  public func getStatus() -> [String: Any] {
    return [
      "state": state.rawValue,
      "adsEnabled": adsEnabled,
      "suppressed": suppressed,
      "configLoaded": configLoaded,
      "sdkInitialized": sdkInitialized,
      "loggedIn": loggedIn,
      "canPresentAds": canPresentAds
    ]
  }

  // MARK: - Notifications

  private func notifyStateChanged() {
    NotificationCenter.default.post(name: .wakeFitAdsStateChanged, object: self)
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

  private func findViewController() -> UIViewController? {
    return topViewController()
  }

  // MARK: - Revenue Reporting

  /// Single revenue implementation. Used by `didRevenue(forPlacementID:extra:)`.
  private func reportRevenue(placementID: String, extra: [AnyHashable: Any]) {
    var payload = normalizeRevenueExtra(extra)
    payload["placementID"] = placementID
    payload["idfv"] = WakeFitSharedDeviceUUID.getUUID()
    payload["app_name"] = effectiveAppName

    let isLoggedIn = loggedIn && !(token?.isEmpty ?? true)

    Task { @MainActor [weak self] in
      guard let self else { return }
      if isLoggedIn {
        let success = await self.performAuthorizedBackendCall(
          path: "/api/user/reportrevenue",
          body: payload,
          useJSON: true
        )
        if !success {
          print("WakeFitAds: Revenue report (logged-in) failed for \(placementID)")
        }
      } else {
        let success = await self.performUnauthorizedBackendCall(
          path: "/api/user/prerevenuerecord",
          body: payload
        )
        if !success {
          print("WakeFitAds: Revenue report (pre-login) failed for \(placementID)")
        }
      }
    }
  }

  /// Pre-login backend call without Authorization. Best-effort only.
  private func performUnauthorizedBackendCall(
    path: String,
    body: [String: Any]
  ) async -> Bool {
    guard !WakeFitAdsConfig.shared.values.apiBaseUrl.isEmpty,
          let baseURL = URL(string: WakeFitAdsConfig.shared.values.apiBaseUrl) else {
      return false
    }
    let url = baseURL.appendingPathComponent(path)
    do {
      let response = try await httpClient.post(url, json: body, headers: [:])
      guard (200...299).contains(response.statusCode) else {
        return false
      }
      // Some pre-login endpoints return business code; if present, verify.
      if response.data.isEmpty { return true }
      if let json = try? JSONSerialization.jsonObject(with: response.data) as? [String: Any],
         json["code"] != nil {
        return WakeFitBusinessResult.isSuccess(data: response.data)
      }
      return true
    } catch {
      print("WakeFitAds: pre-login backend call failed: \(error)")
      return false
    }
  }

  /// JSON-safe normalization of Taku extra payload, matching the legacy
  /// reporter behavior so backend schemas stay stable.
  private func normalizeRevenueExtra(_ extra: [AnyHashable: Any]) -> [String: Any] {
    let formatter = ISO8601DateFormatter()
    return extra.reduce(into: [String: Any]()) { result, pair in
      let key = (pair.key as? String) ?? String(describing: pair.key)
      result[key] = jsonSafeValue(pair.value, formatter: formatter)
    }
  }

  private func jsonSafeValue(_ value: Any, formatter: ISO8601DateFormatter) -> Any {
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
      return formatter.string(from: value)
    case let value as URL:
      return value.absoluteString
    case let value as [AnyHashable: Any]:
      return normalizeRevenueExtra(value)
    case let value as [String: Any]:
      return normalizeRevenueExtra(value.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value })
    case let value as [Any]:
      return value.map { jsonSafeValue($0, formatter: formatter) }
    default:
      return String(describing: value)
    }
  }
}

// MARK: - appconfig wrapper decoder

/// Decodes the `{ "data": { ...config... } }` wrapper form. The `data` key
/// is optional because some responses ship the config at the top level and
/// only wrap it on certain accounts.
private struct WakeFitRemoteAppConfigWrapper: Decodable {
  let data: WakeFitRemoteAppConfig?

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: DynamicKey.self)
    if container.contains(.data) {
      self.data = try? container.decode(WakeFitRemoteAppConfig.self, forKey: .data)
    } else {
      self.data = nil
    }
  }

  private struct DynamicKey: CodingKey {
    var stringValue: String
    init?(stringValue: String) { self.stringValue = stringValue }
    var intValue: Int? { nil }
    init?(intValue: Int) { return nil }
    static let data = DynamicKey(stringValue: "data")!
  }
}

// MARK: - ATAdLoadingDelegate

#if canImport(AnyThinkSDK)
extension WakeFitAdsManager: ATAdLoadingDelegate {
  public func didFinishLoadingAD(withPlacementID placementID: String) {
    print("WakeFitAds: Ad loaded: \(placementID)")

    if placementID == pendingSplashPlacementID {
      // Always clear the pending marker so a subsequent safe-state call
      // from RootScreen is not blocked by a stale load.
      pendingSplashPlacementID = nil
      if canPresentAds && !suppressed {
        if showSplashAd(placementID: placementID) {
          splashPresentationInFlight = true
        }
      }
      // suppressed branch: pending is already cleared, splashShownInSession
      // stays false, splashPresentationInFlight stays false → RootScreen
      // can retry once suppression lifts.
    }
  }

  public func didFailToLoadAD(withPlacementID placementID: String, error: Error) {
    print("WakeFitAds: Ad failed to load: \(placementID), error: \(error)")

    if placementID == pendingSplashPlacementID {
      pendingSplashPlacementID = nil
      // splashShownInSession stays false → RootScreen can retry later.
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
    print("WakeFitAds: Reward callback fired for: \(placementID)")
    // Record callback only; do not start cooldown, do not call reportads/reportask,
    // do not resolve the continuation. Final reward decision happens in close.
    if placementID == pendingRewardedPlacement {
      pendingRewardedHasSuccess = true
    }
  }

  public func rewardedVideoDidFailToPlay(forPlacementID placementID: String, error: Error, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Rewarded failed to play: \(error)")
    guard placementID == pendingRewardedPlacement else { return }
    // The JS Promise must never hang on a failed-to-play event. Resolve
    // it false, clear pending state, and reload for the next attempt.
    resolvePendingRewarded(false)
    loadRewarded(placementID: placementID)
  }

  public func rewardedVideoDidClose(forPlacementID placementID: String, rewarded: Bool, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Rewarded closed: \(placementID), rewarded: \(rewarded)")
    guard placementID == pendingRewardedPlacement else {
      loadRewarded(placementID: placementID)
      return
    }

    let trulyRewarded = rewarded && pendingRewardedHasSuccess

    if !trulyRewarded {
      // Not a real reward: resolve immediately, clear pending state, reload.
      resolvePendingRewarded(false)
      loadRewarded(placementID: placementID)
      return
    }

    // Genuine reward success path. We MUST keep `pendingRewardedContinuation`
    // set while `reportads -> reportask -> cooldown` runs, otherwise a
    // second `showRewarded()` call would slip past the
    // `pendingRewardedContinuation == nil` guard and race the backend
    // chain. Only `resolvePendingRewarded(_:)` (called below after the
    // chain finishes) is allowed to clear the pending state.
    let continuation = pendingRewardedContinuation
    let pendingPlacement = pendingRewardedPlacement

    Task { @MainActor [weak self] in
      guard let self else {
        // Manager went away mid-chain; resolve false so the JS Promise
        // does not hang. `pendingRewardedContinuation` is already nil
        // here because it is held on `self`.
        continuation?.resume(returning: false)
        return
      }
      let success = await self.completeRewardBackendChain()
      if success {
        self.rewardCooldownEndTime = Date().addingTimeInterval(TimeInterval(self.rewardInterval))
      }
      // Now (and only now) clear pending state + resume the JS Promise.
      self.resolvePendingRewarded(success)
      if let pendingPlacement {
        self.loadRewarded(placementID: pendingPlacement)
      }
    }
  }
}

// MARK: - ATSplashDelegate

extension WakeFitAdsManager: ATSplashDelegate {
  public func splashDidShow(forPlacementID placementID: String, extra: [AnyHashable: Any]) {
    // The runtime confirmed a real show. Lock the session-once contract
    // and clear the in-flight guard so future re-tries from RootScreen
    // are rejected.
    pendingSplashPlacementID = nil
    splashPresentationInFlight = false
    splashShownInSession = true
  }

  public func splashDidClick(forPlacementID placementID: String, extra: [AnyHashable: Any]) {}

  public func splashDidClose(forPlacementID placementID: String, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Splash closed: \(placementID)")
  }

  public func splashDidShowFailed(forPlacementID placementID: String, error: Error, extra: [AnyHashable: Any]) {
    print("WakeFitAds: Splash failed: \(error)")
    pendingSplashPlacementID = nil
    splashPresentationInFlight = false
    // splashShownInSession stays false so RootScreen can call
    // showSplashOnce() again from a safe state.
  }
}
#endif