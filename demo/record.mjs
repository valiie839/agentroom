/**
 * Grabacion automatizada del video de demostracion.
 *
 * Monta una sola pagina con dos salas lado a lado (dos iframes con
 * identidades distintas gracias a ?name=) y una barra de subtitulos que
 * se va actualizando. Grabarlo todo en una unica pagina es lo que
 * garantiza que las dos ventanas se vean perfectamente sincronizadas:
 * si se grabaran por separado, cualquier deriva entre los dos archivos
 * destruiria justo lo que el video quiere demostrar.
 *
 *   node record.mjs
 *
 * Deja el crudo en ./salida/crudo.webm. El montaje final lo hace
 * montar.sh con ffmpeg.
 */

import { chromium } from "playwright";
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.DEMO_BASE ?? "https://agentroom.vercel.app";
const SALA = process.env.DEMO_ROOM ?? `demo-${Date.now().toString(36)}`;
const SALIDA = "salida";

const ANCHO = 1280;
const ALTO = 720;

/** Barra de subtitulos + dos salas. El texto lo mueve el guion. */
const ENVOLTORIO = `
<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#0a0a0a; font-family: system-ui, sans-serif;
         width:${ANCHO}px; height:${ALTO}px; overflow:hidden; }
  #escena { display:flex; height:${ALTO - 96}px; }
  iframe { border:0; width:100%; height:100%; background:#0a0a0a; }
  .panel { flex:1; border-right:1px solid rgba(255,255,255,.08); position:relative; }
  .panel:last-child { border-right:0; }
  .etiqueta { position:absolute; top:8px; left:8px; z-index:5;
    background:rgba(0,0,0,.6); color:#a3a3a3; font-size:11px;
    padding:2px 8px; border-radius:999px; letter-spacing:.04em; }
  #barra { height:96px; display:flex; align-items:center; padding:0 28px;
    background:linear-gradient(180deg,#111,#0a0a0a); border-top:1px solid rgba(255,255,255,.08); }
  #texto { color:#f5f5f5; font-size:23px; line-height:1.35; font-weight:500;
    opacity:0; transform:translateY(6px); transition:opacity .35s, transform .35s; }
  #texto.on { opacity:1; transform:none; }
  #texto b { color:#818cf8; }
</style>
<div id="escena"></div>
<div id="barra"><div id="texto"></div></div>
<script>
  window.escena = (html) => { document.getElementById('escena').innerHTML = html; };
  window.rotulo = (html) => {
    const t = document.getElementById('texto');
    t.classList.remove('on');
    setTimeout(() => { t.innerHTML = html; t.classList.add('on'); }, 220);
  };
</script>`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Marca de tiempo relativa, para cuadrar despues la narracion. */
let t0 = 0;
const marca = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5, " ");
const paso = (txt) => console.log(`[${marca()}s] ${txt}`);

async function main() {
  await mkdir(SALIDA, { recursive: true });

  // Se apunta a un Chromium ya presente en la maquina en vez de dejar que
  // Playwright descargue el suyo: la descarga fallaba y la version exacta
  // del navegador no cambia nada para lo que se graba aqui.
  const navegador = await chromium.launch({
    executablePath: process.env.DEMO_CHROME || undefined,
    channel: process.env.DEMO_CHROME ? undefined : "chrome",
  });

  const contexto = await navegador.newContext({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 1,
    recordVideo: { dir: SALIDA, size: { width: ANCHO, height: ALTO } },
  });

  const pagina = await contexto.newPage();
  await pagina.setContent(ENVOLTORIO);
  t0 = Date.now();

  // --- 1. La portada, para plantear el problema -------------------
  paso("portada");
  await pagina.evaluate(
    (base) =>
      window.escena(`<div class="panel"><iframe src="${base}"></iframe></div>`),
    BASE,
  );
  await pagina.evaluate(() =>
    window.rotulo(
      "Hoy un agente de IA es un endpoint: preguntas, esperas <b>solo</b> frente a un spinner.",
    ),
  );
  await esperar(7000);

  // --- 2. Dos personas en la misma sala ---------------------------
  paso("dos salas");
  await pagina.evaluate(
    ({ base, sala }) =>
      window.escena(`
        <div class="panel"><span class="etiqueta">Valeria</span>
          <iframe id="a" src="${base}/room/${sala}?name=Valeria"></iframe></div>
        <div class="panel"><span class="etiqueta">Rodrigo</span>
          <iframe id="b" src="${base}/room/${sala}?name=Rodrigo"></iframe></div>`),
    { base: BASE, sala: SALA },
  );
  await pagina.evaluate(() =>
    window.rotulo(
      "Aqui son <b>participantes</b>: dos personas y tres agentes en la misma sala.",
    ),
  );

  const salaA = pagina.frameLocator("#a");
  const salaB = pagina.frameLocator("#b");
  await salaA.locator("text=sala viva").waitFor({ timeout: 45000 });
  await salaB.locator("text=sala viva").waitFor({ timeout: 45000 });
  paso("ambas salas conectadas");

  // --- 3. El mundo entra sin que nadie escriba --------------------
  await pagina.evaluate(() =>
    window.rotulo(
      "Nadie ha escrito nada. Acaba de entrar un <b>hecho real</b> y ya lo estan discutiendo.",
    ),
  );
  // La sala sondea su fuente sola a los 2.5s de conectar; si el mundo no
  // colabora, se fuerza uno para que la toma no dependa de la suerte.
  const llegoSolo = await salaA
    .locator("text=EN VIVO")
    .first()
    .waitFor({ timeout: 22000 })
    .then(() => true)
    .catch(() => false);

  if (!llegoSolo) {
    paso("sin hecho real: se fuerza uno de ensayo");
    await fetch(`${BASE}/api/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: SALA, source: "ensayo", knownIds: [] }),
    }).catch(() => {});
    await salaA.locator("text=EN VIVO").first().waitFor({ timeout: 25000 });
  }
  paso(`hecho en pantalla (real: ${llegoSolo})`);
  await esperar(9000);

  // --- 4. Escribir sin mencionar a nadie --------------------------
  paso("mensaje humano");
  await pagina.evaluate(() =>
    window.rotulo(
      "Escribo <b>sin mencionar a nadie</b>: responde quien corresponde, y otro le contesta.",
    ),
  );
  const caja = salaA.locator('input[placeholder]');
  await caja.click();
  await caja.type("¿esto deberia preocuparnos?", { delay: 55 });
  await salaA.locator('button:has-text("Enviar")').click();
  await esperar(20000);

  // --- 5. Y sabe callarse -----------------------------------------
  paso("saludo trivial");
  await pagina.evaluate(() =>
    window.rotulo("Y cuando no hace falta, <b>no responde nadie</b>."),
  );
  await caja.click();
  await caja.type("hola", { delay: 90 });
  await salaA.locator('button:has-text("Enviar")').click();
  await esperar(9000);

  // --- 6. La pizarra ----------------------------------------------
  paso("pizarra");
  await pagina.evaluate(() =>
    window.rotulo(
      "Mientras tanto, un agente <b>destila la conversacion</b> en una pizarra que todos ven.",
    ),
  );
  await salaA
    .locator("text=LO QUE SABEMOS")
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => paso("(la pizarra no llego a tiempo)"));
  await esperar(7000);

  // --- 7. La audiencia --------------------------------------------
  paso("modo espectador");
  await pagina.evaluate(
    ({ base, sala }) =>
      window.escena(`
        <div class="panel"><span class="etiqueta">Sala</span>
          <iframe id="a" src="${base}/room/${sala}?name=Valeria"></iframe></div>
        <div class="panel"><span class="etiqueta">Audiencia</span>
          <iframe id="c" src="${base}/watch/${sala}"></iframe></div>`),
    { base: BASE, sala: SALA },
  );
  await pagina.evaluate(() =>
    window.rotulo(
      "Y una <b>audiencia</b> puede mirar sin entrar: otro canal, presencia agregada, solo lectura.",
    ),
  );
  await esperar(11000);

  // --- 8. Cierre ---------------------------------------------------
  paso("cierre");
  await pagina.evaluate(() =>
    window.rotulo(
      "Personas, agentes y datos en vivo en un mismo canal de Portal. &nbsp; <b>agentroom.vercel.app</b>",
    ),
  );
  await esperar(7000);

  paso("fin");
  await pagina.close();
  await contexto.close();
  await navegador.close();

  // Playwright nombra el video con un id aleatorio; se renombra para que
  // el montaje no tenga que adivinarlo.
  const ficheros = await readdir(SALIDA);
  const webm = ficheros.find((f) => f.endsWith(".webm") && f !== "crudo.webm");
  if (webm) await rename(join(SALIDA, webm), join(SALIDA, "crudo.webm"));

  console.log(`\nSala usada: ${SALA}`);
  console.log(`Crudo: ${join(SALIDA, "crudo.webm")}`);
}

main().catch((e) => {
  console.error("La grabacion fallo:", e);
  process.exit(1);
});
