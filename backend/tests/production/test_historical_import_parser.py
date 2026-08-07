import os
from pathlib import Path

import pytest

from backend.scripts.import_historical_orders import parse_orders

# NOTA: el brief original hardcodea la ruta de host Windows
# (r"C:\Users\MSI I7\Desktop\Trabajo\Joyeria\Ordenes de Producción.xlsx").
# Estos tests corren dentro del contenedor erp_joyeria-api-1 (unico entorno
# con openpyxl y el resto de dependencias del backend disponibles), asi que
# se usa la copia del archivo en /tmp/ordenes.xlsx (ver docker cp en el
# reporte de la Tarea 6). Ajustar de vuelta a la ruta de host si estos tests
# se corren fuera de Docker.
#
# El Excel NO esta en el repo (son datos reales de la empresa) y se copiaba a
# mano al contenedor. Al recrear el contenedor se pierde, y estos tests
# quedaban en rojo permanente por una dependencia de entorno, no por un bug:
# una suite siempre roja entrena a ignorar el rojo y esconde las fallas de
# verdad. Con el skipif quedan como "skipped": el hueco de cobertura sigue a
# la vista, pero deja de contaminar la señal.
#
# Para correrlos de verdad, copia el Excel al contenedor:
#   docker cp "ruta\Ordenes de Produccion.xlsx" erp_joyeria-api-1:/tmp/ordenes.xlsx
# o apunta a otra ruta con HISTORICAL_ORDERS_XLSX.
XLSX_PATH = Path(os.environ.get("HISTORICAL_ORDERS_XLSX", "/tmp/ordenes.xlsx"))

pytestmark = pytest.mark.skipif(
    not XLSX_PATH.exists(),
    reason=(
        f"Requiere el Excel de ordenes historicas en {XLSX_PATH} "
        "(no esta en el repo; ver la nota de este archivo)."
    ),
)


def test_parses_37_orders():
    orders = parse_orders(XLSX_PATH)
    assert len(orders) == 37
    assert [o.order_id for o in orders] == list(range(1, 38))


def test_order_1_medallas_shape():
    orders = parse_orders(XLSX_PATH)
    order = next(o for o in orders if o.order_id == 1)
    assert order.order_name == "Medallas"
    assert order.responsable == "Santy"
    assert len(order.entrega_events) == 2
    assert len(order.recibido_events) == 1
    assert len(order.recibido_events[0].lines) == 11


def test_order_8_asymmetric_event_counts():
    orders = parse_orders(XLSX_PATH)
    order = next(o for o in orders if o.order_id == 8)
    assert len(order.entrega_events) == 3
    assert len(order.recibido_events) == 5
