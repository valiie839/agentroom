"use client";

import { useMemo, type ReactNode } from "react";
import { PortalProvider } from "@portalsdk/react";
import { getPortalClient } from "@/lib/portal-client";

/**
 * Publica el cliente de Portal en contexto para los hooks de abajo.
 * El provider es pasivo: las conexiones las abren y cierran los hooks
 * segun el refcount de cada canal, no este componente.
 *
 * No pasamos `token`: el room corre en modo anonimo a proposito.
 */
export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => getPortalClient(), []);
  return <PortalProvider client={client}>{children}</PortalProvider>;
}
