# Authenticate

The `authenticate.ts` script is used to retrieve tokens which can be
used by the backfill script. It required having the correct clientId
and clientSecret (from the `dbp-etl` Google Cloud project Oauth2
client).

Running it will open the user's browser and prompt them to login to a
Google account and then select a YouTube brand account if multiple are
available. (Select the `Bible.is` brand account.)

# Backfill

The backfill script fetches all the existing YouTube videos on the
`Bible.is` channel (using the
[playlist](https://www.youtube.com/playlist?list=UUJv_YIczGnZTuvwyvKsvx6A)).
It then fetches the `fileDetails` for each video in order to find the originally uploaded `fileName`.

It also finds all the `bible_files` entries in the DBP database with `%_stream.m3u8` `file_name` values.

It will loop through all of the `fileDetails` from YouTube and insert `bible_file_tags` DBP entries for any that have a matching file name in `bible_files`.

Note: The `_stream.m3u8` file name suffix is replaced with `.mp4` when comparing with the file name in YouTube.

# Improvements

Eventually, all of the file names in YouTube which don't have exact matches in `bible_files` will have to be matched via some sort of manual process. Theoretically this process could accept a playlist ID from YouTube and a filesetId. This would allow it to get all of the videos in the playlist and match them against the `bible_files` associated with the fileset, matching each based on the video title's chapter and verses. If these videos in YouTube aren't matched with tags in DBP, they will eventually be uploaded as duplicated to YouTube.
