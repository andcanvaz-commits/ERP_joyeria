import uuid
from decimal import Decimal

from backend.modules.production.schemas import (
    ProcessMaterialCreate,
    ProductionProcessCreate,
    ProductionProcessStageCreate,
)


def _payload(raw_material_id) -> ProductionProcessCreate:
    return ProductionProcessCreate(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        materials=[ProcessMaterialCreate(inventory_item_id=raw_material_id)],
        stages=[ProductionProcessStageCreate(name="Etapa", order=1)],
    )


def test_create_process_without_ratio_fields(production_service, raw_material):
    read = production_service.create_process(_payload(raw_material.id))

    assert len(read.materials) == 1
    assert read.materials[0].inventory_item_id == raw_material.id
    assert not hasattr(read.materials[0], "quantity_per_unit")


def test_create_process_rejects_duplicate_material(production_service, raw_material):
    payload = _payload(raw_material.id)
    payload = payload.model_copy(
        update={"materials": [ProcessMaterialCreate(inventory_item_id=raw_material.id)] * 2}
    )
    import pytest
    from backend.modules.production.service import ProductionDomainError

    with pytest.raises(ProductionDomainError):
        production_service.create_process(payload)


def test_update_process_replaces_materials(production_service, process, raw_material, complement_item):
    payload = ProductionProcessCreate(
        name=process.name,
        materials=[
            ProcessMaterialCreate(inventory_item_id=raw_material.id),
            ProcessMaterialCreate(inventory_item_id=complement_item.id),
        ],
        stages=[ProductionProcessStageCreate(name="Etapa", order=1)],
    )
    read = production_service.update_process(process.id, payload)

    assert {m.inventory_item_id for m in read.materials} == {raw_material.id, complement_item.id}
