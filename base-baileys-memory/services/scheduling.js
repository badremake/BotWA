const { businessInfo } = require('./context')
const { createCalendarEvent, isCalendarConfigured } = require('./calendar')

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Mexico_City'
const DEFAULT_APPOINTMENT_DURATION_MINUTES = Number(
    process.env.DEFAULT_APPOINTMENT_DURATION_MINUTES || 45
)

const MONTH_NAMES = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
]

const padNumber = (value) => String(value).padStart(2, '0')

const parseDateParts = (date) => {
    const [year, month, day] = date.split('-').map(Number)
    if ([year, month, day].some((value) => Number.isNaN(value))) return null

    const candidate = new Date(Date.UTC(year, month - 1, day))
    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() + 1 !== month ||
        candidate.getUTCDate() !== day
    ) {
        return null
    }

    return { year, month, day }
}

const parseTimeParts = (time) => {
    const [hour, minute] = time.split(':').map(Number)
    if ([hour, minute].some((value) => Number.isNaN(value))) return null
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return { hour, minute }
}

const buildIsoDateTime = (dateParts, timeParts) =>
    `${dateParts.year}-${padNumber(dateParts.month)}-${padNumber(dateParts.day)}T${padNumber(
        timeParts.hour
    )}:${padNumber(timeParts.minute)}:00`

const addMinutesToDateTime = (dateParts, timeParts, minutesToAdd) => {
    const base = Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour,
        timeParts.minute,
        0
    )
    const updated = new Date(base + minutesToAdd * 60 * 1000)

    const newDateParts = {
        year: updated.getUTCFullYear(),
        month: updated.getUTCMonth() + 1,
        day: updated.getUTCDate(),
    }

    const newTimeParts = {
        hour: updated.getUTCHours(),
        minute: updated.getUTCMinutes(),
    }

    return {
        dateParts: newDateParts,
        timeParts: newTimeParts,
        iso: buildIsoDateTime(newDateParts, newTimeParts),
    }
}

const formatDateForHumans = (dateParts) =>
    `${dateParts.day} de ${MONTH_NAMES[dateParts.month - 1]} de ${dateParts.year}`

const formatTimeForHumans = (timeParts) => `${padNumber(timeParts.hour)}:${padNumber(timeParts.minute)}`

const START_KEYWORDS = [
    /agendar\s+(una\s+)?(cita|llamada)/i,
    /reservar\s+(una\s+)?(cita|llamada)/i,
]

const CANCEL_KEYWORDS = [/cancelar/i, /ya\s+no/i]

const resetSchedulingState = async (state) => {
    await state.update({
        scheduling: null,
    })
}

const startSchedulingFlow = async (ctx, { flowDynamic, state }) => {
    if (!isCalendarConfigured()) {
        await flowDynamic([
            {
                body: 'Por ahora no puedo agendar automáticamente porque falta configurar la conexión con Google Calendar. Contacta al equipo técnico para completar la configuración.',
            },
        ])
        return true
    }

    await state.update({
        scheduling: {
            step: 'collectName',
            data: {
                phone: ctx.from,
            },
        },
    })

    await flowDynamic([
        {
            body: '¡Perfecto! Empecemos con tu cita. ¿Cuál es tu nombre completo?',
        },
    ])

    return true
}

const handleCancellation = async ({ flowDynamic, state }) => {
    await flowDynamic([
        {
            body: 'He cancelado el proceso de agenda. Si deseas retomarlo, solo escribe "Agendar cita" cuando quieras.',
        },
    ])
    await resetSchedulingState(state)
}

const buildSummary = (name) =>
    `${businessInfo.organizationName || 'Asesoría'} - Llamada de orientación con ${name}`

const buildDescription = ({ name, email, notes, phone }) => {
    const lines = [
        'Cita agendada automáticamente desde WhatsApp.',
        `Nombre: ${name}`,
        `Correo: ${email}`,
        `Teléfono: ${phone}`,
    ]

    if (notes) {
        lines.push(`Notas: ${notes}`)
    }

    return lines.join('\n')
}

const finalizeScheduling = async (ctx, tools, scheduling) => {
    const { flowDynamic, state } = tools
    const { name, email, date, time, notes, phone, timeZone } = scheduling.data
    const zone = timeZone || DEFAULT_TIMEZONE

    const dateParts = parseDateParts(date)
    const timeParts = parseTimeParts(time)

    if (!dateParts || !timeParts) {
        await flowDynamic([
            {
                body: 'No pude interpretar la fecha y hora proporcionadas. Revisa el formato (AAAA-MM-DD para la fecha y HH:MM en formato de 24 horas) e intenta nuevamente.',
            },
        ])
        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectDate',
            },
        })
        return true
    }

    const startIso = buildIsoDateTime(dateParts, timeParts)
    const endInfo = addMinutesToDateTime(dateParts, timeParts, DEFAULT_APPOINTMENT_DURATION_MINUTES)

    try {
        const event = await createCalendarEvent({
            summary: buildSummary(name),
            description: buildDescription({ name, email, notes, phone }),
            startDateTime: startIso,
            endDateTime: endInfo.iso,
            timeZone: zone,
            attendees: [
                {
                    email,
                    displayName: name,
                },
            ],
        })

        await flowDynamic([
            {
                body: `¡Listo! Tu cita quedó agendada para el ${formatDateForHumans(
                    dateParts
                )} a las ${formatTimeForHumans(timeParts)} (${zone}). Te enviaremos la confirmación al correo ${email}. ${
                    event.htmlLink ? `Puedes revisar el detalle aquí: ${event.htmlLink}` : ''
                }`,
            },
        ])
    } catch (error) {
        console.error('Error al crear evento en Google Calendar:', error)

        if (error.message === 'GOOGLE_CALENDAR_MISSING_CONFIG') {
            await flowDynamic([
                {
                    body: 'No logré conectar con Google Calendar porque la configuración está incompleta. Por favor, solicita al equipo técnico completar las variables de entorno necesarias y vuelve a intentarlo.',
                },
            ])
        } else {
            await flowDynamic([
                {
                    body: 'Ocurrió un inconveniente al crear la cita. Notificaré al equipo para que continúe el proceso contigo manualmente.',
                },
            ])
        }
    }

    await resetSchedulingState(state)

    return true
}

const continueSchedulingFlow = async (ctx, tools, scheduling) => {
    const { flowDynamic, state } = tools
    const message = ctx.body.trim()

    if (CANCEL_KEYWORDS.some((regex) => regex.test(message))) {
        await handleCancellation(tools)
        return true
    }

    switch (scheduling.step) {
        case 'collectName': {
            await state.update({
                scheduling: {
                    step: 'collectEmail',
                    data: {
                        ...scheduling.data,
                        name: message,
                    },
                },
            })

            await flowDynamic([
                {
                    body: 'Gracias. ¿Cuál es tu correo electrónico para enviarte la confirmación?',
                },
            ])

            return true
        }
        case 'collectEmail': {
            const email = message.toLowerCase()
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

            if (!emailRegex.test(email)) {
                await flowDynamic([
                    {
                        body: 'Parece que el correo no es válido. Intenta nuevamente con un formato como nombre@dominio.com.',
                    },
                ])
                return true
            }

            await state.update({
                scheduling: {
                    step: 'collectDate',
                    data: {
                        ...scheduling.data,
                        email,
                    },
                },
            })

            await flowDynamic([
                {
                    body: 'Perfecto. ¿Para qué fecha necesitas la llamada? Escríbela en formato AAAA-MM-DD.',
                },
            ])

            return true
        }
        case 'collectDate': {
            const date = message
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/

            if (!dateRegex.test(date)) {
                await flowDynamic([
                    {
                        body: 'Para registrar la fecha necesito el formato AAAA-MM-DD. Por ejemplo: 2024-05-15.',
                    },
                ])
                return true
            }

            await state.update({
                scheduling: {
                    step: 'collectTime',
                    data: {
                        ...scheduling.data,
                        date,
                    },
                },
            })

            await flowDynamic([
                {
                    body: `¿A qué hora te viene mejor? Indícala en formato 24 horas HH:MM (por ejemplo, 15:30). Si necesitas otra zona horaria distinta a ${DEFAULT_TIMEZONE}, menciónalo aquí.`,
                },
            ])

            return true
        }
        case 'collectTime': {
            const timeMatch = message.match(/\b(\d{2}:\d{2})\b/)
            const timezoneMatch = message.match(/GMT[+-]\d{1,2}|UTC[+-]\d{1,2}|[A-Za-z]+\/[A-Za-z_]+/)

            if (!timeMatch) {
                await flowDynamic([
                    {
                        body: 'Necesito la hora en formato 24 horas HH:MM. Por ejemplo, 09:00 o 16:45.',
                    },
                ])
                return true
            }

            const time = timeMatch[1]
            let timeZone = DEFAULT_TIMEZONE
            if (timezoneMatch) {
                const rawZone = timezoneMatch[0]
                if (/^GMT[+-]\d{1,2}$/i.test(rawZone)) {
                    timeZone = rawZone.replace(/^GMT/i, 'UTC')
                } else if (/^UTC[+-]\d{1,2}$/i.test(rawZone)) {
                    timeZone = rawZone.toUpperCase()
                } else {
                    timeZone = rawZone
                }
            }

            await state.update({
                scheduling: {
                    step: 'collectNotes',
                    data: {
                        ...scheduling.data,
                        time,
                        timeZone,
                    },
                },
            })

            await flowDynamic([
                {
                    body: '¿Hay algo adicional que debamos tener en cuenta para la llamada? Puedes escribir "No" si no es necesario.',
                },
            ])

            return true
        }
        case 'collectNotes': {
            const notes = /^(no|ninguno|ninguna)$/i.test(message) ? '' : message

            await state.update({
                scheduling: {
                    ...scheduling,
                    step: 'finalize',
                    data: {
                        ...scheduling.data,
                        notes,
                    },
                },
            })

            return finalizeScheduling(ctx, tools, {
                ...scheduling,
                data: {
                    ...scheduling.data,
                    notes,
                },
            })
        }
        default:
            await resetSchedulingState(state)
            return false
    }
}

const handleSchedulingFlow = async (ctx, tools) => {
    const message = ctx?.body?.trim()
    if (!message) return false

    const userState = (typeof tools.state.getMyState === 'function'
        ? tools.state.getMyState()
        : tools.state) || {}
    const scheduling = userState.scheduling

    if (scheduling?.step) {
        return continueSchedulingFlow(ctx, tools, scheduling)
    }

    if (START_KEYWORDS.some((regex) => regex.test(message))) {
        return startSchedulingFlow(ctx, tools)
    }

    return false
}

module.exports = {
    handleSchedulingFlow,
}
