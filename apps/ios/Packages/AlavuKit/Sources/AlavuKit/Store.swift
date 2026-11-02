import Foundation
import SwiftData

/// The on-device database, shared with the widget extension through the App Group.
public enum Store {
    public static let appGroup = "group.com.praveenjuge.alavu"

    public static let schema = Schema([
        Space.self, PaymentMethod.self, EntryCategory.self, Entry.self, Budget.self,
        RecurringRule.self, OutboxItem.self,
    ])

    public static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? URL.applicationSupportDirectory
    }

    public static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        let configuration = inMemory
            ? ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            : ModelConfiguration(
                schema: schema,
                url: containerURL.appending(path: "Alavu.store"),
                cloudKitDatabase: .none
            )
        return try ModelContainer(for: schema, configurations: configuration)
    }

    /// Settings shared with the widget extension.
    public static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

    /// Folder for receipt photos kept on this device.
    public static var receiptsFolder: URL {
        let url = containerURL.appending(path: "Receipts", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Local file for an uploaded receipt key, used as a cache.
    public static func cachedReceiptURL(forKey key: String) -> URL {
        receiptsFolder.appending(path: key.replacingOccurrences(of: "/", with: "_"))
    }
}

/// Keys for `Store.defaults`.
public enum SharedKey {
    public static let selectedSpaceUid = "selectedSpaceUid"
    public static let userSeq = "userSeq"
}
