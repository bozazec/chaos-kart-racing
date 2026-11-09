#!/bin/sh
# Cuts the 12 drivers (front + back view) out of the character roster sheet into transparent PNGs:
#   packages/client/public/art/karts/k{id}f.png (front), k{id}b.png (back)
# usage: scripts/extract-kart-art.sh "/path/to/Chibi Karting Character Roster.png"
# Every cut-out ends up 300x300, bottom-aligned (wheels on the ground), same scale for all drivers.
# Sheet layout: 3 columns x 4 rows, each cell = front view (left) + back view (right) + caption.
# Character ids follow shared/src/characters.ts (poster order, row by row).
set -e
SRC="$1"
OUT="$(dirname "$0")/../packages/client/public/art/karts"
mkdir -p "$OUT"
W=226
ROW_H="226 226 216 222" # shorter on rows 3-4: keeps the caption text out
FRONT_X="35 542 1054"; BACK_X="267 775 1283"
ROW_Y="0 250 490 735"
id=0
row=1
for y in $ROW_Y; do
  H=$(echo $ROW_H | cut -d' ' -f$row)
  row=$((row+1))
  c=0
  for fx in $FRONT_X; do
    bx=$(echo $BACK_X | cut -d' ' -f$((c+1)))
    for view in f b; do
      if [ $view = f ]; then x=$fx; else x=$bx; fi
      magick "$SRC" -crop ${W}x${H}+${x}+${y} +repage \
        -bordercolor white -border 2 -fuzz 9% -fill none -draw "color 0,0 floodfill" -shave 2x2 \
        \( +clone -alpha extract -morphology Erode Disk:1 -blur 0x0.6 \) -compose CopyOpacity -composite \
        -compose Over -fuzz 0 -resize 300x -trim +repage -gravity south -background none -extent 300x300 "$OUT/k${id}${view}.png"
    done
    id=$((id+1)); c=$((c+1))
  done
done
