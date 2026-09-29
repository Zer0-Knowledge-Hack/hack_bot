import { analysisCopy } from "../../domain/copy";

// Bot-authored Spanish copy for Telegram command replies (neutral "tú" form).
// Imports the domain catalog, never the other way round. PR1 seeds the shared
// and hackathon entries; later PRs extend it.
export const commonCopy = {
  notMember: "No eres miembro de este equipo.",
  linkedHere: (name: string) => `Se vinculó ${name} a este tema.`,
};

export const hackathonCopy = {
  usage: "Uso: /hackathon <url o slug>",
  groupOnly: "Ejecuta este comando dentro del chat grupal de tu equipo.",
  adminOnly: "Solo un administrador del equipo puede analizar o vincular un hackathon.",
  noAnalysis: "No hay ningún análisis con ese slug. Consulta /hackathons.",
  unsafeUrl: analysisCopy.unsafeUrl,
  urlTooLong: (max: number | string) => `Esa URL es demasiado larga (máximo ${max} caracteres).`,
  dailyCap:
    "Límite diario alcanzado (5 análisis nuevos por día UTC). Volver a mostrar un slug no cuenta.",
  busy: "Ya hay un análisis en curso para este equipo. Espera su resultado.",
  queueSendFailed:
    "No se pudo iniciar el análisis; inténtalo de nuevo en un minuto. No se contó en el límite diario.",
  notConfigured: analysisCopy.notConfigured,
  publishFailed: "No se pudo publicar en este chat ahora mismo. Inténtalo de nuevo en un minuto.",
};
