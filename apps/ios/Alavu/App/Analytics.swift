import Foundation
import PostHog

/// Anonymous product analytics and crash reports through PostHog, Release builds only.
/// Events are never tied to the account and never include amounts, titles, notes or
/// category names, matching the privacy policy and the App Store privacy labels.
enum Analytics {
    static let optOutKey = "analyticsOptOut"
    private static var isEnabled = false

    static func setUp() {
        let key = AppConfig.postHogAPIKey
        guard !key.isEmpty else { return }
        let config = PostHogConfig(projectToken: key, host: AppConfig.postHogHost)
        config.errorTrackingConfig.autoCapture = true
        config.captureScreenViews = false
        config.personProfiles = .identifiedOnly
        config.optOut = UserDefaults.standard.bool(forKey: optOutKey)
        PostHogSDK.shared.setup(config)
        isEnabled = true
    }

    static func capture(_ event: String, _ properties: [String: Any] = [:]) {
        guard isEnabled else { return }
        PostHogSDK.shared.capture(event, properties: properties)
    }

    static func setOptedOut(_ optedOut: Bool) {
        UserDefaults.standard.set(optedOut, forKey: optOutKey)
        guard isEnabled else { return }
        if optedOut { PostHogSDK.shared.optOut() } else { PostHogSDK.shared.optIn() }
    }

    static func reset() {
        guard isEnabled else { return }
        PostHogSDK.shared.reset()
    }
}
