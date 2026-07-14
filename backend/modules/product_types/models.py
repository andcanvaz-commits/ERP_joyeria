from datetime import datetime
from decimal import Decimal
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.modules.database.base import Base


class ProductType(Base):
    """Definicion de tipo de producto terminado: tipo (categoria de catalogo)
    + categoria (modelo de catalogo) + nombre. La materia prima/metal se define
    despues, en produccion. No es inventario."""

    __tablename__ = "product_types"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    category_code: Mapped[str] = mapped_column(String(10), nullable=False)
    model_code: Mapped[str] = mapped_column(String(10), nullable=False)
    # Nombre libre del producto; unicidad (category_code, model_code, name).
    name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    # Precio referencial de venta (opcional).
    price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
