from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.modules.production.models import ProductionProcess, ProductionRun, ProductionRunStage


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

    def add_run(self, run: ProductionRun) -> ProductionRun:
        self.session.add(run)
        return run

    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(selectinload(ProductionRun.stages))
            .where(ProductionRun.id == run_id)
        )
        return self.session.execute(statement).scalar_one_or_none()

    def get_run_stage(self, stage_id: UUID) -> ProductionRunStage | None:
        statement = (
            select(ProductionRunStage)
            .options(selectinload(ProductionRunStage.run).selectinload(ProductionRun.stages))
            .where(ProductionRunStage.id == stage_id)
        )
        return self.session.execute(statement).scalar_one_or_none()

    def list_runs(self) -> list[ProductionRun]:
        statement = (
            select(ProductionRun)
            .options(selectinload(ProductionRun.stages))
            .order_by(ProductionRun.started_at.desc())
        )
        return list(self.session.execute(statement).scalars().all())

    def has_processes(self) -> bool:
        return self.session.execute(select(ProductionProcess.id).limit(1)).first() is not None

    def flush(self) -> None:
        self.session.flush()

    def delete(self, process: ProductionProcess) -> None:
        self.session.delete(process)
