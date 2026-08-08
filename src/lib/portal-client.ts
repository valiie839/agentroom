/**
 * Cliente de Portal para el navegador.
 *
 * Usa unicamente la publishable key (pk_), que es segura en el bundle.
 * No pasamos `token`, asi que Portal opera en modo anonimo: cada visitante
 * recibe una identidad estable entre recargas sin necesidad de backend ni
 * de que nadie se registre. Para una demo publica eso es decisivo -- el
 * jurado abre la URL y ya esta dentro del room.
 *
 * El nombre visible no viene del token sino de la metadata de presencia
 * (ver PresenceMeta): en canales estandar el sender es solo { id, anon }
 * y el display se une del lado de la app.
 */

import { Portal } from "@portalsdk/core";

let client: Portal | undefined;

export function getPortalClient(): Portal {
  const apiKey = process.env.NEXT_PUBLIC_PORTAL_PUBLISHABLE_KEY;

  if (!apiKey || apiKey.startsWith("TODO")) {
    throw new Error(
      "Falta NEXT_PUBLIC_PORTAL_PUBLISHABLE_KEY. En local va en .env.local; " +
        "en Vercel hay que declararla en Environment Variables.",
    );
  }

  // Singleton: el constructor es pasivo (no abre socket), pero un cliente
  // por render romperia el refcount de los handles de canal.
  client ??= new Portal({ apiKey });
  return client;
}
