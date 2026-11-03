import Foundation

/// The Convex client has no timeouts of its own: while its connection is stalled, a
/// mutation, action or query waits forever, so the app's calls go through `withTimeout`.
nonisolated struct ConvexTimeout: LocalizedError {
    var errorDescription: String? { String(localized: "The server didn't respond in time.") }
}

/// Runs `operation`, or throws ``ConvexTimeout`` once `limit` passes.
func withTimeout<T>(_ limit: Duration, _ operation: @escaping () async throws -> T) async throws -> T {
    let box = Box<T>()
    try await race(limit) { box.value = try await operation() }
    guard let value = box.value else { throw CancellationError() }
    return value
}

/// A task group would wait for the timed-out call to finish, and a stalled Convex call
/// may ignore cancellation, so the first outcome resumes a continuation instead.
private func race(_ limit: Duration, _ operation: @escaping () async throws -> Void) async throws {
    let race = Race()
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        race.continuation = continuation
        race.tasks = [
            Task {
                do {
                    try await operation()
                    race.finish(nil)
                } catch {
                    race.finish(error)
                }
            },
            Task {
                try? await Task.sleep(for: limit)
                race.finish(ConvexTimeout())
            },
        ]
    }
}

private final class Box<T> {
    var value: T?
}

private final class Race {
    var continuation: CheckedContinuation<Void, Error>?
    var tasks: [Task<Void, Never>] = []

    func finish(_ error: Error?) {
        guard let continuation else { return }
        self.continuation = nil
        tasks.forEach { $0.cancel() }
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }
}
