// Browser-only helpers for export/import. No network, no storage APIs — downloads use a transient blob URL.

const BOM = '﻿';

/** Prefix the UTF-8 byte-order mark when requested (spreadsheet apps then open CSV as UTF-8). Never doubles it. */
export function withBom(text: string, bom: boolean | undefined): string {
  return bom && !text.startsWith(BOM) ? BOM + text : text;
}

export function downloadText(filename: string, text: string, mime = 'application/json', opts?: { bom?: boolean }): void {
  const blob = new Blob([withBom(text, opts?.bom)], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readTextFile(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`File is ${file.size} bytes; the limit is ${maxBytes} bytes.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}
