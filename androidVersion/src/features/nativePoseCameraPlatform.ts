export function supportsNativePoseCameraPlatform(platform: string): boolean {
  return platform === 'android' || platform === 'ios';
}
