# Deployment & Production Guide

BOZ offers multiple deployment options tailored for local desktop use, remote servers, and containerized cloud environments.

---

## 🚀 1. NPX (Zero Installation)

Run the latest published version of BOZ instantly without permanent installation:

`ash
npx @agr77/boz
`

---

## 💻 2. Global NPM Installation

Install the `boz` binary globally across your system:

`ash
# Install globally
npm install --global @agr77/boz

# Launch anytime from any terminal
boz
`

---

## 🐳 3. Docker & Docker Compose

Deploy the complete Next.js dashboard in an isolated container:

`ash
# Clone repository
git clone https://github.com/AlGhozaliRamadhan/BOZ.git
cd BOZ

# Build and start container
docker compose up --build -d
`

The application will be accessible at http://localhost:3000.

---

## 🏗️ 4. Standalone Next.js Production Build

To build and run from source:

`ash
# 1. Install dependencies
npm install

# 2. Build full package bundle
npm run build:package

# 3. Start production server
npm start
`

---

## 🩺 Health Check & Diagnostics

When running in production, verify health via:
- Dashboard status: http://127.0.0.1:21526/
- CLI version check: `boz --version`
- CLI help: `boz --help`
