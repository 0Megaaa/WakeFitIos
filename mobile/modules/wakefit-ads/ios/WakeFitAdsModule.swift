import ExpoModulesCore
import Foundation

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
    await WakeFitAdsManager.shared.start()
  }

  @MainActor
  private func getAdsStatus() -> [String: Any] {
    return WakeFitAdsManager.shared.getStatus()
  }
}

// MARK: - Native Ad View

#if canImport(AnyThinkSDK)
import AnyThinkSDK
#endif

public class WakeFitAdsAdView: ExpoView,
  UIViewControllerTransitioningDelegate,
  UIGestureRecognizerDelegate {
  @objc public var adFormat: String = "banner" {
    didSet { updateAd() }
  }

  @objc public var sceneID: String = "default" {
    didSet { updateAd() }
  }

  private var bannerView: UIView?
  private var nativeAdView: UIView?
  private var isLoaded = false

  let onAvailabilityChange = EventDispatcher()
  let onAdError = EventDispatcher()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  private func updateAd() {
    guard !adFormat.isEmpty, !sceneID.isEmpty else { return }

    // Clear existing ad view
    clearAd()

    // Check if ad should be shown
    let manager = WakeFitAdsManager.shared
    guard manager.adsEnabled, !manager.suppressed else {
      sendAvailabilityChange(available: false)
      return
    }

    // Get placement ID based on format
    let placementID: String
    switch adFormat {
    case "banner":
      placementID = manager.bannerPlacementId
    case "native":
      placementID = manager.nativePlacementId
    default:
      placementID = ""
    }

    guard !placementID.isEmpty else {
      sendAvailabilityChange(available: false)
      return
    }

    // Check if ad is ready and render
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

  #if canImport(AnyThinkSDK)
  private func renderBanner(placementID: String) {
    let config = ATShowConfig(scene: sceneID, showCustomExt: nil)
    guard let bannerView = ATAdManager.shared().retrieveBannerView(
      forPlacementID: placementID,
      config: config
    ) else {
      sendAvailabilityChange(available: false)
      return
    }

    bannerView.delegate = self
    bannerView.presentingViewController = findViewController()

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.clearAd()

      bannerView.frame = self.bounds
      bannerView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.addSubview(bannerView)
      self.bannerView = bannerView

      self.isLoaded = true
      self.sendAvailabilityChange(available: true)
    }
  }

  private func loadAndRenderBanner(placementID: String) {
    let extra: [String: Any] = [
      kATAdLoadingExtraBannerAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 50)),
      kATExtraInfoAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 50))
    ]

    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }

  private func renderNative(placementID: String) {
    guard let offer = ATAdManager.shared().getNativeAdOffer(withPlacementID: placementID, scene: sceneID) else {
      sendAvailabilityChange(available: false)
      return
    }

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

      nativeView.frame = self.bounds
      nativeView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.addSubview(nativeView)
      self.nativeAdView = nativeView

      self.isLoaded = true
      self.sendAvailabilityChange(available: true)
    }
  }

  private func loadAndRenderNative(placementID: String) {
    let extra: [String: Any] = [
      kATExtraInfoNativeAdSizeKey: NSValue(cgSize: CGSize(width: bounds.width > 0 ? bounds.width : 320, height: 180))
    ]

    ATAdManager.shared().loadAD(withPlacementID: placementID, extra: extra, delegate: self)
  }
  #endif

  private func clearAd() {
    bannerView?.removeFromSuperview()
    bannerView = nil
    nativeAdView?.removeFromSuperview()
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

    // Resize ad views when view size changes
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
    // Re-trigger render
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
