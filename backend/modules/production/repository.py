from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.modules.production.models import ProductionProcess


class ProductionProcessRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, process: ProductionProcess) -> ProductionProcess:
        self.session.add(process)
        return process

    def get(self, process_id: UUID) -> ProductionProcess | None:
        statement = (
            select(ProductionProcess)
            .options(selectinload(ProductionProcess.stages))
            .where(ProductionProcess.id == process_id)
        )
        return self.session.execute(statement).scalar_one_or_none()

    def list(self) -> list[ProductionProcess]:
        statement = (
            select(ProductionProcess)
            .options(selectinload(ProductionProcess.stages))
            .order_by(ProductionProcess.name.asc(), ProductionProcess.version.desc())
        )
        return list(self.session.execute(statement).scalars().all())

    def flush(self) -> None:
        self.session.flush()

    def delete(self, process: ProductionProcess) -> None:
        self.session.delete(process)
