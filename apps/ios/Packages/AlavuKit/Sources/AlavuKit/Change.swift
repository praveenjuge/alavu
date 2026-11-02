import Foundation

/// A field value in a pushed change. Optional fields that are unset are simply left
/// out of `data`, because the server treats a missing field as "no value".
public enum FieldValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case int64(Int64)
    case bool(Bool)
    case strings([String])
}

/// One record change in the sync protocol (see `convex/sync.ts`).
public struct Change: Codable, Equatable, Sendable {
    public enum Table: String, Codable, Sendable {
        case spaces, paymentMethods, categories, transactions, budgets, recurringRules
    }

    public var table: Table
    public var uid: String
    public var editedAt: Double
    public var deleted: Bool
    public var data: [String: FieldValue]?

    public static func upsert(_ table: Table, uid: String, editedAt: Double, data: [String: FieldValue]) -> Change {
        Change(table: table, uid: uid, editedAt: editedAt, deleted: false, data: data)
    }

    public static func delete(_ table: Table, uid: String, editedAt: Double) -> Change {
        Change(table: table, uid: uid, editedAt: editedAt, deleted: true, data: nil)
    }
}

// MARK: - Record payloads

extension Space {
    var changeData: [String: FieldValue] {
        var data: [String: FieldValue] = [
            "name": .string(name), "symbol": .string(symbol), "tint": .string(tint),
            "currency": .string(currency), "monthStartDay": .number(Double(monthStartDay)),
            "sortOrder": .number(sortOrder),
        ]
        if let archivedAt { data["archivedAt"] = .number(archivedAt) }
        return data
    }
}

extension PaymentMethod {
    var changeData: [String: FieldValue] {
        ["name": .string(name), "symbol": .string(symbol), "sortOrder": .number(sortOrder)]
    }
}

extension EntryCategory {
    var changeData: [String: FieldValue] {
        var data: [String: FieldValue] = [
            "spaceUid": .string(spaceUid), "name": .string(name), "symbol": .string(symbol),
            "kind": .string(kindRaw), "sortOrder": .number(sortOrder),
        ]
        if let archivedAt { data["archivedAt"] = .number(archivedAt) }
        return data
    }
}

extension Entry {
    var changeData: [String: FieldValue] {
        var data: [String: FieldValue] = [
            "spaceUid": .string(spaceUid), "kind": .string(kindRaw),
            "amountMinor": .int64(amountMinor), "currency": .string(currency),
            "title": .string(title), "occurredOn": .string(occurredOn),
            "receiptKeys": .strings(receiptKeys),
        ]
        if let note, !note.isEmpty { data["note"] = .string(note) }
        if let categoryUid { data["categoryUid"] = .string(categoryUid) }
        if let paymentMethodUid { data["paymentMethodUid"] = .string(paymentMethodUid) }
        if let transferUid { data["transferUid"] = .string(transferUid) }
        if let recurringRuleUid { data["recurringRuleUid"] = .string(recurringRuleUid) }
        return data
    }
}

extension Budget {
    var changeData: [String: FieldValue] {
        var data: [String: FieldValue] = [
            "spaceUid": .string(spaceUid), "amountMinor": .int64(amountMinor),
        ]
        if let categoryUid { data["categoryUid"] = .string(categoryUid) }
        return data
    }
}

extension RecurringRule {
    var changeData: [String: FieldValue] {
        var data: [String: FieldValue] = [
            "spaceUid": .string(spaceUid), "kind": .string(kindRaw),
            "amountMinor": .int64(amountMinor), "currency": .string(currency),
            "title": .string(title), "cadence": .string(cadenceRaw),
            "interval": .number(Double(interval)), "startOn": .string(startOn),
        ]
        if let note, !note.isEmpty { data["note"] = .string(note) }
        if let categoryUid { data["categoryUid"] = .string(categoryUid) }
        if let paymentMethodUid { data["paymentMethodUid"] = .string(paymentMethodUid) }
        if let endOn { data["endOn"] = .string(endOn) }
        if let pausedAt { data["pausedAt"] = .number(pausedAt) }
        return data
    }
}
