#!/bin/zsh
set -eu

script_dir="${0:A:h}"
project_root="${script_dir:h}"
desktop_app="$HOME/Desktop/Maek.app"
legacy_app="$HOME/Desktop/Oh My Maek.app"
contents="$desktop_app/Contents"
macos="$contents/MacOS"
resources="$contents/Resources"

# Remove legacy launcher if present
if [[ -d "$legacy_app" ]]; then
  rm -rf "$legacy_app"
fi

mkdir -p "$macos" "$resources"
cp "$script_dir/desktop-app-Info.plist" "$contents/Info.plist"
if [[ -f "$project_root/resources/icon.icns" ]]; then
  cp "$project_root/resources/icon.icns" "$resources/icon.icns"
fi

# The launcher lives inside the .app bundle, so bake in the absolute project
# location instead of relying on the user's current shell directory.
escaped_root=${project_root//|/\\|}
sed "s|__PROJECT_ROOT__|$escaped_root|g" "$script_dir/desktop-app-launcher.sh" > "$macos/Maek"
chmod +x "$macos/Maek"
touch "$desktop_app"

echo "Installed: $desktop_app"
