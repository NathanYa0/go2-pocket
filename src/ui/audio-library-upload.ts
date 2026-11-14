import forge from 'node-forge';

/** Audiohub's file checksum is over raw WAV bytes; block sizes are base64 lengths.
 * Wire format: unitree_webrtc_connect/webrtc_audiohub.py upload_audio_file.
 */
export async function uploadLibraryWav(wav: ArrayBuffer, name: string, options: {
  request(api: number, payload: string): Promise<unknown>;
  check?(): void;
  progress?(percent: number): void;
}): Promise<void> {
  options.check?.();
  const bytes = new Uint8Array(wav);
  if (bytes.length <= 44 || bytes.length > 10 * 1024 * 1024) throw new Error('Audio must contain sound and fit Go2’s 10 MB limit.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const checksum = forge.md.md5.create().update(binary, 'raw').digest().toHex();
  const encoded = btoa(binary);
  const blockSize = 4096;
  const blocks = Math.ceil(encoded.length / blockSize);
  const created = Date.now();
  options.progress?.(0);
  for (let index = 0; index < blocks; index++) {
    options.check?.();
    const block = encoded.slice(index * blockSize, (index + 1) * blockSize);
    await options.request(2001, JSON.stringify({
      file_name: name, file_type: 'wav', file_size: bytes.length,
      file_md5: checksum, create_time: created,
      current_block_index: index + 1, total_block_number: blocks,
      block_content: block, current_block_size: block.length,
    }));
    options.check?.();
    options.progress?.(Math.round((index + 1) / blocks * 100));
  }
}
