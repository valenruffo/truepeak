export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen py-28 px-6" style={{ background: "#09090b", color: "#fafafa" }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display font-bold text-3xl mb-8">Política de Privacidad</h1>
        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <p><strong className="text-foreground">Última actualización:</strong> Mayo 2026</p>

          <p>En True Peak AI nos comprometemos a proteger tu privacidad. Esta política explica qué datos recopilamos, cómo los usamos y tus derechos.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">1. Datos que Recopilamos</h2>
          <p><strong className="text-foreground">Datos de cuenta:</strong> nombre, email, nombre de sello, slug personalizado.</p>
          <p><strong className="text-foreground">Datos de uso:</strong> configuración de firma sónica (BPM, LUFS, escala musical), historial de análisis, preferencias de CRM.</p>
          <p><strong className="text-foreground">Archivos de audio:</strong> los archivos WAV que subís para análisis. Se procesan automáticamente y se almacenan temporalmente.</p>
          <p><strong className="text-foreground">Datos de pago:</strong> procesados exclusivamente por <strong className="text-foreground">Lemon Squeezy</strong>. No almacenamos datos de tarjetas de crédito ni información financiera sensible.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">2. Cómo Usamos tus Datos</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Proveer y mejorar el servicio de análisis de demos.</li>
            <li>Procesar pagos a través de Lemon Squeezy.</li>
            <li>Enviar notificaciones sobre el estado de tus análisis.</li>
            <li>Comunicarnos contigo sobre actualizaciones o soporte.</li>
            <li>Cumplir con obligaciones legales.</li>
          </ul>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">3. Almacenamiento de Archivos de Audio</h2>
          <p>Los archivos WAV que subís se almacenan de forma segura y se eliminan automáticamente después de 30 días, salvo que elijas conservarlos. Solo vos y tu equipo tenés acceso a estos archivos. No compartimos tu material con terceros.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">4. Compartir Datos con Terceros</h2>
          <p>No vendemos ni compartimos tus datos personales con terceros, excepto:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong className="text-foreground">Lemon Squeezy:</strong> para procesar pagos.</li>
            <li><strong className="text-foreground">Proveedores de infraestructura:</strong> para hosting y almacenamiento seguro.</li>
            <li><strong className="text-foreground">Obligación legal:</strong> si una autoridad competente lo requiere.</li>
          </ul>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">5. Tus Derechos</h2>
          <p>Según la Ley 25.326 de Protección de Datos Personales (Argentina), tenés derecho a:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Acceder a tus datos personales.</li>
            <li>Solicitar la rectificación de datos inexactos.</li>
            <li>Solicitar la eliminación de tu cuenta y datos asociados.</li>
            <li>Oponerte al procesamiento de tus datos.</li>
          </ul>
          <p>Para ejercer estos derechos, contactanos a <span className="text-foreground">privacidad@truepeak.space</span>.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">6. Cookies</h2>
          <p>Usamos cookies esenciales para el funcionamiento de la plataforma (autenticación, preferencias). No usamos cookies de terceros para publicidad ni tracking.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">7. Seguridad</h2>
          <p>Implementamos medidas de seguridad técnicas y organizativas para proteger tus datos, incluyendo encriptación en tránsito y en reposo, acceso restringido y monitoreo continuo.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">8. Cambios a esta Política</h2>
          <p>Podemos actualizar esta política ocasionalmente. Te notificaremos cambios significativos por email o mediante un aviso en la plataforma.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">9. Contacto</h2>
          <p>Para consultas sobre privacidad, escribinos a <span className="text-foreground">privacidad@truepeak.space</span>.</p>
        </div>
      </div>
    </div>
  );
}
