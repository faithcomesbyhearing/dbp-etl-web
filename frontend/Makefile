include ../boilerplate.mk

dist: node_modules $(shell find src) webpack.config.ts .env
> npm run build
> touch -c $@

node_modules: package.json
> npm install
> touch -c $@

# DEV
DISTRIBUTION_ID := E1LWC71B1R7XQY
ORIGIN_BUCKET := dbp-etl-origin-dev-ya1mbvdty8tlq15r

# NEWDATA
# DISTRIBUTION_ID := ELSN9V9QXE94I
# ORIGIN_BUCKET := dbp-etl-origin-newdata-fiu49s0cnup1yr0q

.PHONY: sync
sync: dist
> aws s3 rm s3://$(ORIGIN_BUCKET) --recursive --profile dbp-dev
> aws s3 cp dist/main.*.js s3://$(ORIGIN_BUCKET) --cache-control 'public, max-age=604800, immutable' --profile dbp-dev
> aws s3 cp dist/*.svg s3://$(ORIGIN_BUCKET) --cache-control 'public, max-age=604800, immutable' --profile dbp-dev
> aws s3 cp dist/index.html s3://$(ORIGIN_BUCKET) --cache-control 'no-store, max-age=0' --profile dbp-dev

.PHONY: clean
clean:
> rm -rf dist node_modules
