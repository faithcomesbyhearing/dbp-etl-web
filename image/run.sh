#!/bin/sh
set -eu

finish() { echo EXECUTION FINISHED; }
trap finish EXIT

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
directory.upload_aws = /app/etl_uploader/upload_aws/
directory.upload = /app/etl_uploader/upload/
directory.database = /app/etl_uploader/database/
directory.complete = /app/etl_uploader/complete/
directory.quarantine = /app/etl_uploader/quarantine/
directory.duplicate = /app/etl_uploader/duplicate/
directory.accepted = /app/etl_uploader/accepted/
directory.transcoded = /app/etl_uploader/transcoded/
directory.errors = /app/etl_uploader/errors/
error.limit.pct = 1.0
directory.bucket_list = /app/etl_uploader/
filename.lpts_xml = /app/etl_uploader/qry_dbp4_Regular_and_NonDrama.xml
filename.accept.errors = /app/etl_uploader/AcceptErrors.txt
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

aws s3 cp --only-show-errors "s3://$UPLOAD_BUCKET/qry_dbp4_Regular_and_NonDrama.xml" etl_uploader/
aws s3 cp --only-show-errors --recursive "s3://$UPLOAD_BUCKET/$S3_KEY_PREFIX" etl_uploader/upload_aws/

python3 load/DBPLoadController.py data
