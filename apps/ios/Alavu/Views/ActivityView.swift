import AlavuKit
import SwiftData
import SwiftUI

struct ActivityView: View {
    let space: Space

    var body: some View {
        ActivityContent(space: space).id(space.uid)
    }
}

private struct ActivityContent: View {
    enum KindFilter: Hashable { case all, expenses, income, transfers }

    let space: Space
    @Environment(AppModel.self) private var model
    @Environment(\.modelContext) private var context
    @Query private var entries: [Entry]
    @Query private var categories: [EntryCategory]
    @Query(filter: #Predicate<PaymentMethod> { !$0.isRemoved }) private var paymentMethods: [PaymentMethod]
    @State private var search = ""
    @State private var kind: KindFilter = .all
    @State private var categoryUid: String?
    @State private var editing: Entry?
    @State private var deleteError: String?

    init(space: Space) {
        self.space = space
        let uid = space.uid
        _entries = Query(filter: #Predicate<Entry> { $0.spaceUid == uid && !$0.isRemoved }, sort: [SortDescriptor(\.occurredOn, order: .reverse), SortDescriptor(\.editedAt, order: .reverse)])
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid }, sort: \EntryCategory.sortOrder)
    }

    private var filtered: [Entry] {
        let term = search.trimmingCharacters(in: .whitespaces)
        return entries.filter { entry in
            switch kind {
            case .all: break
            case .expenses: guard entry.kind == .expense else { return false }
            case .income: guard entry.kind == .income else { return false }
            case .transfers: guard entry.kind.isTransfer else { return false }
            }
            if let categoryUid, entry.categoryUid != categoryUid { return false }
            if !term.isEmpty {
                return entry.title.localizedStandardContains(term) || (entry.note?.localizedStandardContains(term) ?? false)
            }
            return true
        }
    }

    private var days: [(day: String, entries: [Entry])] {
        var groups: [(String, [Entry])] = []
        for entry in filtered {
            if groups.last?.0 == entry.occurredOn {
                groups[groups.count - 1].1.append(entry)
            } else {
                groups.append((entry.occurredOn, [entry]))
            }
        }
        return groups.map { (day: $0.0, entries: $0.1) }
    }

    var body: some View {
        let lookups = Lookups(categories: categories, paymentMethods: paymentMethods)
        NavigationStack {
            List {
                ForEach(days, id: \.day) { group in
                    Section {
                        ForEach(group.entries) { entry in
                            Button { editing = entry } label: {
                                EntryRow(entry: entry, category: lookups.category(entry.categoryUid), paymentMethod: lookups.paymentMethod(entry.paymentMethodUid))
                            }
                            .tint(.primary)
                            .swipeActions {
                                Button("Delete", systemImage: "trash", role: .destructive) { delete(entry) }
                            }
                        }
                    } header: {
                        DayHeader(day: group.day, entries: group.entries, currency: space.currency)
                    }
                }
            }
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView("No Entries Yet", systemImage: "tray", description: Text("Tap + to add what you spend or earn."))
                } else if filtered.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, prompt: "Search entries")
            .spaceSwitcher(space)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { filterMenu(lookups) }
                AddEntryButton()
            }
            .refreshable { await model.sync?.syncNow() }
            .sheet(item: $editing) { entry in
                EntryEditor(space: space, entry: entry)
            }
            .alert("Couldn't Delete", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(deleteError ?? "") }
        }
    }

    private func filterMenu(_ lookups: Lookups) -> some View {
        Menu {
            Picker("Type", selection: $kind) {
                Text("All").tag(KindFilter.all)
                Text("Expenses").tag(KindFilter.expenses)
                Text("Income").tag(KindFilter.income)
                Text("Transfers").tag(KindFilter.transfers)
            }
            Picker("Category", selection: $categoryUid) {
                Text("Any Category").tag(String?.none)
                ForEach(categories.filter { !$0.isRemoved }) { category in
                    Label(category.name, systemImage: category.symbol).tag(Optional(category.uid))
                }
            }
            .pickerStyle(.menu)
        } label: {
            Label("Filter", systemImage: kind == .all && categoryUid == nil
                  ? "line.3.horizontal.decrease.circle"
                  : "line.3.horizontal.decrease.circle.fill")
        }
    }

    private func delete(_ entry: Entry) {
        do {
            try Writer(context).delete(entry)
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

private struct DayHeader: View {
    let day: String
    let entries: [Entry]
    let currency: String

    var body: some View {
        let spent = entries.filter { $0.kind == .expense && $0.currency == currency }.reduce(0) { $0 + $1.amountMinor }
        HStack {
            Text(CalendarDay.date(from: day)?.dayTitle ?? day)
            Spacer()
            if spent > 0 {
                Text(Money.format(minor: spent, currency: currency)).monospacedDigit()
            }
        }
    }
}
