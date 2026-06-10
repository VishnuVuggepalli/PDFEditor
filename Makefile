.PHONY: test test-backend test-frontend lint lint-backend lint-frontend build build-backend build-frontend up down

test: test-backend test-frontend

test-backend:
	cd backend && go test -race -cover ./...

test-frontend:
	cd frontend && npm test

lint: lint-backend lint-frontend

lint-backend:
	cd backend && test -z "$$(gofmt -l .)" || { echo "gofmt needed:"; gofmt -l .; exit 1; }
	cd backend && go vet ./...
	cd backend && golangci-lint run ./...

lint-frontend:
	cd frontend && npm run lint

build: build-backend build-frontend

build-backend:
	cd backend && go build ./...

build-frontend:
	cd frontend && npm run build

up:
	docker-compose up -d --build

down:
	docker-compose down
