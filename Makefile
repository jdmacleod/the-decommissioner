.PHONY: dev-backend dev-frontend build install-deps test lint docker-up

BACKEND_DIR = backend
FRONTEND_DIR = frontend
PYTHON = $(BACKEND_DIR)/.venv/bin/python

dev-backend:
	cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd $(FRONTEND_DIR) && npm run dev

build:
	cd $(FRONTEND_DIR) && npm run build

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
	cd $(BACKEND_DIR) && .venv/bin/ruff check app/
	cd $(FRONTEND_DIR) && npx eslint src/

docker-up:
	docker-compose up --build
