#!/bin/sh
set -eu

finish() {
  echo CLEANUP
  rm -r "/efs/${S3_KEY_PREFIX}"
  echo EXECUTION FINISHED
}
trap finish EXIT

if [ -n "${DBS_AWS_ACCESS_KEY_ID:-}" ] && [ -n "${DBS_AWS_SECRET_ACCESS_KEY:-}" ]; then
  mkdir ~/.aws
  cat > /root/.aws/credentials <<EOF
[dbs]
aws_access_key_id = ${DBS_AWS_ACCESS_KEY_ID}
aws_secret_access_key = ${DBS_AWS_SECRET_ACCESS_KEY}
EOF
fi

cat > /root/dbp-etl.cfg <<EOF
[DEFAULT]
database.user = ${DATABASE_USER}
database.passwd = ${DATABASE_PASSWD}
database.user_db_name = ${DATABASE_USER_DB_NAME}
mysql.exe = /usr/bin/mysql
node.exe = /usr/bin/node
publisher.js = /app/BiblePublisher/publish/Publisher.js
s3.bucket = ${S3_BUCKET}
s3.vid_bucket = ${S3_VID_BUCKET}
s3.artifacts_bucket = ${S3_ARTIFACTS_BUCKET}
$([ -n "${DBS_AWS_ACCESS_KEY_ID:-}" ] && [ -n "${DBS_AWS_SECRET_ACCESS_KEY:-}" ] && echo "s3.aws_profile = dbs")
directory.upload_aws = /efs/${S3_KEY_PREFIX}/etl_uploader/upload_aws/
directory.upload = /efs/${S3_KEY_PREFIX}/etl_uploader/upload/
directory.database = /efs/${S3_KEY_PREFIX}/etl_uploader/database/
directory.complete = /efs/${S3_KEY_PREFIX}/etl_uploader/complete/
directory.quarantine = /efs/${S3_KEY_PREFIX}/etl_uploader/quarantine/
directory.duplicate = /efs/${S3_KEY_PREFIX}/etl_uploader/duplicate/
directory.accepted = /efs/${S3_KEY_PREFIX}/etl_uploader/accepted/
directory.transcoded = /efs/${S3_KEY_PREFIX}/etl_uploader/transcoded/
directory.errors = /efs/${S3_KEY_PREFIX}/etl_uploader/errors/
error.limit.pct = 1.0
directory.bucket_list = /efs/${S3_KEY_PREFIX}/etl_uploader/
filename.lpts_xml = /efs/${S3_KEY_PREFIX}/etl_uploader/qry_dbp4_Regular_and_NonDrama.xml
filename.accept.errors = /efs/${S3_KEY_PREFIX}/etl_uploader/AcceptErrors.txt
filename.datetime = %y-%m-%d-%H-%M-%S
video.transcoder.region = us-west-2
video.transcoder.pipeline = 1537458645466-6z62tx
video.preset.hls.1080p = 1556116949562-tml3vh
video.preset.hls.720p = 1538163744878-tcmmai
video.preset.hls.480p = 1538165037865-dri6c1
video.preset.hls.360p = 1556118465775-ps3fba
video.preset.web = 1351620000001-100070

[data]
database.host = ${DATABASE_HOST}
database.port = ${DATABASE_PORT}
database.db_name = ${DATABASE_DB_NAME}
EOF

mkdir -p "/efs/${S3_KEY_PREFIX}/etl_uploader"
for d in accepted complete database duplicate errors quarantine transcoded upload; do mkdir "/efs/${S3_KEY_PREFIX}/etl_uploader/$d"; done
touch "/efs/${S3_KEY_PREFIX}/etl_uploader/AcceptErrors.txt"

aws s3 cp --no-progress "s3://$UPLOAD_BUCKET/qry_dbp4_Regular_and_NonDrama.xml" "/efs/${S3_KEY_PREFIX}/etl_uploader/"
aws s3 cp --no-progress --recursive "s3://$UPLOAD_BUCKET/${S3_KEY_PREFIX}" "/efs/${S3_KEY_PREFIX}/etl_uploader/upload_aws/"

python3 load/DBPLoadController.py data
