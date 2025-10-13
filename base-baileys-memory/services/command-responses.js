const stripDiacritics = (text) =>
    String(text ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()

const extractDigits = (text) => {
    if (!text) return ''
    return String(text).replace(/[^0-9]/g, '')
}

const extractMenuSelection = (message) => {
    if (!message) return null

    const trimmed = String(message).trim()
    if (!trimmed) return null

    const digitOnly = extractDigits(trimmed)
    if (digitOnly.length === 1 && /^[1-5]$/.test(digitOnly)) {
        return digitOnly
    }

    const normalized = stripDiacritics(trimmed)
    if (!normalized) return null

    const match = normalized.match(/^(?:opcion(?:\s+numero)?)?\s*([1-5])$/u)
    if (match) {
        return match[1]
    }

    const emojiMatch = trimmed.match(/([1-5])\uFE0F?\u20E3/u)
    if (emojiMatch) {
        return emojiMatch[1]
    }

    return null
}

const menuOptionResponses = {
    1: {
        messages: [
            'El programa de homologación del Consejo de Enfermería acompaña a profesionales titulados en México que desean ejercer en Estados Unidos.',
            'Te guiamos desde la evaluación de tus estudios hasta la validación con los organismos reguladores y la preparación del examen profesional.',
            'Si necesitas otro tema, responde con el número correspondiente o escribe "menu" para ver las opciones.',
        ],
        keepMenuOpen: true,
    },
    2: {
        messages: [
            'Estos son los requisitos principales:',
            '• Título y cédula profesional de licenciatura en enfermería.',
            '• Kardex o historial académico con constancia de horas clínicas.',
            '• Identificación oficial, pasaporte y comprobante de domicilio.',
            'También te acompañamos con las traducciones certificadas y con la apertura de tu expediente ante las autoridades estadounidenses.',
            'Responde con otro número del menú o escribe "Agendar cita" si deseas reservar una llamada de orientación.',
        ],
        keepMenuOpen: true,
    },
    3: {
        messages: [
            'Así te apoyamos durante el programa:',
            '• Acompañamiento personalizado con especialistas en homologación.',
            '• Simulacros del examen NCLEX-RN y sesiones de repaso enfocadas en tus áreas de oportunidad.',
            '• Guía para trámites migratorios y vinculación laboral con hospitales aliados en Estados Unidos.',
            'Si quieres profundizar en otro tema, responde con el número correspondiente o pide "Agendar cita".',
        ],
        keepMenuOpen: true,
    },
    4: {
        messages: [
            'La inversión final se personaliza según tu perfil académico y el plan de acompañamiento que necesites.',
            'En la llamada de orientación revisamos becas disponibles y opciones de pago fraccionado sin intereses.',
            'Responde con otro número para seguir explorando o escribe "Agendar cita" si quieres reservar tu asesoría.',
        ],
        keepMenuOpen: true,
    },
    5: {
        messages: [
            'Perfecto, agendar una llamada es el siguiente paso para resolver tus dudas específicas.',
            'Escribe "Agendar cita" o "Reservar cita" y el sistema te guiará para elegir fecha y horario disponibles.',
            'Si prefieres revisar otra información primero, responde con el número correspondiente del menú.',
        ],
        keepMenuOpen: true,
    },
}

const generalCommandRules = [
    {
        triggers: ['informacion general', 'informacion', 'programa'],
        type: 'menu',
        option: '1',
    },
    {
        triggers: ['requisitos', 'documentos', 'pasos'],
        type: 'menu',
        option: '2',
    },
    {
        triggers: ['beneficios', 'ventajas', 'apoyos'],
        type: 'menu',
        option: '3',
    },
    {
        triggers: ['costos', 'precio', 'inversion', 'pagos', 'financiamiento', 'becas'],
        type: 'menu',
        option: '4',
    },
    {
        triggers: ['examen', 'nclex', 'evaluacion'],
        type: 'custom',
        messages: [
            'El examen NCLEX-RN es adaptativo por computadora y evalúa la toma de decisiones clínicas para ejercer como enfermera en Estados Unidos.',
            'Trabajamos contigo en un plan de estudio estructurado, simulacros cronometrados y retroalimentación para que llegues con confianza a la fecha de tu examen.',
            'Cuando quieras conversar con una asesora, escribe "Agendar cita" y te ayudaremos a elegir el mejor horario.',
        ],
    },
    {
        triggers: ['gracias', 'muchas gracias'],
        type: 'custom',
        messages: ['¡Con gusto! Si necesitas algo más, dime o escribe "menu" para revisar las opciones disponibles.'],
    },
]

const matchGeneralRule = (normalizedMessage) => {
    if (!normalizedMessage) return null

    for (const rule of generalCommandRules) {
        if (!Array.isArray(rule.triggers)) continue

        const matched = rule.triggers.some((keyword) => normalizedMessage.includes(keyword))
        if (!matched) continue

        if (rule.type === 'menu' && rule.option && menuOptionResponses[rule.option]) {
            const optionResponse = menuOptionResponses[rule.option]
            return {
                messages: optionResponse.messages,
                keepMenuOpen: true,
            }
        }

        if (rule.type === 'custom' && Array.isArray(rule.messages)) {
            return {
                messages: rule.messages,
                keepMenuOpen: false,
            }
        }
    }

    return null
}

const getCommandResponse = (message, { menuActive = false } = {}) => {
    if (!message) return null

    const normalized = stripDiacritics(message)
    if (!normalized) return null

    if (menuActive) {
        const selection = extractMenuSelection(message)
        if (selection && menuOptionResponses[selection]) {
            const { messages, keepMenuOpen = false } = menuOptionResponses[selection]
            return { messages, keepMenuOpen }
        }
    }

    const ruleMatch = matchGeneralRule(normalized)
    if (ruleMatch) {
        return ruleMatch
    }

    return null
}

module.exports = { getCommandResponse }
