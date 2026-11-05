/** Starts a download of the file in the browser; it never passes through the server. */
export function saveFile(fileName: string, file: Blob) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // Some browsers start reading the file only after the click returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** Starts a download of the text in the browser; the file never passes through the server. */
export function download(fileName: string, text: string, type = 'text/plain;charset=utf-8') {
  saveFile(fileName, new Blob([text], { type }));
}
