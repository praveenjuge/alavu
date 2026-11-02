import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(AuthService.self) private var auth
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var inProgress: AuthService.Provider?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "gauge.with.dots.needle.67percent")
                .font(.system(size: 64, weight: .semibold))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Alavu")
                    .font(.largeTitle.bold())
                Text("Track what you spend and earn, across every part of your life.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                button(.apple, title: "Continue with Apple", symbol: "apple.logo")
                button(.google, title: "Continue with Google", symbol: "g.circle.fill")
            }
            Text("By continuing you agree to the [Terms](\(AppConfig.termsURL)) and [Privacy Policy](\(AppConfig.privacyURL)).")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .alert("Couldn't Sign In", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func button(_ provider: AuthService.Provider, title: LocalizedStringKey, symbol: String) -> some View {
        Button {
            Task { await signIn(provider) }
        } label: {
            HStack {
                if inProgress == provider {
                    ProgressView()
                } else {
                    Image(systemName: symbol)
                }
                Text(title)
            }
            .frame(maxWidth: .infinity)
            // Apple's button follows the system: black in light mode, white in dark.
            .foregroundStyle(provider == .apple ? Color(.systemBackground) : .white)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .tint(provider == .apple ? .primary : .accentColor)
        .disabled(inProgress != nil)
    }

    private func signIn(_ provider: AuthService.Provider) async {
        inProgress = provider
        defer { inProgress = nil }
        do {
            try await auth.signIn(with: provider, using: webAuth)
            model.didSignIn()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The user closed the sheet.
        } catch {
            self.error = error.localizedDescription
        }
    }
}
