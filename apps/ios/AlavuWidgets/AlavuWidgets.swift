import AlavuKit
import AppIntents
import SwiftData
import SwiftUI
import WidgetKit

@main
struct AlavuWidgetBundle: WidgetBundle {
    var body: some Widget {
        MonthWidget()
        AddEntryControl()
    }
}

// MARK: - Space selection

struct WidgetSpace: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Space"
    static let defaultQuery = WidgetSpaceQuery()

    let id: String
    let name: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: symbol))
    }
}

struct WidgetSpaceQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [WidgetSpace] {
        try allSpaces().filter { identifiers.contains($0.id) }
    }

    @MainActor
    func suggestedEntities() async throws -> [WidgetSpace] {
        try allSpaces()
    }

    @MainActor
    private func allSpaces() throws -> [WidgetSpace] {
        let context = ModelContext(try Store.makeContainer())
        let spaces = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved && $0.archivedAt == nil }, sortBy: [SortDescriptor(\.sortOrder)]))
        return spaces.map { WidgetSpace(id: $0.uid, name: $0.name, symbol: $0.symbol) }
    }
}

struct SelectSpaceIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Choose Space"
    static let description = IntentDescription("Pick which space the widget shows. Leave empty to follow the app.")

    @Parameter(title: "Space")
    var space: WidgetSpace?
}

// MARK: - Timeline

struct MonthEntry: TimelineEntry {
    let date: Date
    let spaceName: String
    let currency: String
    let periodTitle: String
    let spentMinor: Int64
    let incomeMinor: Int64
    let budget: PeriodSummary.BudgetStatus?
    let isSignedOut: Bool

    static let placeholder = MonthEntry(date: .now, spaceName: "Personal", currency: Locale.current.currency?.identifier ?? "USD", periodTitle: Date.now.formatted(.dateTime.month(.wide)), spentMinor: 32_450_00, incomeMinor: 80_000_00, budget: .init(limitMinor: 50_000_00, spentMinor: 32_450_00), isSignedOut: false)
}

struct MonthProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> MonthEntry { .placeholder }

    func snapshot(for configuration: SelectSpaceIntent, in context: Context) async -> MonthEntry {
        context.isPreview ? .placeholder : await entry(for: configuration)
    }

    func timeline(for configuration: SelectSpaceIntent, in context: Context) async -> Timeline<MonthEntry> {
        let entry = await entry(for: configuration)
        // Refresh after midnight so a new budget month shows up; the app also reloads
        // widgets after every sync.
        let tomorrow = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        return Timeline(entries: [entry], policy: .after(tomorrow))
    }

    @MainActor
    private func entry(for configuration: SelectSpaceIntent) -> MonthEntry {
        guard let container = try? Store.makeContainer() else { return .placeholder }
        let context = ModelContext(container)
        let spaces = (try? context.fetch(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved }))) ?? []
        let wanted = configuration.space?.id ?? Store.defaults.string(forKey: SharedKey.selectedSpaceUid)
        guard let space = spaces.first(where: { $0.uid == wanted }) ?? spaces.first(where: \.isDefault) ?? spaces.first else {
            return MonthEntry(date: .now, spaceName: "Alavu", currency: "USD", periodTitle: "", spentMinor: 0, incomeMinor: 0, budget: nil, isSignedOut: true)
        }
        let uid = space.uid
        let period = BudgetPeriod(containing: .now, startDay: space.monthStartDay)
        let start = period.startString
        let end = period.endString
        let entries = (try? context.fetch(FetchDescriptor<AlavuKit.Entry>(predicate: #Predicate {
            $0.spaceUid == uid && !$0.isRemoved && $0.occurredOn >= start && $0.occurredOn < end
        }))) ?? []
        let summary = PeriodSummary(entries: entries, period: period)
        let budget = (try? context.fetch(FetchDescriptor<Budget>(predicate: #Predicate { $0.spaceUid == uid && $0.categoryUid == nil && !$0.isRemoved })))?.first
        return MonthEntry(
            date: .now, spaceName: space.name, currency: space.currency, periodTitle: period.title,
            spentMinor: summary.expenseMinor, incomeMinor: summary.incomeMinor,
            budget: budget.map { summary.status(for: $0) }, isSignedOut: false
        )
    }
}

// MARK: - Widget

struct MonthWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "MonthWidget", intent: SelectSpaceIntent.self, provider: MonthProvider()) { entry in
            MonthWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "alavu://overview"))
        }
        .configurationDisplayName("This Month")
        .description("See what you've spent this month and how much budget is left.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct MonthWidgetView: View {
    let entry: MonthEntry
    @Environment(\.widgetFamily) private var family

    private var spent: String { Money.format(minor: entry.spentMinor, currency: entry.currency) }
    private var compactSpent: String { Money.compact(minor: entry.spentMinor, currency: entry.currency) }

    var body: some View {
        if entry.isSignedOut {
            Text("Open Alavu to get started").font(.footnote).foregroundStyle(.secondary)
        } else {
            switch family {
            case .accessoryInline:
                Text("\(compactSpent) spent")
            case .accessoryCircular:
                if let budget = entry.budget {
                    Gauge(value: min(budget.fraction, 1)) { Text("Spent") } currentValueLabel: { Text(compactSpent) }
                        .gaugeStyle(.accessoryCircularCapacity)
                } else {
                    VStack { Image(systemName: "chart.bar"); Text(compactSpent).font(.caption) }
                }
            case .accessoryRectangular:
                VStack(alignment: .leading) {
                    Text(entry.spaceName).font(.headline).widgetAccentable()
                    Text("\(spent) spent").minimumScaleFactor(0.7)
                    if let budget = entry.budget {
                        Gauge(value: min(budget.fraction, 1)) { EmptyView() }.gaugeStyle(.accessoryLinearCapacity)
                    }
                }
            case .systemMedium:
                HStack(alignment: .top) {
                    summary
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("Income").font(.caption).foregroundStyle(.secondary)
                        Text(Money.format(minor: entry.incomeMinor, currency: entry.currency))
                            .font(.headline).monospacedDigit().foregroundStyle(.green)
                            .minimumScaleFactor(0.6)
                    }
                }
            default:
                summary
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(entry.spaceName, systemImage: "chart.bar.xaxis")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tint)
            Text(entry.periodTitle).font(.caption2).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text("Spent").font(.caption).foregroundStyle(.secondary)
            Text(spent)
                .font(.title2.weight(.bold))
                .monospacedDigit()
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            if let budget = entry.budget {
                Gauge(value: min(budget.fraction, 1)) { EmptyView() }
                    .gaugeStyle(.accessoryLinearCapacity)
                    .tint(budget.level == .over ? .red : budget.level == .approaching ? .orange : .green)
                Text(budget.remainingMinor >= 0
                     ? "\(Money.compact(minor: budget.remainingMinor, currency: entry.currency)) left"
                     : "\(Money.compact(minor: -budget.remainingMinor, currency: entry.currency)) over")
                    .font(.caption2)
                    .foregroundStyle(budget.level == .over ? Color.red : Color.secondary)
            }
        }
    }
}

// MARK: - Control Center

struct AddEntryControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "AddEntryControl") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "alavu://add")!)) {
                Label("Add Entry", systemImage: "plus.circle")
            }
        }
        .displayName("Add Entry")
        .description("Open Alavu to add an expense or income.")
    }
}
