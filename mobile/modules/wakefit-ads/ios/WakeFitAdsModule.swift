import ExpoModulesCore
import Foundation

#if canImport(AnyThinkSDK)
import AnyThinkSDK
#endif

public class WakeFitAdsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakeFitAds")

    AsyncFunction("start") { [weak self] in
      guard let self else { return }
      await self.startAds()
    }

    AsyncFunction("getStatus") { [weak self] in
      guard let self else { return self?.getAdsStatus() ?? [:] }
      return self.getAdsStatus()
    }

    AsyncFunction("setSuppressed") { [weak self] (suppressed: Bool) in
      await MainActor.run {
        WakeFitAdsManager.shared.setSuppressed(suppressed)
      }
    }

    AsyncFunction("showSplashOnce") { [weak self] in
      await MainActor.run {
        WakeFitAdsManager.shared.showSplashOnce()
      }
    }

    AsyncFunction("startInterstitialLoop") { [weak self] (sceneID: String) in
      await MainActor.run {
        WakeFitAdsManager.shared.startInterstitialLoop(sceneID: sceneID)
      }
    }

    AsyncFunction("stopInterstitialLoop") { [weak self] in
      await MainActor.run {
        WakeFitAdsManager.shared.stopInterstitialLoop()
      }
    }

    AsyncFunction("showRewarded") { [weak self] (sceneID: String) -> Bool in
      return await WakeFitAdsManager.shared.showRewarded(sceneID: sceneID)
    }

    AsyncFunction("getRewardCooldownRemaining") { [weak self] -> Int in
      return WakeFitAdsManager.shared.getRewardCooldownRemaining()
    }

    View(WakeFitAdsAdView.self) {
      Events("onAvailabilityChange", "onAdError")

      Prop("format") { (view: WakeFitAdsAdView, format: String) in
        view.adFormat = format
      }

      Prop("sceneID") { (view: WakeFitAdsAdView, sceneID: String) in
        view.sceneID = sceneID
      }
    }
  }

  @MainActor
  private func startAds() async {
    // Block until the manager reaches a real terminal state (ready,
    // disabled, failed, notConfigured) so the JS `await WakeFitAds.start()`
    // resolves only after startup has finished.
    await WakeFitAdsManager.shared.start()
  }

  @MainActor
  private func getAdsStatus() -> [String: Any] {
    return WakeFitAdsManager.shared.getStatus()
  }
}

// MARK: - Native Ad View

public class WakeFitAdsAdView: ExpoView {
  @objc public var adFormat: String = "banner" {
    didSet {
      if oldValue != adFormat {
        refreshTimer?.invalidate()
        refreshTimer = nil
        clearAd()
        updateAd()
      }
    }
  }

  @objc public var sceneID: String = "default" {
    didSet {
      if oldValue != sceneID {
        refreshTimer?.invalidate()
        refreshTimer = nil
        clearAd()
        updateAd()
      }
    }
  }

  // MARK: - Banner/Native storage

  private var bannerView: UIView?
  private var nativeAdView: UIView?
  private var isLoaded = false
  private var hasWindow = false

  // MARK: - Refresh timer (managed on MainActor)

  private var refreshTimer: Timer?

  // MARK: - Event dispatchers

  let onAvailabilityChange = EventDispatcher()
  let onAdError = EventDispatcher()

  // MARK: - State observer

  private var stateObserver: NSObjectProtocol?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    registerStateObserver()
  }

  deinit {
    refreshTimer?.invalidate()
    refreshTimer = nil
    if let observer = stateObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  // MARK: - Lifecycle

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    let nowInWindow = (window != nil)
    if nowInWindow == hasWindow { return }
    hasWindow = nowInWindow

    if nowInWindow {
      handleAttach()
    } else {
      handleDetach()
    }
  }

  private func handleAttach() {
    let manager = WakeFitAdsManager.shared
    guard manager.canPresentAds && !manager.suppressed else {
      sendAvailabilityChange(available: false)
      return
    }
    updateAd()
    scheduleRefresh()
  }

  private func handleDetach() {
    refreshTimer?.invalidate()
    refreshTimer = nil
    clearAd()
    sendAvailabilityChange(available: false)
  }

  private func handleSuppressionChange() {
    let manager = WakeFitAdsManager.shared
    if manager.suppressed {
      refreshTimer?.invalidate()
      refreshTimer = nil
      clearAd()
      sendAvailabilityChange(available: false)
      return
    }

    // suppression lifted
    guard hasWindow, manager.canPresentAds else { return }
    updateAd()
    scheduleRefresh()
  }

  private func registerStateObserver() {
    stateObserver = NotificationCenter.default.addObserver(
      forName: .wakeFitAdsStateChanged,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.handleSuppressionChange()
    }
  }

  // MARK: - Update / Render

  private func updateAd() {
    guard !adFormat.isEmpty, !sceneID.isEmpty else { return }

    clearAd()

    let manager = WakeFitAdsManager.shared
    guard manager.canPresentAds, !manager.suppressed else {
      sendAvailabilityChange(available: false)
      return
    }

    let placementID: String
    switch adFormat {
    case "banner":
      placementID = manager.bannerPlacementId
    case "native":
      placementID = manager.nativePlacementId
    default:
      sendAvailabilityChange(available: false)
      return
    }

    guard !placementID.isEmpty else {
      sendAvailabilityChange(available: false)
      return
    }

    #if canImport(AnyThinkSDK)
    let adManager = ATAdManager.shared()

    switch adFormat {
    case "banner":
      if adManager.bannerAdReady(forPlacementID: placementID) {
        renderBanner(placementID: placementID)
      } else {
        loadAndRenderBanner(placementID: placementID)
      }

    case "native":
      if adManager.nativeAdReady(forPlacementID: placementID) {
        renderNative(placementID: placementID)
      } else {
        loadAndRenderNative(placementID: placementID)
      }

    default:
      break
    }
    #else
    sendAvailabilityChange(available: false)
    #endif
  }

  // MARK: - Refresh

  private func scheduleRefresh() {
    refreshTimer?.invalidate()
    let interval: Int
    switch adFormat {
    case "banner":
      interval = max(1, WakeFitAdsManager.shared.bannerInterval)
    case "native":
      interval = max(1, WakeFitAdsManager.shared.nativeInterval)
    default:
      return
    }

    let timer = Timer.scheduledTimer(
      withTimeInterval: TimeInterval(interval),
      repeats: false
    ) { [weak self] _ in
      Task { @MainActor in
        self?.handleRefreshTick()
      }
    }
    refreshTimer = timer
  }

  private func handleRefreshTick() {
    guard hasWindow else {
      refreshTimer = nil
      return
    }
    let manager = WakeFitAdsManager.shared
    guard manager.canPresentAds, !manager.suppressed else {
      refreshTimer = nil
      return
    }
    // One-shot refresh: re-render + schedule next.
    updateAd()
    scheduleRefresh()
  }

  // MARK: - Banner

  #if canImport(AnyThinkSDK)
  private func renderBanner(placementID: String) {
    let config = ATShowConfig(scene: sceneID, showCustomExt: nil)
    guard let banner = ATAdManager.shared().retrieveBannerView(
      forPlacementID: placementID,
      config: config
    ) else {
      sendAvailabilityChange(available: false)
      return
    }

    banner.delegate = self
    banner.presentingViewController = findViewController()

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.clearAd()

      banner.frame = self.bounds
      banner.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.addSubview(banner)
      self.bannerView = banner

      self.isLoaded = true
      self.sendAvailabilityChange(available: true)
    }
  }

  private func loadAndRenderBanner(placementID: String) {
    var extra: [String: Any] = [
      kATAdLoadingExtraBannerAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 50)),
      kATExtraInfoAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 50))
    ]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }
  #endif

  // MARK: - Native

  #if canImport(AnyThinkSDK)
  private func renderNative(placementID: String) {
    guard let offer = ATAdManager.shared().getNativeAdOffer(
      withPlacementID: placementID,
      scene: sceneID
    ) else {
      sendAvailabilityChange(available: false)
      return
    }

    // Single configuration. The previous version created a second
    // `ATNativeADConfiguration` for the renderer call, which produced two
    // independent objects (one bound to the view, one passed to the
    // renderer) and left the renderer unwired against the actual
    // `nativeView` instance.
    let configuration = ATNativeADConfiguration()
    configuration.adFrame = bounds
    configuration.mediaViewFrame = bounds
    configuration.rootViewController = findViewController()
    configuration.delegate = self
    configuration.sizeToFit = true

    let nativeView = ATNativeADView(
      configuration: configuration,
      currentOffer: offer,
      placementID: placementID
    )
    nativeView.delegate = self

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.clearAd()

      // 1. Mount the native view into the view hierarchy FIRST so the
      //    Taku renderer can resolve MediaView / click / ad-choice
      //    against a live UIView.
      nativeView.frame = self.bounds
      nativeView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.addSubview(nativeView)
      self.nativeAdView = nativeView

      // 2. THEN hand the offer + mounted view to the renderer.
      offer.renderer(
        with: configuration,
        selfRenderView: nil,
        nativeADView: nativeView
      )

      self.isLoaded = true
      self.sendAvailabilityChange(available: true)
    }
  }

  private func loadAndRenderNative(placementID: String) {
    var extra: [String: Any] = [
      kATExtraInfoNativeAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 180))
    ]
    if let vc = findViewController() {
      extra[kATAdLoadingExtraShowViewControllerKey] = vc
    }
    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }
  #endif

  // MARK: - Cleanup

  /// `clearAd()` is invoked from many paths, including mid-cycle
  /// `renderBanner` / `renderNative`. It MUST NOT touch `refreshTimer`:
  /// the timer is the responsibility of explicit lifecycle callers
  /// (format/sceneID didSet, `handleDetach`, `handleSuppressionChange`
  /// when suppression goes true, and `deinit`). If `clearAd()` killed
  /// the timer, every successful render would immediately cancel the
  /// next scheduled refresh.
  private func clearAd() {
    #if canImport(AnyThinkSDK)
    if let banner = bannerView as? ATBannerView {
      banner.destroyBanner()
    }
    if let native = nativeAdView as? ATNativeADView {
      native.destroyNative()
    }
    #endif

    bannerView?.removeFromSuperview()
    nativeAdView?.removeFromSuperview()
    bannerView = nil
    nativeAdView = nil
    isLoaded = false
  }

  private func sendAvailabilityChange(available: Bool) {
    onAvailabilityChange([
      "available": available,
      "sceneID": sceneID
    ])
  }

  private func sendAdError(message: String) {
    onAdError([
      "message": message,
      "sceneID": sceneID
    ])
  }

  private func findViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let nextResponder = responder?.next {
      if let viewController = nextResponder as? UIViewController {
        return viewController
      }
      responder = nextResponder
    }
    return nil
  }

  public override func layoutSubviews() {
    super.layoutSubviews()

    bannerView?.frame = bounds
    nativeAdView?.frame = bounds
  }
}

#if canImport(AnyThinkSDK)
extension WakeFitAdsAdView: ATBannerDelegate {
  public func bannerView(
    _ bannerView: ATBannerView,
    didShowAdWithPlacementID placementID: String,
    extra: [AnyHashable: Any]
  ) {}

  public func bannerView(
    _ bannerView: ATBannerView,
    didClickWithPlacementID placementID: String,
    extra: [AnyHashable: Any]
  ) {}
}

extension WakeFitAdsAdView: ATNativeADDelegate {
  public func didShowNativeAd(
    in adView: ATNativeADView,
    placementID: String,
    extra: [AnyHashable: Any]
  ) {}

  public func didClickNativeAd(
    in adView: ATNativeADView,
    placementID: String,
    extra: [AnyHashable: Any]
  ) {}
}

extension WakeFitAdsAdView: ATAdLoadingDelegate {
  public func didFinishLoadingAD(withPlacementID placementID: String) {
    DispatchQueue.main.async { [weak self] in
      self?.updateAd()
    }
  }

  public func didFailToLoadAD(withPlacementID placementID: String, error: Error) {
    DispatchQueue.main.async { [weak self] in
      self?.sendAdError(message: error.localizedDescription)
      self?.sendAvailabilityChange(available: false)
    }
  }
}
#endif