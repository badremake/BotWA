const { buildMenuMessages } = require('./menu')

const stripDiacritics = (text = '') =>
    String(text)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

const escapeRegExp = (text) => String(text).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

const commandDefinitions = [
    {
        keywords: ['hola', 'buenos dias', 'buenas tardes', 'buenas noches'],
        messages: [
            '👋 ¡Hola! Somos el Consejo de Enfermería. Te ayudamos a homologar tu título profesional para que puedas ejercer en Estados Unidos.',
            'Cuéntame qué información necesitas o escribe "menu" para ver las opciones disponibles.',
        ],
    },
    {
        keywords: ['informacion', 'información', 'programa', 'homologacion', 'homologación'],
        messages: [
            'ℹ️ Nuestro programa de homologación acompaña a profesionales de enfermería que estudiaron en México para validar su título en Estados Unidos.',
            'Te guiamos paso a paso: revisión de documentos, preparación para el examen de equivalencia y orientación sobre trámites migratorios básicos.',
        ],
    },
    {
        keywords: ['examen', 'simulacro'],
        messages: [
            '📝 El examen de homologación evalúa tus conocimientos clínicos y regulatorios para ejercer en Estados Unidos.',
            'Incluimos simulacros guiados, banco de preguntas actualizado y sesiones de retroalimentación para que llegues con seguridad a la evaluación oficial.',
        ],
    },
    {
        keywords: ['requisitos', 'documentos'],
        messages: [
            '📄 Los requisitos principales incluyen: título y cédula profesional, certificado de estudios, identificación oficial y comprobantes de experiencia clínica.',
            'Si te falta algún documento, un asesor te indicará cómo gestionarlo durante la llamada de orientación.',
        ],
    },
    {
        keywords: ['beneficios', 'apoyos'],
        messages: [
            '🌟 Beneficios del programa: acompañamiento personalizado, simulacros de examen, asesoría para trámites migratorios básicos y guía para oportunidades laborales.',
            'Todo el proceso es en línea para que avances sin importar dónde te encuentres.',
        ],
    },
    {
        keywords: ['costos', 'costo', 'precio', 'precios', 'inversion', 'inversión', 'pago', 'pagos', 'financiamiento'],
        messages: [
            '💳 Para conversar sobre inversiones, becas internas y planes de pago flexibles necesitamos primero una llamada de orientación.',
            'En esa llamada telefónica resolvemos tus dudas y revisamos si el programa se ajusta a tu presupuesto antes de compartir montos específicos.',
        ],
    },
    {
        keywords: ['llamada', 'orientacion', 'orientación', 'asesor', 'contacto'],
        messages: [
            '📞 Para hablar con un asesor y aclarar dudas específicas, agenda una llamada de orientación.',
            'Escribe "Agendar cita" cuando quieras reservar tu espacio en el calendario.',
        ],
    },
]

const buildKeywordPattern = (keyword) => {
    if (!keyword) return null
    if (keyword instanceof RegExp) {
        return keyword
    }

    const normalized = stripDiacritics(keyword)
    if (!normalized) return null

    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, 'u')
}

const matchesDefinition = (normalizedMessage, definition) => {
    if (!normalizedMessage || !definition?.keywords) return false

    return definition.keywords.some((keyword) => {
        const pattern = buildKeywordPattern(keyword)
        if (!pattern) return false
        return pattern.test(normalizedMessage)
    })
}

const MENU_FALLBACK_PATTERNS = [/\bmenu\b/u, /\bmen[uú]\b/u, /\bopcion(?:es)?\b/u, /\bopci[oó]n\s*\d+/u]

const buildMenuFallbackMessages = () => {
    const menuMessages = buildMenuMessages()
    const [menuBlock] = Array.isArray(menuMessages) ? menuMessages : []

    return [
        'Por ahora no tengo una respuesta programada para ese tema.',
        'Te comparto de nuevo el menú para que elijas la opción que necesites:',
        menuBlock,
    ].filter(Boolean)
}

const getCommandResponse = (message = '', { menuActive = false } = {}) => {
    if (!message || typeof message !== 'string') return null

    const normalized = stripDiacritics(message.trim())
    if (!normalized) return null

    const definition = commandDefinitions.find((candidate) => matchesDefinition(normalized, candidate))

    if (definition) {
        return { messages: definition.messages }
    }

    if (menuActive) {
        return null
    }

    if (MENU_FALLBACK_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return { messages: buildMenuFallbackMessages(), keepMenuOpen: true }
    }

    return null
}

module.exports = {
    getCommandResponse,
}
