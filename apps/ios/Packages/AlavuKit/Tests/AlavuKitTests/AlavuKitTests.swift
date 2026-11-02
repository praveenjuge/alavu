import Foundation
import SwiftData
import Testing
@testable import AlavuKit

@Suite struct MoneyTests {
    @Test func minorDigitsFollowTheCurrency() {
        #expect(Money.minorDigits("INR") == 2)
        #expect(Money.minorDigits("JPY") == 0)
        #expect(Money.minorDigits("KWD") == 3)
    }

    @Test func roundTripsThroughMinorUnits() {
        #expect(Money.minor(from: Decimal(string: "1234.56")!, currency: "INR") == 123_456)
        #expect(Money.minor(from: Decimal(string: "0.1")! + Decimal(string: "0.2")!, currency: "USD") == 30)
        #expect(Money.minor(from: Decimal(string: "1500.4")!, currency: "JPY") == 1500)
        #expect(Money.minor(from: Decimal(string: "99999999999999999999999")!, currency: "INR") == nil)
        #expect(Money.decimal(minor: 123_456, currency: "INR") == Decimal(string: "1234.56"))
    }

    @Test func formatsIndianGrouping() {
        let text = Money.format(minor: 1_23_45_678_50, currency: "INR", locale: Locale(identifier: "en_IN"))
        #expect(text == "₹1,23,45,678.50")
        let us = Money.format(minor: 1_234_50, currency: "USD", locale: Locale(identifier: "en_US"))
        #expect(us == "$1,234.50")
    }
}

@Suite struct PeriodTests {
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .autoupdatingCurrent
        return c
    }

    func date(_ s: String) -> Date { CalendarDay.date(from: s)! }

    @Test func calendarMonth() {
        let p = BudgetPeriod(containing: date("2026-11-15"), startDay: 1, calendar: calendar)
        #expect(p.startString == "2026-11-01")
        #expect(p.endString == "2026-12-01")
        #expect(p.contains("2026-11-30"))
        #expect(!p.contains("2026-12-01"))
    }

    @Test func paydayMonthSpansTwoCalendarMonths() {
        let early = BudgetPeriod(containing: date("2026-11-10"), startDay: 25, calendar: calendar)
        #expect(early.startString == "2026-10-25")
        #expect(early.endString == "2026-11-25")
        let late = BudgetPeriod(containing: date("2026-11-25"), startDay: 25, calendar: calendar)
        #expect(late.startString == "2026-11-25")
        #expect(early.next(calendar: calendar) == late)
        #expect(late.previous(calendar: calendar) == early)
    }

    @Test func januaryRollsBackToDecember() {
        let p = BudgetPeriod(containing: date("2027-01-05"), startDay: 20, calendar: calendar)
        #expect(p.startString == "2026-12-20")
        #expect(p.days(calendar: calendar).count == 31)
    }
}

@MainActor
@Suite struct WriterTests {
    @Test func queuesOneOutboxItemPerAction() throws {
        let container = try Store.makeContainer(inMemory: true)
        let context = container.mainContext
        let writer = Writer(context)
        let space = Space(name: "Personal", symbol: "person", tint: "green", currency: "INR", monthStartDay: 1, sortOrder: 0)
        try writer.save(space)

        let entry = Entry(spaceUid: space.uid, kind: .expense, amountMinor: 50_00, currency: "INR", title: "Lunch", occurredOn: "2026-11-02")
        try writer.save(entry)

        let office = Space(name: "Office", symbol: "briefcase", tint: "blue", currency: "INR", monthStartDay: 1, sortOrder: 1)
        try writer.save(office)
        let transfer = UUID().uuidString
        let out = Entry(spaceUid: space.uid, kind: .transferOut, amountMinor: 100, currency: "INR", title: "To Office", occurredOn: "2026-11-02", transferUid: transfer)
        let into = Entry(spaceUid: office.uid, kind: .transferIn, amountMinor: 100, currency: "INR", title: "From Personal", occurredOn: "2026-11-02", transferUid: transfer)
        try writer.saveTransfer(out, into)

        let items = try context.fetch(FetchDescriptor<OutboxItem>(sortBy: [SortDescriptor(\.createdAt)]))
        #expect(items.count == 4)
        let transferChanges = try items[3].changes()
        #expect(transferChanges.map(\.uid) == [out.uid, into.uid])
        #expect(try items[1].changes().first?.data?["amountMinor"] == .int64(5000))

        // Deleting one leg deletes both, in one item.
        try writer.delete(into)
        let last = try context.fetch(FetchDescriptor<OutboxItem>(sortBy: [SortDescriptor(\.createdAt)])).last!
        #expect(Set(try last.changes().map(\.uid)) == [out.uid, into.uid])
        #expect(out.isRemoved && into.isRemoved)
    }

    @Test func budgetsUseOneRecordPerCategory() throws {
        let container = try Store.makeContainer(inMemory: true)
        let writer = Writer(container.mainContext)
        try writer.setBudget(spaceUid: "s", categoryUid: nil, amountMinor: 1000)
        try writer.setBudget(spaceUid: "s", categoryUid: nil, amountMinor: 2000)
        let budgets = try container.mainContext.fetch(FetchDescriptor<Budget>())
        #expect(budgets.count == 1)
        #expect(budgets.first?.amountMinor == 2000)
        try writer.setBudget(spaceUid: "s", categoryUid: nil, amountMinor: nil)
        #expect(budgets.first?.isRemoved == true)
    }

    @Test func summaryTotalsOnlyThePeriod() {
        let period = BudgetPeriod(containing: CalendarDay.date(from: "2026-11-10")!, startDay: 1)
        let entries = [
            Entry(spaceUid: "s", kind: .income, amountMinor: 10_000, currency: "INR", title: "Salary", occurredOn: "2026-11-01"),
            Entry(spaceUid: "s", kind: .expense, amountMinor: 2_000, currency: "INR", title: "Food", categoryUid: "food", occurredOn: "2026-11-02"),
            Entry(spaceUid: "s", kind: .expense, amountMinor: 500, currency: "INR", title: "Food", categoryUid: "food", occurredOn: "2026-11-02"),
            Entry(spaceUid: "s", kind: .expense, amountMinor: 9_999, currency: "INR", title: "Old", occurredOn: "2026-10-31"),
            Entry(spaceUid: "s", kind: .transferOut, amountMinor: 1_000, currency: "INR", title: "Out", occurredOn: "2026-11-03", transferUid: "t"),
        ]
        let summary = PeriodSummary(entries: entries, period: period)
        #expect(summary.incomeMinor == 10_000)
        #expect(summary.expenseMinor == 2_500)
        #expect(summary.netMinor == 6_500)
        #expect(summary.dailyExpense["2026-11-02"] == 2_500)
        #expect(summary.byCategory.first?.categoryUid == "food")

        let budget = Budget(uid: "b", spaceUid: "s", categoryUid: "food", amountMinor: 3_000)
        let status = summary.status(for: budget)
        #expect(status.level == .approaching)
        #expect(status.remainingMinor == 500)
    }
}
