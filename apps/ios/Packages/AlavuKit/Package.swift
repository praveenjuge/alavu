// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AlavuKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v26)],
    products: [
        .library(name: "AlavuKit", targets: ["AlavuKit"])
    ],
    targets: [
        .target(name: "AlavuKit"),
        .testTarget(name: "AlavuKitTests", dependencies: ["AlavuKit"]),
    ]
)
