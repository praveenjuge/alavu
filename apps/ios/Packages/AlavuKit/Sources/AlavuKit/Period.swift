import Foundation

/// Calendar days as `yyyy-MM-dd` strings, interpreted in the user's current calendar.
public enum CalendarDay {
    private static func formatter() -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .autoupdatingCurrent
        f.dateFormat = "yyyy-MM-dd"
        return f
    }

    public static func string(from date: Date) -> String { formatter().string(from: date) }
    public static func date(from string: String) -> Date? { formatter().date(from: string) }
    public static var today: String { string(from: .now) }
}

/// A budget month. With a start day of 1 it is the calendar month; with 25 it runs from
/// the 25th to the 24th of the next month, so budgets can follow payday.
public struct BudgetPeriod: Equatable, Hashable, Sendable {
    public let start: Date
    public let end: Date  // exclusive
    public let startDay: Int

    public init(containing date: Date, startDay: Int, calendar: Calendar = .autoupdatingCurrent) {
        let day = min(max(startDay, 1), 28)
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        var startParts = DateComponents(year: parts.year, month: parts.month, day: day)
        if (parts.day ?? 1) < day {
            startParts.month = (parts.month ?? 1) - 1
        }
        let start = calendar.date(from: startParts) ?? calendar.startOfDay(for: date)
        self.start = start
        self.end = calendar.date(byAdding: .month, value: 1, to: start) ?? start
        self.startDay = day
    }

    public var startString: String { CalendarDay.string(from: start) }
    /// Exclusive upper bound as a calendar-day string.
    public var endString: String { CalendarDay.string(from: end) }

    public func contains(_ occurredOn: String) -> Bool {
        occurredOn >= startString && occurredOn < endString
    }

    public func next(calendar: Calendar = .autoupdatingCurrent) -> BudgetPeriod {
        BudgetPeriod(containing: end, startDay: startDay, calendar: calendar)
    }

    public func previous(calendar: Calendar = .autoupdatingCurrent) -> BudgetPeriod {
        let dayBefore = calendar.date(byAdding: .day, value: -1, to: start) ?? start
        return BudgetPeriod(containing: dayBefore, startDay: startDay, calendar: calendar)
    }

    public var isCurrent: Bool { contains(CalendarDay.today) }

    /// Days in the period, for daily charts.
    public func days(calendar: Calendar = .autoupdatingCurrent) -> [Date] {
        var days: [Date] = []
        var day = start
        while day < end {
            days.append(day)
            day = calendar.date(byAdding: .day, value: 1, to: day) ?? end
        }
        return days
    }

    /// "November 2026" for calendar months, "25 Oct – 24 Nov" otherwise.
    public var title: String {
        if startDay == 1 {
            return start.formatted(.dateTime.month(.wide).year())
        }
        let last = Calendar.autoupdatingCurrent.date(byAdding: .day, value: -1, to: end) ?? end
        return "\(start.formatted(.dateTime.day().month(.abbreviated))) – \(last.formatted(.dateTime.day().month(.abbreviated)))"
    }
}
