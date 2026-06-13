.PHONY: install lint format test clean

# Install dependencies
install:
	npm install

# Run app locally
start:
	python3 -m http.server 5500

# Run linters
lint: lint-js lint-css lint-html

lint-js:
	npm run lint

lint-css:
	npm run stylelint

lint-html:
	npm run htmlhint

# Format code
format:
	npm run format

# Run tests
test:
	npm test

# Fix linting issues
fix: fix-js fix-css

fix-js:
	npm run lint:fix

fix-css:
	npm run stylelint:fix

# Clean node_modules
clean:
	rm -rf node_modules package-lock.json