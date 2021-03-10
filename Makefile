include boilerplate.mk

.PHONY: all
all: image frontend

submodules := $(patsubst %/Makefile,%,$(wildcard */Makefile))

.PHONY: $(submodules)
$(submodules):
> $(MAKE) -C $@
