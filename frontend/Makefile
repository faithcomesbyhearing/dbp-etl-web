include ../boilerplate.mk

dist: node_modules $(shell find src) webpack.config.ts .env
> npm run build
> touch -c $@

node_modules: package.json
> npm install
> touch -c $@

DISTRIBUTION_ID := ...
ORIGIN_BUCKET := ...

.PHONY: sync
sync: dist
> aws s3 rm s3://$(ORIGIN_BUCKET) --recursive
> aws s3 cp dist/main.*.js s3://$(ORIGIN_BUCKET) --cache-control 'public, max-age=604800, immutable'
> aws s3 cp dist/index.html s3://$(ORIGIN_BUCKET) --cache-control 'no-store, max-age=0'

.PHONY: clean
clean:
> rm -rf dist node_modules
