FROM alpine:latest AS BiblePublisher

WORKDIR /app

RUN apk update
RUN apk add g++ gcc git make musl-dev npm python2
RUN git clone https://github.com/garygriswold/BiblePublisher
RUN cd BiblePublisher; npm i sqlite3

FROM alpine:latest

WORKDIR /app

RUN apk update
RUN apk add aws-cli ffmpeg jq mysql-client nodejs python3 py3-pip
RUN pip install boto3 pymysql

COPY --from=BiblePublisher /app/BiblePublisher ./BiblePublisher

COPY dbp-etl .

COPY run.sh .
CMD ./run.sh
