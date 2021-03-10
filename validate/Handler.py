import boto3
from LPTSExtractReader import *
from PreValidate import *

def handler(event, context):
	session = boto3.Session()
	s3 = session.client("s3")
	s3.download_file(os.getenv("UPLOAD_BUCKET"), "qry_dbp4_Regular_and_NonDrama.xml", "/tmp/qry_dbp4_Regular_and_NonDrama.xml")
	lptsReader = LPTSExtractReader("/tmp/qry_dbp4_Regular_and_NonDrama.xml")
	validate = PreValidate(lptsReader)
	filesetId = event["prefix"]
	prefix = validate.validateFilesetId(filesetId)
	if prefix != None and len(validate.messages) == 0:
		(typeCode, bibleId) = prefix
		#print(typeCode, bibleId)
		if typeCode == "text":
			filesetId = filesetId[:6]
		validate.validateLPTS(typeCode, bibleId, filesetId)
	validate.printLog(filesetId)
	return validate.messages
