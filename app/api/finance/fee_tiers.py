"""Escalera de comisión de salida — reemplaza el % plano de `exit_sale_commission_pct`/
`exit_rent_months` por tramos que dependen de cuánto se vendió o rentó realmente.

Una escalera es una lista de tramos `{"threshold": Decimal, "rate": Decimal}`, ordenada
o no — este módulo no asume orden, encuentra el tramo correcto por comparación directa.
No existe un tramo piso ("si no"): si el valor alcanzado no llega a ningún umbral, la
tasa que aplica es 0%, sin excepción — "obviamente si no se alcanza ningún umbral no se
gana esa comisión", como lo puso el dueño del producto al pedir que se quitara el piso
por completo (antes era opcional, ahora ni siquiera es una opción configurable).

Evaluación tipo escalón, no marginal: se busca el tramo con el threshold más alto que el
valor satisface (`threshold <= value`, ≥ inclusivo — confirmado por el usuario, "arriba de
6.5M" incluye exactamente 6.5M) y se aplica esa única tasa al valor completo. El salto en el
límite es intencional: unos pesos de diferencia en el precio de venta pueden mover la
comisión varios puntos porcentuales, y así es como el fondo lo quiere ver, no un bug a
suavizar con interpolación.

Una propiedad sin filas en `property_fee_tiers` para un `kind` dado (la lista llega vacía)
se comporta exactamente como con la comisión plana de hoy: el default del modelo, mismo
patrón "captured vs default" que `underwriting.assumption()` ya usa. Cuál es ese default
—venta o renta— es una decisión de quien llama (fees.py), no de este módulo: matchear un
valor contra una escalera no necesita saber nada de `ASSUMPTION_DEFAULTS` ni de la palabra
"venta"/"renta", solo necesita el número a usar cuando no hay tramos.
"""
from decimal import Decimal

from .quantize import to_decimal


def select_tier(tiers: list[dict], value: Decimal, default: Decimal) -> Decimal:
    """La tasa que aplica a `value` según la escalera `tiers` — no la comisión ya
    multiplicada, eso lo hace quien llama (fees.py) una vez resuelto el valor real
    (venta o renta) contra el que se evalúa el tramo.

    Tramo ganador: el de threshold más alto tal que `threshold <= value`. Si ninguno
    aplica (value por debajo de todos los umbrales), la tasa es 0% — no hay tramo piso
    que rescate ese caso, ni siquiera opcionalmente. `default` queda reservado
    exclusivamente para una lista `tiers` completamente vacía (ver abajo). Se asume
    que `tiers` ya pasó por `validate_tiers` — no se revalida aquí.

    Lista vacía → no hay escalera configurada para esta propiedad: se usa `default`
    tal cual lo resolvió quien llama (típicamente
    `underwriting.ASSUMPTION_DEFAULTS["exit_sale_commission_pct"]` o
    `["exit_rent_commission_pct"]`, según el lado), mismo relevo que
    `underwriting.assumption()`."""
    if not tiers:
        return to_decimal(default)

    target = to_decimal(value)
    best_threshold: Decimal | None = None
    best_rate: Decimal | None = None

    for tier in tiers:
        threshold = to_decimal(tier["threshold"])
        rate = to_decimal(tier["rate"])
        if threshold <= target and (best_threshold is None or threshold > best_threshold):
            best_threshold = threshold
            best_rate = rate

    if best_rate is not None:
        return best_rate
    return to_decimal("0")


def validate_tiers(tiers: list[dict]) -> None:
    """Valida una escalera completa antes de persistirla (PUT de reemplazo atómico).
    Lista vacía es válida — significa "sin escalera, usar el default". Lanza
    `PropertyError` (mismo patrón que el resto de rechazos de dominio en
    properties_db.py) con mensaje en español apuntando a la regla que falló.
    Un tramo con `threshold=None` (el antiguo tramo piso, "si no") se rechaza de
    inmediato — ya no existe como concepto configurable, ni siquiera opcional.

    Import de PropertyError diferido a dentro de la función, a propósito: a nivel de
    módulo crearía un ciclo real con properties_db.py, que importa `api.finance.fees`
    (y por lo tanto este módulo, que fees.py importa) ANTES de definir su propia clase
    PropertyError — cualquier primer import que arranque por `api.finance.fees` (como
    ya hace test_finance_fees.py) rompería a mitad de carga. Diferir el import evita el
    orden de carga frágil sin mover PropertyError de su único lugar de origen."""
    from api.properties_db import PropertyError

    if not tiers:
        return

    thresholds_seen: set[Decimal] = set()

    for tier in tiers:
        rate = tier.get("rate")
        if rate is None:
            raise PropertyError("Cada tramo necesita una tasa (rate).")
        rate_dec = to_decimal(rate)
        if rate_dec < 0 or rate_dec > 1:
            raise PropertyError(
                f"La tasa del tramo debe estar entre 0% y 100% (se recibió {rate!r})."
            )

        threshold = tier.get("threshold")
        if threshold is None:
            raise PropertyError(
                "Ya no se admite un tramo piso ('si no'): un valor que no alcanza"
                " ningún umbral gana 0% automáticamente."
            )

        threshold_dec = to_decimal(threshold)
        if threshold_dec <= 0:
            raise PropertyError(
                f"El umbral del tramo debe ser mayor a 0 (se recibió {threshold!r})."
            )
        if threshold_dec in thresholds_seen:
            raise PropertyError(
                f"Los umbrales de la escalera deben ser únicos (se repite {threshold_dec})."
            )
        thresholds_seen.add(threshold_dec)
