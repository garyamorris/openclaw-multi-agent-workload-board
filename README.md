# OpenClaw Multi-Agent Workload Board

A Cloud Run-friendly multi-agent control surface for visualizing and triggering OpenClaw workflows.

## What it does

- reads live OpenClaw session state through the Gateway HTTP API
- shows hook-backed session cards for workflow roles
- renders a multi-agent workload board with lanes, dependencies, and alerts
- shows handoff flow between roles
- peeks into recent transcript history for live workflow sessions
- exposes action buttons that trigger real OpenClaw runs through `/hooks/agent`

## Required environment

```bash
OPENCLAW_BASE_URL=https://your-openclaw-gateway.example.com
OPENCLAW_TOKEN=your-gateway-token
OPENCLAW_HOOKS_TOKEN=your-dedicated-hooks-token
OPENCLAW_SESSION_KEY=main
PORT=8080
```

Important: a Cloud Run service cannot reach `127.0.0.1` on your laptop or local host. For a live Cloud Run deployment, `OPENCLAW_BASE_URL` must be a remotely reachable OpenClaw gateway URL.

## Local run

```bash
npm install
cp .env.example .env
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
  --project YOUR_PROJECT \
  --allow-unauthenticated \
  --set-env-vars OPENCLAW_BASE_URL=https://YOUR_GATEWAY,OPENCLAW_TOKEN=YOUR_GATEWAY_TOKEN,OPENCLAW_HOOKS_TOKEN=YOUR_HOOKS_TOKEN,OPENCLAW_SESSION_KEY=main
```

## Notes

- board reads state using `/tools/invoke` with `sessions_list`
- action buttons trigger real runs using `/hooks/agent`
- transcript peek uses `GET /sessions/{sessionKey}/history`
