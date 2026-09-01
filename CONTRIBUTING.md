# Contributing to BOZ

Thank you for your interest in improving BOZ! We welcome bug reports, feature suggestions, documentation improvements, and pull requests.

## Development Workflow

### Prerequisites

- Node.js `^22.22.2`, `^24.15.0`, or `>=26.0.0`
- npm with the committed `package-lock.json`

### Getting Started
1. Fork the repository and clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/BOZ.git
   cd BOZ
   ```
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
4. Start development:
   ```bash
   npm run dev:web   # Hot-reloading Next.js web dashboard
   # or
   npm run dev       # Web launcher with Next.js development server
   ```

## Validation & Testing

Before submitting changes, ensure all automated gates pass:

```bash
# 1. Typecheck
npm run typecheck

# 2. Run Test Suite
npm test

# 3. Build Package
npm run build:package
```

## Pull Request Guidelines

1. **Branch Naming**: Use descriptive branch names:
   - fix/<short-description>
   - feat/<short-description>
   - docs/<short-description>
   - chore/<short-description>
2. **Commit Messages**: Follow Conventional Commits format (`feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`).
3. **PR Description**: Fill out the PR template with the change overview, notable changes, and verification steps.
