/**
 * Float32 ↔ Buffer codec for storing embedding vectors as SQLite BLOBs.
 *
 * Layout: little-endian f32 packed back-to-back. 4 bytes per dimension.
 * Matches the format used by RightNow-AI/openfang's semantic store so
 * exporting/importing across implementations would be byte-compatible.
 */

export function embeddingToBuffer(vec: Float32Array): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  const vec = new Float32Array(Math.floor(buf.length / 4));
  for (let i = 0; i < vec.length; i++) {
    vec[i] = buf.readFloatLE(i * 4);
  }
  return vec;
}
