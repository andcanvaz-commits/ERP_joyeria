"""Los deletes de catalogo (product_types, catalog_segments, units_of_measure)
solo deben bloquearse por STOCK real (gramos/unidades > 0), no por la mera
existencia de una fila de inventario (una pieza archivada con stock 0 no debe
impedir borrar el tipo/segmento/unidad del catalogo)."""
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.modules.catalog.models import CatalogSegment
from backend.modules.catalog.service import CatalogSegmentInUseError, CatalogService
from backend.modules.inventory.models import InventoryItem
from backend.modules.product_types.models import ProductType
from backend.modules.product_types.service import ProductTypeInUseError, ProductTypeService
from backend.modules.units.models import UnitOfMeasure
from backend.modules.units.service import UnitInUseError, UnitsService


def _finished_item(db_session, product_code: str, stock: str, *, archived: bool = False) -> InventoryItem:
    from datetime import datetime, timezone

    item = InventoryItem(
        item_type="FINISHED_PRODUCT",
        name=f"Pieza test {uuid4().hex[:6]}",
        sku=f"PT-TEST-{uuid4().hex[:8]}",
        product_code=product_code,
        unit_code="und",
        current_stock=Decimal(stock),
        archived_at=datetime.now(timezone.utc) if archived else None,
    )
    db_session.add(item)
    db_session.flush()
    return item


# --- product_types.delete_type -------------------------------------------------


def test_delete_type_blocked_when_stock_exists(db_session):
    service = ProductTypeService(db_session)
    row = ProductType(category_code="99", model_code="9991", name=f"TIPO {uuid4().hex[:6]}")
    db_session.add(row)
    db_session.flush()
    _finished_item(db_session, "9999991", stock="5")

    with pytest.raises(ProductTypeInUseError, match="stock"):
        service.delete_type(row.id)


def test_delete_type_allowed_when_only_zero_stock_archived_piece_exists(db_session):
    service = ProductTypeService(db_session)
    row = ProductType(category_code="99", model_code="9992", name=f"TIPO {uuid4().hex[:6]}")
    db_session.add(row)
    db_session.flush()
    item = _finished_item(db_session, "9999992", stock="0", archived=True)

    service.delete_type(row.id)
    db_session.flush()

    assert db_session.get(ProductType, row.id) is None
    # El delete del tipo no toca la pieza archivada en inventario.
    assert db_session.get(InventoryItem, item.id) is not None


def test_delete_type_sums_stock_across_materials(db_session):
    service = ProductTypeService(db_session)
    row = ProductType(category_code="99", model_code="9993", name=f"TIPO {uuid4().hex[:6]}")
    db_session.add(row)
    db_session.flush()
    _finished_item(db_session, "1999993", stock="0")  # material 1, sin stock
    _finished_item(db_session, "2999993", stock="3")  # material 2, con stock

    with pytest.raises(ProductTypeInUseError):
        service.delete_type(row.id)


# --- catalog.delete_segment ----------------------------------------------------


def test_delete_material_segment_blocked_when_stock_exists(db_session):
    service = CatalogService(db_session)
    segment = CatalogSegment(kind="MATERIAL", code="9", label="Material test")
    db_session.add(segment)
    db_session.flush()
    _finished_item(db_session, "9990001", stock="2")

    with pytest.raises(CatalogSegmentInUseError):
        service.delete_segment(segment.id)


def test_delete_category_segment_blocked_when_stock_exists(db_session):
    service = CatalogService(db_session)
    segment = CatalogSegment(kind="CATEGORY", code="98", label="Categoria test")
    db_session.add(segment)
    db_session.flush()
    _finished_item(db_session, "1980001", stock="2")

    with pytest.raises(CatalogSegmentInUseError):
        service.delete_segment(segment.id)


def test_delete_model_segment_blocked_when_stock_exists(db_session):
    service = CatalogService(db_session)
    segment = CatalogSegment(kind="MODEL", code="9994", parent_code="97", label="Modelo test")
    db_session.add(segment)
    db_session.flush()
    _finished_item(db_session, "1979994", stock="1")

    with pytest.raises(CatalogSegmentInUseError):
        service.delete_segment(segment.id)


def test_delete_segment_allowed_when_stock_zero(db_session):
    service = CatalogService(db_session)
    segment = CatalogSegment(kind="CATEGORY", code="96", label="Categoria libre")
    db_session.add(segment)
    db_session.flush()

    service.delete_segment(segment.id)
    db_session.flush()

    assert db_session.get(CatalogSegment, segment.id) is None


# --- units.delete_unit -----------------------------------------------------------


def test_delete_unit_blocked_when_stock_exists(db_session):
    service = UnitsService(db_session)
    code = f"tu{uuid4().hex[:4]}"
    unit = UnitOfMeasure(code=code, label="Unidad test")
    db_session.add(unit)
    db_session.flush()
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name=f"MP test {uuid4().hex[:6]}",
        sku=f"MP-TEST-{uuid4().hex[:8]}",
        unit_code=code,
        current_stock=Decimal("4"),
    )
    db_session.add(item)
    db_session.flush()

    with pytest.raises(UnitInUseError):
        service.delete_unit(unit.id)


def test_delete_unit_allowed_when_stock_zero(db_session):
    service = UnitsService(db_session)
    code = f"tu{uuid4().hex[:4]}"
    unit = UnitOfMeasure(code=code, label="Unidad libre")
    db_session.add(unit)
    db_session.flush()

    service.delete_unit(unit.id)
    db_session.flush()

    assert db_session.get(UnitOfMeasure, unit.id) is None
