const { buildMenuMessages } = require('./menu')

const GREETING_PATTERNS = [
    /\bhol[ao]s?\b/i,
    /\bqué\s+tal\b/i,
    /\bbuen(?:os|as)\s+(d[ií]as|tardes|noches)\b/i,
    /\bsaludos?\b/i,
]

const isGreeting = (message = '') => {
    if (!message || typeof message !== 'string') return false

    const normalized = message.trim()
    if (!normalized) return false

    return GREETING_PATTERNS.some((pattern) => pattern.test(normalized))
}

const buildInitialGreetingMessages = () => [
    '¡Hola! Soy el asistente virtual del Consejo de Enfermería.',
    'Estoy aquí para acompañarte en tu proceso de homologación. Cuéntame, ¿en qué puedo ayudarte?',
    ...buildMenuMessages(),
]

const buildRepeatedGreetingMessages = () => buildMenuMessages()

module.exports = {
    isGreeting,
    buildInitialGreetingMessages,
    buildRepeatedGreetingMessages,
}
