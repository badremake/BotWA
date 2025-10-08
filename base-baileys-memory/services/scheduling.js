const { businessInfo } = require('./context')
const {
    createCalendarEvent,
    hasConflictingEvent,
    isCalendarConfigured,
} = require('./calendar')
const { sendChunkedMessages } = require('./message-utils')

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Mexico_City'
const DEFAULT_APPOINTMENT_DURATION_MINUTES = Number(
    process.env.DEFAULT_APPOINTMENT_DURATION_MINUTES || 45
)
const MINIMUM_NOTICE_MINUTES = 120

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

const noticeInMilliseconds = MINIMUM_NOTICE_MINUTES * 60 * 1000

const buildFormatterPartsObject = (parts) =>
    parts.reduce((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value
        }
        return acc
    }, {})

const toNumberOr = (value, fallback = 0) => {
    const number = Number(value)
    return Number.isNaN(number) ? fallback : number
}

const buildZonedDate = (dateParts, timeParts, timeZone) => {
    if (!dateParts || !timeParts) return null

    const desiredUtc = Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        timeParts.hour,
        timeParts.minute,
        0
    )

    let guess = desiredUtc

    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })

        for (let index = 0; index < 3; index += 1) {
            const formattedParts = buildFormatterPartsObject(
                formatter.formatToParts(new Date(guess))
            )

            const localUtc = Date.UTC(
                toNumberOr(formattedParts.year, dateParts.year),
                toNumberOr(formattedParts.month, dateParts.month) - 1,
                toNumberOr(formattedParts.day, dateParts.day),
                toNumberOr(formattedParts.hour, timeParts.hour),
                toNumberOr(formattedParts.minute, timeParts.minute),
                toNumberOr(formattedParts.second, 0)
            )

            const diff = desiredUtc - localUtc

            guess += diff

            if (Math.abs(diff) < 1000) {
                break
            }
        }
    } catch (error) {
        if (error instanceof RangeError) {
            return null
        }
        throw error
    }

    return new Date(guess)
}

const isWeekendInTimeZone = (date, timeZone) => {
    const weekday = new Intl.DateTimeFormat('es-MX', {
        weekday: 'long',
        timeZone,
    })
        .format(date)
        .toLowerCase()

    return weekday.includes('sábado') || weekday.includes('sabado') || weekday.includes('domingo')
}

const isValidTimeZone = (timeZone) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
        return true
    } catch (error) {
        return false
    }
}

const START_KEYWORDS = [
    /agendar\s+(una\s+)?(cita|llamada)/i,
    /reservar\s+(una\s+)?(cita|llamada)/i,
]

const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 15

const CANCEL_KEYWORDS = [/cancelar/i, /ya\s+no/i]

const resetSchedulingState = async (state) => {
    await state.update({
        scheduling: null,
    })
}

const startSchedulingFlow = async (ctx, { flowDynamic, state, provider }) => {
    if (!isCalendarConfigured()) {
        await sendChunkedMessages(
            flowDynamic,
            'Por ahora no puedo agendar automáticamente porque falta configurar la conexión con Google Calendar. Contacta al equipo técnico para completar la configuración.',
            { ctx, provider }
        )
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

    await sendChunkedMessages(
        flowDynamic,
        '¡Perfecto! Empecemos con tu cita. Atendemos llamadas de lunes a viernes y necesitamos al menos 2 horas de anticipación. ¿Cuál es tu nombre completo?',
        { ctx, provider }
    )

    return true
}

const handleCancellation = async (ctx, { flowDynamic, state, provider }) => {
    await sendChunkedMessages(
        flowDynamic,
        'He cancelado el proceso de agenda. Si deseas retomarlo, solo escribe "Agendar cita" cuando quieras.',
        { ctx, provider }
    )
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

const buildDateFromOffset = (referenceDate, offsetDays) => {
    const base = new Date(
        Date.UTC(
            referenceDate.getUTCFullYear(),
            referenceDate.getUTCMonth(),
            referenceDate.getUTCDate(),
            0,
            0,
            0,
            0
        )
    )
    const candidate = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000)
    return {
        year: candidate.getUTCFullYear(),
        month: candidate.getUTCMonth() + 1,
        day: candidate.getUTCDate(),
    }
}

const parseRelativeDate = (normalizedInput, referenceDate) => {
    if (/pasado\s*mañana/.test(normalizedInput)) {
        return buildDateFromOffset(referenceDate, 2)
    }

    if (/mañana/.test(normalizedInput)) {
        return buildDateFromOffset(referenceDate, 1)
    }

    if (/(hoy|el\s+d[ií]a\s+de\s+hoy)/.test(normalizedInput)) {
        return buildDateFromOffset(referenceDate, 0)
    }

    const inDaysMatch = normalizedInput.match(/en\s+(\d{1,2})\s+d[ií]as?/)
    if (inDaysMatch) {
        return buildDateFromOffset(referenceDate, Number(inDaysMatch[1]))
    }

    return null
}

const parseNumericDate = (normalizedInput, referenceDate) => {
    const isoMatch = normalizedInput.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/)
    if (isoMatch) {
        const [, year, month, day] = isoMatch.map(Number)
        return { parts: { year, month, day }, explicitYear: true }
    }

    const shortMatch = normalizedInput.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/)
    if (shortMatch) {
        const day = Number(shortMatch[1])
        const month = Number(shortMatch[2])
        let year = shortMatch[3] ? Number(shortMatch[3]) : referenceDate.getUTCFullYear()

        if (year < 100) {
            year += 2000
        }

        return { parts: { year, month, day }, explicitYear: Boolean(shortMatch[3]) }
    }

    return null
}

const MONTH_NAME_TO_NUMBER = MONTH_NAMES.reduce((acc, name, index) => {
    acc[name] = index + 1
    return acc
}, {})

const parseTextualDate = (normalizedInput, referenceDate) => {
    const monthRegex = new RegExp(`\b(${MONTH_NAMES.join('|')})\b`, 'i')
    const monthMatch = normalizedInput.match(monthRegex)
    if (!monthMatch) return null

    const monthName = monthMatch[1].toLowerCase()
    const month = MONTH_NAME_TO_NUMBER[monthName]

    let day = null
    const beforeRegex = new RegExp(`(\d{1,2})\s*(?:de\s+)?${monthName}`)
    const beforeMatch = normalizedInput.match(beforeRegex)
    if (beforeMatch) {
        day = Number(beforeMatch[1])
    }

    if (day === null) {
        const afterRegex = new RegExp(`${monthName}\s*(?:del\s+año\s+)?(\d{1,2})`)
        const afterMatch = normalizedInput.match(afterRegex)
        if (afterMatch) {
            day = Number(afterMatch[1])
        }
    }

    if (day === null) return null

    const yearMatch = normalizedInput.match(/\b(\d{4})\b/)
    const explicitYear = Boolean(yearMatch)
    const year = yearMatch ? Number(yearMatch[1]) : referenceDate.getUTCFullYear()

    return { parts: { year, month, day }, explicitYear }
}

const ensureFutureDate = (parts, explicitYear, referenceDate) => {
    const candidate = parseDateParts(
        `${parts.year}-${padNumber(parts.month)}-${padNumber(parts.day)}`
    )
    if (!candidate) return null

    if (explicitYear) return candidate

    const referenceUTC = Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate()
    )

    let candidateUTC = Date.UTC(candidate.year, candidate.month - 1, candidate.day)
    if (candidateUTC < referenceUTC) {
        const updated = parseDateParts(
            `${candidate.year + 1}-${padNumber(candidate.month)}-${padNumber(candidate.day)}`
        )
        if (updated) {
            candidateUTC = Date.UTC(updated.year, updated.month - 1, updated.day)
            return updated
        }
    }

    return candidate
}

const parseFlexibleDateInput = (input, referenceDate = new Date()) => {
    if (!input) return null

    const normalized = input.trim().toLowerCase()
    if (!normalized) return null

    const relativeResult = parseRelativeDate(normalized, referenceDate)
    if (relativeResult) return relativeResult

    const numericResult = parseNumericDate(normalized, referenceDate)
    if (numericResult) {
        return ensureFutureDate(numericResult.parts, numericResult.explicitYear, referenceDate)
    }

    const textualResult = parseTextualDate(normalized, referenceDate)
    if (textualResult) {
        return ensureFutureDate(textualResult.parts, textualResult.explicitYear, referenceDate)
    }

    return null
}

const isWithinBusinessHours = (hour, minute) => {
    if (hour < BUSINESS_START_HOUR) return false
    if (hour > BUSINESS_END_HOUR) return false
    if (hour === BUSINESS_END_HOUR && minute > 0) return false
    return true
}

const parseFlexibleTimeInput = (input) => {
    if (!input) return { status: 'invalid' }

    const normalized = input.trim().toLowerCase()
    if (!normalized) return { status: 'invalid' }

    const timeMatch = normalized.match(/(\d{1,2})(?:[:h\.](\d{2}))?/)
    if (!timeMatch) return { status: 'invalid' }

    let hour = Number(timeMatch[1])
    const minute = timeMatch[2] ? Number(timeMatch[2]) : 0

    if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) {
        return { status: 'invalid' }
    }

    const mentionsAfternoon = /(pm|p\.m|tarde|noche)/.test(normalized)
    const mentionsMorning = /(am|a\.m|mañana|madrugada|temprano)/.test(normalized)

    if (mentionsAfternoon && hour < 12) {
        hour += 12
    }

    if (mentionsMorning && hour === 12) {
        hour = 0
    }

    if (!mentionsAfternoon && !mentionsMorning && hour <= 12) {
        if (hour < BUSINESS_START_HOUR && hour !== 0) {
            const suggestedHour = hour + 12 <= 23 ? hour + 12 : hour
            return {
                status: 'clarify',
                suggestion: {
                    hour: suggestedHour,
                    minute,
                },
            }
        }
    }

    if (hour > 23) {
        return { status: 'invalid' }
    }

    if (!isWithinBusinessHours(hour, minute)) {
        return {
            status: 'out_of_range',
            hour,
            minute,
        }
    }

    return {
        status: 'ok',
        hour,
        minute,
    }
}

const finalizeScheduling = async (ctx, tools, scheduling) => {
    const { flowDynamic, state, provider } = tools
    const { name, email, date, time, notes, phone, timeZone } = scheduling.data
    const zone = timeZone || DEFAULT_TIMEZONE

    const dateParts = parseDateParts(date)
    const timeParts = parseTimeParts(time)

    if (!dateParts || !timeParts) {
        await sendChunkedMessages(
            flowDynamic,
            'No pude interpretar la fecha y hora proporcionadas. Revisa el formato (AAAA-MM-DD para la fecha y HH:MM en formato de 24 horas) e intenta nuevamente.',
            { ctx, provider }
        )
        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectDate',
            },
        })
        return true
    }

    if (!isValidTimeZone(zone)) {
        await sendChunkedMessages(
            flowDynamic,
            'La zona horaria configurada no es válida. Indícame nuevamente un horario válido, por favor.',
            { ctx, provider }
        )

        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectTime',
            },
        })
        return true
    }

    const startDate = buildZonedDate(dateParts, timeParts, zone)

    if (!startDate) {
        await sendChunkedMessages(
            flowDynamic,
            'No logré interpretar la combinación de fecha, hora y zona horaria. Vamos a elegir el horario nuevamente.',
            { ctx, provider }
        )

        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectTime',
            },
        })
        return true
    }

    if (isWeekendInTimeZone(startDate, zone)) {
        await sendChunkedMessages(
            flowDynamic,
            'Los sábados y domingos no ofrecemos atención en tiempo real ni llamadas. Elige un día de lunes a viernes, por favor.',
            { ctx, provider }
        )

        const { notes: _notes, ...restData } = scheduling.data
        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectDate',
                data: {
                    ...restData,
                },
            },
        })
        return true
    }

    const now = new Date()
    if (startDate.getTime() - now.getTime() < noticeInMilliseconds) {
        await sendChunkedMessages(
            flowDynamic,
            'Necesitamos al menos 2 horas de anticipación para agendar. Indícame otro horario que cumpla con ese requisito.',
            { ctx, provider }
        )

        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectTime',
            },
        })
        return true
    }

    const startIso = buildIsoDateTime(dateParts, timeParts)
    const endInfo = addMinutesToDateTime(
        dateParts,
        timeParts,
        DEFAULT_APPOINTMENT_DURATION_MINUTES
    )
    const endDate = buildZonedDate(endInfo.dateParts, endInfo.timeParts, zone)

    if (!endDate) {
        await sendChunkedMessages(
            flowDynamic,
            'No logré interpretar la hora de término para ese horario. Intentemos de nuevo con otro horario.',
            { ctx, provider }
        )

        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectTime',
            },
        })
        return true
    }

    try {
        const conflict = await hasConflictingEvent({ startDate, endDate })
        if (conflict) {
            await sendChunkedMessages(
                flowDynamic,
                'Ya existe una cita reservada para ese horario. Elige otro horario disponible dentro del rango de atención.',
                { ctx, provider }
            )

            await state.update({
                scheduling: {
                    ...scheduling,
                    step: 'collectTime',
                },
            })
            return true
        }
    } catch (error) {
        console.error('Error al verificar disponibilidad del calendario:', error)
        await sendChunkedMessages(
            flowDynamic,
            'No logré verificar la disponibilidad del calendario en este momento. Intenta con otro horario o vuelve a intentarlo más tarde.',
            { ctx, provider }
        )

        await state.update({
            scheduling: {
                ...scheduling,
                step: 'collectTime',
            },
        })
        return true
    }

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

        const confirmationMessages = [
            `¡Listo! Tu cita quedó agendada para el ${formatDateForHumans(
                dateParts
            )} a las ${formatTimeForHumans(timeParts)} (${zone}).`,
        ]

        const extraDetails = [`Te enviaremos la confirmación al correo ${email}.`]
        if (event.htmlLink) {
            extraDetails.push(`Puedes revisar el detalle aquí: ${event.htmlLink}`)
        }

        confirmationMessages.push(extraDetails.join(' '))

        await sendChunkedMessages(flowDynamic, confirmationMessages, { ctx, provider })
    } catch (error) {
        console.error('Error al crear evento en Google Calendar:', error)

        if (error.message === 'GOOGLE_CALENDAR_MISSING_CONFIG') {
            await sendChunkedMessages(
                flowDynamic,
                'No logré conectar con Google Calendar porque la configuración está incompleta. Por favor, solicita al equipo técnico completar las variables de entorno necesarias y vuelve a intentarlo.',
                { ctx, provider }
            )
        } else {
            await sendChunkedMessages(
                flowDynamic,
                'Ocurrió un inconveniente al crear la cita. Notificaré al equipo para que continúe el proceso contigo manualmente.',
                { ctx, provider }
            )
        }
    }

    await resetSchedulingState(state)

    return true
}

const continueSchedulingFlow = async (ctx, tools, scheduling) => {
    const { flowDynamic, state, provider } = tools
    const message = ctx.body.trim()

    if (CANCEL_KEYWORDS.some((regex) => regex.test(message))) {
        await handleCancellation(ctx, tools)
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

            await sendChunkedMessages(
                flowDynamic,
                'Gracias. ¿Cuál es tu correo electrónico para enviarte la confirmación?',
                { ctx, provider }
            )

            return true
        }
        case 'collectEmail': {
            const email = message.toLowerCase()
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

            if (!emailRegex.test(email)) {
                await sendChunkedMessages(
                    flowDynamic,
                    'Parece que el correo no es válido. Intenta nuevamente con un formato como nombre@dominio.com.',
                    { ctx, provider }
                )
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

            await sendChunkedMessages(
                flowDynamic,
                'Perfecto. ¿Para qué fecha necesitas la llamada? Puedes escribirla como “15 de mayo”, “15/05” o con tu formato preferido. Recuerda que las llamadas se agendan de lunes a viernes.',
                { ctx, provider }
            )

            return true
        }
        case 'collectDate': {
            const referenceDate = new Date()
            const parsedDate = parseFlexibleDateInput(message, referenceDate)

            if (!parsedDate) {
                await sendChunkedMessages(
                    flowDynamic,
                    'No logré interpretar esa fecha. Puedes decirme “15 de mayo”, “15/05/2024” o frases como “mañana”.',
                    { ctx, provider }
                )
                return true
            }

            const normalizedDate = `${parsedDate.year}-${padNumber(parsedDate.month)}-${padNumber(
                parsedDate.day
            )}`
            await state.update({
                scheduling: {
                    step: 'collectTime',
                    data: {
                        ...scheduling.data,
                        date: normalizedDate,
                    },
                },
            })

            await sendChunkedMessages(
                flowDynamic,
                `Tomé nota para el ${formatDateForHumans(parsedDate)}. ¿A qué hora te viene mejor? Puedes decir “1 pm”, “13:30” o “mediodía”. Si necesitas otra zona horaria distinta a ${DEFAULT_TIMEZONE}, menciónalo.`,
                { ctx, provider }
            )

            return true
        }
        case 'collectTime': {
            const timezoneMatch = message.match(/GMT[+-]\d{1,2}|UTC[+-]\d{1,2}|[A-Za-z]+\/[A-Za-z_]+/)
            const parsedTime = parseFlexibleTimeInput(message)

            if (parsedTime.status === 'invalid') {
                await sendChunkedMessages(
                    flowDynamic,
                    'No logré interpretar la hora. Dime algo como “11:30”, “1 pm” o “13 horas”.',
                    { ctx, provider }
                )
                return true
            }

            if (parsedTime.status === 'clarify') {
                await sendChunkedMessages(
                    flowDynamic,
                    `¿Te refieres a las ${formatTimeForHumans(parsedTime.suggestion)}? Nuestro horario de atención es de 09:00 a 15:00. Elige un horario dentro de ese rango, por favor.`,
                    { ctx, provider }
                )
                return true
            }

            if (parsedTime.status === 'out_of_range') {
                const attemptedTime = {
                    hour: parsedTime.hour,
                    minute: parsedTime.minute,
                }
                await sendChunkedMessages(
                    flowDynamic,
                    `El horario ${formatTimeForHumans(attemptedTime)} queda fuera de nuestro servicio. Podemos atenderte entre 09:00 y 15:00. Indícame otra hora dentro de ese rango.`,
                    { ctx, provider }
                )
                return true
            }

            const timeParts = {
                hour: parsedTime.hour,
                minute: parsedTime.minute,
            }
            const time = `${padNumber(timeParts.hour)}:${padNumber(timeParts.minute)}`
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

            if (!isValidTimeZone(timeZone)) {
                await sendChunkedMessages(
                    flowDynamic,
                    'No reconocí esa zona horaria. Puedes indicarme una zona en formato “America/Mexico_City” o “UTC-5”.',
                    { ctx, provider }
                )
                return true
            }

            const dateParts = parseDateParts(scheduling.data.date)
            if (!dateParts) {
                await sendChunkedMessages(
                    flowDynamic,
                    'Necesito que elijamos nuevamente la fecha antes de continuar con el horario.',
                    { ctx, provider }
                )

                const { date: _ignoredDate, ...restData } = scheduling.data
                await state.update({
                    scheduling: {
                        ...scheduling,
                        step: 'collectDate',
                        data: {
                            ...restData,
                        },
                    },
                })

                return true
            }

            const startDate = buildZonedDate(dateParts, timeParts, timeZone)
            if (!startDate) {
                await sendChunkedMessages(
                    flowDynamic,
                    'No logré interpretar la fecha y hora con la zona horaria indicada. Inténtalo nuevamente, por favor.',
                    { ctx, provider }
                )
                return true
            }

            if (isWeekendInTimeZone(startDate, timeZone)) {
                await sendChunkedMessages(
                    flowDynamic,
                    'Los sábados y domingos no ofrecemos atención en tiempo real ni llamadas. Elige un día entre lunes y viernes.',
                    { ctx, provider }
                )

                const { date: _date, ...restData } = scheduling.data
                await state.update({
                    scheduling: {
                        ...scheduling,
                        step: 'collectDate',
                        data: {
                            ...restData,
                        },
                    },
                })

                return true
            }

            const now = new Date()
            if (startDate.getTime() - now.getTime() < noticeInMilliseconds) {
                await sendChunkedMessages(
                    flowDynamic,
                    'Necesitamos al menos 2 horas de anticipación para agendar. Indícame otro horario que cumpla con ese requisito.',
                    { ctx, provider }
                )
                return true
            }

            const endInfo = addMinutesToDateTime(
                dateParts,
                timeParts,
                DEFAULT_APPOINTMENT_DURATION_MINUTES
            )
            const endDate = buildZonedDate(endInfo.dateParts, endInfo.timeParts, timeZone)

            if (!endDate) {
                await sendChunkedMessages(
                    flowDynamic,
                    'No logré interpretar la hora de término para ese horario. Intenta con otra opción, por favor.',
                    { ctx, provider }
                )
                return true
            }

            try {
                const conflict = await hasConflictingEvent({ startDate, endDate })
                if (conflict) {
                    await sendChunkedMessages(
                        flowDynamic,
                        'Ya contamos con una cita en ese horario. Elige otra hora disponible dentro del horario de atención.',
                        { ctx, provider }
                    )
                    return true
                }
            } catch (error) {
                console.error('Error al verificar disponibilidad del calendario:', error)
                await sendChunkedMessages(
                    flowDynamic,
                    'No logré verificar la disponibilidad de ese horario. Intenta con otra hora o vuelve a intentarlo en unos minutos.',
                    { ctx, provider }
                )
                return true
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

            await sendChunkedMessages(
                flowDynamic,
                '¿Hay algo adicional que debamos tener en cuenta para la llamada? Puedes escribir "No" si no es necesario.',
                { ctx, provider }
            )

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
