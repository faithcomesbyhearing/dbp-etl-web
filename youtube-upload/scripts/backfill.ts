#!/usr/bin/env -S npx ts-node -Ts

import { google, youtube_v3 } from "googleapis";
import { knex } from "knex";

const db = knex({
  client: "mysql2",
  connection: {
    port: 3310,
    user: "sa",
    database: "dbp_NEWDATA",
    password: "TODO",
  },
});

const youtube = google.youtube("v3");

const oauth2Client = new google.auth.OAuth2({
  clientId: "TODO",
  clientSecret: "TODO",
  redirectUri: "http://localhost:3000/oauth2callback",
});
oauth2Client.setCredentials({
  scope: "https://www.googleapis.com/auth/youtube",
  token_type: "Bearer",
  access_token: "TODO",
  refresh_token: "TODO",
});
google.options({ auth: oauth2Client });

(async () => {
  const videoIds = [];
  let playlistResult;
  do {
    playlistResult = (await youtube.playlistItems.list({
      playlistId: "UUJv_YIczGnZTuvwyvKsvx6A",
      part: ["snippet"],
      maxResults: 50,
      pageToken: playlistResult && playlistResult?.nextPageToken || undefined,
    })).data;
    videoIds.push(...playlistResult.items?.map(x => x.snippet?.resourceId?.videoId).filter((x): x is string => !!x) || [])
    console.log(videoIds.length);
  } while (playlistResult.nextPageToken);

  let start = 0;
  let size = 50;
  const videos: { [index: string]: youtube_v3.Schema$Video & { dbpFileId?: string } } = {};
  do {
    const videosResult = await youtube.videos.list({
      id: videoIds.slice(start, start + size),
      part: ["snippet", "fileDetails"],
    });
    start += size;
    for (const item of videosResult.data.items || []) videos[item.id!] = item;
    console.log(start / videoIds.length);
  } while (start + size < videoIds.length);

  const dbpFiles = (await db("bible_files")
    .where("file_name", "like", "%_stream.m3u8")
    .select("file_name", "id"));

  const bibleFileTags = [];

  for (const [id, video] of Object.entries(videos)) {
    const fileName = video.fileDetails?.fileName;
    if (!fileName) {
      console.log(`ERROR Video ${id} missing fileName`);
      continue;
    }
    const dbpFile = dbpFiles.find(x => x.file_name === fileName.replace(".mp4", "_stream.m3u8"));
    if (dbpFile) {
      video.dbpFileId = dbpFile.id;
      bibleFileTags.push({
        file_id: video.dbpFileId,
        tag: "youtube_video_id",
        value: id,
      });
      console.log(`${video.dbpFileId} -> ${id}`);
    } else {
      console.log(`ERROR Could not find dbpFile for ${fileName} (${id})`);
    }
  }

  if (bibleFileTags.length > 0) {
    console.log(`Inserting ${bibleFileTags.length} file tags`);
    await db("bible_file_tags")
      .insert(bibleFileTags)
      .onConflict()
      .merge();
  }

  process.exit();
})();
