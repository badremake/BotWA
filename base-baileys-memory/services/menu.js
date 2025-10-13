const menuSections = [
    {
        emoji: '1️⃣',
        title: 'Información general',
        description:
            'Presenta una visión general del programa de homologación, explicando a quién está dirigido y cuáles son sus objetivos principales.',
    },
    {
        emoji: '2️⃣',
        title: 'Requisitos y pasos',
        description:
            'Resume los documentos esenciales para homologar la carrera y aclara que, si algo falta, el asesor guiará a la persona.',
    },
    {
        emoji: '3️⃣',
        title: 'Beneficios del programa',
        description:
            'Destaca el acompañamiento personalizado, los simulacros de examen y el apoyo para trámites migratorios y colocación laboral.',
    },
    {
        emoji: '4️⃣',
        title: 'Costos y financiamiento',
        description:
            'Invita a conversar sobre inversiones, becas y opciones de pago flexibles durante la llamada de orientación.',
    },
    {
        emoji: '5️⃣',
        title: 'Agendar una llamada',
        description:
            'Anima a reservar una llamada de orientación para conversar con un asesor que resolverá dudas y explicará los siguientes pasos.',
    },
]

const MENU_KEYWORDS = ['menu', 'menú']

const stripDiacritics = (text) =>
    String(text ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

const escapeRegExp = (text) => String(text).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

const buildMenuBody = () => `Escribe la opción que necesites:

${menuSections.map((section) => `${section.emoji} ${section.title}`).join('\n')}`

const buildMenuMessages = () => ['Este es nuestro menú:', buildMenuBody()]

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

module.exports = {
    menuSections,
    buildMenuExample,
    buildMenuGuidance,
    buildMenuMessages,
    isMenuRequest,
}
