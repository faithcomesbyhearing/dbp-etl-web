# UnicodeScript.py


import io
import math
import unicodedata
from LPTSExtractReader import *

class UnicodeScript:


	def __init__(self):
		self.errors = []


	## Returns a list of files in a bucket of on a local disk.
	def getFilenames(self, s3Client, location, filesetPath):
		results = []
		ignoreSet = {"Thumbs.db"}
		if not location.startswith("s3://"):
			pathname = location + os.sep + filesetPath
			if os.path.isdir(pathname):
				for filename in [f for f in os.listdir(pathname) if not f.startswith('.')]:
					if filename not in ignoreSet and os.path.isfile(pathname + os.sep + filename):
						filepath = pathname + os.sep + filename
						results.append(filepath)
			else:
				self.errors.append("ERROR: Invalid pathname %s" % (pathname,))
		else:
			bucket = location[5:]
			#print("bucket", bucket)
			request = { 'Bucket': bucket, 'MaxKeys': 1000, 'Prefix': filesetPath + "/" }
			response = s3Client.list_objects_v2(**request)
			for item in response.get('Contents', []):
				objKey = item.get('Key')
				results.append(objKey)
			if len(results) == 0:
				self.errors.append("ERROR: Invalid bucket %s or prefix %s/" % (bucket, filesetPath))
		return results


	## Downloads an objects, returns content as an array of lines, but discards first 10 lines
	def readObject(self, s3Client, location, filePath):
		if location.startswith("s3://"):
			s3Bucket = location[5:]
			response = s3Client.get_object(Bucket=s3Bucket, Key=filePath)
			content = response['Body'].read().decode("utf-8")
			lines = content.split("\n") if content != None else []
			lines = lines[10:] # discard first 10 lines
		else:
			file = open(filePath, mode='r', encoding="utf-8")
			lines = file.readlines()
			file.close()
			lines = lines[10:] # discard first 10 lines
		#print("read", lines)
		return lines


	## Parses XML contents and returns an array of characters
	def parseXMLStrings(self, lines):
		text = []
		inText = False
		for line in lines:
			for char in line:
				if char == "<":
					inText = False
				if inText and char.isalpha():
					text.append(char)
				if char == ">":
					inText = True
		return text


	## Converts an array of text string to a array of text chars, which is needed for findScript
	def textToArray(self, contents):
		text = []
		for line in contents:
			for char in line:
				if char.isalpha():
					text.append(char)
		return text


	## Returns the script code of text based upon results returned by unicodedata
	def findScript(self, text):
		scriptSet = {}
		for c in text:
			#print(c, unicodedata.category(c))
			if unicodedata.category(c) in {"Lu", "Ll", "Lo"}:
				name = unicodedata.name(c)
				#print("name", name)
				scriptName = name.split(" ")[0]
				count = scriptSet.get(scriptName, 0)
				count += 1
				scriptSet[scriptName] = count
		#print(scriptSet)
		mostCount = 0
		mostScript = None
		message = []
		totalCount = 0
		for (script, count) in scriptSet.items():
			message.append("%s=%d" % (script, count))
			totalCount += count
			#print("iterate scripts", script, count)
			if count > mostCount:
				mostCount = count
				mostScript = script
		pctMatch = int(scriptSet.get(mostScript) / totalCount * 100.0) if mostScript != None else 0
		if mostScript == "CJK":
			mostScript = "HAN"
		if mostScript == "MYANMAR":
			mostScript = "BURMESE"
		return (mostScript, pctMatch)


	## Compares the actual script determined from text, and the lpts Script
	def matchScripts(self, fileScript, lptsScript):
		if fileScript == None:
			return False
		if lptsScript != None:
			lptsScript = lptsScript.upper()
			lptsScript = lptsScript.split(" ")[0]
		if fileScript == lptsScript:
			return True
		return False



	## This is a convenience method used to check a script using verse_text
	def checkScripts(self, db, filesetId, lptsScript):
		sampleText = self.findVerseText(db, filesetId[:6]) ## can't be in this class
		textList = self.textToArray(sampleText)
		actualScript = self.findScript(textList)
		isMatch = self.matchScripts(actualScript, lptsScript)
		return isMatch
