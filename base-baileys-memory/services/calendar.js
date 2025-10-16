const REQUIRED_ENV_VARS = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_CALENDAR_ID',
]

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3'

const isCalendarConfigured = () => REQUIRED_ENV_VARS.every((key) => Boolean(process.env[key]))

const buildTokenPayload = () => {
    const params = new URLSearchParams()
    params.append('client_id', process.env.GOOGLE_CLIENT_ID)
    params.append('client_secret', process.env.GOOGLE_CLIENT_SECRET)
    params.append('refresh_token', process.env.GOOGLE_REFRESH_TOKEN)
    params.append('grant_type', 'refresh_token')
    return params
}

const fetchAccessToken = async () => {
    if (!isCalendarConfigured()) {
        throw new Error('GOOGLE_CALENDAR_MISSING_CONFIG')
    }

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: buildTokenPayload(),
    })

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const error = new Error(
            errorBody?.error_description || errorBody?.error || 'GOOGLE_CALENDAR_TOKEN_ERROR'
        )
        error.code = response.status
        throw error
    }

    const json = await response.json()
    if (!json.access_token) {
        const error = new Error('GOOGLE_CALENDAR_TOKEN_ERROR')
        error.code = 'TOKEN_MISSING'
        throw error
    }

    return json.access_token
}

const createCalendarEvent = async ({
    summary,
    description,
    startDateTime,
    endDateTime,
    timeZone,
    attendees = [],
}) => {
    const accessToken = await fetchAccessToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID

    const response = await fetch(
        `${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                summary,
                description,
                start: {
                    dateTime: startDateTime,
                    timeZone,
                },
                end: {
                    dateTime: endDateTime,
                    timeZone,
                },
                attendees,
            }),
        }
    )

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const errorMessage =
            errorBody?.error?.message || `Error HTTP ${response.status}: ${response.statusText}`
        const error = new Error(errorMessage)
        error.code = response.status
        error.details = errorBody
        throw error
    }

    return response.json()
}

const listCalendarEvents = async ({ timeMin, timeMax }) => {
    const accessToken = await fetchAccessToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID

    const url = new URL(
        `${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`
    )

    if (timeMin) {
        url.searchParams.set('timeMin', timeMin)
    }

    if (timeMax) {
        url.searchParams.set('timeMax', timeMax)
    }

    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    })

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const errorMessage =
            errorBody?.error?.message ||
            `Error HTTP ${response.status}: ${response.statusText}`
        const error = new Error(errorMessage)
        error.code = response.status
        error.details = errorBody
        throw error
    }

    return response.json()
}

const parseEventDateTime = (eventDate) => {
    if (!eventDate) return null

    if (eventDate.dateTime) {
        return new Date(eventDate.dateTime)
    }

    if (eventDate.date) {
        return new Date(`${eventDate.date}T00:00:00Z`)
    }

    return null
}

const hasConflictingEvent = async ({ startDate, endDate }) => {
    const response = await listCalendarEvents({
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
    })

    const events = Array.isArray(response?.items) ? response.items : []

    return events.some((event) => {
        if (event.status === 'cancelled') return false

        const eventStart = parseEventDateTime(event.start)
        const eventEnd = parseEventDateTime(event.end)

        if (!eventStart || !eventEnd) return false

        return eventStart < endDate && eventEnd > startDate
    })
}

const inviteAttendeeToEvent = async ({ eventId, attendees = [] }) => {
    if (!eventId) {
        const error = new Error('GOOGLE_CALENDAR_EVENT_ID_REQUIRED')
        error.code = 'EVENT_ID_MISSING'
        throw error
    }

    const accessToken = await fetchAccessToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID

    const url = new URL(
        `${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    )
    url.searchParams.set('sendUpdates', 'all')

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ attendees }),
    })

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const errorMessage =
            errorBody?.error?.message || `Error HTTP ${response.status}: ${response.statusText}`
        const error = new Error(errorMessage)
        error.code = response.status
        error.details = errorBody
        throw error
    }

    return response.json()
}

module.exports = {
    createCalendarEvent,
    isCalendarConfigured,
    hasConflictingEvent,
    listCalendarEvents,
    inviteAttendeeToEvent,
}
