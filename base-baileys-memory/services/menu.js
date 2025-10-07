const menuSections = [
    {
        emoji: '1️⃣',
        title: 'Agendar cita',
        description:
            'Ofrece iniciar el proceso de agenda para la llamada de orientación y explica que el sistema puede reservar la fecha automáticamente.',
    },
    {
        emoji: '2️⃣',
        title: 'Requisitos y pasos',
        description:
            'Resume los documentos esenciales para homologar la carrera y aclara que, si algo falta, el asesor guiará a la persona.',
    },
    {
        emoji: '3️⃣',
        title: 'Beneficios del programa',
        description:
            'Destaca el acompañamiento personalizado, los simulacros de examen y el apoyo para trámites migratorios y colocación laboral.',
    },
    {
        emoji: '4️⃣',
        title: 'Costos y financiamiento',
        description:
            'Invita a conversar sobre inversiones, becas y opciones de pago flexibles durante la llamada de orientación.',
    },
    {
        emoji: '5️⃣',
        title: 'Horarios y contacto',
        description:
            'Comparte el horario de atención, la modalidad a distancia y cualquier canal adicional de comunicación disponible.',
    },
]

const buildMenuExample = (organizationName = 'nuestro equipo') => {
    const header = `Menú principal de ${organizationName}:`
    const lines = menuSections.map((section) => `${section.emoji} ${section.title}`)

    return [header, ...lines, '', 'Elige un número o descríbeme qué necesitas.'].join('\n')
}

const buildMenuGuidance = (organizationName = 'nuestro equipo') =>
    [
        'Cuando sea oportuno (saludo inicial, petición de opciones o duda general), ofrece un menú en un solo mensaje corto.',
        'Evita repetir el mismo menú si la persona ya lo recibió y enfócate en responder a su consulta actual.',
        'Usa mensajes de máximo cuatro líneas y confirma si desea profundizar en algún punto antes de enviar más información.',
        '',
        'Ejemplo de menú sugerido:',
        buildMenuExample(organizationName),
    ].join('\n')

module.exports = {
    menuSections,
    buildMenuExample,
    buildMenuGuidance,
}
