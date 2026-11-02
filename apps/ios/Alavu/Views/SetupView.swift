import SwiftUI

/// First run: pick the currency and month start for the default "Personal" space.
struct SetupView: View {
    @Environment(AppModel.self) private var model
    @State private var currency = Locale.autoupdatingCurrent.currency?.identifier ?? "USD"
    @State private var monthStartDay = 1
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CurrencyPicker(selection: $currency)
                    MonthStartPicker(day: $monthStartDay)
                } header: {
                    Text("Your Personal space")
                } footer: {
                    Text("You can add more spaces later, like Office or Family, each with its own currency.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Welcome")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Continue") { Task { await save() } }
                        .disabled(saving)
                }
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await model.sync?.setUp(currency: currency, monthStartDay: monthStartDay)
            Analytics.capture("setup_completed", ["currency": currency])
        } catch {
            self.error = String(localized: "Couldn't finish setup. Check your connection and try again.")
        }
    }
}

struct CurrencyPicker: View {
    @Binding var selection: String

    private static let codes: [String] = {
        let common = Set(Locale.commonISOCurrencyCodes)
        return common.sorted { name(for: $0) < name(for: $1) }
    }()

    static func name(for code: String) -> String {
        Locale.autoupdatingCurrent.localizedString(forCurrencyCode: code) ?? code
    }

    var body: some View {
        Picker("Currency", selection: $selection) {
            ForEach(Self.codes, id: \.self) { code in
                Text("\(Self.name(for: code)) (\(code))").tag(code)
            }
        }
        .pickerStyle(.navigationLink)
    }
}

struct MonthStartPicker: View {
    @Binding var day: Int

    var body: some View {
        Picker("Month Starts On", selection: $day) {
            ForEach(1...28, id: \.self) { day in
                Text(day == 1 ? String(localized: "1st (calendar month)") : Self.ordinal(day)).tag(day)
            }
        }
    }

    static func ordinal(_ day: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .ordinal
        return formatter.string(from: day as NSNumber) ?? "\(day)"
    }
}
