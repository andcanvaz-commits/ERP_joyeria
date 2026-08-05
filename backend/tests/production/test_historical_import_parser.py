from pathlib import Path

from backend.scripts.import_historical_orders import parse_orders

# NOTA: el brief original hardcodea la ruta de host Windows
# (r"C:\Users\MSI I7\Desktop\Trabajo\Joyeria\Ordenes de Producción.xlsx").
# Estos tests corren dentro del contenedor erp_joyeria-api-1 (unico entorno
# con openpyxl y el resto de dependencias del backend disponibles), asi que
# se usa la copia del archivo en /tmp/ordenes.xlsx (ver docker cp en el
# reporte de la Tarea 6). Ajustar de vuelta a la ruta de host si estos tests
# se corren fuera de Docker.
XLSX_PATH = Path("/tmp/ordenes.xlsx")


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
