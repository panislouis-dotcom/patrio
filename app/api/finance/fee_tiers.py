"""Escalera de comisión de salida — reemplaza el % plano de `exit_sale_commission_pct`/
`exit_rent_months` por tramos que dependen de cuánto se vendió o rentó realmente.

Una escalera es una lista de tramos `{"threshold": Decimal | None, "rate": Decimal}`,
ordenada o no — este módulo no asume orden, encuentra el tramo correcto por comparación
directa. Exactamente un tramo puede tener `threshold=None`: es el piso, el que aplica
cuando el valor alcanzado no llega a ningún umbral. Sin él la escalera no cubre todos los
valores posibles, por eso `validate_tiers` lo exige en cuanto la lista no está vacía.

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
    aplica (value por debajo de todos los umbrales), gana el tramo piso
    (`threshold is None`). Se asume que `tiers` ya pasó por `validate_tiers` — no se
    revalida aquí, así que si la lista no está vacía debe traer un piso.

    Lista vacía → no hay escalera configurada para esta propiedad: se usa `default`
    tal cual lo resolvió quien llama (típicamente
    `underwriting.ASSUMPTION_DEFAULTS["exit_sale_commission_pct"]` o
    `["exit_rent_commission_pct"]`, según el lado), mismo relevo que
    `underwriting.assumption()`."""
    if not tiers:
        return to_decimal(default)

    target = to_decimal(value)
    floor_rate: Decimal | None = None
    best_threshold: Decimal | None = None
    best_rate: Decimal | None = None

    for tier in tiers:
        threshold = tier["threshold"]
        rate = to_decimal(tier["rate"])
        if threshold is None:
            floor_rate = rate
            continue
        threshold = to_decimal(threshold)
        if threshold <= target and (best_threshold is None or threshold > best_threshold):
            best_threshold = threshold
            best_rate = rate

    if best_rate is not None:
        return best_rate
    # Precondición: una lista no vacía siempre trae un piso — validate_tiers lo exige
    # antes de persistir. Si esto truena es que algo se saltó esa validación (datos
    # sembrados a mano, un fixture de prueba incompleto): mejor un AssertionError
    # claro aquí que un TypeError confuso varios frames más abajo al multiplicar
    # `None * value`.
    assert floor_rate is not None, "tiers sin tramo piso — ¿se saltó validate_tiers?"
    return floor_rate


def validate_tiers(tiers: list[dict]) -> None:
    """Valida una escalera completa antes de persistirla (PUT de reemplazo atómico).
    Lista vacía es válida — significa "sin escalera, usar el default". Lanza
    `PropertyError` (mismo patrón que el resto de rechazos de dominio en
    properties_db.py) con mensaje en español apuntando a la regla que falló.

    Import de PropertyError diferido a dentro de la función, a propósito: a nivel de
    módulo crearía un ciclo real con properties_db.py, que importa `api.finance.fees`
    (y por lo tanto este módulo, que fees.py importa) ANTES de definir su propia clase
    PropertyError — cualquier primer import que arranque por `api.finance.fees` (como
    ya hace test_finance_fees.py) rompería a mitad de carga. Diferir el import evita el
    orden de carga frágil sin mover PropertyError de su único lugar de origen."""
    from api.properties_db import PropertyError

    if not tiers:
        return

    floor_count = 0
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
            floor_count += 1
            continue

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

    if floor_count == 0:
        raise PropertyError(
            "La escalera necesita exactamente un tramo piso (threshold vacío) para "
            "cubrir los valores que no alcanzan ningún umbral."
        )
    if floor_count > 1:
        raise PropertyError(
            "La escalera no puede tener más de un tramo piso (threshold vacío)."
        )
