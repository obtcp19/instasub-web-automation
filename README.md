# InstaSub Web Automation

Enterprise-grade Playwright automation suite for TimeClock Plus. Combines traditional UI testing with AI-driven test orchestration and self-healing capabilities.

## Overview

This project automates end-to-end testing of TimeClock Plus using Playwright, with an advanced 6-layer agent system for intelligent test execution, context management, and self-healing mechanisms.

**Key Features:**
- Playwright-based UI automation across Chrome, Firefox, and WebKit
- 6-layer AI agent orchestration system
- Vector database for test context and embeddings
- Jira integration for ticket tracking
- Self-healing test capabilities
- Docker and Docker Compose support

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Docker (optional, for containerized execution)

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

**Required environment variables:**

*Jira (for ticket fetching):*
- `JIRA_DOMAIN` — Jira instance domain
- `JIRA_USER_EMAIL` — Jira account email
- `JIRA_API_TOKEN` — Jira API token ([create here](https://id.atlassian.com/manage-profile/security/api-tokens))

*GitHub (for Layer 0 PR creation):*
- `GITHUB_TOKEN` — GitHub personal access token ([create here](https://github.com/settings/tokens))
- `GITHUB_OWNER` — GitHub organization or username
- `GITHUB_REPO` — Repository name (e.g., `instasub-web-automation`)

*TimeClock Plus (for test execution):*
- `PW_USERNAME` — Test user account
- `PW_PASSWORD` — Test user password
- `BASE_URL` — Target application URL
- `TICKET_NAME` — Jira ticket identifier
- `ABSENCE_EMPLOYEE_SEARCH` — Employee search term
- `ABSENCE_EMPLOYEE_LABEL` — Employee display label

## Running Tests

### Basic Test Execution

```bash
# Run all tests
npm test

# Run with UI mode (interactive)
npm run test:ui

# Run in headed mode (see browser)
npm run test:headed

# Run in debug mode
npm run test:debug
```

### Browser-Specific Tests

```bash
npm run test:chrome
npm run test:firefox
npm run test:webkit
```

### Issue-Specific Tests

```bash
npm run test:ise452      # Absence creation flow
npm run test:ise1551     # Specific issue test
npm run test:ise1551:headed  # With browser visible
```

### View Test Report

```bash
npm run test:report
```

## Agent Layer System

Seven-layer orchestration system for advanced test automation:

| Layer | Purpose | Command |
|-------|---------|---------|
| **0: Ticket Intake** | Fetch Jira ticket, create feature branch, open draft PR | `npm run agent:layer0` |
| **1: Requirements** | Parse Jira tickets into test requirements | `npm run agent:layer1` |
| **2: Strategy** | Design test strategy from requirements | `npm run agent:layer2` |
| **3: Context** | Retrieve and manage test context | `npm run agent:layer3` |
| **4: Codegen** | Generate test code from strategy | `npm run agent:layer4` |
| **5: Execution** | Execute tests with reporting | `npm run agent:layer5` |
| **6: Self-Healing** | Analyze failures and auto-fix tests | `npm run agent:layer6` |

### Running Agent Pipeline

```bash
# Run complete orchestration (Layers 0-6)
npm run agent:all ISE-1234

# Run individual layers
npm run agent:intake ISE-1234      # Layer 0: Ticket intake & PR
npm run agent:requirements ISE-1234  # Layer 1: Parse requirements
npm run agent:strategy               # Layer 2: Design strategy
npm run agent:context                # Layer 3: Retrieve context
npm run agent:codegen                # Layer 4: Generate code
npm run agent:execution              # Layer 5: Execute tests
npm run agent:selfheal               # Layer 6: Self-healing

# Layer 5 with Docker Compose
npm run test:layer5:compose
```

## Vector Database

Manage test context and embeddings:

```bash
# Index test context
npm run vector-db:index

# Query context
npm run vector-db:query

# List all indexed items
npm run vector-db:list
```

## Jira Integration

```bash
# Fetch tickets and context
npm run jira:fetch
```

## Docker Execution

### Build Image

```bash
npm run docker:build
```

### Run Tests in Container

```bash
npm run docker:run
```

### Docker Compose

```bash
# Start services
npm run docker:compose:up

# Stop services
npm run docker:compose:down
```

## Project Structure

```
instasub-web-automation/
├── pom/                          # Page Object Models
│   ├── AbsenceFormPage.page.ts
│   ├── AbsencePage.page.ts
│   └── ...
├── tests/                        # Test specifications
│   ├── ISE-452-absence-creation.spec.ts
│   ├── ISE-1551.spec.ts
│   ├── ISE-1556.spec.ts
│   ├── ISE-1558.spec.ts
│   └── auth.setup.ts
├── agents/                       # 6-layer AI orchestration
│   ├── agent-layer1-requirements.js
│   ├── agent-layer2-strategy.js
│   ├── agent-layer3-context.js
│   ├── agent-layer4-codegen.js
│   ├── agent-layer5-execution.js
│   ├── agent-layer6-selfheal.js
│   └── orchestrate-all-layers.js
├── context/                      # Test context and strategy files
├── vector-db/                    # Vector database for embeddings
├── layer6/                       # Self-healing and Jira reporting
├── utilities/                    # Helper functions
├── scripts/                      # Build and test scripts
├── playwright.config.ts          # Playwright configuration
├── package.json
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Page Object Models

Tests use the Page Object Model pattern for maintainability:

- **AbsencePage.page.ts** — Absence management page
- **AbsenceFormPage.page.ts** — Absence form interactions
- **AbsenceCreationPage.ts** — Absence creation workflow
- **ISE1551Page.page.ts** — Issue-specific page

## Testing Best Practices

1. **Use Page Objects** — Encapsulate selectors and actions in POM classes
2. **Run Headless First** — Default to headless, use `--headed` for debugging
3. **Isolate Tests** — Use `auth.setup.ts` for authentication setup
4. **Check Reports** — Review Playwright reports after runs
5. **Self-Healing** — Layer 6 auto-fixes tests when selectors break

## Troubleshooting

### Tests Fail with Selector Errors
Run self-healing layer:
```bash
npm run agent:layer6
```

### Jira Token Issues
Verify API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### Docker Build Fails
Ensure Node.js version matches Dockerfile:
```bash
node --version
```

## Contributing

1. Create feature branch from `main`
2. Update tests or add new ones in `tests/`
3. Update POM if selectors change
4. Run full test suite: `npm run test`
5. Create pull request with test results

## License

MIT

## Support

For issues or questions, contact the TCP QA Team.
