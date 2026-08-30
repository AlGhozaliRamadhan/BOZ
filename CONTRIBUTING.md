# Contributing to BOZ

Thank you for your interest in improving BOZ! We welcome bug reports, feature suggestions, documentation improvements, and pull requests.

## Development Workflow

### Prerequisites
- Node.js 18 or newer (Node 22, 24, or 26 recommended)
- npm or pnpm

### Getting Started
1. Fork the repository and clone your fork locally:
   `ash
   git clone https://github.com/<your-username>/BOZ.git
   cd BOZ
   `
2. Install dependencies:
   `ash
   npm install
   `
3. Set up environment variables:
   `ash
   cp .env.example .env
   `
4. Start development:
   `ash
   npm run dev:web   # Hot-reloading Next.js web dashboard
   # or
   npm run dev       # Web launcher with Next.js development server
   `

## Validation & Testing

Before submitting changes, ensure all automated gates pass:

`ash
# 1. Typecheck
npm run typecheck

# 2. Run Test Suite
npm test

# 3. Build Package
npm run build:package
`

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names:
   - ix/<short-description>
   - eat/<short-description>
   - docs/<short-description>
   - chore/<short-description>
2. **Commit Messages**: Follow Conventional Commits format (eat: ..., ix: ..., docs: ..., chore: ...).
3. **PR Description**: Fill out the PR template with the change overview, notable changes, and verification steps.
