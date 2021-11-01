include ../boilerplate.mk

dist: node_modules $(shell find src) webpack.config.ts .env
> npm run build
> touch -c $@

node_modules: package.json
> npm install
> touch -c $@

# DEV
# DISTRIBUTION_ID := E253B8YKTMDS2Q
# ORIGIN_BUCKET := dbp-etl-origin-dev-zrg0q2rhv7shv7hr

# NEWDATA
# DISTRIBUTION_ID := ELSN9V9QXE94I
# ORIGIN_BUCKET := dbp-etl-origin-newdata-fiu49s0cnup1yr0q

.PHONY: sync
sync: dist
> aws s3 rm s3://$(ORIGIN_BUCKET) --recursive
> aws s3 cp dist/main.*.js s3://$(ORIGIN_BUCKET) --cache-control 'public, max-age=604800, immutable'
> aws s3 cp dist/*.svg s3://$(ORIGIN_BUCKET) --cache-control 'public, max-age=604800, immutable'
> aws s3 cp dist/index.html s3://$(ORIGIN_BUCKET) --cache-control 'no-store, max-age=0'

.PHONY: clean
clean:
> rm -rf dist node_modules
