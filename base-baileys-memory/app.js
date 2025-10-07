const fs = require('node:fs')
const path = require('node:path')

const loadEnvironment = () => {
    const envPath = path.join(__dirname, '.env')
    if (!fs.existsSync(envPath)) return

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
        if (!line || /^\s*#/.test(line)) continue
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
        if (!match) continue
        const [, key, rawValue] = match
        if (process.env[key]) continue
        const value = rawValue.replace(/^['"]|['"]$/g, '')
        process.env[key] = value
    }
}

loadEnvironment()

const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot')

const QRPortalWeb = require('@bot-whatsapp/portal')
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const MockAdapter = require('@bot-whatsapp/database/mock')

const { getGeminiReply } = require('./services/gemini')
const { contextMessages } = require('./services/context')
const { handleSchedulingFlow } = require('./services/scheduling')
const { sendChunkedMessages } = require('./services/message-utils')
const { maybeReactToMessage } = require('./services/reactions')

const flowGemini = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic, state, provider }) => {
    const message = ctx?.body?.trim()
    if (!message) return

    const normalizedMessage = message.toLowerCase()
    await maybeReactToMessage(ctx, provider)

    if (['reset', 'reiniciar', 'limpiar'].includes(normalizedMessage)) {
        await state.clear()
        await sendChunkedMessages(
            flowDynamic,
            '🔄 He reiniciado nuestra conversación. ¿En qué puedo ayudarte ahora?',
            { ctx, provider }
        )
        return
    }

    if (await handleSchedulingFlow(ctx, { flowDynamic, state, provider })) {
        return
    }

    try {
        const userState = state.getMyState() || {}
        const history = Array.isArray(userState?.geminiHistory) ? userState.geminiHistory : []
        const { reply, history: updatedHistory } = await getGeminiReply(message, history, contextMessages)
        await state.update({ geminiHistory: updatedHistory })
        await sendChunkedMessages(flowDynamic, reply, { ctx, provider })
    } catch (error) {
        console.error('Gemini API error:', error)

        if (error.message === 'GEMINI_API_KEY_MISSING') {
            await sendChunkedMessages(
                flowDynamic,
                '⚠️ La clave de la API de Gemini no está configurada. Configura GEMINI_API_KEY en tu entorno y reinicia el bot.',
                { ctx, provider }
            )
            return
        }

        if (error.message === 'GEMINI_FETCH_FAILED') {
            await sendChunkedMessages(
                flowDynamic,
                '⚠️ No pude comunicarme con el servicio de Gemini. Revisa tu conexión a internet y vuelve a intentarlo.',
                { ctx, provider }
            )
            return
        }

        if (error.message === 'GEMINI_EMPTY_RESPONSE') {
            await sendChunkedMessages(
                flowDynamic,
                '⚠️ No recibí ninguna respuesta de Gemini. Por favor intenta reformular tu mensaje.',
                { ctx, provider }
            )
            return
        }

        if (error.code === 401 || error.code === 403) {
            await sendChunkedMessages(
                flowDynamic,
                '⚠️ Gemini rechazó la solicitud. Verifica tu GEMINI_API_KEY y que la cuenta tenga acceso al modelo configurado.',
                { ctx, provider }
            )
            return
        }

        if (error.code === 429) {
            await sendChunkedMessages(
                flowDynamic,
                '⚠️ Se alcanzó el límite de solicitudes de Gemini. Espera unos minutos antes de intentarlo de nuevo.',
                { ctx, provider }
            )
            return
        }

        if (error.message) {
            await sendChunkedMessages(
                flowDynamic,
                `⚠️ Gemini respondió con un error: ${error.message}`,
                { ctx, provider }
            )
            return
        }

        await sendChunkedMessages(
            flowDynamic,
            '😔 Ocurrió un error al generar la respuesta. Intenta nuevamente en unos instantes.',
            { ctx, provider }
        )
    }
})

const main = async () => {
    const adapterDB = new MockAdapter()
    const adapterFlow = createFlow([flowGemini])
    const adapterProvider = createProvider(BaileysProvider)

    await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    QRPortalWeb()
}

main()
