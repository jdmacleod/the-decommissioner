.PHONY: dev-backend dev-frontend build install-deps test lint check docker-up

BACKEND_DIR = backend
FRONTEND_DIR = frontend
PYTHON = $(BACKEND_DIR)/.venv/bin/python

# Load .env from project root if present and export all vars to subprocesses.
# This ensures RESTIC_PASSWORD and other env vars reach uvicorn and restic.
-include .env
export

dev-backend:
	cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd $(FRONTEND_DIR) && npm run dev

build:
	cd $(FRONTEND_DIR) && npm run build
	rm -rf $(BACKEND_DIR)/app/static
	cp -r $(FRONTEND_DIR)/dist $(BACKEND_DIR)/app/static

install-deps:
	@echo "==> Installing Python deps"
	cd $(BACKEND_DIR) && uv venv --python 3.11 .venv && uv pip install -r requirements.txt
	@echo "==> Installing Node deps"
	cd $(FRONTEND_DIR) && npm install
	@echo "==> Checking system tools"
	@for tool in restic czkawka_cli jdupes; do \
		if command -v $$tool >/dev/null 2>&1; then \
			echo "  [ok] $$tool"; \
		else \
			echo "  [missing] $$tool"; \
		fi; \
	done

test:
	cd $(BACKEND_DIR) && .venv/bin/pytest

lint:
	cd $(BACKEND_DIR) && ruff check app/ tests/
	cd $(FRONTEND_DIR) && npm run lint

# ── check: all quality gates must pass before merging ────────────────────────
check:
	@echo "==> Backend: ruff format check"
	cd $(BACKEND_DIR) && ruff format --check app/ tests/
	@echo "==> Backend: ruff lint"
	cd $(BACKEND_DIR) && ruff check app/ tests/
	@echo "==> Backend: mypy"
	cd $(BACKEND_DIR) && .venv/bin/mypy app/
	@echo "==> Backend: pytest (90%+ coverage)"
	cd $(BACKEND_DIR) && .venv/bin/pytest
	@echo "==> Frontend: ESLint"
	cd $(FRONTEND_DIR) && npm run lint
	@echo "==> Frontend: TypeScript"
	cd $(FRONTEND_DIR) && npm run typecheck
	@echo "==> Frontend: Vitest (coverage thresholds)"
	cd $(FRONTEND_DIR) && npm run test:coverage
	@echo ""
	@echo "All checks passed."

docker-up:
	docker compose up --build
