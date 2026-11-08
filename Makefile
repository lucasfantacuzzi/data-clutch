# On Linux the webkit2gtk-4.1 build tag is required for every wails/go command.
TAGS ?= webkit2_41

.PHONY: dev build test vet check frontend-test docker-up docker-down

dev:
	wails dev -tags $(TAGS)

build:
	wails build -tags $(TAGS)

test:
	go test -race -tags $(TAGS) ./...

vet:
	go vet -tags $(TAGS) ./...

frontend-test:
	cd frontend && npx tsc --noEmit && npm test

# everything CI runs, minus govulncheck
check: vet test frontend-test

docker-up:
	docker compose up -d

docker-down:
	docker compose down
