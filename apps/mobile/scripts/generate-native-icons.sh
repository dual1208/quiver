#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
assets_dir="$script_dir/../assets"
images_dir="$assets_dir/images"
render_dir=$(mktemp -d "${TMPDIR:-/tmp}/quiver-native-icons.XXXXXX")

cleanup() {
  rm -rf "$render_dir"
}
trap cleanup EXIT HUP INT TERM

render_svg() {
  source_path=$1
  target_path=$2
  target_size=$3
  native_path="$render_dir/$(basename -- "$target_path").native.png"

  /usr/bin/sips -s format png "$source_path" --out "$native_path" >/dev/null
  /usr/bin/sips -z "$target_size" "$target_size" "$native_path" --out "$target_path" >/dev/null
}

render_svg "$assets_dir/quiver-icon.svg" "$images_dir/icon.png" 1024
render_svg "$assets_dir/quiver-background.svg" "$images_dir/android-icon-background.png" 512
render_svg "$assets_dir/quiver-adaptive-foreground.svg" "$images_dir/android-icon-foreground.png" 512
render_svg "$assets_dir/quiver-adaptive-foreground.svg" "$images_dir/android-icon-monochrome.png" 432
render_svg "$assets_dir/expo.icon/Assets/quiver-mark.svg" "$images_dir/splash-icon.png" 512
