const menuSections = [
    {
        emoji: '1️⃣',
        title: 'Información general',
        description:
            'Presenta una visión general del programa de homologación, explicando a quién está dirigido, los plazos estimados y cómo te guiamos hasta lograr tu licencia de RN.',
    },
    {
        emoji: '2️⃣',
        title: 'Requisitos y pasos',
        description:
            'Resume los documentos esenciales y detalla cómo los enviamos en dos etapas (escuela y Board of Nursing), aclarando que, si algo falta, el asesor lo gestiona contigo.',
    },
    {
        emoji: '3️⃣',
        title: 'Beneficios del programa',
        description:
            'Destaca el acompañamiento personalizado, los simulacros del NCLEX-RN, las mentorías clínicas y el apoyo para trámites migratorios y colocación laboral.',
    },
    {
        emoji: '4️⃣',
        title: 'Costos y financiamiento',
        description:
            'Invita a conversar sobre inversiones, becas internas, convenios con empleadores y opciones de pago flexibles durante la llamada de orientación.',
    },
    {
        emoji: '5️⃣',
        title: 'Agendar una llamada',
        description:
            'Anima a reservar una llamada de orientación para conversar con un asesor que resolverá dudas y explicará los siguientes pasos.',
    },
]

const menuOptionResponses = {
    1: [
        'ℹ️ Somos el Consejo de Enfermería Alpha y Omega. Acompañamos a licenciados(as) de México y Latinoamérica para validar su título y ejercer como Registered Nurse en EE.UU.',
        'Incluimos evaluación de perfil, plan personalizado para obtener el ATT y guía para que completes cada requisito ante la Board of Nursing correspondiente.',
        'Desde el primer contacto te orientamos sobre tiempos estimados, cursos obligatorios y recursos de estudio para que avances con confianza.',
    ],
    2: [
        '📄 Documentos iniciales: título y cédula profesional, certificado de calificaciones, récord de horas teórico-prácticas y comprobantes de experiencia.',
        'Te apoyamos con transcripciones oficiales, traducciones certificadas y antecedentes penales si son necesarios, siguiendo el orden de cada etapa hasta lograr tu ATT.',
        'Coordinamos el envío de paquetes académicos a CGFNS/Board y verificamos que la documentación cumpla los estándares estadounidenses antes de cada entrega.',
    ],
    3: [
        '🌟 Beneficios: validación profesional en EE.UU., acceso a mejores oportunidades laborales y acompañamiento académico con simulacros del NCLEX-RN.',
        'También contamos con alianzas para cursos, Visa Screen, orientación laboral y reclutamiento que acelera tu colocación.',
        'Recibirás mentorías con enfermeros homologados, revisión de plan de estudios y sesiones para fortalecer inglés clínico y habilidades culturales.',
    ],
    4: [
        '💳 Revisamos la inversión total, becas internas y planes de financiamiento flexibles que se adaptan a tu situación.',
        'Durante la llamada analizamos calendario de pagos, convenios disponibles y próximos pasos para que avances con seguridad.',
        'Además, te orientamos sobre apoyos económicos externos, programas de reembolso laboral y cómo reservar tu lugar con anticipo accesible.',
    ],
    5: [
        '📞 Agenda una llamada de orientación para revisar tu caso y definir los pasos a seguir.',
        'Cuando estés listo, escribe "Agendar cita" para abrir el asistente automático de reservaciones.',
    ],
}

const MENU_KEYWORDS = ['menu', 'menú']

const MENU_OPTION_KEYWORDS = {
    1: ['información general', 'informacion general', 'info general', 'informacion del programa'],
    2: ['requisitos y pasos', 'requisitos del programa', 'pasos para homologacion', 'pasos para homologación'],
    3: ['beneficios del programa', 'beneficios programa', 'beneficios de la homologacion'],
    4: ['costos y financiamiento', 'costos del programa', 'opciones de financiamiento'],
    5: ['agendar una llamada', 'agendar llamada', 'agendar cita', 'reservar una llamada'],
}

const stripDiacritics = (text) =>
    String(text ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

const escapeRegExp = (text) => String(text).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

const buildMenuBody = () =>
    [
        'Escribe la opción que necesites:',
        '',
        ...menuSections.map((section) => `${section.emoji} ${section.title}`),
    ].join('\n')

const buildMenuMessages = () => [buildMenuBody()]

const buildMenuExample = () => buildMenuMessages().join('\n\n')

const buildMenuGuidance = () =>
    [
        'Cuando sea oportuno (saludo inicial, petición de opciones o duda general), ofrece el menú en un solo mensaje corto.',
        'Evita repetir el mismo menú si la persona ya lo recibió y enfócate en responder a su consulta actual.',
        'Usa mensajes de máximo cuatro líneas y confirma si desea profundizar en algún punto antes de enviar más información.',
        '',
        'Usa exactamente el siguiente formato al compartir el menú:',
        buildMenuExample(),
    ].join('\n')

const isMenuRequest = (message = '') => {
    if (!message || typeof message !== 'string') return false

    const normalized = stripDiacritics(message)

    return MENU_KEYWORDS.some((keyword) => {
        const normalizedKeyword = stripDiacritics(keyword)
        if (!normalizedKeyword) return false
        const pattern = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'u')
        return pattern.test(normalized)
    })
}

const parseMenuOptionSelection = (message = '') => {
    if (!message || typeof message !== 'string') return null

    const trimmed = message.trim()
    if (!trimmed) return null

    const emojiMapping = {
        '1️⃣': 1,
        '2️⃣': 2,
        '3️⃣': 3,
        '4️⃣': 4,
        '5️⃣': 5,
    }

    if (emojiMapping[trimmed]) {
        return emojiMapping[trimmed]
    }

    if (/^[1-5][\s\.]?[\.)\-:]?$/.test(trimmed)) {
        return Number(trimmed[0])
    }

    const normalized = stripDiacritics(trimmed)
    const match = normalized.match(/^opciones?\s*([1-5])[^\p{L}\d]*$/u)
    if (match) {
        return Number(match[1])
    }

    for (const [option, keywords] of Object.entries(MENU_OPTION_KEYWORDS)) {
        if (!Array.isArray(keywords)) continue

        const hasKeyword = keywords.some((keyword) => {
            const normalizedKeyword = stripDiacritics(keyword)
            if (!normalizedKeyword) return false
            const pattern = new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'u')
            return pattern.test(normalized)
        })

        if (hasKeyword) {
            return Number(option)
        }
    }

    return null
}

const getMenuOptionResponse = (option) => {
    if (!option || Number.isNaN(option)) return null
    return menuOptionResponses[option] || null
}

module.exports = {
    menuSections,
    buildMenuExample,
    buildMenuGuidance,
    buildMenuMessages,
    isMenuRequest,
    parseMenuOptionSelection,
    getMenuOptionResponse,
}
