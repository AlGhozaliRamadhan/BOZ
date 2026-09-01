# Deployment & Production Guide

BOZ is currently designed for single-user, local-first deployment. Remote and multi-user deployment is unsupported until authentication, authorization, and tenant-safe credential storage are implemented.

---

## 🚀 1. NPX (Zero Installation)

Run the latest published version of BOZ instantly without permanent installation:

```bash
npx @agr77/boz
```

---

## 💻 2. Global NPM Installation

Install the `boz` binary globally across your system:

```bash
# Install globally
npm install --global @agr77/boz

# Launch anytime from any terminal
boz
```

---

## 🐳 3. Docker & Docker Compose

Deploy the complete Next.js dashboard in an isolated container:

```bash
# Clone repository
git clone https://github.com/AlGhozaliRamadhan/BOZ.git
cd BOZ

# Build and start container
docker compose up --build -d
```

The application will be accessible at http://localhost:3000.

The Compose port is bound to `127.0.0.1` on the host. Do not change it to a public bind address unless BOZ is placed behind an authenticated gateway and the remaining network-deployment risks in `docs/CODEBASE_AUDIT.md` have been addressed.

---

## 🏗️ 4. Standalone Next.js Production Build

To build and run from source:

```bash
# 1. Install dependencies
npm ci

# 2. Build full package bundle
npm run build:package

# 3. Start production server
npm start
```

---

## 🩺 Health Check & Diagnostics

When running in production, verify health via:
- Dashboard status: http://127.0.0.1:21526/
- CLI version check: `boz --version`
- CLI help: `boz --help`
