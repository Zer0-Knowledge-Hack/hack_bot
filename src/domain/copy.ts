import type { PageFetchFailureKind } from "./errors";
import type { GithubEventAction, GithubEventKind } from "./github";
import type { ExtractedFields } from "./hackathon/extraction";

// Bot-authored Spanish copy for the text the domain composes (neutral "tú"
// form, never usted or voseo). Page values, the LLM prompt, log events and
// codes, and domain exception messages are NOT part of this catalog.

// Same key order as the `ExtractedFields` reply lines: it drives line order in
// `formatAnalysis`.
export const FIELD_LABELS: Readonly<Record<keyof ExtractedFields, string>> = {
  name: "Nombre",
  format: "Formato",
  location: "Ubicación",
  teamSize: "Tamaño del equipo",
  submissionDeadline: "Fecha límite de entrega",
  startDate: "Fecha de inicio",
  endDate: "Fecha de fin",
  resultsDate: "Fecha de resultados",
  prizes: "Premios",
  tracks: "Categorías",
  eligibility: "Requisitos",
};

// Exhaustive: a new fetch failure kind fails `npm run typecheck` until it has
// a phrase.
export const FETCH_FAILURE_PHRASES: Readonly<Record<PageFetchFailureKind, string>> = {
  timeout: "tiempo de espera agotado",
  "too-large": "la página es demasiado grande",
  "http-status": "el sitio respondió con un error",
  "content-type": "el contenido no es una página web",
  redirects: "demasiadas redirecciones",
  network: "error de red",
};

// The only "…y N más" template (`joinLinesWithinLimit` is its sole caller).
export const moreItems = (n: number | string): string => `…y ${n} más`;

export const analysisCopy = {
  slugLabel: "Slug",
  suggestedReposLabel: "Repositorios sugeridos",
  unnamed: "(sin nombre)",
  noDeadline: "sin fecha límite",
  linked: "vinculado",
  notLinked: "no vinculado",
  noAnalyses: "Todavía no se ha analizado ningún hackathon.",
  ack: (host: string) => `Analizando ${host}… el resultado se publicará aquí.`,
  missingAnalysis: "No se encontró el análisis guardado; ejecútalo de nuevo.",
  expired: "El análisis caducó; ejecútalo de nuevo.",
  unsafeUrl: "Solo se pueden analizar páginas públicas http(s).",
  fetchFailed: (phrase: string) =>
    `No se pudo leer esa página (${phrase}). Se conservó el análisis anterior.`,
  tooThin: "La página tiene muy poco texto legible. Se conservó el análisis anterior.",
  quota:
    "Se agotó la cuota compartida de IA de hoy; inténtalo después de las 00:00 UTC. Se conservó el análisis anterior.",
  invalidOutput: "La IA no pudo generar un análisis válido. Se conservó el análisis anterior.",
  notConfigured: "El análisis de hackathons no está configurado.",
  transient: "El análisis falló por un error temporal. Inténtalo de nuevo más tarde.",
  replacedLink: (slug: string) => `Se reemplazó el vínculo anterior del tema (era ${slug}).`,
  movedLink: "Se movió el vínculo de este análisis desde otro tema.",
  pinFailed: "No se pudo fijar el mensaje; se publicó sin fijar.",
};

// hackathon-participation replies composed by the domain. A null link (chat
// ids without a t.me/c form) drops the link and its separator.
const withLink = (prefix: string, link: string | null): string =>
  link === null ? `${prefix}.` : `${prefix}: ${link}`;

export const participationCopy = {
  alreadyHasTopic: (link: string | null): string =>
    link === null ? "Este hackathon ya tiene tema." : `Este hackathon ya tiene tema: ${link}`,
  confirmed: (name: string, link: string | null): string =>
    link === null ? `✅ Participamos en ${name}` : `✅ Participamos en ${name} → ${link}`,
  postFailed: (slug: string, link: string | null): string =>
    withLink(
      `Se creó el tema y se vinculó ${slug}, pero no se pudo publicar el análisis. Ejecuta /hackathon ${slug} dentro del tema`,
      link,
    ),
  linkFailed: (slug: string, link: string | null): string =>
    withLink(
      `Se creó el tema, pero no se pudo vincular ${slug}. Ejecuta /hackathon ${slug} dentro del tema`,
      link,
    ),
};

// One header phrase per kind:action pair; the type makes a missing pair a
// compile error. The mapper never produces `issues:merged` or
// `issues:review_requested`, but the domain type allows them, so they carry
// safe placeholder phrases instead of falling back to raw codes.
export const GITHUB_ALERT_HEADERS: Readonly<
  Record<`${GithubEventKind}:${GithubEventAction}`, string>
> = {
  "pull_request:opened": "PR abierto",
  "pull_request:closed": "PR cerrado",
  "pull_request:merged": "PR fusionado",
  "pull_request:review_requested": "Revisión solicitada",
  "issues:opened": "Issue abierto",
  "issues:closed": "Issue cerrado",
  "issues:merged": "Issue fusionado",
  "issues:review_requested": "Revisión solicitada",
};

export const githubCopy = {
  reviewerLabel: "Revisor:",
  byLabel: "Por:",
};
