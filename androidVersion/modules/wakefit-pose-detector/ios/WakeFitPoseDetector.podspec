require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'WakeFitPoseDetector'
  s.version        = package['version']
  s.summary        = 'WakeFit pose detector native module'
  s.description    = 'Native camera, pose detection, and alarm bridge for WakeFit.'
  s.license        = 'MIT'
  s.author         = 'WakeFit'
  s.homepage       = 'https://example.com/wakefit'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://example.com/wakefit.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision', 'UserNotifications', 'AudioToolbox'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
