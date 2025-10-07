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

const flowGemini = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic, state }) => {
    const message = ctx?.body?.trim()
    if (!message) return

    const normalizedMessage = message.toLowerCase()
    if (['reset', 'reiniciar', 'limpiar'].includes(normalizedMessage)) {
        await state.clear()
        await flowDynamic([
            {
                body: '🔄 He reiniciado nuestra conversación. ¿En qué puedo ayudarte ahora?',
            },
        ])
        return
    }

    try {
        const userState = state.getMyState() || {}
        const history = Array.isArray(userState?.geminiHistory) ? userState.geminiHistory : []
        const { reply, history: updatedHistory } = await getGeminiReply(message, history)
        await state.update({ geminiHistory: updatedHistory })
        await flowDynamic([{ body: reply }])
    } catch (error) {
        console.error('Gemini API error:', error)

        if (error.message === 'GEMINI_API_KEY_MISSING') {
            await flowDynamic([
                {
                    body: '⚠️ La clave de la API de Gemini no está configurada. Configura GEMINI_API_KEY en tu entorno y reinicia el bot.',
                },
            ])
            return
        }

        await flowDynamic([
            {
                body: '😔 Ocurrió un error al generar la respuesta. Intenta nuevamente en unos instantes.',
            },
        ])
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
