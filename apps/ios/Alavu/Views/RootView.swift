import AlavuKit
import SwiftData
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AuthService.self) private var auth
    @Query(filter: #Predicate<Space> { !$0.isRemoved }) private var spaces: [Space]

    var body: some View {
        Group {
            if !auth.isSignedIn {
                SignInView()
            } else if !spaces.isEmpty {
                MainView()
            } else if let sync = model.sync, sync.needsSetup {
                SetupView()
            } else {
                LoadingAccountView()
            }
        }
        .animation(.default, value: auth.isSignedIn)
        .animation(.default, value: spaces.isEmpty)
        .onOpenURL { url in
            if url.host() == "add" { model.pendingAddEntry = true }
        }
    }
}

private struct LoadingAccountView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ContentUnavailableView {
            ProgressView()
        } description: {
            if case .offline = model.sync?.status {
                Text("Connect to the internet to finish signing in.")
            } else {
                Text("Getting your account ready…")
            }
        } actions: {
            Button("Sign Out", role: .destructive) {
                Task { await model.signOut() }
            }
        }
    }
}
