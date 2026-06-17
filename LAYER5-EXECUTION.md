# Layer 5: QA Execution Runner - Test Orchestration

## Architecture Overview

Layer 5 provides isolated, scalable test execution with multiple deployment modes:

```
┌─────────────────────────────────────────────────────────────┐
│           Layer 5: QA Execution Runner                       │
│  (Playwright/Docker MCP - Isolated Test Environment)         │
└─────────────────────────────────────────────────────────────┘
         │
         ├─ Execution Mode 1: LOCAL (Playwright)
         │  └─ Direct: npx playwright test
         │
         ├─ Execution Mode 2: DOCKER (Isolated Container)
         │  └─ Build image → Run tests → Capture results
         │
         └─ Execution Mode 3: DOCKER COMPOSE (Full Stack)
            └─ Orchestrate: App + DB + Tests
```

## Quick Start

### 1. Local Execution (Fastest)
```bash
npm install
npm run test:ise452
npm run test:report
```

### 2. Docker Execution (Isolated)
```bash
npm run docker:build
npm run docker:run
```

### 3. Docker Compose (Full Stack)
```bash
npm run docker:compose:up
npm run test:report
npm run docker:compose:down
```

## Execution Modes Detailed

### Mode 1: Local Playwright (Development)
**When to use:** Dev iterations, quick feedback

```bash
npm run test:ise452              # Run ISE-452 tests
npm run test:ui                  # Interactive UI mode
npm run test:debug               # Step through tests
npm run test:headed              # See browser window
npm run test:chrome              # Single browser
npm run test:flaky               # Flakiness detection tests only
```

**Pros:** Fast, immediate feedback
**Cons:** System dependencies required (browsers, DB)

### Mode 2: Docker CLI (CI/CD)
**When to use:** CI pipelines, reproducible environments

```bash
npm run docker:build             # Build image once
npm run docker:run               # Execute tests
```

**Dockerfile includes:**
- Microsoft Playwright image (all browsers pre-installed)
- Node.js runtime
- Playwright dependencies
- Headless configuration

**Pros:** Reproducible, isolated, portable
**Cons:** Docker required, slightly slower startup

### Mode 3: Docker Compose (Integration Tests)
**When to use:** Full-stack testing, DB verification

```bash
docker-compose up --abort-on-container-exit --exit-code-from playwright-tests
docker-compose down
```

**Stack includes:**
- Playwright tests (main service)
- PostgreSQL database (for absence verification)
- Network isolation
- Volume mounts for results

**Pros:** Complete environment, DB persistence verification
**Cons:** More resources, slower startup

## Test Execution Flow

```
Layer 5 receives test strategy + code context
       │
       ├─ 1. Setup Environment
       │  ├─ Install dependencies
       │  ├─ Verify browsers installed
       │  └─ Validate configuration
       │
       ├─ 2. Configure Execution
       │  ├─ Set environment variables
       │  ├─ Configure parallelization
       │  └─ Setup reporters (HTML/JSON/JUnit)
       │
       ├─ 3. Execute Tests
       │  ├─ Spin up test container/process
       │  ├─ Run ISE-452-absence-creation.spec.ts
       │  ├─ Capture logs & screenshots
       │  └─ Generate artifacts
       │
       └─ 4. Parse & Report Results
          ├─ JSON: results.json (programmatic)
          ├─ HTML: playwright-report/ (visual)
          ├─ JUnit: junit.xml (CI integration)
          └─ Pass to Layer 6 (Self-Healing)
```

## Test Parallelization

### Default Configuration
```typescript
// playwright.config.ts
fullyParallel: true            // All tests run in parallel
workers: undefined             // Use all CPU cores
retries: 0                      // Immediate fail (not production)
```

### CI Configuration
```typescript
retries: 2                      // Retry flaky tests 2x
workers: 1                      // Sequential (resource constrained)
```

### Configure
```bash
# Override in environment
PLAYWRIGHT_WORKERS=4 npm test
```

## Execution Reports

### 1. HTML Report (Visual)
```bash
npm run test:report
# Opens: playwright-report/index.html
```

**Includes:**
- Test timeline (visual breakdown)
- Screenshots on failure
- Video on failure
- Browser/OS info
- Trace files (time travel debugging)

### 2. JSON Results
```bash
cat test-results/results.json | jq .stats
```

**Provides:**
- Structured test results
- Timing data
- Status per test
- Machine-readable for CI integration

### 3. JUnit XML
```bash
cat test-results/junit.xml
```

**For:**
- Jenkins integration
- Azure DevOps
- GitLab CI
- Xray test reporting

## Environment Variables

### Required
```bash
# Jira Integration (Layer 1)
JIRA_DOMAIN=timeclockplus.atlassian.net
JIRA_USER_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token

# Application Under Test
BASE_URL=http://localhost:3000

# Database (Layer 3 verification)
DATABASE_URL=postgresql://user:password@localhost/testdb
```

### Optional
```bash
CI=true                         # Headless mode
DEBUG=pw:api                   # Playwright debug logs
PLAYWRIGHT_JUNIT_OUTPUT_NAME=junit.xml
PLAYWRIGHT_WORKERS=4           # Parallelization level
```

## Error Handling & Artifacts

### On Test Failure
```
test-results/
├── junit.xml                   # Failed test details
├── results.json               # Structured failure data
└── playwright-report/
    ├── index.html             # Visual report
    ├── [test-name]/           # Per-test folder
    │   ├── test-finished.json
    │   ├── trace.zip          # Time-travel debugging
    │   └── video.webm         # Screen recording
    └── ...
```

### Debugging Failed Tests
```bash
# 1. View HTML report
npm run test:report

# 2. Inspect trace (time-travel debugging)
npx playwright show-trace test-results/trace.zip

# 3. Rerun in UI mode
npm run test:ui

# 4. Rerun with headed browser
npm run test:headed
```

## Integration with Layer 6

Layer 5 outputs for Layer 6 (Self-Healing Engineer):

1. **Execution Logs** → Parsed for flakiness patterns
2. **Test Results JSON** → Structured failure analysis
3. **Screenshots** → Visual selector verification
4. **Video Recordings** → Timing analysis
5. **Trace Files** → Network/DOM state at failure

Layer 6 uses these to:
- Detect race conditions
- Update broken selectors
- Generate self-healing patches
- Create pull requests

## Performance Optimization

### Parallel Execution
```bash
# Default: use all CPU cores
npm run test:ise452

# Override parallelization
PLAYWRIGHT_WORKERS=2 npm test
```

### Selective Testing
```bash
# Run only ISE-452 tests
npm run test:ise452

# Run only flakiness detection tests
npm run test:flaky

# Run specific browser
npm run test:chrome
```

### Network Optimization
- Playwright handles network throttling
- Configure in playwright.config.ts
- DNS caching enabled by default

## Troubleshooting

### Tests hang or timeout
```bash
# Increase timeout
PLAYWRIGHT_TIMEOUT=60000 npm test

# Debug with verbose logging
DEBUG=pw:api npm test
```

### Docker build fails
```bash
# Clean rebuild
docker system prune -a
npm run docker:build
```

### Database connection fails
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Verify connection string
echo $DATABASE_URL
```

### Browser crashes
```bash
# Use single browser
npm run test:chrome

# Use headed mode to see errors
npm run test:headed
```

## CI/CD Integration Examples

### GitHub Actions
```yaml
- run: npm install
- run: npm run test:ise452
- uses: actions/upload-artifact@v3
  if: always()
  with:
    name: playwright-report
    path: playwright-report/
```

### GitLab CI
```yaml
test:
  image: mcr.microsoft.com/playwright:v1.40.0-jammy
  script:
    - npm install
    - npm test
  artifacts:
    reports:
      junit: test-results/junit.xml
```

## Next Steps → Layer 6

Layer 5 completion triggers Layer 6 (Self-Healing Engineer):

```
Layer 5 Results
    │
    ├─ ✅ All tests passed
    │  └─ Report success to Jira/Xray
    │
    └─ ❌ Tests failed
       ├─ Parse failure logs
       ├─ Detect flakiness patterns
       ├─ Update broken selectors
       └─ Create auto-healing PR
```

---

**Status:** Layer 5 Complete ✅
**Next:** Layer 6 - Self-Healing Engineer
