# DBP-ETL Web

## Architecture

DBP-ETL Web is a frontend which allows users to run `dbp-etl` in AWS ECS tasks. Everything is managed by the React frontend using the AWS SDK with credentials which are attained from Cognito. This includes uploading files to S3, triggering ECS tasks, and monitoring the status and S3 artifacts of running/completed tasks.

## Deploy

### Frontend

Output variables which begin with `ui_` from Terraform are used in the `frontend/.env` file following the naming in the `frontend/.env.example` file.

The `distribution_id` and `origin_bucket` output variables need to be placed in `frontend/Makefile` in order to use Make to build and deploy the frontend code.

### Image

The `image/Makefile` file is used to build the `dbp-etl` Docker image and push it to ECR. This depends on the `ecr_url` variable from Terraform.

## Validate Lambda

The code in the `validate` directory is pulled from `dbp-etl`. `Handler.py` is a new file which is used as the entrypoint to the Lambda function. All these files are zipped into `lambda.zip` and used in the Terraform module.
