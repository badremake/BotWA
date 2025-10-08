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

const listCalendarEvents = async ({ timeMin, timeMax } = {}) => {
    const accessToken = await fetchAccessToken()
    const calendarId = process.env.GOOGLE_CALENDAR_ID

    const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
    })

    if (timeMin) {
        const value = timeMin instanceof Date ? timeMin.toISOString() : timeMin
        params.append('timeMin', value)
    }

    if (timeMax) {
        const value = timeMax instanceof Date ? timeMax.toISOString() : timeMax
        params.append('timeMax', value)
    }

    const response = await fetch(
        `${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
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

    const json = await response.json()
    return Array.isArray(json?.items) ? json.items : []
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

module.exports = {
    createCalendarEvent,
    isCalendarConfigured,
    listCalendarEvents,
}
