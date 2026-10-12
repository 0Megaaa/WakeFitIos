require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'WakeFitAds'
  s.version        = package['version']
  s.summary        = 'WakeFit advertisement module with AnyThink/Taku SDK'
  s.description    = 'Native ad module for WakeFit using AnyThink/Taku SDK integration'
  s.license        = 'MIT'
  s.author         = 'WakeFit'
  s.homepage       = 'https://example.com/wakefit'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://example.com/wakefit.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # AnyThink/Taku SDK - matching MaskOverlay verified versions
  s.dependency 'AnyThinkiOS', '6.5.45'
  s.dependency 'AnyThinkMediationAdxSmartdigimktCNAdapter', '6.5.65.0'
  s.dependency 'AnyThinkMediationBaiduAdapter', '10.032.1'
  s.dependency 'AnyThinkMediationKuaiShouAdapter', '5.4.10.1.0'
  s.dependency 'AnyThinkMediationGDTAdapter', '4.15.90.0'

  s.frameworks = 'Security', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
