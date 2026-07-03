from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.modules.units.models import UnitOfMeasure
from backend.modules.units.schemas import UnitCreate, UnitRead


# Unidades por defecto de una base nueva. El usuario puede agregar o quitar
# desde Mantenimiento > Datos > Unidades de medida.
# (abreviatura, nombre)
DEFAULT_UNITS = (
    ("g", "Gramos"),
    ("kg", "Kilogramos"),
    ("mg", "Miligramos"),
    ("oz t", "Onza troy"),
    ("dwt", "Pennyweight"),
    ("ct", "Quilates"),
    ("und", "Unidad"),
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

    def _code_taken(self, code: str) -> bool:
        return (
            self.session.execute(select(UnitOfMeasure).where(UnitOfMeasure.code == code))
            .scalars()
            .first()
            is not None
        )

    def create_unit(self, payload: UnitCreate) -> UnitRead:
        code = payload.code.strip()
        if self._code_taken(code):
            raise UnitError("Ya existe una unidad con esa abreviatura.")
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
