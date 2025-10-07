const REACTION_EMOJIS = ['👍', '❤️']
const DEFAULT_REACTION_PROBABILITY = 0.25

const getVendorInstance = (provider) => {
    if (!provider) return null
    if (typeof provider.getInstance === 'function') {
        try {
            return provider.getInstance() || provider.vendor || null
        } catch (error) {
            console.error('Error getting provider instance for reaction:', error)
            return provider.vendor ?? null
        }
    }
    return provider.vendor ?? null
}

const pickReactionEmoji = () => {
    const index = Math.floor(Math.random() * REACTION_EMOJIS.length)
    return REACTION_EMOJIS[index]
}

const resolveChatId = (ctx) => {
    if (!ctx) return null

    return (
        ctx.from ||
        ctx.key?.remoteJid ||
        ctx.key?.participant ||
        null
    )
}

const maybeReactToMessage = async (ctx, provider, probability = DEFAULT_REACTION_PROBABILITY) => {
    if (!ctx || !provider) return
    if (!ctx.key || ctx.key.fromMe) return
    if (typeof probability !== 'number' || probability <= 0) return
    if (Math.random() >= probability) return

    const vendor = getVendorInstance(provider)
    if (!vendor || typeof vendor.sendMessage !== 'function') return

    const emoji = pickReactionEmoji()
    const chatId = resolveChatId(ctx)
    if (!chatId) return

    try {
        await vendor.sendMessage(chatId, {
            react: {
                text: emoji,
                key: ctx.key,
            },
        })
    } catch (error) {
        console.error('Failed to send reaction:', error)
    }
}

module.exports = { maybeReactToMessage }
