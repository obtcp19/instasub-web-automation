'use strict';

/**
 * vector-db/context-api.js
 * --------------------------------------------------------------------------
 * Programmatic Layer 3 retrieval API for the Layer 4 code generator.
 *
 * Exposes a small, stable surface the generator calls automatically before
 * writing any code, so it reuses existing Page Objects, selectors, and
 * helpers instead of inventing new ones (Code Integrity rule: adhere to the
 * DOM selectors already mapped in the repo).
 *
 *   query(text, topK)            -> ranked matches for a single phrase
 *   retrieveContext(queries)     -> deduped, ranked bundle for many phrases
 *   extractSelectors(content)    -> selector strings found in a file
 *   formatContext(bundle)        -> prompt-ready text block
 */

const VectorDB = require('./index.js');

// Reuse one VectorDB instance (and therefore one embedder + connection).
let _db = null;
function db() {
  if (!_db) _db = new VectorDB();
  return _db;
}

/**
 * Semantic search for a single phrase.
 * @param {string} text
 * @param {number} [topK=5]
 * @returns {Promise<Array<{path,fileName,type,content,similarity}>>}
 */
async function query(text, topK = 5) {
  if (!text || !text.trim()) return [];
  return db().query(text, topK);
}

/**
 * Pull selector definitions out of a Playwright file so the generator can
 * point at existing locators rather than guessing new ones.
 * @param {string} content
 * @returns {string[]}
 */
function extractSelectors(content) {
  if (!content) return [];
  const selectors = new Set();
  // Group 1 captures the opening quote so the backreference \1 matches the
  // SAME closing quote — this preserves selectors that nest the other quote,
  // e.g. page.locator('select[data-testid="teacher-select"]').
  const patterns = [
    /\.locator\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
    /getBy(?:Role|Text|Label|TestId|Placeholder|Title|AltText)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) selectors.add(m[2]);
  }
  return Array.from(selectors);
}

function extractExports(content) {
  if (!content) return [];
  const exports = new Set();
  const patterns = [
    /export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /module\.exports\s*=\s*([A-Za-z_$][\w$]*)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) exports.add(match[1]);
  }

  return Array.from(exports);
}

function extractMethods(content) {
  if (!content) return [];
  const methods = new Set();
  const methodPattern = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/gm;
  const ignored = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor']);
  let match;

  while ((match = methodPattern.exec(content)) !== null) {
    if (!ignored.has(match[1])) methods.add(match[1]);
  }

  return Array.from(methods);
}

/**
 * Run several queries, merge and dedupe by file path (keeping the highest
 * similarity), and rank the result. Returns a bundle the generator can act on.
 * @param {string[]} queries
 * @param {number} [topKPerQuery=3]
 * @returns {Promise<{assets:Array, queries:string[]}>}
 */
async function retrieveContext(queries, topKPerQuery = 3) {
  const list = (Array.isArray(queries) ? queries : [queries]).filter(Boolean);
  const byPath = new Map();

  for (const q of list) {
    const hits = await query(q, topKPerQuery);
    for (const hit of hits) {
      const existing = byPath.get(hit.path);
      if (!existing || hit.similarity > existing.similarity) {
        byPath.set(hit.path, {
          path: hit.path,
          fileName: hit.fileName,
          type: hit.type,
          similarity: hit.similarity,
          selectors: extractSelectors(hit.content),
          exports: extractExports(hit.content),
          methods: extractMethods(hit.content),
          contentPreview: String(hit.content || '').slice(0, 2000),
        });
      }
    }
  }

  const assets = Array.from(byPath.values()).sort((a, b) => b.similarity - a.similarity);
  return { assets, queries: list };
}

/**
 * Render a retrieval bundle as a compact, prompt-ready text block.
 * @param {{assets:Array}} bundle
 * @returns {string}
 */
function formatContext(bundle) {
  if (!bundle || bundle.assets.length === 0) {
    return 'No reusable assets found in the vector store. Generate from scratch.';
  }
  const lines = ['Reusable assets from the existing repository (prefer these):', ''];
  for (const asset of bundle.assets) {
    lines.push(`- [${asset.type}] ${asset.fileName}  (${(asset.similarity * 100).toFixed(1)}% match)`);
    lines.push(`  path: ${asset.path}`);
    if (asset.selectors.length) {
      lines.push(`  existing selectors: ${asset.selectors.join(', ')}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  query,
  retrieveContext,
  extractSelectors,
  extractExports,
  extractMethods,
  formatContext,
};
