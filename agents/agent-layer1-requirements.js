#!/usr/bin/env node

/**
 * AGENT LAYER 1: Requirements Parser
 * Parses Jira issues and extracts testable requirements
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

class Layer1Agent {
  constructor() {
    this.domain = this._normalizeJiraDomain(process.env.JIRA_DOMAIN);
    this.email = process.env.JIRA_USER_EMAIL;
    this.token = process.env.JIRA_API_TOKEN;

    if (!this.domain || !this.email || !this.token) {
      throw new Error('Missing Jira credentials');
    }

    this.client = axios.create({
      baseURL: `https://${this.domain}/rest/api/3`,
      auth: { username: this.email, password: this.token },
      timeout: 30000,
    });
  }

  _normalizeJiraDomain(domain) {
    return domain?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  async parseIssue(issueKey) {
    console.log(`\n🔍 LAYER 1 AGENT: Requirements Parser`);
    console.log(`📋 Fetching: ${issueKey}\n`);

    try {
      const { data } = await this.client.get(`/issue/${issueKey}`, {
        params: {
          fields: 'summary,description,status,priority,assignee,labels,created,updated,comment,attachment,issuelinks,parent,subtasks',
        },
      });

      const requirements = this._extractRequirements(data);
      this._saveRequirements(issueKey, requirements);

      console.log(`✅ Requirements extracted: ${requirements.businessRequirements.length} items`);
      console.log(`✅ Acceptance criteria: ${requirements.acceptanceCriteria.length} items\n`);

      return requirements;
    } catch (error) {
      console.error('❌ Failed to parse issue:', error.message);
      throw error;
    }
  }

  _extractRequirements(issueData) {
    const { key, fields } = issueData;
    const descriptionDoc = fields.description;
    const description = this._parseDescription(descriptionDoc);
    const detailedContent = this._extractDetailedContent(descriptionDoc, fields);

    // Debug: log description structure
    if (descriptionDoc && typeof descriptionDoc === 'object') {
      console.log(`   🔍 Description type: ${descriptionDoc.type || 'unknown'}`);
      console.log(`   🔍 Description has content: ${!!(descriptionDoc.content && descriptionDoc.content.length)}`);
      if (descriptionDoc.content) {
        const nodeTypes = descriptionDoc.content.map(n => n.type);
        console.log(`   🔍 Node types found: ${[...new Set(nodeTypes)].join(', ')}`);
      }
    }

    const pairwiseScenarios = this._extractPairwiseScenarios(descriptionDoc);

    return {
      ticket: key,
      title: fields.summary,
      priority: fields.priority?.name || 'Medium',
      status: fields.status?.name || 'Open',
      assignee: fields.assignee?.displayName || 'Unassigned',
      created: fields.created,
      updated: fields.updated,
      description,
      detailedContent,
      businessRequirements: this._extractBusinessReqs(description),
      acceptanceCriteria: this._extractAcceptanceCriteria(descriptionDoc, description),
      testableItems: this._extractTestableItems(description, pairwiseScenarios),
      pairwiseScenarios,
      riskFactors: this._detectRiskFactors(description),
    };
  }

  _parseDescription(descObj) {
    if (!descObj) return '';
    if (typeof descObj === 'string') return descObj;

    return this._nodeText(descObj);
  }

  _nodeText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (node.type === 'inlineCard') return node.attrs?.url || '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return node.attrs?.text || node.attrs?.id || '';
    if (node.type === 'emoji') return node.attrs?.shortName || node.attrs?.text || '';
    if (node.type === 'date') return node.attrs?.timestamp ? new Date(Number(node.attrs.timestamp)).toISOString().slice(0, 10) : '';
    if (node.type === 'status') return node.attrs?.text || '';
    if (!Array.isArray(node.content)) return '';

    const separator = ['doc', 'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'tableRow', 'panel', 'expand'].includes(node.type)
      ? '\n'
      : ' ';

    return node.content
      .map(child => this._nodeText(child))
      .filter(Boolean)
      .join(separator)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  _extractDetailedContent(descObj, fields = {}) {
    const descriptionText = this._parseDescription(descObj);
    const tables = [];
    const panels = [];
    const sections = this._extractSections(descObj);
    const wikiSections = this._extractWikiSections(descriptionText);
    const comments = this._extractComments(fields.comment);

    if (descObj && typeof descObj === 'object') {
      this._walkDoc(descObj, node => {
        if (node.type === 'table') tables.push(this._serializeTable(node));
        if (node.type === 'panel') {
          panels.push({
            type: node.attrs?.panelType || 'panel',
            text: this._nodeText(node).replace(/\s+\n/g, '\n').trim(),
          });
        }
      });
    }

    this._extractWikiTables(descriptionText).forEach(table => tables.push(table));

    const allSections = wikiSections.length > 0 ? wikiSections : sections;
    const notes = this._extractLabeledContent('note', allSections, panels, comments);
    const observations = this._extractLabeledContent('observation', allSections, panels, comments);

    return {
      plainText: descriptionText,
      sections: allSections,
      tables,
      panels,
      notes,
      observations,
      comments,
      attachments: (fields.attachment || []).map(attachment => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        content: attachment.content,
      })),
      links: (fields.issuelinks || []).map(link => ({
        id: link.id,
        type: link.type?.name,
        inwardIssue: link.inwardIssue?.key,
        outwardIssue: link.outwardIssue?.key,
      })),
      parent: fields.parent ? { key: fields.parent.key, summary: fields.parent.fields?.summary } : null,
      subtasks: (fields.subtasks || []).map(subtask => ({
        key: subtask.key,
        summary: subtask.fields?.summary,
        status: subtask.fields?.status?.name,
      })),
    };
  }

  _extractWikiSections(text) {
    if (!text || !/^h[1-6]\.\s+/im.test(text)) return [];

    const sections = [];
    let current = { title: 'Description', level: 0, content: [] };

    for (const line of text.split('\n')) {
      const heading = line.match(/^h([1-6])\.\s+(.+)$/i);
      if (heading) {
        if (current.content.length > 0 || current.title !== 'Description') {
          sections.push({
            ...current,
            text: current.content.join('\n').trim(),
          });
        }
        current = {
          title: heading[2].trim(),
          level: Number(heading[1]),
          content: [],
        };
        continue;
      }

      if (line.trim()) current.content.push(line.trim());
    }

    if (current.content.length > 0 || current.title !== 'Description') {
      sections.push({
        ...current,
        text: current.content.join('\n').trim(),
      });
    }

    return sections;
  }

  _extractWikiTables(text) {
    if (!text) return [];

    const tables = [];
    let current = [];

    const flush = () => {
      if (current.length === 0) return;
      const table = this._serializeWikiTable(current);
      if (table.headers.length > 0 || table.rawRows.length > 0) tables.push(table);
      current = [];
    };

    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (/^\|.+\|$/.test(trimmed)) {
        current.push(trimmed);
      } else if (!trimmed && current.length > 0) {
        continue;
      } else {
        flush();
      }
    }
    flush();

    return tables;
  }

  _serializeWikiTable(lines) {
    const rawRows = lines
      .map(line => {
        const isHeader = line.startsWith('||');
        const separator = isHeader ? '||' : '|';
        return line
          .replace(/^\|+|\|+$/g, '')
          .split(separator)
          .map(cell => cell.trim())
          .filter(cell => cell !== '');
      })
      .filter(row => row.length > 0);

    const headerLineIndex = lines.findIndex(line => line.startsWith('||'));
    const headers = headerLineIndex >= 0 ? rawRows[headerLineIndex] : rawRows[0] || [];
    const bodyRows = rawRows.filter((_, index) => index !== headerLineIndex && !(headerLineIndex === -1 && index === 0));

    return {
      source: 'jira-wiki-markup',
      headers,
      rows: bodyRows.map(values => Object.fromEntries(headers.map((header, idx) => [header || `Column ${idx + 1}`, values[idx] || '']))),
      rawRows,
      text: rawRows.map(row => row.join(' | ')).join('\n'),
    };
  }

  _extractSections(descObj) {
    if (!descObj || typeof descObj === 'string' || !Array.isArray(descObj.content)) return [];

    const sections = [];
    let current = { title: 'Description', level: 0, content: [] };

    for (const block of descObj.content) {
      if (block.type === 'heading') {
        if (current.content.length > 0 || current.title !== 'Description') {
          sections.push({
            ...current,
            text: current.content.map(item => item.text).filter(Boolean).join('\n').trim(),
          });
        }
        current = {
          title: this._nodeText(block).replace(/\s+/g, ' ').trim(),
          level: block.attrs?.level || 1,
          content: [],
        };
        continue;
      }

      const text = block.type === 'table'
        ? this._tableToText(block)
        : this._nodeText(block).trim();
      if (text) current.content.push({ type: block.type, text });
    }

    if (current.content.length > 0 || current.title !== 'Description') {
      sections.push({
        ...current,
        text: current.content.map(item => item.text).filter(Boolean).join('\n').trim(),
      });
    }

    return sections;
  }

  _serializeTable(table) {
    const rows = table.content || [];
    const rawRows = rows.map(row => this._tableCells(row).map(cell => this._nodeText(cell).replace(/\s+/g, ' ').trim()));
    const headers = rawRows[0] || [];
    const bodyRows = rawRows.slice(1);

    return {
      headers,
      rows: bodyRows.map(values => Object.fromEntries(headers.map((header, idx) => [header || `Column ${idx + 1}`, values[idx] || '']))),
      rawRows,
      text: this._tableToText(table),
    };
  }

  _tableToText(table) {
    const rawRows = (table.content || []).map(row =>
      this._tableCells(row).map(cell => this._nodeText(cell).replace(/\s+/g, ' ').trim())
    );

    return rawRows
      .map(values => values.join(' | '))
      .filter(Boolean)
      .join('\n');
  }

  _extractComments(commentField) {
    return (commentField?.comments || []).map(comment => ({
      id: comment.id,
      author: comment.author?.displayName || 'Unknown',
      created: comment.created,
      updated: comment.updated,
      body: this._parseDescription(comment.body),
    })).filter(comment => comment.body);
  }

  _extractLabeledContent(label, sections, panels, comments) {
    const labelPattern = new RegExp(`\\b${label}s?\\b`, 'i');
    const inlinePattern = new RegExp(`\\b${label}s?\\s*:\\s*(.+)`, 'i');
    const items = [];

    sections
      .filter(section => labelPattern.test(section.title))
      .forEach(section => items.push({
        source: 'description-section',
        title: section.title,
        text: section.text,
      }));

    panels
      .filter(panel => (label === 'note' && panel.type === 'note') || labelPattern.test(panel.type) || labelPattern.test(panel.text))
      .forEach(panel => items.push({
        source: 'description-panel',
        title: panel.type,
        text: panel.text,
      }));

    comments
      .filter(comment => labelPattern.test(comment.body))
      .forEach(comment => items.push({
        source: 'comment',
        title: `Comment by ${comment.author}`,
        created: comment.created,
        text: comment.body,
      }));

    [...sections.map(section => section.text), ...panels.map(panel => panel.text), ...comments.map(comment => comment.body)]
      .flatMap(text => String(text || '').split('\n'))
      .forEach(line => {
        const match = line.match(inlinePattern);
        if (match?.[1]) {
          items.push({
            source: 'inline-label',
            title: label,
            text: match[1].trim(),
          });
        }
      });

    const seen = new Set();
    return items.filter(item => {
      const key = `${item.source}:${item.title}:${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return item.text;
    });
  }

  _extractPairwiseScenarios(descObj) {
    if (!descObj) return [];

    // Try structured table extraction first
    const tables = [];
    if (typeof descObj === 'object') {
      this._walkDoc(descObj, node => {
        if (node.type === 'table') tables.push(node);
      });
    }

    console.log(`   📊 Found ${tables.length} structured table(s)`);

    let scenarios = tables.flatMap(table => this._extractScenarioRowsFromTable(table));
    console.log(`   📋 Extracted ${scenarios.length} scenarios from structured tables`);

    // Fallback: extract from plain text if no structured tables found
    if (scenarios.length === 0) {
      console.log(`   📝 Falling back to plain text table parsing...`);
      const description = typeof descObj === 'string' ? descObj : this._parseDescription(descObj);
      scenarios = this._extractScenariosFromText(description);
      console.log(`   📋 Extracted ${scenarios.length} scenarios from plain text`);
    }

    return scenarios;
  }

  _extractScenarioRowsFromTable(table) {
    const rows = table.content || [];
    if (rows.length < 2) return [];

    const headers = this._tableCells(rows[0]).map(cell => this._nodeText(cell).trim());

    // Find headers by flexible matching (case-insensitive, partial match)
    const findHeader = (patterns) => {
      return headers.find(h => patterns.some(p => h.toLowerCase().includes(p.toLowerCase())));
    };

    const idHeader = findHeader(['#', 'id', 'test case', 'test']);
    const dateHeader = findHeader(['date']);
    const reasonHeader = findHeader(['reason', 'description', 'scenario']);
    const durationHeader = findHeader(['duration', 'class time', 'time']); // Matches both "Duration" and "Class Time"
    const subPrefHeader = findHeader(['sub preference', 'preference']);
    const subSelHeader = findHeader(['sub selected', 'selected']);
    const resultHeader = findHeader(['result']);

    return rows
      .slice(1)
      .map((row, rowIdx) => {
        const values = this._tableCells(row).map(cell => this._nodeText(cell).trim());
        const data = Object.fromEntries(headers.map((header, idx) => [header, values[idx] || '']));

        // Build scenario: use headers when found, fallback to column index
        const scenario = {
          id: (idHeader && data[idHeader]) || values[0] || `T${rowIdx + 1}`,
          date: (dateHeader && data[dateHeader]) || values[1] || '',
          reason: (reasonHeader && data[reasonHeader]) || values[2] || '',
          duration: (durationHeader && data[durationHeader]) || values[3] || '', // Captures both Duration and Class Time
          subPreference: (subPrefHeader && data[subPrefHeader]) || values[4] || '',
          subSelected: (subSelHeader && data[subSelHeader]) || values[5] || '',
          result: (resultHeader && data[resultHeader]) || values[6] || '',
        };

        // Keep rows with non-empty ID
        return scenario;
      })
      .filter(scenario => scenario.id && scenario.id.trim() !== '');
  }

  _tableCells(row) {
    return (row.content || []).filter(cell => ['tableHeader', 'tableCell'].includes(cell.type));
  }

  _extractScenariosFromText(text) {
    if (!text) return [];

    const wikiScenarios = this._extractWikiTables(text).flatMap(table => this._extractScenarioRowsFromSerializedTable(table));
    if (wikiScenarios.length > 0) return wikiScenarios;

    const scenarios = [];
    // Match lines starting with T followed by digits (test case IDs)
    const testCaseRegex = /^(T\d+)\s+(.+?)$/gm;
    let match;

    while ((match = testCaseRegex.exec(text)) !== null) {
      const id = match[1].trim();
      const restOfLine = match[2].trim();

      // Split by multiple spaces or tabs (common in table-like text)
      const parts = restOfLine.split(/\s{2,}|\t+/).map(p => p.trim()).filter(Boolean);

      scenarios.push({
        id,
        date: parts[0] || '',
        reason: parts[1] || '',
        duration: parts[2] || '', // Handles both Duration and Class Time
        subPreference: parts[3] || '',
        subSelected: parts[4] || '',
        result: parts[5] || '',
      });
    }

    return scenarios;
  }

  _extractScenarioRowsFromSerializedTable(table) {
    const headers = table.headers || [];
    if (headers.length === 0 || !Array.isArray(table.rows)) return [];

    const findHeader = (patterns) => {
      return headers.find(h => patterns.some(p => h.toLowerCase().includes(p.toLowerCase())));
    };

    const idHeader = findHeader(['#', 'id', 'test case', 'test']);
    const dateHeader = findHeader(['date']);
    const reasonHeader = findHeader(['reason', 'description', 'scenario']);
    const durationHeader = findHeader(['duration', 'class time', 'time']);
    const subPrefHeader = findHeader(['sub preference', 'preference']);
    const subSelHeader = findHeader(['sub selected', 'selected']);
    const resultHeader = findHeader(['result']);

    return table.rows
      .map((row, rowIdx) => {
        const values = table.rawRows?.[rowIdx + 1] || [];
        return {
          id: (idHeader && row[idHeader]) || values[0] || `T${rowIdx + 1}`,
          date: (dateHeader && row[dateHeader]) || values[1] || '',
          reason: (reasonHeader && row[reasonHeader]) || values[2] || '',
          duration: (durationHeader && row[durationHeader]) || values[3] || '',
          subPreference: (subPrefHeader && row[subPrefHeader]) || values[4] || '',
          subSelected: (subSelHeader && row[subSelHeader]) || values[5] || '',
          result: (resultHeader && row[resultHeader]) || values[6] || '',
        };
      })
      .filter(scenario => /^T\d+/i.test(scenario.id || ''));
  }

  _walkDoc(node, visitor) {
    visitor(node);
    for (const child of node.content || []) {
      this._walkDoc(child, visitor);
    }
  }

  _extractBusinessReqs(description) {
    const reqs = [];
    const lines = description.split('\n');

    lines.forEach(line => {
      if (line.includes('create') || line.includes('generate') || line.includes('persist')) {
        reqs.push({
          id: `BR-${reqs.length + 1}`,
          description: line.trim(),
          testable: true,
        });
      }
    });

    return reqs.length > 0
      ? reqs
      : [
          {
            id: 'BR-01',
            description: 'System must handle absence creation workflow',
            testable: true,
          },
        ];
  }

  _extractAcceptanceCriteria(descObj, description) {
    const criteria = this._extractBulletsUnderHeading(descObj, 'Acceptance Criteria');
    const wikiCriteria = criteria.length > 0 ? criteria : this._extractLinesUnderWikiHeading(description, 'Acceptance Criteria');
    return criteria.length > 0
      ? criteria
      : wikiCriteria.length > 0
      ? wikiCriteria
      : [
      'Given valid absence data, When submitted, Then record persists',
      'Given missing required fields, When submitted, Then validation error shown',
      'Given past date, When submitted, Then rejection error shown',
      'Given confirmation number returned, Then system displays it to user',
    ];
  }

  _extractTestableItems(description, pairwiseScenarios = []) {
    if (pairwiseScenarios.length > 0) {
      return pairwiseScenarios.map(scenario => {
        const parts = [scenario.id, scenario.reason, scenario.duration, scenario.subPreference, scenario.date]
          .filter(Boolean)
          .join(' / ');
        return parts || scenario.id;
      });
    }

    return [
      'Create absence with valid data',
      'Create absence without required field',
      'Create absence with past date',
      'Verify confirmation number generation',
      'Verify database persistence',
      'Test flakiness (multiple attempts)',
    ];
  }

  _extractBulletsUnderHeading(descObj, headingText) {
    if (!descObj || typeof descObj === 'string' || !Array.isArray(descObj.content)) return [];

    const blocks = descObj.content;
    const headingIndex = blocks.findIndex(
      block => block.type === 'heading' && this._nodeText(block).toLowerCase() === headingText.toLowerCase()
    );
    if (headingIndex === -1) return [];

    const bullets = [];
    for (const block of blocks.slice(headingIndex + 1)) {
      if (block.type === 'heading') break;
      if (block.type !== 'bulletList') continue;

      for (const item of block.content || []) {
        const text = this._nodeText(item).replace(/\s+/g, ' ').trim();
        if (text) bullets.push(text);
      }
    }

    return bullets;
  }

  _extractLinesUnderWikiHeading(text, headingText) {
    if (!text) return [];

    const lines = text.split('\n');
    const headingIndex = lines.findIndex(line => {
      const match = line.trim().match(/^h[1-6]\.\s+(.+)$/i);
      return match && match[1].trim().toLowerCase() === headingText.toLowerCase();
    });
    if (headingIndex === -1) return [];

    const values = [];
    for (const line of lines.slice(headingIndex + 1)) {
      const trimmed = line.trim();
      if (/^h[1-6]\.\s+/i.test(trimmed)) break;
      if (!trimmed || /^\|/.test(trimmed)) continue;
      values.push(trimmed.replace(/^[-*]\s+/, ''));
    }

    return values;
  }

  _detectRiskFactors(description) {
    const risks = [];

    if (description.includes('null') || description.includes('Confirmation Number: null')) {
      risks.push({
        factor: 'Confirmation number generation flakiness',
        severity: 'HIGH',
        likelihood: 'MEDIUM',
      });
    }

    if (description.includes('race') || description.includes('concurrent')) {
      risks.push({
        factor: 'Race condition / async timing',
        severity: 'HIGH',
        likelihood: 'MEDIUM',
      });
    }

    return risks.length > 0
      ? risks
      : [
          {
            factor: 'Async/Promise timeout on confirmation generation',
            severity: 'HIGH',
            likelihood: 'MEDIUM',
          },
        ];
  }

  _saveRequirements(issueKey, requirements) {
    const projectRoot = path.join(__dirname, '..');
    const testResultsDir = path.join(projectRoot, 'test-results');
    const contextDir = path.join(projectRoot, 'context');
    const outputPath = path.join(testResultsDir, 'LAYER1-REQUIREMENTS.json');
    const contextPath = path.join(contextDir, 'layer1-requirements.json');

    fs.mkdirSync(testResultsDir, { recursive: true });
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(requirements, null, 2));
    fs.writeFileSync(contextPath, JSON.stringify(requirements, null, 2));

    console.log(`💾 Saved: test-results/LAYER1-REQUIREMENTS.json`);
    console.log(`💾 Saved: context/layer1-requirements.json\n`);
  }
}

// CLI Entry Point
async function main() {
  const issueKey = process.argv[2] || 'ISE-452';

  try {
    const agent = new Layer1Agent();
    const requirements = await agent.parseIssue(issueKey);

    console.log('📊 Requirements Summary:');
    console.log(`   Priority: ${requirements.priority}`);
    console.log(`   Status: ${requirements.status}`);
    console.log(`   Risks: ${requirements.riskFactors.length}`);
    console.log(`   Testable Items: ${requirements.testableItems.length}\n`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = Layer1Agent;
