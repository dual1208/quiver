set shell := ["bash", "-euo", "pipefail", "-c"]

bootstrap:
    npm ci

fmt:
    npm run fmt

lint:
    npm run lint

typecheck:
    npm run typecheck

test:
    npm test

check: fmt lint typecheck test

ci: check
