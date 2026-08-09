# Genera la narracion del video con la voz en espanol instalada en Windows.
#
# Se usa SAPI (System.Speech) porque esta en el sistema y no depende de
# ninguna cuenta ni conexion. La voz suena algo sintetica; por eso el
# video se entrega tambien en version muda con subtitulos, y quien monte
# la entrega elige.
#
# Cada linea sale en su propio WAV: el montaje las coloca despues en el
# segundo exacto en que aparece su subtitulo en la imagen.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$destino = Join-Path $PSScriptRoot "salida\voz"
New-Item -ItemType Directory -Force -Path $destino | Out-Null

$sintetizador = New-Object System.Speech.Synthesis.SpeechSynthesizer
$sintetizador.SelectVoice("Microsoft Sabina Desktop")
# Un punto por encima de la velocidad normal: el guion es denso y hay que
# caber en el hueco que deja cada plano.
$sintetizador.Rate = 1

# Segundo en que aparece cada subtitulo en la grabacion, y su texto.
$lineas = @(
  @{ n = "01"; t = "Hoy un agente de inteligencia artificial es un endpoint: preguntas, esperas solo frente a un spinner." },
  @{ n = "02"; t = "Aqui son participantes: dos personas y tres agentes en la misma sala." },
  @{ n = "03"; t = "Nadie ha escrito nada. Acaba de entrar un sismo real del USGS, y ya lo estan discutiendo." },
  @{ n = "04"; t = "Escribo sin mencionar a nadie. Responde el agente que corresponde, y otro le contesta citandolo." },
  @{ n = "05"; t = "Y cuando no hace falta, no responde nadie." },
  @{ n = "06"; t = "Mientras tanto, un agente destila la conversacion en una pizarra que todos ven cambiar a la vez." },
  @{ n = "07"; t = "Y una audiencia puede mirar sin entrar: otro canal de Portal, presencia agregada, solo lectura." },
  @{ n = "08"; t = "Personas, agentes y datos en vivo en un mismo canal de Portal. agentroom punto vercel punto app." }
)

foreach ($linea in $lineas) {
  $ruta = Join-Path $destino ("voz-" + $linea.n + ".wav")
  $sintetizador.SetOutputToWaveFile($ruta)
  $sintetizador.Speak($linea.t)
  "$($linea.n) -> $ruta"
}

$sintetizador.SetOutputToNull()
$sintetizador.Dispose()
"Narracion generada en $destino"
