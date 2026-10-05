import { analysisCopy } from "../../domain/copy";
import type { Role } from "../../domain/entities";

// Bot-authored Spanish copy for Telegram command replies (neutral "tú" form).
// Imports the domain catalog, never the other way round. PR1 seeds the shared
// and hackathon entries; later PRs extend it.
export const commonCopy = {
  notMember: "No eres miembro de este equipo.",
  noTeamForChat:
    "No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup.",
  membershipCheckFailed: (cmd: string) =>
    `No se pudo verificar tu pertenencia al equipo. Vuelve a intentar /${cmd}.`,
  linkedHere: (name: string) => `Se vinculó ${name} a este tema.`,
};

// Label of the participation button attached to the General analysis post.
export const participateButton = "✅ Participamos";

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

// Roles are exposed to users only through this exhaustive map, so a new Role
// fails typecheck until it has a Spanish label.
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: "administrador",
  member: "miembro",
};

export const teamResolutionCopy = {
  joinFirst: "Primero únete a un equipo ejecutando /join en su grupo.",
  choose: "Elige a qué equipo se aplica este comando.",
  teamButton: (id: string) => `Equipo ${id}`,
};

export const setupCopy = {
  privateChat:
    "Ejecuta /setup dentro del grupo que quieres registrar como equipo, no en un chat privado.",
  anonymousAdmin:
    'Estás publicando como administrador anónimo, así que no se puede verificar tu condición de administrador. Desactiva "Permanecer anónimo" en tus permisos de administrador y vuelve a ejecutar /setup.',
  alreadyExists: "Ya hay un equipo registrado en este chat.",
  adminCheckFailed: "No se pudo verificar tu condición de administrador. Inténtalo de nuevo.",
  notGroupAdmin: "Solo un administrador del grupo de Telegram puede ejecutar /setup.",
  created: "Equipo creado. Eres el primer administrador.",
};

export const joinCopy = {
  alreadyMember: "Ya eres miembro de este equipo.",
  joined: "Te uniste al equipo.",
};

export const dataChannelCopy = {
  topicRequired:
    "Ejecuta /datachannel dentro del tema que quieres usar como canal de datos del equipo.",
  adminOnly: "Solo un administrador del equipo puede asignar el canal de datos.",
  bound: "Este tema es ahora el canal de datos del equipo.",
};

export const profileCopy = {
  unreadable: "ilegible",
  memberHeader: (id: string, identity: string, role: string) =>
    `Miembro ${id}${identity} — rol: ${role}`,
  noFields: "No hay campos de perfil configurados.",
  teamHeader: (id: string) => `Equipo ${id}`,
  noMatch: "No se encontró ningún miembro que coincida.",
  dataChannelOnly: "Los datos de los miembros solo están disponibles en el canal de datos del equipo.",
  setUsage: "Uso: /profile set <full_name|emails|social_links|github_username> <valor>",
  ownOnly: "Solo puedes editar tu propio perfil.",
  updated: (teamId: string) => `Perfil actualizado para el equipo ${teamId}.`,
  usage: "Uso: /profile show [membership-id] o /profile set <campo> <valor>",
};

export const roleCopy = {
  usage: (cmd: string) => `Uso: /${cmd} <membership-id>`,
  adminOnly: "Solo un administrador del equipo puede cambiar roles.",
  notFound: "No se encontró al miembro en este equipo.",
  lastAdmin: "No se puede degradar al último administrador del equipo.",
  changed: (role: Role, teamId: string) =>
    `Rol del miembro cambiado a ${ROLE_LABELS[role]} para el equipo ${teamId}.`,
};

export const repoCopy = {
  topicRequired: {
    link: "Ejecuta /linkrepo dentro del tema al que quieres vincular el repositorio.",
    unlink: "Ejecuta /unlinkrepo dentro del tema del que quieres desvincular el repositorio.",
  } as Readonly<Record<"link" | "unlink", string>>,
  usage: (cmd: string) => `Uso: /${cmd} <owner/repo o URL del repositorio de GitHub>`,
  linkAdminOnly: "Solo un administrador del equipo puede vincular un repositorio.",
  orgNotClaimed: "La organización de este repositorio no está reclamada por tu equipo.",
  moved: (repo: string, from: number | string, to: number | string) =>
    `Se movió ${repo} del tema ${from} al tema ${to}. El tema ${from} ya no recibirá alertas de este repositorio.`,
  unlinkAdminOnly: "Solo un administrador del equipo puede desvincular un repositorio.",
  unlinked: (repo: string) => `Se desvinculó ${repo} de este tema.`,
  notLinked: (repo: string) => `${repo} no estaba vinculado a ningún tema.`,
  none: "Todavía no hay repositorios vinculados.",
  line: (repo: string, threadId: number | string) => `${repo} -> tema ${threadId}`,
};

export const pickerCopy = {
  unavailableAlert: "Ese equipo no está disponible para ti.",
  notMember: "No eres miembro de ese equipo.",
  selected: "Equipo seleccionado. Vuelve a ejecutar tu comando para continuar.",
};

// hackathon-participation adapter replies (design.md "Copy Table").
export const participateCopy = {
  adminOnly: "Solo un administrador del equipo puede confirmar la participación.",
  joinUsage: "Uso: /hackathon join <slug>",
  noAnalysis: (slug: string) => `No se encontró ningún análisis con el slug ${slug}.`,
  noRights:
    "No puedo crear temas: concede al bot el permiso «Administrar temas» y vuelve a intentarlo.",
  notForum:
    "Este grupo no tiene los temas activados. Actívalos en la configuración del grupo y vuelve a intentarlo.",
  createFailed: "Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto.",
  createUncertain:
    "No se pudo confirmar si se creó el tema. Revisa la lista de temas antes de volver a intentarlo.",
};

// natural-language-text replies (design.md "Copy Table").
export const nlCopy = {
  help:
    "Podés hablarme en el grupo @mencionándome o respondiendo a un mensaje mío (en el chat general o en un tema). Pedime «ayuda» para ver este texto. Los comandos con / siguen funcionando (por ejemplo /hackathons).",
  unknown:
    "No te entendí. Pedime «ayuda» para ver cómo hablarme, o usá un comando con /.",
  notConfigured:
    "El lenguaje natural no está configurado todavía. Usá los comandos con /.",
  classifyFailed:
    "No pude interpretar eso ahora. Probá de nuevo en un momento, o usá un comando con /.",
  quota:
    "Llegamos al límite diario de mensajes en lenguaje natural para este equipo. Mañana se reinicia (UTC), o usá un comando con /.",
  mutateDeferred:
    "Esa acción todavía necesita confirmación (próximamente). Por ahora usá el comando con / correspondiente.",
  clarifySlug: "¿De qué hackathon? Decime el slug (o mirá /hackathons).",
  clarifyTopic:
    "Esa consulta aplica dentro de un tema con un hackathon vinculado. Entrá al tema y pedímelo de nuevo.",
  noTopicAnalysis:
    "Este tema no tiene un hackathon vinculado. Pedí la lista con «hackathons» o usá /hackathons.",
  noAnalysis: hackathonCopy.noAnalysis,
  dataChannelOnly: profileCopy.dataChannelOnly,
};

export const nlConfirmButtons = {
  confirm: "Confirmar",
  cancel: "Cancelar",
};

export const nlConfirmCopy = {
  hint: "También podés responder sí o cancelar a este mensaje.",
  cancelled: "Listo, cancelé la acción.",
  busy: "Esa confirmación ya se usó o expiró.",
  wrongActor: "Solo quien pidió la acción puede confirmarla.",
  lexiconHint: "Respondé sí o cancelar, o usá el botón.",
  profileDataChannelOnly:
    "Pedí el cambio de perfil en el canal de datos del equipo (no acá).",
  clarifyMembership: "¿A qué miembro? Respondé citando su mensaje o pasando el id de membresía.",
  clarifyRepo: "¿Qué repositorio? Pasame owner/repo.",
  clarifyUrl: "¿Qué URL del hackathon querés analizar?",
  clarifyThread: "Esa acción necesita correrse dentro del tema correspondiente.",
  confirmPrompt: (summary: string) =>
    `¿Confirmás ${summary}?\nTambién podés responder sí o cancelar a este mensaje.`,
  summaries: {
    setup_team: "registrar este grupo como equipo",
    join_team: "unirte a este equipo",
    bind_data_channel: "usar este tema como canal de datos",
    set_profile_field: (field: string) => `actualizar tu campo de perfil «${field}»`,
    promote_member: (id: string) => `promover a ${id} a administrador`,
    demote_member: (id: string) => `dejar a ${id} como miembro`,
    link_repo: (repo: string) => `vincular ${repo} a este tema`,
    unlink_repo: (repo: string) => `desvincular ${repo}`,
    link_hackathon_topic: (slug: string) => `vincular el hackathon ${slug} a este tema`,
    request_hackathon_analysis: "lanzar un análisis nuevo de hackathon",
    participate_hackathon: (slug: string) => `participar en ${slug}`,
  },
};
