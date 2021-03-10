include ../boilerplate.mk

ECR_URL := ...

.PHONY: image
image:
> aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin $(ECR_URL)
> docker build . -t dbp-etl
> docker tag dbp-etl:latest $(ECR_URL):latest
> docker push $(ECR_URL):latest
