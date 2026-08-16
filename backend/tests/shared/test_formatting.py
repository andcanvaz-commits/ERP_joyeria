from decimal import Decimal

from backend.modules.shared.formatting import format_qty


def test_format_qty_strips_trailing_zeros_on_integer_value():
    assert format_qty(Decimal("400.0000")) == "400"


def test_format_qty_keeps_significant_decimals():
    assert format_qty(Decimal("399.8000")) == "399.8"


def test_format_qty_keeps_small_fractional_value():
    assert format_qty(Decimal("0.2000")) == "0.2"


def test_format_qty_handles_whole_number_without_dot():
    assert format_qty(Decimal("10")) == "10"


def test_format_qty_keeps_all_significant_decimals():
    assert format_qty(Decimal("0.0001")) == "0.0001"
