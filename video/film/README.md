# Launch film

29 seconds, 1920x1080, 30 fps, made with Remotion from real runs.

    node ../capture.mjs        # headless captures from the site's own viewer into public/footage/
    npm install
    npm run studio             # preview
    npm run render             # out/film-silent.mp4

The music track (Coverr, "retro gaming") is licensed for use in the film but not for redistribution, so it is not
in the repo. Add your own at `public/audio/soundtrack.wav` and mux it in with ffmpeg.
