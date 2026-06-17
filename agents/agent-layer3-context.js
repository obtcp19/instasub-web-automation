#!/usr/bin/env node

/**
 * AGENT LAYER 3: Context Retrieval
 * Queries vector DB for reusable code patterns (generic)
 */

const VectorDB = require('../vector-db/index.js');
const fs = require('fs');
const path = require('path');

class Layer3Agent {
  constructor() {
    this.db = new VectorDB();
    this.projectRoot = path.join(__dirname, '..');
    this.contextDir = path.join(this.projectRoot, 'context');
    this.layer1ContextPath = path.join(this.contextDir, 'layer1-requirements.json');
    this.layer2ContextPath = path.join(this.contextDir, 'layer2-strategy-context.json');
    this.explorerContextPath = path.join(this.contextDir, 'explorer-context.json');
  }

  async retrieve(searchQueries) {
    console.log(`\n📚 LAYER 3 AGENT: Context Retrieval`);
    console.log(`🔍 Searching code repository...\n`);

    await this.db.load();

    if (this.db.documents.length === 0) {
      console.log('⚠️  Vector DB empty. Run: npm run vector-db:index\n');
      return { results: [], indexed: 0 };
    }

    const allResults = [];

    // Search for each query
    const queries = Array.isArray(searchQueries) ? searchQueries : [searchQueries];
    for (const query of queries) {
      const results = await this.db.query(query, 3);
      allResults.push(...results);
    }

    // Deduplicate by path
    const unique = Array.from(
      new Map(allResults.map(r => [r.path, r])).values()
    );

    console.log(`✅ Found: ${unique.length} code files\n`);

    unique.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.type}] ${result.fileName}`);
      console.log(`   Match: ${(result.similarity * 100).toFixed(1)}%`);
    });

    console.log();

    this.saveRetrievalContext(unique, queries, this.db.documents.length);

    return { results: unique, indexed: this.db.documents.length };
  }

  async extractKeywords(requirementsData) {
    console.log(`\n📚 LAYER 3 AGENT: Context Retrieval`);
    console.log(`🔍 Extracting keywords from requirements...\n`);

    const keywords = [];

    if (requirementsData.title) {
      // Parse title for keywords
      const words = requirementsData.title.toLowerCase().split(/\s+/);
      keywords.push(...words.slice(0, 3));
    }

    if (requirementsData.testableItems) {
      // Extract verbs and nouns from testable items
      requirementsData.testableItems.forEach(item => {
        const words = item.toLowerCase().split(/\s+/);
        keywords.push(words[0], words[words.length - 1]);
      });
    }

    // Deduplicate
    const unique = [...new Set(keywords)].filter(k => k.length > 3).slice(0, 5);

    console.log(`✅ Keywords: ${unique.join(', ')}\n`);

    // Query with keywords
    return await this.retrieve(unique);
  }

  loadLayer2Context() {
    if (!fs.existsSync(this.layer2ContextPath)) return null;
    return JSON.parse(fs.readFileSync(this.layer2ContextPath, 'utf-8'));
  }

  loadExplorerContext() {
    if (!fs.existsSync(this.explorerContextPath)) return null;
    return JSON.parse(fs.readFileSync(this.explorerContextPath, 'utf-8'));
  }

  queriesFromLayer2Context(layer2Context, explorerContext = null) {
    if (!layer2Context && !explorerContext) return [];

    const queries = [
      ...(layer2Context?.retrievalQueries || []),
      ...(layer2Context?.codegenHints?.requiredAssertions || []),
      layer2Context?.codegenHints?.executionMode,
      ...(explorerContext?.snapshots?.elements?.buttons || []).map((button) => `button ${button.text} ${button.selector}`),
      ...(explorerContext?.snapshots?.elements?.inputs || []).map((input) => `input ${input.label} ${input.selector}`),
      ...(explorerContext?.snapshots?.elements?.tables || []).map((table) => `table ${table.label} ${table.selector}`),
      ...(explorerContext?.flowDocs?.generatedCases || []).map((testCase) => testCase.title),
    ];

    return Array.from(new Set(queries.filter(Boolean)));
  }

  saveRetrievalContext(results, queries, indexed) {
    fs.mkdirSync(this.contextDir, { recursive: true });

    const payload = {
      layer: 3,
      generatedAt: new Date().toISOString(),
      source: fs.existsSync(this.layer2ContextPath)
        ? 'context/layer2-strategy-context.json'
        : 'manual/default queries',
      explorerCovered: fs.existsSync(this.explorerContextPath),
      explorerContext: fs.existsSync(this.explorerContextPath) ? 'context/explorer-context.json' : null,
      indexed,
      queries,
      assets: results.map((result) => ({
        path: path.relative(this.projectRoot, result.path),
        fileName: result.fileName,
        type: result.type,
        similarity: result.similarity,
      })),
    };

    fs.writeFileSync(
      path.join(this.contextDir, 'layer3-retrieval-context.json'),
      JSON.stringify(payload, null, 2)
    );
    console.log('💾 Saved: context/layer3-retrieval-context.json\n');
  }
}

// CLI Entry Point
async function main() {
  const args = process.argv.slice(2);

  try {
    const agent = new Layer3Agent();

    // Load requirements if available
    const legacyRequirementsPath = path.join(__dirname, '..', 'test-results', 'LAYER1-REQUIREMENTS.json');
    const requirementsPath = fs.existsSync(agent.layer1ContextPath)
      ? agent.layer1ContextPath
      : legacyRequirementsPath;

    const layer2Context = agent.loadLayer2Context();
    const explorerContext = agent.loadExplorerContext();
    const layer2Queries = agent.queriesFromLayer2Context(layer2Context, explorerContext);

    if (layer2Queries.length > 0) {
      console.log(`📎 Using Layer 2/Explorer context queries from context/\n`);
      await agent.retrieve(layer2Queries);
    } else if (fs.existsSync(requirementsPath)) {
      const requirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf-8'));
      await agent.extractKeywords(requirements);
    } else if (args.length > 0) {
      // Manual search from command line
      await agent.retrieve(args);
    } else {
      // Default search
      await agent.retrieve(['absence', 'confirmation', 'teacher']);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
