import AlavuKit
import Charts
import SwiftData
import SwiftUI

struct OverviewView: View {
    let space: Space

    var body: some View {
        // Rebuilt per space so the queries filter on the right space.
        OverviewContent(space: space).id(space.uid)
    }
}

private struct OverviewContent: View {
    let space: Space
    @Environment(AppModel.self) private var model
    @Environment(Navigator.self) private var nav
    @State private var period: BudgetPeriod
    @Query private var entries: [Entry]
    @Query private var categories: [EntryCategory]
    @Query private var budgets: [Budget]
    @Query private var rules: [RecurringRule]
    @Query(filter: #Predicate<PaymentMethod> { !$0.isRemoved }) private var paymentMethods: [PaymentMethod]
    @State private var editing: Entry?

    init(space: Space) {
        self.space = space
        let uid = space.uid
        _period = State(initialValue: BudgetPeriod(containing: .now, startDay: space.monthStartDay))
        _entries = Query(filter: #Predicate<Entry> { $0.spaceUid == uid && !$0.isRemoved }, sort: [SortDescriptor(\.occurredOn, order: .reverse), SortDescriptor(\.editedAt, order: .reverse)])
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid })
        _budgets = Query(filter: #Predicate<Budget> { $0.spaceUid == uid && !$0.isRemoved })
        _rules = Query(filter: #Predicate<RecurringRule> { $0.spaceUid == uid && !$0.isRemoved && $0.pausedAt == nil }, sort: \RecurringRule.nextDueOn)
    }

    private var summary: PeriodSummary { PeriodSummary(entries: entries, period: period) }
    private var lookups: Lookups { Lookups(categories: categories, paymentMethods: paymentMethods) }
    private var overallBudget: Budget? { budgets.first { $0.categoryUid == nil } }

    var body: some View {
        let summary = summary
        let lookups = lookups
        NavigationStack {
            List {
                Section {
                    PeriodStepper(period: $period)
                    totals(summary)
                }
                if summary.expenseMinor > 0 {
                    Section("Daily Spending") {
                        DailyChart(summary: summary, period: period, currency: space.currency)
                            .frame(height: 160)
                            .padding(.vertical, 4)
                    }
                    Section("Top Categories") {
                        ForEach(summary.byCategory.prefix(5)) { total in
                            CategoryShareRow(
                                category: lookups.category(total.categoryUid),
                                amountMinor: total.amountMinor,
                                share: Double(total.amountMinor) / Double(max(summary.expenseMinor, 1)),
                                currency: space.currency
                            )
                        }
                    }
                }
                upcoming
                recent(lookups)
            }
            .spaceSwitcher(space)
            .toolbar { AddEntryButton() }
            .sheet(item: $editing) { entry in
                EntryEditor(space: space, entry: entry)
            }
            .refreshable { await model.sync?.syncNow() }
        }
    }

    @ViewBuilder
    private func totals(_ summary: PeriodSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Spent").font(.subheadline).foregroundStyle(.secondary)
            Text(Money.format(minor: summary.expenseMinor, currency: space.currency))
                .font(.largeTitle.weight(.bold))
                .monospacedDigit()
                .contentTransition(.numericText())
            if let overallBudget {
                let status = summary.status(for: overallBudget)
                BudgetGauge(status: status, currency: space.currency)
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        LabeledContent("Income") {
            Text(Money.format(minor: summary.incomeMinor, currency: space.currency)).monospacedDigit()
        }
        if summary.transferInMinor > 0 || summary.transferOutMinor > 0 {
            LabeledContent("Transfers") {
                Text(Money.format(minor: summary.transferInMinor - summary.transferOutMinor, currency: space.currency, showsSign: true))
                    .monospacedDigit()
            }
        }
        LabeledContent("Net") {
            Text(Money.format(minor: summary.netMinor, currency: space.currency, showsSign: true))
                .monospacedDigit()
                .foregroundStyle(summary.netMinor >= 0 ? Color.green : Color.red)
        }
    }

    @ViewBuilder
    private var upcoming: some View {
        let soon = rules.filter(\.isActive).prefix(3)
        if !soon.isEmpty {
            Section("Upcoming") {
                ForEach(soon) { rule in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rule.title)
                            Text(CalendarDay.date(from: rule.nextDueOn)?.dayTitle ?? rule.nextDueOn)
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(Money.format(minor: rule.amountMinor, currency: rule.currency))
                            .monospacedDigit()
                            .foregroundStyle(rule.kind == .income ? Color.green : Color.primary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    @ViewBuilder
    private func recent(_ lookups: Lookups) -> some View {
        Section {
            if entries.isEmpty {
                ContentUnavailableView {
                    Label("No Entries Yet", systemImage: "tray")
                } description: {
                    Text("Add what you spend or earn and it shows up here.")
                } actions: {
                    Button("Add Entry") { nav.addingEntry = true }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                ForEach(entries.prefix(5)) { entry in
                    Button { editing = entry } label: {
                        EntryRow(entry: entry, category: lookups.category(entry.categoryUid), paymentMethod: lookups.paymentMethod(entry.paymentMethodUid))
                    }
                    .tint(.primary)
                }
            }
        } header: {
            HStack {
                Text("Recent")
                Spacer()
                if entries.count > 5 {
                    Button("See All") { nav.tab = .activity }
                        .font(.subheadline)
                        .textCase(nil)
                }
            }
        }
    }
}

struct PeriodStepper: View {
    @Binding var period: BudgetPeriod

    var body: some View {
        HStack {
            Button("Previous", systemImage: "chevron.left") { period = period.previous() }
                .labelStyle(.iconOnly)
            Spacer()
            Text(period.title).font(.headline)
            Spacer()
            Button("Next", systemImage: "chevron.right") { period = period.next() }
                .labelStyle(.iconOnly)
                .disabled(period.isCurrent)
        }
        .buttonStyle(.borderless)
        .sensoryFeedback(.selection, trigger: period)
    }
}

struct BudgetGauge: View {
    let status: PeriodSummary.BudgetStatus
    let currency: String

    var tint: Color {
        switch status.level {
        case .within: .green
        case .approaching: .orange
        case .over: .red
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Gauge(value: min(status.fraction, 1)) { EmptyView() }
                .gaugeStyle(.accessoryLinearCapacity)
                .tint(tint)
            Text(status.remainingMinor >= 0
                 ? "\(Money.format(minor: status.remainingMinor, currency: currency)) left of \(Money.format(minor: status.limitMinor, currency: currency))"
                 : "\(Money.format(minor: -status.remainingMinor, currency: currency)) over \(Money.format(minor: status.limitMinor, currency: currency))")
                .font(.subheadline)
                .foregroundStyle(status.level == .over ? Color.red : Color.secondary)
        }
    }
}

private struct CategoryShareRow: View {
    let category: EntryCategory?
    let amountMinor: Int64
    let share: Double
    let currency: String

    var body: some View {
        HStack(spacing: 12) {
            SymbolBadge(symbol: category?.symbol ?? "tag")
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(category?.name ?? String(localized: "Uncategorized"))
                    Spacer()
                    Text(Money.format(minor: amountMinor, currency: currency)).monospacedDigit()
                }
                ProgressView(value: share)
                    .tint(.accentColor)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(share, format: .percent.precision(.fractionLength(0))))
    }
}

private struct DailyChart: View {
    let summary: PeriodSummary
    let period: BudgetPeriod
    let currency: String

    var body: some View {
        Chart(period.days(), id: \.self) { day in
            let amount = summary.dailyExpense[CalendarDay.string(from: day)] ?? 0
            BarMark(
                x: .value("Day", day, unit: .day),
                y: .value("Spent", Money.decimal(minor: amount, currency: currency))
            )
            .foregroundStyle(Color.accentColor.gradient)
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                AxisValueLabel(format: .dateTime.day())
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing) { value in
                AxisGridLine()
                if let amount = value.as(Decimal.self) {
                    AxisValueLabel(Money.compact(minor: Money.minor(from: amount, currency: currency) ?? 0, currency: currency))
                }
            }
        }
        .accessibilityLabel("Daily spending chart")
    }
}
