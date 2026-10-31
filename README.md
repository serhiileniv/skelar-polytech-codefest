# Skelar Polytech Codefest — AI Customer Support Automation

Pitch: TBD. Brief: [`docs/brief/brief.md`](docs/brief/brief.md).

```bash
# Frontend (mock mode: no backend needed)
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_MODE=http to use the Go API
pnpm install
pnpm dev                     # http://localhost:3000
pnpm test
```

Backend: see `backend/` (root `.env.example` holds `ANTHROPIC_API_KEY`).
