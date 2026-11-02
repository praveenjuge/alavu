import AlavuKit
import SwiftData
import SwiftUI

struct RecurringList: View {
    let space: Space
    @Query private var rules: [RecurringRule]
    @State private var editing: RecurringRule?
    @State private var adding = false

    init(space: Space) {
        self.space = space
        let uid = space.uid
        _rules = Query(filter: #Predicate<RecurringRule> { $0.spaceUid == uid && !$0.isRemoved }, sort: \RecurringRule.nextDueOn)
    }

    var body: some View {
        List {
            Section {
                ForEach(rules) { rule in
                    Button { editing = rule } label: { RuleRow(rule: rule) }
                        .tint(.primary)
                }
                Button("Add Repeating Entry", systemImage: "plus") { adding = true }
            } footer: {
                Text("Repeating entries are added automatically on their due date, even when the app is closed.")
            }
        }
        .navigationTitle("Repeating Entries")
        .sheet(item: $editing) { RecurringEditor(space: space, rule: $0) }
        .sheet(isPresented: $adding) { RecurringEditor(space: space, rule: nil) }
    }
}

private struct RuleRow: View {
    let rule: RecurringRule

    private var schedule: String {
        let unit: String = switch rule.cadence {
        case .weekly: rule.interval == 1 ? String(localized: "Every week") : String(localized: "Every \(rule.interval) weeks")
        case .monthly: rule.interval == 1 ? String(localized: "Every month") : String(localized: "Every \(rule.interval) months")
        case .yearly: rule.interval == 1 ? String(localized: "Every year") : String(localized: "Every \(rule.interval) years")
        }
        if rule.pausedAt != nil { return String(localized: "\(unit) · Paused") }
        if !rule.isActive { return String(localized: "\(unit) · Ended") }
        let next = CalendarDay.date(from: rule.nextDueOn)?.dayTitle ?? rule.nextDueOn
        return String(localized: "\(unit) · Next \(next)")
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.title)
                Text(schedule).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Text(Money.format(minor: rule.amountMinor, currency: rule.currency))
                .monospacedDigit()
                .foregroundStyle(rule.kind == .income ? Color.green : Color.primary)
        }
        .accessibilityElement(children: .combine)
    }
}

struct RecurringEditor: View {
    let space: Space
    let rule: RecurringRule?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query private var categories: [EntryCategory]
    @Query(filter: #Predicate<PaymentMethod> { !$0.isRemoved }, sort: \PaymentMethod.sortOrder) private var paymentMethods: [PaymentMethod]
    @State private var kind: CategoryKind
    @State private var amount: Decimal?
    @State private var title: String
    @State private var categoryUid: String?
    @State private var paymentMethodUid: String?
    @State private var cadence: Cadence
    @State private var interval: Int
    @State private var start: Date
    @State private var hasEnd: Bool
    @State private var end: Date
    @State private var paused: Bool
    @State private var confirmingDelete = false

    init(space: Space, rule: RecurringRule?) {
        self.space = space
        self.rule = rule
        let uid = space.uid
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid && !$0.isRemoved }, sort: \EntryCategory.sortOrder)
        _kind = State(initialValue: rule?.kind ?? .expense)
        _amount = State(initialValue: rule.map { Money.decimal(minor: $0.amountMinor, currency: $0.currency) })
        _title = State(initialValue: rule?.title ?? "")
        _categoryUid = State(initialValue: rule?.categoryUid)
        _paymentMethodUid = State(initialValue: rule?.paymentMethodUid)
        _cadence = State(initialValue: rule?.cadence ?? .monthly)
        _interval = State(initialValue: rule?.interval ?? 1)
        _start = State(initialValue: rule.flatMap { CalendarDay.date(from: $0.startOn) } ?? .now)
        _hasEnd = State(initialValue: rule?.endOn != nil)
        _end = State(initialValue: rule?.endOn.flatMap { CalendarDay.date(from: $0) } ?? Calendar.current.date(byAdding: .year, value: 1, to: .now)!)
        _paused = State(initialValue: rule?.pausedAt != nil)
    }

    private var currency: String { rule?.currency ?? space.currency }
    private var amountMinor: Int64? { amount.flatMap { Money.minor(from: $0, currency: currency) } }
    private var isValid: Bool {
        (amountMinor ?? 0) > 0 && !title.trimmingCharacters(in: .whitespaces).isEmpty && (!hasEnd || end >= start)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $kind) {
                        Text("Expense").tag(CategoryKind.expense)
                        Text("Income").tag(CategoryKind.income)
                    }
                    .pickerStyle(.segmented)
                    .listRowSeparator(.hidden)
                    AmountField(title: "Amount", currency: currency, amount: $amount, large: true)
                }
                Section {
                    TextField("Title, like Rent", text: $title)
                    Picker("Category", selection: $categoryUid) {
                        Text("None").tag(String?.none)
                        ForEach(categories.filter { $0.kind == kind }) { c in
                            Label(c.name, systemImage: c.symbol).tag(Optional(c.uid))
                        }
                    }
                    .pickerStyle(.navigationLink)
                    Picker("Paid With", selection: $paymentMethodUid) {
                        Text("None").tag(String?.none)
                        ForEach(paymentMethods) { m in Label(m.name, systemImage: m.symbol).tag(Optional(m.uid)) }
                    }
                }
                Section("Schedule") {
                    Picker("Repeats", selection: $cadence) {
                        Text("Weekly").tag(Cadence.weekly)
                        Text("Monthly").tag(Cadence.monthly)
                        Text("Yearly").tag(Cadence.yearly)
                    }
                    Stepper(value: $interval, in: 1...12) {
                        LabeledContent("Every", value: intervalLabel)
                    }
                    DatePicker("Starts", selection: $start, displayedComponents: .date)
                    Toggle("Ends", isOn: $hasEnd)
                    if hasEnd {
                        DatePicker("End Date", selection: $end, in: start..., displayedComponents: .date)
                    }
                    if rule != nil { Toggle("Paused", isOn: $paused) }
                }
                if rule != nil {
                    Section {
                        Button("Delete Repeating Entry", role: .destructive) { confirmingDelete = true }
                    } footer: {
                        Text("Entries already added stay in your activity.")
                    }
                }
            }
            .navigationTitle(rule == nil ? "New Repeating Entry" : "Edit Repeating Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }.disabled(!isValid)
                }
            }
            .confirmationDialog("Delete this repeating entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let rule { try? Writer(context).delete(rule) }
                    dismiss()
                }
            }
        }
    }

    private var intervalLabel: String {
        switch cadence {
        case .weekly: interval == 1 ? String(localized: "week") : String(localized: "\(interval) weeks")
        case .monthly: interval == 1 ? String(localized: "month") : String(localized: "\(interval) months")
        case .yearly: interval == 1 ? String(localized: "year") : String(localized: "\(interval) years")
        }
    }

    private func save() {
        guard let amountMinor else { return }
        let target = rule ?? RecurringRule(spaceUid: space.uid, kind: kind, amountMinor: amountMinor, currency: currency, title: title, cadence: cadence, startOn: CalendarDay.string(from: start))
        target.kind = kind
        target.amountMinor = amountMinor
        target.title = title.trimmingCharacters(in: .whitespaces)
        target.categoryUid = categoryUid
        target.paymentMethodUid = paymentMethodUid
        target.cadence = cadence
        target.interval = interval
        target.startOn = CalendarDay.string(from: start)
        target.endOn = hasEnd ? CalendarDay.string(from: end) : nil
        target.pausedAt = paused ? (target.pausedAt ?? Clock.now) : nil
        try? Writer(context).save(target)
        if rule == nil { Analytics.capture("recurring_created", ["cadence": cadence.rawValue]) }
        dismiss()
    }
}
