const { businessInfo } = require('./context')
const {
    createCalendarEvent,
    hasConflictingEvent,
    isCalendarConfigured,
    listCalendarEvents,
} = require('./calendar')
const { sendChunkedMessages } = require('./message-utils')

const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'America/Mexico_City'
const DEFAULT_APPOINTMENT_DURATION_MINUTES = Number(
    process.env.DEFAULT_APPOINTMENT_DURATION_MINUTES || 30
)
const MINIMUM_NOTICE_MINUTES = 60
const SUGGESTION_SLOT_MINUTES = 30
const MAX_SUGGESTION_SLOTS = 5
const MAX_SUGGESTION_DAYS = 14
const TIME_INDICATOR_REGEX =
    /(\d{1,2}\s*(?:am|a\.m|pm|p\.m|horas?|hrs?))|(\d{1,2}[:h\.](\d{2}))|(a\s+las\s+\d{1,2})|(mediod[ií]a)|(medianoche)/i

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

const normalizeText = (text = '') =>
    String(text)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()

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

const minutesToMilliseconds = (minutes) => minutes * 60 * 1000

const normalizeTimeZoneInput = (rawZone) => {
    if (!rawZone) return null

    if (/^GMT[+-]\d{1,2}$/i.test(rawZone)) {
        return rawZone.replace(/^GMT/i, 'UTC')
    }

    if (/^UTC[+-]\d{1,2}$/i.test(rawZone)) {
        return rawZone.toUpperCase()
    }

    return rawZone
}

const hasExplicitTimeReference = (message = '') => {
    if (!message || typeof message !== 'string') return false
    return TIME_INDICATOR_REGEX.test(message)
}

const getDatePartsInTimeZone = (date, timeZone) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
    const parts = buildFormatterPartsObject(formatter.formatToParts(date))

    const year = toNumberOr(parts.year)
    const month = toNumberOr(parts.month)
    const day = toNumberOr(parts.day)

    if ([year, month, day].some((value) => Number.isNaN(value))) {
        return null
    }

    return { year, month, day }
}

const getTimePartsInTimeZone = (date, timeZone) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
    const parts = buildFormatterPartsObject(formatter.formatToParts(date))

    const hour = toNumberOr(parts.hour)
    const minute = toNumberOr(parts.minute)

    if ([hour, minute].some((value) => Number.isNaN(value))) {
        return null
    }

    return { hour, minute }
}

const alignSlotStart = (candidate, dayStart, slotMinutes) => {
    const diff = candidate.getTime() - dayStart.getTime()
    if (diff <= 0) {
        return new Date(dayStart.getTime())
    }

    const interval = minutesToMilliseconds(slotMinutes)
    const multiplier = Math.ceil(diff / interval)
    return new Date(dayStart.getTime() + multiplier * interval)
}

const parseEventBoundary = (boundary) => {
    if (!boundary) return null
    if (boundary.dateTime) {
        const candidate = new Date(boundary.dateTime)
        if (!Number.isNaN(candidate.getTime())) {
            return candidate
        }
    }

    if (boundary.date) {
        const candidate = new Date(`${boundary.date}T00:00:00Z`)
        if (!Number.isNaN(candidate.getTime())) {
            return candidate
        }
    }

    return null
}

const buildBusyIntervals = (events = []) =>
    events
        .filter((event) => event?.status !== 'cancelled')
        .map((event) => ({
            start: parseEventBoundary(event?.start),
            end: parseEventBoundary(event?.end),
        }))
        .filter(({ start, end }) => start instanceof Date && end instanceof Date)
        .sort((a, b) => a.start.getTime() - b.start.getTime())

const isSlotFree = (busyIntervals, slotStart, slotEnd) =>
    busyIntervals.every(({ start, end }) => slotEnd <= start || slotStart >= end)

const getUserState = (state) =>
    (typeof state.getMyState === 'function' ? state.getMyState() : state) || {}

const clearAvailabilitySuggestions = async (state) => {
    await state.update({ availabilitySuggestions: null })
}

const findAvailableSlots = async ({
    startDate = new Date(),
    maxSlots = 2,
    slotMinutes = SUGGESTION_SLOT_MINUTES,
    timeZone = DEFAULT_TIMEZONE,
} = {}) => {
    if (!isCalendarConfigured()) return []

    const baseline = new Date(Date.now() + noticeInMilliseconds)
    const effectiveStart =
        startDate && startDate.getTime() > baseline.getTime() ? startDate : baseline

    const slots = []
    let searchDate = new Date(effectiveStart.getTime())
    let daysChecked = 0

    while (slots.length < maxSlots && daysChecked < MAX_SUGGESTION_DAYS) {
        const dayParts = getDatePartsInTimeZone(searchDate, timeZone)
        if (!dayParts) break

        const midday = buildZonedDate(dayParts, { hour: 12, minute: 0 }, timeZone)
        if (!midday) break

        if (isWeekendInTimeZone(midday, timeZone)) {
            const nextDayInfo = addMinutesToDateTime(dayParts, { hour: 0, minute: 0 }, 24 * 60)
            searchDate = buildZonedDate(nextDayInfo.dateParts, nextDayInfo.timeParts, timeZone)
            daysChecked += 1
            continue
        }

        const dayStart = buildZonedDate(
            dayParts,
            { hour: BUSINESS_START_HOUR, minute: 0 },
            timeZone
        )
        const dayEnd = buildZonedDate(
            dayParts,
            { hour: BUSINESS_END_HOUR, minute: 0 },
            timeZone
        )

        if (!dayStart || !dayEnd) {
            break
        }

        let earliestStart = dayStart.getTime() > effectiveStart.getTime()
            ? dayStart
            : effectiveStart

        earliestStart = alignSlotStart(new Date(earliestStart.getTime()), dayStart, slotMinutes)

        let events = []
        try {
            const response = await listCalendarEvents({
                timeMin: dayStart.toISOString(),
                timeMax: dayEnd.toISOString(),
            })
            events = Array.isArray(response?.items) ? response.items : []
        } catch (error) {
            console.error('Error al obtener eventos del calendario:', error)
            break
        }

        const busyIntervals = buildBusyIntervals(events)
        const intervalMs = minutesToMilliseconds(slotMinutes)

        for (
            let slotStart = new Date(earliestStart.getTime());
            slotStart.getTime() < dayEnd.getTime() && slots.length < maxSlots;
            slotStart = new Date(slotStart.getTime() + intervalMs)
        ) {
            const slotEnd = new Date(slotStart.getTime() + intervalMs)
            if (slotEnd.getTime() > dayEnd.getTime()) {
                break
            }

            if (!isSlotFree(busyIntervals, slotStart, slotEnd)) {
                continue
            }

            const timeParts = getTimePartsInTimeZone(slotStart, timeZone)
            const endTimeParts = getTimePartsInTimeZone(slotEnd, timeZone)

            if (!timeParts || !endTimeParts) {
                continue
            }

            slots.push({
                startDate: new Date(slotStart.getTime()),
                endDate: new Date(slotEnd.getTime()),
                dateParts: { ...dayParts },
                timeParts,
                endTimeParts,
            })
        }

        const nextDayInfo = addMinutesToDateTime(dayParts, { hour: 0, minute: 0 }, 24 * 60)
        const nextDayStart = buildZonedDate(nextDayInfo.dateParts, nextDayInfo.timeParts, timeZone)
        if (!nextDayStart) {
            break
        }

        searchDate = new Date(
            Math.max(nextDayStart.getTime(), effectiveStart.getTime())
        )
        daysChecked += 1
    }

    return slots
}

const describeSlotDay = (slotDateParts, referenceDateParts, timeZone) => {
    const referenceStart = buildZonedDate(referenceDateParts, { hour: 0, minute: 0 }, timeZone)
    const slotStart = buildZonedDate(slotDateParts, { hour: 0, minute: 0 }, timeZone)

    if (!referenceStart || !slotStart) {
        return formatDateForHumans(slotDateParts)
    }

    const diffDays = Math.round(
        (slotStart.getTime() - referenceStart.getTime()) / (24 * 60 * 60 * 1000)
    )

    if (diffDays === 0) {
        return `Hoy (${formatDateForHumans(slotDateParts)})`
    }

    if (diffDays === 1) {
        return `Mañana (${formatDateForHumans(slotDateParts)})`
    }

    return formatDateForHumans(slotDateParts)
}

const buildAvailabilityMessage = (slots, { intro, closing } = {}) => {
    const timeZone = DEFAULT_TIMEZONE
    const todayParts = getDatePartsInTimeZone(new Date(), timeZone)
    const lines = slots.map((slot) => {
        const dayLabel = describeSlotDay(slot.dateParts, todayParts, timeZone)
        return `• ${dayLabel} de ${formatTimeForHumans(slot.timeParts)} a ${formatTimeForHumans(
            slot.endTimeParts
        )}`
    })

    const heading = intro || 'Estas son las próximas opciones disponibles:'
    const closingLine =
        closing ||
        '¿Alguno de esos horarios se acomoda? Para mostrar más horarios responde "mostrar más horarios".'

    return [heading, ...lines, closingLine].join('\n')
}

const buildDateSpecificAvailabilityMessage = (slots, dateParts, timeZone) => {
    const header = `Para el ${formatDateForHumans(dateParts)} tengo estos espacios disponibles (hora local de ${timeZone}):`
    const lines = slots.map((slot) =>
        `• ${formatTimeForHumans(slot.timeParts)} a ${formatTimeForHumans(slot.endTimeParts)}`
    )

    return [
        header,
        ...lines,
        'Si alguno te funciona, dime "Agendar cita" con el horario elegido y continúo con tu registro.',
    ].join('\n')
}

const sendAvailabilitySuggestions = async (
    ctx,
    { flowDynamic, state, provider },
    {
        startDate = new Date(),
        maxSlots = 2,
        intro = 'Estas son las próximas opciones disponibles:',
        fallbackMessage = 'Por ahora no veo horarios disponibles dentro del horario de atención.',
    } = {}
) => {
    const slots = await findAvailableSlots({
        startDate,
        maxSlots,
        slotMinutes: SUGGESTION_SLOT_MINUTES,
        timeZone: DEFAULT_TIMEZONE,
    })

    if (!slots.length) {
        await clearAvailabilitySuggestions(state)
        if (fallbackMessage) {
            await sendChunkedMessages(flowDynamic, fallbackMessage, { ctx, provider })
        }
        return false
    }

    const message = buildAvailabilityMessage(slots, { intro })

    await sendChunkedMessages(flowDynamic, message, {
        ctx,
        provider,
        preserveFormatting: true,
    })

    const lastSlot = slots[slots.length - 1]

    await updateAvailabilitySuggestionsState(state, lastSlot)

    return true
}

const updateAvailabilitySuggestionsState = async (state, slot) => {
    if (!slot) {
        await clearAvailabilitySuggestions(state)
        return
    }

    await state.update({
        availabilitySuggestions: {
            nextSearchIso: slot.endDate.toISOString(),
            timeZone: DEFAULT_TIMEZONE,
            slotMinutes: SUGGESTION_SLOT_MINUTES,
        },
    })
}

const getAvailabilityForDate = async (
    dateParts,
    { timeZone = DEFAULT_TIMEZONE, maxSlots = MAX_SUGGESTION_SLOTS } = {}
) => {
    if (!dateParts) return []

    const startOfDay = buildZonedDate(
        dateParts,
        { hour: BUSINESS_START_HOUR, minute: 0 },
        timeZone
    )

    if (!startOfDay) return []

    const slots = await findAvailableSlots({
        startDate: startOfDay,
        maxSlots,
        slotMinutes: SUGGESTION_SLOT_MINUTES,
        timeZone,
    })

    return slots.filter(
        (slot) =>
            slot.dateParts.year === dateParts.year &&
            slot.dateParts.month === dateParts.month &&
            slot.dateParts.day === dateParts.day
    )
}

const presentAvailabilitySlots = async (
    ctx,
    tools,
    slots,
    {
        intro = 'Estas son las próximas opciones disponibles:',
        closing = '¿Alguno de esos horarios se acomoda? Para mostrar más horarios responde "mostrar más horarios".',
    } = {}
) => {
    const { flowDynamic, state, provider } = tools

    if (!Array.isArray(slots) || !slots.length) {
        await updateAvailabilitySuggestionsState(state, null)
        return false
    }

    const message = buildAvailabilityMessage(slots, { intro, closing })

    await sendChunkedMessages(flowDynamic, message, {
        ctx,
        provider,
        preserveFormatting: true,
    })

    await updateAvailabilitySuggestionsState(state, slots[slots.length - 1])

    return true
}

const sendEarliestAvailableSlot = async (
    ctx,
    tools,
    { dateParts = null, timeZone = DEFAULT_TIMEZONE } = {}
) => {
    const { flowDynamic, state, provider } = tools

    let slots = []

    if (dateParts) {
        slots = await getAvailabilityForDate(dateParts, { timeZone, maxSlots: 1 })
    } else {
        slots = await findAvailableSlots({
            startDate: new Date(),
            maxSlots: 1,
            slotMinutes: SUGGESTION_SLOT_MINUTES,
            timeZone,
        })
    }

    if (!slots.length) {
        await clearAvailabilitySuggestions(state)

        const message = dateParts
            ? `No veo horarios libres para el ${formatDateForHumans(
                  dateParts
              )}. Indícame otra fecha y vuelvo a revisar.`
            : 'Por ahora no encuentro horarios disponibles dentro del horario de atención. Dime una fecha específica y reviso opciones.'

        await sendChunkedMessages(flowDynamic, message, { ctx, provider })
        return true
    }

    const slot = slots[0]
    const referenceParts = getDatePartsInTimeZone(new Date(), timeZone)
    const dayLabel = dateParts
        ? formatDateForHumans(slot.dateParts)
        : describeSlotDay(slot.dateParts, referenceParts, timeZone)

    const intro = dateParts
        ? `El primer horario disponible para el ${dayLabel} es de ${formatTimeForHumans(
              slot.timeParts
          )} a ${formatTimeForHumans(slot.endTimeParts)} (hora local de ${timeZone}).`
        : `La siguiente opción disponible es ${dayLabel} de ${formatTimeForHumans(
              slot.timeParts
          )} a ${formatTimeForHumans(slot.endTimeParts)} (hora local de ${timeZone}).`

    const closing = dateParts
        ? 'Si te funciona, indícame esa hora o dime otra fecha para revisar nuevos horarios.'
        : 'Si te funciona, dime esa hora o indícame una fecha específica para revisar más opciones.'

    await sendChunkedMessages(flowDynamic, [intro, closing], { ctx, provider })

    await updateAvailabilitySuggestionsState(state, slot)

    return true
}

const sendDateSpecificAvailability = async (ctx, tools, { dateParts, timeZone }) => {
    const { flowDynamic, state, provider } = tools

    const dayStart = buildZonedDate(dateParts, { hour: BUSINESS_START_HOUR, minute: 0 }, timeZone)
    const dayEnd = buildZonedDate(dateParts, { hour: BUSINESS_END_HOUR, minute: 0 }, timeZone)

    if (!dayStart || !dayEnd) {
        await sendChunkedMessages(
            flowDynamic,
            'No logré interpretar esa fecha dentro de nuestro horario de servicio. Intenta nuevamente, por favor.',
            { ctx, provider }
        )
        return true
    }

    const slots = await findAvailableSlots({
        startDate: dayStart,
        maxSlots: MAX_SUGGESTION_SLOTS,
        slotMinutes: SUGGESTION_SLOT_MINUTES,
        timeZone,
    })

    const sameDaySlots = slots.filter(
        (slot) =>
            slot.dateParts.year === dateParts.year &&
            slot.dateParts.month === dateParts.month &&
            slot.dateParts.day === dateParts.day
    )

    if (!sameDaySlots.length) {
        await clearAvailabilitySuggestions(state)
        await sendChunkedMessages(
            flowDynamic,
            `No veo horarios disponibles para el ${formatDateForHumans(
                dateParts
            )}. Puedes indicarme otra fecha o pedir "Horarios disponibles" para revisar otras opciones.`,
            { ctx, provider }
        )
        return true
    }

    const message = buildDateSpecificAvailabilityMessage(sameDaySlots, dateParts, timeZone)

    await sendChunkedMessages(flowDynamic, message, {
        ctx,
        provider,
        preserveFormatting: true,
    })

    const lastSlot = sameDaySlots[sameDaySlots.length - 1]

    await state.update({
        availabilitySuggestions: {
            nextSearchIso: lastSlot.endDate.toISOString(),
            timeZone,
            slotMinutes: SUGGESTION_SLOT_MINUTES,
        },
    })

    return true
}

const handleAvailabilityInquiry = async (ctx, tools) => {
    const message = ctx?.body?.trim()
    if (!message) return false

    const { flowDynamic, state, provider } = tools
    const userState = getUserState(state)
    const schedulingStep = userState?.scheduling?.step

    if (!schedulingStep && matchesAsapRequest(message)) {
        if (!isCalendarConfigured()) {
            await sendChunkedMessages(
                flowDynamic,
                'Aún no tengo acceso a la agenda para consultar los horarios disponibles. Solicita al equipo técnico que complete la configuración de Google Calendar.',
                { ctx, provider }
            )
            return true
        }

        await sendEarliestAvailableSlot(ctx, tools)
        return true
    }

    if (!schedulingStep && matchesDateChangeRequest(message)) {
        await sendChunkedMessages(
            flowDynamic,
            'Claro, dime la nueva fecha que quieres revisar y consulto los horarios disponibles.',
            { ctx, provider }
        )
        return true
    }

    if (SHOW_MORE_AVAILABILITY_PATTERNS.some((regex) => regex.test(message))) {
        if (!isCalendarConfigured()) {
            await sendChunkedMessages(
                flowDynamic,
                'Aún no tengo acceso a la agenda. Pide al equipo técnico que finalice la configuración con Google Calendar.',
                { ctx, provider }
            )
            return true
        }

        const userState = getUserState(state)
        const suggestionsState = userState.availabilitySuggestions

        if (!suggestionsState?.nextSearchIso) {
            await sendChunkedMessages(
                flowDynamic,
                'Pídeme primero "Horarios disponibles" para poder mostrarte las opciones más recientes.',
                { ctx, provider }
            )
            return true
        }

        const startDate = new Date(suggestionsState.nextSearchIso)
        const validStartDate = Number.isNaN(startDate.getTime()) ? new Date() : startDate

        await sendAvailabilitySuggestions(ctx, tools, {
            startDate: validStartDate,
            maxSlots: MAX_SUGGESTION_SLOTS,
            intro: `Aquí tienes más horarios disponibles de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${DEFAULT_TIMEZONE}):`,
            fallbackMessage:
                'Por ahora no tengo más horarios disponibles dentro del horario de atención. Intenta más tarde o elige alguno de los horarios sugeridos anteriormente.',
        })

        return true
    }

    if (schedulingStep !== 'collectDate') {
        const parsedDate = parseFlexibleDateInput(message, new Date())

        if (parsedDate) {
            if (!isCalendarConfigured()) {
                await sendChunkedMessages(
                    flowDynamic,
                    'Aún no tengo acceso a la agenda. Pide al equipo técnico que finalice la configuración con Google Calendar.',
                    { ctx, provider }
                )
                return true
            }

            const slots = await getAvailabilityForDate(parsedDate)
            const formattedDate = formatDateForHumans(parsedDate)

            if (!slots.length) {
                await clearAvailabilitySuggestions(state)
                await sendChunkedMessages(
                    flowDynamic,
                    `Por ahora no veo horarios libres el ${formattedDate}. Puedes indicarme otra fecha o pedir "Horarios disponibles" para revisar opciones cercanas.`,
                    { ctx, provider }
                )
                return true
            }

            await presentAvailabilitySlots(ctx, tools, slots, {
                intro: `Para ${formattedDate} tengo estos horarios disponibles de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${DEFAULT_TIMEZONE}):`,
                closing:
                    'Si alguno de esos horarios te funciona, dime y agendamos tu cita. Para ver más opciones responde "mostrar más horarios".',
            })

            return true
        }
    }

    if (!AVAILABILITY_QUERY_PATTERNS.some((regex) => regex.test(message))) {
        return false
    }

    if (!isCalendarConfigured()) {
        await sendChunkedMessages(
            flowDynamic,
            'Aún no tengo acceso a la agenda para consultar los horarios disponibles. Solicita al equipo técnico que complete la configuración de Google Calendar.',
            { ctx, provider }
        )
        return true
    }

    await sendAvailabilitySuggestions(ctx, tools, {
        startDate: new Date(),
        maxSlots: MAX_SUGGESTION_SLOTS,
        intro: `Estos son los siguientes horarios disponibles de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${DEFAULT_TIMEZONE}):`,
        fallbackMessage:
            'Por ahora no veo espacios disponibles dentro del horario de atención. Intenta más tarde o indícame otro horario de preferencia.',
    })

    return true
}

const handleDateSpecificAvailability = async (ctx, tools) => {
    const message = ctx?.body?.trim()
    if (!message) return false

    const { flowDynamic, state, provider } = tools

    const userState = getUserState(state)
    if (userState?.scheduling?.step === 'collectDate') {
        return false
    }

    const dateParts = parseFlexibleDateInput(message, new Date())
    if (!dateParts) {
        return false
    }

    if (!isCalendarConfigured()) {
        await sendChunkedMessages(
            flowDynamic,
            'Aún no tengo acceso a la agenda para consultar los horarios disponibles. Solicita al equipo técnico que complete la configuración de Google Calendar.',
            { ctx, provider }
        )
        return true
    }

    const timezoneMatch = message.match(/GMT[+-]\d{1,2}|UTC[+-]\d{1,2}|[A-Za-z]+\/[A-Za-z_]+/)
    const timeZone = normalizeTimeZoneInput(timezoneMatch ? timezoneMatch[0] : null) || DEFAULT_TIMEZONE

    if (!isValidTimeZone(timeZone)) {
        await sendChunkedMessages(
            flowDynamic,
            'No reconocí esa zona horaria. Puedes indicarme una zona en formato “America/Mexico_City” o “UTC-5”.',
            { ctx, provider }
        )
        return true
    }

    if (!hasExplicitTimeReference(message)) {
        return sendDateSpecificAvailability(ctx, tools, { dateParts, timeZone })
    }

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

    const startDate = buildZonedDate(dateParts, timeParts, timeZone)
    if (!startDate) {
        await sendChunkedMessages(
            flowDynamic,
            'No logré interpretar la combinación de fecha, hora y zona horaria. Vamos a elegir el horario nuevamente.',
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
        return true
    }

    const now = new Date()
    if (startDate.getTime() - now.getTime() < noticeInMilliseconds) {
        await sendChunkedMessages(
            flowDynamic,
            'Necesitamos al menos 1 hora de anticipación para agendar. Te comparto otras opciones para ese día.',
            { ctx, provider }
        )
        await sendDateSpecificAvailability(ctx, tools, { dateParts, timeZone })
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
                'Ya contamos con una cita en ese horario. Te comparto otras opciones disponibles para ese día.',
                { ctx, provider }
            )
            await sendDateSpecificAvailability(ctx, tools, { dateParts, timeZone })
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

    await clearAvailabilitySuggestions(state)

    await sendChunkedMessages(
        flowDynamic,
        `El ${formatDateForHumans(dateParts)} a las ${formatTimeForHumans(timeParts)} (${timeZone}) está disponible. Si quieres agendarlo, dime "Agendar cita" o indícame si prefieres otro horario.`,
        { ctx, provider }
    )

    return true
}

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

const FALLBACK_START_KEYWORDS = [
    'agendar',
    'agendar cita',
    'agendar una cita',
    'agendar llamada',
    'agendar una llamada',
    'reservar',
    'reservar cita',
    'reservar una cita',
    'reservar llamada',
    'reservar una llamada',
]

const BUSINESS_START_HOUR = 9
const BUSINESS_END_HOUR = 15

const CANCEL_KEYWORDS = [/cancelar/i, /ya\s+no/i]

const AVAILABILITY_QUERY_PATTERNS = [
    /horarios?\s+disponibles?/i,
    /disponibilidad\s+de\s+horarios?/i,
    /que\s+horarios?\s+tienen/i,
    /disponibilidad\s+para\s+otro\s+d[ií]a/i,
    /hay\s+disponibilidad\s+(?:el|para\s+el)\s+d[ií]a/i,
]

const SHOW_MORE_AVAILABILITY_PATTERNS = [
    /mostrar\s+m[aá]s\s+horarios?/i,
    /m[aá]s\s+horarios?/i,
]

const ASAP_PATTERNS = [
    /lo\s+antes\s+posible/i,
    /lo\s+m[aá]s\s+pronto\s+posible/i,
    /lo\s+m[aá]s\s+pronto/i,
    /cuanto\s+antes/i,
]

const DATE_CHANGE_PATTERNS = [
    /otra\s+fecha/i,
    /cambiar\s+la?\s+fecha/i,
    /preferir[ií]a\s+otra\s+fecha/i,
    /otro\s+d[ií]a/i,
]

const matchesAsapRequest = (message = '') =>
    typeof message === 'string' && ASAP_PATTERNS.some((regex) => regex.test(message))

const matchesDateChangeRequest = (message = '') =>
    typeof message === 'string' && DATE_CHANGE_PATTERNS.some((regex) => regex.test(message))

const resetSchedulingState = async (state) => {
    await state.update({
        scheduling: null,
        availabilitySuggestions: null,
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
        availabilitySuggestions: null,
    })

    await sendChunkedMessages(
        flowDynamic,
        '¡Perfecto! Empecemos con tu cita. Atendemos llamadas de lunes a viernes y necesitamos al menos 1 hora de anticipación. ¿Cuál es tu nombre completo?',
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
            'Necesitamos al menos 1 hora de anticipación para agendar. Indícame otro horario que cumpla con ese requisito.',
            { ctx, provider }
        )
        const suggestionZone = scheduling?.data?.timeZone || DEFAULT_TIMEZONE
        await sendAvailabilitySuggestions(ctx, { flowDynamic, state, provider }, {
            startDate: new Date(Date.now() + noticeInMilliseconds),
            maxSlots: 2,
            intro: `Estas opciones cumplen con la anticipación mínima de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${suggestionZone}):`,
            fallbackMessage:
                'Por ahora no hay espacios que cumplan con la anticipación mínima. Intenta con otro horario o pide "Horarios disponibles".',
        })

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
            if (matchesAsapRequest(message)) {
                if (!isCalendarConfigured()) {
                    await sendChunkedMessages(
                        flowDynamic,
                        'Aún no tengo acceso a la agenda para consultar los horarios disponibles. Solicita al equipo técnico que complete la configuración de Google Calendar.',
                        { ctx, provider }
                    )
                } else {
                    await sendEarliestAvailableSlot(ctx, { flowDynamic, state, provider })
                }

                return true
            }

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

            const slots = await getAvailabilityForDate(parsedDate)

            if (!slots.length) {
                await clearAvailabilitySuggestions(state)
                await sendChunkedMessages(
                    flowDynamic,
                    `Por ahora no tengo horarios disponibles el ${formatDateForHumans(parsedDate)}. Indícame otra fecha de lunes a viernes y reviso nuevamente.`,
                    { ctx, provider }
                )

                const { date: _unusedDate, ...restData } = scheduling.data || {}

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

            await state.update({
                scheduling: {
                    step: 'collectTime',
                    data: {
                        ...scheduling.data,
                        date: normalizedDate,
                    },
                },
            })

            await presentAvailabilitySlots(ctx, tools, slots, {
                intro: `Para ${formatDateForHumans(parsedDate)} tengo estos horarios disponibles de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${DEFAULT_TIMEZONE}):`,
                closing:
                    'Si alguno de esos horarios te funciona, dime y avanzamos con la confirmación. Para ver más opciones responde "mostrar más horarios".',
            })

            await sendChunkedMessages(
                flowDynamic,
                `Tomé nota para el ${formatDateForHumans(parsedDate)}. ¿Cuál de esos horarios prefieres? Puedes decir “1 pm”, “13:30” o “mediodía”. Si necesitas otra zona horaria distinta a ${DEFAULT_TIMEZONE}, menciónalo.`,
                { ctx, provider }
            )

            return true
        }
        case 'collectTime': {
            if (matchesDateChangeRequest(message)) {
                const { date: _previousDate, time: _previousTime, ...restData } =
                    scheduling.data || {}

                await clearAvailabilitySuggestions(state)
                await state.update({
                    scheduling: {
                        ...scheduling,
                        step: 'collectDate',
                        data: {
                            ...restData,
                        },
                    },
                })

                await sendChunkedMessages(
                    flowDynamic,
                    'Claro, dime la nueva fecha que te interesa. Recuerda que atendemos de lunes a viernes.',
                    { ctx, provider }
                )

                return true
            }

            const alternateDate = parseFlexibleDateInput(message, new Date())
            if (alternateDate) {
                if (!isCalendarConfigured()) {
                    await sendChunkedMessages(
                        flowDynamic,
                        'Aún no tengo acceso a la agenda para consultar los horarios disponibles. Solicita al equipo técnico que complete la configuración de Google Calendar.',
                        { ctx, provider }
                    )
                    return true
                }

                const normalizedDate = `${alternateDate.year}-${padNumber(alternateDate.month)}-${padNumber(
                    alternateDate.day
                )}`

                const slots = await getAvailabilityForDate(alternateDate)
                const formattedDate = formatDateForHumans(alternateDate)

                if (!slots.length) {
                    await clearAvailabilitySuggestions(state)
                    const { date: _currentDate, time: _currentTime, ...restData } = scheduling.data || {}

                    await state.update({
                        scheduling: {
                            ...scheduling,
                            step: 'collectDate',
                            data: {
                                ...restData,
                            },
                        },
                    })

                    await sendChunkedMessages(
                        flowDynamic,
                        `Por ahora no tengo horarios disponibles el ${formattedDate}. Indícame otra fecha de lunes a viernes y reviso nuevamente.`,
                        { ctx, provider }
                    )

                    return true
                }

                const { date: _ignoredDate, time: _ignoredTime, ...restData } = scheduling.data || {}

                await state.update({
                    scheduling: {
                        ...scheduling,
                        step: 'collectTime',
                        data: {
                            ...restData,
                            date: normalizedDate,
                        },
                    },
                })

                await presentAvailabilitySlots(ctx, tools, slots, {
                    intro: `Para ${formattedDate} tengo estos horarios disponibles de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${DEFAULT_TIMEZONE}):`,
                    closing:
                        'Si alguno de esos horarios te funciona, dime y agendamos tu cita. Para ver más opciones responde "mostrar más horarios".',
                })

                await sendChunkedMessages(
                    flowDynamic,
                    `Tomé nota para el ${formattedDate}. ¿Cuál de esos horarios prefieres? Puedes decir “1 pm”, “13:30” o “mediodía”. Si necesitas otra zona horaria distinta a ${DEFAULT_TIMEZONE}, menciónalo.`,
                    { ctx, provider }
                )

                return true
            }

            if (matchesAsapRequest(message)) {
                const dateParts = parseDateParts(scheduling.data?.date)
                if (!dateParts) {
                    await sendChunkedMessages(
                        flowDynamic,
                        'Vamos a elegir primero la fecha para poder revisar los horarios disponibles. Dime qué día prefieres.',
                        { ctx, provider }
                    )

                const { date: _missingDate, time: _missingTime, ...restData } = scheduling.data || {}

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

                await sendEarliestAvailableSlot(ctx, tools, {
                    dateParts,
                    timeZone: scheduling?.data?.timeZone || DEFAULT_TIMEZONE,
                })

                return true
            }

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
                    'Necesitamos al menos 1 hora de anticipación para agendar. Indícame otro horario que cumpla con ese requisito.',
                    { ctx, provider }
                )
                await sendAvailabilitySuggestions(
                    ctx,
                    { flowDynamic, state, provider },
                    {
                        startDate: new Date(Date.now() + noticeInMilliseconds),
                        maxSlots: 2,
                        intro: `Estas opciones cumplen con la anticipación mínima de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${timeZone}):`,
                        fallbackMessage:
                            'Por ahora no hay espacios que cumplan con la anticipación mínima. Puedes pedir "Horarios disponibles" para revisar más opciones.',
                    }
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
                    await sendAvailabilitySuggestions(ctx, { flowDynamic, state, provider }, {
                        startDate,
                        maxSlots: 2,
                        intro: `Estas opciones están libres en lapsos de ${SUGGESTION_SLOT_MINUTES} minutos (hora local de ${timeZone}):`,
                        fallbackMessage:
                            'Por ahora no encuentro horarios libres cercanos. Puedes pedir "Horarios disponibles" para revisar más opciones.',
                    })
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

            await clearAvailabilitySuggestions(state)

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

    if (await handleDateSpecificAvailability(ctx, tools)) {
        return true
    }

    if (await handleAvailabilityInquiry(ctx, tools)) {
        return true
    }

    const userState = getUserState(tools.state)
    const scheduling = userState.scheduling

    if (scheduling?.step) {
        return continueSchedulingFlow(ctx, tools, scheduling)
    }

    if (isSchedulingStartRequest(message)) {
        return startSchedulingFlow(ctx, tools)
    }

    return false
}

const isSchedulingStartRequest = (message) => {
    if (!message) return false

    if (START_KEYWORDS.some((regex) => regex.test(message))) {
        return true
    }

    const normalizedMessage = normalizeText(message)
    if (!normalizedMessage) return false

    const configuredKeywords = Array.isArray(businessInfo?.schedulingKeywords)
        ? businessInfo.schedulingKeywords
        : []

    const normalizedKeywords = [...FALLBACK_START_KEYWORDS, ...configuredKeywords]
        .map((keyword) => normalizeText(keyword))
        .filter(Boolean)

    return normalizedKeywords.some((keyword) => normalizedMessage.includes(keyword))
}

module.exports = {
    handleSchedulingFlow,
}
