import AlavuKit
import AppIntents
import BackgroundTasks
import ConvexMobile
import SwiftData
import SwiftUI

@main
struct AlavuApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        _model = State(initialValue: model)
        AppDependencyManager.shared.add(dependency: model)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.auth)
                .modelContainer(model.container)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: model.sync?.requestSync()
            case .background: AppModel.scheduleBackgroundSync()
            default: break
            }
        }
        .backgroundTask(.appRefresh(AppModel.backgroundTaskID)) {
            await model.backgroundSync()
        }
    }
}

/// App-wide services. The sync engine only exists while someone is signed in.
nonisolated struct VerificationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
@Observable
final class AppModel {
    nonisolated static let backgroundTaskID = "com.praveenjuge.alavu.sync"

    let container: ModelContainer
    let auth: AuthService
    private let convex: ConvexClientWithAuth<String>
    private(set) var sync: SyncEngine?
    /// Set by deep links and App Intents to open the new-entry sheet.
    var pendingAddEntry = false

    init() {
        Analytics.setUp()
        do {
            container = try Store.makeContainer()
        } catch {
            fatalError("Couldn't open the on-device database: \(error)")
        }
        auth = AuthService(clientID: AppConfig.workOSClientID)
        convex = ConvexClientWithAuth(deploymentUrl: AppConfig.convexURL, authProvider: WorkOSConvexAuth(tokens: auth.tokens))
        if auth.isSignedIn { startSync() }
        #if DEBUG
        Task { if await auth.signInForTesting() { didSignIn() } }
        #endif
    }

    func startSync() {
        guard sync == nil else { return }
        let engine = SyncEngine(client: convex, tokens: auth.tokens, context: container.mainContext) { [weak self] in
            Task { await self?.signOut() }
        }
        sync = engine
        engine.start()
    }

    /// Sends the emailed code to the server, which finishes the paused WorkOS sign-in.
    func verifyEmail(code: String, for check: EmailVerificationNeeded) async throws {
        do {
            let verified: StoredSession = try await convex.action(
                "signIn:verifyEmail",
                with: ["pendingAuthenticationToken": check.pendingAuthenticationToken, "code": code]
            )
            await auth.complete(with: verified)
        } catch ClientError.ConvexError(let data) {
            throw VerificationError(message: (try? JSONDecoder().decode(String.self, from: Data(data.utf8))) ?? data)
        }
        didSignIn()
    }

    func didSignIn() {
        Analytics.capture("signed_in")
        startSync()
    }

    func signOut() async {
        // Stop syncing first, so nothing runs against the session being torn down.
        sync?.stop()
        await convex.logout()
        try? sync?.resetLocalData()
        sync = nil
        await auth.signOut()
        Analytics.reset()
    }

    func deleteAccount() async throws {
        guard let sync else { return }
        try await sync.deleteAccount()
        Analytics.capture("account_deleted")
        await signOut()
    }

    func backgroundSync() async {
        AppModel.scheduleBackgroundSync()
        await sync?.syncNow()
    }

    nonisolated static func scheduleBackgroundSync() {
        let request = BGAppRefreshTaskRequest(identifier: backgroundTaskID)
        request.earliestBeginDate = .now.addingTimeInterval(30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
