import Foundation
import Security
import WorkOS

/// The signed-in user's WorkOS session, kept in the Keychain.
nonisolated struct StoredSession: Codable, Sendable {
    var accessToken: String
    var refreshToken: String
    var userID: String
    var email: String?
    var name: String?
}

nonisolated enum AuthError: LocalizedError {
    /// The refresh token was revoked or expired; the user has to sign in again.
    case sessionExpired
    case notSignedIn
    case invalidCallback

    var errorDescription: String? {
        switch self {
        case .sessionExpired: String(localized: "Your session has ended. Please sign in again.")
        case .notSignedIn: String(localized: "You're signed out.")
        case .invalidCallback: String(localized: "Sign-in didn't complete. Please try again.")
        }
    }
}

/// Owns the WorkOS tokens. Refreshes are serialized because WorkOS rotates the refresh
/// token on every use: two refreshes racing with the same token would sign the user out.
actor TokenStore {
    private let client: PublicClient
    private var session: StoredSession?
    private var refreshTask: Task<StoredSession, Error>?
    private var onToken: (@Sendable (String?) -> Void)?

    init(clientID: String) {
        self.client = PublicClient(clientID: clientID)
        self.session = Keychain.load()
    }

    var currentSession: StoredSession? { session }

    func store(_ response: AuthenticateResponse) {
        let user = response.user
        let name = [user.firstName, user.lastName].compactMap { $0 }.joined(separator: " ")
        let session = StoredSession(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            userID: user.id,
            email: user.email,
            name: name.isEmpty ? nil : name
        )
        self.session = session
        Keychain.save(session)
    }

    func clear() {
        refreshTask?.cancel()
        refreshTask = nil
        session = nil
        Keychain.delete()
    }

    /// Called by the Convex client with a callback for pushing refreshed tokens.
    func setTokenHandler(_ handler: @escaping @Sendable (String?) -> Void) {
        onToken = handler
    }

    /// Returns an access token that is valid for at least another minute,
    /// refreshing it first if needed.
    func validAccessToken() async throws -> String {
        guard let session else { throw AuthError.notSignedIn }
        if let expiry = Self.expiry(of: session.accessToken), expiry.timeIntervalSinceNow > 60 {
            return session.accessToken
        }
        return try await refresh().accessToken
    }

    private func refresh() async throws -> StoredSession {
        if let refreshTask { return try await refreshTask.value }
        guard let current = session else { throw AuthError.notSignedIn }
        let task = Task { [client] in
            do {
                let response = try await client.authenticateWithRefreshToken(refreshToken: current.refreshToken)
                var updated = current
                updated.accessToken = response.accessToken
                updated.refreshToken = response.refreshToken
                return updated
            } catch WorkOSError.badRequest, WorkOSError.authentication {
                throw AuthError.sessionExpired
            }
        }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let updated = try await task.value
            session = updated
            Keychain.save(updated)
            onToken?(updated.accessToken)
            return updated
        } catch AuthError.sessionExpired {
            clear()
            onToken?(nil)
            throw AuthError.sessionExpired
        }
    }

    /// Reads the `exp` claim from a JWT without verifying it (the server verifies).
    static func expiry(of jwt: String) -> Date? {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var base64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64),
              let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = claims["exp"] as? Double
        else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}

/// Minimal Keychain wrapper for the session, readable after first unlock so
/// background sync keeps working.
nonisolated enum Keychain {
    private static let service = "com.praveenjuge.alavu.session"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
    }

    static func load() -> StoredSession? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(StoredSession.self, from: data)
    }

    static func save(_ session: StoredSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
