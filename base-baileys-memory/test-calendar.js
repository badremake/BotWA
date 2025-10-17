require('dotenv').config();
const { listCalendarEvents } = require('./services/calendar');

(async () => {
  try {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7*24*60*60*1000);

    const res = await listCalendarEvents({
      timeMin: now.toISOString(),
      timeMax: in7.toISOString(),
      maxResults: 10,
    });

    const items = Array.isArray(res?.items) ? res.items : [];
    if (!items.length) {
      console.log('No se encontraron eventos en la ventana seleccionada.');
      return;
    }
    console.log('Eventos próximos:', items.map(e => e.summary || '(sin título)'));
  } catch (e) {
    console.error('Fallo la prueba:', e?.message || e);
  }
})();
