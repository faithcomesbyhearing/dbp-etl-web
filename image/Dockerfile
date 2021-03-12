FROM alpine:latest AS BiblePublisher

WORKDIR /app

RUN apk update
RUN apk add g++ gcc git make musl-dev npm python2
RUN git clone https://github.com/garygriswold/BiblePublisher
RUN cd BiblePublisher; npm i sqlite3

FROM alpine:latest

WORKDIR /app

RUN echo 'https://dl-cdn.alpinelinux.org/alpine/edge/main' >> /etc/apk/repositories
RUN echo 'https://dl-cdn.alpinelinux.org/alpine/edge/testing' >> /etc/apk/repositories
RUN apk update
RUN apk add aws-cli ffmpeg mysql-client nodejs py3-boto3 py3-pymysql python3

COPY --from=BiblePublisher /app/BiblePublisher ./BiblePublisher

COPY dbp-etl .

COPY run.sh .
CMD ./run.sh
