from uuid import UUID

from sqlalchemy import select

from backend.modules.catalog.models import CatalogSegment
from backend.modules.catalog.schemas import CatalogSegmentCreate, CatalogSegmentRead

KIND_WIDTH = {"MATERIAL": 1, "CATEGORY": 2, "MODEL": 4}


class CatalogError(ValueError):
    pass


class CatalogSegmentInUseError(CatalogError):
    """El segmento tiene productos con stock y no se puede eliminar."""


class CatalogService:
    def __init__(self, session) -> None:
        self.session = session

    def list_segments(self) -> list[CatalogSegmentRead]:
        rows = (
            self.session.execute(
                select(CatalogSegment).order_by(CatalogSegment.kind, CatalogSegment.parent_code, CatalogSegment.code)
            )
            .scalars()
            .all()
        )
        return [CatalogSegmentRead.model_validate(row) for row in rows]

    def create_segment(self, payload: CatalogSegmentCreate) -> CatalogSegmentRead:
        width = KIND_WIDTH[payload.kind]
        parent = (payload.parent_code or "").strip() or None
        if payload.kind == "MODEL" and not parent:
            raise CatalogError("El tipo/modelo requiere una categoría padre.")

        code = (payload.code or "").strip()
        code = code.zfill(width) if code else self._next_code(payload.kind, parent, width)

        existing = (
            self.session.execute(
                select(CatalogSegment).where(
                    CatalogSegment.kind == payload.kind,
                    CatalogSegment.code == code,
                    CatalogSegment.parent_code.is_(parent) if parent is None else CatalogSegment.parent_code == parent,
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            raise CatalogError("Ese código ya existe en este segmento.")

        segment = CatalogSegment(kind=payload.kind, code=code, label=payload.label.strip(), parent_code=parent)
        self.session.add(segment)
        self.session.flush()
        return CatalogSegmentRead.model_validate(segment)

    def delete_segment(self, segment_id: UUID) -> None:
        segment = self.session.get(CatalogSegment, segment_id)
        if segment is None:
            raise CatalogError("Segmento no encontrado.")

        from sqlalchemy import func

        from backend.modules.inventory.models import InventoryItem

        conditions = [
            InventoryItem.item_type == "FINISHED_PRODUCT",
            func.length(InventoryItem.product_code) == 7,
        ]
        if segment.kind == "MATERIAL":
            conditions.append(func.substring(InventoryItem.product_code, 1, 1) == segment.code)
        elif segment.kind == "CATEGORY":
            conditions.append(func.substring(InventoryItem.product_code, 2, 2) == segment.code)
        elif segment.kind == "MODEL":
            conditions.append(func.substring(InventoryItem.product_code, 2, 2) == (segment.parent_code or ""))
            conditions.append(func.substring(InventoryItem.product_code, 4, 4) == segment.code)

        total_stock = self.session.execute(
            select(func.coalesce(func.sum(InventoryItem.current_stock), 0)).select_from(InventoryItem).where(
                *conditions
            )
        ).scalar_one()
        if total_stock > 0:
            raise CatalogSegmentInUseError(
                f"No se puede eliminar: quedan {total_stock} en stock de productos con este código. "
                f"El stock debe estar en cero primero."
            )
        self.session.delete(segment)

    def _next_code(self, kind: str, parent: str | None, width: int) -> str:
        query = select(CatalogSegment.code).where(CatalogSegment.kind == kind)
        query = query.where(CatalogSegment.parent_code.is_(None)) if parent is None else query.where(CatalogSegment.parent_code == parent)
        rows = self.session.execute(query).scalars().all()
        nums = [int(code) for code in rows if code and code.isdigit()]
        nxt = (max(nums) + 1) if nums else 1
        return str(nxt).zfill(width)


MATERIALS = [("1", "ORO"), ("2", "PLATA"), ("3", "PLASTICO")]

CATEGORIES = [
    ("01", "ARETES"), ("02", "ANILLOS"), ("03", "ACCESORIOS"), ("04", "BOLAS"),
    ("05", "BROCHES"), ("06", "CADENA"), ("07", "COMPLEMENTOS"), ("08", "CONTRASAS"),
    ("09", "CRUZ"), ("10", "DESPERDICIOS"), ("11", "DENARIOS"), ("12", "HILO"),
    ("13", "LLAVES"), ("14", "MEDALLA"), ("15", "MUESTRAS"), ("16", "OREJAS"),
    ("17", "PASA CADENAS"), ("18", "PLACAS"), ("19", "PRESIONES"), ("20", "PULSERAS"),
    ("21", "ROSARIOS"), ("22", "SUELDA"), ("23", "TUBOS"), ("24", "HILO PLASTICO"),
    ("25", "BOLAS PLASTICO"), ("26", "PIEDRAS"), ("27", "LLAVEROS"), ("28", "MONEDAS"),
    ("29", "COLLAR"), ("50", "JOYERIA"), ("51", "SRA.PAULINA"), ("52", "JOVEN PABLO"),
]

# (categoria, codigo_modelo, nombre) — tomados de CODES.xlsx
MODELS = [
    ("01", "0001", "ARETES CASTING"),
    ("02", "0001", "ANILLOS VARIOS CASTING"),
    ("03", "0001", "ACCESORIOS CASTING"), ("03", "0002", "ACCESORIOS COMPLEMENTOS VARIOS"),
    ("04", "0001", "BOLAS"), ("04", "0002", "BOLAS FOFAS"),
    ("05", "0001", "BROCHES LIJERO"), ("05", "0002", "BROCHES GRUESO"),
    ("06", "0001", "CADENA ANCORA LARGA ROSARIOS"), ("06", "0002", "CADENA ANCORA REDONDA"),
    ("06", "0003", "CADENA ANCORA LARGA"), ("06", "0004", "CADENA BB"),
    ("06", "0005", "CADENA COLA DE RATON"), ("06", "0006", "CADENA COMBINADA 3X1"),
    ("06", "0007", "CADENA COMBINADA 1X1"), ("06", "0008", "CADENA ESALBON CORTA"),
    ("06", "0009", "CADENA ESALBON LARGA"), ("06", "0010", "CADENA ESLABON"),
    ("06", "0011", "CADENA ESLABON DIAMANTADA"), ("06", "0012", "CADENA ESLABON DIAMANTADA 2"),
    ("06", "0013", "CADENA ROMBO"), ("06", "0014", "CADENA VENECIANA"),
    ("06", "0015", "CADENA MUESTRAS"), ("06", "0016", "CADENA BOXCHAIN"),
    ("06", "0017", "CADENA LOMO DE CORVINA"), ("06", "0018", "CADENA CUBANA"),
    ("06", "0019", "CADENA CORDON"),
    ("07", "0001", "COMPLEMENTOS"),
    ("08", "0001", "CONTRASAS"), ("08", "0002", "CONTRASAS PEQUENA"), ("08", "0003", "CONTRASAS GRANDE"),
    ("09", "0001", "CRUZ"), ("09", "0002", "CRUZ CASTING"),
    ("10", "0001", "DESPERDICIOS"),
    ("11", "0001", "DENARIOS"),
    ("12", "0001", "HILO"),
    ("13", "0001", "LLAVES CANGURO"), ("13", "0002", "LLAVES CANGREJO"),
    ("14", "0001", "ANGEL PENSANTE"), ("14", "0002", "DIVINO NINO"), ("14", "0003", "DOLOROSA"),
    ("14", "0004", "CORAZON DE JESUS"), ("14", "0005", "ESCAPULARIO"), ("14", "0006", "GUADALUPE"),
    ("14", "0007", "AUXILIADORA"), ("14", "0008", "MILAGROSA"), ("14", "0009", "ANGEL DE LA GUARDA"),
    ("14", "0010", "PINGUINO"), ("14", "0011", "SAN BENITO"), ("14", "0012", "NINA MARIA"),
    ("15", "0001", "MUESTRAS"),
    ("16", "0001", "OREJAS"),
    ("17", "0001", "PASA CADENAS GRANDE"), ("17", "0002", "PASA CADENAS PEQ"), ("17", "0003", "PASA CADENAS MINI"),
    ("18", "0001", "PLACAS ITALY 925"), ("18", "0002", "PLACAS ECU 925"), ("18", "0003", "PLACAS 925"),
    ("18", "0004", "PLACAS 999"), ("18", "0005", "PLACAS CON CADENA"),
    ("19", "0001", "PRESIONES"),
    ("20", "0001", "PULSERAS PIEDRAS COLORES VARIAS"), ("20", "0002", "PULSERAS CRUZ CONTINUA"),
    ("20", "0003", "PULSERAS MARIPOSAS"), ("20", "0004", "PULSERAS BOX CHAIN"),
    ("20", "0005", "PULSERAS HILO ROJO"), ("20", "0006", "PULSERAS BARRIL"),
    ("20", "0007", "PULSERAS BOLAS DIAMANTADAS"), ("20", "0008", "PULSERAS BOX CHAIN CON 1 BOLA"),
    ("20", "0009", "PULSERAS RESORTE MAS HILO ROJO"), ("20", "0010", "PULSERAS BARRIL MAS HILO ROJO"),
    ("20", "0011", "PULSERAS BARRIL MAS BOLAS"), ("20", "0012", "PULSERAS BARRIL MAS BOLAS Y ELASTICO"),
    ("20", "0013", "PULSERAS BARRIL MAS BOLAS Y ELASTICO BOLAS CONTINUAS"),
    ("21", "0001", "ROSARIOS"), ("21", "0002", "ROSARIOS MUESTRAS"),
    ("22", "0001", "SUELDA"),
    ("23", "0001", "TUBOS VARIOS PRODUCCION"),
    ("24", "0001", "HILO"),
    ("25", "0001", "BOLAS"),
    ("26", "0001", "PIEDRAS"),
    ("27", "0001", "3 DIJES"),
    ("28", "0001", "JUEGO DE 7 MONEDAS"),
    ("29", "0001", "BARRIL GRANDE"), ("29", "0002", "BARRIL GRANDE MAS BOLA"),
    ("50", "0001", "TUBOS VARIOS PRODUCCION"),
    ("51", "0001", "TUBOS VARIOS PRODUCCION"),
    ("52", "0001", "ARREGLOS"), ("52", "0002", "DESPERDICIOS"),
]


def seed_catalog(session) -> None:
    """Siembra materiales, categorías y modelos reales de CODES.xlsx.
    Idempotente: agrega lo que falte y alinea el nombre al del Excel si un código ya
    existía con otro nombre (corrige datos sembrados por versiones anteriores)."""
    existing = {
        (seg.kind, seg.code, seg.parent_code): seg
        for seg in session.execute(select(CatalogSegment)).scalars().all()
    }

    def ensure(kind: str, code: str, label: str, parent: str | None) -> None:
        seg = existing.get((kind, code, parent))
        if seg is None:
            seg = CatalogSegment(kind=kind, code=code, label=label, parent_code=parent)
            session.add(seg)
            existing[(kind, code, parent)] = seg
        elif seg.label != label:
            seg.label = label

    for code, label in MATERIALS:
        ensure("MATERIAL", code, label, None)
    for code, label in CATEGORIES:
        ensure("CATEGORY", code, label, None)
    for category, code, label in MODELS:
        ensure("MODEL", code, label, category)
