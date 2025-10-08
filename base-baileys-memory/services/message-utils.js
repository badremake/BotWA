const MAX_CHARS_PER_SEGMENT = 400
const MAX_OUTBOUND_SEGMENTS = 5
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

    let usedPresenceUpdate = false

    if (ctx && typeof ctx.sendStateTyping === 'function') {
        try {
            await ctx.sendStateTyping()
            await waitFor(effectiveDelay)
            return
        } catch (error) {
            console.error('ctx.sendStateTyping failed:', error)
        }
    }

    if (vendor && typeof vendor.sendStateTyping === 'function' && target) {
        try {
            await vendor.sendStateTyping(target)
            await waitFor(effectiveDelay)
            return
        } catch (error) {
            console.error('vendor.sendStateTyping failed:', error)
        }
    }

    if (vendor && typeof vendor.sendPresenceUpdate === 'function' && target) {
        try {
            await vendor.sendPresenceUpdate('composing', target)
            usedPresenceUpdate = true
        } catch (error) {
            console.error('vendor.sendPresenceUpdate failed:', error)
        }
    }

    await waitFor(effectiveDelay)

    if (usedPresenceUpdate) {
        try {
            await vendor.sendPresenceUpdate('paused', target)
        } catch (error) {
            console.error('vendor.sendPresenceUpdate pause failed:', error)
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

const condenseSegments = (segments) => {
    if (!Array.isArray(segments)) return []
    if (segments.length <= MAX_OUTBOUND_SEGMENTS) return segments

    const condensed = []
    let buffer = ''

    for (const segment of segments) {
        const candidate = buffer ? `${buffer} ${segment}`.trim() : segment

        if (candidate.length <= MAX_CHARS_PER_SEGMENT || !buffer) {
            buffer = candidate
            continue
        }

        if (buffer) condensed.push(buffer)
        buffer = segment
    }

    if (buffer) condensed.push(buffer)

    if (condensed.length <= MAX_OUTBOUND_SEGMENTS) {
        return condensed
    }

    const finalSegments = []
    const chunkSize = Math.ceil(condensed.length / MAX_OUTBOUND_SEGMENTS)

    for (let i = 0; i < condensed.length; i += chunkSize) {
        finalSegments.push(condensed.slice(i, i + chunkSize).join(' '))
    }

    return finalSegments
}

const prepareChunks = (textOrArray, { preserveFormatting = false } = {}) => {
    const processText = (text) => {
        const stringified = String(text)
        if (preserveFormatting && /\n/.test(stringified)) {
            return [stringified]
        }
        return splitIntoSegments(stringified)
    }

    const segments = Array.isArray(textOrArray)
        ? textOrArray.flatMap((text) => processText(text))
        : processText(textOrArray)

    const cleanedSegments = segments
        .map((text) => String(text))
        .map((text) => (preserveFormatting ? text.replace(/\s+$/u, '') : normalizeWhitespace(text)))
        .filter((text) => text.length > 0)

    if (preserveFormatting) {
        return cleanedSegments
    }

    return condenseSegments(cleanedSegments)
}

const sendChunkedMessages = async (flowDynamic, textOrArray, options = {}) => {
    const {
        ctx = null,
        provider = null,
        delayMs = DEFAULT_TYPING_DELAY_MS,
        preserveFormatting = false,
    } = options
    const chunks = prepareChunks(textOrArray, { preserveFormatting })
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
