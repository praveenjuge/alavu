import AlavuKit
import SwiftUI
import UIKit

enum ReceiptRef: Identifiable, Hashable {
    /// Uploaded, identified by its storage key.
    case remote(String)
    /// Saved on this device and waiting to upload.
    case local(String)

    var id: String {
        switch self {
        case .remote(let key): key
        case .local(let file): file
        }
    }
}

enum ReceiptImage {
    /// Downscales to at most 2048px on the long side and re-encodes as JPEG.
    static func jpeg(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = min(1, 2048 / max(longest, 1))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: 0.75)
    }
}

struct ReceiptViewer: View {
    let ref: ReceiptRef
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Group {
                if let image {
                    ScrollView([.horizontal, .vertical]) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .containerRelativeFrame([.horizontal])
                            .accessibilityLabel("Receipt photo")
                    }
                } else if failed {
                    ContentUnavailableView("Couldn't Load Receipt", systemImage: "wifi.slash", description: Text("Connect to the internet and try again."))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Receipt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", role: .close) { dismiss() } }
                if let image {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: Image(uiImage: image), preview: SharePreview("Receipt", image: Image(uiImage: image)))
                    }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            let data: Data
            switch ref {
            case .local(let file):
                data = try Data(contentsOf: Store.receiptsFolder.appending(path: file))
            case .remote(let key):
                guard let sync = model.sync else { throw URLError(.notConnectedToInternet) }
                data = try await sync.receiptImageData(key: key)
            }
            image = UIImage(data: data)
            failed = image == nil
        } catch {
            failed = true
        }
    }
}

/// The system camera, for photographing a receipt.
struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
