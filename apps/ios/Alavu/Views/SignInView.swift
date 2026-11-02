import AuthenticationServices
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(AuthService.self) private var auth
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var inProgress: AuthService.Provider?
    @State private var error: String?
    @State private var verification: EmailVerificationNeeded?

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
                button(.apple, title: "Continue with Apple") {
                    Image(systemName: "apple.logo").font(.title3)
                }
                button(.google, title: "Continue with Google") {
                    Image("GoogleLogo").resizable().frame(width: 18, height: 18)
                }
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
        .sheet(item: $verification) { check in
            EmailCodeView(check: check)
        }
    }

    private func button(_ provider: AuthService.Provider, title: LocalizedStringKey, @ViewBuilder logo: () -> some View) -> some View {
        Button {
            Task { await signIn(provider) }
        } label: {
            HStack(spacing: 10) {
                if inProgress == provider {
                    ProgressView()
                } else {
                    logo()
                }
                Text(title)
            }
        }
        .buttonStyle(ProviderButtonStyle(provider: provider))
        .disabled(inProgress != nil)
    }

    private func signIn(_ provider: AuthService.Provider) async {
        inProgress = provider
        defer { inProgress = nil }
        do {
            try await auth.signIn(with: provider, using: webAuth)
            model.didSignIn()
        } catch let check as EmailVerificationNeeded {
            verification = check
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // The user closed the sheet.
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Asks for the code WorkOS emailed before it links a second sign-in method to an
/// existing account.
private struct EmailCodeView: View {
    let check: EmailVerificationNeeded
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var verifying = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var isComplete: Bool { code.count == 6 && code.allSatisfy(\.isNumber) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("6-digit code", text: $code)
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                        .font(.title2.monospacedDigit())
                        .focused($focused)
                        .onChange(of: code) { _, new in
                            code = String(new.filter(\.isNumber).prefix(6))
                        }
                        .onSubmit { Task { await verify() } }
                } footer: {
                    if let email = check.email {
                        Text("You already have an account with \(email). Enter the code we just sent there to link this sign-in to it.")
                    } else {
                        Text("You already have an account with this email. Enter the code we just sent there to link this sign-in to it.")
                    }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Check Your Email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if verifying {
                        ProgressView()
                    } else {
                        Button("Verify") { Task { await verify() } }
                            .disabled(!isComplete)
                    }
                }
            }
            .onAppear { focused = true }
            .interactiveDismissDisabled(verifying)
        }
        .presentationDetents([.medium])
    }

    private func verify() async {
        guard isComplete, !verifying else { return }
        verifying = true
        defer { verifying = false }
        do {
            try await model.verifyEmail(code: code, for: check)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Sign-in buttons that follow each provider's own guidelines: Apple's is black in light
/// mode and white in dark mode; Google's is white (or near-black in dark mode) with a
/// thin gray outline and the full-color "G".
private struct ProviderButtonStyle: ButtonStyle {
    let provider: AuthService.Provider
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled

    private var dark: Bool { colorScheme == .dark }

    private var fill: Color {
        switch provider {
        case .apple: dark ? .white : .black
        case .google: dark ? Color(red: 0x13 / 255, green: 0x13 / 255, blue: 0x14 / 255) : .white
        }
    }

    private var text: Color {
        switch provider {
        case .apple: dark ? .black : .white
        case .google: dark ? Color(red: 0xE3 / 255, green: 0xE3 / 255, blue: 0xE3 / 255) : Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x1F / 255)
        }
    }

    private var stroke: Color {
        switch provider {
        case .apple: .clear
        case .google: dark ? Color(red: 0x8E / 255, green: 0x91 / 255, blue: 0x8F / 255) : Color(red: 0x74 / 255, green: 0x77 / 255, blue: 0x75 / 255)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(text)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(fill, in: .capsule)
            .overlay(Capsule().strokeBorder(stroke, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.75 : (isEnabled ? 1 : 0.6))
            .contentShape(.capsule)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
