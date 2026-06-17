#!/usr/bin/env node

const VectorDB = require('./index.js');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const db = new VectorDB();

  if (command === 'index') {
    console.log('🔍 Embedding and indexing POM, utility, and spec files...');
    const pomDir = path.join(__dirname, '../pom');
    const utilDir = path.join(__dirname, '../utilities');
    const testDir = path.join(__dirname, '../tests');

    await db.indexDirectory(pomDir);
    await db.indexDirectory(utilDir);
    await db.indexDirectory(testDir);
    await db.save();

    console.log(`✅ Indexed ${db.documents.length} files`);
    console.log(`📊 Vectors stored in: ${path.join(__dirname, '.lancedb')}`);
    return;
  }

  if (command === 'query') {
    await db.load();

    if (db.documents.length === 0) {
      console.error('❌ No indexed documents. Run: node retriever.js index');
      process.exit(1);
    }

    const query = args.slice(1).join(' ');
    console.log(`🔎 Searching for: "${query}"\n`);

    const results = await db.query(query, 5);

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    results.forEach((result, idx) => {
      console.log(`\n--- Result ${idx + 1} (${(result.similarity * 100).toFixed(1)}% match) ---`);
      console.log(`File: ${result.fileName}`);
      console.log(`Type: ${result.type}`);
      console.log(`Path: ${result.path}`);
      console.log(`Preview: ${result.content.substring(0, 200)}...`);
    });

    return;
  }

  if (command === 'list') {
    await db.load();

    if (db.documents.length === 0) {
      console.log('No indexed documents.');
      return;
    }

    console.log('📚 Indexed Files:');
    db.documents.forEach(doc => {
      console.log(`  [${doc.type}] ${doc.fileName}`);
    });
    return;
  }

  console.log('Usage:');
  console.log('  node retriever.js index                    - Build vector DB index');
  console.log('  node retriever.js query <search-text>      - Query vector DB');
  console.log('  node retriever.js list                     - List all indexed files');
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
