#!/usr/bin/env bash
# Montaje final del video de demostracion.
#
# Toma el crudo que dejo record.mjs y las lineas de voz que dejo
# narrar.ps1, coloca cada linea en el segundo en que aparece su subtitulo
# y produce dos entregables:
#
#   agentroom-demo.mp4          con narracion
#   agentroom-demo-mudo.mp4     solo subtitulos
#
# Se entregan los dos porque la voz es sintetica (SAPI de Windows) y no a
# todo el mundo le convence; los subtitulos van grabados en la imagen, asi
# que la version muda se entiende igual sin sonido.
set -euo pipefail

cd "$(dirname "$0")"
CRUDO="salida/crudo.webm"
VOZ="salida/voz"

[ -f "$CRUDO" ] || { echo "Falta $CRUDO. Corre primero: node record.mjs"; exit 1; }

# Segundo en que entra cada linea, en el mismo orden que los WAV.
# Sale de la traza que imprime record.mjs al grabar.
ENTRADAS=(0 7000 14800 23800 46600 56600 63600 74700)

entradas_ffmpeg=()
filtros=()
mezcla=""
i=0
for ms in "${ENTRADAS[@]}"; do
  n=$(printf "%02d" $((i + 1)))
  archivo="$VOZ/voz-$n.wav"
  [ -f "$archivo" ] || { echo "Falta $archivo. Corre primero: powershell ./narrar.ps1"; exit 1; }
  entradas_ffmpeg+=(-i "$archivo")
  # adelay corre la pista; el mismo valor en los dos canales la deja centrada.
  filtros+=("[$((i + 1)):a]adelay=${ms}|${ms}[v$i];")
  mezcla+="[v$i]"
  i=$((i + 1))
done

# normalize=0 evita que amix baje el volumen al sumar pistas: aqui no se
# solapan, asi que cada linea debe sonar a su nivel original.
FILTRO="$(IFS=; echo "${filtros[*]}")${mezcla}amix=inputs=${#ENTRADAS[@]}:normalize=0[voz]"

echo "→ version con narracion"
ffmpeg -v error -y -i "$CRUDO" "${entradas_ffmpeg[@]}" \
  -filter_complex "$FILTRO" \
  -map 0:v -map "[voz]" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 160k -shortest \
  agentroom-demo.mp4

echo "→ version muda"
ffmpeg -v error -y -i "$CRUDO" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an \
  agentroom-demo-mudo.mp4

echo
for f in agentroom-demo.mp4 agentroom-demo-mudo.mp4; do
  dur=$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$f")
  mb=$(du -m "$f" | cut -f1)
  printf "%-28s %6.1f s   %3s MB\n" "$f" "$dur" "$mb"
done
