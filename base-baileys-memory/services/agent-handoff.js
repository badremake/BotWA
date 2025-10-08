const AGENT_HANDOFF_START_COMMAND = 'INICIA CHAT CON AGENTE'
const AGENT_HANDOFF_END_COMMAND = 'TERMINA CHAT CON AGENTE'

const stripDiacritics = (text) =>
    String(text ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

const buildAgentEscalationMessage = () =>
    'Estoy contactando a un agente. Si quieres seguir hablando con el bot, solo escribe Menu.'

const AGENT_REQUEST_PATTERNS = [
    /\b(?:hablar|platicar|conversar|contactar|comunicar|comunicarme|comunicarte|transferir|transferirme|chat|chatear)\b.*\b(?:agente|asesor|humano|representante)\b/u,
    /\b(?:agente|asesor|humano|representante)\b.*\b(?:humano|real|persona|chat)\b/u,
    /\bagente\b/u,
    /\basesor\b/u,
]

const isAgentEscalationRequest = (message = '') => {
    if (!message || typeof message !== 'string') return false

    const normalized = stripDiacritics(message)
    if (!normalized) return false

    return AGENT_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
}

const buildCommandMatcher = (command) => {
    const normalizedCommand = stripDiacritics(command)
    return (message = '') => {
        if (!message || typeof message !== 'string') return false
        const normalized = normalizeWhitespace(stripDiacritics(message))
        return normalized === normalizedCommand
    }
}

const isAgentHandoffStartCommand = buildCommandMatcher(AGENT_HANDOFF_START_COMMAND)
const isAgentHandoffEndCommand = buildCommandMatcher(AGENT_HANDOFF_END_COMMAND)

module.exports = {
    AGENT_HANDOFF_END_COMMAND,
    AGENT_HANDOFF_START_COMMAND,
    buildAgentEscalationMessage,
    isAgentEscalationRequest,
    isAgentHandoffEndCommand,
    isAgentHandoffStartCommand,
}
