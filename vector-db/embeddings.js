'use strict';

/**
 * embeddings.js
 * --------------------------------------------------------------------------
 * Local sentence-embedding provider for the Layer 3 vector store.
 *
 * Runs entirely on the machine via transformers.js (no API key, no network
 * after the first model download). Model: Xenova/all-MiniLM-L6-v2, which
 * produces L2-normalized 384-dimensional vectors — a good default for code
 * and short-text semantic search.
 *
 * The model weights (~90 MB) download once on first use and are cached under
 * node_modules/@xenova/transformers/.cache (or HF_HOME if set).
 */

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384;

let _embedderPromise = null;

// transformers.js is ESM-only; load it via dynamic import so this CommonJS
// module can use it. The pipeline is created once and reused.
async function getEmbedder() {
  if (!_embedderPromise) {
    _embedderPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', MODEL_ID);
    })();
  }
  return _embedderPromise;
}

/**
 * Embed a single string into a 384-dim, L2-normalized vector.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text || '', { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Embed many strings sequentially. Kept simple and memory-friendly for the
 * modest corpus sizes Layer 3 deals with (POMs, utilities, specs).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const vectors = [];
  for (const text of texts) {
    vectors.push(await embed(text));
  }
  return vectors;
}

module.exports = { embed, embedBatch, EMBED_DIM, MODEL_ID };
