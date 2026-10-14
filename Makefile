# Recop — atajos de desarrollo
.DEFAULT_GOAL := help
.PHONY: help install setup up down logs stack-up stack-down stack-logs api front mobile migrate revision test test-integration lint format typecheck check clean

help: ## Mostrar esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Instalar dependencias y crear el .venv
	uv sync
	@cp -n .env.example .env 2>/dev/null || true

setup: ## Instalación completa (delega a ./scripts/setup.sh)
	./scripts/setup.sh

up: ## Levantar PostgreSQL y Kafka (compose de desarrollo)
	docker compose -f docker-compose.dev.yml up -d
	@echo "Esperando a que los servicios estén listos..."
	@until docker compose -f docker-compose.dev.yml exec -T postgres \
		pg_isready -U $${POSTGRES_USER:-recop} >/dev/null 2>&1; do sleep 1; done
	@echo "Listo."

down: ## Apagar los servicios
	docker compose -f docker-compose.dev.yml down

reset: ## Apagar los servicios Y borrar los volúmenes (destructivo)
	docker compose -f docker-compose.dev.yml down -v

logs: ## Ver logs de los servicios
	docker compose -f docker-compose.dev.yml logs -f

# ─── Todo containerizado ──────────────────────────────────────────────────────
stack-up: ## Levantar nodo + PostgreSQL + Kafka (todo en containers)
	docker compose up -d --build

stack-down: ## Parar el stack
	docker compose down

stack-logs: ## Logs del nodo
	docker compose logs -f api

api: ## Levantar la API con recarga
	uv run python -m core --reload

front: ## Abrir el cliente de escritorio (Electron)
	@test -d front/node_modules || (cd front && npm install)
	cd front && npm start

mobile: ## Levantar la app móvil (Expo): escaneá el QR con Expo Go
	@test -d mobile/node_modules || (cd mobile && npm install)
	cd mobile && npx expo start

migrate: ## Aplicar migraciones
	uv run alembic upgrade head

revision: ## Crear una migración: make revision m="mensaje"
	uv run alembic revision --autogenerate -m "$(m)"

test: ## Correr los tests (los de integración se omiten sin RECOP_TEST_DATABASE_URL)
	uv run pytest

test-integration: ## Correr los tests contra una base real (requiere PostgreSQL)
	@if [ -z "$(RECOP_TEST_DATABASE_URL)" ]; then \
		echo "Falta RECOP_TEST_DATABASE_URL. Ej:"; \
		echo "  make test-integration RECOP_TEST_DATABASE_URL=postgresql+asyncpg://recop:recop@localhost:5432/recop_test"; \
		exit 1; \
	fi
	uv run pytest

lint: ## Lint
	uv run ruff check .

format: ## Formatear
	uv run ruff format .

typecheck: ## Chequeo de tipos
	uv run mypy apps core

check: lint format typecheck test ## Ejecutar todo

clean: ## Limpiar artefactos
	rm -rf .pytest_cache .mypy_cache .ruff_cache **/__pycache__
	find . -type d -name __pycache__ -prune -exec rm -rf {} +