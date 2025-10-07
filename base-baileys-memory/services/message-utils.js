const MAX_CHARS_PER_SEGMENT = 260

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

const sendChunkedMessages = async (flowDynamic, textOrArray) => {
    const chunks = prepareChunks(textOrArray)
    if (!chunks.length) return

    const payload = chunks.map((body) => ({ body }))
    await flowDynamic(payload)
}

module.exports = {
    sendChunkedMessages,
    prepareChunks,
}
