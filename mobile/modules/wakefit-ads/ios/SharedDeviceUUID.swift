import CryptoKit
import Darwin
import Security
import UIKit

public final class WakeFitSharedDeviceUUID {
  private static let service = "com.hotinvestment.deviceuuid"
  private static let account = "device_uuid"
  private static let sharedAccessGroupSuffix = "com.hotinvestment.deviceuuid"

  /// All apps sharing device identifier must configure the same Keychain Access Group.
  /// Access Group prefix is read from the default Access Group returned by Keychain,
  /// not inferred from Info.plist or DEVELOPMENT_TEAM.
  private static let sharedAccessGroup: String? = {
    guard let prefix = signedAppIdentifierPrefix() else { return nil }
    return prefix + sharedAccessGroupSuffix
  }()

  public static func getUUID() -> String {
    // 1. Prefer shared Keychain data used by multiple apps from same developer.
    if let accessGroup = sharedAccessGroup,
       let sharedID = readUUID(accessGroup: accessGroup) {
      return sharedID
    }

    // 2. Migration: move legacy ID from app-private Keychain to shared area.
    if let legacyID = readUUID(accessGroup: nil) {
      return saveToSharedKeychain(legacyID) ?? legacyID
    }

    // 3. Neither shared nor legacy data exists - create unified ID on first launch.
    let sourceID = UIDevice.current.identifierForVendor?.uuidString
      ?? UUID().uuidString
    let digest = SHA256.hash(data: Data(sourceID.utf8))
    let generatedID = digest.map { String(format: "%02x", $0) }.joined()

    if let sharedID = saveToSharedKeychain(generatedID) {
      return sharedID
    }

    // Fallback: save to current app's private Keychain if shared permissions not configured.
    return saveUUID(generatedID, accessGroup: nil) ?? generatedID
  }

  public static func getDeviceModel() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machineMirror = Mirror(reflecting: systemInfo.machine)
    return machineMirror.children.reduce("") { identifier, element in
      guard let value = element.value as? Int8, value != 0 else {
        return identifier
      }
      return identifier + String(UnicodeScalar(UInt8(value)))
    }
  }

  /// Delete shared device ID and clean up legacy private ID.
  public static func deleteIDFV() -> Bool {
    let sharedStatus = sharedAccessGroup.map {
      deleteUUID(accessGroup: $0)
    } ?? errSecItemNotFound
    let legacyStatus = deleteUUID(accessGroup: nil)

    let sharedSucceeded = sharedStatus == errSecSuccess || sharedStatus == errSecItemNotFound
    let legacySucceeded = legacyStatus == errSecSuccess || legacyStatus == errSecItemNotFound

    if sharedSucceeded && legacySucceeded {
      print("WakeFitAds: Shared device ID removed from Keychain")
      return true
    }

    print("WakeFitAds: Keychain deletion failed, shared: \(sharedStatus), legacy: \(legacyStatus)")
    return false
  }

  private static func saveToSharedKeychain(_ uuid: String) -> String? {
    guard let accessGroup = sharedAccessGroup else { return nil }
    return saveUUID(uuid, accessGroup: accessGroup)
  }

  private static func readUUID(accessGroup: String?) -> String? {
    var query = baseQuery(accessGroup: accessGroup)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess,
          let data = result as? Data,
          let uuid = String(data: data, encoding: .utf8),
          !uuid.isEmpty else {
      return nil
    }
    return uuid
  }

  /// Returns the value finally adopted in Keychain. If another app writes concurrently,
  /// the first-written value is used.
  private static func saveUUID(_ uuid: String, accessGroup: String?) -> String? {
    var query = baseQuery(accessGroup: accessGroup)
    query[kSecValueData as String] = Data(uuid.utf8)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let status = SecItemAdd(query as CFDictionary, nil)
    if status == errSecSuccess {
      return uuid
    }
    if status == errSecDuplicateItem {
      return readUUID(accessGroup: accessGroup)
    }

    print("WakeFitAds: Keychain save failed, error: \(status)")
    return nil
  }

  private static func deleteUUID(accessGroup: String?) -> OSStatus {
    SecItemDelete(baseQuery(accessGroup: accessGroup) as CFDictionary)
  }

  private static func baseQuery(accessGroup: String?) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    if let accessGroup {
      query[kSecAttrAccessGroup as String] = accessGroup
    }
    return query
  }

  /// Get App Identifier Prefix from the default Keychain Access Group assigned by system.
  /// This prefix usually equals Team ID, but is compatible with older accounts where
  /// App Identifier Prefix differs from Team ID.
  private static func signedAppIdentifierPrefix() -> String? {
    let probeService = "\(service).access-group-probe"
    let probeAccount = UUID().uuidString
    let probeData = Data(probeAccount.utf8)
    let item: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: probeService,
      kSecAttrAccount as String: probeAccount,
      kSecValueData as String: probeData,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]

    let addStatus = SecItemAdd(item as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      print("WakeFitAds: Cannot create Keychain access group probe item, error: \(addStatus)")
      return nil
    }

    defer {
      let deleteQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: probeService,
        kSecAttrAccount as String: probeAccount
      ]
      SecItemDelete(deleteQuery as CFDictionary)
    }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: probeService,
      kSecAttrAccount as String: probeAccount,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess,
          let attributes = result as? [String: Any],
          let defaultAccessGroup = attributes[kSecAttrAccessGroup as String] as? String else {
      print("WakeFitAds: Cannot read Keychain Access Group, error: \(status)")
      return nil
    }

    if let bundleID = Bundle.main.bundleIdentifier {
      let suffix = ".\(bundleID)"
      if defaultAccessGroup.hasSuffix(suffix) {
        return String(defaultAccessGroup.dropLast(bundleID.count))
      }
    }

    guard let separator = defaultAccessGroup.firstIndex(of: ".") else {
      return nil
    }
    return String(defaultAccessGroup[...separator])
  }
}
