// swift-tools-version: 5.9
import PackageDescription

// Plain TCP for the phone app, hqpmob (apps/mobile src/tcp.ts is its JavaScript side).
let package = Package(
    name: "AppCapacitorTcp",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "AppCapacitorTcp", targets: ["TcpPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "TcpPlugin",
            dependencies: [.product(name: "Capacitor", package: "capacitor-swift-pm")],
            path: "ios/Sources/TcpPlugin")
    ]
)
