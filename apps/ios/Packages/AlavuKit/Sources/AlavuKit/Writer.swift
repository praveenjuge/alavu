import Foundation
import SwiftData

/// Every local edit goes through here: it updates the on-device record and queues the
/// matching change for the server in the same save, so the two never drift apart.
@MainActor
public struct Writer {
    public let context: ModelContext

    public init(_ context: ModelContext) {
        self.context = context
    }

    // MARK: Entries

    /// Saves an expense or income entry.
    public func save(_ entry: Entry) throws {
        entry.editedAt = Clock.now
        if entry.modelContext == nil { context.insert(entry) }
        try commit([.upsert(.transactions, uid: entry.uid, editedAt: entry.editedAt, data: entry.changeData)])
    }

    /// Creates both legs of a transfer between two spaces in one change set.
    public func saveTransfer(_ out: Entry, _ in: Entry) throws {
        let now = Clock.now
        for entry in [out, `in`] {
            entry.editedAt = now
            if entry.modelContext == nil { context.insert(entry) }
        }
        try commit([
            .upsert(.transactions, uid: out.uid, editedAt: now, data: out.changeData),
            .upsert(.transactions, uid: `in`.uid, editedAt: now, data: `in`.changeData),
        ])
    }

    /// Deletes an entry; deleting one leg of a transfer deletes both.
    public func delete(_ entry: Entry) throws {
        var entries = [entry]
        if let transferUid = entry.transferUid {
            let target: String? = transferUid
            let uid = entry.uid
            let pair = try context.fetch(FetchDescriptor<Entry>(
                predicate: #Predicate { $0.transferUid == target && $0.uid != uid }
            ))
            entries += pair
        }
        let now = Clock.now
        for e in entries {
            e.isRemoved = true
            e.editedAt = now
            removeLocalReceipts(e.pendingReceiptFiles)
        }
        try commit(entries.map { .delete(.transactions, uid: $0.uid, editedAt: now) })
    }

    // MARK: Spaces

    public func save(_ space: Space) throws {
        space.editedAt = Clock.now
        if space.modelContext == nil { context.insert(space) }
        try commit([.upsert(.spaces, uid: space.uid, editedAt: space.editedAt, data: space.changeData)])
    }

    /// Deletes a space and, on this device, everything in it.
    public func delete(_ space: Space) throws {
        precondition(!space.isDefault, "The default space can't be deleted")
        space.isRemoved = true
        space.editedAt = Clock.now
        try removeRecords(inSpace: space.uid)
        try commit([.delete(.spaces, uid: space.uid, editedAt: space.editedAt)])
    }

    // MARK: Categories and payment methods

    public func save(_ category: EntryCategory) throws {
        category.editedAt = Clock.now
        if category.modelContext == nil { context.insert(category) }
        try commit([.upsert(.categories, uid: category.uid, editedAt: category.editedAt, data: category.changeData)])
    }

    public func delete(_ category: EntryCategory) throws {
        category.isRemoved = true
        category.editedAt = Clock.now
        try commit([.delete(.categories, uid: category.uid, editedAt: category.editedAt)])
    }

    public func save(_ method: PaymentMethod) throws {
        method.editedAt = Clock.now
        if method.modelContext == nil { context.insert(method) }
        try commit([.upsert(.paymentMethods, uid: method.uid, editedAt: method.editedAt, data: method.changeData)])
    }

    public func delete(_ method: PaymentMethod) throws {
        method.isRemoved = true
        method.editedAt = Clock.now
        try commit([.delete(.paymentMethods, uid: method.uid, editedAt: method.editedAt)])
    }

    // MARK: Budgets

    /// Sets a monthly budget; `nil` or zero removes it.
    public func setBudget(spaceUid: String, categoryUid: String?, amountMinor: Int64?) throws {
        let uid = Budget.uid(spaceUid: spaceUid, categoryUid: categoryUid)
        let existing = try context.fetch(FetchDescriptor<Budget>(predicate: #Predicate { $0.uid == uid })).first
        let now = Clock.now
        if let amountMinor, amountMinor > 0 {
            let budget = existing ?? Budget(uid: uid, spaceUid: spaceUid, categoryUid: categoryUid, amountMinor: amountMinor)
            budget.amountMinor = amountMinor
            budget.isRemoved = false
            budget.editedAt = now
            if budget.modelContext == nil { context.insert(budget) }
            try commit([.upsert(.budgets, uid: uid, editedAt: now, data: budget.changeData)])
        } else if let existing, !existing.isRemoved {
            existing.isRemoved = true
            existing.editedAt = now
            try commit([.delete(.budgets, uid: uid, editedAt: now)])
        }
    }

    // MARK: Recurring rules

    public func save(_ rule: RecurringRule) throws {
        rule.editedAt = Clock.now
        if rule.modelContext == nil { context.insert(rule) }
        try commit([.upsert(.recurringRules, uid: rule.uid, editedAt: rule.editedAt, data: rule.changeData)])
    }

    public func delete(_ rule: RecurringRule) throws {
        rule.isRemoved = true
        rule.editedAt = Clock.now
        try commit([.delete(.recurringRules, uid: rule.uid, editedAt: rule.editedAt)])
    }

    // MARK: Helpers

    private func commit(_ changes: [Change]) throws {
        context.insert(try OutboxItem(changes: changes))
        try context.save()
        NotificationCenter.default.post(name: .alavuLocalChange, object: nil)
    }

    /// Removes everything stored on this device for a space (used when it's deleted).
    public func removeRecords(inSpace spaceUid: String) throws {
        try context.delete(model: EntryCategory.self, where: #Predicate { $0.spaceUid == spaceUid })
        let entries = try context.fetch(FetchDescriptor<Entry>(predicate: #Predicate { $0.spaceUid == spaceUid }))
        for entry in entries {
            removeLocalReceipts(entry.pendingReceiptFiles)
            context.delete(entry)
        }
        try context.delete(model: Budget.self, where: #Predicate { $0.spaceUid == spaceUid })
        try context.delete(model: RecurringRule.self, where: #Predicate { $0.spaceUid == spaceUid })
    }

    private func removeLocalReceipts(_ files: [String]) {
        for file in files {
            try? FileManager.default.removeItem(at: Store.receiptsFolder.appending(path: file))
        }
    }
}

public extension Notification.Name {
    /// Posted after a local edit is saved, so the sync engine can push it.
    static let alavuLocalChange = Notification.Name("alavuLocalChange")
}
