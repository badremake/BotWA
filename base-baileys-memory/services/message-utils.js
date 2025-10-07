const MAX_CHARS_PER_SEGMENT = 260
const DEFAULT_TYPING_DELAY_MS = 3000

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getVendorInstance = (provider) => {
    if (!provider) return null
    try {
        if (typeof provider.getInstance === 'function') {
            const instance = provider.getInstance()
            if (instance) return instance
        }
    } catch (error) {
        console.error('Error obtaining provider instance:', error)
    }
    return provider.vendor ?? null
}

const determineChatId = (ctx) => ctx?.from ?? ctx?.key?.remoteJid ?? null

const sendTypingState = async ({ ctx, provider, delayMs }) => {
    const target = determineChatId(ctx)
    const vendor = getVendorInstance(provider)
    const effectiveDelay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : DEFAULT_TYPING_DELAY_MS

    let typingStarted = false

    if (typeof ctx?.sendStateTyping === 'function') {
        try {
            await ctx.sendStateTyping()
            typingStarted = true
        } catch (error) {
            console.error('ctx.sendStateTyping failed:', error)
        }
    }

    if (!typingStarted && vendor && typeof vendor.sendStateTyping === 'function' && target) {
        try {
            await vendor.sendStateTyping(target)
            typingStarted = true
        } catch (error) {
            console.error('vendor.sendStateTyping failed:', error)
        }
    }

    if (!typingStarted && typeof provider?.sendPresenceUpdate === 'function' && target) {
        try {
            await provider.sendPresenceUpdate(target, 'composing')
            typingStarted = true
        } catch (error) {
            console.error('provider.sendPresenceUpdate failed:', error)
        }
    } else if (!typingStarted && vendor && typeof vendor.sendPresenceUpdate === 'function' && target) {
        try {
            await vendor.sendPresenceUpdate('composing', target)
            typingStarted = true
        } catch (error) {
            console.error('vendor.sendPresenceUpdate failed:', error)
        }
    }

    await waitFor(effectiveDelay)

    if (typingStarted) {
        if (typeof provider?.sendPresenceUpdate === 'function' && target) {
            try {
                await provider.sendPresenceUpdate(target, 'paused')
            } catch (error) {
                console.error('provider.sendPresenceUpdate pause failed:', error)
            }
        } else if (vendor && typeof vendor.sendPresenceUpdate === 'function' && target) {
            try {
                await vendor.sendPresenceUpdate('paused', target)
            } catch (error) {
                console.error('vendor.sendPresenceUpdate pause failed:', error)
            }
        }
    }
}

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

const sendChunkedMessages = async (flowDynamic, textOrArray, options = {}) => {
    const { ctx = null, provider = null, delayMs = DEFAULT_TYPING_DELAY_MS } = options
    const chunks = prepareChunks(textOrArray)
    if (!chunks.length) return

    for (const [index, body] of chunks.entries()) {
        await sendTypingState({ ctx, provider, delayMs })

        const payload = [{ body, delay: 0 }]
        const isLast = index === chunks.length - 1

        if (isLast) {
            await flowDynamic(payload)
        } else {
            await flowDynamic(payload, { continue: false })
        }
    }
}

module.exports = {
    sendChunkedMessages,
    prepareChunks,
    DEFAULT_TYPING_DELAY_MS,
}
