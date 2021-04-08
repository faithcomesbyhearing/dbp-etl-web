#!/bin/sh
set -eu

finish() {
  echo CLEANUP
  rm -rf "/efs/${S3_KEY_PREFIX}"
  echo EXECUTION FINISHED
}
trap finish EXIT

if [ -n "${DBS_AWS_ACCESS_KEY_ID:-}" ] && [ -n "${DBS_AWS_SECRET_ACCESS_KEY:-}" ]; then
  mkdir ~/.aws
  cat > /root/.aws/credentials <<EOF
[dbs]
aws_access_key_id=${DBS_AWS_ACCESS_KEY_ID}
aws_secret_access_key=${DBS_AWS_SECRET_ACCESS_KEY}
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
$([ -n "${DBS_AWS_ACCESS_KEY_ID:-}" ] && [ -n "${DBS_AWS_SECRET_ACCESS_KEY:-}" ] && echo "video.aws_profile = dbs")
audio.transcoder.url = https://gig8vjo8p5.execute-api.us-west-2.amazonaws.com/job
audio.transcoder.key = 1b5dc5708ae8d0335afdf94e421ae5f7d772e8f13b003c9d9733bce5caf34c6a
audio.transcoder.sleep.sec = 10
audio.transcoder.input = { "bucket": "\$bucket", "key": "\$prefix" }
audio.transcoder.output.0 = { "bucket": "${S3_BUCKET}", "key": "\$prefix-opus16", "bitrate": 16, "container": "webm", "codec": "opus" }
audio.transcoder.output.1 = { "bucket": "${S3_BUCKET}", "key": "\$prefix-opus32", "bitrate": 32, "container": "webm", "codec": "opus" }
audio.transcoder.output.2 = { "bucket": "${S3_BUCKET}", "key": "\$prefix-opus64", "bitrate": 64, "container": "webm", "codec": "opus" }

[data]
database.host = ${DATABASE_HOST}
database.port = ${DATABASE_PORT}
database.db_name = ${DATABASE_DB_NAME}
EOF


rm -rf "/efs/${S3_KEY_PREFIX}"
mkdir -p "/efs/${S3_KEY_PREFIX}/etl_uploader"
for d in accepted complete database duplicate errors quarantine transcoded upload upload_aws; do mkdir "/efs/${S3_KEY_PREFIX}/etl_uploader/$d"; done
touch "/efs/${S3_KEY_PREFIX}/etl_uploader/AcceptErrors.txt"

aws s3 cp --no-progress "s3://${UPLOAD_BUCKET}/qry_dbp4_Regular_and_NonDrama.xml" "/efs/${S3_KEY_PREFIX}/etl_uploader/"

FILESET_ID=$(aws s3api list-objects-v2 --bucket "${UPLOAD_BUCKET}" --prefix "${S3_KEY_PREFIX}/" --delimiter / | jq -r '.CommonPrefixes[0].Prefix | split("/")[1]')

echo "Running load/DBPLoadController.py against s3://${UPLOAD_BUCKET} and ${S3_KEY_PREFIX}/${FILESET_ID}"
python3 load/DBPLoadController.py data "s3://${UPLOAD_BUCKET}" "${S3_KEY_PREFIX}/${FILESET_ID}"
