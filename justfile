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
    npm run test:mobile

lab-sync:
    uv sync --project scripts/lab --locked

lab-test:
    uv run --project scripts/lab --locked pytest scripts/lab/tests -q

lab-inventory:
    uv run --project scripts/lab --locked quiver-lab inventory --json

lab-inventory-strict:
    uv run --project scripts/lab --locked quiver-lab inventory --strict --json

deploy-connected:
    ./scripts/deploy-connected.sh

check: fmt lint typecheck test lab-test

ci: check
