"""Editar un proceso que ya tiene tipos de producto ligados.

Reemplazar la coleccion entera (`process.product_types = [...]`) hace que
SQLAlchemy emita el INSERT de la fila nueva ANTES del DELETE de la vieja
dentro del mismo flush. Con el unique (process_id, product_type_id) eso
revienta con IntegrityError -> 500, y el proceso queda inguardable.
"""
import uuid
from decimal import Decimal

import pytest

from backend.modules.product_types.models import ProductType
from backend.modules.production.schemas import (
    ProcessMaterialCreate,
    ProductionProcessCreate,
    ProductionProcessStageCreate,
    ProductionProcessUpdate,
)
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def product_type(db_session) -> ProductType:
    row = ProductType(
        category_code="14",
        model_code=uuid.uuid4().hex[:4],
        name=f"TIPO TEST {uuid.uuid4().hex[:4]}",
    )
    db_session.add(row)
    db_session.flush()
    return row


@pytest.fixture()
def other_product_type(db_session) -> ProductType:
    row = ProductType(
        category_code="14",
        model_code=uuid.uuid4().hex[:4],
        name=f"OTRO TIPO {uuid.uuid4().hex[:4]}",
    )
    db_session.add(row)
    db_session.flush()
    return row


def _payload(raw_material, product_type_ids, name="Proceso tipos test"):
    return dict(
        name=name,
        description=None,
        version=1,
        waste_limit_percent=Decimal("5"),
        is_active=True,
        materials=[
            ProcessMaterialCreate(inventory_item_id=raw_material.id)
        ],
        stages=[
            ProductionProcessStageCreate(name="Etapa", order=1, requires_weighing=True)
        ],
        product_type_ids=product_type_ids,
    )


def test_update_process_keeping_the_same_product_type(
    db_session, production_service, raw_material, product_type
):
    """Guardar un proceso sin cambiarle los tipos no debe reventar."""
    created = production_service.create_process(
        ProductionProcessCreate(**_payload(raw_material, [product_type.id]))
    )

    updated = production_service.update_process(
        created.id,
        ProductionProcessUpdate(**_payload(raw_material, [product_type.id], name="Renombrado")),
    )

    assert updated.name == "Renombrado"
    assert updated.product_type_ids == [product_type.id]


def test_update_process_swapping_product_types(
    db_session, production_service, raw_material, product_type, other_product_type
):
    created = production_service.create_process(
        ProductionProcessCreate(**_payload(raw_material, [product_type.id]))
    )

    updated = production_service.update_process(
        created.id,
        ProductionProcessUpdate(**_payload(raw_material, [other_product_type.id])),
    )

    assert updated.product_type_ids == [other_product_type.id]


def test_update_process_adding_a_second_product_type(
    db_session, production_service, raw_material, product_type, other_product_type
):
    created = production_service.create_process(
        ProductionProcessCreate(**_payload(raw_material, [product_type.id]))
    )

    updated = production_service.update_process(
        created.id,
        ProductionProcessUpdate(**_payload(raw_material, [product_type.id, other_product_type.id])),
    )

    assert set(updated.product_type_ids) == {product_type.id, other_product_type.id}


def test_update_process_clearing_product_types(
    db_session, production_service, raw_material, product_type
):
    created = production_service.create_process(
        ProductionProcessCreate(**_payload(raw_material, [product_type.id]))
    )

    updated = production_service.update_process(
        created.id, ProductionProcessUpdate(**_payload(raw_material, []))
    )

    assert updated.product_type_ids == []


def test_update_process_rejects_repeated_product_type(
    db_session, production_service, raw_material, product_type
):
    created = production_service.create_process(
        ProductionProcessCreate(**_payload(raw_material, [product_type.id]))
    )

    with pytest.raises(ProductionDomainError, match="No repitas"):
        production_service.update_process(
            created.id,
            ProductionProcessUpdate(**_payload(raw_material, [product_type.id, product_type.id])),
        )
