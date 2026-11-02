import AlavuKit
import Combine
import ConvexMobile
import Foundation
import Observation
import OSLog
import SwiftData
import WidgetKit

private let log = Logger(subsystem: "com.praveenjuge.alavu", category: "sync")

/// Keeps the on-device store and Convex in step: pushes queued local edits, uploads
/// receipt photos, and pulls what changed whenever the server's counters move.
@MainActor
@Observable
final class SyncEngine {
    enum Status: Equatable {
        case idle, syncing, offline
        case failed(String)
    }

    private(set) var status: Status = .idle
    /// True when the account has no space yet and first-run setup is needed.
    private(set) var needsSetup = false
    /// True until the first successful pull after sign-in.
    private(set) var isLoadingAccount = true
    private(set) var pendingCount = 0

    private let client: ConvexClientWithAuth<String>
    private let tokens: TokenStore
    private let context: ModelContext
    private let onSessionExpired: () -> Void
    private var cancellables = Set<AnyCancellable>()
    private var latestHead: Head?
    private var isConnected = false
    private var isAuthenticated = false
    private var running = false
    private var rerun = false
    private var started = false
    private var isConnecting = false
    private var retryDelay: Duration = .seconds(5)
    private var retryTask: Task<Void, Never>?

    init(client: ConvexClientWithAuth<String>, tokens: TokenStore, context: ModelContext, onSessionExpired: @escaping () -> Void) {
        self.client = client
        self.tokens = tokens
        self.context = context
        self.onSessionExpired = onSessionExpired
    }

    // MARK: Lifecycle

    func start() {
        guard !started else { return }
        started = true
        refreshPendingCount()
        isLoadingAccount = (try? context.fetchCount(FetchDescriptor<Space>())) == 0

        client.watchWebSocketState()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.isConnected = state == .connected
                if self.isConnected { self.requestSync() } else if self.status == .idle { self.status = .offline }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .alavuLocalChange)
            .debounce(for: .milliseconds(400), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshPendingCount()
                WidgetCenter.shared.reloadAllTimelines()
                self?.requestSync()
            }
            .store(in: &cancellables)

        Task { await connect() }
    }

    func stop() {
        retryTask?.cancel()
        cancellables.removeAll()
        started = false
        isAuthenticated = false
        latestHead = nil
    }

    private func connect() async {
        guard !isConnecting, !isAuthenticated else { return }
        isConnecting = true
        defer { isConnecting = false }
        switch await client.loginFromCache() {
        case .success:
            isAuthenticated = true
        case .failure(let error):
            if case AuthError.sessionExpired? = error as? AuthError {
                onSessionExpired()
                return
            }
            status = .offline
            // Network may be down; reconnecting also happens when the socket comes back.
            scheduleRetry()
            return
        }
        do {
            let session = await tokens.currentSession
            let _: Ignored = try await client.mutation("users:ensure", with: [
                "timeZone": TimeZone.current.identifier,
                "name": session?.name,
                "email": session?.email,
            ])
        } catch {
            status = .failed(error.localizedDescription)
        }
        client.subscribe(to: "sync:head", yielding: Head.self)
            // The client re-delivers unchanged results whenever its set of queries
            // changes (each pull is one), so only react to real changes.
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { _ in },
                receiveValue: { [weak self] head in
                    self?.latestHead = head
                    self?.requestSync()
                }
            )
            .store(in: &cancellables)
        requestSync()
    }

    /// Runs a sync pass now, or right after the current one finishes.
    func requestSync() {
        guard started else { return }
        guard isAuthenticated else {
            Task { await connect() }
            return
        }
        if running { rerun = true; return }
        Task { await syncLoop() }
    }

    /// For background refresh: one full pass, awaited.
    func syncNow() async {
        if !isAuthenticated { await connect() }
        await syncLoop()
    }

    /// Syncs, but gives up waiting after `timeout`. For App Intents, which have little time.
    func syncBriefly(timeout: Duration) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.syncNow() }
            group.addTask { try? await Task.sleep(for: timeout) }
            await group.next()
            group.cancelAll()
        }
    }

    private func syncLoop() async {
        guard !running else { rerun = true; return }
        running = true
        defer { running = false }
        repeat {
            rerun = false
            status = .syncing
            do {
                log.debug("sync pass: uploading receipts")
                try await uploadReceipts()
                log.debug("sync pass: pushing outbox")
                try await pushOutbox()
                log.debug("sync pass: pulling")
                try await pull()
                log.debug("sync pass: done")
                status = isConnected ? .idle : .offline
                retryDelay = .seconds(5)
            } catch {
                log.error("sync pass failed: \(error.localizedDescription, privacy: .public)")
                status = isConnected ? .failed(error.localizedDescription) : .offline
                scheduleRetry()
                break
            }
        } while rerun
        refreshPendingCount()
    }

    /// Retries with backoff after a failed pass; reconnects and local edits also retry sooner.
    private func scheduleRetry() {
        retryTask?.cancel()
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, .seconds(300))
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.requestSync()
        }
    }

    private func refreshPendingCount() {
        pendingCount = (try? context.fetchCount(FetchDescriptor<OutboxItem>())) ?? 0
    }

    // MARK: First run

    func setUp(currency: String, monthStartDay: Int) async throws {
        let _: Ignored = try await client.mutation("users:setup", with: ["currency": currency, "monthStartDay": Double(monthStartDay)])
        await syncLoop()
    }

    // MARK: Push

    private func pushOutbox() async throws {
        let items = try context.fetch(FetchDescriptor<OutboxItem>(sortBy: [SortDescriptor(\.createdAt)]))
        for item in items {
            let changes = try item.changes()
            do {
                let _: Ignored = try await client.mutation("sync:push", with: ["changes": changes.map { $0.convex as ConvexEncodable? }])
                context.delete(item)
            } catch ClientError.ConvexError(let data) {
                // The server rejected this edit for good (it failed validation). Drop it so
                // it doesn't block everything queued behind it; the next pull restores
                // the server's version of the record.
                Analytics.capture("sync_change_rejected", ["reason": data])
                context.delete(item)
                rerun = true
            } catch {
                item.attempts += 1
                try? context.save()
                throw error
            }
            try context.save()
        }
    }

    // MARK: Pull

    private func pull() async throws {
        let defaults = Store.defaults
        var more = true
        var rounds = 0
        while more, rounds < 50 {
            rounds += 1
            let userSince = defaults.double(forKey: SharedKey.userSeq)
            let spaces = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved }))
            var cursors: [String: Double] = Dictionary(spaces.filter(\.isConfirmed).map { ($0.uid, $0.cursor) }) { a, _ in a }
            for s in latestHead?.spaces ?? [] where cursors[s.uid] == nil { cursors[s.uid] = 0 }

            let response: PullResponse = try await query("sync:pull", [
                "userSince": userSince,
                "spaces": cursors.map { ["uid": $0.key, "since": $0.value] as [String: ConvexEncodable?] as ConvexEncodable? },
            ])
            try apply(response)
            defaults.set(response.userSeq, forKey: SharedKey.userSeq)
            // Keep going while a space has more pages, or the space list just told us
            // about a space whose records we haven't asked for yet.
            let confirmed = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { $0.isConfirmed && !$0.isRemoved }))
            more = response.records.contains(where: \.hasMore) || confirmed.contains { cursors[$0.uid] == nil }
        }
        let spaceCount = try context.fetchCount(FetchDescriptor<Space>(predicate: #Predicate { !$0.isRemoved }))
        needsSetup = spaceCount == 0
        isLoadingAccount = false
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// One-shot read of a query through a short-lived subscription.
    private func query<T: Decodable>(_ name: String, _ args: [String: ConvexEncodable?]) async throws -> T {
        for try await value in client.subscribe(to: name, with: args, yielding: T.self).values {
            return value
        }
        throw CancellationError()
    }

    // MARK: Apply

    private func apply(_ response: PullResponse) throws {
        let writer = Writer(context)
        if let spaces = response.spaces {
            let listed = Set(spaces.map(\.uid))
            for dto in spaces {
                let uid = dto.uid
                let local = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { $0.uid == uid })).first
                if dto.deletedAt != nil {
                    if let local { try writer.removeRecords(inSpace: uid); context.delete(local) }
                    continue
                }
                let space = local ?? {
                    let s = Space(uid: uid, name: dto.name, symbol: dto.symbol, tint: dto.tint, currency: dto.currency, monthStartDay: Int(dto.monthStartDay), sortOrder: dto.sortOrder, editedAt: dto.editedAt)
                    context.insert(s)
                    return s
                }()
                space.isConfirmed = true
                space.isDefault = dto.isDefault
                guard local == nil || dto.editedAt >= space.editedAt else { continue }
                space.name = dto.name
                space.symbol = dto.symbol
                space.tint = dto.tint
                space.currency = dto.currency
                space.monthStartDay = Int(dto.monthStartDay)
                space.sortOrder = dto.sortOrder
                space.archivedAt = dto.archivedAt
                space.editedAt = dto.editedAt
            }
            // A confirmed space that's no longer listed was deleted or we lost access.
            for space in try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { $0.isConfirmed })) where !listed.contains(space.uid) {
                try writer.removeRecords(inSpace: space.uid)
                context.delete(space)
            }
        }

        if let methods = response.paymentMethods {
            let listed = Set(methods.map(\.uid))
            for dto in methods {
                let uid = dto.uid
                let local = try context.fetch(FetchDescriptor<PaymentMethod>(predicate: #Predicate { $0.uid == uid })).first
                if dto.deletedAt != nil { if let local { context.delete(local) }; continue }
                let method = local ?? { let m = PaymentMethod(uid: uid, name: dto.name, symbol: dto.symbol, sortOrder: dto.sortOrder, editedAt: dto.editedAt); context.insert(m); return m }()
                method.isConfirmed = true
                guard local == nil || dto.editedAt >= method.editedAt else { continue }
                method.name = dto.name
                method.symbol = dto.symbol
                method.sortOrder = dto.sortOrder
                method.editedAt = dto.editedAt
            }
            for method in try context.fetch(FetchDescriptor<PaymentMethod>(predicate: #Predicate { $0.isConfirmed })) where !listed.contains(method.uid) {
                context.delete(method)
            }
        }

        for records in response.records {
            let spaceUid = records.spaceUid
            guard let space = try context.fetch(FetchDescriptor<Space>(predicate: #Predicate { $0.uid == spaceUid })).first else { continue }
            for dto in records.categories { try applyCategory(dto) }
            for dto in records.transactions { try applyEntry(dto) }
            for dto in records.budgets { try applyBudget(dto) }
            for dto in records.recurringRules { try applyRule(dto) }
            space.cursor = records.cursor
        }
        try context.save()
    }

    /// Finds the local record, or deletes it for a server tombstone. Returns `nil` when
    /// there's nothing to update: deleted, or the local copy is newer.
    private func merge<T: PersistentModel>(_ type: T.Type, uid: String, editedAt: Double, deletedAt: Double?, predicate: Predicate<T>, localEditedAt: (T) -> Double, make: () -> T) throws -> T? {
        let local = try context.fetch(FetchDescriptor<T>(predicate: predicate)).first
        if deletedAt != nil {
            if let local { context.delete(local) }
            return nil
        }
        if let local {
            return editedAt >= localEditedAt(local) ? local : nil
        }
        let created = make()
        context.insert(created)
        return created
    }

    private func applyCategory(_ dto: CategoryDTO) throws {
        let uid = dto.uid
        guard let c = try merge(EntryCategory.self, uid: uid, editedAt: dto.editedAt, deletedAt: dto.deletedAt, predicate: #Predicate { $0.uid == uid }, localEditedAt: \.editedAt, make: {
            EntryCategory(uid: uid, spaceUid: dto.spaceUid, name: dto.name, symbol: dto.symbol, kind: CategoryKind(rawValue: dto.kind) ?? .expense, sortOrder: dto.sortOrder)
        }) else { return }
        c.name = dto.name
        c.symbol = dto.symbol
        c.kindRaw = dto.kind
        c.sortOrder = dto.sortOrder
        c.archivedAt = dto.archivedAt
        c.editedAt = dto.editedAt
        c.isRemoved = false
    }

    private func applyEntry(_ dto: TransactionDTO) throws {
        let uid = dto.uid
        guard let e = try merge(Entry.self, uid: uid, editedAt: dto.editedAt, deletedAt: dto.deletedAt, predicate: #Predicate { $0.uid == uid }, localEditedAt: \.editedAt, make: {
            Entry(uid: uid, spaceUid: dto.spaceUid, kind: TransactionKind(rawValue: dto.kind) ?? .expense, amountMinor: dto.amountMinor, currency: dto.currency, title: dto.title, occurredOn: dto.occurredOn)
        }) else { return }
        e.kindRaw = dto.kind
        e.amountMinor = dto.amountMinor
        e.currency = dto.currency
        e.title = dto.title
        e.note = dto.note
        e.categoryUid = dto.categoryUid
        e.paymentMethodUid = dto.paymentMethodUid
        e.occurredOn = dto.occurredOn
        e.transferUid = dto.transferUid
        e.recurringRuleUid = dto.recurringRuleUid
        e.receiptKeys = dto.receiptKeys
        e.editedAt = dto.editedAt
        e.isRemoved = false
    }

    private func applyBudget(_ dto: BudgetDTO) throws {
        let uid = dto.uid
        guard let b = try merge(Budget.self, uid: uid, editedAt: dto.editedAt, deletedAt: dto.deletedAt, predicate: #Predicate { $0.uid == uid }, localEditedAt: \.editedAt, make: {
            Budget(uid: uid, spaceUid: dto.spaceUid, categoryUid: dto.categoryUid, amountMinor: dto.amountMinor)
        }) else { return }
        b.amountMinor = dto.amountMinor
        b.editedAt = dto.editedAt
        b.isRemoved = false
    }

    private func applyRule(_ dto: RecurringRuleDTO) throws {
        let uid = dto.uid
        let local = try context.fetch(FetchDescriptor<RecurringRule>(predicate: #Predicate { $0.uid == uid })).first
        // The server advances `nextDueOn` without changing `editedAt`, so keep it current
        // even when the rest of the local copy is newer.
        if dto.deletedAt == nil { local?.nextDueOn = dto.nextDueOn }
        guard let r = try merge(RecurringRule.self, uid: uid, editedAt: dto.editedAt, deletedAt: dto.deletedAt, predicate: #Predicate { $0.uid == uid }, localEditedAt: \.editedAt, make: {
            RecurringRule(uid: uid, spaceUid: dto.spaceUid, kind: CategoryKind(rawValue: dto.kind) ?? .expense, amountMinor: dto.amountMinor, currency: dto.currency, title: dto.title, cadence: Cadence(rawValue: dto.cadence) ?? .monthly, startOn: dto.startOn)
        }) else { return }
        r.kindRaw = dto.kind
        r.amountMinor = dto.amountMinor
        r.currency = dto.currency
        r.title = dto.title
        r.note = dto.note
        r.categoryUid = dto.categoryUid
        r.paymentMethodUid = dto.paymentMethodUid
        r.cadenceRaw = dto.cadence
        r.interval = Int(dto.interval)
        r.startOn = dto.startOn
        r.endOn = dto.endOn
        r.nextDueOn = dto.nextDueOn
        r.pausedAt = dto.pausedAt
        r.editedAt = dto.editedAt
        r.isRemoved = false
    }

    // MARK: Receipts

    private func uploadReceipts() async throws {
        let entries = try context.fetch(FetchDescriptor<Entry>(predicate: #Predicate { !$0.isRemoved }))
            .filter { !$0.pendingReceiptFiles.isEmpty }
        for entry in entries {
            for file in entry.pendingReceiptFiles {
                let local = Store.receiptsFolder.appending(path: file)
                guard let data = try? Data(contentsOf: local) else {
                    entry.pendingReceiptFiles.removeAll { $0 == file }
                    continue
                }
                let target: UploadTarget = try await client.mutation("receipts:uploadUrl", with: ["spaceUid": entry.spaceUid])
                guard let url = URL(string: target.url) else { continue }
                var request = URLRequest(url: url)
                request.httpMethod = "PUT"
                request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
                let (_, response) = try await URLSession.shared.upload(for: request, from: data)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                try? FileManager.default.moveItem(at: local, to: Store.cachedReceiptURL(forKey: target.key))
                entry.pendingReceiptFiles.removeAll { $0 == file }
                entry.receiptKeys.append(target.key)
                try Writer(context).save(entry)
            }
        }
    }

    /// A short-lived link to a receipt photo, cached on this device after the first view.
    func receiptImageData(key: String) async throws -> Data {
        let cached = Store.cachedReceiptURL(forKey: key)
        if let data = try? Data(contentsOf: cached) { return data }
        let link: String = try await client.mutation("receipts:downloadUrl", with: ["key": key])
        guard let url = URL(string: link) else { throw URLError(.badURL) }
        let (data, _) = try await URLSession.shared.data(from: url)
        try? data.write(to: cached)
        return data
    }

    // MARK: Account

    func deleteAccount() async throws {
        let _: Ignored = try await client.action("account:deleteAccount")
    }

    /// Wipes everything stored on this device (on sign-out or account deletion).
    func resetLocalData() throws {
        stop()
        for type in [Space.self, PaymentMethod.self, EntryCategory.self, Entry.self, Budget.self, RecurringRule.self, OutboxItem.self] as [any PersistentModel.Type] {
            try context.delete(model: type)
        }
        try context.save()
        try? FileManager.default.removeItem(at: Store.receiptsFolder)
        Store.defaults.removeObject(forKey: SharedKey.userSeq)
        Store.defaults.removeObject(forKey: SharedKey.selectedSpaceUid)
        needsSetup = false
        isLoadingAccount = true
        pendingCount = 0
        WidgetCenter.shared.reloadAllTimelines()
    }
}
