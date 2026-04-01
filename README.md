# Multi-Agent Workload Board

A Cloud Run-friendly control surface for visualizing and triggering OpenClaw multi-agent workflows.

## What it does

- shows workload state as an air-traffic-control style board
- renders task lanes, agent fleet cards, dependencies, alerts, and timeline events
- triggers planner / researcher / builder / reviewer / orchestrator runs through OpenClaw hooks
- inspects live session history when OpenClaw is configured

## Required environment

```bash
OPENCLAW_BASE_URL=https://your-openclaw-gateway.example.com
OPENCLAW_TOKEN=your-gateway-token
OPENCLAW_HOOKS_TOKEN=your-dedicated-hooks-token
OPENCLAW_SESSION_KEY=main
PORT=8080
```

## Local run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Cloud Run

```bash
gcloud run deploy openclaw-multi-agent-workload-board \
  --source . \
  --region europe-west2 \
  --project gen-lang-client-0045607209 \
  --allow-unauthenticated \
  --set-env-vars OPENCLAW_BASE_URL=https://YOUR_GATEWAY,OPENCLAW_TOKEN=YOUR_GATEWAY_TOKEN,OPENCLAW_HOOKS_TOKEN=YOUR_HOOKS_TOKEN,OPENCLAW_SESSION_KEY=main
```
