import AlavuKit
import SwiftData
import SwiftUI

struct BudgetsView: View {
    let space: Space

    var body: some View {
        BudgetsContent(space: space).id("\(space.uid)-\(space.monthStartDay)")
    }
}

private struct BudgetsContent: View {
    let space: Space
    @Query private var entries: [Entry]
    @Query private var budgets: [Budget]
    @Query private var categories: [EntryCategory]
    @State private var period: BudgetPeriod
    @State private var editing: BudgetEditor.Target?

    init(space: Space) {
        self.space = space
        let uid = space.uid
        _period = State(initialValue: BudgetPeriod(containing: .now, startDay: space.monthStartDay))
        _entries = Query(filter: #Predicate<Entry> { $0.spaceUid == uid && !$0.isRemoved })
        _budgets = Query(filter: #Predicate<Budget> { $0.spaceUid == uid && !$0.isRemoved })
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid }, sort: \EntryCategory.sortOrder)
    }

    var body: some View {
        let summary = PeriodSummary(entries: entries, period: period)
        let byCategory = Dictionary(categories.map { ($0.uid, $0) }) { a, _ in a }
        let overall = budgets.first { $0.categoryUid == nil }
        let categoryBudgets = budgets
            .filter { $0.categoryUid != nil }
            .sorted { summary.status(for: $0).fraction > summary.status(for: $1).fraction }
        NavigationStack {
            List {
                Section {
                    PeriodStepper(period: $period)
                }
                Section {
                    if let overall {
                        Button { editing = .budget(overall) } label: {
                            BudgetRow(title: String(localized: "Monthly Budget"), symbol: "chart.pie", status: summary.status(for: overall), currency: space.currency)
                        }
                        .tint(.primary)
                    } else {
                        Button("Set a Monthly Budget", systemImage: "plus") { editing = .new(categoryUid: nil) }
                    }
                } footer: {
                    Text("Covers every expense in \(space.name). Transfers between spaces don't count.")
                }
                Section("Categories") {
                    ForEach(categoryBudgets) { budget in
                        let category = budget.categoryUid.flatMap { byCategory[$0] }
                        Button { editing = .budget(budget) } label: {
                            BudgetRow(title: category?.name ?? String(localized: "Deleted Category"), symbol: category?.symbol ?? "tag", status: summary.status(for: budget), currency: space.currency)
                        }
                        .tint(.primary)
                    }
                    Button("Add Category Budget", systemImage: "plus") { editing = .new(categoryUid: "") }
                }
            }
            .spaceSwitcher(space)
            .toolbar { AddEntryButton() }
            .sheet(item: $editing) { target in
                BudgetEditor(space: space, target: target)
            }
        }
    }
}

private struct BudgetRow: View {
    let title: String
    let symbol: String
    let status: PeriodSummary.BudgetStatus
    let currency: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            SymbolBadge(symbol: symbol)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title)
                    Spacer()
                    StatusLabel(level: status.level)
                }
                BudgetGauge(status: status, currency: currency)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct StatusLabel: View {
    let level: PeriodSummary.BudgetStatus.Level

    var body: some View {
        switch level {
        case .within: label("On track", "checkmark.circle.fill", .green)
        case .approaching: label("Near limit", "exclamationmark.circle.fill", .orange)
        case .over: label("Over", "xmark.circle.fill", .red)
        }
    }

    private func label(_ text: LocalizedStringKey, _ symbol: String, _ color: Color) -> some View {
        Label(text, systemImage: symbol)
            .font(.footnote.weight(.medium))
            .foregroundStyle(color)
            .labelStyle(.titleAndIcon)
            .fixedSize()
    }
}

struct BudgetEditor: View {
    enum Target: Identifiable {
        case budget(Budget)
        /// `nil` for the overall budget, `""` to let the user pick a category.
        case new(categoryUid: String?)

        var id: String {
            switch self {
            case .budget(let b): b.uid
            case .new(let c): "new-\(c ?? "overall")"
            }
        }
    }

    let space: Space
    let target: Target
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query private var categories: [EntryCategory]
    @Query private var budgets: [Budget]
    @State private var categoryUid: String?
    @State private var amount: Decimal?
    @State private var error: String?
    @FocusState private var amountFocused: Bool

    init(space: Space, target: Target) {
        self.space = space
        self.target = target
        let uid = space.uid
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid && !$0.isRemoved }, sort: \EntryCategory.sortOrder)
        _budgets = Query(filter: #Predicate<Budget> { $0.spaceUid == uid && !$0.isRemoved })
        switch target {
        case .budget(let b):
            _categoryUid = State(initialValue: b.categoryUid)
            _amount = State(initialValue: Money.decimal(minor: b.amountMinor, currency: space.currency))
        case .new(let c):
            _categoryUid = State(initialValue: c)
        }
    }

    private var isNew: Bool { if case .new = target { true } else { false } }
    private var picksCategory: Bool { if case .new(let c) = target { c != nil } else { false } }
    private var minor: Int64? { amount.flatMap { Money.minor(from: $0, currency: space.currency) } }

    var body: some View {
        NavigationStack {
            Form {
                if picksCategory {
                    Picker("Category", selection: $categoryUid) {
                        Text("Choose").tag(String?.some(""))
                        ForEach(categories.filter { c in c.kind == .expense && !budgets.contains { $0.categoryUid == c.uid } }) { category in
                            Label(category.name, systemImage: category.symbol).tag(Optional(category.uid))
                        }
                    }
                }
                Section {
                    AmountField(title: "Monthly limit", currency: space.currency, amount: $amount, large: true)
                        .focused($amountFocused)
                } footer: {
                    Text("Resets on the \(MonthStartPicker.ordinal(space.monthStartDay)) of each month.")
                }
                if !isNew {
                    Section {
                        Button("Remove Budget", role: .destructive) { save(amountMinor: nil) }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .task { if isNew && !picksCategory { amountFocused = true } }
            .navigationTitle(isNew ? "New Budget" : "Edit Budget")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save(amountMinor: minor) }
                        .disabled((minor ?? 0) <= 0 || categoryUid == "")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save(amountMinor: Int64?) {
        do {
            try Writer(context).setBudget(spaceUid: space.uid, categoryUid: categoryUid, amountMinor: amountMinor)
            Analytics.capture(amountMinor == nil ? "budget_removed" : "budget_saved", ["scope": categoryUid == nil ? "overall" : "category"])
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
