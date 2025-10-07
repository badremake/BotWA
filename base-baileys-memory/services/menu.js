const { sendChunkedMessages } = require('./message-utils')
const { businessInfo } = require('./context')
const { handleSchedulingFlow } = require('./scheduling')

const MENU_KEYWORDS = ['menu', 'menú', 'opciones']

const OPTION_MAPPINGS = [
    {
        keywords: ['1', 'uno', 'agendar', 'cita', 'agenda'],
        handler: async (ctx, tools) => {
            const clonedCtx = { ...ctx, body: 'agendar cita' }
            return handleSchedulingFlow(clonedCtx, tools)
        },
    },
    {
        keywords: ['2', 'dos', 'requisitos', 'documentos', 'pasos'],
        handler: async (ctx, { flowDynamic, provider }) => {
            await sendChunkedMessages(
                flowDynamic,
                [
                    'Estos son los requisitos clave para iniciar la homologación: título o cédula en enfermería y pasaporte vigente.',
                    'También necesitaremos certificados de materias y práctica clínica. Si falta algo, te guiamos para reunirlo paso a paso.',
                ],
                { ctx, provider }
            )
            return true
        },
    },
    {
        keywords: ['3', 'tres', 'beneficios', 'apoyo'],
        handler: async (ctx, { flowDynamic, provider }) => {
            await sendChunkedMessages(
                flowDynamic,
                [
                    'Al homologar con nosotros recibes acompañamiento personalizado, simulacros de examen y asesoría para trámites migratorios.',
                    'Nuestro equipo te prepara para entrevistas laborales y te conecta con aliados en Estados Unidos para acelerar tu contratación.',
                ],
                { ctx, provider }
            )
            return true
        },
    },
    {
        keywords: ['4', 'cuatro', 'costos', 'precio', 'pago', 'financiamiento'],
        handler: async (ctx, { flowDynamic, provider }) => {
            await sendChunkedMessages(
                flowDynamic,
                [
                    'El programa cuenta con planes de pago flexibles y opciones de financiamiento. Ajustamos la inversión a tu situación.',
                    'En la llamada de orientación revisamos becas disponibles y promociones activas para que avances con tranquilidad.',
                ],
                { ctx, provider }
            )
            return true
        },
    },
    {
        keywords: ['5', 'cinco', 'horarios', 'contacto', 'ubicación'],
        handler: async (ctx, { flowDynamic, provider }) => {
            await sendChunkedMessages(
                flowDynamic,
                [
                    `Atendemos de lunes a viernes de 9:00 a 15:00 (hora Ciudad de México).`,
                    `Toda la asesoría es en línea, así que te ayudamos sin importar dónde te encuentres. Escríbenos cuando necesites apoyo.`,
                ],
                { ctx, provider }
            )
            return true
        },
    },
]

const sendMenu = async ({ flowDynamic, provider }, { ctx, includeGreeting = false } = {}) => {
    const messages = []

    if (includeGreeting) {
        messages.push(
            `Hola, soy el asistente virtual de ${businessInfo.organizationName}. Estoy aquí para orientarte sobre la homologación.`,
            'Comparte tu interés y te guiaré paso a paso hasta tu llamada con un asesor especializado.'
        )
    }

    messages.push(
        'Menú principal:\n\n1️⃣ Agendar cita\n\n2️⃣ Requisitos y pasos\n\n3️⃣ Beneficios del programa\n\n4️⃣ Costos y apoyos\n\n5️⃣ Horarios y contacto\n\nEscribe el número o pídeme la opción con tus palabras.'
    )

    await sendChunkedMessages(flowDynamic, messages, { ctx, provider })
}

const ensureInitialMenu = async (ctx, tools) => {
    const { state } = tools
    const myState = (typeof state.getMyState === 'function' ? state.getMyState() : state) || {}

    if (myState.hasReceivedMenu) return false

    await sendMenu(tools, { ctx, includeGreeting: true })
    await state.update({
        ...myState,
        hasReceivedMenu: true,
    })

    return false
}

const handleMenuRequest = async (ctx, tools) => {
    const message = ctx?.body?.trim()?.toLowerCase()
    if (!message) return false

    if (MENU_KEYWORDS.some((keyword) => message.includes(keyword))) {
        await sendMenu(tools, { ctx })
        return true
    }

    for (const option of OPTION_MAPPINGS) {
        if (option.keywords.some((keyword) => message.includes(keyword))) {
            const handled = await option.handler(ctx, tools)
            if (handled) return true
        }
    }

    return false
}

module.exports = {
    ensureInitialMenu,
    handleMenuRequest,
    sendMenu,
}
