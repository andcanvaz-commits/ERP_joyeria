"""Insumos consumidos (acta de entrega): supply_consumptions debe traer solo
insumos de verdad, no duplicar complementos que ya viven en run.complements."""
from decimal import Decimal

from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunComplementCreate,
    RunProductCreate,
)


def test_approved_complement_does_not_leak_into_supply_consumptions(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    """approve_materials genera un movimiento CONSUMO_PRODUCCION para cada
    complemento aprobado (igual que para un insumo real). Bug reportado: ese
    mismo movimiento tambien aparecia en supply_consumptions, duplicando la
    fila del complemento en el picker de "Entregar material" con la misma
    cantidad -- ahi solo deben caer insumos que no sean complementos de la
    orden."""
    raw_material.current_stock = Decimal("100")
    complement_item.current_stock = Decimal("50")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("15"))],
    )
    run_read = production_service.create_run(payload, current_user)
    approved = production_service.approve_materials(run_read.id, current_user)

    complement_rows = [c for c in (approved.complements or []) if c.item_id == complement_item.id]
    assert len(complement_rows) == 1
    assert complement_rows[0].quantity == Decimal("15")

    supply_rows = [s for s in (approved.supply_consumptions or []) if s.item_id == complement_item.id]
    assert supply_rows == []
