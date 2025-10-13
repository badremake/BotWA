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

const menuService = require('./services/menu')
const { buildMenuMessages, getMenuOptionResponse, isMenuRequest } = menuService
const {
    buildAgentEscalationMessage,
    isAgentEscalationRequest,
    isAgentHandoffEndCommand,
    isAgentHandoffStartCommand,
} = require('./services/agent-handoff')
const { handleSchedulingFlow } = require('./services/scheduling')
const { sendChunkedMessages } = require('./services/message-utils')
const {
    buildInitialGreetingMessages,
    buildRepeatedGreetingMessages,
    isGreeting,
} = require('./services/greetings')
const { getCommandResponse } = require('./services/command-responses')

const flowGemini = addKeyword(EVENTS.WELCOME).addAction(async (ctx, { flowDynamic, state, provider }) => {
    const message = ctx?.body?.trim()
    if (!message) return

    const isFromAgent = Boolean(ctx?.key?.fromMe)
    const userState = state.getMyState() || {}
    const agentChatActive = Boolean(userState.agentChatActive)
    const menuActive = Boolean(userState.menuActive)
    const greetingCount = Number(userState.greetingCount || 0)

    if (isFromAgent) {
        if (isAgentHandoffStartCommand(message)) {
            await state.update({ agentChatActive: true })
        } else if (isAgentHandoffEndCommand(message)) {
            await state.update({ agentChatActive: false })
        } else if (message.trim().toLowerCase() === 'sesionenvivo') {
            await state.update({ agentChatActive: !agentChatActive })
        }
        return
    }

    const normalizedMessage = message.toLowerCase()
    if (['reset', 'reiniciar', 'limpiar'].includes(normalizedMessage)) {
        await state.clear()
        await sendChunkedMessages(
            flowDynamic,
            '🔄 He reiniciado nuestra conversación. ¿En qué puedo ayudarte ahora?',
            { ctx, provider }
        )
        return
    }

    if (isGreeting(message)) {
        if (agentChatActive) {
            return
        }

        if (menuActive) {
            await state.update({ menuActive: false })
        }

        if (greetingCount === 0) {
            await state.update({ greetingCount: 1, menuActive: true })
            await sendChunkedMessages(flowDynamic, buildInitialGreetingMessages(), {
                ctx,
                provider,
                preserveFormatting: true,
            })
        } else if (greetingCount === 1) {
            await state.update({ greetingCount: 2, menuActive: true })
        } else {
            await state.update({ greetingCount: greetingCount + 1, menuActive: true })
            await sendChunkedMessages(flowDynamic, buildRepeatedGreetingMessages(), {
                ctx,
                provider,
                preserveFormatting: true,
            })
        }

        return
    }

    if (greetingCount !== 0) {
        await state.update({ greetingCount: 0 })
    }

    if (isMenuRequest(message)) {
        if (agentChatActive) {
            await state.update({ agentChatActive: false })
        }
        await state.update({ menuActive: true })
        await sendChunkedMessages(flowDynamic, buildMenuMessages(), {
            ctx,
            provider,
            preserveFormatting: true,
        })
        return
    }

    const menuSelection = menuService.parseMenuOptionSelection(message)
    if (menuSelection) {
        if (agentChatActive) {
            return
        }

        const optionResponse = getMenuOptionResponse(menuSelection)
        if (optionResponse) {
            if (!menuActive) {
                await state.update({ menuActive: true })
            }

            await sendChunkedMessages(flowDynamic, optionResponse, {
                ctx,
                provider,
                preserveFormatting: true,
            })

            await sendChunkedMessages(
                flowDynamic,
                'Si necesitas otra sección, responde con su número o escribe «menu» para volver a verla.',
                {
                    ctx,
                    provider,
                    preserveFormatting: true,
                }
            )

            return
        }
    }

    if (isAgentEscalationRequest(message)) {
        await state.update({ agentChatActive: true, menuActive: false })
        await sendChunkedMessages(flowDynamic, buildAgentEscalationMessage(), {
            ctx,
            provider,
        })
        return
    }

    if (agentChatActive) {
        return
    }

    if (await handleSchedulingFlow(ctx, { flowDynamic, state, provider })) {
        const latestState = state.getMyState() || {}
        if (latestState.menuActive) {
            await state.update({ menuActive: false })
        }
        return
    }

    const latestState = state.getMyState() || {}
    const commandResult = getCommandResponse(message, { menuActive: Boolean(latestState.menuActive) })

    if (commandResult) {
        const { messages, keepMenuOpen = false } = commandResult
        await sendChunkedMessages(flowDynamic, messages, {
            ctx,
            provider,
            preserveFormatting: true,
        })

        if (Boolean(latestState.menuActive) !== keepMenuOpen) {
            await state.update({ menuActive: keepMenuOpen })
        }

        return
    }

    if (latestState.menuActive) {
        await state.update({ menuActive: false })
    }

    await sendChunkedMessages(
        flowDynamic,
        [
            'Aún no tengo una respuesta programada para ese tema.',
            'Escribe "menu" para ver las opciones disponibles o "Agendar cita" si deseas que revisemos horarios para una llamada.',
        ],
        { ctx, provider }
    )
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
