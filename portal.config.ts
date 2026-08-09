import { allow, block, defineConfig, defineMiddleware } from "@portalsdk/config";

/**
 * Configuracion de los canales de Portal.
 *
 * Una sala es el canal `room-<id>`, creado sobre la marcha cuando alguien
 * abre esa URL. Por eso todo se gobierna con una plantilla en vez de
 * enumerar ids que no existen hasta que alguien los visita.
 */

/** Quien puede hablar en nombre de un agente o de la fuente en vivo. */
const SERVER_SENDER = /^(agent-|feed-)/;

/** Lo unico que un navegador tiene derecho a publicar. */
const HUMAN_TYPE = "message";

/** Tope de un mensaje humano. Portal ya limita el payload; esto es UX. */
const MAX_TEXT = 2_000;

/**
 * El navegador lleva una clave publicable: esta a la vista de cualquiera
 * que abra las herramientas de desarrollo. Sin esta comprobacion, alguien
 * podria publicar un `agent:message` firmado como "agent-nova" y poner
 * palabras en boca de un agente -- indistinguible de una respuesta real
 * para el resto de la sala.
 *
 * La frontera es el emisor: los agentes y la fuente publican desde el
 * servidor con la clave secreta y llevan un id reservado. Una sesion de
 * navegador nunca puede tener uno de esos ids, asi que basta con exigir
 * que quien no sea el servidor solo hable como persona.
 */
const soloElServidorHablaPorLosAgentes = defineMiddleware("publish", (ctx) => {
  const esServidor = SERVER_SENDER.test(ctx.sender.id);

  if (!esServidor && ctx.message.type !== HUMAN_TYPE) {
    return block(
      `Solo el servidor puede publicar "${ctx.message.type}". ` +
        `Una sesion de navegador solo puede enviar "${HUMAN_TYPE}".`,
    );
  }

  return allow();
});

/**
 * Mensajes humanos vacios o desmedidos. No es moderacion de contenido:
 * es evitar que una burbuja vacia ensucie el historial de todos y que un
 * pegado accidental de diez mil caracteres rompa el layout de la sala.
 */
const mensajeHumanoRazonable = defineMiddleware<{ text?: string }>(
  "publish",
  (ctx) => {
    if (ctx.message.type !== HUMAN_TYPE) return allow();

    const texto = ctx.message.content?.text;
    if (typeof texto !== "string" || texto.trim().length === 0) {
      return block("Un mensaje vacio no aporta nada a la sala.");
    }
    if (texto.length > MAX_TEXT) {
      return block(`Maximo ${MAX_TEXT} caracteres por mensaje.`);
    }

    return allow();
  },
);

export default defineConfig({
  channels: {
    "room-*": {
      mode: "standard",

      // Sin registro a proposito: quien abre la URL entra. Para una demo
      // publica es decisivo -- el jurado no deberia crear una cuenta para
      // probar el producto.
      anonymous: true,

      authz: () =>
        allow({
          publish: true,
          // Nadie necesita mandar mensajes dirigidos: todo lo que pasa en
          // la sala lo ve la sala entera. Es parte de la premisa.
          sendDirect: false,
        }),

      onPublish: [soloElServidorHablaPorLosAgentes, mensajeHumanoRazonable],
    },

    /**
     * El canal espejo para la audiencia.
     *
     * En modo broadcast la presencia es agregada: se sabe cuantos miran,
     * no quienes. Es lo correcto para una audiencia -- el roster detallado
     * de la sala se vuelve ilegible con unas pocas decenas de personas, y
     * cada entrada y salida se propagaria a todos.
     *
     * Nadie publica aqui salvo el servidor, que espeja lo que ocurre en la
     * sala. Un espectador que intente escribir es rechazado en la conexion,
     * no en el mensaje.
     */
    "watch-*": {
      mode: "broadcast",
      anonymous: true,
      authz: () => allow({ publish: false, sendDirect: false }),
    },
  },
});
