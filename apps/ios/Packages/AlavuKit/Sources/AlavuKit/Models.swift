import Foundation
import SwiftData

// Local mirror of the synced records. Every record is identified by a client-made
// `uid`, which is also how records reference each other. `editedAt` (ms since 1970)
// decides last-write-wins against the server; `isRemoved` hides a record until the
// server confirms the delete, so a stale pull can't bring it back.

public enum TransactionKind: String, Codable, CaseIterable, Sendable {
    case expense, income, transferOut, transferIn

    public var isTransfer: Bool { self == .transferOut || self == .transferIn }
    /// +1 for money coming in, -1 for money going out.
    public var sign: Int64 { (self == .income || self == .transferIn) ? 1 : -1 }
}

public enum CategoryKind: String, Codable, CaseIterable, Sendable {
    case expense, income
}

public enum Cadence: String, Codable, CaseIterable, Sendable {
    case weekly, monthly, yearly
}

@Model
public final class Space {
    @Attribute(.unique) public var uid: String
    public var name: String
    public var symbol: String
    public var tint: String
    public var currency: String
    public var monthStartDay: Int
    public var isDefault: Bool
    public var sortOrder: Double
    public var archivedAt: Double?
    public var editedAt: Double
    public var isRemoved: Bool = false
    /// True once the server has listed this space; only then may a missing entry delete it.
    public var isConfirmed: Bool = false
    /// Highest change counter pulled for records inside this space.
    public var cursor: Double = 0

    public init(
        uid: String = UUID().uuidString, name: String, symbol: String, tint: String,
        currency: String, monthStartDay: Int, isDefault: Bool = false, sortOrder: Double,
        archivedAt: Double? = nil, editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.name = name
        self.symbol = symbol
        self.tint = tint
        self.currency = currency
        self.monthStartDay = monthStartDay
        self.isDefault = isDefault
        self.sortOrder = sortOrder
        self.archivedAt = archivedAt
        self.editedAt = editedAt
    }

    public var isArchived: Bool { archivedAt != nil }
}

@Model
public final class PaymentMethod {
    @Attribute(.unique) public var uid: String
    public var name: String
    public var symbol: String
    public var sortOrder: Double
    public var editedAt: Double
    public var isRemoved: Bool = false
    public var isConfirmed: Bool = false

    public init(
        uid: String = UUID().uuidString, name: String, symbol: String, sortOrder: Double,
        editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.name = name
        self.symbol = symbol
        self.sortOrder = sortOrder
        self.editedAt = editedAt
    }
}

@Model
public final class EntryCategory {
    @Attribute(.unique) public var uid: String
    public var spaceUid: String
    public var name: String
    public var symbol: String
    public var kindRaw: String
    public var sortOrder: Double
    public var archivedAt: Double?
    public var editedAt: Double
    public var isRemoved: Bool = false

    public init(
        uid: String = UUID().uuidString, spaceUid: String, name: String, symbol: String,
        kind: CategoryKind, sortOrder: Double, archivedAt: Double? = nil,
        editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.spaceUid = spaceUid
        self.name = name
        self.symbol = symbol
        self.kindRaw = kind.rawValue
        self.sortOrder = sortOrder
        self.archivedAt = archivedAt
        self.editedAt = editedAt
    }

    public var kind: CategoryKind {
        get { CategoryKind(rawValue: kindRaw) ?? .expense }
        set { kindRaw = newValue.rawValue }
    }
}

@Model
public final class Entry {
    @Attribute(.unique) public var uid: String
    public var spaceUid: String
    public var kindRaw: String
    public var amountMinor: Int64
    public var currency: String
    public var title: String
    public var note: String?
    public var categoryUid: String?
    public var paymentMethodUid: String?
    /// Calendar date as `yyyy-MM-dd`, shared by every client.
    public var occurredOn: String
    public var transferUid: String?
    public var recurringRuleUid: String?
    public var receiptKeys: [String]
    /// Receipt photos saved on this device that still need to be uploaded.
    public var pendingReceiptFiles: [String] = []
    public var editedAt: Double
    public var isRemoved: Bool = false

    public init(
        uid: String = UUID().uuidString, spaceUid: String, kind: TransactionKind,
        amountMinor: Int64, currency: String, title: String, note: String? = nil,
        categoryUid: String? = nil, paymentMethodUid: String? = nil, occurredOn: String,
        transferUid: String? = nil, recurringRuleUid: String? = nil,
        receiptKeys: [String] = [], editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.spaceUid = spaceUid
        self.kindRaw = kind.rawValue
        self.amountMinor = amountMinor
        self.currency = currency
        self.title = title
        self.note = note
        self.categoryUid = categoryUid
        self.paymentMethodUid = paymentMethodUid
        self.occurredOn = occurredOn
        self.transferUid = transferUid
        self.recurringRuleUid = recurringRuleUid
        self.receiptKeys = receiptKeys
        self.editedAt = editedAt
    }

    public var kind: TransactionKind {
        get { TransactionKind(rawValue: kindRaw) ?? .expense }
        set { kindRaw = newValue.rawValue }
    }

    public var date: Date { CalendarDay.date(from: occurredOn) ?? .distantPast }
    public var signedAmount: Int64 { kind.sign * amountMinor }
    public var receiptCount: Int { receiptKeys.count + pendingReceiptFiles.count }
}

@Model
public final class Budget {
    @Attribute(.unique) public var uid: String
    public var spaceUid: String
    /// `nil` is the overall monthly budget for the space.
    public var categoryUid: String?
    public var amountMinor: Int64
    public var editedAt: Double
    public var isRemoved: Bool = false

    public init(
        uid: String, spaceUid: String, categoryUid: String?, amountMinor: Int64,
        editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.spaceUid = spaceUid
        self.categoryUid = categoryUid
        self.amountMinor = amountMinor
        self.editedAt = editedAt
    }

    /// One budget per space and category, so every device writes to the same record.
    public static func uid(spaceUid: String, categoryUid: String?) -> String {
        "\(spaceUid):budget:\(categoryUid ?? "overall")"
    }
}

@Model
public final class RecurringRule {
    @Attribute(.unique) public var uid: String
    public var spaceUid: String
    public var kindRaw: String
    public var amountMinor: Int64
    public var currency: String
    public var title: String
    public var note: String?
    public var categoryUid: String?
    public var paymentMethodUid: String?
    public var cadenceRaw: String
    public var interval: Int
    public var startOn: String
    public var endOn: String?
    /// Set by the server as it logs occurrences.
    public var nextDueOn: String
    public var pausedAt: Double?
    public var editedAt: Double
    public var isRemoved: Bool = false

    public init(
        uid: String = UUID().uuidString, spaceUid: String, kind: CategoryKind,
        amountMinor: Int64, currency: String, title: String, note: String? = nil,
        categoryUid: String? = nil, paymentMethodUid: String? = nil, cadence: Cadence,
        interval: Int = 1, startOn: String, endOn: String? = nil, pausedAt: Double? = nil,
        editedAt: Double = Clock.now
    ) {
        self.uid = uid
        self.spaceUid = spaceUid
        self.kindRaw = kind.rawValue
        self.amountMinor = amountMinor
        self.currency = currency
        self.title = title
        self.note = note
        self.categoryUid = categoryUid
        self.paymentMethodUid = paymentMethodUid
        self.cadenceRaw = cadence.rawValue
        self.interval = interval
        self.startOn = startOn
        self.endOn = endOn
        self.nextDueOn = startOn
        self.pausedAt = pausedAt
        self.editedAt = editedAt
    }

    public var kind: CategoryKind {
        get { CategoryKind(rawValue: kindRaw) ?? .expense }
        set { kindRaw = newValue.rawValue }
    }

    public var cadence: Cadence {
        get { Cadence(rawValue: cadenceRaw) ?? .monthly }
        set { cadenceRaw = newValue.rawValue }
    }

    public var isActive: Bool { pausedAt == nil && nextDueOn != "9999-12-31" }
}

/// A local edit waiting to be pushed. One item holds every change from one user action,
/// so they reach the server together.
@Model
public final class OutboxItem {
    public var createdAt: Date
    public var payload: Data
    public var attempts: Int = 0

    public init(changes: [Change]) throws {
        self.createdAt = .now
        self.payload = try JSONEncoder().encode(changes)
    }

    public func changes() throws -> [Change] {
        try JSONDecoder().decode([Change].self, from: payload)
    }
}

public enum Clock {
    /// Milliseconds since 1970, the unit the server uses for `editedAt`.
    public static var now: Double { (Date.now.timeIntervalSince1970 * 1000).rounded() }
}
