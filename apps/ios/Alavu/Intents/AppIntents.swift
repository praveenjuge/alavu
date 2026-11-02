import AlavuKit
import AppIntents
import SwiftData

struct SpaceEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Space"
    static let defaultQuery = SpaceQuery()

    let id: String
    let name: String
    let symbol: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", image: .init(systemName: symbol))
    }
}

struct SpaceQuery: EntityQuery {
    @Dependency private var model: AppModel

    @MainActor
    func entities(for identifiers: [String]) async throws -> [SpaceEntity] {
        try spaces().filter { identifiers.contains($0.id) }
    }

    @MainActor
    func suggestedEntities() async throws -> [SpaceEntity] { try spaces() }

    @MainActor
    private func spaces() throws -> [SpaceEntity] {
        try model.container.mainContext
            .fetch(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved && $0.archivedAt == nil }, sortBy: [SortDescriptor(\.sortOrder)]))
            .map { SpaceEntity(id: $0.uid, name: $0.name, symbol: $0.symbol) }
    }
}

enum EntryKindOption: String, AppEnum {
    case expense, income

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Entry Type"
    static let caseDisplayRepresentations: [EntryKindOption: DisplayRepresentation] = [
        .expense: "Expense", .income: "Income",
    ]
}

/// Logs an entry without opening the app, from Siri, Shortcuts, Spotlight, or the
/// Action button. It's saved on the device and synced like any other edit.
struct LogEntryIntent: AppIntent {
    static let title: LocalizedStringResource = "Log an Entry"
    static let description = IntentDescription("Add an expense or income to Alavu.")

    @Parameter(title: "Amount", inclusiveRange: (0.01, 1_000_000_000))
    var amount: Double

    @Parameter(title: "Type", default: .expense)
    var kind: EntryKindOption

    @Parameter(title: "Title")
    var title: String?

    @Parameter(title: "Space", description: "Leave empty to use the space open in the app.")
    var space: SpaceEntity?

    @Dependency private var model: AppModel

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$amount) \(\.$kind)") {
            \.$title
            \.$space
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard model.auth.isSignedIn else {
            throw $amount.needsValueError("Open Alavu and sign in first.")
        }
        let context = model.container.mainContext
        let spaces = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved }))
        let wanted = space?.id ?? Store.defaults.string(forKey: SharedKey.selectedSpaceUid)
        guard let target = spaces.first(where: { $0.uid == wanted }) ?? spaces.first(where: \.isDefault) ?? spaces.first else {
            throw $space.needsValueError("Open Alavu to finish setting up first.")
        }
        guard let minor = Money.minor(from: Decimal(amount), currency: target.currency), minor > 0 else {
            throw $amount.needsValueError("Enter an amount above zero.")
        }
        let fallback = kind == .income ? String(localized: "Income") : String(localized: "Expense")
        let name = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let entry = Entry(
            spaceUid: target.uid, kind: kind == .income ? .income : .expense, amountMinor: minor,
            currency: target.currency, title: (name?.isEmpty ?? true) ? fallback : name!, occurredOn: CalendarDay.today
        )
        try Writer(context).save(entry)
        model.sync?.requestSync()
        Analytics.capture("entry_added", ["kind": entry.kind.rawValue, "via": "intent"])
        let formatted = Money.format(minor: minor, currency: target.currency)
        return .result(dialog: "Logged \(formatted) in \(target.name).")
    }
}

struct OpenNewEntryIntent: AppIntent {
    static let title: LocalizedStringResource = "New Entry"
    static let description = IntentDescription("Open Alavu to add an entry.")
    static let supportedModes: IntentModes = .foreground

    @Dependency private var model: AppModel

    @MainActor
    func perform() async throws -> some IntentResult {
        model.pendingAddEntry = true
        return .result()
    }
}

struct AlavuShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogEntryIntent(),
            phrases: [
                "Log an expense in \(.applicationName)",
                "Add an expense to \(.applicationName)",
                "Log spending in \(.applicationName)",
            ],
            shortTitle: "Log Expense",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: OpenNewEntryIntent(),
            phrases: ["New entry in \(.applicationName)", "Open \(.applicationName) to add an entry"],
            shortTitle: "New Entry",
            systemImageName: "square.and.pencil"
        )
    }
}
