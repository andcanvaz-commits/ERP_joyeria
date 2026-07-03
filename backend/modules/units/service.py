from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.modules.units.models import UnitOfMeasure
from backend.modules.units.schemas import UnitCreate, UnitRead


# Unidades por defecto de una base nueva. El usuario puede agregar o quitar
# desde Mantenimiento > Datos > Unidades de medida.
DEFAULT_UNITS = (
    ("g", "Gramos (g)"),
    ("kg", "Kilogramos (kg)"),
    ("mg", "Miligramos (mg)"),
    ("oz_t", "Onza troy (oz t)"),
    ("dwt", "Pennyweight (dwt)"),
    ("ct", "Quilates / carats (ct)"),
    ("und", "Unidad (und)"),
)


class UnitError(ValueError):
    pass


class UnitsService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_units(self) -> list[UnitRead]:
        rows = (
            self.session.execute(select(UnitOfMeasure).order_by(UnitOfMeasure.label))
            .scalars()
            .all()
        )
        return [UnitRead.model_validate(row) for row in rows]

    def create_unit(self, payload: UnitCreate) -> UnitRead:
        code = payload.code.strip()
        existing = (
            self.session.execute(select(UnitOfMeasure).where(UnitOfMeasure.code == code))
            .scalars()
            .first()
        )
        if existing is not None:
            raise UnitError("Ya existe una unidad con ese codigo.")
        unit = UnitOfMeasure(code=code, label=payload.label.strip())
        self.session.add(unit)
        self.session.flush()
        return UnitRead.model_validate(unit)

    def delete_unit(self, unit_id: UUID) -> None:
        unit = self.session.get(UnitOfMeasure, unit_id)
        if unit is None:
            raise UnitError("Unidad no encontrada.")
        self.session.delete(unit)


def seed_units(session: Session) -> None:
    """Crea las unidades por defecto solo si faltan (idempotente)."""
    existing = {
        code
        for code in session.execute(select(UnitOfMeasure.code)).scalars().all()
    }
    for code, label in DEFAULT_UNITS:
        if code not in existing:
            session.add(UnitOfMeasure(code=code, label=label))
    session.commit()
