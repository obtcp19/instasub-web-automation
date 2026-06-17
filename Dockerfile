FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Install Playwright browsers
RUN npx playwright install

# Set environment variables for headless execution
ENV CI=true
ENV PLAYWRIGHT_JUNIT_OUTPUT_NAME=test-results/junit.xml

# Expose port for results server (optional)
EXPOSE 3000

# Default command: run tests
CMD ["npm", "run", "test:ui"]
