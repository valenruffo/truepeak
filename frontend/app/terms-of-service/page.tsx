export default function TermsOfService() {
  return (
    <div className="min-h-screen py-28 px-6" style={{ background: "#09090b", color: "#fafafa" }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display font-bold text-3xl mb-8">Términos de Servicio</h1>
        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <p><strong className="text-foreground">Última actualización:</strong> Mayo 2026</p>

          <p>Bienvenido a True Peak AI. Al acceder y usar nuestra plataforma, aceptás estos términos. Si no estás de acuerdo, no uses el servicio.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">1. Servicio</h2>
          <p>True Peak AI es una plataforma de filtrado automático de demos musicales mediante análisis técnico por IA. Proporcionamos análisis de BPM, LUFS, fase, headroom y detección de samples para sellos discográficos y profesionales del audio.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">2. Cuentas</h2>
          <p>Para usar el servicio necesitás crear una cuenta. Sos responsable de mantener la confidencialidad de tus credenciales y de toda actividad que ocurra bajo tu cuenta. Si detectás uso no autorizado, notificanos inmediatamente.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">3. Suscripción y Pagos</h2>
          <p>Los pagos se procesan a través de <strong className="text-foreground">Lemon Squeezy</strong>, nuestro proveedor de pagos. Al suscribirte, autorizás a Lemon Squeezy a cobrar el monto correspondiente según el plan elegido. Las suscripciones se renuevan automáticamente al final de cada período hasta que canceles.</p>
          <p>Los precios están en USD. Nos reservamos el derecho de modificar los precios con aviso previo de 30 días.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">4. Uso Aceptable</h2>
          <p>No podés usar el servicio para: (a) analizar contenido que no tengas derecho a procesar, (b) intentar acceder a datos de otros usuarios, (c) usar el servicio de forma que interfiera con su funcionamiento, (d) revender o redistribuir el servicio sin autorización.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">5. Propiedad Intelectual</h2>
          <p>Todo el contenido, diseño, código y marca de True Peak AI es propiedad de True Peak AI. Los archivos de audio que subís siguen siendo tuyos — no reclamamos derechos sobre tu material.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">6. Limitación de Responsabilidad</h2>
          <p>El servicio se proporciona "tal cual". No garantizamos que el análisis sea 100% preciso ni que el servicio esté disponible sin interrupciones. No somos responsables de pérdidas indirectas, incidentales o consecuentes derivadas del uso del servicio.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">7. Cancelación</h2>
          <p>Podés cancelar tu suscripción en cualquier momento desde tu panel de cuenta. La cancelación es efectiva al final del período facturado. No se realizan reembolsos por períodos parciales.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">8. Ley Aplicable</h2>
          <p>Estos términos se rigen por las leyes de la República Argentina. Cualquier disputa se resolverá en los tribunales de la Ciudad de Buenos Aires.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">9. Contacto</h2>
          <p>Para consultas sobre estos términos, escribinos a <span className="text-foreground">legal@truepeak.ai</span>.</p>
        </div>
      </div>
    </div>
  );
}
