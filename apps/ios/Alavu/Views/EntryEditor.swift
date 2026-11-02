import AlavuKit
import PhotosUI
import SwiftData
import SwiftUI

/// Add or edit an expense, income, or transfer between spaces.
struct EntryEditor: View {
    enum Kind: Hashable { case expense, income, transfer }

    let space: Space
    let entry: Entry?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query(filter: #Predicate<Space> { !$0.isRemoved && $0.archivedAt == nil }, sort: \Space.sortOrder) private var spaces: [Space]
    @Query(filter: #Predicate<PaymentMethod> { !$0.isRemoved }, sort: \PaymentMethod.sortOrder) private var paymentMethods: [PaymentMethod]
    @Query private var categories: [EntryCategory]

    @State private var kind: Kind
    @State private var amount: Decimal?
    @State private var receivedAmount: Decimal?
    @State private var title: String
    @State private var note: String
    @State private var date: Date
    @State private var categoryUid: String?
    @State private var paymentMethodUid: String?
    @State private var targetSpaceUid: String?
    @State private var repeatCadence: Cadence?
    @State private var newReceipts: [String] = []
    @State private var removedReceipts: Set<String> = []
    @State private var photoItem: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var showingPhotos = false
    @State private var confirmingDelete = false
    @State private var error: String?
    @State private var viewingReceipt: ReceiptRef?
    @FocusState private var amountFocused: Bool

    init(space: Space, entry: Entry? = nil) {
        self.space = space
        self.entry = entry
        let uid = space.uid
        _categories = Query(filter: #Predicate<EntryCategory> { $0.spaceUid == uid && !$0.isRemoved && $0.archivedAt == nil }, sort: \EntryCategory.sortOrder)
        let kind: Kind = switch entry?.kind {
        case .income: .income
        case .transferIn, .transferOut: .transfer
        default: .expense
        }
        _kind = State(initialValue: kind)
        _amount = State(initialValue: entry.map { Money.decimal(minor: $0.amountMinor, currency: $0.currency) })
        _title = State(initialValue: entry?.title ?? "")
        _note = State(initialValue: entry?.note ?? "")
        _date = State(initialValue: entry?.date ?? .now)
        _categoryUid = State(initialValue: entry?.categoryUid)
        _paymentMethodUid = State(initialValue: entry?.paymentMethodUid)
    }

    private var isNew: Bool { entry == nil }
    private var currency: String { entry?.currency ?? space.currency }
    private var targetSpace: Space? { spaces.first { $0.uid == targetSpaceUid } }
    private var needsReceivedAmount: Bool { kind == .transfer && isNew && targetSpace.map { $0.currency != currency } == true }
    private var amountMinor: Int64? { amount.flatMap { Money.minor(from: $0, currency: currency) } }

    private var isValid: Bool {
        guard let amountMinor, amountMinor > 0 else { return false }
        if kind == .transfer && isNew {
            guard targetSpace != nil else { return false }
            if needsReceivedAmount, (receivedAmount.flatMap { Money.minor(from: $0, currency: targetSpace!.currency) } ?? 0) <= 0 { return false }
        }
        return true
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isNew {
                        Picker("Type", selection: $kind) {
                            Text("Expense").tag(Kind.expense)
                            Text("Income").tag(Kind.income)
                            if spaces.count > 1 { Text("Transfer").tag(Kind.transfer) }
                        }
                        .pickerStyle(.segmented)
                        .listRowSeparator(.hidden)
                    }
                    AmountField(title: "Amount", currency: currency, amount: $amount, large: true)
                        .focused($amountFocused)
                }

                if kind == .transfer {
                    transferSection
                } else {
                    Section {
                        TextField(kind == .income ? "Source, like Salary" : "What was it for?", text: $title)
                            .textInputAutocapitalization(.sentences)
                        Picker("Category", selection: $categoryUid) {
                            Text("None").tag(String?.none)
                            ForEach(categories.filter { $0.kind == (kind == .income ? .income : .expense) }) { category in
                                Label(category.name, systemImage: category.symbol).tag(Optional(category.uid))
                            }
                        }
                        .pickerStyle(.navigationLink)
                        Picker(kind == .income ? "Received Via" : "Paid With", selection: $paymentMethodUid) {
                            Text("None").tag(String?.none)
                            ForEach(paymentMethods) { method in
                                Label(method.name, systemImage: method.symbol).tag(Optional(method.uid))
                            }
                        }
                    }
                }

                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    if isNew && kind != .transfer {
                        Picker("Repeat", selection: $repeatCadence) {
                            Text("Never").tag(Cadence?.none)
                            Text("Every Week").tag(Cadence?.some(.weekly))
                            Text("Every Month").tag(Cadence?.some(.monthly))
                            Text("Every Year").tag(Cadence?.some(.yearly))
                        }
                    }
                    TextField("Note", text: $note, axis: .vertical)
                        .lineLimit(1...4)
                }

                if kind != .transfer { receiptsSection }

                if !isNew {
                    Section {
                        Button(entry?.kind.isTransfer == true ? "Delete Transfer" : "Delete Entry", role: .destructive) {
                            confirmingDelete = true
                        }
                    }
                }
            }
            .navigationTitle(isNew ? "New Entry" : "Edit Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) { save() }.disabled(!isValid)
                }
            }
            .confirmationDialog("Delete this entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { delete() }
            } message: {
                if entry?.kind.isTransfer == true {
                    Text("Both sides of the transfer will be deleted.")
                }
            }
            .alert("Couldn't Save", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) { addReceipt(data) }
                    photoItem = nil
                }
            }
            .photosPicker(isPresented: $showingPhotos, selection: $photoItem, matching: .images)
            .fullScreenCover(isPresented: $showingCamera) {
                CameraPicker { data in addReceipt(data) }.ignoresSafeArea()
            }
            .sheet(item: $viewingReceipt) { ReceiptViewer(ref: $0) }
            .onChange(of: kind) { _, _ in categoryUid = nil }
            .task { if isNew { amountFocused = true } }
            .scrollDismissesKeyboard(.interactively)
        }
        .interactiveDismissDisabled(amount != nil && isNew)
    }

    // MARK: Sections

    @ViewBuilder
    private var transferSection: some View {
        Section {
            if isNew {
                Picker("To", selection: $targetSpaceUid) {
                    Text("Choose a Space").tag(String?.none)
                    ForEach(spaces.filter { $0.uid != space.uid }) { s in
                        Label(s.name, systemImage: s.symbol).tag(Optional(s.uid))
                    }
                }
                if needsReceivedAmount, let targetSpace {
                    AmountField(title: "Amount received", currency: targetSpace.currency, amount: $receivedAmount)
                }
            } else if let entry {
                LabeledContent(entry.kind == .transferOut ? "To" : "From", value: entry.title)
            }
        } footer: {
            Text("Moves money out of \(space.name) and into another space. It doesn't count as spending.")
        }
    }

    @ViewBuilder
    private var receiptsSection: some View {
        let existing = (entry?.receiptKeys ?? []).filter { !removedReceipts.contains($0) }
        let pending = (entry?.pendingReceiptFiles ?? []).filter { !removedReceipts.contains($0) } + newReceipts
        Section("Receipts") {
            ForEach(existing, id: \.self) { key in
                receiptRow(.remote(key), label: "Receipt")
            }
            ForEach(pending, id: \.self) { file in
                receiptRow(.local(file), label: "Receipt (waiting to upload)")
            }
            if existing.count + pending.count < 10 {
                Menu {
                    // A PhotosPicker can't present from inside a Menu, so the menu
                    // button opens it through the modifier below.
                    Button("Choose Photo", systemImage: "photo.on.rectangle") { showingPhotos = true }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Take Photo", systemImage: "camera") { showingCamera = true }
                    }
                } label: {
                    Label("Add Receipt", systemImage: "paperclip")
                }
            }
        }
    }

    private func receiptRow(_ ref: ReceiptRef, label: LocalizedStringKey) -> some View {
        Button { viewingReceipt = ref } label: {
            Label(label, systemImage: "doc.text.image")
        }
        .swipeActions {
            Button("Remove", systemImage: "trash", role: .destructive) {
                switch ref {
                case .remote(let key): removedReceipts.insert(key)
                case .local(let file):
                    if newReceipts.contains(file) {
                        newReceipts.removeAll { $0 == file }
                        try? FileManager.default.removeItem(at: Store.receiptsFolder.appending(path: file))
                    } else {
                        removedReceipts.insert(file)
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func addReceipt(_ data: Data) {
        guard let jpeg = ReceiptImage.jpeg(from: data) else {
            error = String(localized: "That photo couldn't be read.")
            return
        }
        let file = "\(UUID().uuidString).jpg"
        do {
            try jpeg.write(to: Store.receiptsFolder.appending(path: file))
            newReceipts.append(file)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func cancel() {
        for file in newReceipts {
            try? FileManager.default.removeItem(at: Store.receiptsFolder.appending(path: file))
        }
        dismiss()
    }

    private func save() {
        guard let amountMinor else { return }
        let writer = Writer(context)
        let day = CalendarDay.string(from: date)
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if kind == .transfer {
                try saveTransfer(writer, amountMinor: amountMinor, day: day, note: trimmedNote)
            } else if let entry {
                entry.kind = kind == .income ? .income : .expense
                entry.amountMinor = amountMinor
                entry.title = resolvedTitle
                entry.note = trimmedNote.isEmpty ? nil : trimmedNote
                entry.categoryUid = categoryUid
                entry.paymentMethodUid = paymentMethodUid
                entry.occurredOn = day
                entry.receiptKeys.removeAll { removedReceipts.contains($0) }
                for file in entry.pendingReceiptFiles where removedReceipts.contains(file) {
                    try? FileManager.default.removeItem(at: Store.receiptsFolder.appending(path: file))
                }
                entry.pendingReceiptFiles.removeAll { removedReceipts.contains($0) }
                entry.pendingReceiptFiles += newReceipts
                try writer.save(entry)
            } else {
                let entryKind: TransactionKind = kind == .income ? .income : .expense
                var uid = UUID().uuidString
                var ruleUid: String?
                if let repeatCadence {
                    // The first occurrence uses the id the server would give it, so the
                    // server recognises it instead of logging it twice.
                    let rule = RecurringRule(spaceUid: space.uid, kind: kind == .income ? .income : .expense, amountMinor: amountMinor, currency: currency, title: resolvedTitle, note: trimmedNote.isEmpty ? nil : trimmedNote, categoryUid: categoryUid, paymentMethodUid: paymentMethodUid, cadence: repeatCadence, startOn: day)
                    try writer.save(rule)
                    ruleUid = rule.uid
                    uid = "\(rule.uid):\(day)"
                }
                let new = Entry(uid: uid, spaceUid: space.uid, kind: entryKind, amountMinor: amountMinor, currency: currency, title: resolvedTitle, note: trimmedNote.isEmpty ? nil : trimmedNote, categoryUid: categoryUid, paymentMethodUid: paymentMethodUid, occurredOn: day, recurringRuleUid: ruleUid)
                new.pendingReceiptFiles = newReceipts
                try writer.save(new)
                Analytics.capture("entry_added", ["kind": entryKind.rawValue, "has_receipt": !newReceipts.isEmpty, "repeats": repeatCadence != nil, "via": "app"])
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var resolvedTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        if let category = categories.first(where: { $0.uid == categoryUid }) { return category.name }
        return kind == .income ? String(localized: "Income") : String(localized: "Expense")
    }

    private func saveTransfer(_ writer: Writer, amountMinor: Int64, day: String, note: String) throws {
        if let entry, let transferUid = entry.transferUid {
            // Editing: update the date, note and this side's amount on both legs.
            let target: String? = transferUid
            let legs = try context.fetch(FetchDescriptor<Entry>(predicate: #Predicate { $0.transferUid == target }))
            guard let out = legs.first(where: { $0.kind == .transferOut }), let into = legs.first(where: { $0.kind == .transferIn }) else {
                entry.amountMinor = amountMinor
                entry.occurredOn = day
                try writer.save(entry)
                return
            }
            let sameCurrency = out.currency == into.currency
            entry.amountMinor = amountMinor
            if sameCurrency { out.amountMinor = amountMinor; into.amountMinor = amountMinor }
            for leg in [out, into] {
                leg.occurredOn = day
                leg.note = note.isEmpty ? nil : note
            }
            try writer.saveTransfer(out, into)
            return
        }
        guard let targetSpace else { return }
        let received = needsReceivedAmount
            ? (receivedAmount.flatMap { Money.minor(from: $0, currency: targetSpace.currency) } ?? amountMinor)
            : amountMinor
        let transferUid = UUID().uuidString
        let out = Entry(spaceUid: space.uid, kind: .transferOut, amountMinor: amountMinor, currency: currency, title: targetSpace.name, note: note.isEmpty ? nil : note, occurredOn: day, transferUid: transferUid)
        let into = Entry(spaceUid: targetSpace.uid, kind: .transferIn, amountMinor: received, currency: targetSpace.currency, title: space.name, note: note.isEmpty ? nil : note, occurredOn: day, transferUid: transferUid)
        try writer.saveTransfer(out, into)
        Analytics.capture("entry_added", ["kind": "transfer", "via": "app"])
    }

    private func delete() {
        guard let entry else { return }
        do {
            try Writer(context).delete(entry)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
