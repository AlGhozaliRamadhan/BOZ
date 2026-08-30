# Security Policy

## Supported Versions

We actively provide security updates for the following versions of BOZ:

| Version | Supported          |
| ------- | ------------------ |
| 2.4.x   | :white_check_mark: |
| < 2.4.0 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in BOZ, please report it responsibly:

1. **GitHub Private Vulnerability Reporting (Recommended)**:
   Navigate to the [Security Advisories](https://github.com/AlGhozaliRamadhan/BOZ/security/advisories/new) tab on GitHub and submit a private report.
2. **Direct Email**:
   If you cannot use GitHub Advisories, email **[ozatelko@gmail.com](mailto:ozatelko@gmail.com)** with:
   - A description of the vulnerability and its potential impact.
   - Step-by-step instructions or a proof-of-concept to reproduce the issue.
   - Any relevant logs or code snippets.

Please **do not** report security vulnerabilities via public GitHub issues or discussions.

### Response Timeline

- **Initial Acknowledgment**: Within 48 hours.
- **Triage & Status Update**: Within 5 business days.
- **Fix & Disclosure**: We will collaborate with you to release a patch promptly before public disclosure.

## Security Best Practices for Users

- **API Keys & Credentials**: Always store AI backend keys (e.g., OpenAI, GitHub Models, NVIDIA NIM) in your local .env file. Never commit .env or sensitive tokens into Git.
- **Local Network**: By default, oz binds to 127.0.0.1. Do not expose the development or local launcher ports publicly without proper authentication or reverse proxy protection.
