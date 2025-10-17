// services/calendar.js
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const TOKEN_PATH = path.join(__dirname, '..', 'tokens.json');

// Utilidad: preferir GCAL_* y si no, caer a GOOGLE_*
function env2(a, b) {
  return process.env[a] || process.env[b] || '';
}

const CLIENT_ID     = env2('GCAL_CLIENT_ID',     'GOOGLE_CLIENT_ID');
const CLIENT_SECRET = env2('GCAL_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');
const REDIRECT_URI  = env2('GCAL_REDIRECT_URI',  'GOOGLE_REDIRECT_URI') || 'http://localhost:3005/callback';
const CALENDAR_ID   = env2('GCAL_CALENDAR_ID',   'GOOGLE_CALENDAR_ID') || 'primary';

/** Verifica que existan credenciales y tokens.json */
function isCalendarConfigured() {
  try {
    const hasClient = Boolean(CLIENT_ID && CLIENT_SECRET);
    const hasCalendarId = Boolean(CALENDAR_ID);
    const hasTokensJson = fs.existsSync(TOKEN_PATH);
    return hasClient && hasCalendarId && hasTokensJson;
  } catch {
    return false;
  }
}

/** Crea el cliente OAuth2 y carga tokens.json (con refresh_token) */
function getOAuthClient() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    const err = new Error('GOOGLE_CALENDAR_MISSING_CONFIG');
    err.code = 'MISSING_OAUTH_CLIENT';
    throw err;
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    const err = new Error('tokens.json no encontrado. Genera uno con auth.js');
    err.code = 'MISSING_TOKENS_JSON';
    throw err;
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  // Cargar tokens guardados (incluye refresh_token)
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(tokens);

  // Si Google rota tokens, persistimos automáticamente
  oAuth2Client.on('tokens', (newTokens) => {
    try {
      let current = {};
      if (fs.existsSync(TOKEN_PATH)) current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      const updated = { ...current, ...newTokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
      console.log('tokens.json actualizado automáticamente.');
    } catch (e) {
      console.error('No se pudo escribir tokens.json:', e.message);
    }
  });

  return oAuth2Client;
}

/** Lista eventos de Google Calendar (usa ventana por timeMin/timeMax) */
async function listCalendarEvents({
  calendarId = CALENDAR_ID,
  timeMin,
  timeMax,
  maxResults = 10,
} = {}) {
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults,
    });
    return res.data; // { items, ... }
  } catch (err) {
    const code = err?.code || err?.response?.status;
    const msg  = err?.message || err?.response?.data?.error?.message;
    if (code === 401 || (code === 400 && /invalid_grant|expired|revoked/i.test(msg))) {
      console.error('Refresh token inválido/revocado. Reautoriza y reemplaza tokens.json (node auth.js).');
    } else {
      console.error('Error al listar eventos:', msg || err);
    }
    throw err;
  }
}

/** Crea un evento y ENVÍA invitaciones si se pasan attendees */
async function createCalendarEvent({
  summary,
  description,
  startDateTime,
  endDateTime,
  timeZone,
  attendees = [],
}) {
  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all', // 👈 manda correo a asistentes
      requestBody: {
        summary,
        description,
        start: { dateTime: startDateTime, timeZone },
        end:   { dateTime: endDateTime,   timeZone },
        attendees, // [{email, displayName?}]
        guestsCanSeeOtherGuests: true,
        guestsCanInviteOthers: false,
        guestsCanModify: false,
      },
    });
    return res.data;
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message;
    console.error('Error al crear evento:', msg);
    throw err;
  }
}

/** Añade/actualiza un asistente y ENVÍA correo de invitación */
async function inviteAttendeeToEvent({ eventId, attendeeEmail, attendeeName }) {
  if (!eventId || !attendeeEmail) {
    const e = new Error('Faltan parámetros: eventId y attendeeEmail son obligatorios');
    e.code = 'MISSING_PARAMS';
    throw e;
  }

  const auth = getOAuthClient();
  const calendar = google.calendar({ version: 'v3', auth });

  // 1) Leer el evento actual
  const getRes = await calendar.events.get({
    calendarId: CALENDAR_ID,
    eventId,
  });

  const current = getRes.data || {};
  const attendees = Array.isArray(current.attendees) ? current.attendees.slice() : [];

  // 2) Insertar o actualizar al asistente
  const idx = attendees.findIndex(a => (a.email || '').toLowerCase() === attendeeEmail.toLowerCase());
  const newAttendee = {
    email: attendeeEmail,
    ...(attendeeName ? { displayName: attendeeName } : {}),
    responseStatus: 'needsAction',
  };
  if (idx >= 0) attendees[idx] = { ...attendees[idx], ...newAttendee };
  else attendees.push(newAttendee);

  // 3) Patch con sendUpdates para que envíe correo
  const patchRes = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    sendUpdates: 'all', // 👈 envía la invitación por correo
    requestBody: { attendees },
  });

  return patchRes.data;
}

/** Helpers para conflicto de horarios */
function parseEventDateTime(eventDate) {
  if (!eventDate) return null;
  if (eventDate.dateTime) return new Date(eventDate.dateTime);
  if (eventDate.date)     return new Date(`${eventDate.date}T00:00:00Z`);
  return null;
}

/** Revisa si hay choque de horario entre startDate y endDate */
async function hasConflictingEvent({ startDate, endDate }) {
  const response = await listCalendarEvents({
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    maxResults: 50,
  });

  const events = Array.isArray(response?.items) ? response.items : [];
  return events.some((event) => {
    if (event.status === 'cancelled') return false;
    const eventStart = parseEventDateTime(event.start);
    const eventEnd   = parseEventDateTime(event.end);
    if (!eventStart || !eventEnd) return false;
    return eventStart < endDate && eventEnd > startDate;
  });
}

module.exports = {
  // usados por tu scheduling.js
  isCalendarConfigured,
  listCalendarEvents,
  createCalendarEvent,
  inviteAttendeeToEvent,   // 👈 ahora sí existe y se exporta
  hasConflictingEvent,
};
