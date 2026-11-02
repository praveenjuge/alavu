import AlavuKit
import SwiftData
import SwiftUI

/// A category or payment-method symbol in a tinted circle.
struct SymbolBadge: View {
    let symbol: String
    var tint: Color = .accentColor

    var body: some View {
        Image(systemName: symbol)
            .font(.body)
            .foregroundStyle(tint)
            .frame(width: 32, height: 32)
            .background(tint.opacity(0.15), in: .circle)
            .accessibilityHidden(true)
    }
}

/// An amount colored by direction: green for money in, primary for money out.
struct AmountText: View {
    let entry: Entry

    var body: some View {
        Text(Money.format(minor: entry.signedAmount, currency: entry.currency, showsSign: entry.kind.sign > 0))
            .monospacedDigit()
            .foregroundStyle(entry.kind.sign > 0 ? Color.green : Color.primary)
    }
}

struct EntryRow: View {
    let entry: Entry
    let category: EntryCategory?
    let paymentMethod: PaymentMethod?

    private var symbol: String {
        switch entry.kind {
        case .transferIn: "arrow.down.left"
        case .transferOut: "arrow.up.right"
        default: category?.symbol ?? (entry.kind == .income ? "plus.circle" : "tag")
        }
    }

    /// Transfers store the other space's name; show which way the money moved.
    private var title: String {
        switch entry.kind {
        case .transferOut: String(localized: "To \(entry.title)")
        case .transferIn: String(localized: "From \(entry.title)")
        default: entry.title
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if entry.kind.isTransfer {
            parts.append(String(localized: "Transfer"))
        } else {
            parts.append(category?.name ?? String(localized: "Uncategorized"))
        }
        if let paymentMethod { parts.append(paymentMethod.name) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            SymbolBadge(symbol: symbol, tint: entry.kind.sign > 0 ? .green : .accentColor)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(title).lineLimit(1)
                    if entry.recurringRuleUid != nil {
                        Image(systemName: "repeat").font(.caption).foregroundStyle(.secondary)
                            .accessibilityLabel("Repeats")
                    }
                    if entry.receiptCount > 0 {
                        Image(systemName: "paperclip").font(.caption).foregroundStyle(.secondary)
                            .accessibilityLabel("Has receipt")
                    }
                }
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            AmountText(entry: entry)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Lookup tables for rendering rows without a query per row.
struct Lookups {
    let categories: [String: EntryCategory]
    let paymentMethods: [String: PaymentMethod]

    init(categories: [EntryCategory], paymentMethods: [PaymentMethod]) {
        self.categories = Dictionary(categories.map { ($0.uid, $0) }) { a, _ in a }
        self.paymentMethods = Dictionary(paymentMethods.map { ($0.uid, $0) }) { a, _ in a }
    }

    func category(_ uid: String?) -> EntryCategory? { uid.flatMap { categories[$0] } }
    func paymentMethod(_ uid: String?) -> PaymentMethod? { uid.flatMap { paymentMethods[$0] } }
}

/// Grid of SF Symbols to choose an icon from.
struct SymbolPicker: View {
    let title: LocalizedStringKey
    let symbols: [String]
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52))], spacing: 12) {
                ForEach(symbols, id: \.self) { symbol in
                    Button {
                        selection = symbol
                        dismiss()
                    } label: {
                        Image(systemName: symbol)
                            .font(.title2)
                            .frame(width: 52, height: 52)
                            .background(selection == symbol ? Color.accentColor.opacity(0.2) : Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(symbol)
                    .accessibilityAddTraits(selection == symbol ? .isSelected : [])
                }
            }
            .padding()
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Amount field that edits a `Decimal` with the currency's own format.
struct AmountField: View {
    let title: LocalizedStringKey
    let currency: String
    @Binding var amount: Decimal?
    var large = false

    var body: some View {
        TextField(title, value: $amount, format: .currency(code: currency))
            .keyboardType(.decimalPad)
            .font(large ? .largeTitle.weight(.semibold) : .body)
            .monospacedDigit()
    }
}

extension Date {
    /// "Today", "Yesterday", or a date like "Mon, 2 Nov".
    var dayTitle: String {
        if Calendar.current.isDateInToday(self) { return String(localized: "Today") }
        if Calendar.current.isDateInYesterday(self) { return String(localized: "Yesterday") }
        let sameYear = Calendar.current.isDate(self, equalTo: .now, toGranularity: .year)
        return sameYear
            ? formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
            : formatted(.dateTime.day().month(.abbreviated).year())
    }
}
