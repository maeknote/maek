export function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

export function bytesToBlobUrl(bytes: ArrayBuffer, mimeType: string): string {
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function inferMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function resolveZipPath(basePath: string, target: string): string {
  const baseSegments = basePath.split("/").slice(0, -1);
  const targetSegments = target.split("/");
  const output = [...baseSegments];

  for (const segment of targetSegments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      output.pop();
      continue;
    }
    output.push(segment);
  }

  return output.join("/");
}

export function getElementsByLocalName(
  root: Document | Element,
  name: string,
): Element[] {
  const elements = root.getElementsByTagName("*");
  return Array.from(elements).filter((element) => element.localName === name);
}

export function getFirstElementByLocalName(
  root: Document | Element,
  name: string,
): Element | null {
  const elements = getElementsByLocalName(root, name);
  return elements[0] ?? null;
}

export function getTextFromDescendants(root: Document | Element): string {
  const textElements = getElementsByLocalName(root, "t");
  return textElements
    .map((element) => element.textContent ?? "")
    .join("")
    .trim();
}
