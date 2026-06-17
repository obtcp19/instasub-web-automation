'use strict';

/**
 * vector-db/index.js
 * --------------------------------------------------------------------------
 * Layer 3 (Context Retrieval) semantic store, backed by LanceDB.
 *
 * Replaces the previous TF-IDF / word-frequency index with a real vector
 * database: files are embedded with a local sentence-transformer (see
 * embeddings.js) and retrieved by cosine similarity, so a query like
 * "dropdown selection helper" can match code that never uses those exact
 * words.
 *
 * Storage: an embedded LanceDB database written to vector-db/.lancedb — no
 * server process, no Docker. The folder should be git-ignored.
 *
 * The public API mirrors the old class (indexDirectory / save / load / query /
 * list) but every method is async because LanceDB I/O is async.
 */

const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');
const { embed, EMBED_DIM } = require('./embeddings');

const DB_DIR = path.join(__dirname, '.lancedb');
const TABLE_NAME = 'code_context';
const INDEXED_EXTENSIONS = ['.ts', '.js'];

class VectorDB {
  constructor() {
    // Documents staged for indexing (filled by indexDirectory, flushed by save).
    this.documents = [];
    this._connection = null;
  }

  async _connect() {
    if (!this._connection) {
      this._connection = await lancedb.connect(DB_DIR);
    }
    return this._connection;
  }

  async _tableExists() {
    const db = await this._connect();
    const names = await db.tableNames();
    return names.includes(TABLE_NAME);
  }

  _getFileType(fileName) {
    if (/page/i.test(fileName)) return 'POM';
    if (/helper|util/i.test(fileName)) return 'Utility';
    if (/\.spec\.|\.test\./i.test(fileName)) return 'Spec';
    return 'Code';
  }

  /**
   * Recursively collect indexable files from a directory into this.documents.
   * Does NOT embed yet — embedding happens in save() so we can batch.
   */
  async indexDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    for (const entry of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, entry);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        await this.indexDirectory(filePath);
      } else if (INDEXED_EXTENSIONS.includes(path.extname(entry))) {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.documents.push({
          id: filePath,
          path: filePath,
          fileName: entry,
          type: this._getFileType(entry),
          content,
        });
      }
    }
  }

  /**
   * Embed every staged document and (re)write the LanceDB table.
   */
  async save() {
    if (this.documents.length === 0) return;

    const rows = [];
    for (const doc of this.documents) {
      // Prepend type + file name so the embedding carries lightweight context.
      const vector = await embed(`${doc.type} ${doc.fileName}\n${doc.content}`);
      if (vector.length !== EMBED_DIM) {
        throw new Error(
          `Embedding dimension mismatch: got ${vector.length}, expected ${EMBED_DIM}`
        );
      }
      rows.push({ ...doc, vector });
    }

    const db = await this._connect();
    await db.createTable(TABLE_NAME, rows, { mode: 'overwrite' });
  }

  /**
   * Load all stored documents back into this.documents (without vectors),
   * so callers can inspect count / list contents.
   */
  async load() {
    if (!(await this._tableExists())) {
      this.documents = [];
      return;
    }
    const db = await this._connect();
    const table = await db.openTable(TABLE_NAME);
    const rows = await table.query().toArray();
    this.documents = rows.map((r) => ({
      id: r.id,
      path: r.path,
      fileName: r.fileName,
      type: r.type,
      content: r.content,
    }));
  }

  /**
   * Semantic search. Returns the top-K most similar documents with a
   * similarity score in [0, 1] (derived from cosine distance).
   */
  async query(searchText, topK = 5) {
    if (!(await this._tableExists())) return [];

    const db = await this._connect();
    const table = await db.openTable(TABLE_NAME);
    const queryVector = await embed(searchText);

    const hits = await table
      .search(queryVector)
      .distanceType('cosine')
      .limit(topK)
      .toArray();

    return hits.map((hit) => ({
      path: hit.path,
      fileName: hit.fileName,
      type: hit.type,
      content: hit.content,
      // cosine distance = 1 - cosine similarity
      similarity: Math.max(0, 1 - hit._distance),
    }));
  }
}

module.exports = VectorDB;
