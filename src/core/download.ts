export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  try {
    a.href = url; a.download = filename;
    document.body.append(a); a.click();
  } finally {
    a.remove();
    // Give the browser's download task time to consume the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
