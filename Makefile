# Recop — atajos de desarrollo
.DEFAULT_GOAL := help
.PHONY: help install up down logs api migrate revision test lint format typecheck check clean

help: ## Mostrar esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Instalar dependencias y crear el .venv
	uv sync
	@cp -n .env.example .env 2>/dev/null || true

up: ## Levantar PostgreSQL y Kafka
	docker compose up -d
	@echo "Esperando a que los servicios estén listos..."
	@until docker compose exec -T postgres pg_isready -U $${POSTGRES_USER:-recop} >/dev/null 2>&1; do sleep 1; done
	@echo "Listo."

down: ## Apagar los servicios
	docker compose down

reset: ## Apagar los servicios Y borrar los volúmenes (destructivo)
	docker compose down -v

logs: ## Ver logs de los servicios
	docker compose logs -f

api: ## Levantar la API con recarga
	uv run python -m core --reload

migrate: ## Aplicar migraciones
	uv run alembic upgrade head

revision: ## Crear una migración: make revision m="mensaje"
	uv run alembic revision --autogenerate -m "$(m)"

test: ## Correr los tests
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