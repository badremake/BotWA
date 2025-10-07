const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-pro'
const API_KEY = process.env.GEMINI_API_KEY
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

if (!globalThis.fetch) {
    throw new Error('Fetch API no disponible en este entorno. Actualiza a Node 18 o superior.')
}

const sanitizeHistory = (history = []) => {
    if (!Array.isArray(history)) return []

    return history
        .filter(
            (entry) =>
                entry &&
                typeof entry === 'object' &&
                typeof entry.role === 'string' &&
                Array.isArray(entry.parts) &&
                entry.parts.every((part) => part && typeof part.text === 'string')
        )
        .slice(-20)
}

const buildHistoryEntry = (role, text) => ({
    role,
    parts: [{ text }],
})

const cleanResponse = (text) => {
    if (typeof text !== 'string') return ''
    return text.replace(/\*\*(.*?)\*\*/g, '*$1*').trim()
}

const parseGeminiResponse = (payload) => {
    if (!payload) return ''

    const candidate = payload.candidates?.find((item) => item?.content?.parts?.length)
    if (!candidate) {
        if (payload.promptFeedback?.safetyRatings?.length) {
            return '⚠️ El contenido fue bloqueado por las políticas de seguridad de Gemini.'
        }
        return ''
    }

    const parts = candidate.content.parts
        .map((part) => part?.text)
        .filter(Boolean)

    return cleanResponse(parts.join('\n'))
}

const getGeminiReply = async (message, history = [], context = []) => {
    if (!API_KEY) {
        throw new Error('GEMINI_API_KEY_MISSING')
    }

    const sanitizedHistory = sanitizeHistory(history)
    const sanitizedContext = sanitizeHistory(context)
    const contents = [...sanitizedContext, ...sanitizedHistory, buildHistoryEntry('user', message)]

    let response
    try {
        response = await fetch(
            `${BASE_URL}/models/${DEFAULT_MODEL}:generateContent?key=${API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ contents }),
            }
        )
    } catch (cause) {
        const error = new Error('GEMINI_FETCH_FAILED')
        error.cause = cause
        throw error
    }

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const messageError =
            errorBody?.error?.message || `Error HTTP ${response.status}: ${response.statusText}`
        const error = new Error(messageError)
        error.code = response.status
        throw error
    }

    const json = await response.json()
    const reply = parseGeminiResponse(json)

    if (!reply) {
        throw new Error('GEMINI_EMPTY_RESPONSE')
    }

    const updatedHistory = [
        ...sanitizedHistory,
        buildHistoryEntry('user', message),
        buildHistoryEntry('model', reply),
    ].slice(-20)

    return { reply, history: updatedHistory }
}

module.exports = { getGeminiReply }
