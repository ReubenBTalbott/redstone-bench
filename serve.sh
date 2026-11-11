#!/bin/sh
# Headless vanilla server the verifier talks to (local only, RCON 25592). Runs in the foreground;
# launchd keeps it up (~/Library/LaunchAgents/com.adam.redstone-bench-server.plist). Log in server/console.log
cd "$(dirname "$0")/server" || exit 1
exec /opt/homebrew/opt/openjdk/bin/java -Xmx1G -Drsb-server=1 -jar server.jar nogui
