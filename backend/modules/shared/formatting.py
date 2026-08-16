from decimal import Decimal


def format_qty(value: Decimal) -> str:
    """Cantidad lista para un mensaje al usuario: sin los ceros decimales
    que arrastran las columnas Numeric(14,4) (400.0000 -> 400). `format(...,
    "f")` evita la notacion cientifica que Decimal.normalize() produce para
    numeros redondos (Decimal('4E+2'))."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text
