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
          fields: 'summary,description,status,priority,assignee,labels,created,updated',
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
    const pairwiseScenarios = this._extractPairwiseScenarios(descriptionDoc);

    return {
      ticket: key,
      title: fields.summary,
      priority: fields.priority?.name || 'Medium',
      status: fields.status?.name || 'Open',
      assignee: fields.assignee?.displayName || 'Unassigned',
      created: fields.created,
      updated: fields.updated,
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
    if (!Array.isArray(node.content)) return '';

    const separator = ['doc', 'paragraph', 'heading', 'listItem', 'bulletList', 'tableRow'].includes(node.type)
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

  _extractPairwiseScenarios(descObj) {
    if (!descObj || typeof descObj === 'string') return [];

    const tables = [];
    this._walkDoc(descObj, node => {
      if (node.type === 'table') tables.push(node);
    });

    return tables.flatMap(table => this._extractScenarioRowsFromTable(table));
  }

  _extractScenarioRowsFromTable(table) {
    const rows = table.content || [];
    if (rows.length < 2) return [];

    const headers = this._tableCells(rows[0]).map(cell => this._nodeText(cell));
    const durationHeader = headers.includes('Duration') ? 'Duration' : headers.includes('Class Time') ? 'Class Time' : null;
    if (!headers.includes('#') || !headers.includes('Reason') || !durationHeader) {
      return [];
    }

    return rows
      .slice(1)
      .map(row => {
        const values = this._tableCells(row).map(cell => this._nodeText(cell));
        const data = Object.fromEntries(headers.map((header, idx) => [header, values[idx] || '']));
        return {
          id: data['#'],
          date: data.Date,
          reason: data.Reason,
          duration: data[durationHeader],
          subPreference: data['Sub Preference'],
          subSelected: data['Sub Selected'],
          result: data.Result,
        };
      })
      .filter(scenario => /^T\d+$/i.test(scenario.id));
  }

  _tableCells(row) {
    return (row.content || []).filter(cell => ['tableHeader', 'tableCell'].includes(cell.type));
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
    return criteria.length > 0
      ? criteria
      : [
      'Given valid absence data, When submitted, Then record persists',
      'Given missing required fields, When submitted, Then validation error shown',
      'Given past date, When submitted, Then rejection error shown',
      'Given confirmation number returned, Then system displays it to user',
    ];
  }

  _extractTestableItems(description, pairwiseScenarios = []) {
    if (pairwiseScenarios.length > 0) {
      return pairwiseScenarios.map(
        scenario =>
          `${scenario.id}: ${scenario.reason} / ${scenario.duration} / ${scenario.subPreference} on ${scenario.date}`
      );
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

main();
