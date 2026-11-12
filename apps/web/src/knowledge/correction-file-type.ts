import {
  type CorrectionFileType,
  correctionFileTypes,
  correctionLimits,
} from '@arca/api-contract/client';

const byExtension: Readonly<Record<string, CorrectionFileType>> = {
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
};

/** What the file picker offers: the extensions and media types a request takes. */
export const correctionFileAccept = ['.pdf', '.html', '.htm', '.txt', ...correctionFileTypes];

/** The extension a downloaded file gets, by its media type. */
export const fileExtensions: Readonly<Record<CorrectionFileType, string>> = {
  'application/pdf': 'pdf',
  'text/html': 'html',
  'text/plain': 'txt',
};

/**
 * The media type a chosen file is sent as: the browser's, when it is one a request takes, else
 * the one its extension names; undefined for any other file, an empty one or one over 16 MB.
 */
export function correctionFileType(
  file: Pick<File, 'name' | 'type' | 'size'>,
): CorrectionFileType | undefined {
  if (file.size === 0 || file.size > correctionLimits.fileBytes) return undefined;
  const declared = correctionFileTypes.find((type) => type === file.type.split(';')[0]?.trim());
  if (declared !== undefined) return declared;
  if (file.type !== '' && file.type !== 'application/octet-stream') return undefined;
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  return byExtension[extension];
}
