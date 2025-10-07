### CHATBOT Whatsapp (Baileys Provider)

<p align="center">
  <img width="300" src="https://i.imgur.com/Oauef6t.png">
</p>


**Con esta librería, puedes construir flujos automatizados de conversación de manera agnóstica al proveedor de WhatsApp,** configurar respuestas automatizadas para preguntas frecuentes, recibir y responder mensajes de manera automatizada, y hacer un seguimiento de las interacciones con los clientes.  Además, puedes configurar fácilmente disparadores que te ayudaran a expandir las funcionalidades sin límites. **[Ver documentación](https://bot-whatsapp.netlify.app/)**


```
npm install
cp .env.example .env # edita el archivo y coloca tu GEMINI_API_KEY
npm start
```

### Personalizar el contexto del asistente

- Edita `services/context.js` para actualizar la descripción del negocio, horarios, enlaces y frases clave que activan el flujo de agenda.
- El archivo exporta `contextMessages`, que se envía como contexto base a Gemini en cada respuesta.

### Configurar la agenda con Google Calendar

1. Crea o reutiliza un proyecto en Google Cloud y habilita la **Google Calendar API**.
2. Configura una credencial de **OAuth 2.0** para aplicaciones externas y genera un token de actualización con el alcance `https://www.googleapis.com/auth/calendar.events`.
3. Copia las variables necesarias (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, etc.) en tu `.env`.
4. Ajusta el huso horario y la duración por defecto de la cita en `.env` mediante `DEFAULT_TIMEZONE` y `DEFAULT_APPOINTMENT_DURATION_MINUTES`.
5. Una vez configurado, los usuarios pueden escribir "Agendar cita" o "Reservar cita" para iniciar el flujo automatizado que solicitará datos y registrará la cita en tu calendario.

### Configurar Gemini

1. Copia el archivo `.env.example` a `.env` y agrega tu clave real de Gemini en `GEMINI_API_KEY`.
2. Si quieres utilizar otro modelo soportado (por ejemplo `gemini-1.5-pro`), define la variable `GEMINI_MODEL` en el mismo archivo.
3. Guarda los cambios y reinicia el bot.

---
## Recursos
- [📄 Documentación](https://bot-whatsapp.netlify.app/)
- [🚀 Roadmap](https://github.com/orgs/codigoencasa/projects/1)
- [💻 Discord](https://link.codigoencasa.com/DISCORD)
- [👌 Twitter](https://twitter.com/leifermendez)
- [🎥 Youtube](https://www.youtube.com/watch?v=5lEMCeWEJ8o&list=PL_WGMLcL4jzWPhdhcUyhbFU6bC0oJd2BR)