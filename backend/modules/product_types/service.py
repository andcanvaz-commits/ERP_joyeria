from uuid import UUID

from sqlalchemy import select

from backend.modules.catalog.models import CatalogSegment
from backend.modules.inventory.models import InventoryItem
from backend.modules.product_types.models import ProductType
from backend.modules.product_types.schemas import ProductTypeCreate, ProductTypeRead


class ProductTypeError(ValueError):
    pass


class ProductTypeService:
    def __init__(self, session) -> None:
        self.session = session

    def _segment(self, kind: str, code: str, parent: str | None = None) -> CatalogSegment | None:
        query = select(CatalogSegment).where(CatalogSegment.kind == kind, CatalogSegment.code == code)
        query = query.where(CatalogSegment.parent_code == parent) if parent else query
        return self.session.execute(query).scalars().first()

    def _material_digit(self, material_type: str | None) -> str:
        """Segmento MATERIAL cuyo label este contenido en el material_type del item."""
        materials = self.session.execute(select(CatalogSegment).where(CatalogSegment.kind == "MATERIAL")).scalars().all()
        text = (material_type or "").upper()
        for segment in materials:
            if segment.label.upper() in text:
                return segment.code
        raise ProductTypeError("La materia prima no coincide con ningun material del catalogo (ORO, PLATA...).")

    def _to_read(self, row: ProductType) -> ProductTypeRead:
        category = self._segment("CATEGORY", row.category_code)
        model = self._segment("MODEL", row.model_code, parent=row.category_code)
        item = self.session.get(InventoryItem, row.raw_material_item_id)
        return ProductTypeRead(
            id=row.id,
            category_code=row.category_code,
            model_code=row.model_code,
            product_code=row.product_code,
            category_label=category.label if category else row.category_code,
            model_label=model.label if model else row.model_code,
            raw_material_item_id=row.raw_material_item_id,
            raw_material_name=item.name if item else "",
            purity=item.purity if item else None,
            is_active=row.is_active,
        )

    def list_types(self) -> list[ProductTypeRead]:
        rows = self.session.execute(select(ProductType).order_by(ProductType.product_code)).scalars().all()
        return [self._to_read(row) for row in rows]

    def create_type(self, payload: ProductTypeCreate) -> ProductTypeRead:
        item = self.session.get(InventoryItem, payload.raw_material_item_id)
        if item is None or item.item_type != "RAW_MATERIAL":
            raise ProductTypeError("La materia prima seleccionada no existe.")
        if self._segment("CATEGORY", payload.category_code) is None:
            raise ProductTypeError("El tipo (categoria de catalogo) no existe.")
        if self._segment("MODEL", payload.model_code, parent=payload.category_code) is None:
            raise ProductTypeError("La categoria (modelo) no existe dentro de ese tipo.")
        material = self._material_digit(item.material_type)
        product_code = f"{material}{payload.category_code}{payload.model_code}"
        existing = self.session.execute(
            select(ProductType).where(ProductType.product_code == product_code)
        ).scalars().first()
        if existing is not None:
            raise ProductTypeError("Ese tipo de producto ya esta definido.")
        row = ProductType(
            category_code=payload.category_code,
            model_code=payload.model_code,
            product_code=product_code,
            raw_material_item_id=payload.raw_material_item_id,
        )
        self.session.add(row)
        self.session.flush()
        return self._to_read(row)

    def delete_type(self, type_id: UUID) -> None:
        row = self.session.get(ProductType, type_id)
        if row is None:
            raise ProductTypeError("Tipo de producto no encontrado.")
        self.session.delete(row)
