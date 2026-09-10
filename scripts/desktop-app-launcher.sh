#!/bin/zsh
set -eu

# Ensure user paths and node/nvm are available in macOS GUI environment
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  set +u
  export NVM_DIR="$HOME/.nvm"
  \. "$NVM_DIR/nvm.sh"
  set -u
fi

project_root="__PROJECT_ROOT__"
url="http://127.0.0.1:3000"

cd "$project_root"

# A running production server is reused, so clicking the icon also brings its
# browser window back without starting a second process.
if ! curl --silent --fail --max-time 1 "$url/" >/dev/null 2>&1; then
  nohup npm start > "$project_root/.maek-server.log" 2>&1 &
  server_pid=$!
  for _ in {1..60}; do
    if curl --silent --fail --max-time 1 "$url/" >/dev/null 2>&1; then
      open "$url"
      exit 0
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
      osascript -e 'display alert "Maek could not start" message "Open .maek-server.log in the project folder for details."'
      exit 1
    fi
    sleep 0.5
  done
  osascript -e 'display alert "Maek is taking too long to start" message "Check .maek-server.log in the project folder."'
  exit 1
fi

open "$url"
