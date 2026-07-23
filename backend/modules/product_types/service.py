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
        name = payload.name.strip().upper()
        if not name:
            raise ProductTypeError("El nombre del producto es obligatorio.")
        model_code = payload.model_code
        if model_code is None:
            # El código de modelo lo administra el sistema: si ya existe un
            # modelo con ese nombre en el tipo se reutiliza; si no, siguiente
            # código libre y segmento MODEL nuevo con el nombre del producto.
            models = self.session.execute(
                select(CatalogSegment).where(
                    CatalogSegment.kind == "MODEL",
                    CatalogSegment.parent_code == payload.category_code,
                )
            ).scalars().all()
            same = next(
                (s for s in models if s.is_active and s.label.strip().upper() == name),
                None,
            )
            if same is not None:
                model_code = same.code
            else:
                next_number = max(
                    (int(s.code) for s in models if s.code.isdigit()), default=0
                ) + 1
                model_code = f"{next_number:04d}"
                self.session.add(
                    CatalogSegment(
                        kind="MODEL",
                        code=model_code,
                        parent_code=payload.category_code,
                        label=name,
                    )
                )
        elif self._segment("MODEL", model_code, parent=payload.category_code) is None:
            raise ProductTypeError("El modelo no existe dentro de ese tipo.")
        existing = self.session.execute(
            select(ProductType).where(
                ProductType.category_code == payload.category_code,
                ProductType.model_code == model_code,
                ProductType.name == name,
            )
        ).scalars().first()
        if existing is not None:
            raise ProductTypeError("Ese producto ya esta definido con ese nombre.")
        row = ProductType(
            category_code=payload.category_code,
            model_code=model_code,
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
