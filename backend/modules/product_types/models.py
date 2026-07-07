from datetime import datetime
from uuid import UUID as PyUUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.modules.database.base import Base


class ProductType(Base):
    """Definicion de tipo de producto terminado: tipo (categoria de catalogo)
    + categoria (modelo de catalogo) + materia prima. No es inventario."""

    __tablename__ = "product_types"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    category_code: Mapped[str] = mapped_column(String(10), nullable=False)
    model_code: Mapped[str] = mapped_column(String(10), nullable=False)
    product_code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    raw_material_item_id: Mapped[PyUUID] = mapped_column(ForeignKey("inventory_items.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
