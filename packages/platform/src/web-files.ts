import { requireCapability, type Capabilities } from './capabilities.js';
import type { DocumentCapture, FilePicking } from './files.js';

interface Choice {
  readonly accept?: readonly string[];
  readonly multiple?: boolean;
  readonly capture?: boolean;
}

/** Opens the browser's file chooser; a chooser closed without files resolves empty. */
function chooseFiles(document: Document, choice: Choice): Promise<File[]> {
  const input = document.createElement('input');
  input.type = 'file';
  input.hidden = true;
  if (choice.accept !== undefined) input.accept = choice.accept.join(',');
  input.multiple = choice.multiple ?? false;
  if (choice.capture === true) input.setAttribute('capture', 'environment');
  return new Promise((resolve) => {
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      done([...(input.files ?? [])]);
    });
    input.addEventListener('cancel', () => {
      done([]);
    });
    document.body.append(input);
    input.click();
  });
}

export function createWebFilePicking(
  capabilities: Capabilities,
  document: Document = globalThis.document,
): FilePicking {
  return {
    async pick(options = {}) {
      requireCapability(capabilities, 'filePicking');
      return chooseFiles(document, options);
    },
  };
}

/** The camera where the browser offers it for a file input, otherwise the file chooser. */
export function createWebDocumentCapture(
  capabilities: Capabilities,
  document: Document = globalThis.document,
): DocumentCapture {
  return {
    async capture() {
      requireCapability(capabilities, 'documentCapture');
      const [file] = await chooseFiles(document, {
        accept: ['image/*', 'application/pdf'],
        capture: true,
      });
      return file;
    },
  };
}
