.PHONY: dev web api install

# Run the Next.js frontend and the C++ backend together (Ctrl-C stops both)
dev: .env.local backend/.env
	@$(MAKE) -j2 web api

# Next.js frontend on http://localhost:3000
web: .env.local
	npm run dev

# C++ backend on http://localhost:8080 (builds first)
api: backend/.env
	npm run dev:api

install:
	npm install

.env.local backend/.env:
	@echo "Missing $@ — create it before running (see CLAUDE.md / backend/.env.example)" && exit 1
