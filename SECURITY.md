# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue.
2. Email **hamidfzm@gmail.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You will receive a response within 48 hours.

We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Telemetry & Data Collection

Glyph is local-first. Your documents are processed on your machine and are never uploaded.

Crash and error reporting is **opt-in and off by default**, powered by [Sentry](https://sentry.io).

- **Disabled until you choose otherwise.** No data is sent until you enable **Settings → Privacy → Send crash reports**.
- **Production only.** Reporting never runs in development builds, even if the toggle is on.
- **What is collected:** stack traces, operating system, Glyph version, and the error message.
- **What is never collected:** file contents, file paths, file names, document text, and links. These are scrubbed from every event (message, exception values, breadcrumbs, and stack-frame paths) before it leaves your machine, on both the frontend and the Rust backend. IP address collection and session replay are disabled.
- **Opting out:** turn the same setting off at any time. The reporter is torn down immediately and nothing further is sent.

The reports are sent to the Glyph project on Sentry. Source maps are uploaded at release time so stack traces are readable, but they are not shipped to users.
