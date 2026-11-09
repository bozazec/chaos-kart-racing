#!/bin/sh
# Crops each driver's head (front + back) out of the kart cut-outs into 192x192 transparent PNGs:
#   packages/client/public/art/heads/h{id}f.png, h{id}b.png
# Run after extract-kart-art.sh. An elliptical mask drops collar/shoulders so only the head remains.
set -e
DIR="$(dirname "$0")/../packages/client/public/art"
mkdir -p "$DIR/heads"
for id in 0 1 2 3 4 5 6 7 8 9 10 11; do
  for v in f b; do
    magick "$DIR/karts/k${id}${v}.png" -crop 180x180+60+12 +repage \
      \( -size 180x180 xc:none -fill white -draw "ellipse 90,92 88,88 0,360" \) -compose DstIn -composite \
      -compose Over -resize 192x192 "$DIR/heads/h${id}${v}.png"
  done
done
