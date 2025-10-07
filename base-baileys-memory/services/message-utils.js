const MAX_CHARS_PER_SEGMENT = 260
const DEFAULT_MESSAGE_DELAY_MS = 3000
const DEFAULT_REACTION_PROBABILITY = 0.35
const REACTIONS = ['👍', '❤️']

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

const splitIntoSegments = (text) => {
    const sentences = text
        .split(/(?<=[.!?¿¡])\s+/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean)

    const segments = []
    let current = ''

    for (const sentence of sentences) {
        const candidate = current ? `${current} ${sentence}`.trim() : sentence
        if (candidate.length > MAX_CHARS_PER_SEGMENT && current) {
            segments.push(current)
            current = sentence
            continue
        }

        if (candidate.length > MAX_CHARS_PER_SEGMENT) {
            const parts = []
            let buffer = ''
            for (const word of sentence.split(/\s+/)) {
                const candidateBuffer = buffer ? `${buffer} ${word}` : word
                if (candidateBuffer.length > MAX_CHARS_PER_SEGMENT && buffer) {
                    parts.push(buffer)
                    buffer = word
                } else {
                    buffer = candidateBuffer
                }
            }
            if (buffer) parts.push(buffer)
            if (current) segments.push(current)
            segments.push(...parts)
            current = ''
            continue
        }

        current = candidate
    }

    if (current) segments.push(current)

    return segments.length ? segments : [normalizeWhitespace(text)]
}

const prepareChunks = (textOrArray) => {
    if (Array.isArray(textOrArray)) {
        return textOrArray
            .map((text) => splitIntoSegments(text))
            .flat()
            .map((text) => normalizeWhitespace(text))
            .filter(Boolean)
    }

    return splitIntoSegments(String(textOrArray))
        .map((text) => normalizeWhitespace(text))
        .filter(Boolean)
}

const sendStateTyping = async (provider, chatId, state) => {
    if (!provider || !chatId || typeof provider.sendPresenceUpdate !== 'function') return

    try {
        await provider.sendPresenceUpdate(chatId, state)
    } catch (error) {
        // Silently ignore typing presence errors
    }
}

const withTypingDelay = async (provider, chatId, delayMs) => {
    if (!delayMs || delayMs < 0) {
        return
    }

    await sendStateTyping(provider, chatId, 'composing')
    await delay(delayMs)
    await sendStateTyping(provider, chatId, 'paused')
}

const sendChunkedMessages = async (flowDynamic, textOrArray, options = {}) => {
    const { ctx, provider, delayMs = DEFAULT_MESSAGE_DELAY_MS, chatId: overrideChatId } = options

    const chunks = prepareChunks(textOrArray)
    if (!chunks.length) return

    const chatId = overrideChatId || ctx?.key?.remoteJid || ctx?.from || null

    for (const chunk of chunks) {
        await withTypingDelay(provider, chatId, delayMs)
        await flowDynamic([{ body: chunk }])
    }

    await sendStateTyping(provider, chatId, 'available')
}

const maybeReactToMessage = async (ctx, provider, options = {}) => {
    const probability =
        typeof options.probability === 'number' ? options.probability : DEFAULT_REACTION_PROBABILITY
    const reactions = Array.isArray(options.reactions) && options.reactions.length
        ? options.reactions
        : REACTIONS

    if (!ctx || ctx.fromMe || !provider?.vendor?.sendMessage) return
    if (!ctx.key || Math.random() > probability) return

    const chatId = ctx.key.remoteJid || ctx.from
    if (!chatId) return

    const reaction = reactions[Math.floor(Math.random() * reactions.length)]

    try {
        await provider.vendor.sendMessage(chatId, { react: { text: reaction, key: ctx.key } })
    } catch (error) {
        // Ignore reaction failures silently
    }
}

module.exports = {
    sendChunkedMessages,
    prepareChunks,
    maybeReactToMessage,
    sendStateTyping,
}
