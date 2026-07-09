import { CURRENT_TERMS_VERSION } from './trial-registration.ts';

export type LegalDocumentId = 'terms' | 'privacy';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  subtitle: string;
  version: string;
  lastUpdated: string;
  sections: LegalSection[];
}

const SERVICE_NAME = 'RILO Gestión';
const OPERATOR_NAME = 'RILO';

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  terms: {
    id: 'terms',
    title: 'Términos de uso',
    subtitle: `${SERVICE_NAME} — condiciones del servicio en la nube`,
    version: CURRENT_TERMS_VERSION,
    lastUpdated: '1 de junio de 2026',
    sections: [
      {
        title: '1. Aceptación',
        paragraphs: [
          `Al registrarte, crear una cuenta o usar ${SERVICE_NAME}, aceptás estos Términos de uso y la Política de privacidad vigente. Si no estás de acuerdo, no utilices el servicio.`,
          `${OPERATOR_NAME} puede actualizar estos términos. La versión aplicable es la indicada al momento de tu aceptación y la publicada en la aplicación.`,
        ],
      },
      {
        title: '2. Descripción del servicio',
        paragraphs: [
          `${SERVICE_NAME} es un sistema de gestión en la nube (ERP) orientado a pequeñas y medianas empresas. Incluye, según el plan contratado, módulos como pedidos, ventas, caja, stock, clientes, compras, reportes y configuración comercial.`,
          'El servicio se presta "tal cual está disponible". Podemos mejorar, modificar o discontinuar funciones con aviso razonable cuando el cambio sea relevante para el uso habitual.',
        ],
      },
      {
        title: '3. Registro y cuenta',
        paragraphs: [
          'Debés proporcionar información veraz y mantenerla actualizada. Sos responsable de la confidencialidad de tu contraseña, del código de empresa y de toda actividad realizada desde tu cuenta.',
          'Cada empresa registrada recibe un código único de acceso. No compartas credenciales con personas no autorizadas. Notificanos de inmediato si detectás un uso no autorizado.',
          'Podemos rechazar o suspender registros que parezcan fraudulentos, duplicados de forma abusiva o contrarios a estos términos.',
        ],
      },
      {
        title: '4. Período de prueba y suscripción',
        paragraphs: [
          'La prueba gratuita tiene la duración indicada al registrarte. Al finalizar, el acceso puede limitarse hasta que contrates un plan de pago, salvo acuerdo distinto por escrito.',
          'Los precios, planes y módulos incluidos se informan en la plataforma o por los canales comerciales de RILO. El incumplimiento de pago puede resultar en suspensión del servicio.',
        ],
      },
      {
        title: '5. Uso permitido',
        paragraphs: [
          'Te comprometés a usar el servicio solo para fines lícitos relacionados con la gestión de tu negocio. Está prohibido intentar acceder a datos de otras empresas, vulnerar la seguridad del sistema, realizar ingeniería inversa, sobrecargar la infraestructura o usar el servicio para almacenar contenido ilegal o que infrinja derechos de terceros.',
        ],
      },
      {
        title: '6. Tus datos comerciales',
        paragraphs: [
          'Los datos que cargues (clientes, productos, movimientos, etc.) son de tu propiedad. Nos otorgás una licencia limitada para alojarlos, procesarlos y respaldarlos con el único fin de prestar el servicio.',
          'Podés exportar o solicitar información sobre tus datos según lo permita la aplicación y la normativa aplicable.',
        ],
      },
      {
        title: '7. Disponibilidad y soporte',
        paragraphs: [
          'Procuramos mantener el servicio disponible, pero no garantizamos ausencia total de interrupciones. Realizamos mantenimientos programados cuando sea posible con anticipación.',
          'El soporte se brinda por los canales habilitados (por ejemplo, WhatsApp o email comercial indicados en la aplicación), dentro de los horarios y alcances del plan contratado.',
        ],
      },
      {
        title: '8. Limitación de responsabilidad',
        paragraphs: [
          'En la medida permitida por la ley, RILO no será responsable por lucro cesante, pérdida de datos derivada de un uso indebido o de falta de respaldos locales que te correspondan, ni por decisiones comerciales tomadas en base a reportes del sistema.',
          'Nuestra responsabilidad total, si correspondiera, se limitará al monto abonado por el servicio en los últimos doce meses anteriores al hecho que la origine.',
        ],
      },
      {
        title: '9. Terminación',
        paragraphs: [
          'Podés dejar de usar el servicio en cualquier momento. Podemos suspender o dar por terminado el acceso por incumplimiento grave de estos términos, fraude o requerimiento legal.',
          'Tras la baja, conservaremos tus datos el tiempo necesario para obligaciones legales y luego procederemos a su eliminación o anonimización conforme a la Política de privacidad.',
        ],
      },
      {
        title: '10. Ley aplicable y contacto',
        paragraphs: [
          'Estos términos se rigen por las leyes de la República Oriental del Uruguay, sin perjuicio de normas imperativas de protección al consumidor que te beneficien.',
          `Consultas sobre estos términos: utilizá los canales de contacto publicados en ${SERVICE_NAME} o el WhatsApp de soporte indicado al registrarte.`,
        ],
      },
    ],
  },
  privacy: {
    id: 'privacy',
    title: 'Política de privacidad',
    subtitle: `Cómo ${OPERATOR_NAME} trata los datos personales en ${SERVICE_NAME}`,
    version: CURRENT_TERMS_VERSION,
    lastUpdated: '1 de junio de 2026',
    sections: [
      {
        title: '1. Responsable del tratamiento',
        paragraphs: [
          `${OPERATOR_NAME}, a través de ${SERVICE_NAME}, actúa como responsable del tratamiento de los datos personales que nos proporcionás al registrarte y usar la plataforma.`,
        ],
      },
      {
        title: '2. Datos que recopilamos',
        paragraphs: [
          'Datos de registro: nombre del negocio, rubro, país, ciudad, nombre del responsable, email, teléfono, contraseña (almacenada de forma cifrada) y preferencias de comunicación.',
          'Datos de uso: inicios de sesión, módulos utilizados, registros técnicos necesarios para seguridad y diagnóstico.',
          'Datos comerciales que cargues: información de clientes, proveedores, productos, pedidos, ventas y movimientos de caja. Actuamos como encargado del tratamiento respecto de los datos personales de tus clientes finales que vos ingreses en el sistema.',
        ],
      },
      {
        title: '3. Finalidades',
        paragraphs: [
          'Crear y administrar tu cuenta y empresa en la plataforma.',
          'Verificar tu identidad (por ejemplo, código SMS al teléfono y enlace de verificación de email).',
          'Prestar, mantener y mejorar el servicio; prevenir fraude y abusos.',
          'Enviarte comunicaciones operativas del servicio y, si lo autorizás, novedades comerciales o ayuda por WhatsApp.',
          'Cumplir obligaciones legales y responder requerimientos de autoridades competentes.',
        ],
      },
      {
        title: '4. Base legal',
        paragraphs: [
          'Ejecución del contrato (prestación del servicio contratado o de prueba).',
          'Consentimiento, cuando corresponda (por ejemplo, comunicaciones comerciales opcionales o WhatsApp de ayuda).',
          'Interés legítimo en seguridad, mejora del producto y prevención de fraude, siempre equilibrado con tus derechos.',
          'Obligación legal, cuando la normativa lo exija.',
        ],
      },
      {
        title: '5. Conservación',
        paragraphs: [
          'Conservamos tus datos mientras mantengas una cuenta activa o sea necesario para prestarte el servicio.',
          'Los registros de aceptación de términos y privacidad (fecha y versión) se guardan como prueba de consentimiento.',
          'Tras la baja, eliminamos o anonimizamos los datos en un plazo razonable, salvo conservación exigida por ley o para defensa de reclamos.',
        ],
      },
      {
        title: '6. Compartición y transferencias',
        paragraphs: [
          'No vendemos tus datos personales. Podemos compartirlos con proveedores tecnológicos que nos ayudan a operar el servicio (por ejemplo, infraestructura en la nube, envío de SMS o email), bajo contratos que exigen confidencialidad y seguridad.',
          'Si los servidores o proveedores están fuera de Uruguay, adoptamos medidas razonables para proteger la información conforme a estándares habituales del sector.',
        ],
      },
      {
        title: '7. Seguridad e aislamiento',
        paragraphs: [
          'Aplicamos medidas técnicas y organizativas para proteger la información: acceso autenticado, aislamiento de datos por empresa (cada negocio accede solo a su información) y reglas que impiden el acceso directo a la base de datos desde el navegador.',
          'Ningún sistema es 100 % infalible. Te recomendamos usar contraseñas robustas y limitar el acceso dentro de tu equipo.',
        ],
      },
      {
        title: '8. Tus derechos',
        paragraphs: [
          'Podés solicitar acceso, rectificación, actualización o eliminación de tus datos personales, así como oponerte a ciertos tratamientos o revocar consentimientos opcionales, contactándonos por los canales de soporte.',
          'También podés presentar reclamo ante la autoridad de protección de datos competente si considerás que no hemos atendido adecuadamente tu solicitud.',
        ],
      },
      {
        title: '9. Cookies y almacenamiento local',
        paragraphs: [
          'La aplicación utiliza almacenamiento local del navegador (por ejemplo, token de sesión y preferencias de interfaz) necesario para mantener tu acceso. No usamos cookies de publicidad de terceros dentro del producto.',
        ],
      },
      {
        title: '10. Menores',
        paragraphs: [
          'El servicio está dirigido a personas mayores de edad que actúan en nombre de un negocio. No recopilamos intencionalmente datos de menores.',
        ],
      },
      {
        title: '11. Cambios y contacto',
        paragraphs: [
          'Podemos actualizar esta política. Publicaremos la versión vigente con su fecha. Si el cambio es sustancial, te lo informaremos por medios razonables.',
          `Consultas sobre privacidad: utilizá los canales de contacto publicados en ${SERVICE_NAME} o el WhatsApp de soporte indicado al registrarte.`,
        ],
      },
    ],
  },
};

export function getLegalDocument(id: LegalDocumentId): LegalDocument {
  return LEGAL_DOCUMENTS[id];
}
