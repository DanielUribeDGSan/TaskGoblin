#!/bin/bash

# Configuration
APP_BUNDLE_ID="com.taskgoblin.app"
APP_NAME="TaskGoblin"

echo "🛠️  Resetting macOS Permissions for $APP_NAME ($APP_BUNDLE_ID)..."

# 1. Reset Accessibility permissions
echo "🔹 Resetting Accessibility..."
tccutil reset Accessibility $APP_BUNDLE_ID

# 2. Reset Screen Recording permissions
echo "🔹 Resetting Screen Recording..."
tccutil reset ScreenCapture $APP_BUNDLE_ID

# 3. Reset System Policy All (General reset for the app)
echo "🔹 Resetting General System Policy..."
tccutil reset All $APP_BUNDLE_ID

# 4. Clear Extended Attributes (sometimes prevents macOS from trusting a new binary)
# We search for the built app if it exists to clear it
BUILD_PATH="./src-tauri/target/release/bundle/macos/$APP_NAME.app"
if [ -d "$BUILD_PATH" ]; then
    echo "🔹 Clearing extended attributes on built app..."
    xattr -cr "$BUILD_PATH"
fi

echo "✅ Done! Next time you open the app, it will prompt for permissions again clean."
echo "💡 Tip: Make sure to close the app before running this script."
