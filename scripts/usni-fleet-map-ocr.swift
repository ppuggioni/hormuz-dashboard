import Foundation
import Vision
import AppKit

struct OcrLine: Codable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OcrPayload: Codable {
  let width: Int
  let height: Int
  let lines: [OcrLine]
}

extension String {
  func normalizedOcrText() -> String {
    self
      .replacingOccurrences(of: "\t", with: " ")
      .replacingOccurrences(of: "\n", with: " ")
      .replacingOccurrences(of: "•", with: "• ")
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

let args = CommandLine.arguments
guard args.count > 1 else {
  fputs("usage: swift usni-fleet-map-ocr.swift <image>\n", stderr)
  exit(1)
}

let imageUrl = URL(fileURLWithPath: args[1])
guard let image = NSImage(contentsOf: imageUrl) else {
  fputs("failed to load image at \(imageUrl.path)\n", stderr)
  exit(2)
}

guard
  let tiffRepresentation = image.tiffRepresentation,
  let bitmap = NSBitmapImageRep(data: tiffRepresentation),
  let cgImage = bitmap.cgImage
else {
  fputs("failed to build CGImage for \(imageUrl.path)\n", stderr)
  exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

let observations = request.results ?? []
var lines: [OcrLine] = []

for observation in observations {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let text = candidate.string.normalizedOcrText()
  guard !text.isEmpty else { continue }
  let box = observation.boundingBox
  lines.append(OcrLine(
    text: text,
    x: box.origin.x,
    y: box.origin.y,
    width: box.size.width,
    height: box.size.height
  ))
}

let payload = OcrPayload(
  width: cgImage.width,
  height: cgImage.height,
  lines: lines
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(payload)
FileHandle.standardOutput.write(data)
