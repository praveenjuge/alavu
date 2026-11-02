import AlavuKit
import SwiftData
import SwiftUI

struct SettingsView: View {
    let space: Space
    @Environment(AppModel.self) private var model
    @Environment(AuthService.self) private var auth
    @AppStorage(Analytics.optOutKey) private var analyticsOptOut = false
    @State private var confirmingSignOut = false
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Spaces") {
                    NavigationLink {
                        SpacesList()
                    } label: {
                        Label("Spaces", systemImage: "square.stack")
                    }
                }
                Section {
                    NavigationLink { CategoriesList(space: space) } label: {
                        Label("Categories", systemImage: "tag")
                    }
                    NavigationLink { RecurringList(space: space) } label: {
                        Label("Repeating Entries", systemImage: "repeat")
                    }
                } header: {
                    Text(space.name)
                }
                Section {
                    NavigationLink { PaymentMethodsList() } label: {
                        Label("Payment Methods", systemImage: "creditcard")
                    }
                }
                Section {
                    syncRow
                    Toggle("Share Anonymous Usage Data", isOn: Binding(
                        get: { !analyticsOptOut },
                        set: { analyticsOptOut = !$0; Analytics.setOptedOut(!$0) }
                    ))
                } header: {
                    Text("Data")
                } footer: {
                    Text("Usage data and crash reports help fix problems. They never include amounts, names, or notes.")
                }
                Section("Account") {
                    if let email = auth.session?.email {
                        LabeledContent("Signed In As", value: email)
                    }
                    Button("Sign Out", role: .destructive) { confirmingSignOut = true }
                    Button(role: .destructive) { confirmingDelete = true } label: {
                        if deleting { ProgressView() } else { Text("Delete Account") }
                    }
                    .disabled(deleting)
                }
                Section {
                    Link("Privacy Policy", destination: AppConfig.privacyURL)
                    Link("Terms of Use", destination: AppConfig.termsURL)
                    Link("Help & Support", destination: AppConfig.supportURL)
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Sign out?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
            } message: {
                if (model.sync?.pendingCount ?? 0) > 0 {
                    Text("Some changes haven't synced yet and will be lost. Connect to the internet first to keep them.")
                } else {
                    Text("Your data stays in your account and comes back when you sign in again.")
                }
            }
            .confirmationDialog("Delete your account?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Account and Data", role: .destructive) { Task { await deleteAccount() } }
            } message: {
                Text("This permanently deletes your account, every space, entry, budget, and receipt. It can't be undone.")
            }
            .alert("Couldn't Delete Account", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
    }

    @ViewBuilder
    private var syncRow: some View {
        let pending = model.sync?.pendingCount ?? 0
        switch model.sync?.status {
        case .syncing?:
            LabeledContent("Sync") { ProgressView() }
        case .offline?:
            LabeledContent("Sync", value: pending > 0 ? String(localized: "Offline · \(pending) waiting") : String(localized: "Offline"))
        case .failed?:
            LabeledContent("Sync", value: String(localized: "Will retry soon"))
        default:
            LabeledContent("Sync", value: pending > 0 ? String(localized: "\(pending) waiting") : String(localized: "Up to date"))
        }
    }

    private func deleteAccount() async {
        deleting = true
        defer { deleting = false }
        do {
            try await model.deleteAccount()
        } catch {
            self.error = String(localized: "Check your connection and try again.")
        }
    }
}

// MARK: - Spaces

private struct SpacesList: View {
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Space> { !$0.isRemoved }, sort: \Space.sortOrder) private var spaces: [Space]
    @State private var editing: Space?
    @State private var adding = false

    var body: some View {
        List {
            Section {
                ForEach(spaces.filter { !$0.isArchived }) { space in row(space) }
                    .onMove(perform: move)
            } footer: {
                Text("Keep separate money apart, like Personal, Office, or a church fund. Each space has its own currency, categories, and budgets.")
            }
            let archived = spaces.filter(\.isArchived)
            if !archived.isEmpty {
                Section("Archived") {
                    ForEach(archived) { space in row(space) }
                }
            }
        }
        .navigationTitle("Spaces")
        .toolbar {
            EditButton()
            Button("New Space", systemImage: "plus") { adding = true }
        }
        .sheet(item: $editing) { SpaceEditor(space: $0) }
        .sheet(isPresented: $adding) { SpaceEditor(space: nil) }
    }

    private func row(_ space: Space) -> some View {
        Button { editing = space } label: {
            HStack {
                SymbolBadge(symbol: space.symbol, tint: space.tintColor)
                Text(space.name)
                Spacer()
                Text(space.currency).foregroundStyle(.secondary)
            }
        }
        .tint(.primary)
    }

    private func move(from source: IndexSet, to destination: Int) {
        var ordered = spaces.filter { !$0.isArchived }
        ordered.move(fromOffsets: source, toOffset: destination)
        let writer = Writer(context)
        for (index, space) in ordered.enumerated() where space.sortOrder != Double(index) {
            space.sortOrder = Double(index)
            try? writer.save(space)
        }
    }
}

struct SpaceEditor: View {
    let space: Space?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Environment(Navigator.self) private var nav: Navigator?
    @Query(filter: #Predicate<Space> { !$0.isRemoved }) private var spaces: [Space]
    @State private var name: String
    @State private var symbol: String
    @State private var tint: Tint
    @State private var currency: String
    @State private var monthStartDay: Int
    @State private var archived: Bool
    @State private var confirmingDelete = false
    @State private var error: String?
    @State private var hasEntries = false
    @FocusState private var nameFocused: Bool

    init(space: Space?) {
        self.space = space
        _name = State(initialValue: space?.name ?? "")
        _symbol = State(initialValue: space?.symbol ?? "briefcase")
        _tint = State(initialValue: Tint(rawValue: space?.tint ?? "") ?? .blue)
        _currency = State(initialValue: space?.currency ?? Locale.autoupdatingCurrent.currency?.identifier ?? "USD")
        _monthStartDay = State(initialValue: space?.monthStartDay ?? 1)
        _archived = State(initialValue: space?.isArchived ?? false)
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, like Office", text: $name)
                        .focused($nameFocused)
                    NavigationLink {
                        SymbolPicker(title: "Icon", symbols: SymbolChoices.spaces, selection: $symbol)
                    } label: {
                        LabeledContent("Icon") { Image(systemName: symbol).foregroundStyle(tint.color) }
                    }
                    // A navigation-list picker keeps each swatch's color; menus render icons in gray.
                    Picker("Color", selection: $tint) {
                        ForEach(Tint.allCases) { t in
                            Label { Text(t.name) } icon: { Image(systemName: "circle.fill").foregroundStyle(t.color) }.tag(t)
                        }
                    }
                    .pickerStyle(.navigationLink)
                }
                Section {
                    CurrencyPicker(selection: $currency).disabled(hasEntries)
                    MonthStartPicker(day: $monthStartDay)
                } footer: {
                    if hasEntries {
                        Text("Currency can't change once a space has entries.")
                    } else {
                        Text("Budgets reset on this day each month, so they can follow your payday.")
                    }
                }
                if let space, !space.isDefault {
                    Section {
                        Toggle("Archived", isOn: $archived)
                        Button("Delete Space", role: .destructive) { confirmingDelete = true }
                    } footer: {
                        Text("Archived spaces are hidden from the switcher but keep their entries.")
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(space == nil ? "New Space" : "Edit Space")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }.disabled(trimmedName.isEmpty)
                }
            }
            .confirmationDialog("Delete \(space?.name ?? "")?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Space and Entries", role: .destructive) { delete() }
            } message: {
                Text("Every entry, budget, and receipt in this space will be deleted.")
            }
            .task {
                if space == nil { nameFocused = true }
                guard let uid = space?.uid else { return }
                hasEntries = ((try? context.fetchCount(FetchDescriptor<Entry>(predicate: #Predicate { $0.spaceUid == uid }))) ?? 0) > 0
            }
        }
    }

    private func save() {
        let target = space ?? Space(name: trimmedName, symbol: symbol, tint: tint.rawValue, currency: currency, monthStartDay: monthStartDay, sortOrder: Double((spaces.map(\.sortOrder).max() ?? 0) + 1))
        target.name = trimmedName
        target.symbol = symbol
        target.tint = tint.rawValue
        if !hasEntries { target.currency = currency }
        target.monthStartDay = monthStartDay
        if !target.isDefault {
            target.archivedAt = archived ? (target.archivedAt ?? Clock.now) : nil
        }
        do {
            try Writer(context).save(target)
            if space == nil {
                nav?.selectedSpaceUid = target.uid
                Analytics.capture("space_created")
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete() {
        guard let space else { return }
        do {
            try Writer(context).delete(space)
            if nav?.selectedSpaceUid == space.uid { nav?.selectedSpaceUid = "" }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Categories

private struct CategoriesList: View {
    let space: Space
    @Environment(\.modelContext) private var context
    @Query private var categories: [EntryCategory]
    @State private var editing: EntryCategory?
    @State private var addingKind: CategoryKind?

    init(space: Space) {
        self.space = space
        let uid = space.uid
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid && !$0.isRemoved }, sort: \EntryCategory.sortOrder)
    }

    var body: some View {
        List {
            ForEach(CategoryKind.allCases, id: \.self) { kind in
                Section(kind == .expense ? "Expenses" : "Income") {
                    ForEach(categories.filter { $0.kind == kind }) { category in
                        Button { editing = category } label: {
                            Label { Text(category.name) } icon: { Image(systemName: category.symbol) }
                        }
                        .tint(.primary)
                        .swipeActions {
                            Button("Delete", systemImage: "trash", role: .destructive) { try? Writer(context).delete(category) }
                        }
                    }
                    Button("Add Category", systemImage: "plus") { addingKind = kind }
                }
            }
        }
        .navigationTitle("Categories")
        .sheet(item: $editing) { CategoryEditor(space: space, category: $0, kind: $0.kind, nextOrder: nextOrder) }
        .sheet(item: $addingKind) { CategoryEditor(space: space, category: nil, kind: $0, nextOrder: nextOrder) }
    }

    private var nextOrder: Double { (categories.map(\.sortOrder).max() ?? 0) + 1 }
}

extension CategoryKind: @retroactive Identifiable {
    public var id: String { rawValue }
}

private struct CategoryEditor: View {
    let space: Space
    let category: EntryCategory?
    let kind: CategoryKind
    let nextOrder: Double
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var name = ""
    @State private var symbol = "tag"
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                    .focused($nameFocused)
                NavigationLink {
                    SymbolPicker(title: "Icon", symbols: SymbolChoices.categories, selection: $symbol)
                } label: {
                    LabeledContent("Icon") { Image(systemName: symbol).foregroundStyle(.tint) }
                }
            }
            .navigationTitle(category == nil ? "New Category" : "Edit Category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                name = category?.name ?? ""
                symbol = category?.symbol ?? (kind == .income ? "banknote" : "tag")
                if category == nil { nameFocused = true }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        let target = category ?? EntryCategory(spaceUid: space.uid, name: name, symbol: symbol, kind: kind, sortOrder: nextOrder)
        target.name = name.trimmingCharacters(in: .whitespaces)
        target.symbol = symbol
        try? Writer(context).save(target)
        dismiss()
    }
}

// MARK: - Payment methods

private struct PaymentMethodsList: View {
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<PaymentMethod> { !$0.isRemoved }, sort: \PaymentMethod.sortOrder) private var methods: [PaymentMethod]
    @State private var editing: PaymentMethod?
    @State private var adding = false

    var body: some View {
        List {
            Section {
                ForEach(methods) { method in
                    Button { editing = method } label: {
                        Label { Text(method.name) } icon: { Image(systemName: method.symbol) }
                    }
                    .tint(.primary)
                    .swipeActions {
                        Button("Delete", systemImage: "trash", role: .destructive) { try? Writer(context).delete(method) }
                    }
                }
                Button("Add Payment Method", systemImage: "plus") { adding = true }
            } footer: {
                Text("Labels for how you paid, shared by all your spaces.")
            }
        }
        .navigationTitle("Payment Methods")
        .sheet(item: $editing) { PaymentMethodEditor(method: $0, nextOrder: nextOrder) }
        .sheet(isPresented: $adding) { PaymentMethodEditor(method: nil, nextOrder: nextOrder) }
    }

    private var nextOrder: Double { (methods.map(\.sortOrder).max() ?? 0) + 1 }
}

private struct PaymentMethodEditor: View {
    let method: PaymentMethod?
    let nextOrder: Double
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @State private var name = ""
    @State private var symbol = "creditcard"
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name, like HDFC Card", text: $name)
                    .focused($nameFocused)
                Picker("Icon", selection: $symbol) {
                    ForEach(SymbolChoices.paymentMethods, id: \.self) { s in
                        Image(systemName: s).tag(s)
                    }
                }
            }
            .navigationTitle(method == nil ? "New Payment Method" : "Edit Payment Method")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                name = method?.name ?? ""
                symbol = method?.symbol ?? "creditcard"
                if method == nil { nameFocused = true }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        let target = method ?? PaymentMethod(name: name, symbol: symbol, sortOrder: nextOrder)
        target.name = name.trimmingCharacters(in: .whitespaces)
        target.symbol = symbol
        try? Writer(context).save(target)
        dismiss()
    }
}
