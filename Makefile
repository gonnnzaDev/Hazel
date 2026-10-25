# Hazel — dev shortcuts
.DEFAULT_GOAL := help
.PHONY: help install setup up down logs stack-up stack-down stack-logs api migrate revision test test-integration lint format typecheck check clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies and create the .venv
	uv sync

setup: ## Full installation (delegates to ./scripts/setup.sh)
	./scripts/setup.sh

up: ## Start PostgreSQL and Kafka (dev compose)
	docker compose -f docker-compose.dev.yml up -d
	@echo "Waiting for the services to be ready..."
	@until docker compose -f docker-compose.dev.yml exec -T postgres \
		pg_isready -U $${POSTGRES_USER:-hazel} >/dev/null 2>&1; do sleep 1; done
	@echo "Ready."

down: ## Stop the services
	docker compose -f docker-compose.dev.yml down

reset: ## Stop the services AND delete the volumes (destructive)
	docker compose -f docker-compose.dev.yml down -v

logs: ## Show the service logs
	docker compose -f docker-compose.dev.yml logs -f

# ─── Fully containerized ──────────────────────────────────────────────────────
stack-up: ## Start node + PostgreSQL + Kafka (all in containers)
	docker compose up -d --build

stack-down: ## Stop the stack
	docker compose down

stack-logs: ## Node logs
	docker compose logs -f api

api: ## Start the API with reload
	uv run python -m core node --reload

migrate: ## Apply migrations
	uv run alembic upgrade head

revision: ## Create a migration: make revision m="message"
	uv run alembic revision --autogenerate -m "$(m)"

test: ## Run the tests (integration ones are skipped without HAZEL_TEST_DATABASE_URL)
	uv run pytest

test-integration: ## Run the tests against a real database (requires PostgreSQL)
	@if [ -z "$(HAZEL_TEST_DATABASE_URL)" ]; then \
		echo "Missing HAZEL_TEST_DATABASE_URL. E.g.:"; \
		echo "  make test-integration HAZEL_TEST_DATABASE_URL=postgresql+asyncpg://hazel:hazel@localhost:5432/hazel_test"; \
		exit 1; \
	fi
	uv run pytest

lint: ## Lint
	uv run ruff check .

format: ## Format
	uv run ruff format .

typecheck: ## Type check
	uv run mypy src

check: lint format typecheck test ## Run everything

clean: ## Clean artifacts
	rm -rf .pytest_cache .mypy_cache .ruff_cache **/__pycache__
	find . -type d -name __pycache__ -prune -exec rm -rf {} +