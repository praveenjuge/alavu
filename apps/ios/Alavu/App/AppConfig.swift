import Foundation

/// Values injected per build configuration through the xcconfig files.
enum AppConfig {
    private static func value(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "")
            .trimmingCharacters(in: .whitespaces)
    }

    static var convexURL: String { value("ConvexURL") }
    static var workOSClientID: String { value("WorkOSClientID") }
    static var postHogAPIKey: String { value("PostHogAPIKey") }
    static var postHogHost: String { value("PostHogHost") }

    static let siteURL = URL(string: "https://alavu.praveenjuge.com")!
    static let privacyURL = URL(string: "https://alavu.praveenjuge.com/privacy")!
    static let termsURL = URL(string: "https://alavu.praveenjuge.com/terms")!
    static let supportURL = URL(string: "https://alavu.praveenjuge.com/support")!
}
