export default function RefundPolicy() {
  return (
    <div className="min-h-screen py-28 px-6" style={{ background: "#09090b", color: "#fafafa" }}>
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display font-bold text-3xl mb-8">Política de Reembolso</h1>
        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <p><strong className="text-foreground">Última actualización:</strong> Mayo 2026</p>

          <p>En True Peak AI nos tomamos en serio la satisfacción de nuestros clientes. Esta política describe las condiciones bajo las cuales procesamos reembolsos.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">1. Período de Prueba</h2>
          <p>Ofrecemos un período de prueba gratuito al registrarte. Durante este período podés evaluar el servicio sin compromiso. No se realiza ningún cargo hasta que elijas un plan de pago.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">2. Reembolsos por Suscripción</h2>
          <p>Debido a la naturaleza digital del servicio, <strong className="text-foreground">no realizamos reembolsos por períodos parciales</strong>. Si cancelás tu suscripción, mantendrás acceso hasta el final del período facturado.</p>
          <p>Excepciones: procesaremos un reembolso completo si:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>El servicio presenta un fallo técnico grave que impide su uso y no podemos resolverlo en un plazo razonable.</li>
            <li>Se realizó un cobro duplicado o erróneo.</li>
            <li>Cancelás dentro de las 48 horas posteriores a tu primer pago y no has usado el servicio de forma significativa.</li>
          </ul>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">3. Cómo Solicitar un Reembolso</h2>
          <p>Para solicitar un reembolso, contactanos a <span className="text-foreground">soporte@truepeak.space</span> con tu número de orden (proporcionado por Lemon Squeezy) y el motivo de la solicitud. Procesaremos tu pedido en un plazo de 5-10 días hábiles.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">4. Procesamiento de Pagos</h2>
          <p>Todos los pagos se procesan a través de <strong className="text-foreground">Lemon Squeezy</strong>. Los reembolsos se realizan al mismo método de pago utilizado en la compra original. Los tiempos de acreditación dependen de tu banco o emisor de tarjeta (generalmente 5-15 días hábiles).</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">5. Cambios de Plan</h2>
          <p>Si cambiás de plan (upgrade o downgrade), el ajuste se aplica en tu próximo ciclo de facturación. No se realizan reembolsos por la diferencia en el ciclo actual.</p>

          <h2 className="font-display font-semibold text-lg text-foreground mt-8 mb-2">6. Contacto</h2>
          <p>Para cualquier consulta sobre reembolsos, escribinos a <span className="text-foreground">soporte@truepeak.space</span> o usá la burbuja de feedback dentro de la plataforma.</p>
        </div>
      </div>
    </div>
  );
}
