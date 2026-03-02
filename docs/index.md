# mcp-copilot-acp Documentation

Last updated: 2026-03-02

## Contents

- [Tech Spec](./tech-specs/tech-spec.xml) — Full technical specification including requirements, design, and implementation plan

## Overview

mcp-copilot-acp is an MCP server that bridges Claude Code to GitHub Copilot via the Agent Client Protocol (ACP). It exposes 6 MCP tools for one-shot prompts, persistent sessions, output comparison, and status monitoring.

## Key References

- [README](../README.md) — Installation, configuration, and usage
- [CHANGELOG](../CHANGELOG.md) — Version history and notable changes
- [ACP Protocol](https://agentclientprotocol.com/protocol/overview) — Agent Client Protocol specification
- [MCP SDK](https://ts.sdk.modelcontextprotocol.io/) — Model Context Protocol TypeScript SDK
- [Copilot ACP Docs](https://docs.github.com/en/copilot/reference/acp-server) — GitHub Copilot ACP server reference
