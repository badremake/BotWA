const stripDiacritics = (text = '') =>
    String(text)
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()

const commandDefinitions = [
    {
        triggers: ['hola', 'buenos dias', 'buenas tardes', 'buenas noches'],
        messages: [
            '👋 ¡Hola! Somos el Consejo de Enfermería. Te ayudamos a homologar tu título profesional para que puedas ejercer en Estados Unidos.',
            'Cuéntame qué información necesitas o escribe "menu" para ver las opciones disponibles.',
        ],
    },
    {
        triggers: ['informacion', 'información', 'programa', 'homologacion', 'homologación'],
        messages: [
            'ℹ️ Nuestro programa de homologación acompaña a profesionales de enfermería que estudiaron en México para validar su título en Estados Unidos.',
            'Te guiamos paso a paso: revisión de documentos, preparación para el examen de equivalencia y orientación sobre trámites migratorios básicos.',
        ],
    },
    {
        triggers: ['examen', 'simulacro'],
        messages: [
            '📝 El examen de homologación evalúa tus conocimientos clínicos y regulatorios para ejercer en Estados Unidos.',
            'Incluimos simulacros guiados, banco de preguntas actualizado y sesiones de retroalimentación para que llegues con seguridad a la evaluación oficial.',
        ],
    },
    {
        triggers: ['requisitos', 'documentos'],
        messages: [
            '📄 Los requisitos principales incluyen: título y cédula profesional, certificado de estudios, identificación oficial y comprobantes de experiencia clínica.',
            'Si te falta algún documento, un asesor te indicará cómo gestionarlo durante la llamada de orientación.',
        ],
    },
    {
        triggers: ['beneficios', 'apoyos'],
        messages: [
            '🌟 Beneficios del programa: acompañamiento personalizado, simulacros de examen, asesoría para trámites migratorios básicos y guía para oportunidades laborales.',
            'Todo el proceso es en línea para que avances sin importar dónde te encuentres.',
        ],
    },
    {
        triggers: ['costos', 'costo', 'precio', 'inversion', 'inversión', 'pago', 'financiamiento'],
        messages: [
            '💳 Conversamos sobre inversión, becas internas y planes de pago flexibles durante la llamada de orientación.',
            'Así confirmamos que la propuesta se ajuste a tus objetivos profesionales y a tu presupuesto.',
        ],
    },
    {
        triggers: ['llamada', 'orientacion', 'orientación', 'asesor', 'contacto'],
        messages: [
            '📞 Para hablar con un asesor y aclarar dudas específicas, agenda una llamada de orientación.',
            'Escribe "Agendar cita" cuando quieras reservar tu espacio en el calendario.',
        ],
    },
]

const getCommandResponse = (message = '') => {
    if (!message || typeof message !== 'string') return null

    const normalized = stripDiacritics(message.trim())

    const definition = commandDefinitions.find((candidate) =>
        candidate.triggers.some((trigger) => normalized === stripDiacritics(trigger))
    )

    if (!definition) return null

    return { messages: definition.messages }
}

module.exports = {
    getCommandResponse,
}
