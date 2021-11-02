import { strict as assert } from "assert";
import { STS, S3 } from "aws-sdk";
import { google } from "googleapis";
import { knex } from "knex";

const sts = new STS();
const s3 = new S3();
const roleAssumedPromise = process.env.ROLE_ARN && sts.assumeRole({
  RoleArn: process.env.ROLE_ARN!,
  RoleSessionName: "youtube-upload",
}).promise().then(({ Credentials }) => {
  s3.config.update({
    credentials: {
      accessKeyId: Credentials?.AccessKeyId!,
      secretAccessKey: Credentials?.SecretAccessKey!,
      sessionToken: Credentials?.SessionToken!,
      expireTime: Credentials?.Expiration!,
    },
  });
});

const db = knex({
  client: "mysql2",
  connection: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT!),
    user: process.env.DATABASE_USER,
    database: process.env.DATABASE_DB_NAME,
    password: process.env.DATABASE_PASSWD,
  },
});

const youtube = google.youtube("v3");
const oauth2Client = new google.auth.OAuth2({
  clientId: process.env.YOUTUBE_CLIENTID,
  clientSecret: process.env.YOUTUBE_CLIENTSECRET,
  redirectUri: "http://localhost:3000/oauth2callback",
});
oauth2Client.setCredentials({
  access_token: process.env.YOUTUBE_ACCESS_TOKEN,
  refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  scope: "https://www.googleapis.com/auth/youtube",
  token_type: "Bearer",
});
google.options({ auth: oauth2Client });

export const handler = async (event: any) => {
  roleAssumedPromise && await roleAssumedPromise;
  const uploadedFileIds = db("bible_file_tags")
    .select("file_id")
    .where({ "tag": "youtube_video_id" });
  const toBeUploaded = (await db({ file: "bible_files" })
    .whereNotIn("file.id", uploadedFileIds)
    .where({ "fileset.set_type_code": "video_stream" })
    .join({ fileset: "bible_filesets" }, { "fileset.hash_id": "file.hash_id" })
    .join({ copyright: "bible_fileset_copyrights" }, { "copyright.hash_id": "file.hash_id" })
    .join({ connection: "bible_fileset_connections" }, { "connection.hash_id": "fileset.hash_id" })
    .join({ bible: "bibles" }, { "bible.id": "connection.bible_id" })
    .join({ language: "languages" }, { "language.id": "bible.language_id" })
    .leftJoin({ englishLanguageTranslation: "language_translations" }, {
      "englishLanguageTranslation.language_translation_id": 6414,
      "englishLanguageTranslation.language_source_id": "bible.language_id",
    })
    .leftJoin({ languageTranslation: "language_translations" }, {
      "languageTranslation.language_translation_id": "bible.language_id",
      "languageTranslation.language_source_id": "bible.language_id",
      "languageTranslation.priority": 9,
    })
    .join({ bibleTranslation: "bible_translations" }, {
      "bibleTranslation.language_id": 6414,
      "bibleTranslation.bible_id": "bible.id",
    })
    .join({ englishBookTranslation: "book_translations" }, {
      "englishBookTranslation.language_id": 6414,
      "englishBookTranslation.book_id": "file.book_id",
    })
    .leftJoin({ bookTranslation: "book_translations" }, {
      "bookTranslation.language_id": "bible.language_id",
      "bookTranslation.book_id": "file.book_id",
    })
    .where("fileset.updated_at", "<=", db.raw("NOW() - INTERVAL 3 DAY"))
    .orderBy("fileset.updated_at", "desc")
    .orderBy("file.book_id")
    .orderBy("file.chapter_start")
    .orderBy("file.verse_start")
    .select({
      updated: "fileset.updated_at",
      fileId: "file.id",
      fileName: "file.file_name",
      chapterStart: "file.chapter_start",
      chapterEnd: "file.chapter_end",
      verseStart: "file.verse_start",
      verseEnd: "file.verse_end",
      filesetId: "fileset.id",
      copyright: "copyright.copyright",
      bibleId: "bible.id",
      bookId: "file.book_id",
      languageName: "language.name",
      englishLanguageTranslation: "englishLanguageTranslation.name",
      languageTranslation: "languageTranslation.name",
      bibleTranslation: "bibleTranslation.name",
      bookTranslation: "bookTranslation.name",
      englishBookTranslation: "englishBookTranslation.name",
    }))

  const channelTitle = (await youtube.channels.list({ mine: true, part: ["snippet"] })).data.items?.[0].snippet?.title;
  assert(channelTitle);
  console.log(`Uploading videos to ${channelTitle}`);

  const uploadedFilesets: { filesetId: string, bookId: string }[] = [];

  let limit = event.limit ?? (parseInt(process.env.LIMIT!) || Infinity);

  for (const {
    fileId,
    fileName,
    chapterStart,
    chapterEnd,
    verseStart,
    verseEnd,
    filesetId,
    copyright,
    bibleId,
    bookId,
    languageName,
    englishLanguageTranslation,
    languageTranslation,
    bibleTranslation,
    bookTranslation,
    englishBookTranslation,
  } of toBeUploaded) {
    if (limit-- <= 0) break;

    const Bucket = "dbp-vid";
    const Key = `video/${bibleId}/${filesetId}/${fileName.replace("_stream.m3u8", "_web.mp4")}`;
    const exists = s3.headObject({ Bucket, Key }).promise()
      .then(_ => true)
      .catch(_ => false);
    if (!exists) {
      console.log(`Skipping missing S3 object: ${Key}`);
      continue;
    }
    const stream = s3.getObject({ Bucket, Key }).createReadStream();

    assert(chapterStart === chapterEnd || !chapterEnd);
    const title = [
      languageTranslation,
      bookTranslation,
      languageTranslation !== (englishLanguageTranslation || languageName) && (englishLanguageTranslation || languageName),
      `${englishBookTranslation} ${chapterStart}:${verseStart}-${verseEnd}`,
    ].filter(x => x).join(" | ");
    const copyrightText = copyright.replace(/^.+: /gm, "");
    const description = `${bibleTranslation}

${copyrightText}

Playlist URL:
Download App: http://Bible.is
Global Bible Apps: https://play.google.com/store/apps/dev?id=5967784964220500393
Twitter: https://www.twitter.com/bibleis
Facebook: https://www.facebook.com/bibleis
Subscribe: https://www.YouTube.com/user/Bibleis`;
    const categoryId = "29"; // "Nonprofits & Activism"
    const tags = ["Bible.is", "#Bibleis", "#AudioBible", "Faith Comes By Hearing", "Bible App", "Free audio Bible", "Free video Bible"];

    // TODO add alternate names to tags
    // ({ translation: "language_translations" }, {
    //   "translation.language_translation_id": 8012,
    //   "translation.language_source_id": "bible.language_id",
    // })

    try {
      const response = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description, categoryId, tags },
          status: { privacyStatus: "private" }, // public
        },
        media: { body: stream },
      });
      const videoId = response.data.id;
      console.log(`Uploaded https://www.youtube.com/watch?v=${videoId}`);

      await db("bible_file_tags").insert({
        file_id: fileId,
        tag: "youtube_video_id",
        value: videoId,
      }).onConflict().merge();
      console.log(`Tagged ${fileId}`);

      if (!uploadedFilesets.some(f => f.filesetId === filesetId && f.bookId === bookId)) {
        uploadedFilesets.push({ filesetId, bookId });
      }
    } catch (e: any) {
      console.log(`Done Uploading (${e?.errors?.[0]?.message})`)
      break;
    }
  }

  console.log(`Checking playlists for ${JSON.stringify(uploadedFilesets)}`);

  for (const { filesetId, bookId } of [...(event.uploadedFilesets || []), ...uploadedFilesets]) {
    console.log(`Checking if fileset ${filesetId}/${bookId} is completed`);
    const uploadedFileIds = db("bible_file_tags")
      .select("file_id")
      .where({ tag: "youtube_video_id" });
    const fileCount = (await db({ file: "bible_files" })
      .join({ fileset: "bible_filesets" }, { "fileset.hash_id": "file.hash_id" })
      .where({ "fileset.id": filesetId })
      .where({ "file.book_id": bookId })).length
    const uploadedFileCount = (await db({ file: "bible_files" })
      .join({ fileset: "bible_filesets" }, { "fileset.hash_id": "file.hash_id" })
      .where({ "fileset.id": filesetId })
      .where({ "file.book_id": bookId })
      .whereIn("file.id", uploadedFileIds)).length
    const { hashId } = await db("bible_filesets")
      .where({ id: filesetId })
      .select({ hashId: "hash_id" })
      .first();
    if (fileCount > 0 && uploadedFileCount === fileCount) {
      console.log(`Creating playlist for ${filesetId} (${fileCount}/${uploadedFileCount} uploaded)`);

      const {
        englishLanguageTranslation,
        languageTranslation,
        bookTranslation,
        languageName,
        englishBookTranslation,
      } = await db({ fileset: "bible_filesets" })
        .where({ "fileset.id": filesetId })
        .join({ connection: "bible_fileset_connections" }, { "connection.hash_id": "fileset.hash_id" })
        .join({ bible: "bibles" }, { "bible.id": "connection.bible_id" })
        .join({ language: "languages" }, { "language.id": "bible.language_id" })
        .leftJoin({ englishLanguageTranslation: "language_translations" }, {
          "englishLanguageTranslation.language_translation_id": 6414,
          "englishLanguageTranslation.language_source_id": "bible.language_id",
        })
        .leftJoin({ languageTranslation: "language_translations" }, {
          "languageTranslation.language_translation_id": "bible.language_id",
          "languageTranslation.language_source_id": "bible.language_id",
          "languageTranslation.priority": 9,
        })
        .leftJoin({ bookTranslation: "book_translations" }, {
          "bookTranslation.language_id": "bible.language_id",
          "bookTranslation.book_id": db.raw(`'${bookId}'`),
        })
        .join({ englishBookTranslation: "book_translations" }, {
          "englishBookTranslation.language_id": 6414,
          "englishBookTranslation.book_id": db.raw(`'${bookId}'`),
        })
        .select({
          englishLanguageTranslation: "englishLanguageTranslation.name",
          languageTranslation: "languageTranslation.name",
          bookTranslation: "bookTranslation.name",
          languageName: "language.name",
          englishBookTranslation: "englishBookTranslation.name",
        })
        .first();

      const playlistTitle = [
        languageTranslation,
        bookTranslation,
        englishLanguageTranslation || languageName,
        englishBookTranslation,
      ].filter(x => x).join(" | ");

      const playlistId = (await youtube.playlists.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: playlistTitle,
          },
          status: {
            privacyStatus: "private", // public
          }
        },
      })).data.id;
      console.log(`Created playlist ${playlistId} ("${playlistTitle}")`);

      await db("bible_fileset_tags").insert({
        hash_id: hashId,
        name: `youtube_playlist_id:${bookId}`,
        description: playlistId,
        admin_only: 0,
        iso: 'eng',
        language_id: 6414,
      }).onConflict().merge();
      console.log(`Tagged ${filesetId} (hash: ${hashId}) with youtube_playlist_id:${bookId} of ${playlistId}`);

      await new Promise(resolve => setTimeout(resolve, 1000));

      for (const { videoId } of await db({ file: "bible_files" })
        .join({ tag: "bible_file_tags" }, { "tag.file_id": "file.id" })
        .where({ "tag.tag": "youtube_video_id" })
        .join({ fileset: "bible_filesets" }, { "fileset.hash_id": "file.hash_id" })
        .where({ "fileset.id": filesetId })
        .where({ "file.book_id": bookId })
        .select({ videoId: "tag.value" })) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const existingSnippet = (await youtube.videos.list({
          part: ["snippet"],
          id: [videoId],
        })).data.items?.[0]?.snippet;
        console.log(`Found existing video "${existingSnippet?.title}"`);

        if (!existingSnippet) {
          console.log(`ERROR Unable to find video ${videoId}`);
          continue;
        }

        try {
          await youtube.playlistItems.insert({
            part: ["snippet"],
            requestBody: {
              snippet: {
                playlistId,
                resourceId: {
                  kind: "youtube#video",
                  videoId,
                },
              },
            },
          });
          console.log(`Added video ${videoId} to playlist ${playlistId}`);
          await youtube.videos.update({
            part: ["snippet"],
            requestBody: {
              id: videoId,
              snippet: {
                title: existingSnippet.title,
                categoryId: existingSnippet.categoryId,
                description: existingSnippet.description?.replace(/^ +/mg, '').replace(/^Playlist URL:.*$/m, `Playlist URL: https://www.youtube.com/playlist?list=${playlistId}`),
              },
            },
          });
          console.log(`Updated video ${videoId} description with playlist URL`);
        } catch (e) {
          console.log(e);
          console.log(`ERROR Unable to add video ${videoId} to playlist ${playlistId}`);
          console.log(`ERROR Unable to update video ${videoId} description with playlist URL`);
        }
      }
    } else {
      console.log(`Skipping ${filesetId}/${bookId}; only ${uploadedFileCount} uploaded of ${fileCount}`);
    }
  }
}
