import Foundation

/// Amounts are stored as integer minor units (paise, cents) and shown with the
/// device's locale, so an Indian locale gets lakh grouping automatically.
public enum Money {
    /// Number of digits after the decimal point for an ISO 4217 currency code.
    public static func minorDigits(_ currency: String) -> Int {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        return formatter.maximumFractionDigits
    }

    public static func decimal(minor: Int64, currency: String) -> Decimal {
        Decimal(minor) / pow(10, minorDigits(currency))
    }

    /// Converts an amount to minor units, rounding to the currency's precision.
    /// Returns `nil` for values that don't fit.
    public static func minor(from amount: Decimal, currency: String) -> Int64? {
        var scaled = amount * pow(10, minorDigits(currency))
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        let number = NSDecimalNumber(decimal: rounded)
        guard number.compare(NSDecimalNumber(value: Int64.max)) != .orderedDescending,
              number.compare(NSDecimalNumber(value: Int64.min)) != .orderedAscending
        else { return nil }
        return number.int64Value
    }

    public static func format(
        minor: Int64, currency: String, locale: Locale = .autoupdatingCurrent,
        showsSign: Bool = false
    ) -> String {
        let value = decimal(minor: minor, currency: currency)
        let style = Decimal.FormatStyle.Currency(code: currency, locale: locale)
        return showsSign
            ? value.formatted(style.sign(strategy: .always(showZero: false)))
            : value.formatted(style)
    }

    /// Compact form for charts and widgets, like "₹1.2L" or "$3.4K".
    public static func compact(minor: Int64, currency: String, locale: Locale = .autoupdatingCurrent) -> String {
        let value = decimal(minor: minor, currency: currency)
        return value.formatted(
            .currency(code: currency).locale(locale).notation(.compactName).precision(.significantDigits(1...3))
        )
    }
}
