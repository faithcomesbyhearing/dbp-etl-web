#!/usr/bin/env -S npx ts-node -Ts

import { google } from "googleapis";
import http from "http";
import open from "open";
import stoppable from "stoppable";
import url from "url";

const oauth2Client = new google.auth.OAuth2({
  clientId: "TODO",
  clientSecret: "TODO",
  redirectUri: "http://localhost:3000/oauth2callback",
});

function authenticate() {
  return new Promise<void>((resolve) => {
    const server = stoppable(http.createServer(async (req, res) => {
      console.log(req.url);
      const searchParams = new url.URL(req.url!, "http://localhost:3000").searchParams;
      const { tokens } = await oauth2Client.getToken(searchParams.get("code")!)
      oauth2Client.setCredentials(tokens);
      google.options({ auth: oauth2Client });
      res.end("Authentication successful");
      console.log(tokens);
      resolve();
      server.stop();
    })).listen(3000, () => {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
          "https://www.googleapis.com/auth/youtube",
          // "https://www.googleapis.com/auth/yt-analytics.readonly",
        ],
      });
      open(authUrl).then(x => x.unref);
    });
  });
}

(async () => {
  await authenticate();
})();
