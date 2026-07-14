from uuid import UUID

from sqlalchemy import select

from backend.modules.catalog.models import CatalogSegment
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

    def _to_read(self, row: ProductType) -> ProductTypeRead:
        category = self._segment("CATEGORY", row.category_code)
        model = self._segment("MODEL", row.model_code, parent=row.category_code)
        return ProductTypeRead(
            id=row.id,
            category_code=row.category_code,
            model_code=row.model_code,
            name=row.name,
            price=row.price,
            category_label=category.label if category else row.category_code,
            model_label=model.label if model else row.model_code,
            is_active=row.is_active,
        )

    def list_types(self) -> list[ProductTypeRead]:
        rows = self.session.execute(
            select(ProductType).order_by(ProductType.category_code, ProductType.model_code, ProductType.name)
        ).scalars().all()
        return [self._to_read(row) for row in rows]

    def create_type(self, payload: ProductTypeCreate) -> ProductTypeRead:
        if self._segment("CATEGORY", payload.category_code) is None:
            raise ProductTypeError("El tipo (categoria de catalogo) no existe.")
        if self._segment("MODEL", payload.model_code, parent=payload.category_code) is None:
            raise ProductTypeError("La categoria (modelo) no existe dentro de ese tipo.")
        name = payload.name.strip().upper()
        if not name:
            raise ProductTypeError("El nombre del producto es obligatorio.")
        existing = self.session.execute(
            select(ProductType).where(
                ProductType.category_code == payload.category_code,
                ProductType.model_code == payload.model_code,
                ProductType.name == name,
            )
        ).scalars().first()
        if existing is not None:
            raise ProductTypeError("Ese producto ya esta definido con ese nombre.")
        row = ProductType(
            category_code=payload.category_code,
            model_code=payload.model_code,
            name=name,
            price=payload.price,
        )
        self.session.add(row)
        self.session.flush()
        return self._to_read(row)

    def delete_type(self, type_id: UUID) -> None:
        row = self.session.get(ProductType, type_id)
        if row is None:
            raise ProductTypeError("Tipo de producto no encontrado.")
        self.session.delete(row)
