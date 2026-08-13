from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.modules.production.models import ProductionProcess, ProductionProcessStage, ProductionProcessStageIngredient, ProductionRun, ProductionRunStage


class ProductionProcessRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, process: ProductionProcess) -> ProductionProcess:
        self.session.add(process)
        return process

    def get(self, process_id: UUID) -> ProductionProcess | None:
        statement = (
            select(ProductionProcess)
            .options(
                selectinload(ProductionProcess.stages).selectinload(ProductionProcessStage.ingredients)
            )
            .where(ProductionProcess.id == process_id)
        )
        return self.session.execute(statement).scalar_one_or_none()

    def list(self) -> list[ProductionProcess]:
        statement = (
            select(ProductionProcess)
            .options(
                selectinload(ProductionProcess.stages).selectinload(ProductionProcessStage.ingredients)
            )
            .order_by(ProductionProcess.name.asc(), ProductionProcess.version.desc())
        )
        return list(self.session.execute(statement).scalars().all())

    def add_run(self, run: ProductionRun) -> ProductionRun:
        self.session.add(run)
        return run

    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
                selectinload(ProductionRun.event_lines),
            )
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
            .options(
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
                selectinload(ProductionRun.event_lines),
            )
            .order_by(ProductionRun.requested_at.desc())
        )
        return list(self.session.execute(statement).scalars().all())

    def count_runs_this_year(self, year: int) -> int:
        from sqlalchemy import extract, func
        result = self.session.execute(
            select(func.count(ProductionRun.id)).where(
                extract("year", ProductionRun.requested_at) == year
            )
        ).scalar_one_or_none()
        return int(result or 0)

    def next_run_seq_this_year(self, year: int) -> int:
        """Siguiente secuencia = mayor código existente del año + 1 (no cuenta filas,
        así borrar órdenes no reutiliza códigos ya usados)."""
        prefix = f"OP-{year}-"
        codes = (
            self.session.execute(
                select(ProductionRun.production_code).where(ProductionRun.production_code.like(f"{prefix}%"))
            )
            .scalars()
            .all()
        )
        nums = []
        for code in codes:
            try:
                nums.append(int(code.rsplit("-", 1)[1]))
            except (ValueError, IndexError, AttributeError):
                continue
        return (max(nums) + 1) if nums else 1

    def has_processes(self) -> bool:
        return self.session.execute(select(ProductionProcess.id).limit(1)).first() is not None

    def flush(self) -> None:
        self.session.flush()

    def delete(self, process: ProductionProcess) -> None:
        self.session.delete(process)

    def delete_orphan_runs(self) -> int:
        """Remove production runs whose process no longer exists (old/test data)."""
        valid_process_ids = select(ProductionProcess.id)
        orphan_runs = list(
            self.session.execute(
                select(ProductionRun)
                .options(selectinload(ProductionRun.stages))
                .where(ProductionRun.process_id.not_in(valid_process_ids))
            )
            .scalars()
            .all()
        )
        for run in orphan_runs:
            self.session.delete(run)
        return len(orphan_runs)
