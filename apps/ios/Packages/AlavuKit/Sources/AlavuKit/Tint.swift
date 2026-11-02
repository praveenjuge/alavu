import SwiftUI

/// Space tints are stored by name so every platform can map them to its own palette.
public enum Tint: String, CaseIterable, Identifiable, Sendable {
    case green, blue, indigo, purple, pink, red, orange, yellow, teal, gray

    public var id: String { rawValue }

    public var color: Color {
        switch self {
        case .green: .green
        case .blue: .blue
        case .indigo: .indigo
        case .purple: .purple
        case .pink: .pink
        case .red: .red
        case .orange: .orange
        case .yellow: .yellow
        case .teal: .teal
        case .gray: .gray
        }
    }

    public var name: LocalizedStringResource {
        switch self {
        case .green: "Green"
        case .blue: "Blue"
        case .indigo: "Indigo"
        case .purple: "Purple"
        case .pink: "Pink"
        case .red: "Red"
        case .orange: "Orange"
        case .yellow: "Yellow"
        case .teal: "Teal"
        case .gray: "Gray"
        }
    }
}

public extension Space {
    var tintColor: Color { (Tint(rawValue: tint) ?? .green).color }
}

/// SF Symbols offered when choosing an icon for a space or category.
public enum SymbolChoices {
    public static let spaces = [
        "person.crop.circle", "briefcase", "building.2", "house", "heart", "graduationcap",
        "cross", "hands.and.sparkles", "cart", "airplane", "car", "gift", "star", "leaf",
        "pawprint", "figure.2.and.child.holdinghands",
    ]

    public static let categories = [
        "fork.knife", "cart", "car", "bag", "bolt", "house", "cross.case", "popcorn",
        "airplane", "book", "gift", "ellipsis.circle", "banknote", "briefcase", "percent",
        "plus.circle", "cup.and.saucer", "tshirt", "fuelpump", "bus", "tram", "phone",
        "wifi", "drop", "flame", "pills", "stethoscope", "dumbbell", "gamecontroller",
        "music.note", "film", "pawprint", "figure.and.child.holdinghands", "graduationcap",
        "wrench.and.screwdriver", "hammer", "paintbrush", "scissors", "creditcard",
        "building.columns", "heart", "hands.and.sparkles", "leaf", "sparkles",
    ]

    public static let paymentMethods = [
        "banknote", "creditcard", "building.columns", "qrcode", "wallet.bifold",
        "iphone", "dollarsign.circle", "arrow.left.arrow.right",
    ]
}
