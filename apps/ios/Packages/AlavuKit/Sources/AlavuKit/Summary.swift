import Foundation

/// Totals for one space over one budget period. Shared by the app and the widgets so
/// both always show the same numbers.
public struct PeriodSummary: Sendable {
    public struct CategoryTotal: Identifiable, Sendable {
        public let categoryUid: String?
        public let amountMinor: Int64
        public var id: String { categoryUid ?? "none" }
    }

    public struct BudgetStatus: Sendable {
        public let limitMinor: Int64
        public let spentMinor: Int64

        public init(limitMinor: Int64, spentMinor: Int64) {
            self.limitMinor = limitMinor
            self.spentMinor = spentMinor
        }

        public var remainingMinor: Int64 { limitMinor - spentMinor }
        public var fraction: Double {
            limitMinor > 0 ? Double(spentMinor) / Double(limitMinor) : 0
        }
        public enum Level: Sendable { case within, approaching, over }
        public var level: Level {
            if spentMinor > limitMinor { return .over }
            return fraction >= 0.75 ? .approaching : .within
        }
    }

    public let incomeMinor: Int64
    public let expenseMinor: Int64
    public let transferInMinor: Int64
    public let transferOutMinor: Int64
    /// Expenses per calendar day (`yyyy-MM-dd`).
    public let dailyExpense: [String: Int64]
    /// Expenses per category, largest first.
    public let byCategory: [CategoryTotal]

    public var netMinor: Int64 { incomeMinor + transferInMinor - expenseMinor - transferOutMinor }

    public init<S: Sequence>(entries: S, period: BudgetPeriod) where S.Element == Entry {
        var income: Int64 = 0, expense: Int64 = 0, tin: Int64 = 0, tout: Int64 = 0
        var daily: [String: Int64] = [:]
        var categories: [String?: Int64] = [:]
        for entry in entries where !entry.isRemoved && period.contains(entry.occurredOn) {
            switch entry.kind {
            case .income: income += entry.amountMinor
            case .transferIn: tin += entry.amountMinor
            case .transferOut: tout += entry.amountMinor
            case .expense:
                expense += entry.amountMinor
                daily[entry.occurredOn, default: 0] += entry.amountMinor
                categories[entry.categoryUid, default: 0] += entry.amountMinor
            }
        }
        incomeMinor = income
        expenseMinor = expense
        transferInMinor = tin
        transferOutMinor = tout
        dailyExpense = daily
        byCategory = categories
            .map { CategoryTotal(categoryUid: $0.key, amountMinor: $0.value) }
            .sorted { $0.amountMinor > $1.amountMinor }
    }

    public func spent(inCategory uid: String?) -> Int64 {
        byCategory.first { $0.categoryUid == uid }?.amountMinor ?? 0
    }

    public func status(for budget: Budget) -> BudgetStatus {
        let spent = budget.categoryUid == nil ? expenseMinor : spent(inCategory: budget.categoryUid)
        return BudgetStatus(limitMinor: budget.amountMinor, spentMinor: spent)
    }
}
