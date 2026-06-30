from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.inventory.service import InventoryDomainError, InventoryService
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunStage,
    ProductionRunStageDecision,
    ProductionRunStageStatus,
    ProductionRunStatus,
)

DECISION_STAGE_TYPES = {"DECISION", "CONTROL"}
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    ProductionRunStageFinish,
)


def _resolve_run_user_names(session, user_ids: list) -> dict:
    if not user_ids:
        return {}
    from sqlalchemy import select
    from backend.modules.auth.models import AuthUser
    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}
    users = session.execute(select(AuthUser).where(AuthUser.id.in_(unique_ids))).scalars().all()
    result = {}
    for user in users:
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        result[str(user.id)] = name or user.username
    return result


def _populate_run_names(session, reads: list, runs: list) -> None:
    """Resuelve los nombres de las cuentas que actuaron sobre cada orden y etapa
    (creo / inicio / aprobo / recibio / finalizo etapa) y los asigna a los reads."""
    ids: list = []
    for run in runs:
        ids.extend([
            run.created_by_user_id,
            run.started_by_user_id,
            run.materials_approved_by_user_id,
            run.received_by_user_id,
        ])
        for stage in run.stages:
            ids.append(stage.finished_by_user_id)
            for decision in stage.decisions:
                ids.append(decision.decided_by_user_id)
    names = _resolve_run_user_names(session, [i for i in ids if i])

    def name_for(value):
        return names.get(str(value)) if value else None

    for read, run in zip(reads, runs):
        read.created_by_name = name_for(run.created_by_user_id)
        read.started_by_name = name_for(run.started_by_user_id)
        read.materials_approved_by_name = name_for(run.materials_approved_by_user_id)
        read.received_by_name = name_for(run.received_by_user_id)
        stages_by_id = {str(stage.id): stage for stage in run.stages}
        for stage_read in read.stages:
            stage = stages_by_id.get(str(stage_read.id))
            if stage is not None:
                stage_read.finished_by_name = name_for(stage.finished_by_user_id)
                for decision_read, decision in zip(stage_read.decisions, stage.decisions):
                    decision_read.decided_by_name = name_for(decision.decided_by_user_id)


# Procesos de ejemplo tomados de los documentos de la joyeria (cadenas, monedas,
# medallas y casting). Viven solo como DATOS de siembra; el sistema sigue siendo
# generico y el administrador puede editarlos o crear procesos totalmente nuevos.
# Tipos de etapa: PROCESS, THERMAL, CHEMICAL, CONTROL, DECISION.
EXAMPLE_PROCESSES: tuple[dict, ...] = (
    {
        "name": "Cadenas de Oro",
        "description": "Fabricacion de cadenas de oro, desde fundicion hasta producto terminado.",
        "material_per_unit": Decimal("12.0000"),
        "waste_limit_percent": Decimal("5"),
        "stages": (
            {"name": "Materia Prima", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 10,
             "description": "Ingreso del material que sera utilizado para fabricar la cadena."},
            {"name": "Fundicion", "stage_type": "THERMAL", "requires_weighing": True, "estimated_minutes": 30,
             "description": "El metal se calienta a altas temperaturas hasta volverse liquido."},
            {"name": "Laminado de Hilo", "stage_type": "DECISION", "requires_weighing": True, "estimated_minutes": 25,
             "description": "El metal fundido se lamina para obtener hilo con el grosor requerido.",
             "quality_check": "¿El hilo cumple con el grosor requerido?",
             "rework_action": "Si no cumple, regresa a Fundicion para reprocesar."},
            {"name": "Recocido", "stage_type": "THERMAL", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se calienta el hilo para mejorar su flexibilidad y maleabilidad."},
            {"name": "Amoniaco Gas", "stage_type": "CHEMICAL", "requires_weighing": False, "estimated_minutes": 15,
             "description": "Limpieza superficial con gas amoniaco para eliminar impurezas y oxidos.",
             "quality_check": "¿La limpieza fue aprobada?",
             "rework_action": "Si la limpieza es rechazada, repetir el tratamiento."},
            {"name": "Tejido", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 40,
             "description": "El hilo se entrelaza para formar la estructura de la cadena."},
            {"name": "Soldado", "stage_type": "DECISION", "requires_weighing": False, "estimated_minutes": 25,
             "description": "Se unen los eslabones mediante soldadura para dar continuidad a la cadena.",
             "quality_check": "¿La soldadura cumple con el estandar?",
             "rework_action": "Si no cumple, vuelve a revision o correccion."},
            {"name": "Bruñido", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se pule la cadena para mejorar brillo, suavidad y acabado."},
            {"name": "Planchado", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se aplana y nivela la cadena para uniformar su superficie."},
            {"name": "Diamantado", "stage_type": "DECISION", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Cortes con punta de diamante para dar brillo y diseño a la cadena.",
             "quality_check": "¿Cumple con el brillo y diseño requerido?",
             "rework_action": "Si no cumple, se corrige o vuelve al proceso necesario."},
            {"name": "Cortado", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 15,
             "description": "Se corta la cadena en las medidas y longitudes solicitadas."},
            {"name": "Placas y Broches", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se colocan placas, broches y accesorios segun el diseño."},
            {"name": "Control de Calidad Final", "stage_type": "CONTROL", "requires_weighing": True, "estimated_minutes": 15,
             "description": "Inspeccion final del producto terminado.",
             "quality_check": "Revisar acabado, medidas, peso, soldaduras, brillo y diseño. Aprobar o rechazar.",
             "rework_action": "Si se rechaza, registrar observaciones y enviar a correccion."},
            {"name": "Producto Terminado", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 5,
             "description": "La cadena aprobada queda lista para entrega o almacenamiento."},
        ),
    },
    {
        "name": "Monedas",
        "description": "Produccion de monedas, desde recepcion de materia prima hasta entrega.",
        "material_per_unit": Decimal("3.0000"),
        "waste_limit_percent": Decimal("4"),
        "stages": (
            {"name": "Recepcion de Materia Prima", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 10,
             "description": "Recepcion e inspeccion de la materia prima (metal)."},
            {"name": "Fundicion", "stage_type": "THERMAL", "requires_weighing": True, "estimated_minutes": 30,
             "description": "El metal se funde a altas temperaturas para obtener metal liquido."},
            {"name": "Laminado", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 25,
             "description": "El metal fundido se lamina para reducir su grosor y obtener laminas uniformes."},
            {"name": "Cortado", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Las laminas se cortan en discos del tamaño especificado para las monedas."},
            {"name": "Revision de Peso", "stage_type": "CONTROL", "requires_weighing": True, "estimated_minutes": 10,
             "description": "Se verifica que el peso de los discos cumpla con el estandar.",
             "quality_check": "¿El peso de los discos cumple con el estandar?",
             "rework_action": "Aceptar o rechazar piezas fuera de rango; generar reporte de diferencias."},
            {"name": "Recocido", "stage_type": "THERMAL", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Los discos se calientan para ablandar el metal y facilitar el siguiente proceso."},
            {"name": "Bruñido", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se pule la superficie de los discos para mejorar acabado y brillo."},
            {"name": "Revision de Calidad", "stage_type": "CONTROL", "requires_weighing": False, "estimated_minutes": 10,
             "description": "Inspeccion del acabado y la calidad superficial de los discos.",
             "quality_check": "¿El acabado y la calidad cumplen con el estandar?",
             "rework_action": "Aprobar o rechazar; registrar observaciones."},
            {"name": "Acido Sulfurico", "stage_type": "CHEMICAL", "requires_weighing": False, "estimated_minutes": 15,
             "description": "Los discos se sumergen en acido sulfurico para limpiar impurezas y oxidos."},
            {"name": "Prensado", "stage_type": "PROCESS", "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se acuñan los diseños en los discos mediante prensas de alta presion."},
            {"name": "Entrega", "stage_type": "PROCESS", "requires_weighing": True, "estimated_minutes": 10,
             "description": "Las monedas terminadas se embalan y se entregan al cliente."},
        ),
    },
    {
        "name": "Medallas",
        "description": "Produccion de medallas: preparacion, fabricacion, acabado y control final.",
        "material_per_unit": Decimal("6.0000"),
        "waste_limit_percent": Decimal("5"),
        "stages": (
            {"name": "Recepcion de Materia Prima", "stage_type": "PROCESS", "phase_name": "Fase 1 - Preparacion",
             "requires_weighing": True, "estimated_minutes": 10,
             "description": "Se recibe el metal (aleacion) y se verifica su cantidad y calidad."},
            {"name": "Fundicion", "stage_type": "THERMAL", "phase_name": "Fase 1 - Preparacion",
             "requires_weighing": True, "estimated_minutes": 30,
             "description": "El metal se funde a altas temperaturas para obtener metal liquido."},
            {"name": "Moldeado", "stage_type": "PROCESS", "phase_name": "Fase 1 - Preparacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "El metal liquido se vierte en moldes para dar forma inicial a la medalla."},
            {"name": "Cortado mediante Maquina de Corte", "stage_type": "DECISION", "phase_name": "Fase 1 - Preparacion",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Las medallas se cortan con la forma deseada segun el diseño.",
             "quality_check": "¿La medalla cumple con la forma y dimensiones?",
             "rework_action": "Si no cumple, repetir el moldeado."},
            {"name": "Desbaste", "stage_type": "PROCESS", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se eliminan rebabas e imperfecciones para dejar la medalla uniforme."},
            {"name": "Recocido", "stage_type": "THERMAL", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se calienta la medalla para eliminar tensiones internas y mejorar su trabajabilidad."},
            {"name": "Acido (Desoxidado)", "stage_type": "CHEMICAL", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se limpia la medalla en baño acido para eliminar oxidos e impurezas."},
            {"name": "Lavado", "stage_type": "PROCESS", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 10,
             "description": "Se enjuaga la medalla para eliminar residuos de acido."},
            {"name": "Estampado", "stage_type": "PROCESS", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se coloca el diseño principal de la medalla mediante estampado en prensa."},
            {"name": "Grabado", "stage_type": "CONTROL", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se detallan diseños, textos o imagenes con grabado.",
             "quality_check": "Revision de grabado: profundidad, nitidez y calidad."},
            {"name": "Pulido", "stage_type": "PROCESS", "phase_name": "Fase 2 - Fabricacion",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se pule la superficie de la medalla para brillo, suavidad y mejor apariencia."},
            {"name": "Baño de Acabado", "stage_type": "PROCESS", "phase_name": "Fase 3 - Acabado",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se aplica baño (oro, plata, niquel, bronce) para color, proteccion y acabado final."},
            {"name": "Esmaltado", "stage_type": "PROCESS", "phase_name": "Fase 3 - Acabado",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se aplica esmalte de color en las areas del diseño que lo requieren (si aplica)."},
            {"name": "Secado", "stage_type": "DECISION", "phase_name": "Fase 3 - Acabado",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se seca la medalla para fijar el acabado y el esmalte.",
             "quality_check": "¿El acabado cumple con el estandar?",
             "rework_action": "Si no cumple, regresa a la fase de fabricacion."},
            {"name": "Control de Calidad y Final", "stage_type": "CONTROL", "phase_name": "Fase 4 - Control y Final",
             "requires_weighing": True, "estimated_minutes": 15,
             "description": "Se inspecciona la medalla completa: medidas, diseño, acabado y calidad general."},
            {"name": "Empaque", "stage_type": "PROCESS", "phase_name": "Fase 4 - Control y Final",
             "requires_weighing": False, "estimated_minutes": 10,
             "description": "Se empacan las medallas para su proteccion y presentacion."},
            {"name": "Producto Terminado", "stage_type": "PROCESS", "phase_name": "Fase 4 - Control y Final",
             "requires_weighing": True, "estimated_minutes": 5,
             "description": "La medalla terminada queda lista para entrega o almacenamiento."},
        ),
    },
    {
        "name": "Casting de Joyas (Oro)",
        "description": "Proceso de casting de joyas en oro: ceras, revestimiento, horneado y acabado.",
        "material_per_unit": Decimal("8.0000"),
        "waste_limit_percent": Decimal("6"),
        "stages": (
            {"name": "Diseño (3D / Manual)", "stage_type": "PROCESS", "phase_name": "Fase 1 - Diseño y Ceras",
             "requires_weighing": False, "estimated_minutes": 30,
             "description": "Se define el modelo de la pieza de forma manual o en 3D."},
            {"name": "Vulcanizado del Molde", "stage_type": "PROCESS", "phase_name": "Fase 1 - Diseño y Ceras",
             "requires_weighing": False, "estimated_minutes": 25,
             "description": "Se crea el molde a partir del modelo mediante vulcanizado."},
            {"name": "Inyeccion de Cera", "stage_type": "PROCESS", "phase_name": "Fase 1 - Diseño y Ceras",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se inyecta cera en el molde para obtener la pieza en cera."},
            {"name": "Limpieza y Retoque de Ceras", "stage_type": "DECISION", "phase_name": "Fase 1 - Diseño y Ceras",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se limpia y retoca la pieza en cera.",
             "quality_check": "¿La cera esta perfecta y cumple las especificaciones?",
             "rework_action": "Si no cumple, repetir la inyeccion / moldeado de cera."},
            {"name": "Montaje del Arbol", "stage_type": "PROCESS", "phase_name": "Fase 2 - Armado y Revestimiento",
             "requires_weighing": True, "estimated_minutes": 20,
             "description": "Se montan las piezas de cera en el arbol (arbolito) y se registra el peso de cera."},
            {"name": "Envestido (En Cilindro)", "stage_type": "PROCESS", "phase_name": "Fase 2 - Armado y Revestimiento",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se coloca el arbol en el cilindro para el revestimiento."},
            {"name": "Mezcla y Vaciado de Revestimiento", "stage_type": "PROCESS", "phase_name": "Fase 2 - Armado y Revestimiento",
             "requires_weighing": False, "estimated_minutes": 20,
             "description": "Se prepara el yeso/revestimiento y se vacia en el cilindro."},
            {"name": "Camara de Vacio (Desgasificado)", "stage_type": "PROCESS", "phase_name": "Fase 2 - Armado y Revestimiento",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se eliminan las burbujas del revestimiento en camara de vacio."},
            {"name": "Fundicion / Liga", "stage_type": "THERMAL", "phase_name": "Fase 3 - Horneado y Casting",
             "requires_weighing": True, "estimated_minutes": 40,
             "description": "Se calienta el cilindro y se prepara la liga/aleacion para la fundicion."},
            {"name": "Inyeccion de Oro (Casting)", "stage_type": "THERMAL", "phase_name": "Fase 3 - Horneado y Casting",
             "requires_weighing": True, "estimated_minutes": 30,
             "description": "Se controla temperatura y vacio para inyectar el oro en el molde."},
            {"name": "Choque Termico y Desmoldado", "stage_type": "THERMAL", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se aplica choque termico para desmoldar el arbol fundido."},
            {"name": "Limpieza Quimica (Decapado)", "stage_type": "CHEMICAL", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": False, "estimated_minutes": 15,
             "description": "Se limpia y decapa la pieza para eliminar restos de revestimiento."},
            {"name": "Corte de Casting (Control de Metal)", "stage_type": "DECISION", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": True, "estimated_minutes": 15,
             "description": "Se cortan las piezas del arbol y se controla el metal.",
             "quality_check": "¿Casting exitoso? ¿Cumple con el estandar de metal?",
             "rework_action": "Si no cumple, lote rechazado y retorno a refinacion; registrar mermas/tronco recuperable."},
            {"name": "Pulido en Cascara de Nuez", "stage_type": "PROCESS", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": False, "estimated_minutes": 30,
             "description": "Las piezas se desbastan y pulen en tombolas con cascara de nuez."},
            {"name": "Acabado Final y Embalado", "stage_type": "PROCESS", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": True, "estimated_minutes": 20,
             "description": "Se aplica pulido manual y abrillantado final, y se empacan las piezas."},
            {"name": "Producto Terminado", "stage_type": "PROCESS", "phase_name": "Fase 4 - Desmoldado y Final",
             "requires_weighing": True, "estimated_minutes": 5,
             "description": "La pieza queda lista para entrega o almacenamiento."},
        ),
    },
)


def _generate_production_code(repository: "ProductionProcessRepository", year: int) -> str:
    seq = repository.count_runs_this_year(year) + 1
    return f"OP-{year}-{seq:04d}"


def _stage_code_for(stage_name: str, run_seq: int, stage_order: int) -> str:
    prefix = "".join(c for c in stage_name.upper() if c.isalpha())[:3] or "ETB"
    return f"{prefix}-OP{run_seq:04d}-{stage_order:02d}"


class ProductionDomainError(ValueError):
    pass


class ProductionNotFoundError(LookupError):
    pass


class ProductionService:
    def __init__(self, repository: ProductionProcessRepository, inventory_service: InventoryService | None = None) -> None:
        self.repository = repository
        self.inventory_service = inventory_service

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._ensure_material_configuration(payload.raw_material_item_id, payload.raw_material_quantity_per_unit)

        stages = []
        for stage_data in payload.stages:
            stage = ProductionProcessStage(
                name=stage_data.name,
                description=stage_data.description,
                phase_name=stage_data.phase_name,
                stage_type=stage_data.stage_type,
                quality_check=stage_data.quality_check,
                rework_action=stage_data.rework_action,
                rework_target_order=stage_data.rework_target_order,
                stage_order=stage_data.order,
                estimated_minutes=stage_data.estimated_minutes,
                requires_weighing=stage_data.requires_weighing,
                is_active=stage_data.is_active,
                ingredients=[
                    ProductionProcessStageIngredient(
                        inventory_item_id=ing.inventory_item_id,
                        quantity=ing.quantity,
                        unit_code=ing.unit_code,
                    )
                    for ing in stage_data.ingredients
                ],
            )
            stages.append(stage)

        process = ProductionProcess(
            name=payload.name,
            description=payload.description,
            version=payload.version,
            raw_material_item_id=payload.raw_material_item_id,
            raw_material_quantity_per_unit=payload.raw_material_quantity_per_unit,
            raw_material_unit_code=payload.raw_material_unit_code,
            waste_limit_percent=payload.waste_limit_percent,
            is_active=payload.is_active,
            stages=stages,
        )
        self.repository.add(process)
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

    def list_processes(self) -> list[ProductionProcessRead]:
        return [ProductionProcessRead.model_validate(process) for process in self.repository.list()]

    def update_process(self, process_id: UUID, payload: ProductionProcessUpdate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._ensure_material_configuration(payload.raw_material_item_id, payload.raw_material_quantity_per_unit)
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.version = payload.version
        process.raw_material_item_id = payload.raw_material_item_id
        process.raw_material_quantity_per_unit = payload.raw_material_quantity_per_unit
        process.raw_material_unit_code = payload.raw_material_unit_code
        process.waste_limit_percent = payload.waste_limit_percent
        process.is_active = payload.is_active
        new_stages = []
        for stage_data in payload.stages:
            stage = ProductionProcessStage(
                name=stage_data.name,
                description=stage_data.description,
                phase_name=stage_data.phase_name,
                stage_type=stage_data.stage_type,
                quality_check=stage_data.quality_check,
                rework_action=stage_data.rework_action,
                rework_target_order=stage_data.rework_target_order,
                stage_order=stage_data.order,
                estimated_minutes=stage_data.estimated_minutes,
                requires_weighing=stage_data.requires_weighing,
                is_active=stage_data.is_active,
                ingredients=[
                    ProductionProcessStageIngredient(
                        inventory_item_id=ing.inventory_item_id,
                        quantity=ing.quantity,
                        unit_code=ing.unit_code,
                    )
                    for ing in stage_data.ingredients
                ],
            )
            new_stages.append(stage)

        process.stages = new_stages
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

    def delete_process(self, process_id: UUID) -> None:
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        self.repository.delete(process)

    # Etapas que delataban un proceso demo viejo (3 etapas genericas) o nombres demo previos.
    _OBSOLETE_DEMO_STAGE_NAMES = {"preparacion", "trabajo principal", "control final"}
    _OBSOLETE_DEMO_PROCESS_NAMES = {"monedas de oro", "cadenas de oro"}

    def seed_example_processes(self) -> None:
        """Limpia datos demo viejos y siembra los procesos de ejemplo reales.

        Los nombres y etapas viven solo como datos en la base; el backend y el
        frontend siguen siendo genericos. Es idempotente: solo crea un proceso de
        ejemplo si todavia no existe por nombre, asi se respetan ediciones del usuario.
        """
        if self.inventory_service is None:
            return

        gold = self.inventory_service.ensure_production_item(
            item_type="RAW_MATERIAL",
            name="Oro 18K",
            unit_code="g",
        )
        if gold.current_stock <= 0:
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=gold.id,
                    movement_type="ENTRADA",
                    quantity=Decimal("5000"),
                    reason="Stock inicial de ejemplo para produccion.",
                ),
                user_id=None,
            )

        # 1) Eliminar procesos demo antiguos (nombre demo o firma de 3 etapas genericas).
        for process in self.repository.list():
            stage_names = {stage.name.strip().lower() for stage in process.stages}
            is_obsolete_name = process.name.strip().lower() in self._OBSOLETE_DEMO_PROCESS_NAMES
            is_obsolete_signature = stage_names == self._OBSOLETE_DEMO_STAGE_NAMES
            if is_obsolete_name or is_obsolete_signature:
                self.repository.delete(process)
        self.repository.flush()

        # 2) Crear procesos de ejemplo que aun no existan por nombre.
        existing_names = {process.name.strip().lower() for process in self.repository.list()}
        for definition in EXAMPLE_PROCESSES:
            if definition["name"].strip().lower() in existing_names:
                continue
            self.create_process(
                ProductionProcessCreate(
                    name=definition["name"],
                    description=definition["description"],
                    raw_material_item_id=gold.id,
                    raw_material_quantity_per_unit=definition["material_per_unit"],
                    raw_material_unit_code=gold.unit_code,
                    waste_limit_percent=definition["waste_limit_percent"],
                    stages=[
                        {"order": index + 1, **stage}
                        for index, stage in enumerate(definition["stages"])
                    ],
                )
            )

        # 3) Limpiar ordenes huerfanas que apuntaban a procesos eliminados.
        self.repository.delete_orphan_runs()
        self.repository.flush()

    def create_run(self, payload: ProductionRunCreate, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para iniciar produccion.")
        process = self.repository.get(payload.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        if not process.is_active:
            raise ProductionDomainError("El proceso no esta activo.")
        if process.raw_material_item_id is None or process.raw_material_quantity_per_unit is None:
            raise ProductionDomainError("El proceso no tiene materia prima por unidad configurada.")

        active_stages = [stage for stage in process.stages if stage.is_active]
        if not active_stages:
            raise ProductionDomainError("El proceso debe tener al menos una etapa activa.")

        total_required = process.raw_material_quantity_per_unit * payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            status=ProductionRunStatus.PENDING_INVENTORY,
            raw_material_item_id=process.raw_material_item_id,
            raw_material_quantity_per_unit=process.raw_material_quantity_per_unit,
            raw_material_unit_code=process.raw_material_unit_code or "",
            total_required_material=total_required,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=total_required,
            created_by_user_id=current_user.id,
            requested_at=datetime.utcnow(),
        )
        run.production_code = _generate_production_code(self.repository, datetime.utcnow().year)
        run_seq = int(run.production_code.split("-")[2]) if run.production_code else 0

        for stage in sorted(active_stages, key=lambda item: item.stage_order):
            run.stages.append(
                ProductionRunStage(
                    source_stage_id=stage.id,
                    stage_name=stage.name,
                    phase_name=stage.phase_name,
                    stage_type=stage.stage_type,
                    quality_check=stage.quality_check,
                    rework_action=stage.rework_action,
                    rework_target_order=stage.rework_target_order,
                    stage_order=stage.stage_order,
                    estimated_minutes=stage.estimated_minutes,
                    requires_weighing=stage.requires_weighing,
                    status=ProductionRunStageStatus.PENDING,
                    stage_code=_stage_code_for(stage.name, run_seq, stage.stage_order),
                )
            )

        self.repository.add_run(run)
        self.repository.flush()
        self.inventory_service.reserve_materials_for_production(
            production_order_id=run.id,
            requirements=(),
        )
        self.repository.flush()
        return ProductionRunRead.model_validate(run)

    def approve_materials(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para aprobar materiales.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se pueden aprobar materiales de ordenes pendientes de Inventario.")
        try:
            self.inventory_service.consume_material_for_production(
                item_id=run.raw_material_item_id,
                quantity=run.total_required_material,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(str(exc)) from exc
        run.status = ProductionRunStatus.MATERIALS_APPROVED
        run.materials_approved_at = datetime.utcnow()
        run.materials_approved_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)

    def start_run(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.MATERIALS_APPROVED:
            raise ProductionDomainError("Inventario debe aprobar la salida de materia prima antes de iniciar.")

        started_at = datetime.utcnow()
        run.status = ProductionRunStatus.IN_PROGRESS
        run.started_at = started_at
        run.started_by_user_id = current_user.id

        next_start = started_at
        ordered_stages = sorted(run.stages, key=lambda item: item.stage_order)
        for index, stage in enumerate(ordered_stages):
            estimated = stage.estimated_minutes or 0
            next_finish = next_start + timedelta(minutes=estimated)
            stage.status = ProductionRunStageStatus.IN_PROGRESS if index == 0 else ProductionRunStageStatus.PENDING
            stage.scheduled_start_at = next_start
            stage.scheduled_finish_at = next_finish
            stage.started_at = started_at if index == 0 else None
            next_start = next_finish

        self.repository.flush()
        return self._read_with_names(run)

    def _read_with_names(self, run: ProductionRun) -> ProductionRunRead:
        read = ProductionRunRead.model_validate(run)
        _populate_run_names(self.repository.session, [read], [run])
        return read

    def list_runs(self) -> list[ProductionRunRead]:
        runs = self.repository.list_runs()
        reads = [ProductionRunRead.model_validate(run) for run in runs]
        _populate_run_names(self.repository.session, reads, runs)
        return reads

    def finish_stage(self, stage_id: UUID, payload: ProductionRunStageFinish, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para finalizar produccion.")
        stage = self.repository.get_run_stage(stage_id)
        if stage is None:
            raise ProductionNotFoundError("Etapa de produccion no encontrada.")
        run = stage.run
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError("La produccion ya no esta en proceso.")
        if stage.status not in (ProductionRunStageStatus.PENDING, ProductionRunStageStatus.IN_PROGRESS):
            raise ProductionDomainError("Solo se puede finalizar la etapa en curso.")
        if stage.requires_weighing and payload.final_weight is None:
            raise ProductionDomainError("Esta etapa requiere registrar el nuevo pesaje.")

        now = datetime.utcnow()
        scheduled_finish_at = stage.scheduled_finish_at.replace(tzinfo=None) if stage.scheduled_finish_at else None
        if scheduled_finish_at and now < scheduled_finish_at and not payload.confirm_early_finish:
            raise ProductionDomainError("La etapa esta terminando antes del tiempo estimado. Confirma para continuar.")

        requires_decision = stage.stage_type in DECISION_STAGE_TYPES or bool(stage.quality_check)

        # Condición de peso: comparar el peso nuevo contra el peso de referencia
        # (la etapa pesada anterior, o el material total) frente al límite de merma.
        weight_based = False
        auto_justification: str | None = None
        if stage.requires_weighing and payload.final_weight is not None:
            reference = self._previous_stage_weight(run, stage)
            if reference and reference > 0:
                loss_pct = (reference - payload.final_weight) / reference * Decimal("100")
                if loss_pct > run.waste_limit_percent:
                    weight_based = True
                    auto_justification = (
                        f"Peso {payload.final_weight} implica una pérdida de {loss_pct:.2f}% "
                        f"que supera el límite permitido {run.waste_limit_percent:.2f}%."
                    )

        if requires_decision and payload.decision is None:
            raise ProductionDomainError("Selecciona aprobar o rechazar esta etapa.")

        attempt_no = len(stage.decisions) + 1

        if stage.status == ProductionRunStageStatus.PENDING:
            stage.status = ProductionRunStageStatus.IN_PROGRESS
            stage.started_at = stage.started_at or now
        stage.initial_weight = payload.initial_weight
        stage.final_weight = payload.final_weight

        # ── Rechazo: registrar intento y devolver el flujo ──────────────
        if requires_decision and payload.decision == "REJECTED":
            justification = (payload.justification or "").strip() or auto_justification

            target_order = stage.rework_target_order
            if not target_order or target_order < 1:
                target_order = stage.stage_order - 1 if stage.stage_order > 1 else stage.stage_order

            self._record_decision(
                run, stage, "REJECTED", justification, weight_based,
                payload.final_weight, target_order, current_user, attempt_no,
            )

            target_stage = None
            for candidate in sorted(run.stages, key=lambda item: item.stage_order):
                if candidate.stage_order < target_order:
                    continue
                candidate.status = ProductionRunStageStatus.PENDING
                if candidate.stage_order > target_order:
                    candidate.started_at = None
                    candidate.finished_at = None
                    candidate.initial_weight = None
                    candidate.final_weight = None
                else:
                    target_stage = candidate
            if target_stage is not None:
                target_stage.status = ProductionRunStageStatus.IN_PROGRESS
                target_stage.started_at = now
                target_stage.finished_at = None

            self.repository.flush()
            return self._read_with_names(run)

        # ── Aprobación / etapa normal: finalizar y avanzar ──────────────
        # Registrar si es etapa de decisión, o si se pasó pese a que el peso no
        # cumple la condición (queda constancia del override del usuario).
        if requires_decision or weight_based:
            note = (payload.justification or "").strip() or auto_justification
            self._record_decision(
                run, stage, "APPROVED", note,
                weight_based, payload.final_weight, None, current_user, attempt_no,
            )

        stage.finished_at = now
        stage.finished_by_user_id = current_user.id
        stage.status = ProductionRunStageStatus.FINISHED

        next_stage = next(
            (
                candidate
                for candidate in sorted(run.stages, key=lambda item: item.stage_order)
                if candidate.status == ProductionRunStageStatus.PENDING
            ),
            None,
        )
        if next_stage is not None:
            next_stage.status = ProductionRunStageStatus.IN_PROGRESS
            next_stage.started_at = now
            self.repository.flush()
            return self._read_with_names(run)

        self._finish_run(run, payload.final_weight)
        self.repository.flush()
        return self._read_with_names(run)

    def _previous_stage_weight(self, run: ProductionRun, stage: ProductionRunStage) -> Decimal | None:
        """Peso de referencia para validar una etapa: el peso final de la etapa pesada
        anterior; si no hay, el material total requerido de la orden."""
        prior = [
            candidate
            for candidate in run.stages
            if candidate.stage_order < stage.stage_order and candidate.final_weight is not None
        ]
        if prior:
            prior.sort(key=lambda item: item.stage_order)
            return prior[-1].final_weight
        return run.total_required_material

    def _record_decision(
        self,
        run: ProductionRun,
        stage: ProductionRunStage,
        decision: str,
        justification: str | None,
        weight_based: bool,
        final_weight: Decimal | None,
        returned_to_order: int | None,
        current_user: CurrentUser,
        attempt_no: int,
    ) -> None:
        stage.decisions.append(
            ProductionRunStageDecision(
                run_id=run.id,
                decision=decision,
                justification=justification,
                weight_based=weight_based,
                final_weight=final_weight,
                returned_to_order=returned_to_order,
                decided_by_user_id=current_user.id,
                attempt_no=attempt_no,
            )
        )

    def _finish_run(self, run: ProductionRun, final_weight: Decimal | None) -> None:
        run.status = ProductionRunStatus.PENDING_RECEPTION
        run.finished_at = datetime.utcnow()
        run.actual_finished_weight = final_weight
        if final_weight is not None:
            waste = max(Decimal("0"), run.expected_finished_weight - final_weight)
            run.waste_weight = waste
            run.waste_percent = (waste / run.expected_finished_weight * Decimal("100")) if run.expected_finished_weight else Decimal("0")

    def receive_finished_product(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para recibir producto terminado.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError("Solo se puede recibir una produccion finalizada y pendiente de recepcion.")

        self.inventory_service.create_finished_product_lot(
            name=run.process_name,
            unit_code="und",
            production_order_id=run.id,
            production_code=run.production_code,
            quantity=run.quantity,
        )
        run.status = ProductionRunStatus.RECEIVED
        run.received_at = datetime.utcnow()
        run.received_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)

    @staticmethod
    def _ensure_unique_stage_order(stages: list) -> None:
        stage_orders = [stage.order for stage in stages]
        if len(stage_orders) != len(set(stage_orders)):
            raise ProductionDomainError("El orden de las etapas no puede repetirse.")

    @staticmethod
    def _ensure_material_configuration(item_id: UUID | None, quantity_per_unit: Decimal | None) -> None:
        if (item_id is None) != (quantity_per_unit is None):
            raise ProductionDomainError("Configura materia prima y cantidad por unidad juntas.")
