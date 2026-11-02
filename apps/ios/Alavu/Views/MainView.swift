import AlavuKit
import SwiftData
import SwiftUI

/// Which space is showing and which app-wide sheets are open.
@MainActor
@Observable
final class Navigator {
    enum Tab: Hashable { case overview, activity, budgets, settings }

    var tab: Tab = .overview
    var addingEntry = false
    var newSpace = false

    var selectedSpaceUid: String {
        didSet { Store.defaults.set(selectedSpaceUid, forKey: SharedKey.selectedSpaceUid) }
    }

    init() {
        selectedSpaceUid = Store.defaults.string(forKey: SharedKey.selectedSpaceUid) ?? ""
    }
}

struct MainView: View {
    @Environment(AppModel.self) private var model
    @Query(filter: #Predicate<Space> { !$0.isRemoved }, sort: \Space.sortOrder) private var spaces: [Space]
    @State private var nav = Navigator()

    /// The selected space, falling back to the default one.
    private var space: Space? {
        spaces.first { $0.uid == nav.selectedSpaceUid && !$0.isArchived }
            ?? spaces.first(where: \.isDefault) ?? spaces.first
    }

    var body: some View {
        if let space {
            @Bindable var nav = nav
            TabView(selection: $nav.tab) {
                Tab("Overview", systemImage: "chart.bar.xaxis", value: .overview) {
                    OverviewView(space: space)
                }
                Tab("Activity", systemImage: "list.bullet.rectangle", value: .activity) {
                    ActivityView(space: space)
                }
                Tab("Budgets", systemImage: "gauge.with.dots.needle.33percent", value: .budgets) {
                    BudgetsView(space: space)
                }
                Tab("Settings", systemImage: "gearshape", value: .settings) {
                    SettingsView(space: space)
                }
            }
            .tabBarMinimizeBehavior(.onScrollDown)
            .environment(nav)
            .sheet(isPresented: $nav.addingEntry) {
                EntryEditor(space: space)
            }
            .sheet(isPresented: $nav.newSpace) {
                SpaceEditor(space: nil)
            }
            .onChange(of: model.pendingAddEntry, initial: true) { _, pending in
                guard pending else { return }
                model.pendingAddEntry = false
                nav.addingEntry = true
            }
        }
    }
}

// MARK: - Space switcher

extension View {
    /// Shows the space name as the title, with a menu to switch spaces or add one.
    func spaceSwitcher(_ space: Space) -> some View {
        modifier(SpaceSwitcher(space: space))
    }
}

private struct SpaceSwitcher: ViewModifier {
    let space: Space
    @Environment(Navigator.self) private var nav
    @Query(filter: #Predicate<Space> { !$0.isRemoved && $0.archivedAt == nil }, sort: \Space.sortOrder)
    private var spaces: [Space]

    func body(content: Content) -> some View {
        content
            .navigationTitle(space.name)
            .toolbarTitleMenu {
                ForEach(spaces) { s in
                    Button {
                        nav.selectedSpaceUid = s.uid
                    } label: {
                        Label(s.name, systemImage: s.uid == space.uid ? "checkmark" : s.symbol)
                    }
                }
                Divider()
                Button("New Space…", systemImage: "plus") { nav.newSpace = true }
            }
    }
}

/// Toolbar button that opens the new-entry sheet.
struct AddEntryButton: ToolbarContent {
    @Environment(Navigator.self) private var nav

    var body: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button("Add Entry", systemImage: "plus") { nav.addingEntry = true }
                .buttonStyle(.glassProminent)
        }
    }
}
