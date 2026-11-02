import AlavuKit
import ConvexMobile
import Foundation

// Shapes returned by `convex/sync.ts`. Unknown fields such as `_id` are ignored.
// Money comes back as a 64-bit integer, which needs `@ConvexInt`.

nonisolated struct Head: Decodable, Equatable {
    struct SpaceSeq: Decodable, Equatable {
        let uid: String
        let seq: Double
    }

    let userSeq: Double
    let spaces: [SpaceSeq]
}

nonisolated struct PullResponse: Decodable {
    let userSeq: Double
    let spaces: [SpaceDTO]?
    let paymentMethods: [PaymentMethodDTO]?
    let records: [SpaceRecords]
}

nonisolated struct SpaceRecords: Decodable {
    let spaceUid: String
    let cursor: Double
    let hasMore: Bool
    let categories: [CategoryDTO]
    let transactions: [TransactionDTO]
    let budgets: [BudgetDTO]
    let recurringRules: [RecurringRuleDTO]
}

nonisolated struct SpaceDTO: Decodable {
    let uid: String
    let name: String
    let symbol: String
    let tint: String
    let currency: String
    let monthStartDay: Double
    let isDefault: Bool
    let sortOrder: Double
    let archivedAt: Double?
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct PaymentMethodDTO: Decodable {
    let uid: String
    let name: String
    let symbol: String
    let sortOrder: Double
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct CategoryDTO: Decodable {
    let uid: String
    let spaceUid: String
    let name: String
    let symbol: String
    let kind: String
    let sortOrder: Double
    let archivedAt: Double?
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct TransactionDTO: Decodable {
    let uid: String
    let spaceUid: String
    let kind: String
    @ConvexInt var amountMinor: Int64
    let currency: String
    let title: String
    let note: String?
    let categoryUid: String?
    let paymentMethodUid: String?
    let occurredOn: String
    let transferUid: String?
    let recurringRuleUid: String?
    let receiptKeys: [String]
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct BudgetDTO: Decodable {
    let uid: String
    let spaceUid: String
    let categoryUid: String?
    @ConvexInt var amountMinor: Int64
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct RecurringRuleDTO: Decodable {
    let uid: String
    let spaceUid: String
    let kind: String
    @ConvexInt var amountMinor: Int64
    let currency: String
    let title: String
    let note: String?
    let categoryUid: String?
    let paymentMethodUid: String?
    let cadence: String
    let interval: Double
    let startOn: String
    let endOn: String?
    let nextDueOn: String
    let pausedAt: Double?
    let editedAt: Double
    let deletedAt: Double?
}

nonisolated struct UploadTarget: Decodable {
    let key: String
    let url: String
}

// MARK: - Encoding pushes

nonisolated extension FieldValue {
    var convex: ConvexEncodable {
        switch self {
        case .string(let v): v
        case .number(let v): v
        case .int64(let v): v
        case .bool(let v): v
        case .strings(let v): v.map { $0 as ConvexEncodable? }
        }
    }
}

nonisolated extension Change {
    var convex: [String: ConvexEncodable?] {
        var value: [String: ConvexEncodable?] = [
            "table": table.rawValue, "uid": uid, "editedAt": editedAt, "deleted": deleted,
        ]
        if let data {
            value["data"] = data.mapValues { $0.convex } as [String: ConvexEncodable?]
        }
        return value
    }
}

// The Convex client is safe to share: calls go to its Rust core, which serializes them.
extension ConvexClient: @retroactive @unchecked Sendable {}
