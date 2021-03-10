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
> aws s3 sync dist s3://$(ORIGIN_BUCKET) --delete
> aws cloudfront create-invalidation --distribution-id '$(DISTRIBUTION_ID)' --paths '/*'
> aws cloudfront get-distribution --id '$(DISTRIBUTION_ID)' | jq -r '.Distribution.DomainName'

.PHONY: clean
clean:
> rm -rf dist node_modules
