# Notas — Plano Planta Alta (Modesto Arreola y Galeana)

## Escala
- **1:50** (declarada para impresión). El SVG es a escala real: 1 m = 100 unidades SVG.
- Cotas en **metros**. Norte tomado del catastro (≈ arriba).

## Orientación reconciliada con catastro
- **Calle Modesto Arreola = frente (sur, abajo).** Catastro: frente 11.00 m.
- **Calle Galeana = fondo (oeste, izquierda).** Catastro: fondo 9.20 m.
- **Chaflán en la esquina SW** (intersección de ambas calles), igual que el croquis catastral.
- Terreno catastral ≈ 101 m² (11.00 × 9.20). El edificio **no llena el lote**: el área interior de la PA es ≈ 84.5 m² (footprint con muros ≈ 92 m²); el resto es remetimiento/patio sobre el frente.

## Supuesto clave (confirmado por el usuario)
- Las cotas del levantamiento a mano son **interiores (libres, sin muro)**.
- El frente 11.00 y fondo 9.20 del catastro son **exteriores (incluyen muros)**.
- Muros: **exterior 0.20 m**, interior 0.15 m (los interiores se aplican en el paso de divisiones).

## Reconciliación geométrica (cómo cerró)
Trabajando interiores y sumando 0.20 m de muro por lado, todo cierra **exacto** contra el catastro:

| Eje | Interior (levantamiento) | + muros | Exterior | Catastro |
|-----|--------------------------|---------|----------|----------|
| Fondo (Galeana, O) | 8.80 (= 4.50 + 4.30) | +0.40 | **9.20** | 9.20 ✓ |
| Frente (Modesto, S) | 10.60 (= 7.65 recto + 2.95 chaflán) | +0.40 | **11.00** | 11.00 ✓ |

- **Chaflán = 4.30 m** (hipotenusa). Resuelto por triángulo:
  proyección horizontal (run, E-O) = **2.95 m**, proyección vertical (rise, N-S) = **3.13 m**
  → √(2.95² + 3.13²) = **4.30 ✓**. Subdivisión del paño 1.20 + 1.90 + 1.20 = 4.30 (para vanos, paso posterior).
- Cadena inferior (frente, recto): 0.70 + 0.70 + 1.85 + 0.88 + 1.88 + 0.59 + 1.05 = **7.65 m**.
- Lado este: 2.65 + 3.80 + 1.56 = **8.01 m**.
- Lado oeste (Galeana): tramo recto **5.67** + rise del chaflán **3.13** = **8.80 m**.

## Cotas que NO cerraron y cómo se resolvieron
1. **Lado oeste: 8.80 vs 7.96.** El croquis da "arriba 4.50+4.30 = 8.80" y también un lado izquierdo "2.80 + 3.6 + 1.56 = 7.96". Son ~0.84 m de diferencia para aristas que deberían ser coherentes.
   → **Resuelto:** se priorizó **8.80**, porque cierra exacto con el fondo catastral (8.80 + 0.40 = 9.20). El 7.96 se descarta como medida parcial/aproximada del croquis.
2. **Lado este 8.01 vs fondo 8.80.** El este del croquis (2.65+3.80+1.56 = 8.01) salía ~0.79 m más corto que el oeste (8.80).
   → **Resuelto (decisión del usuario):** se **iguala el este a 8.80 recto** → rectángulo limpio 10.60 × 8.80 con chaflán SW. El 8.01 del croquis se descarta como aproximación. Norte horizontal = 10.60. Área interior PA ≈ **88.7 m²**.
3. **Ángulo del chaflán.** Salió ≈47° (run 2.95 / rise 3.13), prácticamente un chaflán de esquina a ~45°, consistente con un "esquina chata" típico y con el croquis (paño 1.20/1.90/1.20 simétrico).

## Datos de detalle ya capturados (para pasos siguientes)
- **Escaleras:** ancho **1.10 m**, tramos de **2.05 m** (croquis "escalera"). Dos escaleras: una en franja izquierda, una centrada en franja inferior.
- Altura libre PA ≈ **2.80 m** (croquis "h = 2.80").
- Distribución: 3 deptos independientes (sup-izq, sup-der/chaflán, inferior) + núcleo común (recepción + 2 escaleras).

## Estado
- [x] **Paso 1 — Contorno perimetral con chaflán** (este entregable). *Esperando tu OK.*
- [ ] Paso 2 — Divisiones interiores (3 deptos + núcleo común).
- [ ] Paso 3 — Vanos (puertas con barrido, ventanas), cotas internas y etiquetas.
