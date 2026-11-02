import AuthenticationServices
import SwiftUI
import ConvexMobile
import Foundation
import Observation
import WorkOS

/// Bridges WorkOS tokens into the Convex client.
final class WorkOSConvexAuth: AuthProvider, @unchecked Sendable {
    let tokens: TokenStore

    init(tokens: TokenStore) {
        self.tokens = tokens
    }

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        try await loginFromCache(onIdToken: onIdToken)
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> String {
        await tokens.setTokenHandler(onIdToken)
        return try await tokens.validAccessToken()
    }

    func logout() async throws {}

    func extractIdToken(from authResult: String) -> String { authResult }
}

/// Sign-in state for the app. Sign-in runs in the system web sheet because WorkOS
/// doesn't accept native Sign in with Apple credentials yet.
@MainActor
@Observable
final class AuthService {
    enum Provider: String {
        case apple = "AppleOAuth"
        case google = "GoogleOAuth"
    }

    static let redirectURI = "alavu://auth/callback"

    private(set) var session: StoredSession?
    let tokens: TokenStore
    private let workos: PublicClient

    init(clientID: String) {
        tokens = TokenStore(clientID: clientID)
        workos = PublicClient(clientID: clientID)
        session = Keychain.load()
    }

    var isSignedIn: Bool { session != nil }

    func signIn(with provider: Provider, using webAuth: WebAuthenticationSession) async throws {
        let request = try workos.getAuthorizationUrlWithPKCE(redirectUri: Self.redirectURI, provider: provider.rawValue)
        let callback = try await webAuth.authenticate(
            using: request.url,
            callback: .customScheme("alavu"),
            preferredBrowserSession: .ephemeral,
            additionalHeaderFields: [:]
        )
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let code = items.first(where: { $0.name == "code" })?.value,
              items.first(where: { $0.name == "state" })?.value == request.state
        else { throw AuthError.invalidCallback }
        let response = try await workos.authenticateWithCode(code: code, codeVerifier: request.codeVerifier)
        await tokens.store(response)
        session = await tokens.currentSession
    }

    #if DEBUG
    /// End-to-end tests start a session from a test user's refresh token passed in the
    /// `ALAVU_E2E_REFRESH_TOKEN` launch environment. Debug builds only.
    func signInForTesting() async -> Bool {
        guard session == nil,
              let token = ProcessInfo.processInfo.environment["ALAVU_E2E_REFRESH_TOKEN"], !token.isEmpty,
              let response = try? await workos.authenticateWithRefreshToken(refreshToken: token)
        else { return false }
        await tokens.store(response)
        session = await tokens.currentSession
        return true
    }
    #endif

    /// Forgets the session on this device. Local data is wiped by the caller.
    func signOut() async {
        await tokens.clear()
        session = nil
    }
}
