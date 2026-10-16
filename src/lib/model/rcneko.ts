import { strToU8, unzipSync, zipSync } from 'fflate';

export const RCNEKO_EXTENSION = '.rcneko';
export const RCNEKO_MIME = 'application/x-rcneko';

/** Packs model files into a binary ZIP container saved with the custom .rcneko extension. */
export function packRcneko(files: Record<string, Uint8Array>, name = 'neko') {
  const manifest = { format: 'rcneko', version: 1, created: new Date().toISOString(), files: Object.keys(files) };
  const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)), ...files });
  return { bytes, filename: `${name}${RCNEKO_EXTENSION}` };
}

export function readRcneko(bytes: Uint8Array) { return unzipSync(bytes); }
