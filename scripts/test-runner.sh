#!/bin/bash

# Layer 5: QA Execution Runner - Test Orchestration Script
# Supports: Docker Compose, Docker CLI, Local execution

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_RESULTS_DIR="$PROJECT_ROOT/test-results"
REPORT_DIR="$PROJECT_ROOT/playwright-report"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LAYER 5: QA EXECUTION RUNNER         ║${NC}"
echo -e "${BLUE}║   Playwright Test Orchestrator         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

# Check prerequisites
check_prerequisites() {
  echo -e "${BLUE}🔍 Checking environment prerequisites...${NC}\n"

  local missing=0

  if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    missing=1
  else
    echo -e "${GREEN}✅ Node.js $(node --version)${NC}"
  fi

  if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    missing=1
  else
    echo -e "${GREEN}✅ npm $(npm --version)${NC}"
  fi

  if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker not found (can still run locally)${NC}"
  else
    echo -e "${GREEN}✅ Docker $(docker --version)${NC}"
  fi

  echo ""

  if [ $missing -eq 1 ]; then
    echo -e "${RED}❌ Missing required dependencies${NC}"
    exit 1
  fi
}

# Setup test directories
setup_directories() {
  mkdir -p "$TEST_RESULTS_DIR"
  mkdir -p "$REPORT_DIR"
  echo -e "${GREEN}✅ Test directories ready${NC}"
}

# Install dependencies
install_dependencies() {
  echo -e "${BLUE}📦 Installing dependencies...${NC}"
  cd "$PROJECT_ROOT"
  npm install --silent 2>/dev/null || npm install
  echo -e "${GREEN}✅ Dependencies installed${NC}\n"
}

# Run tests locally (no Docker)
run_tests_locally() {
  echo -e "${BLUE}🚀 Running tests locally...${NC}\n"

  cd "$PROJECT_ROOT"

  # Run Playwright tests
  npx playwright test \
    --reporter=html \
    --reporter=json \
    --reporter=junit \
    --output="$TEST_RESULTS_DIR" \
    tests/ISE-452-absence-creation.spec.ts || true

  echo ""
}

# Parse and display results
parse_results() {
  echo -e "${BLUE}📊 Parsing Test Results...${NC}\n"

  local results_json="$TEST_RESULTS_DIR/results.json"
  local junit_xml="$TEST_RESULTS_DIR/junit.xml"

  if [ -f "$results_json" ]; then
    echo -e "${GREEN}✅ Test results found${NC}"

    # Parse JSON results (basic parsing)
    local passed=$(grep -o '"status":"passed"' "$results_json" | wc -l)
    local failed=$(grep -o '"status":"failed"' "$results_json" | wc -l)

    echo -e "\n${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         TEST EXECUTION SUMMARY          ║${NC}"
    echo -e "${BLUE}╠════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC} ✅ Passed:    $passed"
    echo -e "${BLUE}║${NC} ❌ Failed:    $failed"
    echo -e "${BLUE}║${NC} 📄 JUnit:     junit.xml"
    echo -e "${BLUE}║${NC} 📊 HTML:      playwright-report/index.html"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"
  else
    echo -e "${YELLOW}⚠️  No results found. Tests may have been skipped.${NC}\n"
  fi
}

# Generate execution report
generate_report() {
  echo -e "${BLUE}📋 Generating execution report...${NC}"

  local report_file="$TEST_RESULTS_DIR/execution-report-${TIMESTAMP}.md"

  cat > "$report_file" <<EOF
# Layer 5: QA Execution Report
**Generated:** $(date)

## Execution Context
- **Ticket:** ISE-452
- **Test Suite:** absence-creation.spec.ts
- **Execution Mode:** Local Playwright

## Test Strategy (Layer 2)
- Positive paths: 1
- Negative paths: 2
- Edge cases: 2
- Flakiness detection: 2

## Execution Environment
- Node.js: $(node --version)
- Playwright: $(npx playwright --version 2>/dev/null || echo "unknown")
- Docker: $(docker --version 2>/dev/null || echo "not available")

## Results
- Test Results: \`results.json\`
- JUnit XML: \`junit.xml\`
- HTML Report: \`playwright-report/index.html\`

## Artifacts
All test results stored in: \`$TEST_RESULTS_DIR\`
EOF

  echo -e "${GREEN}✅ Report saved: $report_file${NC}\n"
}

# Main execution flow
main() {
  check_prerequisites
  setup_directories
  install_dependencies
  run_tests_locally
  parse_results
  generate_report

  echo -e "${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}Layer 5 Execution Complete${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}\n"
}

main "$@"
