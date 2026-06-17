#!/usr/bin/env node
/**
 * jira-fetch.js
 * --------------------------------------------------------------------------
 * Connects to the Jira Cloud REST API (v3) using Basic Authentication with an
 * API token, and fetches either a single issue or a list of issues matching a
 * JQL query.
 *
 * Auth model (per Atlassian docs): Basic Auth where the username is the
 * account email and the password is the API token. The header is:
 *   Authorization: Basic base64(email:apiToken)
 *
 * Pagination note: the legacy GET/POST /rest/api/3/search endpoint (startAt /
 * total) was deprecated and removed in 2025. This script uses the current
 * enhanced JQL search endpoint /rest/api/3/search/jql, which paginates with an
 * opaque `nextPageToken` cursor instead of numeric offsets.
 *
 * Usage:
 *   node jira-fetch.js issue ISE-1551
 *   node jira-fetch.js jql "project = ISE AND statusCategory != Done ORDER BY created DESC"
 *   node jira-fetch.js jql "assignee = currentUser()" --max 200
 *
 * Credentials are read from environment variables — never hard-code secrets:
 *   JIRA_DOMAIN      e.g. your-org.atlassian.net  (no protocol)
 *   JIRA_USER_EMAIL  e.g. you@example.com
 *   JIRA_API_TOKEN   create at id.atlassian.com > Security > API tokens
 */

'use strict';

// Load credentials from .env if present (no-op if the file is absent).
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const axios = require('axios');

// --- Configuration --------------------------------------------------------

const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// Only the fields we care about, to keep payloads small and fast.
const DEFAULT_FIELDS = ['summary', 'status', 'assignee', 'description'];

// How many issues to request per page (Jira caps this server-side, commonly 100).
const PAGE_SIZE = 100;

// --- Client setup ----------------------------------------------------------

function buildClient() {
  const missing = [];
  if (!JIRA_DOMAIN) missing.push('JIRA_DOMAIN');
  if (!JIRA_USER_EMAIL) missing.push('JIRA_USER_EMAIL');
  if (!JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Set them before running (see README / .env.example).'
    );
  }

  // Normalize: accept "host", "https://host", or "https://host/" alike.
  const host = JIRA_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  return axios.create({
    baseURL: `https://${host}/rest/api/3`,
    // axios builds the Basic Auth header from this for us.
    auth: { username: JIRA_USER_EMAIL, password: JIRA_API_TOKEN },
    headers: { Accept: 'application/json' },
    timeout: 30000,
    // We handle non-2xx ourselves for clearer messages.
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

// --- Error handling --------------------------------------------------------

function describeError(err, context) {
  if (err.response) {
    const { status } = err.response;
    const apiMessages =
      (err.response.data &&
        (err.response.data.errorMessages || []).concat(
          Object.values(err.response.data.errors || {})
        )) ||
      [];
    const detail = apiMessages.length ? ` — ${apiMessages.join('; ')}` : '';

    switch (status) {
      case 400:
        return `400 Bad Request while ${context}. Check your JQL syntax or field names.${detail}`;
      case 401:
        return `401 Unauthorized while ${context}. Verify JIRA_USER_EMAIL and JIRA_API_TOKEN (the token is the password, not your Atlassian password).${detail}`;
      case 403:
        return `403 Forbidden while ${context}. The account is authenticated but lacks permission for this resource.${detail}`;
      case 404:
        return `404 Not Found while ${context}. The issue/key does not exist or you cannot see it.${detail}`;
      case 429:
        return `429 Too Many Requests while ${context}. You are being rate limited — retry after a short delay.${detail}`;
      default:
        return `HTTP ${status} while ${context}.${detail}`;
    }
  }
  if (err.request) {
    return `No response from Jira while ${context}. Check JIRA_DOMAIN and network connectivity.`;
  }
  return `Request setup error while ${context}: ${err.message}`;
}

// --- Operations ------------------------------------------------------------

/**
 * Fetch a single issue by key, returning only the requested fields.
 */
async function fetchIssue(client, issueKey, fields = DEFAULT_FIELDS) {
  try {
    const { data } = await client.get(`/issue/${encodeURIComponent(issueKey)}`, {
      params: { fields: fields.join(',') },
    });
    return data;
  } catch (err) {
    throw new Error(describeError(err, `fetching issue ${issueKey}`));
  }
}

/**
 * Fetch all issues matching a JQL query, following nextPageToken cursors.
 * Stops early once `limit` issues have been collected (0 = no limit).
 */
async function fetchByJql(client, jql, { fields = DEFAULT_FIELDS, limit = 0 } = {}) {
  const results = [];
  let nextPageToken = undefined;

  do {
    let page;
    try {
      const { data } = await client.get('/search/jql', {
        params: {
          jql,
          fields: fields.join(','),
          maxResults: PAGE_SIZE,
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      });
      page = data;
    } catch (err) {
      throw new Error(describeError(err, `running JQL search`));
    }

    for (const issue of page.issues || []) {
      results.push(issue);
      if (limit && results.length >= limit) return results;
    }

    // The enhanced endpoint signals the end with isLast / absence of a token.
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken);

  return results;
}

// --- Output helpers --------------------------------------------------------

function summarize(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || null,
    description: f.description || null,
    status: f.status ? f.status.name : null,
    assignee: f.assignee ? f.assignee.displayName : 'Unassigned',
  };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const positional = [];
  const opts = { max: 0 };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--max') {
      opts.max = parseInt(args[++i], 10) || 0;
    } else {
      positional.push(args[i]);
    }
  }
  return { command, positional, opts };
}

async function main() {
  const { command, positional, opts } = parseArgs(process.argv);
  const client = buildClient();

  if (command === 'issue') {
    const key = positional[0];
    if (!key) throw new Error('Usage: node jira-fetch.js issue <ISSUE-KEY>');
    const issue = await fetchIssue(client, key);
    console.log(JSON.stringify(summarize(issue), null, 2));
    return;
  }

  if (command === 'jql') {
    const jql = positional[0];
    if (!jql) throw new Error('Usage: node jira-fetch.js jql "<JQL>" [--max N]');
    const issues = await fetchByJql(client, jql, { limit: opts.max });
    console.log(`Fetched ${issues.length} issue(s):`);
    console.log(JSON.stringify(issues.map(summarize), null, 2));
    return;
  }

  throw new Error(
    'Unknown command. Use:\n' +
      '  node jira-fetch.js issue <ISSUE-KEY>\n' +
      '  node jira-fetch.js jql "<JQL>" [--max N]'
  );
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
